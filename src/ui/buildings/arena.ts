/**
 * Arena interior: lists every event `@/sim/arena` defines
 * (`allArenaEvents()`), shows each one's eligibility via that module's own
 * `eligibilityFor` (never re-derived here), and on an eligible activation
 * calls `beginArenaMatch` — the ONE place that actually charges an entry fee
 * — then hands the resulting match state to the host's `onEnterArena`
 * callback, exactly the existing arena flow `@/app.ts`'s own `showArena`
 * already drives from a confirmed build. This module never simulates a
 * match itself.
 *
 * Events whose `cadence.kind` is `'city-championship-cycle'` (currently just
 * `city-championship`) additionally gate on `@/sim/championship`'s calendar:
 * on any day that isn't this city's actual championship day
 * (`isChampionshipDay`), the row is shown ineligible with a "next one in N
 * day(s)" reason (`daysUntilChampionship`) instead of `eligibilityFor`'s
 * usual vehicle/value check, and for a city with no championship scheduled
 * at all (`daysUntilChampionship` returns `null`) the row is omitted
 * entirely rather than offered as a dead end. `@/ui/menu`'s `handleMenuKey`
 * never dispatches ACTIVATE for an `eligible: false` row, so this is
 * sufficient to stop the event from ever being entered off-schedule.
 *
 * A scheduled city-championship event also gets a standing, always-shown
 * `SCHEDULE_PREVIEW_COUNT`-deep preview of its own upcoming dates
 * (`@/sim/championship`'s `scheduleFor`), alongside the single "next one in
 * N days" reason above — a player planning a courier run INTO this city
 * ahead of time needs more than just the next date to plan around, the same
 * reason `@/ui/buildings/courierguild` previews a whole route rather than
 * just its next leg.
 */
import {
  allArenaEvents,
  beginArenaMatch,
  eligibilityFor,
  type ArenaEventDef,
  type ArenaEventId,
  type ArenaMatchState,
  type ArenaVehicleStatus,
} from '@/sim/arena';
import { daysUntilChampionship, isChampionshipDay, scheduleFor } from '@/sim/championship';
import type { DriverState } from '@/sim/types';
import { t } from '@/ui/strings';
import { mountMenu, type MenuAction, type MountedMenu } from '@/ui/menu';
import { closedAction, facilityOpenNow, headerFor, LEAVE_ACTION_ID, leaveAction, type BuildingContext } from '@/ui/buildings/shared';

export const ARENA_KIND = 'arena';

function vehicleStatus(ctx: BuildingContext): ArenaVehicleStatus | null {
  return ctx.vehicle === null ? null : { design: ctx.vehicle.design, destroyed: ctx.vehicle.destroyed };
}

/**
 * How many of a city-championship event's own upcoming dates the schedule
 * preview row below shows. A display-depth choice only — never a priced,
 * timed, or otherwise balance-affecting figure (nothing in cities.json's
 * `championships` table caps or suggests a preview depth), the same
 * "structural, not a ruleset value" footing `@/ui/buildings/garage`'s fixed
 * 4-slot `TIRE_LABELS` stands on.
 */
const SCHEDULE_PREVIEW_COUNT = 3;

/** The standing "upcoming dates" row for a scheduled city-championship event — shown alongside its entry row whether or not today IS the championship day, so a player can plan a courier run toward a FUTURE date, not just see how many days until the next one. */
function scheduleAction(ctx: BuildingContext, event: ArenaEventDef): MenuAction {
  const days = scheduleFor(ctx.cityId, ctx.clock.dayIndex, SCHEDULE_PREVIEW_COUNT);
  const label = t('building.arena.championshipSchedule', { event: event.name, days: days.join(', ') });
  return { id: `schedule-${event.id}`, label, eligible: false, reason: label };
}

/** The row(s) for `event`, or none at all for a championship-cadence event this city never schedules. */
function actionFor(ctx: BuildingContext, status: ArenaVehicleStatus | null, event: ArenaEventDef): MenuAction[] {
  const label = t('building.arena.enter', { event: event.name });
  if (event.cadence.kind === 'city-championship-cycle') {
    const daysUntil = daysUntilChampionship(ctx.cityId, ctx.clock.dayIndex);
    if (daysUntil === null) return [];
    const schedule = scheduleAction(ctx, event);
    if (!isChampionshipDay(ctx.cityId, ctx.clock.dayIndex)) {
      return [
        {
          id: `enter-${event.id}`,
          label,
          eligible: false,
          reason: t('building.arena.championshipUpcoming', { event: event.name, days: daysUntil }),
        },
        schedule,
      ];
    }
    const reason = eligibilityFor(ctx.driver, status, event.id);
    return [{ id: `enter-${event.id}`, label, eligible: reason === null, ...(reason === null ? {} : { reason }) }, schedule];
  }
  const reason = eligibilityFor(ctx.driver, status, event.id);
  return [{ id: `enter-${event.id}`, label, eligible: reason === null, ...(reason === null ? {} : { reason }) }];
}

export function arenaActions(ctx: BuildingContext): MenuAction[] {
  if (!facilityOpenNow(ARENA_KIND, ctx)) return [closedAction(ARENA_KIND)];

  const status = vehicleStatus(ctx);
  const actions: MenuAction[] = allArenaEvents().flatMap((event: ArenaEventDef) => actionFor(ctx, status, event));
  actions.push(leaveAction());
  return actions;
}

export interface ArenaEntryResult {
  readonly driver: DriverState;
  readonly matchState: ArenaMatchState;
}

export interface MountArenaOptions {
  readonly container: HTMLElement;
  readonly context: BuildingContext;
  readonly onEnterArena: (result: ArenaEntryResult) => void;
  readonly onExit: () => void;
}

export interface MountedArenaBuilding {
  destroy(): void;
}

/** Mounted directly against `@/ui/menu` — like `@/ui/buildings/assembly`, "enter this event" is a third control-flow outcome beyond `mountBuildingPanel`'s plain exit/continue pair, and match state belongs to the host's arena screen, not this panel. */
export function mountArenaBuilding(options: MountArenaOptions): MountedArenaBuilding {
  let ctx = options.context;
  let mounted: MountedMenu | undefined;

  function render(): void {
    mounted?.setHeader(headerFor(ctx));
    mounted?.setActions(arenaActions(ctx));
  }

  mounted = mountMenu({
    container: options.container,
    header: headerFor(ctx),
    actions: arenaActions(ctx),
    onActivate: (id) => {
      if (id === LEAVE_ACTION_ID) {
        options.onExit();
        return;
      }
      if (!id.startsWith('enter-')) return;
      const eventId = id.slice('enter-'.length) as ArenaEventId;
      const result = beginArenaMatch(ctx.driver, vehicleStatus(ctx), eventId);
      if (!result.ok) {
        render();
        return;
      }
      ctx = { ...ctx, driver: result.driver };
      options.onEnterArena({ driver: result.driver, matchState: result.state });
    },
    onBack: () => options.onExit(),
  });

  return { destroy: () => mounted?.destroy() };
}
