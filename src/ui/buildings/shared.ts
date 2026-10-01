/**
 * Shared plumbing for every building-interior panel (`@/ui/buildings/*`):
 * the context a panel reads/writes, the generic numbered-menu mount that
 * wraps `@/ui/menu`'s reusable widget, and a handful of formatting/valuation
 * helpers more than one facility needs (so e.g. "how much is this abstract
 * salvage cargo worth" is answered in exactly one place, not re-derived per
 * building).
 *
 * Every panel is a pure `{ actions, header, activate }` reducer
 * (`BuildingEngine<S>`) mounted through `mountBuildingPanel`, mirroring
 * `@/ui/builder`'s split between a DOM-free core and a thin DOM layer: the
 * core is what tests drive directly, `mountBuildingPanel` is what wires it
 * to real keyboard events via `@/ui/menu`'s already-tested reducer.
 */
import {
  createMenu,
  handleMenuKey,
  mountMenu,
  setMenuActions,
  type MenuAction,
  type MenuHeaderInfo,
  type MenuState,
  type MountedMenu,
} from '@/ui/menu';
import { isFacilityOpen } from '@/sim/calendar';
import type { Clock } from '@/sim/calendar';
import { allWeapons, economy, hasWeapon, getWeapon } from '@/data/rulesets';
import { cityName, facilityName, t } from '@/ui/strings';
import type { CargoState, DriverState, ServiceId, VehicleState } from '@/sim/types';
import type { AcceptedJob } from '@/sim/courier';
import type { QuestState } from '@/persist/save';
import type { RouteEncounterHistory } from '@/sim/encounters';
import type { Rng } from '@/util/rng';
import couriersJson from '@rulesets/classic/couriers.json';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Everything a building panel reads or writes, handed in by whatever screen
 * owns the wider game/fleet state (out of this module's scope, same
 * boundary `@/ui/builder`'s `BuilderContext` already draws). `vehicle` is
 * the driver's ACTIVE vehicle, present at this city's garage/depot bay
 * whether or not it is currently in paid storage (`vehicleStored`) — the
 * same shape `@/sim/economy`'s `EconomyWorld` already uses for the same
 * reason. `fleetSize` is the owned-car count (for assembly's <8 gate);
 * `rng` is a seeded stream (`@/util/rng`), never `Math.random`, for every
 * random draw a panel needs (courier job generation, mechanic lessons,
 * casino deals, illicit-sale consequences).
 */
export interface BuildingContext {
  readonly driver: DriverState;
  readonly clock: Clock;
  readonly cityId: string;
  readonly vehicle: VehicleState | null;
  readonly vehicleStored: boolean;
  readonly fleetSize: number;
  readonly existingCarNames: readonly string[];
  readonly rng: Rng;
  /**
   * Facility kinds whose "one rumor per location per day" allowance has
   * already been spent at this city today (truckstop, bar), mapped to which
   * `RumorId` was revealed there — so re-selecting an already-spent rumor
   * row shows the SAME rumor again instead of a bare "already heard"
   * notice. Reset by the host on a new dayIndex — this module only ever
   * adds to it, never clears it itself, since it has no notion of "a new
   * day started" beyond what `clock` already told it.
   */
  readonly rumorsHeardToday: ReadonlyMap<string, RumorId>;
  /**
   * Every courier job accepted this game so far (any status), keyed
   * implicitly by `AcceptedJob.cargoId` — the one durable record of an
   * offer's real `pay`/`declaredValue`/`dueDay`, since `CargoState`
   * (`@/sim/types`) carries none of that itself. `@/ui/buildings/courierguild`
   * appends to this on a successful accept (`@/sim/courier`'s own `accept`);
   * `@/ui/buildings/bar` reads it to find the ACTIVE job backing a payload
   * before selling it illicitly (`@/sim/courier`'s `sellIllicit`, which prices
   * off the job's real `declaredValue` instead of an invented estimate) and
   * replaces the entry with `sellIllicit`'s own FAILED copy afterward.
   */
  readonly activeCourierJobs: readonly AcceptedJob[];
  /**
   * Per-route repopulation progress (`@/sim/encounters`), keyed by
   * `RouteDef.id` — the same map `CityRunState.routeHistory` (`@/app`) owns.
   * `@/ui/buildings/courierguild` reads and bumps this on a successful
   * delivery (`@/sim/encounters`'s `recordDelivery`), so a route genuinely
   * becomes safer the more cargo is run on it rather than only reacting to
   * a route being cleared of hostiles.
   */
  readonly routeHistory: ReadonlyMap<string, RouteEncounterHistory>;
  /**
   * Campaign quest save-state (`@/persist/save`'s `QuestState[]`) — read by
   * `@/ui/buildings/bar` and `@/ui/buildings/truckstop` to decide whether
   * either is currently standing at an unlocked quest's next unrevealed
   * `clueChain` hop (`@/ui/journal` owns the one clueChain-parsing/reveal
   * implementation both import, rather than each re-deriving it). Optional
   * and defaulted to `[]` by both readers — absent from every construction
   * site that predates campaign wiring (including this suite's own
   * `makeContext`), so none of them need updating just to keep compiling.
   */
  readonly quests?: readonly QuestState[];
}

/**
 * Original, neutral rumor flavor text (no protected marks) a truck stop or
 * bar can reveal — one draw per location per day (`BuildingContext.rumorsHeardToday`).
 */
export const RUMOR_IDS = [
  'building.rumor.patrol',
  'building.rumor.priceSpike',
  'building.rumor.newDriver',
  'building.rumor.wreck',
  'building.rumor.championship',
] as const;

export type RumorId = (typeof RUMOR_IDS)[number];

export function pickRumorId(rng: Rng): RumorId {
  return rng.pick(RUMOR_IDS);
}

// ---------------------------------------------------------------------------
// Header / open-hours
// ---------------------------------------------------------------------------

export function headerFor(ctx: BuildingContext): MenuHeaderInfo {
  return { cash: ctx.driver.cash, dayIndex: ctx.clock.dayIndex, phase: ctx.clock.phase, cityName: cityName(ctx.cityId) };
}

export function facilityOpenNow(kind: string, ctx: BuildingContext): boolean {
  return isFacilityOpen(kind, ctx.clock);
}

/** A single always-ineligible row explaining a closed facility — never a silently empty menu. */
export function closedAction(kind: string): MenuAction {
  return {
    id: 'closed',
    label: t('building.closedLabel'),
    eligible: false,
    reason: t('building.closed', { facility: facilityName(kind) }),
  };
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

export function canAfford(ctx: BuildingContext, price: number): boolean {
  return ctx.driver.cash >= price;
}

export function insufficientFundsReason(price: number, cash: number): string {
  return t('building.insufficientFunds', { price, cash });
}

export function servicePrice(serviceId: ServiceId): number {
  return economy().services[serviceId].price;
}

/** "{name} — $price" — the one label template every priced action uses, so pricing text lives in exactly one strings.json entry. */
export function pricedLabel(name: string, price: number): string {
  return t('building.priced', { name, price });
}

export const LEAVE_ACTION_ID = 'leave';

export function leaveAction(): MenuAction {
  return { id: LEAVE_ACTION_ID, label: t('building.leave'), eligible: true };
}

// ---------------------------------------------------------------------------
// Cargo valuation
// ---------------------------------------------------------------------------

/**
 * No ruleset table prices abstract salvage cargo the way it prices a weapon
 * (`WeaponDef.price`) — `CargoState` (`@/sim/types`) carries only
 * weight/space/integrity, and docs/SPEC.md lists "repair, resale, and
 * salvage-offer equations" among its explicitly open Reconstruction
 * questions. This derives dollars-per-pound entirely from the weapons
 * table itself (never a literal), by averaging every weapon's own
 * `price / weightLb` — the only dollars-per-pound figure any ruleset table
 * publishes — so a ruleset edit moves this number with it instead of it
 * drifting out of sync.
 */
export function averageWeaponDollarsPerLb(): number {
  const weapons = allWeapons();
  if (weapons.length === 0) return 0;
  const total = weapons.reduce((sum, w) => sum + w.price / w.weightLb, 0);
  return total / weapons.length;
}

/**
 * `@/sim/economy`'s `salvageRoll` stamps a recovered weapon's cargo id as
 * `${wreckId}-weapon-${weaponId}` (see that module). Recovering the real
 * weapon id lets a sale price it off the weapon's own list price instead of
 * the generic per-pound estimate below.
 */
export function weaponIdFromSalvageCargoId(cargoId: string): string | null {
  const marker = '-weapon-';
  const index = cargoId.lastIndexOf(marker);
  if (index === -1) return null;
  const candidate = cargoId.slice(index + marker.length);
  return hasWeapon(candidate) ? candidate : null;
}

/**
 * Original-cost basis for a piece of cargo, salvage or payload alike: the
 * matching weapon's list price when the id traces back to one (see
 * `weaponIdFromSalvageCargoId` — only ever true for recovered-weapon
 * salvage), otherwise its weight times `averageWeaponDollarsPerLb()` —
 * recovered gear and courier payloads have no ruleset price at all, so this
 * is the least-invented number available for either.
 */
export function cargoOriginalCostEstimate(cargo: CargoState): number {
  const weaponId = weaponIdFromSalvageCargoId(cargo.id);
  if (weaponId !== null) return getWeapon(weaponId).price;
  return Math.round(cargo.weightLb * averageWeaponDollarsPerLb());
}

/** cargo.integrity as a 0..1 fraction of full, per economy.json's `_reconstruction.cargoFullIntegrity`. */
export function cargoConditionFraction(cargo: CargoState): number {
  const full = economy()._reconstruction.cargoFullIntegrity;
  if (full <= 0) return 0;
  return Math.min(1, Math.max(0, cargo.integrity / full));
}

// ---------------------------------------------------------------------------
// Routes / adjacency (couriers + truckstop's bus both need this) — both
// re-exported from `@/sim/world-map`, the one adjacency layer, rather than
// re-implemented here a second time with different unknown-city-id
// behaviour (a prior version of this file silently returned `[]`/echoed
// `fromCityId` back for an unrecognised city; `@/sim/world-map`'s
// `routesFrom`/`neighbourCityOf` throw `UnknownRulesetIdError`/`RangeError`
// instead, same as every other ruleset-id lookup in this codebase).
// ---------------------------------------------------------------------------

export { routesFrom, neighbourCityOf as destinationCityOf } from '@/sim/world-map';

// ---------------------------------------------------------------------------
// couriers.json — not one of the nine files @/data/rulesets loads/validates
// (same situation @/sim/arena documents for arenas.json), so it is read
// directly here and typed locally. Job GENERATION itself (the `generation`
// block, offer pay/deadline/declaredValue math) is NOT duplicated here —
// `@/sim/courier`'s `generateOffers`/`accept`/`sellIllicit` already own that
// formula (couriers.json's own file-level note: "the source never published
// the formula") and are the one place it's computed; a second copy here
// previously drifted out of sync with it (see courierguild.ts's own header).
// What's left below is the handful of couriers.json fields a *building
// panel* itself needs to read directly (offer-count/day-sharing bookkeeping,
// the poor-salvage-sale fraction) that aren't exposed through a narrower
// `@/sim/courier` accessor.
// ---------------------------------------------------------------------------

export interface CourierPrestigeTier {
  readonly minPrestige: number;
  readonly maxDangerOffered: number;
  readonly payMultiplier: number;
  readonly prestigeReward: number;
  readonly failurePenalty: number;
}

export interface CouriersFile {
  readonly offersPerVisit: number;
  readonly maxPayloads: number;
  readonly salvageOccupiesOneCategory: boolean;
  readonly acceptanceCostDays: number;
  readonly multipleAcceptsShareOneDay: boolean;
  readonly prestigeTiers: readonly CourierPrestigeTier[];
  readonly lateness: { readonly payDecayPerDay: number; readonly payFloorFraction: number };
  readonly illicitSale: { readonly valueFraction: number; readonly prestigePenalty: number; readonly lawConsequenceChance: number };
  readonly refusalReasons: readonly string[];
  readonly cargoNames: readonly string[];
}

const COURIERS = couriersJson as CouriersFile;

export function couriersConfig(): CouriersFile {
  return COURIERS;
}

// ---------------------------------------------------------------------------
// Generic mount: BuildingEngine<S> -> a real @/ui/menu instance
// ---------------------------------------------------------------------------

/** What a building panel's pure core must implement. `activate` is the one reducer step: given the current state and an activated action id, return the next state and whether the panel should hand control back to the host (`exit: true`). */
export interface BuildingEngine<S> {
  actions(state: S): readonly MenuAction[];
  header(state: S): MenuHeaderInfo;
  activate(state: S, actionId: string): { readonly state: S; readonly exit: boolean };
}

export interface MountBuildingOptions<S> {
  readonly container: HTMLElement;
  readonly initialState: S;
  readonly engine: BuildingEngine<S>;
  readonly onExit: (state: S) => void;
}

export interface MountedBuilding<S> {
  destroy(): void;
  /** The panel's own current state — mainly a test seam; production callers own `onExit`'s payload instead. */
  getState(): S;
}

/**
 * Wires a `BuildingEngine<S>` to a live `@/ui/menu` instance: renders its
 * current `actions`/`header`, re-renders on every non-exiting activation,
 * and hands control back to `onExit` the moment `activate` (or the menu's
 * own Escape/Backspace handling) says to leave. `@/ui/menu`'s
 * `handleMenuKey` already gives every mounted panel full arrow-key and
 * number-key operation — this function adds nothing to that contract, it
 * only supplies the actions/header/transition data driving it.
 */
export function mountBuildingPanel<S>(options: MountBuildingOptions<S>): MountedBuilding<S> {
  let state = options.initialState;
  let mounted: MountedMenu | undefined;

  mounted = mountMenu({
    container: options.container,
    header: options.engine.header(state),
    actions: options.engine.actions(state),
    onActivate: (id) => {
      const result = options.engine.activate(state, id);
      state = result.state;
      if (result.exit) {
        options.onExit(state);
        return;
      }
      mounted?.setHeader(options.engine.header(state));
      mounted?.setActions(options.engine.actions(state));
    },
    onBack: () => options.onExit(state),
  });

  return {
    destroy(): void {
      mounted?.destroy();
    },
    getState(): S {
      return state;
    },
  };
}

// ---------------------------------------------------------------------------
// Pure-core test seam: drive a BuildingEngine<S> with raw keys, no DOM.
// ---------------------------------------------------------------------------

/**
 * Everything `mountBuildingPanel` would do for one `@ui/menu` keydown, minus
 * the DOM — the same pure-core seam `@/ui/builder`'s `handleKey` and
 * `@/ui/menu`'s own `handleMenuKey` already give their callers, so a
 * building panel's full keyboard operability (arrows, digits, Enter,
 * Escape/Backspace) is provable without installing a fake `document`.
 */
export function stepBuilding<S>(engine: BuildingEngine<S>, state: S, menu: MenuState, key: string): { state: S; menu: MenuState; exit: boolean } {
  const result = handleMenuKey(menu, key);
  if (result.outcome.kind === 'ACTIVATE') {
    const activated = engine.activate(state, result.outcome.id);
    if (activated.exit) {
      return { state: activated.state, menu: result.state, exit: true };
    }
    const nextMenu = setMenuActions(result.state, engine.actions(activated.state));
    return { state: activated.state, menu: nextMenu, exit: false };
  }
  if (result.outcome.kind === 'BACK') {
    return { state, menu: result.state, exit: true };
  }
  return { state, menu: result.state, exit: false };
}

export function menuFor<S>(engine: BuildingEngine<S>, state: S): MenuState {
  return createMenu(engine.actions(state));
}
