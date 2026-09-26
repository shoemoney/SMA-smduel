/**
 * Assembly plant interior: a thin gate in front of the existing constructor
 * UI (`@/ui/builder`'s `mountBuilder`) — this module never re-implements
 * vehicle construction itself, it only decides whether the driver's fleet
 * has room (economy.json's `maxFleetSize`, the same cap `@/ui/builder`'s own
 * `computeViolations` enforces at confirm time) and hands control to the
 * host's `onOpenConstructor` callback when it does.
 */
import { economy } from '@/data/rulesets';
import { t } from '@/ui/strings';
import { mountMenu, type MenuAction, type MountedMenu } from '@/ui/menu';
import { closedAction, facilityOpenNow, headerFor, LEAVE_ACTION_ID, leaveAction, type BuildingContext } from '@/ui/buildings/shared';

export const ASSEMBLY_KIND = 'assembly';

export function fleetHasRoom(ctx: BuildingContext): boolean {
  return ctx.fleetSize < economy().maxFleetSize;
}

export function assemblyActions(ctx: BuildingContext): MenuAction[] {
  if (!facilityOpenNow(ASSEMBLY_KIND, ctx)) return [closedAction(ASSEMBLY_KIND)];

  const hasRoom = fleetHasRoom(ctx);
  const max = economy().maxFleetSize;
  return [
    {
      id: 'build',
      label: t('building.assembly.build.name'),
      eligible: hasRoom,
      reason: t('building.assembly.fleetFull', { count: ctx.fleetSize, max }),
    },
    leaveAction(),
  ];
}

export interface MountAssemblyOptions {
  readonly container: HTMLElement;
  readonly context: BuildingContext;
  readonly onOpenConstructor: () => void;
  readonly onExit: () => void;
}

export interface MountedAssembly {
  destroy(): void;
}

/** Mounted directly against `@/ui/menu` (rather than the generic `mountBuildingPanel`) because this panel's one meaningful outcome — "open the real constructor" — is a THIRD control-flow branch beyond that helper's plain exit/continue pair. */
export function mountAssembly(options: MountAssemblyOptions): MountedAssembly {
  const mounted: MountedMenu = mountMenu({
    container: options.container,
    header: headerFor(options.context),
    actions: assemblyActions(options.context),
    onActivate: (id) => {
      if (id === 'build' && fleetHasRoom(options.context)) {
        options.onOpenConstructor();
        return;
      }
      if (id === LEAVE_ACTION_ID) {
        options.onExit();
        return;
      }
    },
    onBack: () => options.onExit(),
  });
  return { destroy: () => mounted.destroy() };
}
