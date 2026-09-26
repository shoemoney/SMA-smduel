/**
 * Bar interior: buy a drink, listen for a rumor (one per location per day,
 * same shared mechanism `@/ui/buildings/truckstop` uses), sell a carried
 * payload illicitly, or sell salvage cargo here instead of at the yard for a
 * worse rate.
 *
 * A courier payload's illicit sale prices off the REAL offer it came from —
 * `@/sim/courier`'s `sellIllicit`, applied to the `AcceptedJob`
 * `@/ui/buildings/courierguild` recorded on `ctx.activeCourierJobs` when the
 * job was accepted — instead of an invented weight-based estimate. `Math.round
 * (declaredValue * illicitSale.valueFraction)` is `sellIllicit`'s own
 * formula, which also rolls `illicitSale.lawConsequenceChance` (on the
 * seeded `BuildingContext.rng`) and reports it back via `lastIllicitSale` -
 * genuinely rolled and reported now, not just claimed. A payload with no
 * traceable job record (shouldn't happen: every payload in the current game
 * is created by courierguild's own `accept()` in the same transaction that
 * writes the job) falls back to the old weight-based estimate rather than
 * becoming an unsellable dead row - see `illicitPayloadValue`.
 *
 * Salvage's "poorly" rate reuses `illicitSale.valueFraction` against the
 * salvage yard's own valuation (`cargoOriginalCostEstimate` /
 * `salvageCargoSaleValue`'s basis) as the worse rate rather than inventing a
 * second fraction — the only "sell cargo for less than it's worth" number
 * any ruleset table publishes, and salvage cargo (unlike a courier payload)
 * has no better-sourced value anywhere in the game.
 */
import { sellIllicit, type AcceptedJob } from '@/sim/courier';
import { applyService, saleValue, type EconomyWorld } from '@/sim/economy';
import { losePrestige } from '@/sim/driver';
import type { CargoState, ServiceId, VehicleState } from '@/sim/types';
import { t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
import { applyInvestigateAction, questInvestigateRows } from '@/ui/journal';
import {
  cargoConditionFraction,
  cargoOriginalCostEstimate,
  closedAction,
  couriersConfig,
  facilityOpenNow,
  headerFor,
  leaveAction,
  LEAVE_ACTION_ID,
  pickRumorId,
  pricedLabel,
  servicePrice,
  type BuildingContext,
  type BuildingEngine,
} from '@/ui/buildings/shared';

export const BAR_KIND = 'bar';

export interface BarState {
  readonly context: BuildingContext;
  /** Set after an illicit sale (courier payload) reports whether the law noticed — null before the first sale this visit. */
  readonly lastIllicitSaleConsequence: boolean | null;
}

export function createBarState(context: BuildingContext): BarState {
  return { context, lastIllicitSaleConsequence: null };
}

/** The ACTIVE job backing `cargoId` on `ctx.activeCourierJobs`, or undefined if none is on record (see module header). */
function activeJobFor(ctx: BuildingContext, cargoId: string): AcceptedJob | undefined {
  return ctx.activeCourierJobs.find((job) => job.cargoId === cargoId && job.status === 'ACTIVE');
}

function economyWorldFor(ctx: BuildingContext): EconomyWorld {
  return { clock: ctx.clock, vehicle: ctx.vehicle, vehicleStored: ctx.vehicleStored };
}

function applyEconomyService(ctx: BuildingContext, serviceId: ServiceId): BuildingContext {
  const result = applyService(ctx.driver, economyWorldFor(ctx), serviceId, ctx.rng);
  if (!result.ok) return ctx;
  return { ...ctx, driver: result.driver, clock: result.world.clock, vehicle: result.world.vehicle, vehicleStored: result.world.vehicleStored };
}

/**
 * Preview price for selling `cargo` illicitly, shown on the menu row BEFORE
 * activation — must never roll `ctx.rng` (menu rows are recomputed on every
 * render; a draw here would consume randomness `sellIllicit` is meant to be
 * the only thing that rolls). When `cargo`'s real job is on record, this is
 * exactly `sellIllicit`'s own `round(declaredValue * valueFraction)`
 * (mirrored here rather than called, since `sellIllicit` also rolls the law
 * check as a side effect); the actual sale in `activate` calls the real
 * `sellIllicit` and always agrees with this preview.
 */
export function illicitPayloadValue(ctx: BuildingContext, cargo: CargoState): number {
  const job = activeJobFor(ctx, cargo.id);
  if (job !== undefined) {
    return Math.max(0, Math.round(job.offer.declaredValue * couriersConfig().illicitSale.valueFraction));
  }
  return Math.floor(cargoOriginalCostEstimate(cargo) * couriersConfig().illicitSale.valueFraction);
}

export function poorSalvageValue(cargo: CargoState): number {
  const fullPrice = saleValue(cargoOriginalCostEstimate(cargo), cargoConditionFraction(cargo));
  return Math.floor(fullPrice * couriersConfig().illicitSale.valueFraction);
}

export function barActions(state: BarState): MenuAction[] {
  const ctx = state.context;
  if (!facilityOpenNow(BAR_KIND, ctx)) return [closedAction(BAR_KIND)];

  const actions: MenuAction[] = [];

  const drinkPrice = servicePrice('drink');
  actions.push({
    id: 'drink',
    label: pricedLabel(t('building.bar.drink.name'), drinkPrice),
    eligible: ctx.driver.cash >= drinkPrice,
    reason: t('building.insufficientFunds', { price: drinkPrice, cash: ctx.driver.cash }),
  });

  const heardRumorId = ctx.rumorsHeardToday.get(BAR_KIND);
  actions.push({
    id: 'rumor',
    label: t('building.bar.rumor.name'),
    eligible: heardRumorId === undefined,
    ...(heardRumorId === undefined ? {} : { reason: t(heardRumorId) }),
  });

  actions.push(...questInvestigateRows(ctx, BAR_KIND, 'building.bar.quest.investigate'));

  const vehicle = ctx.vehicle;
  const payloads = vehicle?.cargo.filter((c) => c.kind === 'payload') ?? [];
  if (payloads.length === 0) {
    actions.push({ id: 'no-payload', label: t('building.bar.sellIllicit.name'), eligible: false, reason: t('building.bar.noPayload') });
  } else {
    for (const cargo of payloads) {
      const price = illicitPayloadValue(ctx, cargo);
      actions.push({ id: `sell-illicit-${cargo.id}`, label: t('building.bar.sellIllicit', { price }), eligible: true });
    }
  }

  const salvageItems = vehicle?.cargo.filter((c) => c.kind === 'salvage') ?? [];
  if (salvageItems.length === 0) {
    actions.push({ id: 'no-salvage', label: t('building.bar.sellSalvagePoorly.name'), eligible: false, reason: t('building.bar.noSalvage') });
  } else {
    for (const cargo of salvageItems) {
      const price = poorSalvageValue(cargo);
      actions.push({ id: `sell-poorly-${cargo.id}`, label: t('building.bar.sellSalvagePoorly', { price }), eligible: true });
    }
  }

  if (state.lastIllicitSaleConsequence !== null) {
    const label = t(state.lastIllicitSaleConsequence ? 'building.bar.illicitSale.consequence' : 'building.bar.illicitSale.clean');
    actions.push({ id: 'last-illicit-sale', label, eligible: false, reason: label });
  }

  actions.push(leaveAction());
  return actions;
}

export const barEngine: BuildingEngine<BarState> = {
  actions: barActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    const ctx = state.context;
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (actionId === 'closed' || actionId === 'no-payload' || actionId === 'no-salvage' || actionId === 'last-illicit-sale') {
      return { state, exit: false };
    }

    if (actionId === 'drink') {
      return { state: { ...state, context: applyEconomyService(ctx, 'drink') }, exit: false };
    }

    if (actionId === 'rumor') {
      // No "already heard today" guard here: the row's own eligibility
      // above (`heardRumorId === undefined`) already refuses activation
      // for this exact id the moment `ctx.rumorsHeardToday.has(BAR_KIND)`
      // is true - `@/ui/menu`'s `activate` never fires an ineligible
      // action's id at all (menu.ts's local `activate`, both from a click
      // and from the digit-key shortcut), and this engine's `activate` has
      // exactly one caller (`mountBuildingPanel`'s `onActivate`), reached
      // only through that same gate. A second guard here was unreachable.
      const rumorId = pickRumorId(ctx.rng);
      const nextHeard = new Map(ctx.rumorsHeardToday);
      nextHeard.set(BAR_KIND, rumorId);
      return { state: { ...state, context: { ...ctx, rumorsHeardToday: nextHeard } }, exit: false };
    }

    if (actionId.startsWith('investigate-')) {
      return { state: { ...state, context: applyInvestigateAction(ctx, actionId) }, exit: false };
    }

    const vehicle = ctx.vehicle;
    if (vehicle === null) return { state, exit: false };

    if (actionId.startsWith('sell-illicit-')) {
      const cargoId = actionId.slice('sell-illicit-'.length);
      const cargo = vehicle.cargo.find((c) => c.id === cargoId);
      if (cargo === undefined) return { state, exit: false };

      const job = activeJobFor(ctx, cargoId);
      if (job !== undefined) {
        // The real thing, not the preview: rolls illicitSale.lawConsequenceChance
        // on ctx.rng (see module header - genuinely rolled and reported now).
        const result = sellIllicit(job, ctx.driver, vehicle, ctx.rng);
        const nextJobs = ctx.activeCourierJobs.map((j) => (j.cargoId === cargoId && j.status === 'ACTIVE' ? result.job : j));
        return {
          state: {
            context: { ...ctx, driver: result.driver, vehicle: result.vehicle, activeCourierJobs: nextJobs },
            lastIllicitSaleConsequence: result.lawConsequenceTriggered,
          },
          exit: false,
        };
      }

      // No traceable job record (see illicitPayloadValue's doc comment) -
      // old estimate-based behaviour, no law-consequence roll/report.
      const price = illicitPayloadValue(ctx, cargo);
      const nextVehicle: VehicleState = { ...vehicle, cargo: vehicle.cargo.filter((c) => c.id !== cargoId) };
      const nextDriver = losePrestige({ ...ctx.driver, cash: ctx.driver.cash + price }, couriersConfig().illicitSale.prestigePenalty);
      return { state: { ...state, context: { ...ctx, driver: nextDriver, vehicle: nextVehicle } }, exit: false };
    }

    if (actionId.startsWith('sell-poorly-')) {
      const cargoId = actionId.slice('sell-poorly-'.length);
      const cargo = vehicle.cargo.find((c) => c.id === cargoId);
      if (cargo === undefined) return { state, exit: false };
      const price = poorSalvageValue(cargo);
      const nextVehicle: VehicleState = { ...vehicle, cargo: vehicle.cargo.filter((c) => c.id !== cargoId) };
      return {
        state: { ...state, context: { ...ctx, driver: { ...ctx.driver, cash: ctx.driver.cash + price }, vehicle: nextVehicle } },
        exit: false,
      };
    }

    return { state, exit: false };
  },
};
