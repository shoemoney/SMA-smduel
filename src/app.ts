/**
 * The playable app shell: title -> driver creation -> constructor -> practice
 * arena. Wires the already-built subsystems (sim/**, render/**, ui/**)
 * together; it owns none of their gameplay math itself.
 *
 * Screen flow mirrors docs/SPEC.md's game states, scoped to what a boot
 * needs to prove end-to-end: Title -> Driver creation -> Constructor ->
 * Arena (the `practice` event, which has zero opponents per
 * rulesets/classic/arenas.json — a solo firing-range lap, not a placeholder).
 *
 * Rendering is WebGPU via `@/render/**`; when `navigator.gpu` is absent (or
 * device acquisition fails), the arena screen falls back to a text notice
 * and keeps running the CPU simulation + HUD with no canvas draw — the sim
 * is CPU-authoritative regardless of whether anything can render it.
 */
import '@/ui/builder.css';
import '@/ui/menu.css';
import '@/ui/hud.css';
import '@/ui/touch.css';

import { citiesConfig, drivingConfig, economy, getPlant, getTire, getWeapon, skillsConfig, RAW_RULESETS } from '@/data/rulesets';
import { validateRulesets } from '@/data/schema';
import { arcadeScoringEnabled, submitArcadeScore, type ArcadeSubmitFailure } from '@/arcade/client';
import { buildArcadePayload, shouldSubmitArcadeScore, type ArcadeScorePayload } from '@/arcade/score';
import {
  beginArenaMatch,
  circleIntersectsOrientedRect,
  computeArenaSpawnPositions,
  findBearingTarget,
  getArenaEvent,
  houseLoanerDesign,
  isHouseVehicleSalvageable,
  opponentDefeatedByReport,
  orientedRectsOverlap,
  recordOpponentDefeated,
  resolveArenaExit,
  rosterFor,
  selectArchetypeForEvent,
  vehicleOrientedRect,
  type ArenaEventDef,
  type ArenaEventId,
  type ArenaExitMode,
  type ArenaMatchState,
  type ArenaOpponentArchetype,
  type ArenaResolution,
  type ArenaRoster,
} from '@/sim/arena';
import { decideAI, type AIContext, type AIPersonality, type ArenaBounds } from '@/sim/ai';
import { advanceDays, initialClock, type Clock } from '@/sim/calendar';
import {
  advanceProjectile,
  applyResolvedShot,
  fire,
  facingWorldDirection,
  projectileExpired,
  tickCooldowns,
  type FireCommand,
  type ProjectileState,
} from '@/sim/combat';
import { computeBuild } from '@/sim/construct';
import {
  createCityPlayerState,
  generateCityLayout,
  stepWalk,
  toggleVehicle,
  type CityDirection,
  type CityLayout,
  type CityPlayerState,
  type CityTrigger,
} from '@/sim/city';
import type { AcceptedJob } from '@/sim/courier';
import { subtractVec, vecLength } from '@/sim/damage';
import { createDriver, getSkill } from '@/sim/driver';
import { applyCollision, stepDriving, stopAtObstacle, isRadarDisabled, type DriveInput } from '@/sim/driving';
import {
  createGameLoop,
  createSystemsRegistry,
  defaultInputFrame,
  dtSecondsFromTickRate,
  type InputFrame,
  type SystemFn,
} from '@/sim/loop';
import {
  createWreck,
  crossDestinationGate,
  willFire,
  resolveRoute,
  stepRoadTrip,
  type ResolvedRoute,
  type RoadContact,
  type RoadTripState,
  type RoadWreck,
} from '@/sim/road';
import {
  recordRouteCleared,
  FRESH_ROUTE_HISTORY,
  type EncounterUnit,
  type RouteEncounterHistory,
} from '@/sim/encounters';
import { canSearchWreck, searchWreck, type SearchWreckResult } from '@/sim/salvage';
import {
  activeVehicle as fleetActiveVehicle,
  addVehicle as fleetAddVehicle,
  fleetSize as fleetVehicleCount,
  removeVehicle,
  switchActiveVehicle,
  type Fleet,
  type FleetVehicle,
} from '@/sim/fleet';
import type { DayPhase, DriverState, RouteDef, SkillName, Vec2, VehicleDesign, VehicleState } from '@/sim/types';
import { FACINGS } from '@/sim/types';
import { createWorld, type World } from '@/sim/world';
import { createRng, type Rng } from '@/util/rng';
import { hashState } from '@/util/hash';
import { CURRENT_SCHEMA_VERSION } from '@/persist/migrate';
import { openSaveDatabase, save, load, type LoadResult, type SaveGame, type QuestState } from '@/persist/save';
import {
  deliverQuest,
  questCargoId,
  questDefs,
  buildVictorySummary,
  victorySummaryLines,
  type ArenaRecord,
  type QuestDef,
  type QuestDeliverResult,
} from '@/sim/victory';
import { generateEncountersWithPursuit, pursuitLevelFromQuestState } from '@/sim/pursuit';
import { createJournalState, journalEngine, questDef as journalQuestDef, type JournalContext } from '@/ui/journal';
import {
  CONTROLS,
  bindingsForPreset,
  cyclePressed,
  defaultBindings,
  directWeaponSlot,
  rebind,
  resolveInput,
  type AllBindings,
  type PresetName,
  type RawInputState,
} from '@/ui/input';

import {
  renderHud,
  type HudElement,
  type HudDocument,
  type HudMessage,
  type HudMessageKind,
  type HudSettings,
  type HudSnapshot,
} from '@/ui/hud';
import { mountBuilder, type BuilderConfirmedBuild } from '@/ui/builder';
import { mountFacility, type ArenaEntryResult, type BuildingContext, type MountedFacility } from '@/ui/buildings';
import { leaveAction, LEAVE_ACTION_ID, mountBuildingPanel, type RumorId } from '@/ui/buildings/shared';
import { buildCityInstances, type CityVehicleView, type CityViewSnapshot } from '@/ui/city-view';
import { mountMenu, type MenuAction, type MenuHeaderInfo } from '@/ui/menu';
import { cityName, t } from '@/ui/strings';
import { isCoarsePointer, mountTouchControls, type TouchCommandSpec, type TouchControls } from '@/ui/touch';
import { createRecoveryOrchestrator, type RecoveryOrchestrator } from '@/ui/gpu-recovery';

import { initGpu, type GpuContext } from '@/render/gpu';
import { loadAtlasIndex, type AtlasIndex, type FrameInfo } from '@/render/atlas';
import { createCamera, type Camera } from '@/render/camera';
import {
  createAtlasBindGroup,
  createAtlasBindGroupLayout,
  createAtlasSampler,
  createCameraBindGroup,
  createCameraBindGroupLayout,
  createCameraUniformBuffer,
  createInstanceStorageBuffer,
  createLayerPipeline,
  createShaderModule,
  encodeSpritePass,
  packInstances,
  writeCameraUniform,
  writeInstanceBuffer,
  type SpriteInstanceInput,
} from '@/render/sprite';

import atlasManifestRaw from '../assets/atlas.json';

// ---------------------------------------------------------------------------
// Fail fast on a malformed ruleset table, exactly once, before anything else
// runs. `@/data/rulesets` already does this at its own module init time; this
// call is what `tests/integration/boot.test.ts` asserts against directly.
// ---------------------------------------------------------------------------
export function validateAllRulesets(): void {
  validateRulesets(RAW_RULESETS);
}

export const PLAYER_ID = 'player';
export const ARENA_EVENT_ID = 'practice';

// Render-only cosmetic constants — never gameplay numbers. A vehicle's real
// dimensions aren't in any ruleset table (bodies.json prices/weighs/spaces a
// hull, it never measures one), so the on-screen footprint is a fixed,
// visual-only size, same as HUD's own MAX_WEAPON_ROWS/TIRE_LABELS constants.
const VEHICLE_SPRITE_SIZE_M = { x: 3.2, y: 5.2 };
const FLOOR_TILE_SIZE_M = 10;
const FLOOR_TILES_PER_SIDE = 9;
const PIXELS_PER_METER_CSS = 14;
/** Half the floor's real-world footprint — the arena's playable bounds (AI hazard-avoidance reads this), derived from the same two render constants the floor tiles themselves are built from, never a second literal. */
const ARENA_HALF_SIZE_M = (FLOOR_TILES_PER_SIDE * FLOOR_TILE_SIZE_M) / 2;
const OPPONENT_ID_PREFIX = 'opp-';

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function clearAndAppend(root: HTMLElement, child: HTMLElement): void {
  root.innerHTML = '';
  root.appendChild(child);
}

/**
 * A real-DOM `HudElement`, so `renderHud`'s root can be an element already
 * attached under the page (`hudContainer`) instead of a detached node
 * `@/ui/hud`'s own `createBrowserHudDocument` would create internally with
 * no way to hand its real `Node` back out. Mirrors that module's private
 * `DomHudElement` one-for-one against the same public interface.
 */
class DomHudElement implements HudElement {
  constructor(private readonly node: Element) {}
  get tagName(): string {
    return this.node.tagName;
  }
  setAttribute(name: string, value: string): void {
    this.node.setAttribute(name, value);
  }
  appendChild(child: HudElement): void {
    if (child instanceof DomHudElement) this.node.appendChild(child.node);
  }
  clearChildren(): void {
    while (this.node.firstChild) this.node.removeChild(this.node.firstChild);
  }
  setText(text: string): void {
    this.node.textContent = text;
  }
  addEventListener(type: string, handler: () => void): void {
    this.node.addEventListener(type, handler);
  }
}

class DomHudDocument implements HudDocument {
  createElement(tag: string): HudElement {
    return new DomHudElement(document.createElement(tag));
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Wires a `GpuContext`'s device-loss/recovery state to a screen's single-line
 * notice text and a "Retry" button, via `@/ui/gpu-recovery`'s state machine
 * instead of the four screens each hand-rolling their own `onRecoveryFailed`
 * text. `retryBtn` starts hidden and only appears while FAILED; clicking it
 * calls `orchestrator.retry()`. No `RenderLoopController` is passed beyond a
 * no-op pair: every screen's own `renderFrame()` already gates on
 * `gpu.isPaused()` (set by `gpu.ts` itself across the loss/recovery cycle),
 * and the sim keeps ticking regardless — pausing the app's rAF loop here
 * would also stop the sim, which every `webgpuRecovering`/`webgpuDeviceLost`
 * string promises stays running.
 */
function wireRecoveryUi(gpu: GpuContext, retryBtn: HTMLButtonElement, setNotice: (text: string) => void): RecoveryOrchestrator {
  retryBtn.textContent = t('ui.arena.webgpuRetry');
  retryBtn.style.display = 'none';
  const orchestrator = createRecoveryOrchestrator(gpu, { pause: () => {}, resume: () => {} });
  retryBtn.addEventListener('click', () => {
    void orchestrator.retry();
  });
  orchestrator.onStateChange((state) => {
    if (state === 'recovering') {
      retryBtn.style.display = 'none';
      setNotice(t('ui.arena.webgpuRecovering'));
    } else if (state === 'failed') {
      const reason = orchestrator.getLastFailureReason();
      retryBtn.style.display = '';
      setNotice(t('ui.arena.webgpuDeviceLost', { reason: reason?.kind ?? 'unknown' }));
    } else if (state === 'running') {
      retryBtn.style.display = 'none';
      setNotice('');
    }
  });
  return orchestrator;
}

// ---------------------------------------------------------------------------
// Session seed resolution
// ---------------------------------------------------------------------------
//
// A played session must be reproducible after the fact (a bug report or a
// replay needs the exact seed that drove it), which the clock can never
// give: Date.now() is low-entropy (two tabs booted in the same millisecond
// collide) and misleading about intent (a clock value looks like it means
// something when it's really just "whenever this happened to run"). So the
// seed is resolved from, in priority order:
//   1. an explicit ?seed= URL override, for reproducing one specific bug
//   2. the seed already recorded on a save in progress, so resuming one
//      never silently swaps in a different stream
//   3. a freshly generated seed from crypto.getRandomValues, for a brand
//      new session with nothing to restore
// and then never touched again for the session's lifetime - see
// `showArena`'s `restoreWorld` branch below, which reuses a resumed World's
// `rngState` verbatim instead of re-deriving it from the seed.

/** Reads `?seed=` from a location.search-style string. A missing or blank value yields null so callers fall through to the next source. */
export function seedOverrideFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get('seed');
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A genuinely random session seed, sourced from crypto.getRandomValues -
 * never Date.now(). Encoded as a stable lowercase hex string (128 bits of
 * entropy) so it prints cleanly in a bug report and round-trips
 * byte-for-byte through JSON/IndexedDB.
 */
export function randomSessionSeed(randomSource: Pick<Crypto, 'getRandomValues'> = crypto): string {
  const words = new Uint32Array(4);
  randomSource.getRandomValues(words);
  return Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('');
}

/** The one seed this session's world RNG derives from, chosen exactly once at new-game time (see the section doc comment above for the priority order). */
export function resolveSessionSeed(options: {
  readonly search: string;
  readonly savedSeed?: string | null;
  readonly randomSeed?: () => string;
}): string {
  const override = seedOverrideFromSearch(options.search);
  if (override !== null) return override;
  if (options.savedSeed !== undefined && options.savedSeed !== null) return options.savedSeed;
  return (options.randomSeed ?? randomSessionSeed)();
}

/** Recovers the plain seed string from an `RngState.seedKey` ("s:<seed>" / "n:<seed>") for display - the inverse of `@/util/rng`'s own (unexported) prefixing, computed locally since that internal isn't exported. */
function seedKeyToDisplaySeed(seedKey: string): string {
  const colonIndex = seedKey.indexOf(':');
  return colonIndex === -1 ? seedKey : seedKey.slice(colonIndex + 1);
}

/**
 * Resolves the session seed used to RESUME an in-progress save: reads the
 * seed already recorded on the restored World's own `rngState.seedKey`
 * (never re-derived) and routes it through `resolveSessionSeed`'s same
 * priority order, so an explicit `?seed=` override still wins even on a
 * resume. Extracted out of `boot()`'s `resumeSession` closure (which isn't
 * itself reachable headlessly - it goes straight on to call `showArena`) as
 * its own seam, so a test can drive this exact call - the saved-seed lookup
 * AND the `resolveSessionSeed` call together - directly.
 */
export function resolveResumeSessionSeed(world: World, options: { readonly search: string; readonly randomSeed?: () => string }): string {
  const savedSeed = seedKeyToDisplaySeed(world.rngState.seedKey);
  return resolveSessionSeed(
    options.randomSeed !== undefined
      ? { search: options.search, savedSeed, randomSeed: options.randomSeed }
      : { search: options.search, savedSeed },
  );
}

/** Stable 32-bit fingerprint of a string seed, for the legacy numeric `SaveGame.seed` field. The actual reproducible state lives in `world.rngState` (a string `seedKey` plus the 4 xoshiro words), which round-trips through JSON exactly; this fingerprint is display/bookkeeping metadata only. */
function seedFingerprint(seed: string): number {
  return Number.parseInt(hashState(seed).slice(0, 8), 16);
}

/** The most recently resolved or restored session seed, so a fatal-crash banner (see `main.ts`) can still report it even if the arena screen never got the chance to show its own status line. */
let lastSessionSeed: string | null = null;
export function currentSessionSeed(): string | null {
  return lastSessionSeed;
}

// ---------------------------------------------------------------------------
// Control presets + rebinding (docs/SPEC.md "Controls") — one live selection
// for the whole running session, read by every screen's own input sampling
// (`resolveInput` from `@/ui/input`, never a screen's own hardcoded
// WASD/arrows table) and written only by `showControls` below. Module-level
// like `lastSessionSeed` above, for the same reason: it is one fact about
// THIS session, not per-screen state, and every screen (arena, city, road)
// needs to read the SAME live value, including the boot-time practice arena,
// which has no `CityRunState` to carry it on.
// ---------------------------------------------------------------------------

let currentControlPreset: PresetName = CONTROLS.presets[0] ?? 'classic';
let currentControlBindings: AllBindings = defaultBindings();

export function currentControls(): { readonly preset: PresetName; readonly bindings: AllBindings } {
  return { preset: currentControlPreset, bindings: currentControlBindings };
}

/** Restores a previously-saved preset/bindings pair (see `persistArenaSession`'s save and `resumeSession`'s load below) — never re-derived, exactly like a restored session seed. */
export function restoreControls(preset: PresetName, bindings: AllBindings): void {
  currentControlPreset = preset;
  currentControlBindings = bindings;
}

/** A live `Set` of currently-held `KeyboardEvent.code` values (NOT `.key` — `@/ui/input`'s bindings are all code-keyed, e.g. `"KeyW"`), kept current by window-level listeners for as long as the returned `detach()` hasn't been called. Every screen's own per-frame `RawInputState` reads this same set fresh each frame rather than resampling the DOM. */
function attachCodeTracking(codesDown: Set<string>): { detach(): void } {
  function onKeyDown(ev: KeyboardEvent): void {
    codesDown.add(ev.code);
  }
  function onKeyUp(ev: KeyboardEvent): void {
    codesDown.delete(ev.code);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  return {
    detach(): void {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}

const NO_TOUCH_BUTTONS: ReadonlySet<string> = new Set();

function rawInputFrom(codesDown: ReadonlySet<string>, touch: TouchControls | null): RawInputState {
  return {
    keysDown: codesDown,
    mouseButtonsDown: new Set(),
    gamepadButtonsDown: new Set(),
    gamepadAxes: [],
    touchAxes: touch?.axes() ?? [],
    touchButtonsDown: touch?.buttonsDown() ?? NO_TOUCH_BUTTONS,
  };
}

/** The live active-mount selection every driving screen samples from. `active()` is `null` only when the car has no mounts at all. */
interface WeaponSelection {
  /** Reads one tick's raw device state and applies whatever mount change it asks for. Call once per sampled tick, before reading `active()`. */
  update(raw: RawInputState): void;
  /** The mount that will actually fire, guaranteed to index an existing mount whenever it is non-null. */
  active(): number | null;
  /** Applies a cycle from a source that isn't a bound key or button — the on-screen touch control, which is a tap, not a held action. */
  cycleOnce(delta: 1 | -1): void;
}

/**
 * The ONE piece of active-mount state a driving screen has, and the only
 * thing allowed to write it. Both ways a player changes mount go through
 * here: cycling (`cycleWeaponNext`/`cycleWeaponPrev`) and 1-0 direct select.
 * Both are edge-triggered off `@/ui/input`'s deliberately memoryless
 * readings, so neither can overwrite the other on a tick where both are
 * held — a screen that re-read the held digit every frame instead would pin
 * the slot there and make cycling look broken.
 *
 * Out-of-range selection is REFUSED, never clamped. A player who reaches for
 * mount 5 on a four-mount car keeps the mount they already had, rather than
 * being silently moved to mount 1 and firing a weapon they did not ask for.
 * That refusal plus `cycle`'s modulo is what makes a non-null `active()`
 * always a real mount index: the invariant is enforced at both writes, so no
 * reader needs a defensive clamp (and `VehicleState.weapons` never shrinks —
 * a destroyed or spent mount stays in the array, see `WeaponState.spent`).
 *
 * Selecting a DESTROYED or spent mount is deliberately allowed: cycling
 * already steps onto one and the two must agree, `@/sim/combat`'s
 * `validateFire` refuses the shot with a reason the HUD shows, and a mount
 * that is merely cooling down becomes fireable again a tick later.
 */
function makeWeaponSelection(weaponCount: () => number): WeaponSelection {
  let activeIndex: number | null = weaponCount() > 0 ? 0 : null;
  let prevNext = false;
  let prevPrev = false;
  let prevDirect: number | null = null;

  function cycle(delta: 1 | -1): void {
    const count = weaponCount();
    if (count === 0) {
      activeIndex = null;
      return;
    }
    activeIndex = ((((activeIndex ?? 0) + delta) % count) + count) % count;
  }

  return {
    update(raw) {
      const { next, prev } = cyclePressed(raw, currentControlPreset, currentControlBindings);
      if (next && !prevNext) cycle(1);
      if (prev && !prevPrev) cycle(-1);
      prevNext = next;
      prevPrev = prev;

      const direct = directWeaponSlot(raw, currentControlPreset, currentControlBindings);
      if (direct !== null && direct !== prevDirect && direct < weaponCount()) activeIndex = direct;
      prevDirect = direct;
    },
    active: () => activeIndex,
    cycleOnce: cycle,
  };
}

/**
 * `InputFrame.weaponSlot` for a screen whose car has no mounts at all.
 * `@/sim/ai`'s own decisions already use -1 for exactly this, and every
 * weapons system reads `weapons[slot]` and returns on `undefined`, so this
 * is the same no-op 0 was — except it can no longer be mistaken for a real
 * mount index by anything that reads the frame later.
 */
const NO_WEAPON_SLOT = -1;

/**
 * The on-screen mount-switch control, for the screens where a weapon can
 * actually fire — every caller of `mountTouchControls({ fire: true, ... })`,
 * and no others. A phone has no 1-0 row and no Q/E, so without this a touch
 * player is locked to whichever mount they started on: they cannot switch off
 * a dry magazine, which is the one tactic amateur night is balanced around
 * (see `tests/integration/no-active-vehicle.test.ts` on why the loaner
 * carries four mounts rather than one fat one).
 *
 * A `TouchCommandSpec` rather than a new kind of control, because switching
 * mount is a discrete tap exactly like the existing G/F/J/X commands, and so
 * inherits their 44px minimum target, `aria-label` and corner stacking for
 * free. It cycles FORWARD only: a reverse button would crowd the same corner
 * to save at most two taps on a four-mount car.
 *
 * It reports neither which mount is now active nor what that mount has left,
 * because the HUD's weapons panel is already on screen saying exactly that,
 * keyed by the same 1-based mount number (`@/ui/hud`'s `buildWeaponRow`: slot
 * number, ammo/capacity, `aria-current` on the active row). A second, smaller
 * copy could only drift from it.
 *
 * Hidden on a car with fewer than two mounts, where there is nothing to switch
 * between. Decided once rather than per frame, because `VehicleState.weapons`
 * never shrinks — a destroyed mount stays in the array.
 */
function weaponTouchCommands(selection: WeaponSelection, vehicle: VehicleState): readonly TouchCommandSpec[] {
  return [
    {
      id: 'cycleWeapon',
      labelKey: 'ui.touch.cycleWeapon',
      onPress: () => selection.cycleOnce(1),
      initiallyVisible: vehicle.weapons.length > 1,
    },
  ];
}

// ---------------------------------------------------------------------------
// Screen 1: Title
// ---------------------------------------------------------------------------

function showTitle(root: HTMLElement, titleOptions: { onNewDriver: () => void; onContinue?: () => void }): void {
  const container = el('div', 'sm-screen sm-screen--title');
  container.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
  const menuHost = el('div');
  menuHost.style.cssText = 'width:min(420px,90vw);';
  container.appendChild(menuHost);
  clearAndAppend(root, container);

  const clock = initialClock();
  const actions: MenuAction[] = [
    { id: 'new-driver', label: t('ui.title.newDriver'), eligible: true },
    { id: 'controls', label: t('ui.title.controls'), eligible: true },
  ];
  if (titleOptions.onContinue !== undefined) {
    actions.unshift({ id: 'continue', label: t('ui.title.continue'), eligible: true });
  }
  mountMenu({
    container: menuHost,
    header: { cash: 0, dayIndex: clock.dayIndex, phase: clock.phase, cityName: t('ui.title.appName') },
    actions,
    onActivate: (id) => {
      if (id === 'continue' && titleOptions.onContinue !== undefined) {
        titleOptions.onContinue();
        return;
      }
      if (id === 'controls') {
        showControls(root, () => showTitle(root, titleOptions));
        return;
      }
      titleOptions.onNewDriver();
    },
    onBack: () => {
      /* nothing above Title to back out to */
    },
  });
}

// ---------------------------------------------------------------------------
// Screen 1b: Controls — select a preset (`@/ui/input`'s `CONTROLS.presets`)
// and rebind any action to a new key, live off the one module-level
// `currentControlPreset`/`currentControlBindings` pair every driving screen
// reads through `resolveInput`/`cyclePressed`. Reachable from Title (before
// a session even exists) and persisted with the save (see
// `persistArenaSession`/`resumeSession`), so a rebind made here outlives the
// screen it was made on.
// ---------------------------------------------------------------------------

function bindingSummary(actionId: string): string {
  const binding = bindingsForPreset(currentControlBindings, currentControlPreset)[actionId];
  return (binding?.keyboard ?? []).join(', ');
}

function controlsMenuActions(awaitingActionId: string | null): MenuAction[] {
  const actions: MenuAction[] = [
    { id: 'cycle-preset', label: t('ui.controls.presetRow', { preset: currentControlPreset }), eligible: awaitingActionId === null },
  ];
  for (const actionId of CONTROLS.actions) {
    const label =
      awaitingActionId === actionId
        ? t('ui.controls.awaitingKey', { action: actionId })
        : (() => {
            const summary = bindingSummary(actionId);
            return summary.length > 0
              ? t('ui.controls.actionRow', { action: actionId, binding: summary })
              : t('ui.controls.actionRowEmpty', { action: actionId });
          })();
    actions.push({ id: `rebind-${actionId}`, label, eligible: awaitingActionId === null });
  }
  actions.push(leaveAction());
  return actions;
}

function showControls(root: HTMLElement, onExit: () => void): void {
  const container = el('div', 'sm-screen sm-screen--controls');
  container.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
  const menuHost = el('div');
  menuHost.style.cssText = 'width:min(420px,90vw);max-height:90vh;overflow:auto;';
  container.appendChild(menuHost);
  clearAndAppend(root, container);

  const clock = initialClock();
  let awaitingActionId: string | null = null;
  let cancelCapture: (() => void) | null = null;

  function exit(): void {
    cancelCapture?.();
    onExit();
  }

  const mounted = mountMenu({
    container: menuHost,
    header: { cash: 0, dayIndex: clock.dayIndex, phase: clock.phase, cityName: t('ui.title.controls') },
    actions: controlsMenuActions(awaitingActionId),
    onActivate: (id) => {
      if (id === LEAVE_ACTION_ID) {
        exit();
        return;
      }
      if (id === 'cycle-preset') {
        const presets = CONTROLS.presets;
        const index = presets.indexOf(currentControlPreset);
        currentControlPreset = presets[(index + 1) % presets.length] ?? currentControlPreset;
        mounted.setActions(controlsMenuActions(awaitingActionId));
        return;
      }
      if (!id.startsWith('rebind-')) return;
      const actionId = id.slice('rebind-'.length);
      awaitingActionId = actionId;
      mounted.setActions(controlsMenuActions(awaitingActionId));

      // Capture-phase + stopPropagation so this one keypress never ALSO
      // reaches `@/ui/menu`'s own bubble-phase listener on the container
      // (which would otherwise navigate the menu with the very key being
      // captured as this action's new binding).
      function onCapture(ev: KeyboardEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        currentControlBindings = rebind(currentControlBindings, currentControlPreset, actionId, { device: 'keyboard', code: ev.code });
        awaitingActionId = null;
        cancelCapture = null;
        mounted.setActions(controlsMenuActions(awaitingActionId));
      }
      window.addEventListener('keydown', onCapture, { capture: true, once: true });
      cancelCapture = () => window.removeEventListener('keydown', onCapture, { capture: true });
    },
    onBack: () => exit(),
  });
}

// ---------------------------------------------------------------------------
// Screen 2: Driver creation
// ---------------------------------------------------------------------------

function showDriverCreation(root: HTMLElement, onCreated: (driver: DriverState) => void): void {
  const cfg = skillsConfig();
  const container = el('div', 'sm-screen sm-screen--driver');
  container.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#d7e0ea;font-family:system-ui,sans-serif;';

  const card = el('div');
  card.style.cssText = 'width:min(420px,90vw);background:#161d27;border:1px solid #2a3444;border-radius:8px;padding:24px;';
  const title = el('h2', undefined, t('ui.driverCreation.title'));
  title.style.cssText = 'margin:0 0 16px;';
  card.appendChild(title);

  const nameLabel = el('label', undefined, t('ui.driverCreation.nameLabel'));
  nameLabel.style.cssText = 'display:block;margin-bottom:4px;';
  card.appendChild(nameLabel);
  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.maxLength = cfg.driver.nameMaxLength;
  nameInput.value = 'Driver';
  nameInput.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:16px;padding:6px;';
  card.appendChild(nameInput);

  const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
  const remainder = cfg.startingSkillPool - base * cfg.skills.length;
  const skillInputs = new Map<SkillName, HTMLInputElement>();
  const remainingLabel = el('div');
  remainingLabel.style.cssText = 'margin:8px 0;color:#8a97a8;';

  function currentTotal(): number {
    let total = 0;
    for (const input of skillInputs.values()) total += Number.parseInt(input.value, 10) || 0;
    return total;
  }
  function refreshRemaining(): void {
    remainingLabel.textContent = t('ui.driverCreation.pointsRemaining', {
      count: cfg.startingSkillPool - currentTotal(),
    });
  }

  cfg.skills.forEach((skillName, index) => {
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    const label = el('span', undefined, skillName);
    const input = el('input');
    input.type = 'number';
    input.min = String(cfg.skillMin);
    input.max = String(cfg.skillMax);
    input.value = String(base + (index === cfg.skills.length - 1 ? remainder : 0));
    input.style.cssText = 'width:80px;padding:4px;';
    input.addEventListener('input', refreshRemaining);
    row.appendChild(label);
    row.appendChild(input);
    card.appendChild(row);
    skillInputs.set(skillName, input);
  });
  card.appendChild(remainingLabel);
  refreshRemaining();

  const message = el('div');
  message.style.cssText = 'color:#ff6b6b;min-height:20px;margin:8px 0;';
  card.appendChild(message);

  const submit = el('button', undefined, t('ui.driverCreation.title'));
  submit.style.cssText = 'width:100%;padding:10px;background:#4fd6c4;border:none;border-radius:4px;cursor:pointer;font-weight:600;';
  submit.addEventListener('click', () => {
    const skills = {} as Record<SkillName, number>;
    for (const [skillName, input] of skillInputs) {
      skills[skillName] = Number.parseInt(input.value, 10) || 0;
    }
    const result = createDriver(nameInput.value.trim(), skills);
    if (!result.ok) {
      message.textContent = result.reason;
      return;
    }
    onCreated(result.driver);
  });
  card.appendChild(submit);

  // This screen has no wrapping <form>, so a bare `<input>` gives Enter no
  // default action at all — reported as "you must arrow down [to the skill
  // rows and back] to the button; Enter does nothing." Reuses `submit`'s own
  // click handler (`.click()`, not a copy of its body) so the validation and
  // navigation behind Enter can never drift from what clicking the button
  // does. Skill point fields are `type="number"`, not the reported "name
  // field", and are left alone.
  nameInput.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    submit.click();
  });

  container.appendChild(card);
  clearAndAppend(root, container);
  nameInput.focus();
}

// ---------------------------------------------------------------------------
// Screen 3: Constructor
// ---------------------------------------------------------------------------

function showConstructor(
  root: HTMLElement,
  driver: DriverState,
  onBuilt: (driver: DriverState, confirmed: BuilderConfirmedBuild) => void,
  onCancel: () => void,
  existingCarNames: readonly string[] = [],
  ownedCarCount = 0,
): void {
  const container = el('div', 'sm-screen sm-screen--constructor');
  container.style.cssText = 'position:absolute;inset:0;';
  clearAndAppend(root, container);

  mountBuilder({
    container,
    context: { cash: driver.cash, existingCarNames, ownedCarCount },
    onBuilt: (confirmed) => {
      const chargedDriver: DriverState = { ...driver, cash: driver.cash - confirmed.costTotal };
      onBuilt(chargedDriver, confirmed);
    },
    onCancel,
  });
}

// ---------------------------------------------------------------------------
// Vehicle construction: BuilderConfirmedBuild -> a real runtime VehicleState
// ---------------------------------------------------------------------------

/**
 * Builds a fresh runtime `VehicleState` from a `VehicleDesign` alone — the
 * shared core `vehicleStateFromConfirmedBuild` (the player's own build) and
 * `spawnArenaOpponents` (real opponents, positioned on the spawn ring) both
 * go through, so "how a design becomes a runtime vehicle" is one function,
 * not two independently-typed copies that could drift.
 */
export function vehicleStateFromDesign(
  design: VehicleDesign,
  id: string,
  ownerId: string,
  position: Vec2 = { x: 0, y: 0 },
  headingRad = 0,
): VehicleState {
  const tire = getTire(design.tireId);
  const plant = getPlant(design.plantId);

  return {
    id,
    ownerId,
    design,
    position,
    headingRad,
    speedMps: 0,
    battery: drivingConfig().battery.full,
    odometerMiles: 0,
    armorDP: { ...design.armor },
    tireDP: [tire.maxDP, tire.maxDP, tire.maxDP, tire.maxDP],
    plantDP: plant.maxDP,
    weapons: design.weapons.map((mounted) => {
      const def = getWeapon(mounted.weaponId);
      return {
        weaponId: mounted.weaponId,
        facing: mounted.facing,
        ammo: mounted.ammo,
        dp: def.maxDP,
        maxDP: def.maxDP,
        cooldownRemaining: 0,
        destroyed: false,
      };
    }),
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
  };
}

/** `vehicleId` defaults to `veh-${ownerId}` (the original single-car contract every existing caller/test relies on) — a caller adding a SECOND car to an owned fleet passes its own fresh id instead, since two owned cars can never legally share one. */
export function vehicleStateFromConfirmedBuild(confirmed: BuilderConfirmedBuild, ownerId: string, vehicleId: string = `veh-${ownerId}`): VehicleState {
  return vehicleStateFromDesign(confirmed.design, vehicleId, ownerId);
}

export function replaceVehicle(world: World, vehicle: VehicleState): void {
  const index = world.entities.vehicles.findIndex((candidate) => candidate.id === vehicle.id);
  if (index >= 0) world.entities.vehicles[index] = vehicle;
}

export function findPlayer(world: World): VehicleState | undefined {
  return world.entities.vehicles.find((vehicle) => vehicle.ownerId === PLAYER_ID);
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

/** Restores a throwaway Rng from the world's serialized state, hands it to `fn`, then serializes the advanced state back — the same restore/draw/serialize convention `@/sim/world`'s RngState round-trip requires. */
export function withWorldRng<T>(world: World, fn: (rng: ReturnType<typeof createRng>) => T): T {
  const rng = createRng(0);
  rng.restore(world.rngState);
  const result = fn(rng);
  world.rngState = rng.serialize();
  return result;
}

export function makeDrivingSystem(driverRef: { current: DriverState }): SystemFn {
  return (world, input, dtSeconds) => {
    const player = findPlayer(world);
    if (player === undefined || player.destroyed) return;
    const driveInput: DriveInput = { stick: { x: input.moveX, y: input.moveY } };
    const drivingSkill = getSkill(driverRef.current, 'driving');
    const nextVehicle = withWorldRng(world, (rng) =>
      stepDriving({
        vehicle: player,
        input: driveInput,
        dtSeconds,
        rng: { next: () => rng.nextFloat() },
        drivingSkill,
        surface: 'normal',
      }),
    ).vehicle;
    replaceVehicle(world, nextVehicle);
  };
}

export function makeWeaponsSystem(driverRef: { current: DriverState }, spawnCounter: { current: number }, log: (kind: HudMessageKind, text: string) => void): SystemFn {
  return (world, input) => {
    const player = findPlayer(world);
    if (player === undefined || player.destroyed) return;

    const cooled = tickCooldowns(player, 1);
    replaceVehicle(world, cooled);
    if (!input.fire) return;

    const weapon = cooled.weapons[input.weaponSlot];
    if (weapon === undefined || weapon.facing === 'UNDERBODY') return;

    const weaponDef = getWeapon(weapon.weaponId);
    const direction = facingWorldDirection(cooled.headingRad, weapon.facing);
    const targetPosition = {
      x: cooled.position.x + direction.x * weaponDef.rangeM,
      y: cooled.position.y + direction.y * weaponDef.rangeM,
    };
    const marksmanshipSkill = getSkill(driverRef.current, 'marksmanship');
    const spawnedEntityId = `proj-${world.tick}-${spawnCounter.current}`;
    spawnCounter.current += 1;

    const result = withWorldRng(world, (rng) => {
      const command: FireCommand = {
        vehicle: cooled,
        weaponSlotIndex: input.weaponSlot,
        target: { position: targetPosition, headingRad: cooled.headingRad },
        ctx: {
          rng,
          marksmanshipSkill,
          rangePenaltyPercent: 0,
          relativeMotionPenaltyPercent: 0,
          smokePenaltyPercent: 0,
          paintPenaltyPercent: 0,
        },
        tick: world.tick,
        spawnedEntityId,
        deployDropOffsetM: 2,
      };
      return fire(command);
    });
    replaceVehicle(world, result.vehicle);
    if (!result.ok) {
      if (result.reason === 'NO_AMMO') log('info', t('ui.weapon.outOfAmmo', { weapon: weaponDef.name }));
      return;
    }
    if (result.spawn?.kind === 'PROJECTILE') {
      world.entities.projectiles.push(result.spawn.projectile);
      log('hit', t('ui.weapon.fired', { weapon: weaponDef.name }));
    }
  };
}

export const projectilesSystem: SystemFn = (world, _input, dtSeconds) => {
  world.entities.projectiles = world.entities.projectiles.map((projectile) => advanceProjectile(projectile, dtSeconds));
};

export const cleanupSystem: SystemFn = (world) => {
  world.entities.projectiles = world.entities.projectiles.filter((projectile) => !projectileExpired(projectile));
};

// ---------------------------------------------------------------------------
// Arena-event opponents: real spawn, real `decideAI`, real fire pipeline.
//
// `makeDrivingSystem`/`makeWeaponsSystem` above only ever drive the ONE
// player-controlled vehicle (a single buffered `InputFrame` per tick,
// straight off `driverRef`) — `showArena`'s zero-opponent practice loop
// never needed more than that, and `tests/integration/boot.test.ts` already
// calls both by that exact signature, so they stay exactly as they are.
// `showArenaEvent` (real opponents) needs a DIFFERENT InputFrame per
// vehicle every tick — the player's from the DOM/test, every opponent's
// from its own `decideAI` decision — so these are separate, dedicated
// systems, not a signature change to the ones above.
// ---------------------------------------------------------------------------

/** An opponent's combat-relevant state that isn't itself part of `World` — mirrors `driverRef` for the player, one entry per spawned opponent vehicle id. */
export interface ArenaOpponentState {
  /**
   * Which encounters.json archetype this opponent's skill/personality came
   * from. Recorded so a test can assert the pair MATCHES that archetype — the
   * previous test only checked `>= 0`, and a verifier proved that hard-coding
   * every opponent to skill 0 (the exact "nerf the AI so the player wins"
   * failure) passed the whole suite.
   */
  readonly archetypeId: string;
  readonly personality: AIPersonality;
  readonly driver: DriverState;
  /** This opponent's own fixed `decideAI` seed — drawn once at spawn from the match's own seeded RNG, never `Math.random`/`Date.now`. */
  readonly seed: number;
}

export function arenaBounds(): ArenaBounds {
  return { minX: -ARENA_HALF_SIZE_M, maxX: ARENA_HALF_SIZE_M, minY: -ARENA_HALF_SIZE_M, maxY: ARENA_HALF_SIZE_M };
}

/** A road opponent's `decideAI` hazard-avoidance box, centered on the player each tick (the road has no fixed arena floor to bound against) — sized off `driving.json`'s own `radar.visualRangeM` scaled by its sibling `radar.aiHazardBoxRangeMultiplier`, never a literal, so a contact engaged at the very edge of visual range still has room to maneuver before hitting the box wall. */
export function roadBounds(center: Vec2): ArenaBounds {
  const half = drivingConfig().radar.visualRangeM * drivingConfig().radar.aiHazardBoxRangeMultiplier;
  return { minX: center.x - half, maxX: center.x + half, minY: center.y - half, maxY: center.y + half };
}

/** How close the player's vehicle must be to a `RoadWreck` to search it — `driving.json`'s own `collision.vehicleSeparationM` scaled by its sibling `collision.wreckSearchRangeMultiplier`, never a literal. */
export function wreckSearchRangeM(): number {
  return drivingConfig().collision.vehicleSeparationM * drivingConfig().collision.wreckSearchRangeMultiplier;
}

/** Distance within which a passed `peaceful` contact triggers the one-time "traffic passing" notice — `collision.vehicleSeparationM` scaled by its sibling `collision.trafficPassRangeMultiplier`, never a literal. */
export function trafficPassRangeM(): number {
  return drivingConfig().collision.vehicleSeparationM * drivingConfig().collision.trafficPassRangeMultiplier;
}

/** 1 minus the fraction of `vehicle`'s total armor (across every facing) still standing, 0 for a vehicle mounting no armor at all — the same "how hurt is it" signal `@/sim/road`'s `updateContactFlight` gates a faction's `fleesAtDamageFraction` on, computed from the real live vehicle rather than invented. */
export function armorDamageFraction(vehicle: VehicleState): number {
  const maxTotal = FACINGS.reduce((sum, facing) => sum + vehicle.design.armor[facing], 0);
  if (maxTotal <= 0) return 0;
  const currentTotal = FACINGS.reduce((sum, facing) => sum + vehicle.armorDP[facing], 0);
  return 1 - currentTotal / maxTotal;
}

/**
 * A `DriverState` stand-in for an AI opponent — `applyPenetratingDamage`
 * (via `applyResolvedShot`) needs one to track armor-then-health on a hit
 * the same way it does for the player, and `stepDriving`/`fire` need a
 * `driving`/`marksmanship` skill number. Built straight from the chosen
 * archetype's own `skill` block (never a TS literal) plus
 * `skillsConfig().driver`'s own starting health/armor — the same fields
 * `createDriver` seeds a real player with — rather than `createDriver`
 * itself, whose "skills must sum to exactly startingSkillPool" gate exists
 * for the player-creation UI, not for an archetype's own independently-tuned
 * driving/marksmanship pair.
 */
export function opponentDriverState(skill: { readonly driving: number; readonly marksmanship: number }): DriverState {
  const cfg = skillsConfig();
  return {
    name: 'Opponent',
    skills: { driving: skill.driving, marksmanship: skill.marksmanship, mechanic: 0 },
    naturalHealth: cfg.driver.naturalHealthDP,
    bodyArmor: 0,
    prestige: 0,
    cash: 0,
    cityId: cfg.startingLocation,
    cloneCityId: null,
    cloneSkills: null,
  };
}

function requireOpponent(opponents: ReadonlyMap<string, ArenaOpponentState>, vehicleId: string): ArenaOpponentState {
  const found = opponents.get(vehicleId);
  if (found === undefined) throw new RangeError(`arena: no tracked opponent state for vehicle "${vehicleId}"`);
  return found;
}

/**
 * Spawns `event`'s real opponent roster into `world` and returns their
 * combat state, keyed by vehicle id — the ONE place opponent vehicles come
 * from (`showArenaEvent`'s match start and `tests/integration/arena-victory
 * .test.ts` both call this exact function, not a parallel reimplementation).
 * Positions come from `computeArenaSpawnPositions` (the spawn ring), rotated
 * by one draw from the match's own seeded `world.rngState` so the
 * arrangement is deterministic per session without ever being the same
 * every match. Design/skill/personality come from `rosterFor` (house vs. own
 * vehicleSource) and `selectArchetypeForEvent` — see `@/sim/arena` for both.
 */
export function spawnArenaOpponents(world: World, event: ArenaEventDef): Map<string, ArenaOpponentState> {
  const roster: ArenaRoster = rosterFor(event.id);
  const archetype: ArenaOpponentArchetype = selectArchetypeForEvent(event);
  const drivingCfg = drivingConfig();

  const rotationOffsetRad = withWorldRng(world, (rng) => rng.nextFloat() * 2 * Math.PI);
  const positions = computeArenaSpawnPositions(
    roster.opponentCount,
    drivingCfg.arena.spawnRingRadiusM,
    rotationOffsetRad,
    drivingCfg.arena.minSpawnSeparationM,
  );

  let design: VehicleDesign;
  if (roster.vehicleSource === 'house') {
    if (roster.houseOpponentDesign === null) {
      throw new RangeError(`arena: event "${event.id}" is house-sourced but has no house design`);
    }
    design = roster.houseOpponentDesign;
  } else {
    design = archetype.design;
  }

  const opponents = new Map<string, ArenaOpponentState>();
  positions.forEach((position, i) => {
    const id = `${OPPONENT_ID_PREFIX}${i}`;
    // Spawns facing outward, away from the ring's center (not already aimed
    // at the player) — nothing hands an AI a free instant-lock; it steers to
    // bring a weapon to bear starting from a cold heading exactly like the
    // player does, the same as materializing at the gate and turning to
    // face the fight.
    const headingRad = Math.atan2(position.y, position.x);
    const vehicle = vehicleStateFromDesign(design, id, id, position, headingRad);
    world.entities.vehicles.push(vehicle);
    const seed = withWorldRng(world, (rng) => rng.nextU32());
    opponents.set(id, {
      archetypeId: archetype.id,
      personality: archetype.personality,
      driver: opponentDriverState(archetype.skill),
      seed,
    });
  });
  return opponents;
}

/**
 * Vehicle-vs-vehicle contact: any two non-destroyed vehicles whose
 * oriented-rectangle colliders (bodies.json's colliderLengthM/colliderWidthM
 * via `vehicleOrientedRect`) overlap take `applyCollision`'s real armor
 * check (`driving.json`'s `collision.armorLossSpeedMph`/`armorLossPoints`),
 * are stopped (`stopAtObstacle`), and are nudged apart along their center
 * line by `collision.vehicleSeparationM` so an overlap clears in one tick
 * instead of wedging two cars together forever.
 */
function resolveVehicleCollisions(vehicles: readonly VehicleState[]): VehicleState[] {
  const drivingCfg = drivingConfig();
  const mphPerMps = 3600 / drivingCfg.metersPerMile;
  const out = vehicles.map((v) => v);
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (a === undefined || a.destroyed) continue;
    for (let j = i + 1; j < out.length; j++) {
      const b = out[j];
      if (b === undefined || b.destroyed) continue;
      if (!orientedRectsOverlap(vehicleOrientedRect(a), vehicleOrientedRect(b))) continue;

      const impactSpeedMph = Math.max(a.speedMps, b.speedMps) * mphPerMps;
      const distanceM = vecLength(subtractVec(b.position, a.position));
      const awayFromA = distanceM > 0 ? { x: (b.position.x - a.position.x) / distanceM, y: (b.position.y - a.position.y) / distanceM } : { x: 1, y: 0 };
      const nudgeM = drivingCfg.collision.vehicleSeparationM / 2;

      const collidedA = stopAtObstacle(applyCollision(a, impactSpeedMph));
      const collidedB = stopAtObstacle(applyCollision(b, impactSpeedMph));
      out[i] = { ...collidedA, position: { x: a.position.x - awayFromA.x * nudgeM, y: a.position.y - awayFromA.y * nudgeM } };
      out[j] = { ...collidedB, position: { x: b.position.x + awayFromA.x * nudgeM, y: b.position.y + awayFromA.y * nudgeM } };
    }
  }
  return out;
}

/**
 * Every non-player, non-destroyed vehicle's REAL `decideAI` decision for
 * this tick, stored for `makeArenaDrivingSystem`/`makeArenaWeaponsSystem` to
 * read starting NEXT tick — matching `@/sim/loop`'s fixed system order
 * (`driving -> weapons -> projectiles -> deployables -> damage -> ai ->
 * cleanup`: `ai` runs after this tick's movement/fire/damage have already
 * resolved, deciding what each opponent does starting the FOLLOWING tick,
 * exactly like a human reacting to what it just saw). `decideAI` reads
 * `ctx.self`/`ctx.world` and returns nothing but an `InputFrame` — it never
 * touches `world.entities.vehicles` directly, so an opponent's movement and
 * fire still go through the exact same `stepDriving`/`fire` pipeline the
 * player's own input does.
 */
/**
 * `boundsFor` decides what the AI treats as the edge of the world, and the two
 * screens genuinely differ: an arena IS a fixed floor, a road is not.
 *
 * Defaulting to `arenaBounds` preserved the arena behaviour while silently giving
 * the ROAD one too — `showRoad` drove this same system, so road opponents were
 * bounded by a fixed box centred on the world ORIGIN. Drive far enough from origin
 * and every opponent believes it is out of bounds and steers back toward the
 * origin instead of fighting. `roadBounds(center)` was written for exactly this
 * and was never connected to anything; the gate reported it as dead code, which
 * it was, because it is the unwired half of a bug fix.
 */
export function makeArenaAISystem(
  playerVehicleId: string,
  opponents: ReadonlyMap<string, ArenaOpponentState>,
  aiInputs: Map<string, InputFrame>,
  boundsFor: (world: World) => ArenaBounds = () => arenaBounds(),
): SystemFn {
  return (world) => {
    const bounds = boundsFor(world);
    for (const vehicle of world.entities.vehicles) {
      if (vehicle.id === playerVehicleId || vehicle.destroyed) continue;
      const opponent = opponents.get(vehicle.id);
      if (opponent === undefined) continue;
      const ctx: AIContext = {
        self: vehicle,
        world: { tick: world.tick, bounds, vehicles: world.entities.vehicles, hazards: [], playerVehicleId },
        personality: opponent.personality,
        seed: opponent.seed,
      };
      aiInputs.set(vehicle.id, decideAI(ctx).input);
    }
  };
}

export function makeArenaDrivingSystem(
  driverRef: { current: DriverState },
  playerVehicleId: string,
  opponents: ReadonlyMap<string, ArenaOpponentState>,
  aiInputs: ReadonlyMap<string, InputFrame>,
): SystemFn {
  return (world, input, dtSeconds) => {
    const driven = world.entities.vehicles.map((vehicle) => {
      if (vehicle.destroyed) return vehicle;
      const isPlayer = vehicle.id === playerVehicleId;
      const vehicleInput = isPlayer ? input : (aiInputs.get(vehicle.id) ?? defaultInputFrame());
      const drivingSkill = isPlayer
        ? getSkill(driverRef.current, 'driving')
        : getSkill(requireOpponent(opponents, vehicle.id).driver, 'driving');
      const driveInput: DriveInput = { stick: { x: vehicleInput.moveX, y: vehicleInput.moveY } };
      return withWorldRng(world, (rng) =>
        stepDriving({
          vehicle,
          input: driveInput,
          dtSeconds,
          rng: { next: () => rng.nextFloat() },
          drivingSkill,
          surface: 'normal',
        }),
      ).vehicle;
    });
    world.entities.vehicles = resolveVehicleCollisions(driven);
  };
}

export function makeArenaWeaponsSystem(
  driverRef: { current: DriverState },
  playerVehicleId: string,
  opponents: ReadonlyMap<string, ArenaOpponentState>,
  aiInputs: ReadonlyMap<string, InputFrame>,
  projectileTargets: Map<string, string>,
  spawnCounter: { current: number },
  log: (kind: HudMessageKind, text: string) => void,
): SystemFn {
  return (world, input) => {
    world.entities.vehicles.forEach((vehicle, index) => {
      if (vehicle.destroyed) return;
      const isPlayer = vehicle.id === playerVehicleId;

      const cooled = tickCooldowns(vehicle, 1);
      world.entities.vehicles[index] = cooled;

      const vehicleInput = isPlayer ? input : (aiInputs.get(cooled.id) ?? defaultInputFrame());
      if (!vehicleInput.fire) return;

      const weapon = cooled.weapons[vehicleInput.weaponSlot];
      if (weapon === undefined || weapon.facing === 'UNDERBODY') return;
      const weaponDef = getWeapon(weapon.weaponId);

      const bearingTarget = findBearingTarget(cooled, weapon.facing, world.entities.vehicles, weaponDef.rangeM, weaponDef.minRangeM);
      const direction = facingWorldDirection(cooled.headingRad, weapon.facing);
      const targetPosition = bearingTarget?.position ?? {
        x: cooled.position.x + direction.x * weaponDef.rangeM,
        y: cooled.position.y + direction.y * weaponDef.rangeM,
      };
      const targetHeadingRad = bearingTarget?.headingRad ?? cooled.headingRad;

      const marksmanshipSkill = isPlayer
        ? getSkill(driverRef.current, 'marksmanship')
        : getSkill(requireOpponent(opponents, cooled.id).driver, 'marksmanship');
      const spawnedEntityId = `proj-${world.tick}-${spawnCounter.current}`;
      spawnCounter.current += 1;

      const result = withWorldRng(world, (rng) => {
        const command: FireCommand = {
          vehicle: cooled,
          weaponSlotIndex: vehicleInput.weaponSlot,
          target: { position: targetPosition, headingRad: targetHeadingRad },
          ctx: {
            rng,
            marksmanshipSkill,
            rangePenaltyPercent: 0,
            relativeMotionPenaltyPercent: 0,
            smokePenaltyPercent: 0,
            paintPenaltyPercent: 0,
          },
          tick: world.tick,
          spawnedEntityId,
          deployDropOffsetM: 2,
        };
        return fire(command);
      });
      world.entities.vehicles[index] = result.vehicle;
      if (!result.ok) {
        if (isPlayer && result.reason === 'NO_AMMO') log('info', t('ui.weapon.outOfAmmo', { weapon: weaponDef.name }));
        return;
      }
      if (result.spawn?.kind === 'PROJECTILE') {
        world.entities.projectiles.push(result.spawn.projectile);
        if (bearingTarget !== null) projectileTargets.set(spawnedEntityId, bearingTarget.id);
        if (isPlayer) log('hit', t('ui.weapon.fired', { weapon: weaponDef.name }));
      }
    });
  };
}

/**
 * Releases every projectile's pre-rolled outcome (see `@/sim/combat`'s file
 * header) onto the REAL target it was fired at, the moment it reaches that
 * target's oriented-rectangle collider or expires — whichever comes first —
 * via the real `applyResolvedShot` penetration chain. An opponent whose hit
 * report comes back `opponentDefeatedByReport` is marked `destroyed` and its
 * defeat is recorded through the real `recordOpponentDefeated` (never a
 * direct `matchState.opponentsDefeated` write). The player's own hits update
 * `driverRef` the same way, and a defeated PLAYER is marked `destroyed` too
 * (the exit handler below reads that to force an ON_FOOT exit).
 */
export function makeArenaDamageSystem(
  playerVehicleId: string,
  driverRef: { current: DriverState },
  opponents: Map<string, ArenaOpponentState>,
  projectileTargets: Map<string, string>,
  matchStateRef: { current: ArenaMatchState },
  log: (kind: HudMessageKind, text: string) => void,
): SystemFn {
  return (world) => {
    const collisionCfg = drivingConfig().collision;
    const remaining: ProjectileState[] = [];

    for (const projectile of world.entities.projectiles) {
      const targetId = projectileTargets.get(projectile.id);
      const targetIndex = targetId === undefined ? -1 : world.entities.vehicles.findIndex((v) => v.id === targetId);
      const target = targetIndex >= 0 ? world.entities.vehicles[targetIndex] : undefined;

      const reached =
        target !== undefined && circleIntersectsOrientedRect(projectile.position, collisionCfg.projectileRadiusM, vehicleOrientedRect(target));
      const expired = projectileExpired(projectile);

      if (!reached && !expired) {
        remaining.push(projectile);
        continue;
      }
      projectileTargets.delete(projectile.id);

      const { hit, damage, facing } = projectile.outcome;
      if (target === undefined || target.destroyed || !hit || facing === null) continue;

      const isTargetPlayer = target.id === playerVehicleId;
      const targetDriver = isTargetPlayer ? driverRef.current : requireOpponent(opponents, target.id).driver;
      const resolved = withWorldRng(world, (rng) =>
        applyResolvedShot({ vehicle: target, driver: targetDriver }, facing, damage, rng),
      );

      const defeated = opponentDefeatedByReport(resolved.report);
      const nextVehicle = defeated ? { ...resolved.target.vehicle, destroyed: true } : resolved.target.vehicle;
      world.entities.vehicles[targetIndex] = nextVehicle;

      if (isTargetPlayer) {
        driverRef.current = resolved.target.driver;
      } else {
        const entry = requireOpponent(opponents, target.id);
        opponents.set(target.id, { ...entry, driver: resolved.target.driver });
        if (defeated) {
          matchStateRef.current = recordOpponentDefeated(matchStateRef.current, resolved.report.driverDefeated);
          const remainingCount = matchStateRef.current.opponentsTotal - matchStateRef.current.opponentsDefeated;
          log('info', t('ui.arena.opponentDefeated', { remaining: String(remainingCount) }));
        }
      }
    }
    world.entities.projectiles = remaining;
  };
}

/**
 * The road's own damage system — same `applyResolvedShot` penetration chain
 * as `makeArenaDamageSystem` above (never a second physics/roll
 * implementation), but with no `ArenaMatchState` to record into: a road
 * encounter has no "match", just contacts that live or die. A defeated
 * opponent is marked `destroyed` and dropped from `opponents` here; turning
 * that into an actual `RoadWreck` at the right road position is the road
 * screen's own job (it reads `world.entities.vehicles` for any newly
 * `destroyed` non-player vehicle each tick — see `showRoad`), not this
 * system's, so this stays a plain sibling of the arena version rather than
 * growing an unrelated concern.
 */
export function makeRoadDamageSystem(
  playerVehicleId: string,
  driverRef: { current: DriverState },
  opponents: Map<string, ArenaOpponentState>,
  projectileTargets: Map<string, string>,
): SystemFn {
  return (world) => {
    const collisionCfg = drivingConfig().collision;
    const remaining: ProjectileState[] = [];

    for (const projectile of world.entities.projectiles) {
      const targetId = projectileTargets.get(projectile.id);
      const targetIndex = targetId === undefined ? -1 : world.entities.vehicles.findIndex((v) => v.id === targetId);
      const target = targetIndex >= 0 ? world.entities.vehicles[targetIndex] : undefined;

      const reached =
        target !== undefined && circleIntersectsOrientedRect(projectile.position, collisionCfg.projectileRadiusM, vehicleOrientedRect(target));
      const expired = projectileExpired(projectile);

      if (!reached && !expired) {
        remaining.push(projectile);
        continue;
      }
      projectileTargets.delete(projectile.id);

      const { hit, damage, facing } = projectile.outcome;
      if (target === undefined || target.destroyed || !hit || facing === null) continue;

      const isTargetPlayer = target.id === playerVehicleId;
      const targetDriver = isTargetPlayer ? driverRef.current : opponents.get(target.id)?.driver;
      if (targetDriver === undefined) continue;
      const resolved = withWorldRng(world, (rng) => applyResolvedShot({ vehicle: target, driver: targetDriver }, facing, damage, rng));

      const defeated = opponentDefeatedByReport(resolved.report);
      const nextVehicle = defeated ? { ...resolved.target.vehicle, destroyed: true } : resolved.target.vehicle;
      world.entities.vehicles[targetIndex] = nextVehicle;

      if (isTargetPlayer) {
        driverRef.current = resolved.target.driver;
      } else {
        const entry = opponents.get(target.id);
        if (entry !== undefined) opponents.set(target.id, { ...entry, driver: resolved.target.driver });
        if (defeated) opponents.delete(target.id);
      }
    }
    world.entities.projectiles = remaining;
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface RenderResources {
  readonly pipeline: GPURenderPipeline;
  readonly cameraBuffer: GPUBuffer;
  readonly cameraBindGroup: GPUBindGroup;
  readonly tileInstanceBuffer: GPUBuffer;
  readonly tileBindGroup: GPUBindGroup;
  readonly spriteInstanceBuffer: GPUBuffer;
  readonly spriteBindGroup: GPUBindGroup;
  readonly texture: GPUTexture;
}

const TILE_INSTANCE_CAPACITY = FLOOR_TILES_PER_SIDE * FLOOR_TILES_PER_SIDE;
const SPRITE_INSTANCE_CAPACITY = 16;

async function buildRenderResources(
  gpuCtx: GpuContext,
  atlasBitmap: ImageBitmap,
  spriteShaderSource: string,
): Promise<RenderResources> {
  const device = gpuCtx.getDevice();
  const format = gpuCtx.getFormat();

  const shaderModule = createShaderModule(device, 'sprite-shader', spriteShaderSource);
  const cameraLayout = createCameraBindGroupLayout(device);
  const atlasLayout = createAtlasBindGroupLayout(device);
  const pipeline = createLayerPipeline({
    device,
    shaderModule,
    targetFormat: format,
    cameraLayout,
    atlasLayout,
    blendMode: 'alpha-blend',
    label: 'world-sprites',
  });

  const cameraBuffer = createCameraUniformBuffer(device);
  const cameraBindGroup = createCameraBindGroup(device, cameraLayout, cameraBuffer);

  const texture = device.createTexture({
    label: 'atlas-0',
    size: { width: atlasBitmap.width, height: atlasBitmap.height, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: atlasBitmap }, { texture }, {
    width: atlasBitmap.width,
    height: atlasBitmap.height,
  });
  const textureView = texture.createView();
  const sampler = createAtlasSampler(device);

  const tileInstanceBuffer = createInstanceStorageBuffer(device, TILE_INSTANCE_CAPACITY);
  const tileBindGroup = createAtlasBindGroup(device, atlasLayout, tileInstanceBuffer, sampler, textureView);
  const spriteInstanceBuffer = createInstanceStorageBuffer(device, SPRITE_INSTANCE_CAPACITY);
  const spriteBindGroup = createAtlasBindGroup(device, atlasLayout, spriteInstanceBuffer, sampler, textureView);

  return { pipeline, cameraBuffer, cameraBindGroup, tileInstanceBuffer, tileBindGroup, spriteInstanceBuffer, spriteBindGroup, texture };
}

function buildFloorInstances(atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const frame: FrameInfo = atlasIndex.frame('tile-concrete-arena');
  const uv = frame.uv;
  const half = ARENA_HALF_SIZE_M;
  const instances: SpriteInstanceInput[] = [];
  for (let row = 0; row < FLOOR_TILES_PER_SIDE; row++) {
    for (let col = 0; col < FLOOR_TILES_PER_SIDE; col++) {
      instances.push({
        atlasId: '0',
        position: {
          x: col * FLOOR_TILE_SIZE_M - half + FLOOR_TILE_SIZE_M / 2,
          y: row * FLOOR_TILE_SIZE_M - half + FLOOR_TILE_SIZE_M / 2,
        },
        rotationRad: 0,
        sizeM: { x: FLOOR_TILE_SIZE_M, y: FLOOR_TILE_SIZE_M },
        uvRect: uv,
        tint: { r: 1, g: 1, b: 1, a: 1 },
        layer: 0,
      });
    }
  }
  return instances;
}

/** Composes a vehicle's render rotation from its simulation heading and its frame's `rotationOffsetDeg` — the exact seam a vehicle-orientation regression test drives directly, instead of reimplementing this formula (assets/ASSET-NOTES.md section 2). */
export function vehicleSpriteInstance(vehicle: VehicleState, atlasIndex: AtlasIndex): SpriteInstanceInput {
  const frame = atlasIndex.frame(`car-${vehicle.design.bodyId}`);
  return {
    atlasId: '0',
    position: { ...vehicle.position },
    rotationRad: vehicle.headingRad + degToRad(frame.rotationOffsetDeg),
    sizeM: VEHICLE_SPRITE_SIZE_M,
    uvRect: frame.uv,
    tint: { r: 1, g: 1, b: 1, a: 1 },
    layer: 1,
  };
}

// ---------------------------------------------------------------------------
// Screen 4: Arena
// ---------------------------------------------------------------------------

/**
 * Everything `persistArenaSession` needs to build a `SaveGame` from a live
 * session - whether that's the practice arena's own resumable tick-loop
 * (`world` non-null: `showArena`'s exit) or a driver safely back in a city
 * with no simulation in flight (`world: null`: `showArenaEvent`'s exit,
 * right after a real mission arena resolves). `quests` is the whole reason
 * this is a bag instead of `persistArenaSession`'s old three positional
 * params: threading a caller's REAL `CityRunState.quests` (or a resumed
 * save's own `quests`, on the practice-arena path) through to `SaveGame` is
 * the one thing this shape exists to make impossible to forget - the old
 * shape had no parameter for quests at all, which is exactly how it ended
 * up hardcoding `quests: []` on every single save.
 */
export interface PersistSessionInput {
  readonly openDb: () => Promise<IDBDatabase>;
  readonly driver: DriverState;
  /** `null` for a driver who owns no car right now (`CityRunState.vehicle`'s own contract). `SaveGame.activeVehicleId` is optional for exactly this case, so the save simply carries no vehicles and no active id. */
  readonly vehicle: VehicleState | null;
  readonly clock: Clock;
  readonly location: string;
  readonly quests: readonly QuestState[];
  /** The session seed driving `rngState` when `world` is `null` (no live World to read `rngState.seedKey` off of instead). */
  readonly sessionSeed: string;
  /** The live arena tick-loop `World` when mid-fight, or `null` once back in a city with no simulation in flight - `SaveGame.world`'s own documented contract. */
  readonly world: World | null;
}

/**
 * Best-effort autosave: two-phase-commits a `SaveGame` (via
 * `@/persist/save`) capturing either the live arena `World` — rngState (tick
 * position included), entities and all — or, once a mission arena resolves
 * and hands control back to the city, the driver/vehicle/quests state as it
 * stands right then with `world: null`. Either way `boot()`'s next
 * "Continue" (`resumeSession` below) restores it verbatim instead of ever
 * re-deriving a seed or dropping the campaign's quests. Failure (private
 * browsing blocking IndexedDB, etc.) is logged and swallowed — never
 * something the player should lose their run over.
 *
 * `arenaRecord` is deliberately never threaded into `SaveGame` here: nothing
 * in `@/sim/arena` or `@/persist/save` persists a running win/loss tally
 * today, by design (see `@/sim/victory`'s own `ArenaRecord` doc comment) — a
 * per-session, caller-tracked number, not save data, so `cityRunStateFromSaveGame`
 * below always resumes it at `{ wins: 0, losses: 0 }`, exactly as `startNewSession`
 * does for a brand-new driver.
 */
export async function persistArenaSession(input: PersistSessionInput): Promise<void> {
  const seed = input.world !== null ? seedKeyToDisplaySeed(input.world.rngState.seedKey) : input.sessionSeed;
  const vehicles: Record<string, VehicleState> = input.vehicle !== null ? { [input.vehicle.id]: input.vehicle } : {};
  // `exactOptionalPropertyTypes` is on, so an absent `activeVehicleId` has to
  // be an absent KEY, never `undefined` assigned to one.
  const activeId = input.vehicle !== null ? { activeVehicleId: input.vehicle.id } : {};
  const game: SaveGame = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rulesetVersion: 'classic-1',
    seed: seedFingerprint(seed),
    currentDay: input.clock.dayIndex,
    phase: input.clock.phase,
    location: input.location,
    driver: input.driver,
    ...activeId,
    vehicles,
    jobs: [],
    quests: input.quests,
    world: input.world,
    // Driver-level stream (jobs/quests/economy) - a substream of the same
    // session seed, independent of the world's own draws, per
    // `@/persist/save`'s `SaveGame.rngState` doc.
    rngState: createRng(seed).stream('driver').serialize(),
    lastSafeCitySnapshot: {
      day: input.clock.dayIndex,
      phase: input.clock.phase,
      location: input.location,
      driver: input.driver,
      vehicles,
      ...activeId,
    },
    controlPreset: currentControlPreset,
    controlBindings: currentControlBindings,
  };
  try {
    const db = await input.openDb();
    await save(db, game);
  } catch (error) {
    console.warn('smduel: autosave failed', error);
  }
}

/**
 * Builds a fresh new-game arena `World`, seeded from the resolved session
 * seed - never re-derived, never the clock. Exported (not inlined in
 * `showArena`) as a seam: it's the exact production code the session seed's
 * reproducibility contract depends on, so a test can drive THIS function
 * directly instead of a parallel reimplementation that could silently drift
 * from it (and, as a copy, would never notice this line getting mutated).
 */
export function createArenaWorld(sessionSeed: string, playerVehicle: VehicleState): World {
  const world = createWorld({
    rngSeed: 0, // placeholder - replaced immediately below by the real session-seeded RNG state
    arena: { id: ARENA_EVENT_ID, kind: 'arena' },
    entities: { vehicles: [playerVehicle] },
  });
  world.rngState = createRng(sessionSeed).serialize();
  return world;
}

export interface ArenaSession {
  /** The seed driving this world's RNG - resolved once at new-game time, or recovered from a restored save. Never re-derived mid-session. */
  readonly sessionSeed: string;
  /** A restored save's live World, reused verbatim (rngState, tick position and all) instead of building a fresh one. Absent for a brand-new session. */
  readonly restoreWorld?: World;
  readonly openDb: () => Promise<IDBDatabase>;
  /** A resumed save's own campaign quests, threaded through so `showArena`'s own exit-autosave (`persistArenaSession`) never wipes them back to `[]` — absent (defaults to `[]`) for a brand-new practice session, which has no campaign quests to carry. */
  readonly quests?: readonly QuestState[];
}

/** What `resolveArenaWorld` hands back: either the World + driver `showArena` should run with, or a human-readable refusal (e.g. can't afford the practice fee) for the caller to display instead of entering the arena. */
export type ArenaWorldResolution =
  | { readonly ok: true; readonly chargedDriver: DriverState; readonly world: World }
  | { readonly ok: false; readonly reason: string };

/**
 * Decides, and builds, the World + driver `showArena` runs with - the exact
 * branch between reusing a restored save's live World verbatim and charging
 * the practice fee then building a brand-new one from `session.sessionSeed`
 * via `createArenaWorld`. Extracted out of `showArena` (which also owns a
 * live `root`/canvas and can't be driven headlessly) as its own DOM-free
 * seam, so a test can drive this exact decision directly - including the
 * `createArenaWorld(session.sessionSeed, playerVehicle)` call site - instead
 * of only the `createArenaWorld` half of it.
 */
export function resolveArenaWorld(driver: DriverState, playerVehicle: VehicleState, session: ArenaSession): ArenaWorldResolution {
  if (session.restoreWorld !== undefined) {
    // Resuming a save: the practice fee was already charged (and the match
    // already begun) the first time this session entered the arena, so
    // `driver` here IS that already-charged state - beginArenaMatch must not
    // run a second time and charge it again. `world` is the exact restored
    // World - rngState (tick position included), entities and all - never
    // rebuilt and never reseeded.
    return { ok: true, chargedDriver: driver, world: session.restoreWorld };
  }
  const matchResult = beginArenaMatch(driver, { design: playerVehicle.design, destroyed: false }, ARENA_EVENT_ID);
  if (!matchResult.ok) return { ok: false, reason: matchResult.reason };
  return { ok: true, chargedDriver: matchResult.driver, world: createArenaWorld(session.sessionSeed, playerVehicle) };
}

function showArena(
  root: HTMLElement,
  driver: DriverState,
  playerVehicle: VehicleState,
  session: ArenaSession,
  onExit: () => void,
): void {
  const container = el('div', 'sm-screen sm-screen--arena');
  container.style.cssText = 'position:absolute;inset:0;background:#05070a;';
  const canvas = el('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  const hudHost = el('div');
  hudHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  const status = el('div');
  status.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);max-width:min(700px, calc(100vw - 260px));color:#d7e0ea;font-family:system-ui,sans-serif;font-size:13px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;text-align:center;';
  const exitBtn = el('button', undefined, t('ui.arena.exitToTitle'));
  exitBtn.style.cssText =
    'position:absolute;top:8px;right:8px;pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';
  const retryBtn = el('button');
  retryBtn.style.cssText =
    'position:absolute;top:36px;left:50%;transform:translateX(-50%);pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';
  container.appendChild(canvas);
  container.appendChild(hudHost);
  container.appendChild(status);
  container.appendChild(retryBtn);
  container.appendChild(exitBtn);
  clearAndAppend(root, container);

  lastSessionSeed = session.sessionSeed;
  const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);

  const resolution = resolveArenaWorld(driver, playerVehicle, session);
  if (!resolution.ok) {
    status.textContent = t('ui.arena.cannotEnterPractice', { reason: resolution.reason });
    exitBtn.addEventListener('click', onExit, { once: true });
    return;
  }
  const { chargedDriver, world } = resolution;

  const driverRef = { current: chargedDriver };
  const spawnCounter = { current: 0 };
  const messages: HudMessage[] = [];
  let messageCounter = 0;
  function logMessage(kind: HudMessageKind, text: string): void {
    messages.push({ id: `msg-${messageCounter}`, kind, text, tick: world.tick });
    messageCounter += 1;
    if (messages.length > 20) messages.shift();
  }
  console.info(`smduel: session seed ${session.sessionSeed}`);
  logMessage(
    'info',
    session.restoreWorld !== undefined
      ? t('ui.arena.practiceResumed', { seed: session.sessionSeed })
      : t('ui.arena.practiceEntered', { seed: session.sessionSeed }),
  );

  const systems = createSystemsRegistry();
  systems.register('driving', makeDrivingSystem(driverRef));
  systems.register('weapons', makeWeaponsSystem(driverRef, spawnCounter, logMessage));
  systems.register('projectiles', projectilesSystem);
  systems.register('cleanup', cleanupSystem);

  // --- input --------------------------------------------------------------
  const codesDown = new Set<string>();
  const inputTracking = attachCodeTracking(codesDown);
  const weaponSelection = makeWeaponSelection(() => findPlayer(world)?.weapons.length ?? 0);
  const touch = mountTouchControls(container, { fire: true, commands: weaponTouchCommands(weaponSelection, playerVehicle) });

  function sampleInput(): InputFrame {
    const raw = rawInputFrom(codesDown, touch);
    weaponSelection.update(raw);
    const resolved = resolveInput(raw, currentControlPreset, currentControlBindings);
    return { moveX: resolved.moveX, moveY: resolved.moveY, fire: resolved.fire, weaponSlot: weaponSelection.active() ?? NO_WEAPON_SLOT };
  }

  const loop = createGameLoop({ world, dtSeconds, systems, sampleInput });

  // --- HUD ------------------------------------------------------------------
  const hudContainer = document.createElement('div');
  hudContainer.style.pointerEvents = 'auto';
  hudHost.appendChild(hudContainer);
  const hudDoc = new DomHudDocument();
  const hudRoot = new DomHudElement(hudContainer);
  let hudSettings: HudSettings = { scale: 1, radarOrientation: 'world', reducedFlash: false, reducedShake: false };

  function renderHudFrame(): void {
    const player = findPlayer(world);
    if (player === undefined) return;
    const plant = getPlant(player.design.plantId);
    const accelMphPerSec = computeBuild(player.design).accelMphPerSec;
    const snapshot: HudSnapshot = {
      vehicle: player,
      activeWeaponIndex: weaponSelection.active(),
      accelMphPerSec,
      radar: { enabled: !isRadarDisabled(player.plantDP, plant.radarFailureThreshold), contacts: [] },
      driver: { naturalHealth: driverRef.current.naturalHealth, bodyArmor: driverRef.current.bodyArmor },
      messages,
      settings: hudSettings,
    };
    renderHud(hudDoc, hudRoot, snapshot, {
      onToggleRadarOrientation: () => {
        hudSettings = { ...hudSettings, radarOrientation: hudSettings.radarOrientation === 'world' ? 'heading' : 'world' };
        renderHudFrame();
      },
      onToggleReducedFlash: () => {
        hudSettings = { ...hudSettings, reducedFlash: !hudSettings.reducedFlash };
        renderHudFrame();
      },
      onToggleReducedShake: () => {
        hudSettings = { ...hudSettings, reducedShake: !hudSettings.reducedShake };
        renderHudFrame();
      },
    });
  }

  // --- WebGPU ---------------------------------------------------------------
  let gpuCtx: GpuContext | undefined;
  let resources: RenderResources | undefined;
  let atlasIndex: AtlasIndex | undefined;
  let floorInstances: SpriteInstanceInput[] = [];
  const camera: Camera = createCamera();
  camera.setZoom(PIXELS_PER_METER_CSS);

  async function initRenderer(): Promise<void> {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const init = await initGpu(canvas);
    if (!init.ok) {
      status.textContent = t('ui.arena.webgpuUnavailable', { reason: init.reason.kind });
      return;
    }
    gpuCtx = init.context;
    status.textContent = t('ui.arena.practiceHint', { seed: session.sessionSeed });

    atlasIndex = loadAtlasIndex(atlasManifestRaw);
    floorInstances = buildFloorInstances(atlasIndex);

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    resources = await buildRenderResources(gpuCtx, atlasBitmap, spriteShaderSource);

    gpuCtx.onRecovered(() => {
      void buildRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource).then((rebuilt) => {
        resources = rebuilt;
      });
    });
    gpuCtx.onRecoveryFailed(() => {
      resources = undefined;
    });
    wireRecoveryUi(gpuCtx, retryBtn, (text) => {
      status.textContent = text;
    });
  }

  function renderFrame(): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;
    const player = findPlayer(world);
    if (player === undefined) return;

    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setCenter(player.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    const spriteInstances = [vehicleSpriteInstance(player, atlasIndex)];
    writeInstanceBuffer(gpuCtx.getDevice(), resources.tileInstanceBuffer, packInstances(floorInstances));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.spriteInstanceBuffer, packInstances(spriteInstances));

    const encoder = gpuCtx.getDevice().createCommandEncoder({ label: 'frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpuCtx.getContext().getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.tileBindGroup, instanceCount: floorInstances.length },
    ]);
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.spriteBindGroup, instanceCount: spriteInstances.length },
    ]);
    pass.end();
    gpuCtx.getDevice().queue.submit([encoder.finish()]);
  }

  // --- main loop --------------------------------------------------------------
  let rafHandle = 0;
  let lastTimeMs = performance.now();
  let stopped = false;
  function frame(nowMs: number): void {
    if (stopped) return;
    // Clamped to >= 0: a `requestAnimationFrame` timestamp reflects when the
    // frame started, which can land before a `performance.now()` sampled
    // after an intervening `await` (e.g. `initRenderer()`'s fetches) —
    // measured going negative (~-7ms) on the very first frame after asset
    // load, which `loop.advance` rejects outright (see its own RangeError).
    const deltaSeconds = Math.max(0, Math.min((nowMs - lastTimeMs) / 1000, 0.25));
    lastTimeMs = nowMs;
    loop.advance(deltaSeconds);
    renderFrame();
    renderHudFrame();
    rafHandle = window.requestAnimationFrame(frame);
  }

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    inputTracking.detach();
    touch?.destroy();
    gpuCtx?.destroy();
  }

  exitBtn.addEventListener('click', () => {
    stop();
    const player = findPlayer(world);
    if (player !== undefined) {
      void persistArenaSession({
        openDb: session.openDb,
        driver: chargedDriver,
        vehicle: player,
        clock: world.clock,
        location: ARENA_EVENT_ID,
        quests: session.quests ?? [],
        sessionSeed: session.sessionSeed,
        world,
      });
    }
    onExit();
  });

  void initRenderer().finally(() => {
    lastTimeMs = performance.now();
    rafHandle = window.requestAnimationFrame(frame);
  });
}


// ---------------------------------------------------------------------------
// Session state threaded between City / Building / Road / Arena screens
// ---------------------------------------------------------------------------

/**
 * Everything the city/road loop carries from screen to screen after the
 * constructor. Modeled on `@/sim/economy`'s single-active-vehicle
 * `EconomyWorld` (the same shape `@/ui/buildings/garage` already reads/
 * writes through `BuildingContext`) rather than `@/sim/services`'s separate
 * multi-car `Fleet` - a full garaged-fleet UI (retrieving a DIFFERENT
 * stored car) is out of this integration pass's scope; `fleetSize` is
 * fixed at 1 (the one active vehicle) so `@/ui/buildings/assembly`'s
 * fleet-cap gate still works honestly off a real number.
 */
export interface CityRunState {
  readonly driver: DriverState;
  /**
   * The car the driver is CURRENTLY in, or `null` when they own none — a
   * driver who sold their last car at a salvage yard, or who walked out of a
   * house-sourced arena event in a loaner that went back to the house
   * (arenas.json's `houseVehicle.salvageable: false`). Nullable because the
   * game genuinely reaches that state and two rules depend on it being
   * representable: `@/ui/buildings/salvage`'s `sell-car` cannot otherwise
   * stick (the sale used to be undone on the way out, paying again on the
   * next visit), and `@/sim/arena`'s `eligibilityFor` opens amateur-night's
   * `on-foot-under-threshold` branch by REFUSING any non-null vehicle, so a
   * permanently non-null field made the broke driver's on-ramp unreachable.
   *
   * `@/persist/save`'s `SaveGame.activeVehicleId` has always been optional,
   * so persistence already modeled this; only the in-memory run state did
   * not. Every screen that genuinely needs a car refuses with a reason the
   * player can read (see `openGatePrompt`), rather than asserting non-null.
   */
  readonly vehicle: VehicleState | null;
  readonly vehicleStored: boolean;
  readonly clock: Clock;
  readonly cityId: string;
  readonly sessionSeed: string;
  readonly openDb: () => Promise<IDBDatabase>;
  /** One seeded stream for the whole session's non-arena, non-road draws (courier offers, casino, mechanic lessons, illicit-sale consequences) plus road-trip encounter rolls - advances as it's drawn from, same convention `@/sim/world`'s `rngState` uses. */
  readonly rng: Rng;
  /** `BootOptions.search`, threaded down so the arena exit handler can read `?arcade=1` (`@/arcade/client`'s `arcadeScoringEnabled`) without a new module-level global. */
  readonly search: string;
  readonly rumorsHeardToday: ReadonlyMap<string, RumorId>;
  readonly activeCourierJobs: readonly AcceptedJob[];
  /**
   * Every car this driver owns beyond (or instead of) `vehicle` — `@/sim/fleet`'s
   * real `Fleet`, up to economy.json's `maxFleetSize` (8). `vehicle` above stays
   * the single source of truth for whichever car is CURRENTLY active (garage's
   * own store/retrieve panel, arena, and road combat all read/write it exactly
   * as before) — `fleet` never carries a live copy of the active car mid-drive,
   * only a placeholder synced in immediately before the Fleet screen reads it or
   * a switch/purchase mutates it (see `syncActiveIntoFleet`), so a car doesn't
   * accumulate stale armor/cargo in two places at once.
   */
  readonly fleet: Fleet;
  /** Per-route repopulation progress (`@/sim/encounters`) — a route just cleared of every hostile goes quiet, then slowly repopulates. Keyed by `RouteDef.id`. */
  readonly routeHistory: ReadonlyMap<string, RouteEncounterHistory>;
  /**
   * Campaign quest save-state (`@/persist/save`'s `QuestState[]`) — the same
   * container `@/ui/journal` and every facility with a `clueChain` hop
   * (`@/ui/buildings/bar`/`truckstop`/etc, via `BuildingContext.quests`)
   * already read and write. This is the ONE copy of it for the whole city/
   * road/arena session; `buildingContextFrom`/`applyBuildingContext` below
   * are what thread it through a building visit unchanged (or updated, once
   * a clue is investigated).
   */
  readonly quests: readonly QuestState[];
  /**
   * Running arena win/loss tally for THIS session — not persisted, not
   * derived from anything else (`@/sim/arena`'s own resolution is a
   * per-match outcome, see `@/sim/victory`'s own `ArenaRecord` doc comment
   * on why this is a caller-tracked input rather than data `@/sim/arena`
   * keeps itself). Only `showArenaEvent`'s exit handler below writes to
   * this, counting a `VICTORY` resolution as a win and a `FORFEIT` as a
   * loss; `ESCAPE` (leaving without clearing the roster) counts as neither.
   */
  readonly arenaRecord: ArenaRecord;
}

/**
 * Rebuilds a real, playable `CityRunState` (quests included) from a
 * `SaveGame` written while the driver was safely in a city — `game.world`
 * is `null`, the exact condition `resumeSession` below now checks before
 * calling this, rather than either routing to the mid-arena-only `showArena`
 * screen or discarding the save and starting over (both of which is all it
 * ever did before, for every save `persistArenaSession` could produce with
 * `world: null`). Exported (DOM-free) as its own seam, same convention as
 * `resolveArenaWorld`/`createArenaWorld` above, so a test can drive this
 * exact reconstruction — including a real `quests` round trip through a real
 * `save()`/`load()` — without booting a screen.
 *
 * Fields `@/persist/save`'s `SaveGame` has no room for today —
 * `vehicleStored`, `rumorsHeardToday`, `activeCourierJobs`, `routeHistory`,
 * and every `fleet` entry beyond the one active `vehicle` — fall back to the
 * same "nothing yet" defaults a brand-new session starts with in
 * `startNewSession` below. That is a pre-existing gap in what `SaveGame`
 * captures, not a new decision this function makes; closing it is a
 * `@/persist/save` schema change out of this fix's scope. `arenaRecord`
 * resets to `{ wins: 0, losses: 0 }` for the reason documented on
 * `CityRunState.arenaRecord` and on `persistArenaSession` above: it is
 * deliberately never save data.
 */
export function cityRunStateFromSaveGame(
  game: SaveGame,
  /** `null` resumes a driver who owns no car, the state `SaveGame.activeVehicleId`'s optionality has always described. They resume on foot, exactly where the save left them, rather than losing the run to a fresh session. */
  vehicle: VehicleState | null,
  options: { readonly openDb: () => Promise<IDBDatabase>; readonly search: string; readonly randomSeed?: () => string },
): CityRunState {
  const savedSeed = seedKeyToDisplaySeed(game.rngState.seedKey);
  const sessionSeed = resolveSessionSeed(
    options.randomSeed !== undefined
      ? { search: options.search, savedSeed, randomSeed: options.randomSeed }
      : { search: options.search, savedSeed },
  );
  // Restored to the exact saved position (never re-seeded from scratch) -
  // `game.rngState` is already the driver-level substream `startNewSession`
  // itself creates (`createRng(sessionSeed).stream('driver')`), so restoring
  // it directly into a fresh root reproduces that substream verbatim.
  const rng = createRng(sessionSeed);
  rng.restore(game.rngState);
  return {
    driver: game.driver,
    vehicle,
    vehicleStored: false,
    clock: { dayIndex: game.currentDay, phase: game.phase },
    cityId: game.location,
    sessionSeed,
    openDb: options.openDb,
    rng,
    search: options.search,
    rumorsHeardToday: new Map(),
    activeCourierJobs: [],
    fleet: { vehicles: vehicle !== null ? [{ vehicle, stored: false, cityId: game.location }] : [] },
    routeHistory: new Map(),
    quests: game.quests,
    arenaRecord: { wins: 0, losses: 0 },
  };
}

/**
 * The `BuildingContext` a facility panel is handed on entry. Exported as a
 * test seam, the same convention `reconcileFleetWithVehicle`/
 * `fleetAfterBuildingVisit`/`cityRunStateFromSaveGame` already stand on:
 * paired with `applyBuildingContext` below it is the ENTIRE round trip a
 * building visit makes through `CityRunState`, so a test can drive "walk in,
 * transact, walk out, walk back in" without booting a screen.
 */
export function buildingContextFrom(state: CityRunState): BuildingContext {
  return {
    driver: state.driver,
    clock: state.clock,
    cityId: state.cityId,
    vehicle: state.vehicle,
    vehicleStored: state.vehicleStored,
    fleetSize: fleetVehicleCount(state.fleet),
    existingCarNames: [
      ...(state.vehicle !== null ? [state.vehicle.design.name] : []),
      ...state.fleet.vehicles.map((entry) => entry.vehicle.design.name),
    ],
    rng: state.rng,
    rumorsHeardToday: state.rumorsHeardToday,
    activeCourierJobs: state.activeCourierJobs,
    routeHistory: state.routeHistory,
    quests: state.quests,
  };
}

/**
 * The `driver`/`vehicle` side effects of a quest's own `onAccept` data,
 * applied exactly once — the instant a reveal (`@/ui/journal`'s
 * `applyInvestigateAction`, called from inside whatever facility panel just
 * exited) crosses a quest's `clueChain` from partially to FULLY revealed.
 * Detected generically by comparing `previousQuests` (this session's quest
 * state before the visit) against `ctx.quests` (after) — never by name,
 * never by quest id: any quest whose `onAccept.destroyClone`/`onAccept.
 * setFlag` data crosses that same threshold gets the same treatment.
 *
 * `onAccept.setFlag` itself is already applied by `@/ui/journal`'s
 * `revealNextHop` (real data, folded into `QuestState.flags` the moment the
 * chain completes) — this function only adds the two side effects that
 * data implies OUTSIDE `QuestState` itself, which `@/ui/journal` has no
 * access to mutate: `driver.cloneCityId`/`cloneSkills` (a `destroyClone`
 * quest's "no second attempt", `@/sim/driver`'s own clone fields), and
 * loading the quest's own `cargo` onto the active vehicle under
 * `questCargoId(quest.id)` — the reachable stand-in for a dedicated
 * "accept" screen this codebase doesn't have; there is no other moment
 * that data could enter the vehicle for a caller to later hand to
 * `@/sim/victory`'s `deliverQuest`.
 */
export function applyQuestAcceptEffects(previousQuests: readonly QuestState[], ctx: BuildingContext): BuildingContext {
  const quests = ctx.quests ?? [];
  let driver = ctx.driver;
  let vehicle = ctx.vehicle;

  for (const state of quests) {
    const def = journalQuestDef(state.id);
    if (def === undefined) continue;
    const wasComplete = (previousQuests.find((q) => q.id === state.id)?.stage ?? 0) >= def.clueChain.length;
    const isComplete = state.stage >= def.clueChain.length;
    if (wasComplete || !isComplete) continue; // only the exact crossing, never a re-fire on a later visit

    if (def.onAccept?.destroyClone === true) {
      driver = { ...driver, cloneCityId: null, cloneSkills: null };
    }
    if (vehicle !== null) {
      const cargoId = questCargoId(def.id);
      if (!vehicle.cargo.some((item) => item.id === cargoId)) {
        vehicle = {
          ...vehicle,
          cargo: [
            ...vehicle.cargo,
            {
              id: cargoId,
              kind: 'payload',
              weightLb: def.cargo.weightLb,
              spaces: def.cargo.spaces,
              integrity: economy()._reconstruction.cargoFullIntegrity,
            },
          ],
        };
      }
    }
  }

  return driver === ctx.driver && vehicle === ctx.vehicle ? ctx : { ...ctx, driver, vehicle };
}

/**
 * Auto-delivery: entering a facility that is some accepted (chain fully
 * revealed), not-yet-completed quest's OWN `destination` (`{cityId,
 * facility}`, real quests.json data — never a quest id or facility kind
 * literal) delivers it right then, through the real `@/sim/victory`'s
 * `deliverQuest`, the same way walking up to a courier destination would if
 * this codebase had a separate confirm step for that either — there is no
 * dedicated "deliver" menu row anywhere in this UI, so arriving with the
 * cargo aboard IS the delivery action. Generic over every quest destination
 * quests.json defines, not just the campaign's victory quest.
 *
 * Lateness is intentionally never assessed here (`dueDay` is always
 * `+Infinity`): `CityRunState`/`QuestState` keep no record of the day a
 * quest was actually accepted (only `AcceptedJob`, the courier system's own
 * unrelated ledger, does), so there is no honest due-day to compute for a
 * quest whose `dueDays` isn't `null` — `the-boss-tape`, the one quest this
 * integration pass actually has to prove wins the game, sets `dueDays:
 * null` (no deadline) precisely so this simplification never touches it.
 */
export function attemptQuestDelivery(
  state: CityRunState,
  facilityKind: string,
): { readonly state: CityRunState; readonly result: QuestDeliverResult | null; readonly def: QuestDef | null } {
  // A quest's payload rides in the active vehicle's `cargo` (see
  // `applyQuestAcceptEffects`, which is equally a no-op with no vehicle to
  // load it onto), so a driver with no car is carrying nothing to deliver.
  // `deliverQuest` would answer CARGO_MISSING for every quest; asking it is
  // pointless work, and it has no null vehicle to answer about anyway.
  const vehicle = state.vehicle;
  if (vehicle === null) return { state, result: null, def: null };

  for (const def of questDefs()) {
    if (def.destination.cityId !== state.cityId || def.destination.facility !== facilityKind) continue;
    const existing = state.quests.find((q) => q.id === def.id);
    if (existing === undefined || existing.completed || existing.stage < def.clueChain.length) continue;

    const result = deliverQuest(def, state.quests, state.driver, vehicle, state.cityId, facilityKind, state.clock, Number.POSITIVE_INFINITY);
    if (result.outcome !== 'DELIVERED' && result.outcome !== 'LATE') continue; // WRONG_LOCATION/CARGO_MISSING/ALREADY_DELIVERED: nothing to apply
    return {
      state: { ...state, driver: result.driver, vehicle: result.vehicle, quests: result.quests },
      result,
      def,
    };
  }
  return { state, result: null, def: null };
}

/**
 * Victory screen: a real `@/sim/victory` delivery whose own `onDeliver.
 * victory` came back `true` (see `attemptQuestDelivery`'s call site in
 * `openFacility`). Just the summary (`victorySummaryLines`, every line
 * already through `t()`) plus one "Continue" row — `onContinue` hands
 * control straight back to `showCity` with the SAME `runState` the delivery
 * already updated, proving the sandbox survives victory rather than ending
 * the session (`the-boss-tape`'s own `onDeliver.sandboxContinues: true`).
 */
function showVictory(root: HTMLElement, state: CityRunState, summary: ReturnType<typeof buildVictorySummary>, onContinue: () => void): void {
  const container = el('div', 'sm-screen sm-screen--victory');
  container.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
  const menuHost = el('div');
  menuHost.style.cssText = 'width:min(420px,90vw);max-height:90vh;overflow:auto;';
  container.appendChild(menuHost);
  clearAndAppend(root, container);

  const actions: MenuAction[] = victorySummaryLines(summary).map((label, index) => ({
    id: `victory-line-${index}`,
    label,
    eligible: false,
    reason: label,
  }));
  actions.push({ id: LEAVE_ACTION_ID, label: t('victory.continue'), eligible: true });

  const mounted = mountMenu({
    container: menuHost,
    header: { cash: state.driver.cash, dayIndex: state.clock.dayIndex, phase: state.clock.phase, cityName: cityName(state.cityId) },
    actions,
    onActivate: (id) => {
      if (id === LEAVE_ACTION_ID) {
        mounted.destroy();
        onContinue();
      }
    },
    onBack: () => {
      mounted.destroy();
      onContinue();
    },
  });
}

/**
 * Garage's own store/retrieve panel (`@/ui/buildings/garage`) still runs
 * entirely on `@/sim/economy`'s single-vehicle `EconomyWorld` model
 * (`vehicle`/`vehicleStored`) — reconciling that with `@/sim/fleet`'s
 * separate multi-car `Fleet` model happens HERE, at the one boundary where
 * a building's output re-enters `CityRunState`, rather than by rewriting
 * either already-tested module to know about the other. A garage visit
 * that flips `vehicleStored` true/false is mirrored onto `fleet`'s own
 * active-vehicle entry (added fresh if this is the driver's only car and
 * `fleet` doesn't have an entry for it yet) so the Fleet screen's roster
 * and garage's own storage state can never silently disagree.
 */
export function reconcileFleetWithVehicle(fleet: Fleet, vehicle: VehicleState, vehicleStored: boolean, cityId: string): Fleet {
  // A destroyed vehicle is gone for good — `@/sim/fleet`'s own `removeVehicle`
  // docblock names exactly this case. Every screen that hands a live vehicle
  // back through this one seam (arena exit, road arrival, the Fleet roster,
  // opening the constructor) still has to carry SOME `VehicleState` in
  // `CityRunState.vehicle` (it can never be null), so without this guard the
  // very next reconciliation call would silently re-add the wreck as a real,
  // active roster entry — undoing whatever dropped it moments earlier and
  // leaving exactly the ghost `removeVehicle` exists to prevent.
  if (vehicle.destroyed) {
    const removed = removeVehicle(fleet, vehicle.id);
    return removed.ok ? removed.fleet : fleet;
  }
  const index = fleet.vehicles.findIndex((entry) => entry.vehicle.id === vehicle.id);
  const entry: FleetVehicle = { vehicle, stored: vehicleStored, cityId };
  if (index === -1) return { vehicles: [...fleet.vehicles, entry] };
  const vehicles = fleet.vehicles.slice();
  vehicles[index] = entry;
  return { vehicles };
}

/**
 * Folds a building panel's own vehicle change back onto `fleet` — the same
 * one seam every building exit reconciles through (`applyBuildingContext`
 * below). `ctx.vehicle` turns up null only from the salvage yard's own
 * 'sell-car' action (`@/ui/buildings/salvage.ts`); every other currently-wired
 * panel at most flips `vehicleStored` and this just reconciles the (still
 * non-null) vehicle in as usual. A sale is gone for good exactly like a
 * destroyed active car (`reconcileFleetWithVehicle`'s own `vehicle.destroyed`
 * branch above) — `previousVehicleId` (the same vehicle's id, read by the
 * caller off `state.vehicle` before the sale, since `ctx.vehicle` itself is
 * null and carries no id to remove) is dropped from the roster via
 * `removeVehicle`. Falling back to the pre-sale vehicle and reconciling it
 * back in as if nothing happened — the previous behavior — is the exact
 * ghost-roster-entry bug `removeVehicle` was wired up to close, on top of
 * having already paid out the sale price for a car still sitting in the
 * fleet.
 */
export function fleetAfterBuildingVisit(fleet: Fleet, previousVehicleId: string | null, ctx: BuildingContext): Fleet {
  if (ctx.vehicle === null) {
    // `null` previousVehicleId: the driver walked in with no car at all, so
    // there is no roster entry a null `ctx.vehicle` could be reporting the
    // loss of. Nothing to remove.
    if (previousVehicleId === null) return fleet;
    const removed = removeVehicle(fleet, previousVehicleId);
    return removed.ok ? removed.fleet : fleet;
  }
  return reconcileFleetWithVehicle(fleet, ctx.vehicle, ctx.vehicleStored, ctx.cityId);
}

/**
 * Applies a `BuildingContext` a panel handed back on exit onto `state` -
 * every field a building can actually change, nothing else.
 *
 * Paired with `buildingContextFrom` above this is the whole round trip, and
 * both halves are exported so a test can drive it without booting a screen.
 *
 * `ctx.vehicle` is taken verbatim, null included. The salvage yard's own
 * 'sell-car' hands back `vehicle: null` to mean "this car is GONE", and
 * `CityRunState.vehicle` is nullable precisely so that survives the exit.
 * This used to read `ctx.vehicle ?? state.vehicle`, which treated that
 * deliberate null as "no value supplied" and restored the pre-sale car — the
 * money printer (sell, keep cash, keep car, sell again) reported from the
 * live site, and the reason amateur-night could never be entered.
 */
export function applyBuildingContext(state: CityRunState, ctx: BuildingContext): CityRunState {
  return {
    ...state,
    driver: ctx.driver,
    clock: ctx.clock,
    cityId: ctx.cityId,
    vehicle: ctx.vehicle,
    vehicleStored: ctx.vehicleStored,
    fleet: fleetAfterBuildingVisit(state.fleet, state.vehicle?.id ?? null, ctx),
    rumorsHeardToday: ctx.rumorsHeardToday,
    activeCourierJobs: ctx.activeCourierJobs,
    routeHistory: ctx.routeHistory,
    quests: ctx.quests ?? state.quests,
  };
}

// ---------------------------------------------------------------------------
// Screen 4b: Arena, entered from a city's arena building
// ---------------------------------------------------------------------------
//
// Reuses the exact rendering/input/HUD helpers `showArena` (the boot-time
// practice screen below `resolveArenaWorld`) already built - real driving,
// real weapon fire, real projectiles, real HUD. `mountArenaBuilding`
// (`@/ui/buildings/arena`) already ran the real `beginArenaMatch` before
// this screen ever mounts, so eligibility and the entry fee are exactly as
// real as the boot-time path.
/** Distinguishes the two eligible rows from the read-only summary/status rows above them. */
const ARCADE_SUBMIT_ACTION_ID = 'arcade-submit-score';

/**
 * Wording for an `ArcadeSubmitFailure`, resolved HERE rather than in
 * `@/arcade/client`, so every player-visible sentence still lives in
 * strings.json (see `@/ui/strings`'s header on why that seam exists). A
 * `score-refused` carries the arcade server's OWN rejection reason when it
 * sent one; that text is the server's to word, not this table's, so it is
 * passed through as a parameter instead of being restated here.
 */
function arcadeFailureText(failure: ArcadeSubmitFailure): string {
  switch (failure.kind) {
    case 'unreachable':
      return t('ui.arena.scoreSubmit.errorUnreachable');
    case 'run-refused':
      return t('ui.arena.scoreSubmit.errorRunRefused', { status: failure.status });
    case 'no-token':
      return t('ui.arena.scoreSubmit.errorNoToken');
    case 'score-refused':
      return failure.serverMessage ?? t('ui.arena.scoreSubmit.errorScoreRefused', { status: failure.status });
    case 'not-accepted':
      return t('ui.arena.scoreSubmit.errorNotAccepted');
  }
}

/**
 * Arcade leaderboard submit screen — shown instead of calling `onComplete`
 * straight away when a real run just won AND arcade scoring is switched on
 * (see `showArenaEvent`'s exit handler below for the gate). Same screen
 * shape as `showVictory` above: read-only summary rows plus real action
 * rows, `mountMenu` driving a `menuHost` div.
 *
 * The name `<input>` is a SIBLING of `menuHost`, never inside it —
 * `mountMenu`'s own `render()` does `container.innerHTML = ''` on every
 * re-render (`setActions` included, which this screen calls on every status
 * change), and an input living inside that container would have whatever
 * the player typed wiped out from under them. `mountMenu` also only listens
 * for keydown on its OWN container, so typing in the sibling input never
 * reaches the menu's arrow-key/digit-key reducer either — both are the
 * point, not a bug to "fix" by nesting the input into menuHost.
 *
 * Exported purely as a test seam: reaching this screen through a REAL arena
 * victory means beating a real AI roster in real combat — exactly what
 * `tests/integration/arena-victory.test.ts` drives headlessly, at the
 * exported-system level, because there is no reasonable way to fight that
 * fight through dispatched `KeyboardEvent`s. `tests/integration/
 * screens.test.ts`'s DOM harness has never driven the arena at all for the
 * same reason, so mounting this screen directly with a real `DriverState`-
 * derived name and a real `ArcadeScorePayload` is the only way that suite
 * can exercise its actual rendering and decline behavior.
 */
export function showArcadeScoreSubmit(
  root: HTMLElement,
  header: MenuHeaderInfo,
  driverName: string,
  payload: ArcadeScorePayload,
  onContinue: () => void,
): void {
  const container = el('div', 'sm-screen sm-screen--arcade-submit');
  container.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';

  const panel = el('div');
  panel.style.cssText = 'width:min(420px,90vw);max-height:90vh;overflow:auto;';
  container.appendChild(panel);

  const nameField = document.createElement('input');
  nameField.type = 'text';
  nameField.value = driverName;
  nameField.setAttribute('aria-label', t('ui.arena.scoreSubmit.nameLabel'));
  nameField.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:0 0 8px;padding:6px;';
  panel.appendChild(nameField);

  const menuHost = el('div');
  panel.appendChild(menuHost);
  clearAndAppend(root, container);

  type SubmitStatus =
    | { readonly kind: 'idle' }
    | { readonly kind: 'submitting' }
    | { readonly kind: 'accepted'; readonly rank: number | null }
    | { readonly kind: 'failed'; readonly error: string };
  let status: SubmitStatus = { kind: 'idle' };

  function actionsFor(): MenuAction[] {
    const rows: MenuAction[] = [
      { id: 'arcade-score', label: t('ui.arena.scoreSubmit.score', { score: payload.score }), eligible: false },
      { id: 'arcade-wave', label: t('ui.arena.scoreSubmit.wave', { wave: payload.wave }), eligible: false },
      { id: 'arcade-kills', label: t('ui.arena.scoreSubmit.kills', { kills: payload.kills }), eligible: false },
      { id: 'arcade-headshots', label: t('ui.arena.scoreSubmit.headshots', { headshots: payload.headshots }), eligible: false },
      { id: 'arcade-duration', label: t('ui.arena.scoreSubmit.duration', { duration: payload.duration }), eligible: false },
    ];
    if (status.kind === 'submitting') {
      rows.push({ id: 'arcade-status', label: t('ui.arena.scoreSubmit.statusSubmitting'), eligible: false });
    } else if (status.kind === 'accepted') {
      rows.push({
        id: 'arcade-status',
        label: t('ui.arena.scoreSubmit.statusAccepted', { rank: status.rank !== null ? status.rank : '—' }),
        eligible: false,
      });
    } else if (status.kind === 'failed') {
      rows.push({ id: 'arcade-status', label: t('ui.arena.scoreSubmit.statusFailed', { error: status.error }), eligible: false });
    }
    rows.push({
      id: ARCADE_SUBMIT_ACTION_ID,
      label: t('ui.arena.scoreSubmit.submit'),
      eligible: status.kind !== 'submitting' && status.kind !== 'accepted',
    });
    rows.push({ id: LEAVE_ACTION_ID, label: t('ui.arena.scoreSubmit.skip'), eligible: true });
    return rows;
  }

  const mounted = mountMenu({
    container: menuHost,
    header,
    actions: actionsFor(),
    onActivate: (id) => {
      if (id === LEAVE_ACTION_ID) {
        mounted.destroy();
        onContinue();
        return;
      }
      if (id !== ARCADE_SUBMIT_ACTION_ID) return;
      status = { kind: 'submitting' };
      mounted.setActions(actionsFor());
      void submitArcadeScore({ name: nameField.value, ...payload }).then((result) => {
        status = result.ok ? { kind: 'accepted', rank: result.rank } : { kind: 'failed', error: arcadeFailureText(result.failure) };
        mounted.setActions(actionsFor());
      });
    },
    onBack: () => {
      mounted.destroy();
      onContinue();
    },
  });
}

//
// Real opponents: `spawnArenaOpponents` deals event's roster onto the spawn
// ring at match start, `makeArenaAISystem` drives every one of them with the
// real `@/sim/ai` `decideAI`, and `makeArenaWeaponsSystem`/
// `makeArenaDamageSystem` run the exact same `fire()`/`applyResolvedShot()`
// pipeline the player's own shots go through — an opponent whose plant is
// destroyed or driver defeated is marked `destroyed` and recorded through
// the real `recordOpponentDefeated`, so `resolveArenaExit` can genuinely
// resolve VICTORY once the whole roster is down and the player drives out
// under their own power, not just ESCAPE.
/**
 * Which car the driver actually fights in.
 *
 * A `house`-sourced event is entered ON FOOT (`@/sim/arena`'s
 * `eligibilityFor` refuses any non-null vehicle for amateur-night's
 * `on-foot-under-threshold` branch) and the house lends a car: arenas.json's
 * `loanerVehicle`, NOT the `houseVehicle` row its five opponents come off.
 *
 * Those used to be one row, and the symmetry was described here as the point
 * of the event. It was the bug. One player against five simultaneous cars
 * that all prefer the player as a target is not a symmetric match however
 * identical the cars are: five stock karts killed a stock loaner by tick 152
 * on every seed measured, and clearing the roster costs about 59 rounds
 * against a 20-round magazine, so VICTORY was unreachable at any skill.
 * `spawnArenaOpponents` still deals every opponent from `houseKartDesign`,
 * untouched, because arenas.json marks amateur-night's opponent count and
 * kart count manual-exact. The loaner is the half that gives.
 *
 * `own`-sourced events use the active vehicle, which the same eligibility
 * check has already refused the entry without. `null` back from here means
 * the caller should not enter, never that it should assert.
 */
export function arenaPlayerVehicle(active: VehicleState | null, eventId: ArenaEventId): VehicleState | null {
  if (rosterFor(eventId).vehicleSource !== 'house') return active;
  return vehicleStateFromDesign(houseLoanerDesign(), `veh-${PLAYER_ID}-loaner`, PLAYER_ID);
}

/**
 * The other half of `arenaPlayerVehicle`: which car the driver walks OUT of
 * an event with.
 *
 * arenas.json's `houseVehicle.salvageable` is false, noted there as "House
 * karts are never salvageable, win or lose", so a loaner goes back to the
 * house whatever happened to it and the driver leaves with the car they
 * arrived in — for amateur-night, none. `own`-sourced events carry the
 * fought-in car back out, wreck included (`reconcileFleetWithVehicle`'s
 * `destroyed` branch is what drops it from the roster).
 *
 * Read off the ruleset rather than hardcoded, so flipping `salvageable` to
 * true in arenas.json is all it takes to let a driver keep the kart they won
 * in.
 */
export function arenaExitVehicle(activeBeforeEntry: VehicleState | null, foughtIn: VehicleState, eventId: ArenaEventId): VehicleState | null {
  const loaned = rosterFor(eventId).vehicleSource === 'house' && !isHouseVehicleSalvageable();
  return loaned ? activeBeforeEntry : foughtIn;
}

function showArenaEvent(
  root: HTMLElement,
  chargedDriver: DriverState,
  playerVehicle: VehicleState,
  matchState: ArenaMatchState,
  clock: Clock,
  cityState: CityRunState,
  onComplete: (nextState: CityRunState) => void,
): void {
  const event = getArenaEvent(matchState.eventId);
  const container = el('div', 'sm-screen sm-screen--arena');
  container.style.cssText = 'position:absolute;inset:0;background:#05070a;';
  const canvas = el('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  const hudHost = el('div');
  hudHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  const status = el('div');
  status.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);max-width:min(700px, calc(100vw - 260px));color:#d7e0ea;font-family:system-ui,sans-serif;font-size:13px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;text-align:center;';
  const exitBtn = el('button', undefined, t('ui.arena.exitToTitle'));
  exitBtn.style.cssText =
    'position:absolute;top:8px;right:8px;pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';
  const retryBtn = el('button');
  retryBtn.style.cssText =
    'position:absolute;top:36px;left:50%;transform:translateX(-50%);pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';
  container.appendChild(canvas);
  container.appendChild(hudHost);
  container.appendChild(status);
  container.appendChild(retryBtn);
  container.appendChild(exitBtn);
  clearAndAppend(root, container);

  lastSessionSeed = cityState.sessionSeed;
  const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);

  const world = createArenaWorld(cityState.sessionSeed, playerVehicle);
  world.clock = clock;
  const playerVehicleId = playerVehicle.id;
  const opponents = spawnArenaOpponents(world, event);

  const driverRef = { current: chargedDriver };
  const matchStateRef = { current: matchState };
  const spawnCounter = { current: 0 };
  const aiInputs = new Map<string, InputFrame>();
  const projectileTargets = new Map<string, string>();
  const messages: HudMessage[] = [];
  let messageCounter = 0;
  function logMessage(kind: HudMessageKind, text: string): void {
    messages.push({ id: `msg-${messageCounter}`, kind, text, tick: world.tick });
    messageCounter += 1;
    if (messages.length > 20) messages.shift();
  }
  logMessage('info', t('ui.arena.eventEntered', { event: event.name, count: matchState.opponentsTotal }));

  const systems = createSystemsRegistry();
  systems.register('driving', makeArenaDrivingSystem(driverRef, playerVehicleId, opponents, aiInputs));
  systems.register('weapons', makeArenaWeaponsSystem(driverRef, playerVehicleId, opponents, aiInputs, projectileTargets, spawnCounter, logMessage));
  systems.register('projectiles', projectilesSystem);
  systems.register('damage', makeArenaDamageSystem(playerVehicleId, driverRef, opponents, projectileTargets, matchStateRef, logMessage));
  systems.register('ai', makeArenaAISystem(playerVehicleId, opponents, aiInputs));
  systems.register('cleanup', cleanupSystem);

  const codesDown = new Set<string>();
  const inputTracking = attachCodeTracking(codesDown);
  const weaponSelection = makeWeaponSelection(() => findPlayer(world)?.weapons.length ?? 0);
  const touch = mountTouchControls(container, { fire: true, commands: weaponTouchCommands(weaponSelection, playerVehicle) });

  function sampleInput(): InputFrame {
    const raw = rawInputFrom(codesDown, touch);
    weaponSelection.update(raw);
    const resolved = resolveInput(raw, currentControlPreset, currentControlBindings);
    return { moveX: resolved.moveX, moveY: resolved.moveY, fire: resolved.fire, weaponSlot: weaponSelection.active() ?? NO_WEAPON_SLOT };
  }

  const loop = createGameLoop({ world, dtSeconds, systems, sampleInput });

  const hudContainer = document.createElement('div');
  hudContainer.style.pointerEvents = 'auto';
  hudHost.appendChild(hudContainer);
  const hudDoc = new DomHudDocument();
  const hudRoot = new DomHudElement(hudContainer);
  let hudSettings: HudSettings = { scale: 1, radarOrientation: 'world', reducedFlash: false, reducedShake: false };

  function renderHudFrame(): void {
    const player = findPlayer(world);
    if (player === undefined) return;
    const plant = getPlant(player.design.plantId);
    const accelMphPerSec = computeBuild(player.design).accelMphPerSec;
    const snapshot: HudSnapshot = {
      vehicle: player,
      activeWeaponIndex: weaponSelection.active(),
      accelMphPerSec,
      radar: { enabled: !isRadarDisabled(player.plantDP, plant.radarFailureThreshold), contacts: [] },
      driver: { naturalHealth: driverRef.current.naturalHealth, bodyArmor: driverRef.current.bodyArmor },
      messages,
      settings: hudSettings,
    };
    renderHud(hudDoc, hudRoot, snapshot, {
      onToggleRadarOrientation: () => {
        hudSettings = { ...hudSettings, radarOrientation: hudSettings.radarOrientation === 'world' ? 'heading' : 'world' };
        renderHudFrame();
      },
      onToggleReducedFlash: () => {
        hudSettings = { ...hudSettings, reducedFlash: !hudSettings.reducedFlash };
        renderHudFrame();
      },
      onToggleReducedShake: () => {
        hudSettings = { ...hudSettings, reducedShake: !hudSettings.reducedShake };
        renderHudFrame();
      },
    });
  }

  let gpuCtx: GpuContext | undefined;
  let resources: RenderResources | undefined;
  let atlasIndex: AtlasIndex | undefined;
  let floorInstances: SpriteInstanceInput[] = [];
  const camera: Camera = createCamera();
  camera.setZoom(PIXELS_PER_METER_CSS);

  async function initRenderer(): Promise<void> {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const init = await initGpu(canvas);
    if (!init.ok) {
      status.textContent = t('ui.arena.webgpuUnavailable', { reason: init.reason.kind });
      return;
    }
    gpuCtx = init.context;
    status.textContent = t('ui.arena.eventHint', { event: event.name });

    atlasIndex = loadAtlasIndex(atlasManifestRaw);
    floorInstances = buildFloorInstances(atlasIndex);

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    resources = await buildRenderResources(gpuCtx, atlasBitmap, spriteShaderSource);

    gpuCtx.onRecovered(() => {
      void buildRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource).then((rebuilt) => {
        resources = rebuilt;
      });
    });
    gpuCtx.onRecoveryFailed(() => {
      resources = undefined;
    });
    wireRecoveryUi(gpuCtx, retryBtn, (text) => {
      status.textContent = text;
    });
  }

  function renderFrame(): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;
    const player = findPlayer(world);
    if (player === undefined) return;

    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setCenter(player.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    const atlas = atlasIndex;
    const opponentInstances = world.entities.vehicles
      .filter((vehicle) => vehicle.id !== player.id && !vehicle.destroyed)
      .map((vehicle) => vehicleSpriteInstance(vehicle, atlas));
    const spriteInstances = [vehicleSpriteInstance(player, atlas), ...opponentInstances];
    writeInstanceBuffer(gpuCtx.getDevice(), resources.tileInstanceBuffer, packInstances(floorInstances));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.spriteInstanceBuffer, packInstances(spriteInstances));

    const encoder = gpuCtx.getDevice().createCommandEncoder({ label: 'arena-event-frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpuCtx.getContext().getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.tileBindGroup, instanceCount: floorInstances.length },
    ]);
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.spriteBindGroup, instanceCount: spriteInstances.length },
    ]);
    pass.end();
    gpuCtx.getDevice().queue.submit([encoder.finish()]);
  }

  let rafHandle = 0;
  let lastTimeMs = performance.now();
  let stopped = false;
  function frame(nowMs: number): void {
    if (stopped) return;
    const deltaSeconds = Math.max(0, Math.min((nowMs - lastTimeMs) / 1000, 0.25));
    lastTimeMs = nowMs;
    loop.advance(deltaSeconds);
    renderFrame();
    renderHudFrame();
    rafHandle = window.requestAnimationFrame(frame);
  }

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    inputTracking.detach();
    touch?.destroy();
    gpuCtx?.destroy();
  }

  exitBtn.addEventListener('click', () => {
    stop();
    const player = findPlayer(world);
    const exitMode: ArenaExitMode = player?.destroyed === true ? 'ON_FOOT' : 'UNDER_POWER';
    const resolution: ArenaResolution = resolveArenaExit(matchStateRef.current, driverRef.current, exitMode);
    const nextClock = advanceDays(world.clock, resolution.daysConsumed);
    const nextVehicle: VehicleState | null = arenaExitVehicle(cityState.vehicle, player ?? playerVehicle, matchState.eventId);
    const nextArenaRecord: ArenaRecord = {
      wins: cityState.arenaRecord.wins + (resolution.outcome === 'VICTORY' ? 1 : 0),
      losses: cityState.arenaRecord.losses + (resolution.outcome === 'FORFEIT' ? 1 : 0),
    };
    // The autosave `persistArenaSession` was, until now, ONLY ever reachable
    // from the practice arena's own resume flow - a mission arena entered
    // straight from the city (this screen) never persisted anything, so a
    // driver who accepted the campaign's final mission and walked into an
    // arena had their `CityRunState.quests` living nowhere but memory.
    // `world: null` here (never the just-concluded arena's own `World`) —
    // this event is OVER, control is going straight back to the city, there
    // is no live simulation left to resume into.
    void persistArenaSession({
      openDb: cityState.openDb,
      driver: resolution.driver,
      vehicle: nextVehicle,
      clock: nextClock,
      location: cityState.cityId,
      quests: cityState.quests,
      sessionSeed: cityState.sessionSeed,
      world: null,
    });
    const nextCityState: CityRunState = {
      ...cityState,
      driver: resolution.driver,
      vehicle: nextVehicle,
      clock: nextClock,
      fleet: nextVehicle === null ? cityState.fleet : reconcileFleetWithVehicle(cityState.fleet, nextVehicle, false, cityState.cityId),
      arenaRecord: nextArenaRecord,
    };

    // The submit screen is a detour, never a second path: everything above
    // this point (persistArenaSession, the clock advance, the fleet
    // reconcile, nextArenaRecord) already happened exactly once either way,
    // and `nextCityState` is computed exactly once either way too — the
    // gate below only decides whether the player sees a screen first.
    const arcadeEnv = { hostname: window.location.hostname, search: cityState.search };
    if (arcadeScoringEnabled(arcadeEnv) && shouldSubmitArcadeScore(resolution.outcome, matchStateRef.current)) {
      const payload = buildArcadePayload(matchStateRef.current, world.tick, dtSeconds);
      const header: MenuHeaderInfo = {
        cash: nextCityState.driver.cash,
        dayIndex: nextCityState.clock.dayIndex,
        phase: nextCityState.clock.phase,
        cityName: cityName(nextCityState.cityId),
      };
      showArcadeScoreSubmit(root, header, resolution.driver.name, payload, () => onComplete(nextCityState));
      return;
    }
    onComplete(nextCityState);
  });

  void initRenderer().finally(() => {
    lastTimeMs = performance.now();
    rafHandle = window.requestAnimationFrame(frame);
  });
}

// ---------------------------------------------------------------------------
// Screen 5: City
// ---------------------------------------------------------------------------

/**
 * The car as any screen boundary into or out of a city should see it: parked at
 * that city's gate, heading 0.
 *
 * City and road coordinates are different spaces (`@/sim/road` is a 1D
 * route-progress model), so a position from either is meaningless in the other.
 * `showCity` normalizes on the way IN for that reason, and has to do the same on
 * the way OUT now that driving the plaza moves the car for real: the road reads
 * the departing car's position and heading as its own `startPosition`/
 * `routeHeadingRad`, and `createArenaWorld` seats the player wherever the car
 * says it is. Without this, both would depend on where in the plaza the driver
 * happened to stop, which is exactly the coupling the project's determinism
 * invariant rules out.
 */
export function vehicleParkedAtGate(vehicle: VehicleState | null, gate: Vec2): VehicleState | null {
  return vehicle === null ? null : { ...vehicle, position: { ...gate }, headingRad: 0 };
}

interface CityRenderResources {
  readonly pipeline: GPURenderPipeline;
  readonly cameraBuffer: GPUBuffer;
  readonly cameraBindGroup: GPUBindGroup;
  readonly groundInstanceBuffer: GPUBuffer;
  readonly groundBindGroup: GPUBindGroup;
  readonly buildingInstanceBuffer: GPUBuffer;
  readonly buildingBindGroup: GPUBindGroup;
  readonly actorInstanceBuffer: GPUBuffer;
  readonly actorBindGroup: GPUBindGroup;
  readonly texture: GPUTexture;
}

/** The player on foot plus, at most, one parked-or-ridden car - the two actor-layer instances `@/ui/city-view`'s `buildCityInstances` can ever emit in one frame. */
const CITY_ACTOR_INSTANCE_CAPACITY = 2;

/** Exact tile count `@/ui/city-view`'s own `groundInstances` loop emits for `layout` - mirrors that loop's bounds precisely so the GPU buffer is neither wastefully oversized nor (worse) too small to hold a real frame. */
function cityGroundTileCount(layout: CityLayout): number {
  const half = layout.boundsRadiusM + layout.tileSizeM;
  const steps = Math.floor((2 * half) / layout.tileSizeM) + 1;
  return steps * steps;
}

async function buildCityRenderResources(
  gpuCtx: GpuContext,
  atlasBitmap: ImageBitmap,
  spriteShaderSource: string,
  groundCapacity: number,
  buildingCapacity: number,
): Promise<CityRenderResources> {
  const device = gpuCtx.getDevice();
  const format = gpuCtx.getFormat();

  const shaderModule = createShaderModule(device, 'city-sprite-shader', spriteShaderSource);
  const cameraLayout = createCameraBindGroupLayout(device);
  const atlasLayout = createAtlasBindGroupLayout(device);
  const pipeline = createLayerPipeline({
    device,
    shaderModule,
    targetFormat: format,
    cameraLayout,
    atlasLayout,
    blendMode: 'alpha-blend',
    label: 'city-sprites',
  });

  const cameraBuffer = createCameraUniformBuffer(device);
  const cameraBindGroup = createCameraBindGroup(device, cameraLayout, cameraBuffer);

  const texture = device.createTexture({
    label: 'city-atlas-0',
    size: { width: atlasBitmap.width, height: atlasBitmap.height, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: atlasBitmap }, { texture }, {
    width: atlasBitmap.width,
    height: atlasBitmap.height,
  });
  const textureView = texture.createView();
  const sampler = createAtlasSampler(device);

  const groundInstanceBuffer = createInstanceStorageBuffer(device, groundCapacity);
  const groundBindGroup = createAtlasBindGroup(device, atlasLayout, groundInstanceBuffer, sampler, textureView);
  const buildingInstanceBuffer = createInstanceStorageBuffer(device, buildingCapacity);
  const buildingBindGroup = createAtlasBindGroup(device, atlasLayout, buildingInstanceBuffer, sampler, textureView);
  const actorInstanceBuffer = createInstanceStorageBuffer(device, CITY_ACTOR_INSTANCE_CAPACITY);
  const actorBindGroup = createAtlasBindGroup(device, atlasLayout, actorInstanceBuffer, sampler, textureView);

  return {
    pipeline,
    cameraBuffer,
    cameraBindGroup,
    groundInstanceBuffer,
    groundBindGroup,
    buildingInstanceBuffer,
    buildingBindGroup,
    actorInstanceBuffer,
    actorBindGroup,
    texture,
  };
}

/** cities.json's routes touching `cityId`, resolved to the neighbor city id - the gate's route-choice prompt needs this same shape `@/sim/courier`'s own (private) `routeNeighborsOf` computes internally for offer generation. */
function cityRouteNeighbors(cityId: string): { route: RouteDef; neighborCityId: string }[] {
  const neighbors: { route: RouteDef; neighborCityId: string }[] = [];
  for (const route of citiesConfig().routes) {
    if (route.a === cityId) neighbors.push({ route, neighborCityId: route.b });
    else if (route.b === cityId) neighbors.push({ route, neighborCityId: route.a });
  }
  return neighbors;
}

/**
 * `@/ui/input`'s `resolveInput()` drive vector -> one of `@/sim/city`'s eight
 * compass `CityDirection`s, or null for centered/no input - the 8-way
 * convention `stepWalk` expects (not the arena/road screens' free 2D stick
 * vector). `moveY` is negated: `resolveInput`'s contract is world-up-positive
 * (matching `@/render/camera`'s Y-up convention, see `@/ui/input`'s own file
 * header), but city's compass here treats "up" (driveUp) as north, which
 * this function's own callers have always modeled as the negative-y half —
 * flipping the sign here is this function's job, not `resolveInput`'s.
 */
export function cityDirectionFromVector(vec: { readonly x: number; readonly y: number }): CityDirection | null {
  const deadzone = CONTROLS.cityDirectionDeadzone;
  const x = Math.abs(vec.x) > deadzone ? Math.sign(vec.x) : 0;
  const y = Math.abs(vec.y) > deadzone ? -Math.sign(vec.y) : 0;
  if (x === 0 && y === 0) return null;
  if (x === 0) return y < 0 ? 'N' : 'S';
  if (y === 0) return x < 0 ? 'W' : 'E';
  if (x < 0) return y < 0 ? 'NW' : 'SW';
  return y < 0 ? 'NE' : 'SE';
}

// ---------------------------------------------------------------------------
// Screen 5b: Fleet roster — up to economy.json's `maxFleetSize` (8) owned
// cars, switchable from whichever one the driver is standing in this city.
// ---------------------------------------------------------------------------
//
// `@/sim/fleet`'s real `switchActiveVehicle` does the actual work (garages
// the outgoing car free, charges `retrieveCar`'s fee to bring in the
// incoming one, exactly as `@/ui/buildings/garage`'s own retrieve action
// prices it) — this screen is a thin `@/ui/menu` list over that, plus the
// one bookkeeping step neither `@/sim/fleet` nor `@/ui/buildings/garage`
// owns: making sure `state.fleet`'s entry for the car currently being
// driven reflects its REAL live state (armor/cargo/ammo, not whatever it
// looked like the last time it was stored) before any switch reads it.

function fleetRowLabel(entry: FleetVehicle, driverCityId: string): string {
  if (!entry.stored) return t('ui.fleet.rowActive', { name: entry.vehicle.design.name });
  if (entry.cityId === driverCityId) {
    return t('ui.fleet.rowStoredHere', { name: entry.vehicle.design.name, price: economy().services.retrieveCar.price });
  }
  return t('ui.fleet.rowStoredElsewhere', { name: entry.vehicle.design.name, city: cityName(entry.cityId) });
}

function showFleet(root: HTMLElement, state: CityRunState, onExit: (nextState: CityRunState) => void): void {
  const container = el('div', 'sm-screen sm-screen--fleet');
  container.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,7,10,0.85);';
  const menuHost = el('div');
  menuHost.style.cssText = 'width:min(480px,92vw);max-height:88vh;overflow:auto;';
  container.appendChild(menuHost);
  clearAndAppend(root, container);

  // `fleet` synced with the car actually under the driver right now — the
  // one entry `@/ui/buildings/garage`'s own store/retrieve never gets to
  // touch mid-drive (arena damage, road combat, cargo picked up from a
  // wreck), so this is the one moment that live state is folded back in
  // before anything here reads or switches off of it.
  // A carless driver has no live state to fold in, only stored cars to
  // retrieve, so the roster is already current.
  let runState: CityRunState =
    state.vehicle === null ? state : { ...state, fleet: reconcileFleetWithVehicle(state.fleet, state.vehicle, false, state.cityId) };

  function actionsFor(): MenuAction[] {
    const actions: MenuAction[] = runState.fleet.vehicles.map((entry) => ({
      id: `fleet-${entry.vehicle.id}`,
      label: fleetRowLabel(entry, runState.cityId),
      eligible: entry.stored && entry.cityId === runState.cityId,
    }));
    actions.push(leaveAction());
    return actions;
  }

  function header(): { cash: number; dayIndex: number; phase: Clock['phase']; cityName: string } {
    return { cash: runState.driver.cash, dayIndex: runState.clock.dayIndex, phase: runState.clock.phase, cityName: cityName(runState.cityId) };
  }

  const mounted = mountMenu({
    container: menuHost,
    header: header(),
    actions: actionsFor(),
    onActivate: (id) => {
      if (id === LEAVE_ACTION_ID) {
        onExit(runState);
        return;
      }
      const vehicleId = id.slice('fleet-'.length);
      const result = switchActiveVehicle(runState.driver, runState.fleet, runState.clock, vehicleId);
      if (!result.ok) {
        mounted.setActions(actionsFor());
        return;
      }
      const nextActive = fleetActiveVehicle(result.fleet);
      if (nextActive === undefined) {
        mounted.setActions(actionsFor());
        return;
      }
      runState = {
        ...runState,
        driver: result.driver,
        clock: result.clock,
        fleet: result.fleet,
        vehicle: nextActive.vehicle,
        vehicleStored: false,
      };
      mounted.setHeader(header());
      mounted.setActions(actionsFor());
    },
    onBack: () => onExit(runState),
  });
}

/**
 * `DayPhase` -> its strings.json label key, `satisfies Record<DayPhase, string>`
 * so an added `DayPhase` member is a compile error here, not a silently
 * unlabeled phase. Shared by `showCity`/`showRoad`'s own status lines.
 */
const PHASE_LABEL_KEY = { DAY: 'ui.phase.DAY', NIGHT: 'ui.phase.NIGHT' } as const satisfies Record<DayPhase, string>;

/**
 * The walkable town: doorways into every facility, a gate onto the road,
 * and the player's own parked/ridden car - `@/sim/city` + `@/ui/city-view`
 * do all the real work here, this function only wires them to real
 * keyboard input, a live WebGPU frame (falling back to a text-only status
 * line exactly like the arena screen does when `navigator.gpu` is absent),
 * and the building/gate transitions into `@/ui/buildings`, the constructor,
 * an arena match, or a road trip.
 */
function showCity(root: HTMLElement, state: CityRunState): void {
  const container = el('div', 'sm-screen sm-screen--city');
  container.style.cssText = 'position:absolute;inset:0;background:#05070a;';
  const canvas = el('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  const status = el('div');
  status.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);max-width:min(700px, calc(100vw - 260px));color:#d7e0ea;font-family:system-ui,sans-serif;font-size:13px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;text-align:center;white-space:pre-wrap;overflow-wrap:break-word;';
  const deviceNotice = el('div');
  deviceNotice.style.cssText =
    'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);color:#ff6b6b;font-family:system-ui,sans-serif;font-size:12px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;text-align:center;';
  const retryBtn = el('button');
  retryBtn.style.cssText =
    'position:absolute;bottom:36px;left:50%;transform:translateX(-50%);pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';
  const panelHost = el('div');
  panelHost.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,7,10,0.55);';
  container.appendChild(canvas);
  container.appendChild(status);
  container.appendChild(deviceNotice);
  container.appendChild(retryBtn);
  container.appendChild(panelHost);
  clearAndAppend(root, container);

  lastSessionSeed = state.sessionSeed;

  const layout: CityLayout = generateCityLayout(state.cityId, state.sessionSeed);
  let runState: CityRunState = { ...state, vehicle: vehicleParkedAtGate(state.vehicle, layout.gate.position) };
  let player: CityPlayerState = createCityPlayerState({ ...layout.gate.position });
  let paused = false;

  function citySnapshot(): CityViewSnapshot {
    const vehicle = runState.vehicle;
    const vehicleView: CityVehicleView | null =
      vehicle === null || runState.vehicleStored
        ? null
        : { position: vehicle.position, headingRad: vehicle.headingRad, bodyId: vehicle.design.bodyId };
    return { layout, player, vehicle: vehicleView };
  }

  function updateStatus(): void {
    status.textContent = t(isCoarsePointer() ? 'ui.city.statusTouch' : 'ui.city.status', {
      city: cityName(runState.cityId),
      day: runState.clock.dayIndex,
      phase: t(PHASE_LABEL_KEY[runState.clock.phase]),
      cash: runState.driver.cash,
    });
  }

  function openPanel(): HTMLElement {
    paused = true;
    panelHost.innerHTML = '';
    panelHost.style.display = 'flex';
    const card = el('div');
    card.style.cssText = 'width:min(480px,92vw);max-height:86vh;overflow:auto;';
    panelHost.appendChild(card);
    return card;
  }

  function closePanel(): void {
    panelHost.style.display = 'none';
    panelHost.innerHTML = '';
    paused = false;
  }

  function openFacility(kind: string): void {
    // Auto-deliver BEFORE the panel ever mounts: walking into a quest's own
    // `destination` facility with its cargo aboard is the one reachable
    // "deliver" action this UI has (see `attemptQuestDelivery`'s own doc
    // comment). A victory delivery shows the victory screen instead of the
    // facility's own panel this visit — `sandboxContinues` means the
    // driver comes right back to THIS city afterward, not a dead end.
    const delivery = attemptQuestDelivery(runState, kind);
    runState = delivery.state;
    if (delivery.result?.victory === true && delivery.def !== null) {
      stop();
      showVictory(
        root,
        runState,
        buildVictorySummary({
          quest: delivery.def,
          clock: runState.clock,
          driver: runState.driver,
          fleet: runState.fleet,
          arenaRecord: runState.arenaRecord,
        }),
        () => showCity(root, runState),
      );
      return;
    }

    const previousQuests = runState.quests;
    const card = openPanel();
    let mounted: MountedFacility | undefined;
    mounted = mountFacility({
      container: card,
      kind,
      context: buildingContextFrom(runState),
      onExit: (ctx) => {
        runState = applyBuildingContext(runState, applyQuestAcceptEffects(previousQuests, ctx));
        mounted?.destroy();
        closePanel();
      },
      onOpenConstructor: () => {
        mounted?.destroy();
        stop();
        showConstructor(
          root,
          runState.driver,
          (chargedDriver, confirmed) => {
            // A fresh build becomes the new active car; whatever was active
            // before is garaged in THIS city instead of discarded, the same
            // "additional car" flow `@/ui/buildings/assembly`'s own fleet-cap
            // gate (`ctx.fleetSize < maxFleetSize`) exists for. A carless
            // driver buying their way back in has nothing to garage, and this
            // is the one path that gets them a car again.
            const outgoing = runState.vehicle;
            const newVehicle = vehicleStateFromConfirmedBuild(confirmed, PLAYER_ID, `veh-${PLAYER_ID}-${runState.fleet.vehicles.length}`);
            const fleetWithOldGaraged =
              outgoing === null ? runState.fleet : reconcileFleetWithVehicle(runState.fleet, outgoing, true, runState.cityId);
            const fleetResult = fleetAddVehicle(fleetWithOldGaraged, { vehicle: newVehicle, stored: false, cityId: runState.cityId });
            runState = {
              ...runState,
              driver: chargedDriver,
              vehicle: newVehicle,
              vehicleStored: false,
              fleet: fleetResult.ok ? fleetResult.fleet : fleetWithOldGaraged,
            };
            showCity(root, runState);
          },
          () => showCity(root, runState),
          runState.vehicle === null ? [] : [runState.vehicle.design.name],
          fleetVehicleCount(runState.fleet),
        );
      },
      onEnterArena: (result: ArenaEntryResult) => {
        const entered = arenaPlayerVehicle(vehicleParkedAtGate(runState.vehicle, layout.gate.position), result.matchState.eventId);
        // `eligibilityFor` already refused every own-sourced event to a
        // carless driver, and every house-sourced one hands back a loaner, so
        // this is unreachable — and a refusal beats an assertion either way.
        if (entered === null) return;
        mounted?.destroy();
        stop();
        showArenaEvent(root, result.driver, entered, result.matchState, runState.clock, runState, (nextState) => {
          runState = nextState;
          showCity(root, runState);
        });
      },
    });
  }

  function openGatePrompt(): void {
    if (runState.vehicleStored) {
      // Can't drive out without retrieving the car from the garage first -
      // just resume walking instead of stranding the player on a dead menu.
      return;
    }
    const card = openPanel();
    const neighbors = cityRouteNeighbors(runState.cityId);
    // No car, no road. Shown as a refusal the player can READ on every route
    // row, the same shape `@/ui/buildings/arena`'s ineligible rows use, rather
    // than a silent dead menu — and `@/ui/menu`'s `handleMenuKey` never
    // dispatches ACTIVATE for an ineligible row, so it is also the gate.
    const carless = runState.vehicle === null;
    const actions: MenuAction[] = neighbors.map((n) => ({
      id: `route-${n.route.id}`,
      label: t('ui.city.routeOption', { city: cityName(n.neighborCityId), miles: n.route.lengthMiles, danger: n.route.danger }),
      eligible: !carless,
      ...(carless ? { reason: t('ui.city.gateNoVehicle') } : {}),
    }));
    actions.push(leaveAction());

    const mounted = mountMenu({
      container: card,
      header: { cash: runState.driver.cash, dayIndex: runState.clock.dayIndex, phase: runState.clock.phase, cityName: cityName(runState.cityId) },
      actions,
      onActivate: (id) => {
        mounted.destroy();
        if (id === LEAVE_ACTION_ID) {
          closePanel();
          return;
        }
        const routeId = id.slice('route-'.length);
        const found = neighbors.find((n) => n.route.id === routeId);
        const vehicle = vehicleParkedAtGate(runState.vehicle, layout.gate.position);
        if (found === undefined || vehicle === null) {
          closePanel();
          return;
        }
        closePanel();
        stop();
        const resolved: ResolvedRoute = resolveRoute(runState.cityId, found.neighborCityId);
        const history = runState.routeHistory.get(resolved.route.id) ?? FRESH_ROUTE_HISTORY;
        const pursuitLevel = pursuitLevelFromQuestState(runState.quests);
        const trip = beginRoadTripWithEncounters(resolved, vehicle, runState.clock, runState.sessionSeed, history, pursuitLevel);
        showRoad(root, runState, trip, (nextState) => showCity(root, nextState));
      },
      onBack: () => {
        mounted.destroy();
        closePanel();
      },
    });
  }

  function handleTrigger(trigger: CityTrigger): void {
    if (trigger.kind === 'gate') openGatePrompt();
    else if (trigger.kind === 'facility') openFacility(trigger.facilityKind);
  }

  // --- input --------------------------------------------------------------
  // 'G' (vehicle in/out), 'F' (fleet roster) and 'J' (journal) are fixed
  // hotkeys, not part of controls.json's rebindable action set (that table
  // only covers drive/fire/weapon-select, see `@/ui/input`'s file header) -
  // driving itself below goes through `resolveInput` so it honors the live
  // control preset/rebinding. Each fixed hotkey's `!paused` guard lives
  // INSIDE its own function (`doToggleVehicle`/`openFleetScreen`/
  // `openJournalScreen`) rather than at each call site, so the touch
  // command buttons below can call the exact same functions the keyboard
  // handler does without re-deriving (and risking drifting from) the guard.
  const codesDown = new Set<string>();
  function doToggleVehicle(): void {
    if (paused) return;
    const vehicle = runState.vehicle;
    if (vehicle === null) return; // nothing to get into
    const toggled = toggleVehicle(player, vehicle.position);
    if (toggled.ok) player = toggled.player;
  }
  function onKeyDown(ev: KeyboardEvent): void {
    codesDown.add(ev.code);
    if (ev.key === 'g' || ev.key === 'G') doToggleVehicle();
    if (ev.key === 'f' || ev.key === 'F') openFleetScreen();
    if (ev.key === 'j' || ev.key === 'J') openJournalScreen();
  }
  function onKeyUp(ev: KeyboardEvent): void {
    codesDown.delete(ev.code);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  const touch = mountTouchControls(container, {
    fire: false,
    commands: [
      { id: 'enterExitCar', labelKey: 'ui.touch.enterExitCar', onPress: doToggleVehicle },
      { id: 'fleet', labelKey: 'ui.touch.fleet', onPress: openFleetScreen },
      { id: 'journal', labelKey: 'ui.touch.journal', onPress: openJournalScreen },
    ],
  });

  function openFleetScreen(): void {
    if (paused) return;
    stop();
    showFleet(root, runState, (nextState) => {
      runState = nextState;
      showCity(root, runState);
    });
  }

  function journalContextFrom(state: CityRunState): JournalContext {
    return {
      driver: state.driver,
      clock: state.clock,
      cityId: state.cityId,
      activeCourierJobs: state.activeCourierJobs,
      quests: state.quests,
    };
  }

  function openJournalScreen(): void {
    if (paused) return;
    const card = openPanel();
    const mounted = mountBuildingPanel({
      container: card,
      initialState: createJournalState(journalContextFrom(runState)),
      engine: journalEngine,
      onExit: () => {
        mounted.destroy();
        closePanel();
      },
    });
  }

  // --- WebGPU ---------------------------------------------------------------
  let gpuCtx: GpuContext | undefined;
  let resources: CityRenderResources | undefined;
  let atlasIndex: AtlasIndex | undefined;
  const camera: Camera = createCamera();
  camera.setZoom(PIXELS_PER_METER_CSS);

  async function initRenderer(): Promise<void> {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const init = await initGpu(canvas);
    if (!init.ok) {
      // Honest state, not a frozen canvas: the real sim (walking, triggers,
      // buildings) keeps running below on the text status line alone, same
      // contract as the arena screen's own `webgpuUnavailable` branch.
      deviceNotice.textContent = t('ui.arena.webgpuUnavailable', { reason: init.reason.kind });
      return;
    }
    gpuCtx = init.context;

    atlasIndex = loadAtlasIndex(atlasManifestRaw);

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    const groundCapacity = cityGroundTileCount(layout);
    const buildingCapacity = layout.doorways.length + 1;
    resources = await buildCityRenderResources(gpuCtx, atlasBitmap, spriteShaderSource, groundCapacity, buildingCapacity);

    gpuCtx.onRecovered(() => {
      void buildCityRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource, groundCapacity, buildingCapacity).then((rebuilt) => {
        resources = rebuilt;
      });
    });
    gpuCtx.onRecoveryFailed(() => {
      resources = undefined;
    });
    wireRecoveryUi(gpuCtx, retryBtn, (text) => {
      deviceNotice.textContent = text;
    });
  }

  function renderFrame(): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;

    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setCenter(player.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    const instances = buildCityInstances(citySnapshot(), atlasIndex);
    // @/ui/city-view's own layer scheme: 0 = ground, 1 = building/gate, 2 = actor (player/vehicle).
    const ground = instances.filter((i) => i.layer === 0);
    const buildings = instances.filter((i) => i.layer === 1);
    const actors = instances.filter((i) => i.layer === 2);
    writeInstanceBuffer(gpuCtx.getDevice(), resources.groundInstanceBuffer, packInstances(ground));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.buildingInstanceBuffer, packInstances(buildings));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.actorInstanceBuffer, packInstances(actors));

    const encoder = gpuCtx.getDevice().createCommandEncoder({ label: 'city-frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpuCtx.getContext().getCurrentTexture().createView(),
          clearValue: { r: 0.05, g: 0.07, b: 0.06, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [{ bindGroup: resources.groundBindGroup, instanceCount: ground.length }]);
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.buildingBindGroup, instanceCount: buildings.length },
    ]);
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [{ bindGroup: resources.actorBindGroup, instanceCount: actors.length }]);
    pass.end();
    gpuCtx.getDevice().queue.submit([encoder.finish()]);
  }

  // --- main loop --------------------------------------------------------------
  let rafHandle = 0;
  let lastTimeMs = performance.now();
  let stopped = false;
  function frame(nowMs: number): void {
    if (stopped) return;
    const dtSeconds = Math.max(0, Math.min((nowMs - lastTimeMs) / 1000, 0.25));
    lastTimeMs = nowMs;
    if (!paused) {
      const resolved = resolveInput(rawInputFrom(codesDown, touch), currentControlPreset, currentControlBindings);
      const direction = cityDirectionFromVector({ x: resolved.moveX, y: resolved.moveY });
      const step = stepWalk({ player, layout, direction, dtSeconds, clock: runState.clock });
      player = step.player;
      // Driving moves the CAR, so the car's own position has to follow.
      // `@/ui/city-view` already draws the ridden car at the player's
      // position/heading, but `runState.vehicle` is what the driver gets back
      // out into, what the salvage yard sells and what the road trip departs
      // with. Left behind it would snap back to wherever it was parked the
      // instant they pressed 'G' again.
      const driven =
        player.inVehicle && runState.vehicle !== null
          ? { ...runState.vehicle, position: player.position, headingRad: player.headingRad }
          : runState.vehicle;
      runState = { ...runState, clock: step.clock, vehicle: driven };
      if (step.trigger.kind !== 'none') handleTrigger(step.trigger);
    }
    updateStatus();
    renderFrame();
    rafHandle = window.requestAnimationFrame(frame);
  }

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    touch?.destroy();
    gpuCtx?.destroy();
  }

  updateStatus();
  void initRenderer().finally(() => {
    lastTimeMs = performance.now();
    rafHandle = window.requestAnimationFrame(frame);
  });
}

// ---------------------------------------------------------------------------
// Screen 6: Road
// ---------------------------------------------------------------------------

/**
 * Builds a fresh `RoadTripState` whose `contacts` are `@/sim/encounters`'s
 * real, archetype-bearing `EncounterUnit`s (deterministic in seed/route/day/
 * history, see that module) rather than `@/sim/road`'s own bare
 * `generateRouteContacts` (faction/disposition only, no vehicle to fight or
 * design to render) — every OTHER field matches `beginRoadTrip`'s exact
 * shape, this is the one substitution. `EncounterUnit extends RoadContact`,
 * so every existing `@/sim/road` contact function (`updateContactForProgress`,
 * `updateContactFlight`, `willFire`, ...) already works on these unchanged;
 * `showRoad` below is what actually reads their extra `design`/`skill`/
 * `personality` fields to field a real, fightable opponent.
 */
export function beginRoadTripWithEncounters(
  resolved: ResolvedRoute,
  vehicle: VehicleState,
  clock: Clock,
  sessionSeed: string,
  history: RouteEncounterHistory,
  /**
   * `@/sim/pursuit`'s `pursuitLevelFromQuestState` — 0 for every caller
   * that predates campaign wiring (including every existing test call site
   * of this exported function), which reproduces `generateEncounters`'s own
   * base-table-only contacts exactly (see `generateEncountersWithPursuit`'s
   * own doc comment: `pursuitLevel <= 0` returns the identical list).
   */
  pursuitLevel = 0,
): RoadTripState {
  return {
    resolved,
    vehicle,
    startPosition: { ...vehicle.position },
    routeHeadingRad: vehicle.headingRad,
    progressMiles: 0,
    clock,
    dayDebt: 0,
    contacts: generateEncountersWithPursuit(resolved.route, clock.dayIndex, sessionSeed, pursuitLevel, history),
    wrecks: [],
    hazards: [],
  };
}

/** True while `unit.design` mounts at least one weapon that actually deals damage — mirrors `@/sim/arena`'s/`@/sim/encounters`'s own `isCombatCapableArchetype`, applied to a spawned `EncounterUnit` instead of the archetype table row it came from. */
export function contactIsCombatCapable(unit: EncounterUnit): boolean {
  return unit.design.weapons.some((mounted) => getWeapon(mounted.weaponId).damage.kind !== 'NONE');
}

/**
 * `@/sim/encounters`'s `EncounterPersonality` (aggression/caution/
 * playerThreatBias) has no `skill` field — `@/sim/arena`'s `AIPersonality`
 * (the type `decideAI` actually reads, and `ArenaOpponentState.personality`'s
 * declared type) requires one. `@/sim/arena` reconciles this same drift for
 * ITS OWN archetype table by normalizing a raw `driving` skill against
 * `skillsConfig().skillMax` into that 0..1 knob (see its own unexported
 * `decisionSkillFromDriving`); this is that same normalization, reapplied
 * here because that helper isn't exported and a road encounter's archetype
 * comes from a structurally different table (`encounters.json`, not
 * `arenas.json`).
 */
export function roadOpponentAIPersonality(unit: EncounterUnit): AIPersonality {
  const cfg = skillsConfig();
  const span = cfg.skillMax - cfg.skillMin;
  const skill = span <= 0 ? 0 : Math.min(1, Math.max(0, (unit.skill.driving - cfg.skillMin) / span));
  return { aggression: unit.personality.aggression, caution: unit.personality.caution, playerThreatBias: unit.personality.playerThreatBias, skill };
}

/** Narrows a road contact to its `EncounterUnit` shape when it carries one (every contact `beginRoadTripWithEncounters` generates does) — never true for a bare `RoadContact`, which this codebase no longer constructs for a live trip but which the type still technically allows. */
export function asEncounterUnit(contact: RoadContact): EncounterUnit | undefined {
  return 'design' in contact ? (contact as EncounterUnit) : undefined;
}

/** A small, deterministic (never `Math.random`/`Date.now`) per-contact number in a fixed range, derived from `@/util/hash`'s `hashState` — used only for cosmetic spawn placement (lateral offset, AI seed), never anything gameplay-authoritative (that's still `@/sim/encounters`'s own seeded RNG stream). */
export function deterministicJitter(key: string, span: number): number {
  const n = Number.parseInt(hashState(key).slice(0, 8), 16);
  return (n % (span * 2 + 1)) - span;
}

export function roadOpponentVehicleId(contactId: string): string {
  return `road-${contactId}`;
}

/** The one place a defeated road opponent becomes a real `@/sim/road` `RoadWreck` — the fixed `wreck-${unit.id}` id convention `showRoad`'s own `stepCombat` uses, exported so a headless test can drive the exact same production seam instead of a parallel reimplementation. */
export function createRoadWreckFromDefeat(unit: EncounterUnit, position: Vec2, dayIndex: number): RoadWreck {
  return createWreck(`wreck-${unit.id}`, position, dayIndex, false);
}

/**
 * Real-time driving of `initialTrip`'s route (`@/sim/road`'s own
 * `stepRoadTrip`, which itself drives the vehicle through
 * `@/sim/driving`'s `stepDriving` - the exact same movement model the
 * arena and city screens use) until the odometer crosses the route's
 * length, then hands the arrived vehicle/clock and the destination city id
 * back to `onArrive`.
 *
 * Road encounters are not just flavor text: every contact `stepRoadTrip`
 * tracks that is `willFire` (hostile/retaliating) and within
 * `driving.json`'s own `radar.visualRangeM` gets a REAL spawned opponent
 * vehicle (`vehicleStateFromDesign` off its `EncounterUnit.design`, see
 * `beginRoadTripWithEncounters`), driven by the real `decideAI` and firing
 * through the exact same `fire()`/`applyResolvedShot()` pipeline the arena
 * screens use (`makeArenaAISystem`/`makeArenaDrivingSystem`/
 * `makeArenaWeaponsSystem`/`makeRoadDamageSystem`) — never a scripted or
 * pre-decided outcome. A defeated opponent becomes a real, searchable
 * `@/sim/road` `RoadWreck` (`createWreck`) at the spot it died; a peaceful
 * contact the player never attacks just passes by and is logged, never
 * fought.
 */
function showRoad(root: HTMLElement, state: CityRunState, initialTrip: RoadTripState, onArrive: (nextState: CityRunState) => void): void {
  const container = el('div', 'sm-screen sm-screen--road');
  container.style.cssText = 'position:absolute;inset:0;background:#05070a;';
  const canvas = el('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  const status = el('div');
  status.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);max-width:min(700px, calc(100vw - 260px));color:#d7e0ea;font-family:system-ui,sans-serif;font-size:13px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;text-align:center;';
  const notice = el('div');
  notice.style.cssText =
    'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);color:#ffd166;font-family:system-ui,sans-serif;font-size:12px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;text-align:center;max-width:80vw;';
  const retryBtn = el('button');
  retryBtn.style.cssText =
    'position:absolute;bottom:36px;left:50%;transform:translateX(-50%);pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';
  container.appendChild(canvas);
  container.appendChild(status);
  container.appendChild(notice);
  container.appendChild(retryBtn);
  clearAndAppend(root, container);

  lastSessionSeed = state.sessionSeed;

  let trip = initialTrip;
  let driver = state.driver;
  const drivingSkill = getSkill(driver, 'driving');
  const dtSecondsFixed = dtSecondsFromTickRate(drivingConfig().tickRateHz);
  const playerVehicleId = trip.vehicle.id;

  // --- combat overlay: real spawned opponents for every currently-engaged
  // hostile/retaliating contact, driven by the exact same @/sim/ai + fire()
  // pipeline the arena screens use (see this function's own doc comment). ---
  const combatWorld: World = createWorld({
    rngSeed: 0,
    arena: { id: trip.resolved.route.id, kind: 'route' },
    entities: { vehicles: [trip.vehicle] },
  });
  combatWorld.rngState = createRng(state.sessionSeed).stream(`road-combat|${trip.resolved.route.id}`).serialize();
  const opponentVehicles = new Map<string, VehicleState>();
  const opponents = new Map<string, ArenaOpponentState>();
  const contactByVehicleId = new Map<string, EncounterUnit>();
  const aiInputs = new Map<string, InputFrame>();
  const projectileTargets = new Map<string, string>();
  const spawnCounter = { current: 0 };
  const resolvedContactIds = new Set<string>();
  const passedContactIds = new Set<string>();

  function logNotice(text: string): void {
    notice.textContent = text;
  }

  function engagementRangeM(): number {
    return drivingConfig().radar.visualRangeM;
  }

  /** Spawns/despawns opponent vehicles for this tick's `trip.contacts` against `trip.progressMiles`, and logs a peaceful pass-by once per contact. Positions are derived from the player's own live position, offset along the route's fixed heading axis by the contact's remaining route-miles — the road has no independent 2D map, so this IS the contact's world position, exactly as `vehicleSpriteInstance`/combat below expect. */
  function updateEngagement(): void {
    const axis: Vec2 = { x: Math.cos(trip.routeHeadingRad), y: Math.sin(trip.routeHeadingRad) };
    const perp: Vec2 = { x: -axis.y, y: axis.x };
    const metersPerMile = drivingConfig().metersPerMile;
    const range = engagementRangeM();

    for (const contact of trip.contacts) {
      const unit = asEncounterUnit(contact);
      if (unit === undefined || resolvedContactIds.has(unit.id)) continue;
      const distanceM = Math.abs(unit.routeMiles - trip.progressMiles) * metersPerMile;
      const vehicleId = roadOpponentVehicleId(unit.id);
      const engaged = willFire(unit) && contactIsCombatCapable(unit) && distanceM <= range;

      if (engaged && !opponentVehicles.has(vehicleId)) {
        const deltaM = (unit.routeMiles - trip.progressMiles) * metersPerMile;
        const lateralM = deterministicJitter(unit.id, 12);
        const position: Vec2 = {
          x: trip.vehicle.position.x + axis.x * deltaM + perp.x * lateralM,
          y: trip.vehicle.position.y + axis.y * deltaM + perp.y * lateralM,
        };
        const headingRad = Math.atan2(trip.vehicle.position.y - position.y, trip.vehicle.position.x - position.x);
        const vehicle = vehicleStateFromDesign(unit.design, vehicleId, vehicleId, position, headingRad);
        opponentVehicles.set(vehicleId, vehicle);
        opponents.set(vehicleId, {
          archetypeId: unit.archetypeId,
          personality: roadOpponentAIPersonality(unit),
          driver: opponentDriverState(unit.skill),
          seed: deterministicJitter(`${unit.id}:seed`, 2 ** 30),
        });
        contactByVehicleId.set(vehicleId, unit);
        logNotice(t('ui.road.contactHostile', { faction: unit.faction }));
      } else if (!engaged && opponentVehicles.has(vehicleId)) {
        if (contact.disposition === 'fleeing') logNotice(t('ui.road.contactFled', { faction: unit.faction }));
        opponentVehicles.delete(vehicleId);
        opponents.delete(vehicleId);
        contactByVehicleId.delete(vehicleId);
      }

      if (
        contact.disposition === 'peaceful' &&
        !passedContactIds.has(unit.id) &&
        distanceM <= trafficPassRangeM()
      ) {
        passedContactIds.add(unit.id);
        logNotice(t('ui.road.trafficPassing', { faction: unit.faction }));
      }
    }
  }

  /** One combat tick against every currently-engaged opponent: real AI, real driving, real fire, real damage — the same systems the arena screens run, minus arena's own match bookkeeping (`makeRoadDamageSystem` instead of `makeArenaDamageSystem`). Any opponent it defeats becomes a real `RoadWreck` at the position it died. */
  function stepCombat(playerInput: InputFrame, dtSeconds: number): void {
    combatWorld.tick += 1;
    combatWorld.entities.vehicles = [trip.vehicle, ...opponentVehicles.values()];

    const driverRef = { current: driver };
    // The road has no fixed floor: bound the AI on a box that FOLLOWS the player.
    makeArenaAISystem(playerVehicleId, opponents, aiInputs, (w) => {
      const p = w.entities.vehicles.find((v) => v.id === playerVehicleId);
      return roadBounds(p?.position ?? { x: 0, y: 0 });
    })(combatWorld, playerInput, dtSeconds);
    makeArenaDrivingSystem(driverRef, playerVehicleId, opponents, aiInputs)(combatWorld, playerInput, dtSeconds);
    makeArenaWeaponsSystem(driverRef, playerVehicleId, opponents, aiInputs, projectileTargets, spawnCounter, () => {})(
      combatWorld,
      playerInput,
      dtSeconds,
    );
    projectilesSystem(combatWorld, playerInput, dtSeconds);
    makeRoadDamageSystem(playerVehicleId, driverRef, opponents, projectileTargets)(combatWorld, playerInput, dtSeconds);
    cleanupSystem(combatWorld, playerInput, dtSeconds);
    driver = driverRef.current;

    // Merge combat-relevant fields back onto the authoritative `trip.vehicle`
    // (position/heading/speed/odometer/battery stay `stepRoadTrip`'s alone —
    // this system's own redundant movement of the player entry is discarded).
    const playerAfter = combatWorld.entities.vehicles.find((v) => v.id === playerVehicleId);
    if (playerAfter !== undefined) {
      trip = {
        ...trip,
        vehicle: {
          ...trip.vehicle,
          armorDP: playerAfter.armorDP,
          tireDP: playerAfter.tireDP,
          plantDP: playerAfter.plantDP,
          weapons: playerAfter.weapons,
          destroyed: playerAfter.destroyed,
          statusEffects: playerAfter.statusEffects,
          controlStress: playerAfter.controlStress,
          controlLossTicks: playerAfter.controlLossTicks,
        },
      };
    }

    for (const [vehicleId, unit] of [...contactByVehicleId.entries()]) {
      if (opponents.has(vehicleId)) {
        const updated = combatWorld.entities.vehicles.find((v) => v.id === vehicleId);
        if (updated !== undefined) opponentVehicles.set(vehicleId, updated);
        continue;
      }
      // No longer tracked in `opponents` after this tick's damage system ran
      // -> defeated this tick. Leave behind a real, searchable wreck.
      const deadVehicle = combatWorld.entities.vehicles.find((v) => v.id === vehicleId) ?? opponentVehicles.get(vehicleId);
      opponentVehicles.delete(vehicleId);
      contactByVehicleId.delete(vehicleId);
      resolvedContactIds.add(unit.id);
      if (deadVehicle !== undefined) {
        const wreck: RoadWreck = createRoadWreckFromDefeat(unit, deadVehicle.position, trip.clock.dayIndex);
        trip = { ...trip, wrecks: [...trip.wrecks, wreck] };
      }
      logNotice(t('ui.road.contactDefeated', { faction: unit.faction }));
    }
  }

  /** Damage taken so far, per still-tracked contact — what `stepRoadTrip` needs to decide a faction's `fleesAtDamageFraction` break. */
  function contactDamageThisTick(): ReadonlyMap<string, number> {
    const damage = new Map<string, number>();
    for (const [vehicleId, unit] of contactByVehicleId) {
      const vehicle = opponentVehicles.get(vehicleId);
      if (vehicle !== undefined) damage.set(unit.id, armorDamageFraction(vehicle));
    }
    return damage;
  }

  // --- input ------------------------------------------------------------
  const codesDown = new Set<string>();
  const inputTracking = attachCodeTracking(codesDown);
  const weaponSelection = makeWeaponSelection(() => trip.vehicle.weapons.length);
  const touch = mountTouchControls(container, {
    fire: true,
    commands: [
      { id: 'searchWreck', labelKey: 'ui.touch.searchWreck', onPress: trySearchWreck, initiallyVisible: false },
      ...weaponTouchCommands(weaponSelection, trip.vehicle),
    ],
  });

  let gpuCtx: GpuContext | undefined;
  let resources: RenderResources | undefined;
  let atlasIndex: AtlasIndex | undefined;
  let floorInstances: SpriteInstanceInput[] = [];
  const camera: Camera = createCamera();
  camera.setZoom(PIXELS_PER_METER_CSS);

  async function initRenderer(): Promise<void> {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const init = await initGpu(canvas);
    if (!init.ok) {
      logNotice(t('ui.arena.webgpuUnavailable', { reason: init.reason.kind }));
      return;
    }
    gpuCtx = init.context;

    atlasIndex = loadAtlasIndex(atlasManifestRaw);
    floorInstances = buildFloorInstances(atlasIndex);

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    resources = await buildRenderResources(gpuCtx, atlasBitmap, spriteShaderSource);

    gpuCtx.onRecovered(() => {
      void buildRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource).then((rebuilt) => {
        resources = rebuilt;
      });
    });
    gpuCtx.onRecoveryFailed(() => {
      resources = undefined;
    });
    wireRecoveryUi(gpuCtx, retryBtn, logNotice);
  }

  function renderFrame(): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;
    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setCenter(trip.vehicle.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    const atlas = atlasIndex;
    const opponentInstances = [...opponentVehicles.values()].filter((v) => !v.destroyed).map((v) => vehicleSpriteInstance(v, atlas));
    const spriteInstances = [vehicleSpriteInstance(trip.vehicle, atlas), ...opponentInstances];
    writeInstanceBuffer(gpuCtx.getDevice(), resources.tileInstanceBuffer, packInstances(floorInstances));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.spriteInstanceBuffer, packInstances(spriteInstances));

    const encoder = gpuCtx.getDevice().createCommandEncoder({ label: 'road-frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpuCtx.getContext().getCurrentTexture().createView(),
          clearValue: { r: 0.03, g: 0.04, b: 0.03, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.tileBindGroup, instanceCount: floorInstances.length },
    ]);
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.spriteBindGroup, instanceCount: spriteInstances.length },
    ]);
    pass.end();
    gpuCtx.getDevice().queue.submit([encoder.finish()]);
  }

  let rafHandle = 0;
  let lastTimeMs = performance.now();
  let stopped = false;

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    inputTracking.detach();
    window.removeEventListener('keydown', onSearchKey);
    touch?.destroy();
    gpuCtx?.destroy();
  }

  /** Every route this driver has ever cleared of live hostiles - folded into the returned `CityRunState.routeHistory` so `@/sim/encounters`'s repopulation clock starts counting from THIS arrival, not re-derived from scratch next time the route is driven. */
  function nextRouteHistory(): ReadonlyMap<string, RouteEncounterHistory> {
    const routeId = trip.resolved.route.id;
    const stillLive = trip.contacts.some((contact) => {
      const unit = asEncounterUnit(contact);
      return unit !== undefined && contactIsCombatCapable(unit) && !resolvedContactIds.has(unit.id) && willFire(contact);
    });
    if (stillLive) return state.routeHistory;
    const history = state.routeHistory.get(routeId) ?? FRESH_ROUTE_HISTORY;
    const cleared = recordRouteCleared(history, trip.clock.dayIndex);
    const next = new Map(state.routeHistory);
    next.set(routeId, cleared);
    return next;
  }

  function finish(): void {
    stop();
    const crossing = crossDestinationGate(trip);
    const destinationCityId = crossing?.cityId ?? state.cityId;
    const arrivedVehicle = crossing?.vehicle ?? trip.vehicle;
    onArrive({
      ...state,
      // `@/sim/road`'s own `stepRoadTrip`/`crossDestinationGate` never touch
      // `DriverState.cityId` (only `@/sim/economy`'s bus-travel service
      // does) - kept in sync here so `@/sim/fleet`'s `switchActiveVehicle`
      // (which gates a retrieval on `target.cityId === driver.cityId`) sees
      // the city the driver actually just arrived in, not a stale one from
      // before this trip.
      driver: { ...driver, cityId: destinationCityId },
      vehicle: arrivedVehicle,
      cityId: destinationCityId,
      clock: trip.clock,
      fleet: reconcileFleetWithVehicle(state.fleet, arrivedVehicle, false, destinationCityId),
      routeHistory: nextRouteHistory(),
    });
  }

  /** Player vehicle destroyed mid-route: abandon it where it died and return on foot to the ORIGIN city (SPEC "Road": abandoning leaves the car behind) rather than silently teleporting to the destination. */
  function finishDestroyed(): void {
    stop();
    logNotice(t('ui.road.playerWrecked'));
    onArrive({
      ...state,
      driver: { ...driver, cityId: trip.resolved.originCityId },
      vehicle: trip.vehicle,
      vehicleStored: true,
      cityId: trip.resolved.originCityId,
      clock: trip.clock,
      fleet: reconcileFleetWithVehicle(state.fleet, trip.vehicle, true, trip.resolved.originCityId),
      routeHistory: nextRouteHistory(),
    });
  }

  /** Nearest still-present, unsearched wreck within lunging distance, if any - `X` searches it (see `frame`'s own key handling below). */
  function nearbySearchableWreck(): RoadWreck | undefined {
    const reach = wreckSearchRangeM();
    return trip.wrecks.find(
      (wreck) => canSearchWreck(wreck, trip.clock.dayIndex) && vecLength(subtractVec(wreck.position, trip.vehicle.position)) <= reach,
    );
  }

  function trySearchWreck(): void {
    const wreck = nearbySearchableWreck();
    if (wreck === undefined) return;
    const result: SearchWreckResult = searchWreck(trip.vehicle, driver, wreck, trip.clock.dayIndex, state.rng);
    if (!result.ok) {
      logNotice(t('ui.road.wreckNotPresent'));
      return;
    }
    const nextWrecks = trip.wrecks.map((w) => (w.id === result.wreck.id ? result.wreck : w));
    trip = { ...trip, vehicle: result.vehicle, wrecks: nextWrecks };
    if (!result.success) {
      logNotice(t('ui.road.wreckSearchEmpty'));
    } else if (result.capacityExceeded) {
      logNotice(t('ui.road.wreckSearchFull'));
    } else {
      logNotice(t('ui.road.wreckSearchSuccess'));
    }
  }

  // 'X' (search a nearby wreck) is a fixed hotkey, same as city's 'G'/'F' -
  // not part of controls.json's rebindable action set.
  function onSearchKey(ev: KeyboardEvent): void {
    if (ev.key === 'x' || ev.key === 'X') trySearchWreck();
  }
  window.addEventListener('keydown', onSearchKey);

  function frame(nowMs: number): void {
    if (stopped) return;
    const dtSeconds = Math.max(0, Math.min((nowMs - lastTimeMs) / 1000, 0.25));
    lastTimeMs = nowMs;

    const raw = rawInputFrom(codesDown, touch);
    weaponSelection.update(raw);
    const resolvedInput = resolveInput(raw, currentControlPreset, currentControlBindings);
    const playerInput: InputFrame = {
      moveX: resolvedInput.moveX,
      moveY: resolvedInput.moveY,
      fire: resolvedInput.fire,
      weaponSlot: weaponSelection.active() ?? NO_WEAPON_SLOT,
    };

    const result = stepRoadTrip(trip, { stick: { x: playerInput.moveX, y: playerInput.moveY } }, dtSeconds, state.rng, drivingSkill, 'normal', contactDamageThisTick());
    trip = result.state;
    updateEngagement();
    stepCombat(playerInput, dtSecondsFixed);

    if (trip.vehicle.destroyed) {
      finishDestroyed();
      return;
    }

    const remainingMiles = Math.max(0, Math.round(trip.resolved.route.lengthMiles - trip.progressMiles));
    status.textContent = t(isCoarsePointer() ? 'ui.road.statusTouch' : 'ui.road.status', {
      city: cityName(trip.resolved.destinationCityId),
      miles: remainingMiles,
      day: trip.clock.dayIndex,
      phase: t(PHASE_LABEL_KEY[trip.clock.phase]),
    });
    const wreckNearby = nearbySearchableWreck() !== undefined;
    if (wreckNearby) logNotice(t('ui.road.wreckHint'));
    touch?.setCommandVisible('searchWreck', wreckNearby);
    renderFrame();
    if (result.arrived) {
      finish();
      return;
    }
    rafHandle = window.requestAnimationFrame(frame);
  }

  void initRenderer().finally(() => {
    lastTimeMs = performance.now();
    rafHandle = window.requestAnimationFrame(frame);
  });
}

// ---------------------------------------------------------------------------
// Boot entry point
// ---------------------------------------------------------------------------

export interface BootOptions {
  /** Defaults to `window.location.search`. Overridable for testing without a DOM `location`. */
  readonly search?: string;
  /** Defaults to `randomSessionSeed` (real crypto). Overridable for deterministic tests. */
  readonly randomSeed?: () => string;
  /** Defaults to opening the real IndexedDB save database. Overridable for testing. */
  readonly openDb?: () => Promise<IDBDatabase>;
}

export async function boot(root: HTMLElement, bootOptions: BootOptions = {}): Promise<void> {
  validateAllRulesets();

  const search = bootOptions.search ?? window.location.search;
  const openDb = bootOptions.openDb ?? (() => openSaveDatabase());
  const seedOverride = seedOverrideFromSearch(search);
  const randomSeed = bootOptions.randomSeed ?? randomSessionSeed;

  async function loadExistingSave(): Promise<LoadResult | null> {
    // An explicit ?seed= override always starts a brand-new session for
    // reproducing one specific bug report - it must never silently resume
    // whatever was already mid-session in IndexedDB instead.
    if (seedOverride !== null) return null;
    try {
      const db = await openDb();
      return await load(db);
    } catch {
      // Nothing saved yet (SaveNotFoundError), or IndexedDB unavailable
      // (private browsing, etc.) - either way, fall through to New Driver.
      return null;
    }
  }

  function startNewSession(): void {
    const sessionSeed = resolveSessionSeed({ search, randomSeed });
    lastSessionSeed = sessionSeed;
    console.info(`smduel: new session, seed ${sessionSeed}`);
    showDriverCreation(root, (driver) => {
      function openConstructor(): void {
        showConstructor(
          root,
          driver,
          (chargedDriver, confirmed) => {
            const vehicle = vehicleStateFromConfirmedBuild(confirmed, PLAYER_ID);
            const cityState: CityRunState = {
              driver: chargedDriver,
              vehicle,
              vehicleStored: false,
              clock: initialClock(),
              cityId: chargedDriver.cityId,
              sessionSeed,
              openDb,
              rng: createRng(sessionSeed).stream('driver'),
              search,
              rumorsHeardToday: new Map(),
              activeCourierJobs: [],
              fleet: { vehicles: [{ vehicle, stored: false, cityId: chargedDriver.cityId }] },
              routeHistory: new Map(),
              quests: [],
              arenaRecord: { wins: 0, losses: 0 },
            };
            showCity(root, cityState);
          },
          // Escape just restarts the constructor with a fresh (still legal,
          // still affordable) default build rather than stranding the
          // player with no way forward - there is no screen above this one
          // to cancel back to yet.
          openConstructor,
        );
      }
      openConstructor();
    });
  }

  function resumeSession(existing: LoadResult): void {
    if (existing.game.controlPreset !== undefined && existing.game.controlBindings !== undefined) {
      restoreControls(existing.game.controlPreset, existing.game.controlBindings);
    }
    const vehicleId = existing.game.activeVehicleId ?? Object.keys(existing.game.vehicles)[0];
    const vehicle = (vehicleId !== undefined ? existing.game.vehicles[vehicleId] : undefined) ?? null;
    if (existing.game.world !== null) {
      if (vehicle === null) {
        // A live arena `World` is a simulation the player's own car is IN.
        // Without one there is nothing to resume into, so a fresh session is
        // the only option, same as if no save existed. The city branch below
        // has no such requirement and resumes a carless driver on foot.
        startNewSession();
        return;
      }
      // Routed through `resolveResumeSessionSeed` (not just read off the save
      // directly) so the resume path honors the same documented priority
      // order as a new session - in practice this always resolves to the
      // save's own seed, since `loadExistingSave` above already refuses to
      // resume at all when `?seed=` is present, but it's the seam that keeps
      // this call itself exercised instead of dead code no test can reach.
      const sessionSeed = resolveResumeSessionSeed(existing.game.world, { search, randomSeed });
      lastSessionSeed = sessionSeed;
      console.info(`smduel: resumed session, seed ${sessionSeed}`);
      showArena(
        root,
        existing.game.driver,
        vehicle,
        { sessionSeed, restoreWorld: existing.game.world, openDb, quests: existing.game.quests },
        () => void start(),
      );
      return;
    }
    // Safely in a city (no live arena World) - the far more common case for
    // a real campaign session, and the one `resumeSession` used to just
    // throw away entirely (see `cityRunStateFromSaveGame`'s own doc comment
    // above). Rebuilds the real `CityRunState` the save was taken from,
    // campaign `quests` included, and resumes straight into the city rather
    // than starting over.
    const cityState = cityRunStateFromSaveGame(existing.game, vehicle, { openDb, search, randomSeed });
    lastSessionSeed = cityState.sessionSeed;
    console.info(`smduel: resumed session, seed ${cityState.sessionSeed}`);
    showCity(root, cityState);
  }

  async function start(): Promise<void> {
    const existing = await loadExistingSave();
    showTitle(root, {
      onNewDriver: () => startNewSession(),
      ...(existing !== null ? { onContinue: () => resumeSession(existing) } : {}),
    });
  }

  await start();
}
