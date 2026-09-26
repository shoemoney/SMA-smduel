/**
 * Garage interior: recharge, repair (armor/plant/weapons/tires, one
 * `repairCar`-day per repair), store/retrieve the active car (storage
 * itself is free — the fee lands on retrieval, straight out of
 * economy.json's `storeCar`/`retrieveCar` prices, never re-derived here),
 * and mechanic lessons. Every price/day number comes from
 * `repairCost`/`applyService` (`@/sim/economy`) or `timeCostOf`
 * (`@/sim/calendar`) — nothing gameplay-relevant is a literal in this file.
 */
import { getBody, getPlant, getTire, getWeapon } from '@/data/rulesets';
import { advanceForTimeCost, timeCostOf } from '@/sim/calendar';
import { applyService, repairCost, type EconomyWorld } from '@/sim/economy';
import { FACINGS } from '@/sim/types';
import type { ServiceId, VehicleState } from '@/sim/types';
import { t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
import { applyInvestigateAction, questInvestigateRows } from '@/ui/journal';
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
  pricedLabel,
  servicePrice,
} from '@/ui/buildings/shared';

export const GARAGE_KIND = 'garage';

export interface GarageState {
  readonly context: BuildingContext;
}

export function createGarageState(context: BuildingContext): GarageState {
  return { context };
}

function economyWorldFor(ctx: BuildingContext): EconomyWorld {
  return { clock: ctx.clock, vehicle: ctx.vehicle, vehicleStored: ctx.vehicleStored };
}

function applyEconomyService(ctx: BuildingContext, serviceId: ServiceId): BuildingContext {
  const result = applyService(ctx.driver, economyWorldFor(ctx), serviceId, ctx.rng);
  // The corresponding action is only ever shown as eligible when this call
  // is known to succeed (affordable, vehicle present, right stored state) -
  // an ineligible activation never reaches here at all (@/ui/menu refuses
  // it before calling back). This fallback exists only so a caller can never
  // silently desync state from a defensive `ok:false` it should never hit.
  if (!result.ok) return ctx;
  return {
    ...ctx,
    driver: result.driver,
    clock: result.world.clock,
    vehicle: result.world.vehicle,
    vehicleStored: result.world.vehicleStored,
  };
}

// ---------------------------------------------------------------------------
// Repair rows — one per currently-damaged component, regenerated every render
// ---------------------------------------------------------------------------

/** UI-only position labels for the fixed 4-tuple `VehicleState.tireDP` — mirrors `@/ui/hud`'s own (unexported) `TIRE_LABELS`, not a priced/weighed ruleset value. */
const TIRE_POSITIONS = ['FL', 'FR', 'RL', 'RR'] as const;

export interface RepairChoice {
  readonly id: string;
  readonly label: string;
  readonly price: number;
  readonly apply: (vehicle: VehicleState) => VehicleState;
}

/** One choice per currently-damaged component on `vehicle` — the single source both `garageActions` (label + eligibility) and the engine's `activate` (price + mutation) read from, so a row's displayed price and its charged price can never drift apart. */
export function repairChoices(vehicle: VehicleState): RepairChoice[] {
  const out: RepairChoice[] = [];

  for (const facing of FACINGS) {
    const max = vehicle.design.armor[facing];
    const current = vehicle.armorDP[facing];
    if (max <= 0 || current >= max) continue;
    const body = getBody(vehicle.design.bodyId);
    const missing = max - current;
    const price = repairCost({ kind: 'armor', costPerPoint: body.armorCostPerPoint, pointsToRepair: missing });
    out.push({
      id: `repair-armor-${facing}`,
      label: t('building.garage.repairArmor', { facing, points: missing, price }),
      price,
      apply: (v) => ({ ...v, armorDP: { ...v.armorDP, [facing]: max } }),
    });
  }

  const plant = getPlant(vehicle.design.plantId);
  if (vehicle.plantDP < plant.maxDP) {
    const price = repairCost({ kind: 'component', originalCost: plant.price, currentDP: vehicle.plantDP, maxDP: plant.maxDP });
    out.push({
      id: 'repair-plant',
      label: t('building.garage.repairPlant', { price }),
      price,
      apply: (v) => ({ ...v, plantDP: plant.maxDP }),
    });
  }

  vehicle.weapons.forEach((weapon, index) => {
    if (weapon.dp >= weapon.maxDP) return;
    const def = getWeapon(weapon.weaponId);
    const price = repairCost({ kind: 'component', originalCost: def.price, currentDP: weapon.dp, maxDP: weapon.maxDP });
    out.push({
      id: `repair-weapon-${index}`,
      label: t('building.garage.repairWeapon', { weapon: def.name, facing: weapon.facing, price }),
      price,
      apply: (v) => ({
        ...v,
        weapons: v.weapons.map((w, i) => (i === index ? { ...w, dp: w.maxDP } : w)),
      }),
    });
  });

  const tire = getTire(vehicle.design.tireId);
  vehicle.tireDP.forEach((dp, index) => {
    if (dp >= tire.maxDP) return;
    const price = repairCost({ kind: 'tire', tireId: vehicle.design.tireId });
    const position = TIRE_POSITIONS[index] ?? `T${index + 1}`;
    out.push({
      id: `replace-tire-${index}`,
      label: t('building.garage.replaceTire', { position, price }),
      price,
      apply: (v) => {
        const nextTireDP = [...v.tireDP] as VehicleState['tireDP'];
        nextTireDP[index] = tire.maxDP;
        return { ...v, tireDP: nextTireDP };
      },
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function garageActions(state: GarageState): MenuAction[] {
  const ctx = state.context;
  if (!facilityOpenNow(GARAGE_KIND, ctx)) return [closedAction(GARAGE_KIND)];

  const actions: MenuAction[] = [];
  const vehicle = ctx.vehicle;

  const rechargePrice = servicePrice('batteryRecharge');
  actions.push({
    id: 'recharge',
    label: pricedLabel(t('building.garage.recharge.name'), rechargePrice),
    eligible: vehicle !== null && canAfford(ctx, rechargePrice),
    reason: vehicle === null ? t('building.noVehicle') : insufficientFundsReason(rechargePrice, ctx.driver.cash),
  });

  if (vehicle !== null) {
    for (const choice of repairChoices(vehicle)) {
      actions.push({
        id: choice.id,
        label: choice.label,
        eligible: canAfford(ctx, choice.price),
        reason: insufficientFundsReason(choice.price, ctx.driver.cash),
      });
    }
  }

  if (ctx.vehicleStored) {
    const price = servicePrice('retrieveCar');
    // vehicleStored should only ever be true while ctx.vehicle is non-null
    // (see BuildingContext's own doc comment; @/ui/buildings/salvage's
    // sell-car clears both together), but this row is the one place a stale
    // combination would otherwise render a price with nothing to charge it
    // against - checked directly rather than trusting the invariant.
    actions.push({
      id: 'retrieveCar',
      label: pricedLabel(t('building.garage.retrieveCar.name'), price),
      eligible: vehicle !== null && canAfford(ctx, price),
      reason: vehicle === null ? t('building.noVehicle') : insufficientFundsReason(price, ctx.driver.cash),
    });
  } else {
    actions.push({
      id: 'storeCar',
      label: t('building.garage.storeCar.name'),
      eligible: vehicle !== null,
      reason: t('building.noVehicle'),
    });
  }

  const lessonPrice = servicePrice('mechanicLesson');
  actions.push({
    id: 'mechanicLesson',
    label: t('building.pricedDays', { name: t('building.garage.lesson.name'), price: lessonPrice, days: timeCostOf('mechanicLesson') }),
    eligible: canAfford(ctx, lessonPrice),
    reason: insufficientFundsReason(lessonPrice, ctx.driver.cash),
  });

  actions.push(...questInvestigateRows(ctx, GARAGE_KIND, 'building.garage.quest.investigate'));

  actions.push(leaveAction());
  return actions;
}

export const garageEngine: BuildingEngine<GarageState> = {
  actions: garageActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    const ctx = state.context;

    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (actionId === 'closed') return { state, exit: false };

    if (actionId === 'recharge') {
      return { state: { context: applyEconomyService(ctx, 'batteryRecharge') }, exit: false };
    }
    if (actionId === 'storeCar') {
      return { state: { context: applyEconomyService(ctx, 'storeCar') }, exit: false };
    }
    if (actionId === 'retrieveCar') {
      return { state: { context: applyEconomyService(ctx, 'retrieveCar') }, exit: false };
    }
    if (actionId === 'mechanicLesson') {
      return { state: { context: applyEconomyService(ctx, 'mechanicLesson') }, exit: false };
    }
    if (actionId.startsWith('investigate-')) {
      return { state: { context: applyInvestigateAction(ctx, actionId) }, exit: false };
    }

    if (ctx.vehicle !== null) {
      const choice = repairChoices(ctx.vehicle).find((c) => c.id === actionId);
      if (choice !== undefined) {
        const price = choice.price;
        if (!canAfford(ctx, price)) return { state, exit: false };
        const repairedVehicle = choice.apply(ctx.vehicle);
        const nextClock = advanceForTimeCost(ctx.clock, timeCostOf('repairCar'));
        return {
          state: {
            context: { ...ctx, driver: { ...ctx.driver, cash: ctx.driver.cash - price }, vehicle: repairedVehicle, clock: nextClock },
          },
          exit: false,
        };
      }
    }

    return { state, exit: false };
  },
};
