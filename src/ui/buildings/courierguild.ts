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
 */
import { advanceForTimeCost, timeCostOf } from '@/sim/calendar';
import { accept, generateOffers, type CourierOffer, type CourierRefusalReason } from '@/sim/courier';
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
    const refusalId = refusalFor(ctx, ctx.vehicle, offer);
    actions.push({
      id: `accept-${offer.id}`,
      label: t('building.courier.accept', { cargo: offer.cargoName, city: cityName(offer.destinationCityId), pay: offer.pay, day: offer.dueDay }),
      eligible: refusalId === null,
      ...(refusalId === null ? {} : { reason: t(refusalId) }),
    });
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
    if (actionId === 'closed' || actionId === 'no-offers' || actionId.startsWith('route-info-')) return { state, exit: false };

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

    return { state, exit: false };
  },
};
