/**
 * Weapon shop interior: install any weapon from the ruleset table at its
 * list price with no separate fee, or refill an already-mounted weapon's
 * ammo up to capacity. Every ruleset weapon is "legal" here — nothing in
 * weapons.json marks any of them otherwise, so "install legal weapons"
 * (task brief) is simply every row `allWeapons()` returns.
 *
 * A freshly installed weapon mounts on its first `allowedFacings` entry with
 * 0 ammo (a separate refill row tops it up) and full DP — the same shape
 * `@/app.ts`'s `vehicleStateFromConfirmedBuild` gives a construction-time
 * mount. `installWeapon`/`refillWeapon` write BOTH `vehicle.weapons`
 * (runtime combat state) and `vehicle.design.weapons` (the construction
 * record) in lockstep: every value/weight/space/legality computation in the
 * game (`@/sim/economy`'s `purchaseValue`/`currentValue`, this module's own
 * `canInstall`) reads `computeBuild(vehicle.design)`, so a mount that only
 * ever touched the runtime array would be worth $0, weigh nothing, and never
 * be checked for space/load/facing legality — exactly the desync
 * `@/ui/buildings/salvage`'s sell-weapon mirrors back the other way.
 *
 * The install cap is `@/sim/construct`'s own `computeBuild` space/load
 * legality (`canInstall`, accounting for cargo already aboard the same way
 * `@/ui/buildings/courierguild` already does for a payload) — never a fixed
 * mount-row count. `@/ui/hud`'s `MAX_WEAPON_ROWS` is a HUD display-row
 * budget, not a construction rule (see that constant's own doc comment), so
 * it has no business gating what the shop will sell.
 */
import { allWeapons, getWeapon } from '@/data/rulesets';
import { advanceForTimeCost, timeCostOf } from '@/sim/calendar';
import { computeBuild } from '@/sim/construct';
import type { MountedWeapon, VehicleDesign, VehicleState, WeaponState } from '@/sim/types';
import { t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
import {
  type BuildingContext,
  type BuildingEngine,
  canAfford,
  closedAction,
  facilityOpenNow,
  headerFor,
  insufficientFundsReason,
  leaveAction,
  LEAVE_ACTION_ID,
} from '@/ui/buildings/shared';

export const WEAPONSHOP_KIND = 'weaponshop';

export interface WeaponshopState {
  readonly context: BuildingContext;
}

export function createWeaponshopState(context: BuildingContext): WeaponshopState {
  return { context };
}

function firstAllowedFacing(weaponId: string): VehicleState['weapons'][number]['facing'] {
  const def = getWeapon(weaponId);
  const facing = def.allowedFacings[0];
  if (facing === undefined) throw new Error(`weapon "${weaponId}" has no allowed facings`);
  return facing;
}

/** Total weight/spaces of everything already in `vehicle.cargo` — the same rollup `@/ui/buildings/courierguild` computes to project a payload against remaining capacity, reused here so a shop legality check isn't guessing at what's aboard. */
function vehicleCargoTotals(vehicle: VehicleState): { weightLb: number; spaces: number } {
  return vehicle.cargo.reduce(
    (acc, cargo) => ({ weightLb: acc.weightLb + cargo.weightLb, spaces: acc.spaces + cargo.spaces }),
    { weightLb: 0, spaces: 0 },
  );
}

function designWithWeaponAdded(vehicle: VehicleState, weaponId: string): VehicleDesign {
  const mounted: MountedWeapon = { weaponId, facing: firstAllowedFacing(weaponId), ammo: 0 };
  return { ...vehicle.design, weapons: [...vehicle.design.weapons, mounted] };
}

/**
 * Whether `weaponId` actually fits `vehicle` right now: `computeBuild` on the
 * design WITH the candidate weapon added (plus cargo already aboard, so a
 * loaded courier payload correctly eats into the same space/load budget a
 * weapon would) must land within spaces/load capacity. This is real
 * construction legality, not a fixed row-count guess — a van with room for
 * ten light weapons or two heavy ones is judged the same way the builder
 * itself would judge it.
 */
function canInstall(vehicle: VehicleState, weaponId: string): boolean {
  const cargo = vehicleCargoTotals(vehicle);
  const design = designWithWeaponAdded(vehicle, weaponId);
  const metrics = computeBuild({ ...design, cargoWeightLb: cargo.weightLb, cargoSpaces: cargo.spaces });
  return metrics.spacesUsed <= metrics.spacesTotal && metrics.weightTotal <= metrics.maxLoadLb;
}

function installWeapon(vehicle: VehicleState, weaponId: string): VehicleState {
  const def = getWeapon(weaponId);
  const facing = firstAllowedFacing(weaponId);
  const state: WeaponState = {
    weaponId,
    facing,
    ammo: 0,
    dp: def.maxDP,
    maxDP: def.maxDP,
    cooldownRemaining: 0,
    destroyed: false,
  };
  const mounted: MountedWeapon = { weaponId, facing, ammo: 0 };
  return {
    ...vehicle,
    weapons: [...vehicle.weapons, state],
    design: { ...vehicle.design, weapons: [...vehicle.design.weapons, mounted] },
  };
}

function refillCost(weapon: WeaponState): number {
  const def = getWeapon(weapon.weaponId);
  return Math.max(0, def.ammoCapacity - weapon.ammo) * def.ammoCost;
}

function refillWeapon(vehicle: VehicleState, index: number): VehicleState {
  const weapon = vehicle.weapons[index];
  if (weapon === undefined) return vehicle;
  const def = getWeapon(weapon.weaponId);
  return {
    ...vehicle,
    weapons: vehicle.weapons.map((w, i) => (i === index ? { ...w, ammo: def.ammoCapacity } : w)),
    // The design's own MountedWeapon.ammo feeds computeBuild's weaponCost
    // (ammo * def.ammoCost) — left stale, a refill would silently undercount
    // purchaseValue/currentValue by the price of the ammo just paid for,
    // the same class of desync `installWeapon` fixes for a fresh mount.
    design: {
      ...vehicle.design,
      weapons: vehicle.design.weapons.map((m, i) => (i === index ? { ...m, ammo: def.ammoCapacity } : m)),
    },
  };
}

export function weaponshopActions(state: WeaponshopState): MenuAction[] {
  const ctx = state.context;
  if (!facilityOpenNow(WEAPONSHOP_KIND, ctx)) return [closedAction(WEAPONSHOP_KIND)];

  const actions: MenuAction[] = [];
  const vehicle = ctx.vehicle;

  for (const def of allWeapons()) {
    const fits = vehicle !== null && canInstall(vehicle, def.id);
    const eligible = vehicle !== null && fits && canAfford(ctx, def.price);
    const reason =
      vehicle === null
        ? t('building.noVehicle')
        : !fits
          ? t('building.weaponshop.noRoom', { weapon: def.name })
          : insufficientFundsReason(def.price, ctx.driver.cash);
    actions.push({ id: `install-${def.id}`, label: t('building.weaponshop.install', { weapon: def.name, price: def.price }), eligible, reason });
  }

  if (vehicle !== null) {
    vehicle.weapons.forEach((weapon, index) => {
      if (weapon.destroyed) return;
      const def = getWeapon(weapon.weaponId);
      if (def.ammoCapacity <= 0 || weapon.ammo >= def.ammoCapacity) return;
      const price = refillCost(weapon);
      actions.push({
        id: `refill-${index}`,
        label: t('building.weaponshop.refill', { weapon: def.name, facing: weapon.facing, price }),
        eligible: canAfford(ctx, price),
        reason: insufficientFundsReason(price, ctx.driver.cash),
      });
    });
  }

  actions.push(leaveAction());
  return actions;
}

export const weaponshopEngine: BuildingEngine<WeaponshopState> = {
  actions: weaponshopActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    const ctx = state.context;
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (actionId === 'closed') return { state, exit: false };

    if (actionId.startsWith('install-')) {
      const weaponId = actionId.slice('install-'.length);
      const vehicle = ctx.vehicle;
      if (vehicle === null || !canInstall(vehicle, weaponId)) return { state, exit: false };
      const price = getWeapon(weaponId).price;
      if (!canAfford(ctx, price)) return { state, exit: false };
      const nextVehicle = installWeapon(vehicle, weaponId);
      const nextClock = advanceForTimeCost(ctx.clock, timeCostOf('weaponTransaction'));
      return {
        state: { context: { ...ctx, driver: { ...ctx.driver, cash: ctx.driver.cash - price }, vehicle: nextVehicle, clock: nextClock } },
        exit: false,
      };
    }

    if (actionId.startsWith('refill-')) {
      const index = Number.parseInt(actionId.slice('refill-'.length), 10);
      const vehicle = ctx.vehicle;
      const weapon = vehicle?.weapons[index];
      if (vehicle === null || vehicle === undefined || weapon === undefined) return { state, exit: false };
      const price = refillCost(weapon);
      if (!canAfford(ctx, price)) return { state, exit: false };
      const nextVehicle = refillWeapon(vehicle, index);
      const nextClock = advanceForTimeCost(ctx.clock, timeCostOf('weaponTransaction'));
      return {
        state: { context: { ...ctx, driver: { ...ctx.driver, cash: ctx.driver.cash - price }, vehicle: nextVehicle, clock: nextClock } },
        exit: false,
      };
    }

    return { state, exit: false };
  },
};
