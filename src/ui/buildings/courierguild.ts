/**
 * Courier guild interior: `couriers.json`'s `offersPerVisit` jobs for the
 * CURRENT city/day, each acceptable independently; accepting any number of
 * them in one visit spends only ONE `acceptCourierWork` day total when
 * `couriers.json`'s `multipleAcceptsShareOneDay` is true (charged again per
 * accept when it's false). Refusal reasons reuse strings.json's existing
 * `refusal.*` ids (already written for exactly this purpose — see
 * rulesets/classic/strings.json's `_note`).
 *
 * Offer generation, acceptance legality (space/load/payload-count/prestige/
 * vehicle-threat), and the pay/deadline/declared-value formula are NOT
 * reimplemented here — they live in exactly one place, `@/sim/courier`'s
 * `generateOffers`/`accept`, which this module calls directly. A prior
 * version of this file duplicated that math with its own weaker, ruleset-
 * literal-inventing formulas that drifted out of sync (wrong deadline unit,
 * a dead `multipleAcceptsShareOneDay` read, an offer-index id scheme that
 * collided across visits, and a too-strict danger filter that could return
 * zero offers instead of `@/sim/courier`'s documented fallback) — see git
 * history on this file for that incident.
 *
 * Offers are deterministic for a given (cityId, dayIndex): generated from
 * `ctx.rng.serialize().seedKey` (a pure snapshot read, never a draw, so
 * mounting/remounting this panel never perturbs `ctx.rng` for any other
 * system sharing it) rather than drawn live from `ctx.rng` at mount time —
 * walking out and back in, or reloading, reproduces the SAME offer list
 * instead of rerolling it. Offers already accepted this game
 * (`ctx.activeCourierJobs`) are filtered out of a freshly generated list, so
 * a same-day revisit shows only what's still available — a job can never be
 * accepted twice, the exact id-collision `@/sim/courier`'s own
 * `allocateCargoId` exists to guard against.
 *
 * `CargoState` (`@/sim/types`) has no field for a job's pay/deadline/
 * declared value — only weight/space/integrity — so accepting a job here
 * records the real `AcceptedJob` (offer + cargo id) on
 * `ctx.activeCourierJobs`, the one durable link back to that data;
 * `@/ui/buildings/bar`'s illicit sale reads it back out rather than
 * re-estimating the cargo's worth from its weight.
 *
 * Each offer also gets a "quick route" vs "safe route" preview
 * (`@/sim/world-map`'s `shortestPathByMiles`/`shortestPathByDanger`, this
 * module's one production caller): a genuine decision belongs here, BEFORE
 * accepting, because the two can diverge — a longer road can carry FEWER
 * expected encounters than the offer's own direct route (see that module's
 * own doc comment) — so a player weighing a dangerous job needs to see that
 * a safer alternative exists at all, not just the offer's flat `dangerLevel`
 * number.
 */
import { advanceForTimeCost, timeCostOf } from '@/sim/calendar';
import { accept, deliver, generateOffers, type AcceptedJob, type CourierOffer, type CourierRefusalReason } from '@/sim/courier';
import { FRESH_ROUTE_HISTORY, recordDelivery, type RouteEncounterHistory } from '@/sim/encounters';
import { shortestPathByDanger, shortestPathByMiles } from '@/sim/world-map';
import type { VehicleState } from '@/sim/types';
import { cityName, t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
import {
  type BuildingContext,
  type BuildingEngine,
  closedAction,
  couriersConfig,
  destinationCityOf,
  facilityOpenNow,
  headerFor,
  leaveAction,
  LEAVE_ACTION_ID,
  routesFrom,
} from '@/ui/buildings/shared';

export const COURIERGUILD_KIND = 'courierguild';

export interface CourierGuildState {
  readonly context: BuildingContext;
  readonly offers: readonly CourierOffer[];
  /** True once any offer has been accepted during THIS mount — gates the shared-one-day charge, the same "one action, repeatable, only the first spends the day" shape every other per-unit building service uses. */
  readonly daySpentThisVisit: boolean;
}

function offersFor(ctx: BuildingContext): CourierOffer[] {
  const seed = ctx.rng.serialize().seedKey;
  const generated = generateOffers(ctx.cityId, ctx.clock.dayIndex, seed, ctx.driver);
  const alreadyAccepted = new Set(ctx.activeCourierJobs.map((job) => job.offer.id));
  return generated.filter((offer) => !alreadyAccepted.has(offer.id));
}

export function createCourierGuildState(context: BuildingContext): CourierGuildState {
  return { context, offers: offersFor(context), daySpentThisVisit: false };
}

/** The strings.json id for `@/sim/courier`'s `CourierRefusalReason` — a compile-time-checked mapping (a typo here is a type error, not a `t()` runtime throw), since every reason that union can hold already has a matching `refusal.*` entry (strings.json's own coverage assertion — see `@/ui/strings`). */
type CourierRefusalStringId = `refusal.${CourierRefusalReason}`;

/** Null when `offer` can be accepted right now against `vehicle`'s CURRENT cargo; otherwise the refusal `@/sim/courier`'s own `accept` reports for a one-offer batch (the same check a real accept of just this offer would make). */
function refusalFor(ctx: BuildingContext, vehicle: VehicleState | null, offer: CourierOffer): CourierRefusalStringId | null {
  if (vehicle === null) return 'refusal.NO_ACTIVE_VEHICLE';
  const reason = accept([offer], ctx.driver, vehicle, ctx.clock).attempts[0]?.reason;
  return reason === undefined || reason === null ? null : `refusal.${reason}`;
}

/**
 * Every ACTIVE job this guild can actually hand off right now: standing in
 * its destination city, at this exact facility (`@/sim/courier`'s `deliver`
 * requires both — `docs/SPEC.md`'s "right city, wrong building is still
 * WRONG_LOCATION"), and still carrying its intact cargo (an id present in
 * `vehicle.cargo` with positive `integrity`; destroyed cargo is a FAILED
 * delivery, not a deliverable one, so it is left off this list entirely
 * rather than offered and refused).
 */
function deliverableJobsFor(ctx: BuildingContext, vehicle: VehicleState): AcceptedJob[] {
  return ctx.activeCourierJobs.filter((job) => {
    if (job.status !== 'ACTIVE') return false;
    if (job.offer.destinationCityId !== ctx.cityId) return false;
    if (job.offer.destinationFacility !== COURIERGUILD_KIND) return false;
    const cargoItem = vehicle.cargo.find((item) => item.id === job.cargoId);
    return cargoItem !== undefined && cargoItem.integrity > 0;
  });
}

/**
 * `ctx.routeHistory` with `routeId`'s `deliveriesCompleted` bumped by one
 * (`@/sim/encounters`'s `recordDelivery`) — the "roads get safer the more
 * you use them" mechanic (`encounters.json`'s `repopulation` block), which
 * otherwise never fires: nothing else in the codebase calls `recordDelivery`.
 * Never mutates `history`; a route with no prior entry starts from
 * `FRESH_ROUTE_HISTORY` (day-never-cleared, zero deliveries) same as
 * `@/app`'s own `nextRouteHistory` does for `recordRouteCleared`.
 */
function withRouteDelivery(history: ReadonlyMap<string, RouteEncounterHistory>, routeId: string): ReadonlyMap<string, RouteEncounterHistory> {
  const current = history.get(routeId) ?? FRESH_ROUTE_HISTORY;
  const next = new Map(history);
  next.set(routeId, recordDelivery(current));
  return next;
}

/**
 * The "quick route" / "safe route" preview pair for `offer`, straight from
 * `@/sim/world-map`'s own path-finders — never a second, hand-rolled
 * distance/danger estimate. Always exactly two rows (both path-finders
 * always resolve for a real offer destination, which `@/sim/courier`'s
 * `generateOffers` only ever draws from a city cities.json actually routes
 * to `ctx.cityId`), shown whether or not the two happen to agree on this
 * particular offer's destination.
 */
function routePreviewRowsFor(ctx: BuildingContext, offer: CourierOffer): MenuAction[] {
  const quick = shortestPathByMiles(ctx.cityId, offer.destinationCityId);
  const safe = shortestPathByDanger(ctx.cityId, offer.destinationCityId);
  const city = cityName(offer.destinationCityId);

  const quickLabel = t('building.courier.routeQuick', {
    city,
    miles: Math.round(quick.totalMiles),
    days: Math.ceil(quick.totalTravelDays),
  });
  const safeLabel = t('building.courier.routeSafe', {
    city,
    encounters: Math.round(safe.totalDanger * 10) / 10,
    days: Math.ceil(safe.totalTravelDays),
  });

  return [
    { id: `route-quick-${offer.id}`, label: quickLabel, eligible: false, reason: quickLabel },
    { id: `route-safe-${offer.id}`, label: safeLabel, eligible: false, reason: safeLabel },
  ];
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function courierGuildActions(state: CourierGuildState): MenuAction[] {
  const ctx = state.context;
  if (!facilityOpenNow(COURIERGUILD_KIND, ctx)) return [closedAction(COURIERGUILD_KIND)];

  const actions: MenuAction[] = [];

  for (const route of routesFrom(ctx.cityId)) {
    const destination = destinationCityOf(route, ctx.cityId);
    const label = t('building.courier.routeInfo', { city: cityName(destination), danger: route.danger });
    actions.push({ id: `route-info-${route.id}`, label, eligible: false, reason: label });
  }

  if (state.offers.length === 0) {
    actions.push({ id: 'no-offers', label: t('building.courier.noOffers'), eligible: false, reason: t('building.courier.noOffers') });
  }

  for (const offer of state.offers) {
    actions.push(...routePreviewRowsFor(ctx, offer));
    const refusalId = refusalFor(ctx, ctx.vehicle, offer);
    actions.push({
      id: `accept-${offer.id}`,
      label: t('building.courier.accept', { cargo: offer.cargoName, city: cityName(offer.destinationCityId), pay: offer.pay, day: offer.dueDay }),
      eligible: refusalId === null,
      ...(refusalId === null ? {} : { reason: t(refusalId) }),
    });
  }

  const vehicle = ctx.vehicle;
  if (vehicle !== null) {
    for (const job of deliverableJobsFor(ctx, vehicle)) {
      // Pure preview: @/sim/courier's deliver() rolls no randomness, so
      // calling it here for the row label and again for real on activation
      // is the SAME formula run twice, never a duplicated/drifting copy of
      // its late-decay math — the label always agrees with what activating
      // this exact row pays out.
      const preview = deliver(job, ctx.driver, vehicle, ctx.cityId, COURIERGUILD_KIND, ctx.clock);
      actions.push({
        id: `deliver-${job.cargoId}`,
        label: t('building.courier.deliver', { cargo: job.offer.cargoName, pay: preview.paidAmount }),
        eligible: true,
      });
    }
  }

  actions.push(leaveAction());
  return actions;
}

export const courierGuildEngine: BuildingEngine<CourierGuildState> = {
  actions: courierGuildActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    const ctx = state.context;
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (
      actionId === 'closed' ||
      actionId === 'no-offers' ||
      actionId.startsWith('route-info-') ||
      actionId.startsWith('route-quick-') ||
      actionId.startsWith('route-safe-')
    ) {
      return { state, exit: false };
    }

    if (actionId.startsWith('accept-')) {
      const offerId = actionId.slice('accept-'.length);
      const offer = state.offers.find((o) => o.id === offerId);
      const vehicle = ctx.vehicle;
      if (offer === undefined || vehicle === null) return { state, exit: false };

      const result = accept([offer], ctx.driver, vehicle, ctx.clock);
      if (result.acceptedJobs.length === 0 || result.vehicle === null) return { state, exit: false };

      // couriers.json's multipleAcceptsShareOneDay, read HERE (not inside
      // @/sim/courier's per-call accept()) because this UI issues one
      // accept() call per row activation rather than a single batch —
      // charging the day only on the visit's first success (when the flag
      // is true) reproduces exactly what one batched accept() of the same
      // offers would have charged; false charges every activation, same as
      // accept() would charge per job in a batch.
      const acceptDays = timeCostOf('acceptCourierWork');
      const chargeDay = !state.daySpentThisVisit || !couriersConfig().multipleAcceptsShareOneDay;
      const nextClock = chargeDay ? advanceForTimeCost(ctx.clock, acceptDays) : ctx.clock;

      return {
        state: {
          context: {
            ...ctx,
            vehicle: result.vehicle,
            clock: nextClock,
            activeCourierJobs: [...ctx.activeCourierJobs, ...result.acceptedJobs],
          },
          offers: state.offers.filter((o) => o.id !== offerId),
          daySpentThisVisit: true,
        },
        exit: false,
      };
    }

    if (actionId.startsWith('deliver-')) {
      const cargoId = actionId.slice('deliver-'.length);
      const vehicle = ctx.vehicle;
      if (vehicle === null) return { state, exit: false };

      const job = deliverableJobsFor(ctx, vehicle).find((candidate) => candidate.cargoId === cargoId);
      if (job === undefined) return { state, exit: false };

      // Same call the label above already previewed — pay/prestige/lateness
      // all flow through this one formula, never a second silently-full-pay
      // branch.
      const result = deliver(job, ctx.driver, vehicle, ctx.cityId, COURIERGUILD_KIND, ctx.clock);

      // `deliverableJobsFor` above already required job.status === 'ACTIVE',
      // ctx.cityId/COURIERGUILD_KIND to match the offer's destination, and
      // intact cargo aboard `vehicle` — the exact preconditions `deliver()`
      // needs to return WRONG_LOCATION or FAILED — so a row reaching this
      // handler always resolves ON_TIME or LATE. Still branching on the
      // real outcome (never a bare "we got this far, must be a delivery")
      // so a real cargo-loss race between the preview and this activation
      // can't falsely credit the route as well-travelled.
      const delivered = result.outcome === 'ON_TIME' || result.outcome === 'LATE';
      const routeHistory = delivered ? withRouteDelivery(ctx.routeHistory, job.offer.routeId) : ctx.routeHistory;

      return {
        state: {
          ...state,
          context: {
            ...ctx,
            driver: result.driver,
            vehicle: result.vehicle,
            // Delivered (or failed) — cleared from the active list entirely
            // rather than left behind with an updated status, so it can
            // never be selected, previewed or delivered again.
            activeCourierJobs: ctx.activeCourierJobs.filter((j) => j.cargoId !== cargoId),
            routeHistory,
          },
        },
        exit: false,
      };
    }

    return { state, exit: false };
  },
};
