/**
 * Truck stop interior: bus to any directly-connected city (cities.json's
 * route graph), one rumor per location per day, battery recharge, a room
 * for the night (repeat the action for N nights — the same "repeat a
 * per-unit service" shape `@/sim/economy`'s `applyService` already gives
 * every other per-unit purchase), and body armor. Truck stops are one of
 * economy.json's `alwaysOpenFacilities`, so `facilityOpenNow` never closes
 * this panel — it's checked anyway so a future ruleset edit is honored
 * automatically instead of silently ignored.
 */
import { applyService, type EconomyWorld } from '@/sim/economy';
import type { ServiceId } from '@/sim/types';
import { cityName, t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
import {
  type BuildingContext,
  type BuildingEngine,
  canAfford,
  closedAction,
  destinationCityOf,
  facilityOpenNow,
  headerFor,
  insufficientFundsReason,
  leaveAction,
  LEAVE_ACTION_ID,
  pickRumorId,
  pricedLabel,
  routesFrom,
  servicePrice,
} from '@/ui/buildings/shared';

export const TRUCKSTOP_KIND = 'truckstop';

export interface TruckstopState {
  readonly context: BuildingContext;
}

export function createTruckstopState(context: BuildingContext): TruckstopState {
  return { context };
}

function economyWorldFor(ctx: BuildingContext): EconomyWorld {
  return { clock: ctx.clock, vehicle: ctx.vehicle, vehicleStored: ctx.vehicleStored };
}

function applyEconomyService(ctx: BuildingContext, serviceId: ServiceId, destinationCityId?: string): BuildingContext {
  const result = applyService(ctx.driver, economyWorldFor(ctx), serviceId, ctx.rng, destinationCityId);
  if (!result.ok) return ctx;
  const next: BuildingContext = {
    ...ctx,
    driver: result.driver,
    clock: result.world.clock,
    vehicle: result.world.vehicle,
    vehicleStored: result.world.vehicleStored,
  };
  return destinationCityId !== undefined ? { ...next, cityId: destinationCityId } : next;
}

export function truckstopActions(state: TruckstopState): MenuAction[] {
  const ctx = state.context;
  if (!facilityOpenNow(TRUCKSTOP_KIND, ctx)) return [closedAction(TRUCKSTOP_KIND)];

  const actions: MenuAction[] = [];
  const busPrice = servicePrice('busToAdjacentCity');
  for (const route of routesFrom(ctx.cityId)) {
    const destination = destinationCityOf(route, ctx.cityId);
    actions.push({
      id: `bus-${destination}`,
      label: t('building.truckstop.bus', { city: cityName(destination), price: busPrice }),
      eligible: canAfford(ctx, busPrice),
      reason: insufficientFundsReason(busPrice, ctx.driver.cash),
    });
  }

  const heardRumorId = ctx.rumorsHeardToday.get(TRUCKSTOP_KIND);
  actions.push({
    id: 'rumor',
    label: t('building.truckstop.rumor.name'),
    eligible: heardRumorId === undefined,
    ...(heardRumorId === undefined ? {} : { reason: t(heardRumorId) }),
  });

  const rechargePrice = servicePrice('batteryRecharge');
  actions.push({
    id: 'recharge',
    label: pricedLabel(t('building.truckstop.recharge.name'), rechargePrice),
    eligible: ctx.vehicle !== null && canAfford(ctx, rechargePrice),
    reason: ctx.vehicle === null ? t('building.noVehicle') : insufficientFundsReason(rechargePrice, ctx.driver.cash),
  });

  const roomPrice = servicePrice('truckStopRoomNight');
  actions.push({
    id: 'room',
    label: pricedLabel(t('building.truckstop.room.name'), roomPrice),
    eligible: canAfford(ctx, roomPrice),
    reason: insufficientFundsReason(roomPrice, ctx.driver.cash),
  });

  const armorPrice = servicePrice('bodyArmor');
  actions.push({
    id: 'bodyArmor',
    label: pricedLabel(t('building.truckstop.armor.name'), armorPrice),
    eligible: canAfford(ctx, armorPrice),
    reason: insufficientFundsReason(armorPrice, ctx.driver.cash),
  });

  actions.push(leaveAction());
  return actions;
}

export const truckstopEngine: BuildingEngine<TruckstopState> = {
  actions: truckstopActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    const ctx = state.context;
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (actionId === 'closed') return { state, exit: false };

    if (actionId.startsWith('bus-')) {
      const destinationCityId = actionId.slice('bus-'.length);
      return { state: { context: applyEconomyService(ctx, 'busToAdjacentCity', destinationCityId) }, exit: true };
    }
    if (actionId === 'rumor') {
      if (ctx.rumorsHeardToday.has(TRUCKSTOP_KIND)) return { state, exit: false };
      const rumorId = pickRumorId(ctx.rng);
      const nextHeard = new Map(ctx.rumorsHeardToday);
      nextHeard.set(TRUCKSTOP_KIND, rumorId);
      return { state: { context: { ...ctx, rumorsHeardToday: nextHeard } }, exit: false };
    }
    if (actionId === 'recharge') return { state: { context: applyEconomyService(ctx, 'batteryRecharge') }, exit: false };
    if (actionId === 'room') return { state: { context: applyEconomyService(ctx, 'truckStopRoomNight') }, exit: false };
    if (actionId === 'bodyArmor') return { state: { context: applyEconomyService(ctx, 'bodyArmor') }, exit: false };

    return { state, exit: false };
  },
};
