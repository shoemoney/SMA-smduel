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
import {
  pursuitLevelFromQuestState,
  resolveRestAssassinationCombat,
  rollRestAssassinationAttempt,
  type RestAssassinationAttempt,
} from '@/sim/pursuit';
import { cityName, t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
import { applyInvestigateAction, questInvestigateRows } from '@/ui/journal';
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
  /**
   * The rest-time assassination roll (`@/sim/pursuit`'s
   * `rollRestAssassinationAttempt`) from the most recent 'room' action this
   * visit — `null` before the first room this visit, and always `null` for
   * a driver `pursuitLevelFromQuestState` reads as unmarked (0). Surfaced so
   * a marked driver actually sees whether resting drew hostile attention,
   * same shape `@/ui/buildings/bar`'s `lastIllicitSaleConsequence` already
   * uses for a different building's own probabilistic rest-of-visit report.
   */
  readonly lastRestAssassinationAttempt: RestAssassinationAttempt | null;
}

export function createTruckstopState(context: BuildingContext): TruckstopState {
  return { context, lastRestAssassinationAttempt: null };
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

  actions.push(...questInvestigateRows(ctx, TRUCKSTOP_KIND, 'building.truckstop.quest.investigate'));

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

  const attempt = state.lastRestAssassinationAttempt;
  if (attempt !== null) {
    const label = attempt.triggered
      ? t('building.truckstop.restAttempt.triggered', { count: attempt.contacts.length })
      : t('building.truckstop.restAttempt.clean');
    actions.push({ id: 'last-rest-assassination-attempt', label, eligible: false, reason: label });
  }

  actions.push(leaveAction());
  return actions;
}

export const truckstopEngine: BuildingEngine<TruckstopState> = {
  actions: truckstopActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    const ctx = state.context;
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (actionId === 'closed' || actionId === 'last-rest-assassination-attempt') return { state, exit: false };

    if (actionId.startsWith('bus-')) {
      const destinationCityId = actionId.slice('bus-'.length);
      return { state: { ...state, context: applyEconomyService(ctx, 'busToAdjacentCity', destinationCityId) }, exit: true };
    }
    if (actionId === 'rumor') {
      // No "already heard today" guard here: the row's own eligibility
      // above (`heardRumorId === undefined`) already refuses activation
      // for this exact id the moment `ctx.rumorsHeardToday.has(TRUCKSTOP_KIND)`
      // is true - `@/ui/menu`'s `activate` never fires an ineligible
      // action's id at all (menu.ts's local `activate`, both from a click
      // and from the digit-key shortcut), and this engine's `activate` has
      // exactly one caller (`mountBuildingPanel`'s `onActivate`), reached
      // only through that same gate. A second guard here was unreachable
      // (see `@/ui/buildings/bar`'s identical fix for the same defect).
      const rumorId = pickRumorId(ctx.rng);
      const nextHeard = new Map(ctx.rumorsHeardToday);
      nextHeard.set(TRUCKSTOP_KIND, rumorId);
      return { state: { ...state, context: { ...ctx, rumorsHeardToday: nextHeard } }, exit: false };
    }
    if (actionId.startsWith('investigate-')) {
      return { state: { ...state, context: applyInvestigateAction(ctx, actionId) }, exit: false };
    }

    if (actionId === 'recharge') return { state: { ...state, context: applyEconomyService(ctx, 'batteryRecharge') }, exit: false };
    if (actionId === 'room') {
      const nextContext = applyEconomyService(ctx, 'truckStopRoomNight');
      // A room only actually spends a night when applyEconomyService's own
      // affordability check passed (see its `!result.ok` early return) — a
      // rejected purchase must never roll the assassination attempt either,
      // same as it never advances the clock. Compare contexts rather than
      // re-deriving canAfford here, so this stays correct against whatever
      // applyEconomyService's own rules are, not a second copy of them.
      if (nextContext === ctx) return { state: { ...state, context: nextContext }, exit: false };

      const pursuitLevel = pursuitLevelFromQuestState(ctx.quests ?? []);
      if (pursuitLevel <= 0) {
        return { state: { context: nextContext, lastRestAssassinationAttempt: null }, exit: false };
      }

      const seedKey = ctx.rng.serialize().seedKey;
      const attempt = rollRestAssassinationAttempt(seedKey, ctx.clock.dayIndex, ctx.cityId, pursuitLevel);
      // Only a TRIGGERED attempt actually fires — an untriggered roll's
      // `contacts` is always `[]` (see `NO_ATTEMPT`), so this would be a
      // no-op combat resolution anyway, but skipping it also skips
      // consuming `resolveRestAssassinationCombat`'s own RNG stream on a
      // night nobody showed up.
      const resolved = attempt.triggered
        ? resolveRestAssassinationCombat(seedKey, ctx.clock.dayIndex, ctx.cityId, attempt.contacts, nextContext.driver, nextContext.vehicle)
        : null;
      const finalContext =
        resolved === null ? nextContext : { ...nextContext, driver: resolved.driver, vehicle: resolved.vehicle };
      return { state: { context: finalContext, lastRestAssassinationAttempt: attempt }, exit: false };
    }
    if (actionId === 'bodyArmor') return { state: { ...state, context: applyEconomyService(ctx, 'bodyArmor') }, exit: false };

    return { state, exit: false };
  },
};
