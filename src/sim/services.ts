/**
 * GARAGE/DEPOT services: repair, rearm, battery recharge, and per-city
 * vehicle storage. Every price and day cost comes from `economy()` (and,
 * for repair, from the cost formulas already in `@/sim/economy` -
 * `repairCost` is called here, never re-derived); nothing gameplay-relevant
 * is a literal in this file. `@/sim/economy`'s `applyService` already wires
 * a handful of driver-facing services (clone, medical, bus, ...) against a
 * single-vehicle `EconomyWorld`; this module covers the four garage-bay
 * services that touch a `VehicleState` directly and, for storage, need a
 * multi-vehicle, per-city fleet that `EconomyWorld` doesn't model.
 */
import { drivingConfig, economy, getBody, getPlant, getTire, getWeapon, wheelCount } from '@/data/rulesets';
import { repairCost, type RepairTarget } from '@/sim/economy';
import { advanceDays, type Clock } from '@/sim/calendar';
import type { DriverState, Facing, TireDPTuple, VehicleState } from '@/sim/types';

// ---------------------------------------------------------------------------
// Shared result shape
// ---------------------------------------------------------------------------

export type ServiceFailureReason =
  | 'insufficientFunds'
  | 'invalidRequest'
  | 'weaponNotFound'
  | 'weaponCannotBeRearmed'
  | 'vehicleNotFound'
  | 'notStoredHere';

export interface ServiceSuccess {
  ok: true;
  driver: DriverState;
  vehicle: VehicleState;
  clock: Clock;
  /** Dollars actually charged. */
  cost: number;
}

export type ServiceResult = ServiceSuccess | { ok: false; reason: ServiceFailureReason };

/** Charges `cost` against `driver.cash`, or returns null (nothing mutated) when that would go negative. */
function tryCharge(driver: DriverState, cost: number): DriverState | null {
  if (driver.cash < cost) return null;
  return { ...driver, cash: driver.cash - cost };
}

// ---------------------------------------------------------------------------
// REPAIR - components repair fully, armor repairs per point, tires never
// repair (see `replaceTire` below - `RepairRequest` has no 'tire' variant,
// so the type system itself refuses a caller who tries to "repair" one).
// ---------------------------------------------------------------------------

export type RepairRequest =
  | { kind: 'plant' }
  | { kind: 'weapon'; weaponIndex: number }
  | { kind: 'armor'; facing: Facing; points: number };

/**
 * Repairs every item in `requests` as ONE atomic transaction: priced and
 * mutated together in a single pass over a running `nextVehicle`, so a
 * request that duplicates (or is made moot by) an earlier one in the same
 * batch is priced against what's ACTUALLY still missing at that point in
 * the batch, not against the untouched starting vehicle - a second "repair
 * armor FRONT" for a facing the first item already made whole prices at
 * $0, exactly like its mutation is a no-op. A request whose own `points` is
 * not a positive integer, or a `weaponIndex` that doesn't exist, refuses the
 * whole batch immediately (nothing charged, nothing mutated, since only the
 * local `nextVehicle`/`totalCost` locals have been touched so far). A batch
 * that comes out to $0 total (e.g. the only request in it targets something
 * already fully healthy) is ALSO refused as `invalidRequest` - a no-op repair
 * trip would otherwise still burn the scarce in-game day for nothing, the
 * same contract `rearm` enforces for an already-full magazine. Costs exactly
 * one day (economy.json `timeCostDays.repairCar`) no matter how many items
 * are in the batch - a single trip to the garage bay.
 */
export function repair(
  driver: DriverState,
  vehicle: VehicleState,
  clock: Clock,
  requests: readonly RepairRequest[],
): ServiceResult {
  if (requests.length === 0) return { ok: false, reason: 'invalidRequest' };

  const plant = getPlant(vehicle.design.plantId);
  const armorCostPerPoint = getBody(vehicle.design.bodyId).armorCostPerPoint;

  let totalCost = 0;
  let nextVehicle = vehicle;
  for (const request of requests) {
    if (request.kind === 'plant') {
      const target: RepairTarget = {
        kind: 'component',
        originalCost: plant.price,
        currentDP: nextVehicle.plantDP,
        maxDP: plant.maxDP,
      };
      totalCost += repairCost(target);
      nextVehicle = { ...nextVehicle, plantDP: plant.maxDP };
    } else if (request.kind === 'weapon') {
      const state = nextVehicle.weapons[request.weaponIndex];
      if (state === undefined) return { ok: false, reason: 'weaponNotFound' };
      const def = getWeapon(state.weaponId);
      const target: RepairTarget = { kind: 'component', originalCost: def.price, currentDP: state.dp, maxDP: def.maxDP };
      totalCost += repairCost(target);
      const weapons = nextVehicle.weapons.slice();
      weapons[request.weaponIndex] = { ...state, dp: def.maxDP, destroyed: false };
      nextVehicle = { ...nextVehicle, weapons };
    } else {
      if (!Number.isInteger(request.points) || request.points <= 0) {
        return { ok: false, reason: 'invalidRequest' };
      }
      const missing = Math.max(0, nextVehicle.design.armor[request.facing] - nextVehicle.armorDP[request.facing]);
      const points = Math.min(request.points, missing);
      totalCost += repairCost({ kind: 'armor', costPerPoint: armorCostPerPoint, pointsToRepair: points });
      nextVehicle = {
        ...nextVehicle,
        armorDP: { ...nextVehicle.armorDP, [request.facing]: nextVehicle.armorDP[request.facing] + points },
      };
    }
  }

  if (totalCost === 0) return { ok: false, reason: 'invalidRequest' };

  const chargedDriver = tryCharge(driver, totalCost);
  if (chargedDriver === null) return { ok: false, reason: 'insufficientFunds' };

  return {
    ok: true,
    driver: chargedDriver,
    vehicle: nextVehicle,
    clock: advanceDays(clock, economy().timeCostDays.repairCar),
    cost: totalCost,
  };
}

/**
 * Tires are REPLACED, never repaired - a fresh tire at the design's own
 * `tireId`, priced at full list (see `repairCost`'s 'tire' branch, which is
 * NOT scaled by `repairCostFactor` the way a component/armor repair is).
 * Deliberately a separate function from `repair()` (whose `RepairRequest`
 * union has no 'tire' kind) so a caller cannot ask to "repair" a tire at
 * all, let alone at the wrong price. Costs one day, same garage-bay trip as
 * `repair()`.
 */
export function replaceTire(driver: DriverState, vehicle: VehicleState, clock: Clock, wheelIndex: number): ServiceResult {
  if (!Number.isInteger(wheelIndex) || wheelIndex < 0 || wheelIndex >= wheelCount()) {
    return { ok: false, reason: 'invalidRequest' };
  }

  const tire = getTire(vehicle.design.tireId);
  const cost = repairCost({ kind: 'tire', tireId: vehicle.design.tireId });

  const chargedDriver = tryCharge(driver, cost);
  if (chargedDriver === null) return { ok: false, reason: 'insufficientFunds' };

  const tireDP: TireDPTuple = [...vehicle.tireDP];
  tireDP[wheelIndex] = tire.maxDP;

  return {
    ok: true,
    driver: chargedDriver,
    vehicle: { ...vehicle, tireDP },
    clock: advanceDays(clock, economy().timeCostDays.repairCar),
    cost,
  };
}

// ---------------------------------------------------------------------------
// REARM - refills a mounted weapon's ammo up to weapons.json's ammoCapacity.
// Indexed by mount (not weaponId alone) since two mounts can carry the same
// weapon. The laser (`usesBattery`) and the one-shot heavy rocket
// (`ammoCost` 0, `removeAfterFire`) have no ammo market transaction to make.
// ---------------------------------------------------------------------------

export function rearm(driver: DriverState, vehicle: VehicleState, clock: Clock, weaponIndex: number): ServiceResult {
  const state = vehicle.weapons[weaponIndex];
  if (state === undefined) return { ok: false, reason: 'weaponNotFound' };

  const def = getWeapon(state.weaponId);
  if (def.usesBattery === true || def.ammoCost === 0) {
    return { ok: false, reason: 'weaponCannotBeRearmed' };
  }

  const roundsNeeded = Math.max(0, def.ammoCapacity - state.ammo);
  if (roundsNeeded <= 0) return { ok: false, reason: 'invalidRequest' };
  const cost = roundsNeeded * def.ammoCost;

  const chargedDriver = tryCharge(driver, cost);
  if (chargedDriver === null) return { ok: false, reason: 'insufficientFunds' };

  const weapons = vehicle.weapons.slice();
  weapons[weaponIndex] = { ...state, ammo: def.ammoCapacity };

  return {
    ok: true,
    driver: chargedDriver,
    vehicle: { ...vehicle, weapons },
    clock: advanceDays(clock, economy().timeCostDays.weaponTransaction),
    cost,
  };
}

// ---------------------------------------------------------------------------
// RECHARGE - always tops the battery to driving.json's `battery.full` (99),
// and always costs the flat, configured price regardless of starting
// charge - never scaled by how much was missing. No day cost.
// ---------------------------------------------------------------------------

export function recharge(driver: DriverState, vehicle: VehicleState, clock: Clock): ServiceResult {
  const service = economy().services.batteryRecharge;

  const chargedDriver = tryCharge(driver, service.price);
  if (chargedDriver === null) return { ok: false, reason: 'insufficientFunds' };

  const full = service.restoresTo ?? drivingConfig().battery.full;

  return {
    ok: true,
    driver: chargedDriver,
    // batteryDebt (the fractional carry - see VehicleState's own doc comment)
    // resets atomically with a recharge, same as the fresh-battery case.
    vehicle: { ...vehicle, battery: full, batteryDebt: 0 },
    clock: advanceDays(clock, service.days),
    cost: service.price,
  };
}

// ---------------------------------------------------------------------------
// STORAGE - per-city garaging, up to the fleet cap. A stored vehicle counts
// against the cap the same as the one currently in use; storing is free and
// the fee lands on RETRIEVAL (economy.json: storeCar.price is 0, its own
// `paidOnRetrieval` note documents the same number retrieveCar.price charges).
// ---------------------------------------------------------------------------

export interface FleetVehicle {
  vehicle: VehicleState;
  /** The city this vehicle is parked in. Only meaningful while `stored` is true. */
  cityId: string;
  /** False for the one vehicle currently out on the road with the driver. */
  stored: boolean;
}

export interface Fleet {
  vehicles: readonly FleetVehicle[];
}

/** Every owned vehicle counts toward the cap, garaged or not. */
export function fleetSize(fleet: Fleet): number {
  return fleet.vehicles.length;
}

/** True when the fleet has room for one more vehicle under economy.json's `maxFleetSize`. */
export function fleetHasRoom(fleet: Fleet): boolean {
  return fleetSize(fleet) < economy().maxFleetSize;
}

export interface FleetServiceSuccess {
  ok: true;
  driver: DriverState;
  fleet: Fleet;
  clock: Clock;
  cost: number;
}

export type FleetServiceResult = FleetServiceSuccess | { ok: false; reason: ServiceFailureReason };

/** Garages `vehicleId` (currently active, i.e. not already stored) at the driver's current city. */
export function storeCar(driver: DriverState, fleet: Fleet, clock: Clock, vehicleId: string): FleetServiceResult {
  const index = fleet.vehicles.findIndex((entry) => entry.vehicle.id === vehicleId && !entry.stored);
  const found = index === -1 ? undefined : fleet.vehicles[index];
  if (found === undefined) return { ok: false, reason: 'vehicleNotFound' };

  const service = economy().services.storeCar;
  const chargedDriver = tryCharge(driver, service.price);
  if (chargedDriver === null) return { ok: false, reason: 'insufficientFunds' };

  const vehicles = fleet.vehicles.slice();
  vehicles[index] = { ...found, stored: true, cityId: driver.cityId };

  return {
    ok: true,
    driver: chargedDriver,
    fleet: { vehicles },
    clock: advanceDays(clock, service.days),
    cost: service.price,
  };
}

/**
 * Retrieves `vehicleId` from storage in the driver's CURRENT city (a car
 * stored elsewhere isn't reachable from here). The fee is charged now, on
 * pickup - never at drop-off, mirroring `applyService`'s single-vehicle
 * storeCar/retrieveCar pairing in `@/sim/economy` for the same reason.
 */
export function retrieveCar(driver: DriverState, fleet: Fleet, clock: Clock, vehicleId: string): FleetServiceResult {
  const index = fleet.vehicles.findIndex(
    (entry) => entry.vehicle.id === vehicleId && entry.stored && entry.cityId === driver.cityId,
  );
  const found = index === -1 ? undefined : fleet.vehicles[index];
  if (found === undefined) return { ok: false, reason: 'notStoredHere' };

  const service = economy().services.retrieveCar;
  const chargedDriver = tryCharge(driver, service.price);
  if (chargedDriver === null) return { ok: false, reason: 'insufficientFunds' };

  const vehicles = fleet.vehicles.slice();
  vehicles[index] = { ...found, stored: false };

  return {
    ok: true,
    driver: chargedDriver,
    fleet: { vehicles },
    clock: advanceDays(clock, service.days),
    cost: service.price,
  };
}
