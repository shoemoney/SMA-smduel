/**
 * Building-interior dispatcher: one numbered-menu panel per
 * cities.json `facilityKinds` entry (`mountFacility`), backed by the pure
 * `BuildingEngine<S>` cores in this directory's per-kind modules. Every
 * kind cities.json defines gets SOME real panel here — the five kinds with
 * no gameplay yet (hotel/federal/story/studio/petshop) get `@/ui/buildings/stub`
 * rather than being silently unhandled.
 */
import { hasFacilityKind } from '@/data/rulesets';
import { mountBuildingPanel, type BuildingContext, type MountedBuilding } from '@/ui/buildings/shared';
import { ARENA_KIND, mountArenaBuilding, type ArenaEntryResult } from '@/ui/buildings/arena';
import { ASSEMBLY_KIND, mountAssembly } from '@/ui/buildings/assembly';
import { BAR_KIND, barEngine, createBarState } from '@/ui/buildings/bar';
import { CASINO_KIND, casinoEngine, createCasinoState } from '@/ui/buildings/casino';
import { COURIERGUILD_KIND, courierGuildEngine, createCourierGuildState } from '@/ui/buildings/courierguild';
import { GARAGE_KIND, createGarageState, garageEngine } from '@/ui/buildings/garage';
import { MEDICAL_KIND, createMedicalState, medicalEngine } from '@/ui/buildings/medical';
import { SALVAGE_KIND, createSalvageState, salvageEngine } from '@/ui/buildings/salvage';
import { createStubState, stubEngine } from '@/ui/buildings/stub';
import { TRUCKSTOP_KIND, createTruckstopState, truckstopEngine } from '@/ui/buildings/truckstop';
import { WEAPONSHOP_KIND, createWeaponshopState, weaponshopEngine } from '@/ui/buildings/weaponshop';

export type { BuildingContext } from '@/ui/buildings/shared';
export type { ArenaEntryResult } from '@/ui/buildings/arena';

/** Every cities.json facilityKind that already has a real (non-stub) gameplay panel. */
const GENERIC_KINDS = new Set([
  GARAGE_KIND,
  WEAPONSHOP_KIND,
  SALVAGE_KIND,
  COURIERGUILD_KIND,
  MEDICAL_KIND,
  BAR_KIND,
  TRUCKSTOP_KIND,
  CASINO_KIND,
]);

export class UnknownFacilityKindError extends Error {
  override readonly name = 'UnknownFacilityKindError';
  constructor(readonly kind: string) {
    super(`"${kind}" is not one of cities.json's facilityKinds`);
  }
}

export interface MountFacilityOptions {
  readonly container: HTMLElement;
  readonly kind: string;
  readonly context: BuildingContext;
  /** Called once the panel hands control back to whatever screen owns the city (Leave, Escape, or a `busToAdjacentCity` that changes `cityId`). */
  readonly onExit: (context: BuildingContext) => void;
  /** Required when `kind === 'assembly'` — opens `@/ui/builder`'s existing constructor UI; this module never re-implements it. */
  readonly onOpenConstructor?: () => void;
  /** Required when `kind === 'arena'` — hands the started match to the host's existing arena screen (`@/app.ts`'s `showArena`); this module never simulates a match itself. */
  readonly onEnterArena?: (result: ArenaEntryResult) => void;
}

export interface MountedFacility {
  destroy(): void;
}

function wrap(mounted: MountedBuilding<unknown>): MountedFacility {
  return { destroy: () => mounted.destroy() };
}

/** Opens the numbered-menu panel for `options.kind` into `options.container` — the one entry point every screen that lets a driver walk into a building should call. Throws `UnknownFacilityKindError` for a kind cities.json doesn't define, same fail-fast contract `@/data/rulesets`'s own lookups already use. */
export function mountFacility(options: MountFacilityOptions): MountedFacility {
  const { kind, container, context, onExit } = options;
  if (!hasFacilityKind(kind)) throw new UnknownFacilityKindError(kind);

  if (kind === ASSEMBLY_KIND) {
    if (options.onOpenConstructor === undefined) {
      throw new Error('mountFacility: assembly requires onOpenConstructor');
    }
    return mountAssembly({ container, context, onOpenConstructor: options.onOpenConstructor, onExit: () => onExit(context) });
  }

  if (kind === ARENA_KIND) {
    if (options.onEnterArena === undefined) {
      throw new Error('mountFacility: arena requires onEnterArena');
    }
    return mountArenaBuilding({ container, context, onEnterArena: options.onEnterArena, onExit: () => onExit(context) });
  }

  if (GENERIC_KINDS.has(kind)) {
    switch (kind) {
      case GARAGE_KIND:
        return wrap(mountBuildingPanel({ container, initialState: createGarageState(context), engine: garageEngine, onExit: (s) => onExit(s.context) }));
      case WEAPONSHOP_KIND:
        return wrap(mountBuildingPanel({ container, initialState: createWeaponshopState(context), engine: weaponshopEngine, onExit: (s) => onExit(s.context) }));
      case SALVAGE_KIND:
        return wrap(mountBuildingPanel({ container, initialState: createSalvageState(context), engine: salvageEngine, onExit: (s) => onExit(s.context) }));
      case COURIERGUILD_KIND:
        return wrap(mountBuildingPanel({ container, initialState: createCourierGuildState(context), engine: courierGuildEngine, onExit: (s) => onExit(s.context) }));
      case MEDICAL_KIND:
        return wrap(mountBuildingPanel({ container, initialState: createMedicalState(context), engine: medicalEngine, onExit: (s) => onExit(s.context) }));
      case BAR_KIND:
        return wrap(mountBuildingPanel({ container, initialState: createBarState(context), engine: barEngine, onExit: (s) => onExit(s.context) }));
      case TRUCKSTOP_KIND:
        return wrap(mountBuildingPanel({ container, initialState: createTruckstopState(context), engine: truckstopEngine, onExit: (s) => onExit(s.context) }));
      case CASINO_KIND:
        return wrap(mountBuildingPanel({ container, initialState: createCasinoState(context), engine: casinoEngine, onExit: (s) => onExit(s.context) }));
      default:
        break;
    }
  }

  // Every remaining real facilityKind (hotel/federal/story/studio/petshop)
  // gets the stub panel — never an unhandled kind.
  return wrap(mountBuildingPanel({ container, initialState: createStubState(context, kind), engine: stubEngine, onExit: (s) => onExit(s.context) }));
}
