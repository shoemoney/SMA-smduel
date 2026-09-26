/**
 * ECONOMY subsystem: vehicle valuation, repair costs, sale value, salvage,
 * garage/depot services, and division/class eligibility.
 *
 * Every tunable number here comes from `economy()` / `skillsConfig()` /
 * `drivingConfig()` (rulesets/classic/economy.json, skills.json, driving.json)
 * via the validated loader in `@/data/rulesets` - nothing gameplay-relevant is
 * a literal in this file. Casino games live in `@/sim/casino`.
 */
import { citiesConfig, drivingConfig, economy, getTire, getWeapon, skillsConfig } from '@/data/rulesets';
import { buyBodyArmor, createClone, mechanicLesson, salvageChance, updateClone } from '@/sim/driver';
import { advanceDays, type Clock } from '@/sim/calendar';
import { computeBuild, type BuildDesign } from '@/sim/construct';
import type { CargoState, DriverState, ServiceId, VehicleState } from '@/sim/types';
import type { Rng } from '@/util/rng';

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

/**
 * Full sticker price if every listed component, and the armor exactly as
 * originally installed, were bought new today - ignores any battle damage.
 *
 * Delegates entirely to `computeBuild` (the constructor's own cost formula:
 * body + chassis/suspension price modifiers + plant + 4*tire + weapons +
 * ammo + armor) rather than re-deriving it, so there is exactly one place
 * that knows what a vehicle costs.
 */
export function purchaseValue(vehicle: VehicleState): number {
  return computeBuild(vehicle.design).costTotal;
}

/**
 * What the vehicle is worth right now: same formula as `purchaseValue`, but
 * with armor valued at its CURRENT remaining DP (armorDP) rather than what
 * was originally installed - weapons and the plant aren't tracked at partial
 * dollar depreciation (a component is either intact or destroyed, never
 * "60% of a plant"), only armor is.
 *
 * UNCERTAINTY, noted per task: the source material never says whether
 * arena-division / courier-tier eligibility is checked against a car's
 * original purchase price or its current (possibly battle-damaged) value.
 * `divisionEligible` below uses currentValue, on the theory that a shot-up
 * car shouldn't be gated by the price tag it had before the damage - this is
 * a reconstruction judgment call, not a sourced rule, and should be revisited
 * if the manual ever settles it.
 */
export function currentValue(vehicle: VehicleState): number {
  const asDamaged: BuildDesign = { ...vehicle.design, armor: vehicle.armorDP };
  return computeBuild(asDamaged).costTotal;
}

/** True when `vehicle` is legal for a division/tier capped at `divisionCap` dollars. */
export function divisionEligible(vehicle: VehicleState, divisionCap: number): boolean {
  return currentValue(vehicle) <= divisionCap;
}

// ---------------------------------------------------------------------------
// Sale value
// ---------------------------------------------------------------------------

/**
 * saleValue(originalCost, condition) = floor(originalCost * lerp(floor, ceiling, condition)).
 * `condition` is a 0..1 fraction (0 = wrecked, 1 = pristine) and is clamped
 * before use so a caller can't be paid more than the ceiling rate or less
 * than the floor rate by passing an out-of-range value.
 */
export function saleValue(originalCost: number, condition: number): number {
  const r = economy()._reconstruction;
  const clamped = Math.min(1, Math.max(0, condition));
  const factor = r.saleValueConditionFloor + (r.saleValueConditionCeiling - r.saleValueConditionFloor) * clamped;
  return Math.floor(originalCost * factor);
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

/** Weapons and plants: repaired fully in one shot, from currentDP up to maxDP. */
export interface FullRepairTarget {
  kind: 'component';
  originalCost: number;
  currentDP: number;
  maxDP: number;
}

/** Armor repairs PER POINT - the caller chooses how many missing points to buy back now. */
export interface ArmorRepairTarget {
  kind: 'armor';
  costPerPoint: number;
  pointsToRepair: number;
}

/** Tires are REPLACED, not repaired - the cost is a fresh tire, not a DP-fraction formula. */
export interface TireReplacementTarget {
  kind: 'tire';
  tireId: string;
}

export type RepairTarget = FullRepairTarget | ArmorRepairTarget | TireReplacementTarget;

/**
 * repairCost(component) = ceil(originalCost * missingDP/maxDP * factor) for
 * ordinary components; armor is ceil(costPerPoint * pointsToRepair * factor);
 * a tire replacement is simply that tire's list price.
 */
export function repairCost(target: RepairTarget): number {
  const factor = economy()._reconstruction.repairCostFactor;
  switch (target.kind) {
    case 'component': {
      if (target.maxDP <= 0) return 0;
      const missingDP = Math.max(0, target.maxDP - target.currentDP);
      return Math.ceil(target.originalCost * (missingDP / target.maxDP) * factor);
    }
    case 'armor':
      return Math.ceil(target.costPerPoint * target.pointsToRepair * factor);
    case 'tire':
      return getTire(target.tireId).price;
  }
}

// ---------------------------------------------------------------------------
// Services (garage/depot/casino-adjacent transactions)
// ---------------------------------------------------------------------------

export interface EconomyWorld {
  clock: Clock;
  /** The vehicle currently at the garage/depot bay, if any - batteryRecharge, storeCar and retrieveCar act on this one. */
  vehicle: VehicleState | null;
  /** Whether `vehicle` is currently sitting in paid storage. */
  vehicleStored: boolean;
}

export type ApplyServiceFailureReason =
  | 'insufficientFunds'
  | 'noVehicleSelected'
  | 'alreadyStored'
  | 'notStored'
  | 'invalidDestination';

export type ApplyServiceResult =
  | { ok: true; driver: DriverState; world: EconomyWorld }
  | { ok: false; reason: ApplyServiceFailureReason };

const VEHICLE_SERVICES: ReadonlySet<ServiceId> = new Set<ServiceId>(['batteryRecharge', 'storeCar', 'retrieveCar']);

/** True when `cityId` and `destinationCityId` are joined by a route in cities.json, either direction. */
function isAdjacentCity(cityId: string, destinationCityId: string): boolean {
  return citiesConfig().routes.some(
    (route) =>
      (route.a === cityId && route.b === destinationCityId) || (route.b === cityId && route.a === destinationCityId),
  );
}

/**
 * Applies a service's own gameplay effect on top of a driver who has already
 * been charged. Every branch here corresponds to a service that changes
 * something beyond cash/clock/vehicle (those three are handled generically
 * by the caller); a service not listed here (arenaPractice, drink,
 * truckStopRoomNight, busToAdjacentCity with no destination change pending,
 * ...) really is just "pay money, spend time" with no further state to
 * mutate - `docs/SPEC.md` never describes one, so nothing is invented here.
 */
function applyServiceEffect(
  driver: DriverState,
  serviceKey: ServiceId,
  rng: Rng,
  destinationCityId: string | undefined,
): DriverState {
  switch (serviceKey) {
    // Body armor is always REPLACED to full (see driver.ts's buyBodyArmor),
    // never topped up point-by-point - one source of truth for that rule.
    case 'bodyArmor':
      return buyBodyArmor(driver);
    // "A clone ($5,000) stores one skill snapshot" (SPEC.md) at the driver's
    // current city.
    case 'clone':
      return createClone(driver, driver.cityId);
    // "an update ($3,000) replaces it" (SPEC.md) - refreshes the skill
    // snapshot in place at whatever city the clone is already on file at,
    // falling back to the current city only if no clone exists yet.
    case 'braintapeUpdate':
      return updateClone(driver, driver.cloneCityId ?? driver.cityId);
    // driver.ts's own lesson roll/gain formula - never re-derived here.
    case 'mechanicLesson':
      return mechanicLesson(driver, () => rng.nextFloat()).driver;
    // "Seven days: one point of healing" (SPEC.md) - medicalPerPoint's price
    // and day cost already buy exactly one point, never past the cap.
    case 'medicalPerPoint':
      return { ...driver, naturalHealth: Math.min(skillsConfig().driver.naturalHealthDP, driver.naturalHealth + 1) };
    // Destination is validated (existence + adjacency) by the caller before
    // any cash is charged, so by the time this runs it is safe to apply.
    case 'busToAdjacentCity':
      return destinationCityId !== undefined ? { ...driver, cityId: destinationCityId } : driver;
    default:
      return driver;
  }
}

/**
 * Charges `driver` the service's price, advances `world.clock` by its day
 * cost, and refuses (no mutation, no debt, no clock advance) when cash is
 * short or a precondition fails. Recharge always restores battery to 99
 * regardless of the starting charge - its price (50) is flat, not scaled by
 * how much charge was missing. Storing a car is itself free (storeCar's own
 * price is 0); the charge lands when the car is later retrieved, via
 * retrieveCar's own price - so "storing charges on retrieval" falls out of
 * the ruleset data rather than being special-cased here.
 *
 * `rng` drives only mechanicLesson's success/gain roll (seeded - never
 * Math.random) and is otherwise unused. `destinationCityId` is required (and
 * validated against cities.json's route graph) only for busToAdjacentCity.
 */
export function applyService(
  driver: DriverState,
  world: EconomyWorld,
  serviceKey: ServiceId,
  rng: Rng,
  destinationCityId?: string,
): ApplyServiceResult {
  const service = economy().services[serviceKey];

  if (VEHICLE_SERVICES.has(serviceKey)) {
    if (world.vehicle === null) return { ok: false, reason: 'noVehicleSelected' };
    if (serviceKey === 'storeCar' && world.vehicleStored) return { ok: false, reason: 'alreadyStored' };
    if (serviceKey === 'retrieveCar' && !world.vehicleStored) return { ok: false, reason: 'notStored' };
  }

  if (serviceKey === 'busToAdjacentCity') {
    if (destinationCityId === undefined || !isAdjacentCity(driver.cityId, destinationCityId)) {
      return { ok: false, reason: 'invalidDestination' };
    }
  }

  if (driver.cash < service.price) return { ok: false, reason: 'insufficientFunds' };

  const chargedDriver: DriverState = { ...driver, cash: driver.cash - service.price };
  const nextDriver = applyServiceEffect(chargedDriver, serviceKey, rng, destinationCityId);

  const nextClock = advanceDays(world.clock, service.days);

  const nextVehicle =
    serviceKey === 'batteryRecharge' && world.vehicle !== null
      ? { ...world.vehicle, battery: service.restoresTo ?? drivingConfig().battery.full }
      : world.vehicle;

  const nextStored = serviceKey === 'storeCar' ? true : serviceKey === 'retrieveCar' ? false : world.vehicleStored;

  return {
    ok: true,
    driver: nextDriver,
    world: { clock: nextClock, vehicle: nextVehicle, vehicleStored: nextStored },
  };
}

// ---------------------------------------------------------------------------
// Salvage
// ---------------------------------------------------------------------------

/** A weapon found intact in a wreck, still holding whatever ammo it had left. */
export interface WreckWeapon {
  weaponId: string;
  ammo: number;
}

/** Non-weapon recoverable gear: sized by weight/space only, no dollar value modeled yet. */
export interface WreckGearItem {
  id: string;
  weightLb: number;
  spaces: number;
}

export interface Wreck {
  id: string;
  /** IGNITE_WRECK weapon effects (weapons.json) can set this. A burned wreck yields nothing, ever. */
  burned: boolean;
  /** Set once salvageRoll has been attempted - a wreck cannot be rerolled. */
  searched: boolean;
  weapons: WreckWeapon[];
  gear: WreckGearItem[];
}

/** The actor attempting the salvage: their mechanic skill and the vehicle receiving any transferred ammo. */
export interface Salvager {
  skill: number;
  vehicle: VehicleState;
}

/** A freshly-recovered salvage item is undamaged: full integrity on the same 0..100 scale `damage.ts`/`hud.ts` use everywhere else. */
const SALVAGE_FULL_INTEGRITY = 100;

export type SalvageResult =
  | { ok: false; reason: 'alreadySearched' }
  | { ok: true; success: false; wreck: Wreck }
  | { ok: true; success: true; wreck: Wreck; vehicle: VehicleState; cargo: CargoState[] };

/**
 * One roll per wreck (the returned `wreck.searched` flag is what a caller
 * persists to enforce that). Burned wrecks always yield nothing, no roll
 * needed. On a successful roll: matching, un-destroyed, reloadable (not
 * oneShot/removeAfterFire) mounted weapons get their ammo topped up from the
 * wreck's copy up to magazine capacity - but the RECOVERED gun itself is
 * still a separate physical unit and, per SPEC.md's "everything else becomes
 * abstract cargo", always becomes cargo alongside it too (never installed in
 * place of the mount, never discarded). A one-shot launcher's single round is
 * not a "magazine" to top up, so it is never auto-transferred into a mounted
 * one - the whole found unit becomes cargo instead.
 */
export function salvageRoll(mechanic: Salvager, wreck: Wreck, rng: Rng): SalvageResult {
  if (wreck.searched) return { ok: false, reason: 'alreadySearched' };

  const searchedWreck: Wreck = { ...wreck, searched: true };

  if (wreck.burned) {
    return { ok: true, success: false, wreck: searchedWreck };
  }

  const chance = Math.round(salvageChance(mechanic.skill, wreck.burned));
  if (!rng.chance(chance)) {
    return { ok: true, success: false, wreck: searchedWreck };
  }

  const cargo: CargoState[] = [];
  const weapons = mechanic.vehicle.weapons.map((weaponState) => ({ ...weaponState }));

  for (const found of wreck.weapons) {
    const def = getWeapon(found.weaponId);
    const reloadable = def.removeAfterFire !== true;
    const mountedIndex = reloadable ? weapons.findIndex((w) => w.weaponId === found.weaponId && !w.destroyed) : -1;
    const mounted = mountedIndex >= 0 ? weapons[mountedIndex] : undefined;

    const room = mounted !== undefined ? Math.max(0, def.ammoCapacity - mounted.ammo) : 0;
    const transferred = Math.min(room, found.ammo);
    if (transferred > 0 && mounted !== undefined) {
      weapons[mountedIndex] = { ...mounted, ammo: mounted.ammo + transferred };
    }
    const leftover = found.ammo - transferred;

    // The recovered gun body itself (plus whatever ammo didn't fit a mount)
    // always becomes abstract salvage cargo - it is never installed, and a
    // matching mount only ever absorbs its ammo, never the gun.
    cargo.push({
      id: `${wreck.id}-weapon-${found.weaponId}`,
      kind: 'salvage',
      weightLb: def.weightLb + leftover * def.ammoWeightLb,
      spaces: def.spaces,
      integrity: SALVAGE_FULL_INTEGRITY,
    });
  }

  for (const item of wreck.gear) {
    cargo.push({
      id: `${wreck.id}-gear-${item.id}`,
      kind: 'salvage',
      weightLb: item.weightLb,
      spaces: item.spaces,
      integrity: SALVAGE_FULL_INTEGRITY,
    });
  }

  return {
    ok: true,
    success: true,
    wreck: searchedWreck,
    vehicle: { ...mechanic.vehicle, weapons },
    cargo,
  };
}
