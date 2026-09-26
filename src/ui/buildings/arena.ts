/**
 * Arena interior: lists every event `@/sim/arena` defines
 * (`allArenaEvents()`), shows each one's eligibility via that module's own
 * `eligibilityFor` (never re-derived here), and on an eligible activation
 * calls `beginArenaMatch` — the ONE place that actually charges an entry fee
 * — then hands the resulting match state to the host's `onEnterArena`
 * callback, exactly the existing arena flow `@/app.ts`'s own `showArena`
 * already drives from a confirmed build. This module never simulates a
 * match itself.
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
import type { DriverState } from '@/sim/types';
import { t } from '@/ui/strings';
import { mountMenu, type MenuAction, type MountedMenu } from '@/ui/menu';
import { closedAction, facilityOpenNow, headerFor, LEAVE_ACTION_ID, leaveAction, type BuildingContext } from '@/ui/buildings/shared';

export const ARENA_KIND = 'arena';

function vehicleStatus(ctx: BuildingContext): ArenaVehicleStatus | null {
  return ctx.vehicle === null ? null : { design: ctx.vehicle.design, destroyed: ctx.vehicle.destroyed };
}

export function arenaActions(ctx: BuildingContext): MenuAction[] {
  if (!facilityOpenNow(ARENA_KIND, ctx)) return [closedAction(ARENA_KIND)];

  const status = vehicleStatus(ctx);
  const actions: MenuAction[] = allArenaEvents().map((event: ArenaEventDef) => {
    const reason = eligibilityFor(ctx.driver, status, event.id);
    return {
      id: `enter-${event.id}`,
      label: t('building.arena.enter', { event: event.name }),
      eligible: reason === null,
      ...(reason === null ? {} : { reason }),
    };
  });
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
