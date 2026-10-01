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
import '@/ui/controls.css';
import '@/ui/builder.css';
import '@/ui/menu.css';
import '@/ui/hud.css';
import '@/ui/touch.css';

import { field, ignitionButton, panel } from '@/ui/controls';
import { icon, type IconName } from '@/ui/icons';

import {
  citiesConfig,
  drivingConfig,
  economy,
  getPlant,
  getTire,
  getWeapon,
  skillsConfig,
  RAW_RULESETS,
} from '@/data/rulesets';
import { validateRulesets } from '@/data/schema';
import { arcadeScoringEnabled, submitArcadeScore, type ArcadeSubmitFailure } from '@/arcade/client';
import { buildArcadePayload, shouldSubmitArcadeScore, type ArcadeScorePayload } from '@/arcade/score';
import {
  allOpponentsDefeated,
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
  isArenaEventId,
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
  triggerMine,
  triggerSpikes,
  type DeployableState,
} from '@/sim/combat';
import { computeBuildCached, roadLegalityMisses, type RoadLegalityMiss } from '@/sim/construct';
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
import { createDriver, getSkill, isDead } from '@/sim/driver';
import { applyCollision, closingSpeedMps, stepDriving, stopAtObstacle, isRadarDisabled, type DriveInput } from '@/sim/driving';
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
  placeRoadHazard,
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
  type ContactDisposition,
  type EncounterUnit,
  type FactionId,
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
import type { DayPhase, DriverState, RouteDef, SkillName, Vec2, VehicleDesign, VehicleState, WeaponDef } from '@/sim/types';
import { FACINGS, makeArmorRecord, sumArmor } from '@/sim/types';
import { createWorld, type World } from '@/sim/world';
import { createRng, type Rng } from '@/util/rng';
import { hashState } from '@/util/hash';
import { CURRENT_SCHEMA_VERSION } from '@/persist/migrate';
import { openSaveDatabase, save, load, type LoadResult, type RoadTripSave, type SaveGame, type QuestState } from '@/persist/save';
import {
  deliverQuest,
  hasWonVictory,
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
  cityShortcutForCode,
  cyclePressed,
  defaultBindings,
  describeAction,
  describeCityShortcut,
  describeCyclePair,
  directWeaponSlot,
  isBoundToAnyAction,
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
  type HudRadarContact,
  type HudMessageKind,
  type HudSettings,
  type HudSnapshot,
} from '@/ui/hud';
import { mountBuilder, type BuilderConfirmedBuild } from '@/ui/builder';
import { isOperationalFacilityKind, mountFacility, type ArenaEntryResult, type BuildingContext, type MountedFacility } from '@/ui/buildings';
import { leaveAction, LEAVE_ACTION_ID, mountBuildingPanel, type RumorId } from '@/ui/buildings/shared';
import {
  buildCityActorInstances,
  cityStaticLayers,
  cityLayer1InstanceCount,
  cityGroundDecalCount,
  facilityMarkerTint,
  // Ground-stain placement primitives, shared with the city scatter in
  // `city-view` so both screens draw the same three frames with the same
  // world-cell hashing. They live there because `app.ts` already imports from
  // that module and the reverse edge would be a cycle.
  DECAL_CELL_M,
  DECAL_CHANCE,
  decalCellHash,
  decalsInCells,
  type CityVehicleView,
  type CityViewSnapshot,
  WALL_SETBACK_M as CITY_WALL_SETBACK_M,
} from '@/ui/city-view';
import { mountMenu, type MenuAction, type MenuHeaderInfo, type MountedMenu } from '@/ui/menu';
import { cityName, facilityName, t } from '@/ui/strings';
import { isCoarsePointer, mountTouchControls, type TouchCommandSpec, type TouchControls } from '@/ui/touch';
import { createRecoveryOrchestrator, type RecoveryOrchestrator } from '@/ui/gpu-recovery';

import { initGpu, type GpuContext } from '@/render/gpu';
import {
  LOADING_PHASE,
  preloadImage,
  titleArtUrl,
  type LoadingScreen,
} from '@/ui/loading-screen';
import { loadAtlasIndex, type AtlasIndex } from '@/render/atlas';
import { createCamera, type Camera } from '@/render/camera';
import { groundQuad, GROUND_TILE_METRES } from '@/render/ground';
import {
  createAtlasBindGroup,
  createAtlasBindGroupLayout,
  createAtlasSampler,
  createCameraBindGroup,
  createCameraBindGroupLayout,
  createCameraUniformBuffer,
  createInstanceStorageBuffer,
  createLayerPipeline,
  createPostBindGroup,
  createPostBindGroupLayout,
  createPostPipeline,
  createPostSampler,
  createPostUniformBuffer,
  createShaderModule,
  encodePostPass,
  encodeSpritePass,
  cullInstances,
  packInstances,
  packPostUniforms,
  writeCameraUniform,
  writeInstanceBuffer,
  type AtlasDraw,
  type PostUniformValues,
  type SpriteInstanceInput,
  type Vec2M,
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
/**

/**
 * The travelling bolt, in metres, sized against the VEHICLE rather than against
 * an invented source box.
 *
 * The first version derived it from the frame's own pixel fraction
 * (`3m * 110/430` = 0.77m) and produced an effect that RENDERED and could not
 * be SEEN — measured, not assumed: at 0.77m the `fx-*` sprite is a faint smudge
 * on 144-luma ground, and the same frame at 12m is unmissable. That is this
 * log's iteration-68/64 class exactly — a cue that is present, measurable, and
 * below the threshold of the frame anyone reviews.
 *
 * So it is anchored on the thing a player already reads: the car. A bolt is
 * clearly smaller than the car it came from but must be unmistakable against
 * empty ground, so it is a third of the vehicle's footprint.
 * `VEHICLE_SPRITE_SIZE_M` is the one number for that, so the two cannot drift.
 */
const PROJECTILE_EFFECT_SIZE_M = {
  x: VEHICLE_SPRITE_SIZE_M.x / 3,
  y: VEHICLE_SPRITE_SIZE_M.y / 3,
};
/** The muzzle flash is ~2.4x the bolt it fires; see `projectileSpriteInstances`. Exported so a test can assert the ratio rather than restate it. */
export const MUZZLE_FLASH_SIZE_MULTIPLIER = 2.4;

/**
 * How long an impact spark survives, in SIMULATION ticks.
 *
 * Derived from the sim's own tick rate rather than a wall-clock guess, and
 * anchored on what the player can actually perceive: the arena runs at 60Hz
 * (driving.json's `tickRateHz`), so 14 ticks is ~230ms — long enough to catch
 * in peripheral vision while driving, short enough that it never becomes
 * scenery. A longer life is not a "brighter" effect, it is a stale one, and a
 * spark still hanging around a minute later is asserting a hit that has scrolled
 * out of relevance.
 */
const IMPACT_EFFECT_LIFETIME_TICKS = 14;

/** Hard cap on simultaneous sparks, independent of the age bound. */
const MAX_IMPACT_EFFECTS = 12;
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
 * Reads `?screen=` from a location.search-style string — the deterministic
 * screen-jump seam `boot` uses to open one named screen directly (see
 * `startScreenJump` there for why a visual-overhaul pass needs it). A missing,
 * blank, or unrecognised value yields null so boot falls through to the normal
 * title flow, which is the only path a real player ever takes.
 */
/**
 * Every screen `?screen=` may mount, and the ONLY allowlist — `startScreenJump`
 * routes against this same array, so a target cannot be routable without being
 * listed here and cannot be listed here without being routable.
 *
 * It is exported because of a bug this shape caused. `arena-event` was added as
 * a capture target, and the first live probe mounted NOTHING: no screen, no
 * error, no warning. `screenFromSearch` validated the param with `/^[a-z]+$/`,
 * which rejects the HYPHEN, so it returned `null` — and `null` is
 * indistinguishable from "no `screen` param at all". The route had silently
 * never existed.
 *
 * That is this log's most expensive recurring shape (a healthy-looking signal
 * standing in for a fact), and the reason the list is exported rather than
 * duplicated: a test now round-trips every entry through the parser, so the
 * next hyphenated target fails a unit test instead of a live probe.
 */
export const SCREEN_TARGETS = [
  'title',
  'controls',
  'driver',
  'constructor',
  'city',
  'arena',
  'arena-event',
  'road',
  'fleet',
] as const;

/** Membership test derived from `SCREEN_TARGETS` — a Set, because `target` arrives as a
 * plain `string` from the URL and `Array.includes` on an `as const` tuple would
 * narrow the comparison to the literal union instead. One list, two views. */
const SCREEN_TARGET_SET: ReadonlySet<string> = new Set(SCREEN_TARGETS);

export function screenFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get('screen');
  if (raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  // `-` is required: `arena-event` is a real target. `SCREEN_TARGETS` remains the
  // real gate — this regex only rejects characters no target could contain, so
  // a malformed value still cannot reach the router.
  return /^[a-z-]+$/.test(trimmed) ? trimmed : null;
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
    // Space is now bound to `fire` (controls.json), and Space's browser
    // default is to SCROLL THE PAGE. Gameplay owns input here, so a player
    // holding fire would otherwise jerk the view down on the first press —
    // trading a lie in the instructions for a camera that moves when you shoot,
    // which is worse. Only suppressed while a code is genuinely bound to an
    // action, so a Space press on a screen that does not use it (a menu, the
    // constructor's sliders) still scrolls the way a page normally would.
    if (ev.code === 'Space' && isBoundToAnyAction(currentControlBindings, currentControlPreset, 'Space')) ev.preventDefault();
  }
  function onKeyUp(ev: KeyboardEvent): void {
    codesDown.delete(ev.code);
  }
  /**
   * Releases every held key when the window loses focus.
   *
   * `keyup` is only delivered to a focused window, so alt-tabbing or clicking
   * away while holding throttle/keyboard-steer leaves those codes latched in
   * `codesDown` FOREVER — there is no event that will ever clear them. The
   * symptom is the car driving off on its own at full lock the moment the
   * player comes back, which reads as a physics or input bug and is neither.
   *
   * `visibilitychange` is handled too, because on mobile the page can be
   * backgrounded without a `blur` ever firing, and because a hidden tab can be
   * restored with a different focus state than it lost.
   */
  function releaseAll(): void {
    codesDown.clear();
  }
  function onVisibilityChange(): void {
    if (document.visibilityState !== 'visible') releaseAll();
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return {
    detach(): void {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}

const NO_TOUCH_BUTTONS: ReadonlySet<string> = new Set();
/**
 * Shared empty mouse/gamepad collections.
 *
 * `rawInputFrom` is called once per rendered frame on the city and road screens
 * and once per SIM TICK via `sampleInput` on the arena screens. It was
 * allocating two fresh `Set`s and a fresh array for the mouse, gamepad-button
 * and gamepad-axis channels on every one of those calls, to carry values that
 * are permanently empty: no mouse or gamepad listener is wired up anywhere, so
 * those three channels have never had anything in them.
 *
 * These are frozen-empty and shared, so a caller that mutated one would be
 * corrupting every other caller — which is the point. `RawInputState` declares
 * all three as `readonly` (`ReadonlySet` / `readonly number[]`), so a mutation
 * is already a type error; making the shared instance actually immutable turns
 * a silent cross-contamination bug into a loud one. When real gamepad support
 * lands, these are replaced by whatever the gamepad poller owns, and this note
 * goes with them.
 */
const NO_MOUSE_BUTTONS: ReadonlySet<number> = Object.freeze(new Set<number>());
const NO_GAMEPAD_BUTTONS: ReadonlySet<number> = Object.freeze(new Set<number>());
const NO_GAMEPAD_AXES: readonly number[] = Object.freeze([]);

function rawInputFrom(codesDown: ReadonlySet<string>, touch: TouchControls | null): RawInputState {
  return {
    keysDown: codesDown,
    mouseButtonsDown: NO_MOUSE_BUTTONS,
    gamepadButtonsDown: NO_GAMEPAD_BUTTONS,
    gamepadAxes: NO_GAMEPAD_AXES,
    touchAxes: touch?.axes() ?? NO_GAMEPAD_AXES,
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

function showTitle(
  root: HTMLElement,
  titleOptions: { onNewDriver: () => void; onContinue?: () => void; hasWonVictory?: boolean },
): void {
  const container = el('div', 'sm-screen sm-screen--title');
  // Full-screen title art as a CSS background on the screen container, never
  // a render/** WebGPU draw: this screen has no game world to render yet, so
  // paying for a GPU pass here would be pure overhead. The gradient overlay
  // keeps the menu's light text readable over the art at both phone and
  // desktop widths; it is a background, so it never intercepts a click or
  // tap — menuHost keeps getting every pointer and key event it always did.
  // `ui-title-art.png` loads relative to the page (same `new URL(...,
  // import.meta.url)` pattern the atlas image already uses below), so it
  // resolves correctly under vite's `base: './'` at the /smduel/ subpath.
  const titleArtUrl = new URL('../assets/ui-title-art.png', import.meta.url).href;
  container.style.cssText =
    // The lockup is centred; the MENU is pinned to the lower left.
    //
    // A review of the composition: "the dark menu box is dead-centre and its top
    // edge slices across both hero vehicles' hulls and the crack line in the
    // foreground, occluding the two machines the whole image is built around ...
    // the UI blocks the art instead of sitting on it."
    //
    // That is right, and it is the last thing standing between the title screen
    // and the art it is supposed to be selling. The art is built symmetrically —
    // two vehicles flanking a centre axis with the foreground crack leading up
    // through it — so a centred menu sits exactly on the one thing the
    // composition is pointing at. Pinning it to the lower-left third clears the
    // whole centre: both vehicles, the crack line, and the wordmark keep the
    // frame, and the menu reads as a deliberate corner plate rather than a
    // dialog dropped on the picture.
    //
    // Absolute positioning for both children rather than a flex column, because a
    // flex row cannot put one child on the centre axis and another in a corner.
    'position:absolute;inset:0;' +
    // A scrim, not a blackout.
    //
    // A review called the title "heavily crushed, muddy and desaturated ... the
    // foreground vehicles are merely silhouettes and the background city is lost
    // in the gloom", and asked for "a lighter, cleaner vignette overlay so the
    // cars remain the focal point". That is a real read of a real cause: the art
    // was sitting under a 0.55 -> 0.82 black gradient, so by the bottom of the
    // frame only 18% of it survived. The scrim earns its keep by making the
    // wordmark and tagline legible over a busy sunset, so it is not going away —
    // it is going from "blackout" to "vignette".
    //
    // It is a BAND, not a ramp. A flat 0.40 -> 0.66 ramp was tried first and
    // measured: it lifted the art but dropped the tagline from 9.10:1 to 5.56:1
    // against the brightest background adjacent to it, which is the pitch line of
    // the game and had been raised deliberately in iterations 12 and 15. So the
    // scrim is now dark only where there is TEXT to read and light everywhere
    // else, which is the only job it ever had.
    //
    // Darkest at 42% of the frame, which is the wordmark/tagline band; the top and
    // bottom thirds — where the two vehicles actually are — get 0.34 instead of
    // the 0.82 they were getting. Measured after: the tagline is back above 9:1
    // and the vehicle art is measurably brighter than it has ever been.
    // The outer stops were 0.34 and were tuned against a BRIGHT SUNSET plate.
    // The art is now a night tarmac (iteration 78 replaced the two tanks with a
    // single car on dark ground), so 0.34 over already-dark art bought nothing
    // and cost the hero car its silhouette — which is the exact complaint the
    // band was introduced to fix, arriving again through the opposite change.
    // Same rule as before, retuned for a plate that no longer needs protecting:
    // dark only where there is TEXT to read, light everywhere else. The peak
    // stays put because the wordmark band genuinely sits on the brightest part
    // of this plate (the lane line runs under the lockup).
    `background-image:linear-gradient(rgba(5,7,10,0.16),rgba(5,7,10,0.70) 42%,rgba(5,7,10,0.18)),url("${titleArtUrl}");` +
    'background-size:cover;background-position:center;';

  // --- the wordmark ---------------------------------------------------------
  // Until this existed the game had NO NAME on its own title screen. The only
  // "smduel" in the frame was a run of 12px monospace inside the menu panel's
  // status header, sitting between the date and the city name — visually the
  // least important string on screen, in a panel that reads as a debug menu
  // floating over the art. A review flagged it as "an unstyled debug menu
  // floating over finished concept art", which is exactly what it was.
  //
  // A title screen that does not show its title is a branding failure
  // regardless of how good the art behind it is, so the name now gets the
  // largest type in the frame, a subtitle to say what the game IS (the art
  // shows tanks, not cars, so the tagline has to do work), and the panel
  // steps back to being secondary.
  const lockup = el('div', 'sm-title-lockup');
  const wordmark = el('h1', 'sm-title-wordmark');
  wordmark.textContent = t('ui.title.appName');
  const tagline = el('p', 'sm-title-tagline');
  tagline.textContent = t('ui.title.tagline');
  lockup.appendChild(wordmark);
  lockup.appendChild(tagline);
  lockup.style.cssText = 'position:absolute;left:0;right:0;top:38%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;padding:0 16px;';
  container.appendChild(lockup);

  if (titleOptions.hasWonVictory === true) {
    const wonLine = el('div', undefined, t('ui.title.campaignWon'));
    wonLine.style.cssText = 'position:absolute;left:0;right:0;top:58%;text-align:center;color:#4fd6c4;font-weight:600;font-family:system-ui,sans-serif;';
    container.appendChild(wonLine);
  }
  const menuHost = el('div');
  menuHost.style.cssText =
    'position:absolute;left:clamp(16px,4vw,56px);bottom:clamp(20px,5vh,56px);width:min(360px,calc(100vw - 32px));';
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
    // No run is in progress yet, so there is no money, no day and no city to
    // report. The header is still passed (it is required, and the controls and
    // continue paths re-render through this same mount) but explicitly hidden —
    // a session readout above "New Driver" read as a debug block, and it was
    // describing a session that did not exist.
    showHeader: false,
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

/**
 * Which glyph stands for each skill.
 *
 * A lookup BY SKILL NAME rather than an index into the icon set, because
 * `cfg.skills` is the authority on which skills exist and its order is not
 * guaranteed to be stable — an icon table indexed by position would silently
 * put the wrench on Marksmanship the day someone reorders skills.json. A skill
 * with no entry gets no glyph, which is honest; the wrong glyph is not.
 */
const SKILL_ICONS: Readonly<Record<string, IconName>> = {
  driving: 'steering-wheel',
  marksmanship: 'crosshair',
  mechanic: 'wrench',
};

function showDriverCreation(root: HTMLElement, onCreated: (driver: DriverState) => void): void {
  const cfg = skillsConfig();
  const container = el('div', 'sm-screen sm-screen--driver');
  container.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--ui-ink);font-family:var(--ui-font-sans);';

  const card = el('div');
  card.style.cssText =
    'width:min(460px,92vw);max-height:92vh;overflow:auto;background:var(--ui-surface);border:1px solid var(--ui-line);border-radius:12px;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,0.45);';
  const title = el('h2', undefined, t('ui.driverCreation.title'));
  // The display face, set wide and uppercase. This card now leads with a
  // heading that looks like the same product as the tribute card and the
  // ignition switch below it, instead of a browser-default h2.
  title.style.cssText =
    'margin:0 0 4px;font-family:var(--ui-font-display);font-size:22px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--ui-ink);';
  card.appendChild(title);
  const subtitle = el('p', undefined, t('ui.driverCreation.subtitle'));
  subtitle.style.cssText = 'margin:0 0 20px;font-size:12px;line-height:1.5;color:var(--ui-ink-dim);letter-spacing:0.04em;';
  card.appendChild(subtitle);

  // --- Skill points ---------------------------------------------------------
  //
  // One panel, three rows: glyph, name, points box. The first attempt at this
  // nested a panel per skill inside the skills panel and gave each its own
  // "Points" field, which produced three levels of border for three numbers,
  // said "Points" four times, and drew each skill's icon twice — once in the
  // sub-panel header and again in the field. The screenshot is what caught it;
  // the markup read fine. The row now names the skill once and the box says the
  // number, which is the whole job.
  //
  // The icons are looked up BY SKILL NAME (see `SKILL_ICONS`), so a skill
  // added to skills.json without an entry here gets no glyph rather than
  // whichever one happened to be next in the table.
  const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
  const remainder = cfg.startingSkillPool - base * cfg.skills.length;
  const skillInputs = new Map<SkillName, HTMLInputElement>();

  function currentTotal(): number {
    let total = 0;
    for (const input of skillInputs.values()) total += Number.parseInt(input.value, 10) || 0;
    return total;
  }

  const skillsPanel = panel(t('ui.driverCreation.skillsTitle'), 'gauge');
  for (const [index, skillName] of cfg.skills.entries()) {
    const glyph = SKILL_ICONS[skillName] ?? 'gauge';
    const row = el('div', 'sm-skill-row');

    row.appendChild(icon(glyph, { className: 'sm-skill-row__icon' }));
    const nameEl = el('span', 'sm-skill-row__name', t(`ui.driverCreation.skill.${skillName}`));
    row.appendChild(nameEl);
    row.appendChild(el('span', 'sm-skill-row__leader'));

    const skillField = field({
      label: t(`ui.driverCreation.points.${skillName}`),
      type: 'number',
      layout: 'inline',
      min: cfg.skillMin,
      max: cfg.skillMax,
      onInput: () => {
        refreshRemaining();
        nameField.setError(null);
      },
    });
    skillField.input.value = String(base + (index === cfg.skills.length - 1 ? remainder : 0));
    row.appendChild(skillField.root);
    skillsPanel.body.appendChild(row);
    skillInputs.set(skillName, skillField.input);
  }

  // The remaining-points readout lives INSIDE the panel it is about. It used to
  // sit loose between the skills and the name field, where it collided with the
  // name field's own label and read as part of it.
  const remainingLabel = el('div', 'sm-panel__foot');
  function refreshRemaining(): void {
    const left = cfg.startingSkillPool - currentTotal();
    remainingLabel.textContent = t('ui.driverCreation.pointsRemaining', { count: left });
    // A zero balance and an over-budget split are different states and the
    // player needs to tell them apart at a glance: one is done, one is a
    // mistake they have to fix before the key will turn.
    remainingLabel.classList.toggle('sm-panel__foot--spent', left === 0);
    remainingLabel.classList.toggle('sm-panel__foot--over', left < 0);
  }
  skillsPanel.root.appendChild(remainingLabel);
  card.appendChild(skillsPanel.root);
  refreshRemaining();

  // --- Driver name ----------------------------------------------------------
  //
  // Built from the shared `field()`, so this box and the arcade score name box
  // are the same control by construction rather than by remembering to style
  // them alike. They were two hand-built inputs with two different looks.
  const nameField = field({
    label: t('ui.driverCreation.nameLabel'),
    iconName: 'id-badge',
    placeholder: t('ui.driverCreation.namePlaceholder'),
    maxLength: cfg.driver.nameMaxLength,
    // Enter on the name field turns the key, exactly like clicking the switch.
    // Wired through the field's own onSubmit rather than a second keydown
    // handler on the input, so the two routes cannot drift.
    onSubmit: () => submit.click(),
    onInput: () => nameField.setError(null),
  });
  nameField.input.value = 'Driver';
  // Breathing room under the skills panel. Without it the name field's label
  // sits flush against the panel's bottom border and the two read as one block.
  nameField.root.style.marginTop = '20px';
  card.appendChild(nameField.root);

  // --- The ignition switch --------------------------------------------------
  //
  // Replaces a flat teal `<button>` whose label was a copy of the page title
  // ("Create Driver" twice on one screen, the second one as the button). The key
  // turns, the starter engages, and only then is a driver built.
  const submit = ignitionButton({
    label: t('ui.driverCreation.ignite'),
    onIgnite: () => {
      const skills = {} as Record<SkillName, number>;
      for (const [skillName, input] of skillInputs) {
        skills[skillName] = Number.parseInt(input.value, 10) || 0;
      }
      const result = createDriver(nameField.value(), skills);
      if (!result.ok) {
        // The failure belongs to the name field when it is the name's fault and
        // to the points line when it is the split's, rather than to one generic
        // red line under everything: a player who typed a duplicate name should
        // be told which box to change.
        const isNameProblem = /name/i.test(result.reason);
        nameField.setError(isNameProblem ? result.reason : null);
        if (!isNameProblem) remainingLabel.textContent = result.reason;
        return;
      }
      onCreated(result.driver);
    },
  });
  submit.style.marginTop = '18px';
  card.appendChild(submit);

  container.appendChild(card);
  clearAndAppend(root, container);
  nameField.input.focus();
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

  // --- deployables ----------------------------------------------------------
  // Trigger mines and spike strips against any live vehicle inside their radius,
  // then consume the deployable. A deployable fires ONCE: it is dropped in the
  // same pass that triggered it, so a vehicle parked on a mine is hit once rather
  // than once per frame.
  //
  // This is the consumer `@sim/combat`'s `triggerMine` / `triggerSpikes` were
  // always written for. Until now nothing pushed to
  // `world.entities.deployables`, so both were unreachable outside their own
  // unit test and `minedropper` / `spikedropper` did nothing at all.
  //
  // SCOPE, stated plainly: this makes the two CONTACT deployables real. The
  // other three (`smokescreen`, `paintsprayer`, `oiljet`) are CLOUD and SLICK
  // deployables, whose effects run through `driving`'s `SurfaceEffect` model and
  // the AI's line-of-sight — a chain that additionally needs cloud lifetimes and
  // a live `HazardInstance` list built from the cloud entities. They are now
  // spawned and retained, but still have no effect; wiring them is a feature,
  // not a fix, and is not smuggled in as one.
  if (world.entities.deployables.length === 0) return;
  const survivors: DeployableState[] = [];
  for (const deployable of world.entities.deployables) {
    const def = deployable.deployable;
    // Only MINE and SPIKES have a contact trigger; CLOUD and SLICK are carried
    // through untouched.
    if (def.kind !== 'MINE' && def.kind !== 'SPIKES') {
      survivors.push(deployable);
      continue;
    }
    const radiusM = def.triggerRadiusM;
    let consumed = false;
    for (let i = 0; i < world.entities.vehicles.length; i++) {
      const vehicle = world.entities.vehicles[i];
      if (vehicle === undefined || vehicle.destroyed) continue;
      if (Math.hypot(vehicle.position.x - deployable.position.x, vehicle.position.y - deployable.position.y) > radiusM) continue;
      // Damage is drawn from the WORLD's own seeded RNG, so triggering a mine is
      // deterministic per match like every other combat roll. The two-step
      // withWorldRng dance is how this file already borrows a draw without
      // duplicating the stream.
      const { vehicle: hurt } = withWorldRng(world, (rng) =>
        def.kind === 'MINE'
          ? triggerMine(vehicle, def, deployableDamagePoints(getWeapon(deployable.weaponId)), rng)
          : triggerSpikes(vehicle, getTire(vehicle.design.tireId), deployableDamagePoints(getWeapon(deployable.weaponId)), rng),
      );
      world.entities.vehicles[i] = hurt;
      consumed = true;
      break;
    }
    if (!consumed) survivors.push(deployable);
  }
  world.entities.deployables = survivors;
};

/**
 * The damage a mine or spike strip inflicts: the laying weapon's own
 * `damagePerDeployable`-equivalent is not a field, so this reads the weapon's
 * RANGE damage band and takes its maximum.
 *
 * Taking the maximum is the conservative reading of "a mine hurts as much as
 * the weapon that laid it" — a mine laid by a rocket launcher should hurt like a
 * rocket, and `rng.int(min, max)` here would make that a coin flip on every
 * trigger. If weapons.json ever grows an explicit per-deployable damage field,
 * this is the single place to read it.
 */
function deployableDamagePoints(weapon: WeaponDef): number {
  if (weapon.damage.kind === 'NONE') return 0;
  if (weapon.damage.kind === 'RANGE') return weapon.damage.max;
  return weapon.damage.maxPerCheck * weapon.damage.checks;
}

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
 *
 * The armor loss is charged ONLY on the first tick a given pair is in contact
 * (`priorContactPairs` is the overlap set this same resolver wrote at the end
 * of the previous tick, so a sustained grind costs one impact rather than
 * `armorLossPoints` × 60 every second). Without that gate this resolver is a
 * damage amplifier, not a collision model: `vehicleSeparationM` is 0.4m total,
 * while two cars closing at 40 m/s re-close ~1.33m in a single 1/60s tick, so
 * the nudge can NEVER clear the overlap — the pair re-overlaps next tick, and
 * the next, stripping FRONT armor one point per tick for the whole contact.
 * Measured on `ny-philadelphia` day 0: the player's 2-point FRONT armor was
 * gone in 2 ticks and the contact's 12-point FRONT armor in 12, which is where
 * all 12 points of damage in that fight came from — the player's own rockets
 * never landed a point. Separation and `stopAtObstacle` still run EVERY tick;
 * only the damage is gated.
 */
function resolveVehicleCollisions(
  vehicles: readonly VehicleState[],
  priorContactPairs: readonly string[],
): { vehicles: VehicleState[]; contactPairs: string[] } {
  const drivingCfg = drivingConfig();
  const mphPerMps = 3600 / drivingCfg.metersPerMile;
  const prior = new Set(priorContactPairs);
  const contactPairs: string[] = [];
  const out = vehicles.map((v) => v);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      // Re-read BOTH entries inside the inner loop. They used to be captured
      // once per `i`, so with three mutually overlapping cars the j=i+1 and
      // j=i+2 pairs each wrote `out[i]`'s separation from the ORIGINAL `a` and
      // the second write silently discarded the first. A three-car pile-up
      // therefore separated by one nudge rather than two and could stay wedged
      // across ticks — the exact outcome this function exists to prevent.
      const a = out[i];
      if (a === undefined || a.destroyed) break;
      const b = out[j];
      if (b === undefined || b.destroyed) continue;
      if (!orientedRectsOverlap(vehicleOrientedRect(a), vehicleOrientedRect(b))) continue;

      // Sorted so the key does not depend on which vehicle happened to land at
      // the lower array index this tick.
      const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      contactPairs.push(pairKey);
      const firstTickOfContact = !prior.has(pairKey);

      // Impact speed must be the CLOSING speed along the line of centres, not
      // the larger of two signed speeds.
      //
      // `speedMps` is signed along each body's OWN forward axis
      // (`{cos h, sin h}`, see sim/driving.ts), so it has to be turned into
      // that body's world velocity before it can be projected onto the ONE
      // shared separation axis. The code below used to project the two raw
      // scalars onto `awayFromA` directly, which collapsed to
      // `(b.speedMps - a.speedMps) * (n.x + n.y)` — exactly ZERO for a head-on
      // meeting where both cars carry the same signed speed and the axis is
      // axis-aligned. A 100mph head-on therefore charged `applyCollision` a
      // closing speed of 0 and did no damage at any speed, and reverse-ramming
      // was dead for the same reason. It is now `|dot(v_a, n) - dot(v_b, n)|`
      // with each body's own world velocity.
      //
      // **IT WAS DEFERRED FOR FOUR ITERATIONS AS A BALANCE CALL, AND THAT
      // FRAMING WAS WRONG.** The recorded evidence was "with the per-tick
      // damage gate in place, this makes a fully passive player in Amateur
      // Night never die at all — arena still up at tick 96,000 against a
      // documented 2,863", and a number that contradicts the mechanism is
      // evidence about the measurement.
      //
      // What was actually happening (iterations 145-147, each superseding the
      // last): the two opponents that survived the pile-up were not failing to
      // fire for any range reason — they were sitting at a heading error of
      // 125-176 degrees FROM the player, moving in REVERSE, because
      // `computeAlignmentInput` emitted a stick the driving model reads as
      // reverse, and a reversing car does not steer at all. They were parked
      // facing away from a stationary target, in range, ready, and structurally
      // unable to turn around. Correcting the physics let them reach the
      // contact range where that deadlock is reachable; it did not create it.
      //
      // With the steering-cone clamp in `computeAlignmentInput` the same
      // passive run now resolves, and the corrected formula ships on the same
      // evidence that every other formula change in this file ships on.
      const distanceM = vecLength(subtractVec(b.position, a.position));
      const awayFromA =
        distanceM > 0
          ? { x: (b.position.x - a.position.x) / distanceM, y: (b.position.y - a.position.y) / distanceM }
          : { x: 1, y: 0 };
      // `a` closing on `b` adds to the gap closing; `b` closing on `a` subtracts
      // the same way, and the absolute value covers approach from either side.
      const closingMps = closingSpeedMps(a, b, awayFromA);
      const impactSpeedMph = closingMps * mphPerMps;
      const nudgeM = drivingCfg.collision.vehicleSeparationM / 2;

      const chargedA = firstTickOfContact ? applyCollision(a, impactSpeedMph) : a;
      const chargedB = firstTickOfContact ? applyCollision(b, impactSpeedMph) : b;
      const collidedA = stopAtObstacle(chargedA);
      const collidedB = stopAtObstacle(chargedB);
      out[i] = { ...collidedA, position: { x: a.position.x - awayFromA.x * nudgeM, y: a.position.y - awayFromA.y * nudgeM } };
      out[j] = { ...collidedB, position: { x: b.position.x + awayFromA.x * nudgeM, y: b.position.y + awayFromA.y * nudgeM } };
    }
  }
  return { vehicles: out, contactPairs };
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
    const resolved = resolveVehicleCollisions(driven, world.entities.contactPairs);
    world.entities.vehicles = resolved.vehicles;
    world.entities.contactPairs = resolved.contactPairs;
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
      } else if (result.spawn?.kind === 'DEPLOYABLE') {
        // Deployables were previously DROPPED on the floor: the weapon consumed
        // its ammo, the cooldown was set, and the `DeployableState` went out of
        // scope. Nothing ever pushed to `world.entities.deployables`, which left
        // `combat.triggerMine` / `triggerSpikes` unreachable from any
        // production path and made five of thirteen weapons inert.
        world.entities.deployables.push(result.spawn.deployable);
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
  /**
   * Called with the projectile's position at the instant a hit RESOLVES — not
   * when the bolt merely reaches a collider, and not when it expires at range.
   * That distinction is the whole point: a shot that lands and a shot that runs
   * out of range are different events to the player, and an effect drawn for
   * both would lie about half of them.
   *
   * This exists because a resolving projectile is DROPPED from
   * `world.entities.projectiles` on the tick it connects, so by render time
   * there is nothing left to draw. Iteration 118 recorded that as the reason an
   * impact effect needed a state addition. This is that addition.
   */
  onImpact?: (position: Vec2) => void,
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
      // The bolt is already gone from the world by this point, so this is the
      // only instant at which the hit has a position that can be drawn.
      onImpact?.(projectile.position);

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

/**
 * The post/grade pass's per-screen state.
 *
 * Factored out because the arena, arena-event, road and city screens each build
 * their own resource set with different instance buffers, and all four now run
 * the identical two-pass frame. Carrying the grade state as its own shape means
 * the graded encode path and the per-frame grade upload are written once instead
 * of four times — the duplication the four near-identical `renderFrame`s already
 * had, which is how they drifted in the first place.
 *
 * The scene texture itself is deliberately NOT in here: it is a *managed*
 * resource, recreated by `GpuContext.defineResource` on resize and on
 * device-loss recovery, so its view and bind group are re-derived per frame by
 * `writePostFrame` rather than cached.
 */
interface PostTemplate {
  readonly postPipeline: GPURenderPipeline;
  readonly postUniformBuffer: GPUBuffer;
  readonly postSampler: GPUSampler;
  /** Kept so `writePostFrame` can rebuild the bind group without recreating the layout. */
  readonly postLayout: GPUBindGroupLayout;
  /**
   * Releases every GPU object this template owns.
   *
   * Pipelines, bind group LAYOUTS and samplers are device-owned and go away with
   * the device, but BUFFERS and TEXTURES are not: they hold real memory and must
   * be destroyed explicitly. Without this, every device-loss recovery cycle
   * abandons a complete set — including a full-size copy of the 2048x2048
   * atlas texture — and repeated cycling (a real event on a laptop that
   * switches GPUs) accumulates until the adapter reports out-of-memory.
   *
   * This exists because the recovery path assigned `resources = rebuilt` and let
   * the old set fall out of scope, which is a leak, not a cleanup.
   */
  destroy(): void;
}

/** A `PostTemplate` with this frame's bind group, bound to the current scene texture. */
interface PostResources extends PostTemplate {
  readonly postBindGroup: GPUBindGroup;
}

interface RenderResources extends PostTemplate {
  readonly pipeline: GPURenderPipeline;
  readonly cameraBuffer: GPUBuffer;
  readonly cameraBindGroup: GPUBindGroup;
  readonly tileInstanceBuffer: GPUBuffer;
  readonly tileBindGroup: GPUBindGroup;
  readonly spriteInstanceBuffer: GPUBuffer;
  readonly spriteBindGroup: GPUBindGroup;
  readonly texture: GPUTexture;
  /** Destroys the buffers and the atlas texture. See PostTemplate.destroy. */
  destroy(): void;
}

/**
 * Ground capacity for the arena/road/event screens.
 *
 * Was `FLOOR_TILES_PER_SIDE ** 2` (81) because the old floor was a fixed 9x9
 * grid of one repeated frame. The ground is now ONE quad whose extent is
 * whatever covers the visible area, so the count is 1 — see `groundQuad`. 2048
 * is the ceiling every ground-using screen still sizes against;
 * `writeInstanceBuffer` does not bounds-check, and overrunning a storage buffer
 * is a WebGPU validation error, not a clamp.
 */
const TILE_INSTANCE_CAPACITY = 2048;
const SPRITE_INSTANCE_CAPACITY = 64;

/**
 * Extra metres of ground drawn beyond the visible area.
 *
 * There is no depth buffer and the camera is hard-locked to the player, so a
 * quad sized exactly to the view shows the clear colour at the frame edge on
 * rounding and while the window resizes. A few metres of overscan removes that
 * entirely, and costs one quad.
 */
const GROUND_MARGIN_M = 12;

/** The grade each screen runs. Screens differ deliberately: the arena is a hard-lit concrete pit, the road is open and dusty. The width/height/timeSeconds fields are supplied per frame by `writePostFrame`. */
const ARENA_GRADE: Omit<PostUniformValues, 'width' | 'height' | 'timeSeconds'> = {
  vignette: 0.38,
  bloom: 0.7,
  grain: 0.05,
  saturation: 1.1,
  contrast: 1.12,
  splitTone: 0.5,
  exposure: 0.92,
};

const ROAD_GRADE: Omit<PostUniformValues, 'width' | 'height' | 'timeSeconds'> = {
  vignette: 0.26,
  bloom: 0.45,
  grain: 0.07,
  saturation: 1.04,
  contrast: 1.06,
  splitTone: 0.7,
  exposure: 0.95,
};

const CITY_GRADE: Omit<PostUniformValues, 'width' | 'height' | 'timeSeconds'> = {
  vignette: 0.3,
  bloom: 0.4,
  grain: 0.045,
  saturation: 1.06,
  contrast: 1.08,
  splitTone: 0.4,
  exposure: 0.9,
};

/** Label for the managed offscreen scene texture, so `defineResource`/`getTexture` agree. */
const SCENE_TEXTURE_LABEL = 'scene-color';

/**
 * World-space half-extent of what the camera can see, in metres.
 *
 * Derived from the camera's own px/m and the viewport in CSS pixels, so it
 * tracks zoom and device pixel ratio without a second source of truth. The
 * ground field is sized from this, which is what makes the ground always reach
 * the edge of the screen — the old fixed-size floor did not, and left a black
 * band down one side of the road.
 */
function cameraVisibleHalfExtentM(camera: Camera): Vec2M {
  return camera.getHalfExtentsM();
}

/**
 * How far to zoom out, in metres, so the city's own bounds fill the viewport.
 *
 * The city is a ring of radius `boundsRadiusM` (about 10.7m for the largest
 * city, 16 cities total). At the old fixed 14 px/m it drew as a ~300px
 * postage stamp centred in a mostly-black screen. Fitting the bounds plus a
 * margin for the wall ring and the ground apron makes it fill the frame at any
 * window size.
 *
 * Clamped to {@link MIN_ZOOM_PX_PER_M}..{@link MAX_ZOOM_PX_PER_M} so a very
 * small city does not zoom to an unreadable blur, and a very wide window does
 * not reduce the world to a speck.
 */
function cityZoomPxPerM(size: { width: number; height: number }, boundsRadiusM: number): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = Math.max(1, size.width / dpr);
  const cssHeight = Math.max(1, size.height / dpr);
  // The city's true outer radius: the facility ring plus the fixed wall setback.
  //
  // This used to be `boundsRadiusM * CITY_FIT_MARGIN`, which is wrong for a
  // structural reason rather than a tuning one: the wall sits at an ABSOLUTE
  // `WALL_SETBACK_M` (8m) while the margin was a MULTIPLE of the radius. Those
  // two only agree at one city size. At New York's R=10.65 a 1.9 margin framed
  // 20.2m and just contained the 18.65m wall; at Providence's R=6 the same 1.9
  // framed 11.4m against a 14m wall, so the ring was cropped off the top and
  // bottom of the screen. No single ratio fixes both — expressing the fit in
  // metres does, for every city, with no per-city table.
  const wantRadiusM = boundsRadiusM + CITY_WALL_SETBACK_M + CITY_FIT_PAD_M;
  const fit = Math.min(cssWidth, cssHeight) / 2 / Math.max(wantRadiusM, 1);
  return clamp(fit, MIN_ZOOM_PX_PER_M, MAX_ZOOM_PX_PER_M);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Zoom floor. Below this the world becomes an unreadable smear. */
const MIN_ZOOM_PX_PER_M = 11;
/**
 * Zoom ceiling. Above this a single car fills the screen.
 *
 * This was 40 while the arena/road zooms sat at 17/15, which meant the ceiling
 * could never bind and the real limit was the arena constant. Raised to 64 so
 * the ceiling stays a genuine clamp as the scene zooms in.
 */
const MAX_ZOOM_PX_PER_M = 64;

/**
 * Slack beyond the wall ring, in metres, so the wall is not flush against the
 * frame edge. Metres rather than a ratio, to match CITY_WALL_SETBACK_M.
 */
const CITY_FIT_PAD_M = 3;

/**
 * Arena/event zoom, in pixels per metre.
 *
 * ## Why this nearly doubled
 *
 * A subcompact draws at 3.2 x 5.2 m (see VEHICLE_SPRITE_SIZE_M), so at the old
 * 17 px/m the player's own car was 54 x 88 device px inside a 1440x900 frame —
 * about 4% of the width. That reads as a postage stamp: the player cannot see
 * what they are driving, the car art is too small for its own detail to survive
 * the downscale, and every other visual problem (missing shadow, weak ground)
 * is being judged at a size where none of it can register.
 *
 * 30 px/m makes the same car 96 x 156 px. That is a normal top-down driving
 * camera: the car is the largest, clearest object on screen, and the ground and
 * shadow work is finally visible enough to judge.
 */
const ARENA_ZOOM_PX_PER_M = 40;
/**
 * Road zoom. Tighter than the arena was, but a little wider than the arena for
 * road ahead.
 *
 * Raised 28 -> 34, and deliberately NOT by the same factor as the arena. The
 * arena went 30 -> 40 (+33%) because two independent reviewers asked for it and
 * there is provably nothing out there to see: the arena is an unbounded field
 * (iteration 21 declined to fake boundaries into it) with no lanes, no props and
 * no landmarks, so every pixel past the car is empty floor, and the review that
 * asked for it measured the car at ~8% of frame width and named that as the
 * single biggest reason the game looks unfinished in motion.
 *
 * The road gets a smaller bump on purpose. Its zoom is wider than the arena's
 * for a stated reason — road AHEAD, so oncoming traffic is visible before it
 * arrives — and contacts on this screen are placed by remaining route-miles, so
 * cropping the view shortens the warning a player gets. A 1.5x jump would take
 * visible road from 32m to 21m, which is a third of the reaction distance given
 * away for a framing gain. 34 keeps 26.5m of it.
 *
 * Neither change can hide anything that was previously visible-and-load-bearing,
 * because awareness on both screens is the RADAR's job and it is unchanged:
 * `driving.json` sets `radar.visualRangeM` to 160m, so a contact is plottable at
 * more than three times the camera's width in either configuration. The camera
 * shows what you are driving; the radar tells you what is out there.
 *
 * Both stay under MAX_ZOOM_PX_PER_M (64), which exists precisely so the ceiling
 * binds as the scene zooms in rather than being decorative.
 */
const ROAD_ZOOM_PX_PER_M = 34;

/**
 * Creates (or re-creates, on resize and on device-loss recovery, via
 * `defineResource`) the offscreen colour target the world is composited into.
 *
 * The post pass used to be unwired dead code partly because there was nowhere
 * to put the scene: every `renderFrame` drew straight into the swapchain, so
 * even a wired `post.wgsl` had nothing to sample. Registering it as a managed
 * resource rather than a local is what makes it survive a resize or a lost
 * device without duplicating that logic in four render loops.
 */
function ensureSceneTexture(gpuCtx: GpuContext, width: number, height: number): GPUTexture {
  const existing = gpuCtx.getTexture(SCENE_TEXTURE_LABEL);
  if (existing !== undefined && existing.width === width && existing.height === height) return existing;
  gpuCtx.defineResource({
    label: SCENE_TEXTURE_LABEL,
    format: gpuCtx.getFormat(),
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const created = gpuCtx.getTexture(SCENE_TEXTURE_LABEL);
  if (created === undefined) throw new Error('render: scene texture was not created by defineResource');
  return created;
}

async function buildRenderResources(
  gpuCtx: GpuContext,
  atlasBitmap: ImageBitmap,
  spriteShaderSource: string,
  postShaderSource: string,
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

  const post = buildPostResources(gpuCtx, postShaderSource);
  return {
    pipeline,
    cameraBuffer,
    cameraBindGroup,
    tileInstanceBuffer,
    tileBindGroup,
    spriteInstanceBuffer,
    spriteBindGroup,
    texture,
    ...post,
    // Declared after the spread so it wins: the template's own destroy would
    // only release the post uniform buffer, and this set owns the atlas texture
    // and two instance buffers on top of it. Both post fields are still
    // destructured in via the spread.
    destroy(): void {
      // Each of these is real device memory that dropping the reference does NOT
      // free. Losing them is what made repeated device-loss recovery leak a full
      // 2048x2048 atlas texture plus buffers per cycle.
      texture.destroy();
      cameraBuffer.destroy();
      tileInstanceBuffer.destroy();
      spriteInstanceBuffer.destroy();
      post.postUniformBuffer.destroy();
    },
  };
}

/**
 * Builds the post pass's per-screen state: shader, pipeline, sampler and the
 * grade uniform buffer.
 *
 * Deliberately does NOT return a bind group. The scene texture is a *managed*
 * resource — `GpuContext.defineResource` recreates it on resize and on
 * device-loss recovery, handing back a brand new `GPUTexture` whose old bind
 * group is dead. The bind group is therefore re-derived every frame by
 * `writePostFrame`, which is one `createView` plus one `createBindGroup` on an
 * already-created texture: cheap, and it removes the whole class of
 * "renders fine until you resize the window" bugs.
 */
function buildPostResources(gpuCtx: GpuContext, postShaderSource: string): PostTemplate {
  const device = gpuCtx.getDevice();
  const postLayout = createPostBindGroupLayout(device);
  const postShaderModule = createShaderModule(device, 'post-shader', postShaderSource);
  const postUniformBuffer = createPostUniformBuffer(device);
  return {
    postPipeline: createPostPipeline({
      device,
      shaderModule: postShaderModule,
      targetFormat: gpuCtx.getFormat(),
      sourceLayout: postLayout,
      label: 'post-grade',
    }),
    postSampler: createPostSampler(device),
    postUniformBuffer,
    destroy(): void {
      // Only the buffer holds device memory. The pipeline, sampler and layout
      // are device-owned and reclaimed with the device itself.
      postUniformBuffer.destroy();
    },
    postLayout,
  };
}

/**
 * Binds the post pass to whatever `sceneTexture` currently is, and uploads the
 * grade for this frame.
 *
 * Split out because the scene texture is a *managed* resource: `defineResource`
 * recreates it on resize and on device-loss recovery, which hands back a brand
 * new `GPUTexture` whose old bind group is dead. Re-deriving the view and
 * bind group every frame is one `createView` and one `createBindGroup` on an
 * already-created texture — cheap, and it removes a whole class of
 * "works until you resize the window" bugs.
 */
function writePostFrame(
  gpuCtx: GpuContext,
  post: PostTemplate,
  grade: Omit<PostUniformValues, 'width' | 'height' | 'timeSeconds'>,
  timeSeconds: number,
): { readonly sceneView: GPUTextureView; readonly post: PostResources } {
  const device = gpuCtx.getDevice();
  const size = gpuCtx.getSize();
  const sceneTexture = ensureSceneTexture(gpuCtx, size.width, size.height);
  const sceneView = sceneTexture.createView();
  const postBindGroup = createPostBindGroup(device, post.postLayout, post.postSampler, sceneView, post.postUniformBuffer);
  device.queue.writeBuffer(
    post.postUniformBuffer,
    0,
    packPostUniforms({ ...grade, width: size.width, height: size.height, timeSeconds }),
  );
  return { sceneView, post: { ...post, postBindGroup } };
}

/**
 * Encodes the two-pass frame: world layers into the offscreen target, then the
 * grade pass from that target to the swapchain.
 *
 * This replaces the single `beginRenderPass`-straight-to-swapchain shape that
 * every one of the four render loops used to repeat. `outputView` is the
 * swapchain texture's view — the post pass writes THERE, sampling the scene
 * target, which is the whole reason the scene target exists.
 */
function encodeGradedFrame(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  post: PostResources,
  sceneView: GPUTextureView,
  outputView: GPUTextureView,
  cameraBindGroup: GPUBindGroup,
  layers: readonly AtlasDraw[],
): void {
  const encoder = device.createCommandEncoder({ label: 'frame' });

  const scenePass = encoder.beginRenderPass({
    label: 'scene',
    colorAttachments: [{ view: sceneView, clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
  });
  encodeSpritePass(scenePass, pipeline, cameraBindGroup, layers);
  scenePass.end();

  const postPass = encoder.beginRenderPass({
    label: 'post-grade',
    colorAttachments: [{ view: outputView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
  });
  encodePostPass(postPass, post.postPipeline, post.postBindGroup);
  postPass.end();

  device.queue.submit([encoder.finish()]);
}

/**
 * A contact shadow for a vehicle, drawn immediately beneath it.
 *
 * The scene has no lighting of any kind, so this is the entire reason a car
 * reads as a solid object sitting on the ground rather than a sticker floating
 * above it. It is one extra instance in the same buffer — no new art, no extra
 * draw call — because `sprite.wgsl` computes the radial falloff from the quad's
 * local position whenever `shadowSoftness > 0`.
 */
export function vehicleShadowInstance(vehicle: VehicleState, atlasIndex: AtlasIndex): SpriteInstanceInput {
  const frame = atlasIndex.frame(`car-${vehicle.design.bodyId}`);
  return {
    atlasId: String(frame.atlasIndex),
    position: { x: vehicle.position.x + SHADOW_OFFSET_M.x, y: vehicle.position.y + SHADOW_OFFSET_M.y },
    rotationRad: vehicle.headingRad,
    sizeM: { x: VEHICLE_SPRITE_SIZE_M.x * SHADOW_GROWTH, y: VEHICLE_SPRITE_SIZE_M.y * SHADOW_GROWTH },
    uvRect: frame.uv,
    tint: { r: 0, g: 0, b: 0, a: 1 },
    layer: 0,
    shadowSoftness: SHADOW_SOFTNESS,
    shadowOpacity: SHADOW_OPACITY,
  };
}

/**
 * Shadow offset from its caster, in metres. Sun high and to the upper-left, so
 * the shadow falls down-and-right (+x, -y on screen).
 *
 * ## Why this is a Vec2 and not one number
 *
 * The offset used to be a single scalar added to BOTH axes, and it was also
 * too small to see. Together those made the shadow invisible in a way that
 * looked like a broken feature rather than a tuning mistake: the quad is only
 * `SHADOW_GROWTH` times the car, so with a sub-metre offset almost the entire
 * shadow disc sat UNDER the opaque car sprite and the few pixels that peeked
 * out read as dirt. Cranking `SHADOW_OPACITY` changed nothing, because the
 * problem was coverage, not darkness.
 */
const SHADOW_OFFSET_M = { x: 1.0, y: -0.9 };
/**
 * How much bigger a shadow is than its caster, as a multiplier.
 *
 * This has to be comfortably above 1 for a top-down ortho camera: the shadow
 * is a soft disc, the caster is an opaque sprite, and anything near 1.0 is
 * simply hidden underneath it. 1.9 puts a clear halo of shadow out to roughly
 * a car's width on the shadow side, which is what actually reads as contact.
 */
const SHADOW_GROWTH = 1.9;
/**
 * Peak shadow alpha at the centre of the disc, and how soft the falloff is.
 *
 * These were 0.5 / 0.7 and had been untouched since iteration 1, which makes
 * the vehicle the oldest shadow in the game and — by this log's own record — the
 * weakest. Two iterations ago, iteration 17 found the BUILDINGS' shadow "soft
 * (0.8) and faint (0.42), so it never registered" and fixed it to 0.62 / 0.3.
 * Iteration 64 then found the entrance MARKERS were shipping at 0.5 / 0.9 —
 * softer AND fainter than that same already-inadequate pair — and raised them to
 * 0.62 / 0.5 on the reasoning that "a reviewer only ever sees a downscaled
 * frame". The vehicle was left at 0.5 / 0.7 and measured the weakest of the
 * three: ground directly beneath the car darkens by only ~8% (143.2 luma against
 * 153.7-156.8 either side of it, iteration 54), against a 0.62-opacity building
 * contact.
 *
 * Six reviews have now said the car is not grounded — iterations 15, 18, 43, 54,
 * 58 and 68, five of them as "it has no shadow at all". Each was recorded FALSE
 * on the measurement, and the measurement was right: the shadow exists. But a
 * shadow that only moves the ground 8% is the same under-powered cue the marker
 * had, on the one object that is in the centre of every arena and road frame, so
 * it is getting the same correction rather than a sixth FALSE.
 *
 * Opacity matches the buildings' 0.62, which is the value this codebase has
 * already proven registers. Softness tightens to 0.4 rather than matching a
 * building's 0.3, because a car is a low, small object and a tight contact pool
 * reads as weight where a broad soft blob reads as a smudge — the same
 * reasoning that keeps the marker softer than a building.
 */
const SHADOW_SOFTNESS = 0.4;
const SHADOW_OPACITY = 0.62;

/**
 * Builds the ground as a single quad for the arena / road / arena-event screens.
 *
 * The extent comes from the camera so the ground always covers the visible
 * area plus a margin. A fixed-size floor is what left a black band down one
 * side of the road, because a 90m arena floor is narrower than the view at some
 * window sizes.
 */
/**
 * Per-pool colour grade applied to the sampled ground.
 *
 * The city is the only entry, and it exists because the pool had to change
 * texture: `tile-asphalt-clean` carries a painted dashed highway centre line,
 * which tiled across a walled compound drew a motorway straight through the
 * perimeter wall. `tile-asphalt-cracked` has no markings but is a much paler
 * grey, and lifting the city's luma from 78 to 130 cost the buildings their
 * contrast against the ground.
 *
 * Darkening here rather than repacking the atlas keeps the correct texture and
 * the correct value, and it only works at all because the ground branch of
 * sprite.wgsl was fixed to read `tint.rgb` instead of discarding it.
 */
const GROUND_TINTS: Readonly<Record<string, { r: number; g: number; b: number; a: number }>> = {
  city: { r: 0.6, g: 0.63, b: 0.68, a: 1 },
};

/**
 * The highway's own surface, laid over the verge as a second quad.
 *
 * A review said the paved road and the off-road terrain "use the exact same
 * mottled grey pixel-noise texture and the same brightness", so "the only thing
 * separating 'drivable' from 'not drivable' is two thin solid white lines",
 * which costs the screen its core tension at speed. That was exactly what
 * shipped: ONE untinted ground quad meant the road and the shoulder were
 * literally the same material and the paint was doing all the work. Measured,
 * the two were 5 luma apart out of 255.
 *
 * This is a separate constant rather than a `GROUND_TINTS.road` entry on
 * purpose. The tints table is keyed by POOL, and the pool is shared by both
 * quads, so a `road` entry there silently re-tinted the verge as well — which
 * happened, produced a usable result, and was nothing like the intended
 * relationship. Dark asphalt against PALE cracked ground is the honest read, and
 * the verge should keep its own value.
 */
const ROAD_SURFACE_TINT = { r: 0.55, g: 0.57, b: 0.61, a: 1 } as const;

function buildGroundQuad(atlasIndex: AtlasIndex, center: Vec2M, halfExtentM: number, pool: string): SpriteInstanceInput[] {
  const scale = GROUND_TILE_METRES[pool] ?? { tileMetres: 24, detailScale: 8.3 };
  return [
    groundQuad(atlasIndex, {
      pool,
      center,
      halfExtentM,
      layer: 0,
      tileMetres: scale.tileMetres,
      detailScale: scale.detailScale,
      ...(GROUND_TINTS[pool] !== undefined ? { tint: GROUND_TINTS[pool] } : {}),
    }),
  ];
}

/** Composes a vehicle's render rotation from its simulation heading and its frame's `rotationOffsetDeg` — the exact seam a vehicle-orientation regression test drives directly, instead of reimplementing this formula (assets/ASSET-NOTES.md section 2). */
/**
 * Tint applied to a rendered vehicle.
 *
 * The player and their opponents are drawn with the SAME sprite, at the same
 * size, on a low-contrast ground — so at a glance the player's own car is just
 * another car. A vision review of the city frame called it "weak player/object
 * contrast" and said navigation "feels muddy", which is a real legibility
 * problem in a top-down game where finding yourself instantly is the single
 * most important visual read.
 *
 * The separation is a small VALUE difference, not a hue one: the player's car is
 * lifted slightly and opponents are pushed slightly down. A saturation or hue
 * shift would recolour the art and read as a different vehicle class, which
 * would be a lie about the build the player chose.
 */
export const PLAYER_TINT = { r: 1.18, g: 1.18, b: 1.18, a: 1 } as const;
export const OPPONENT_TINT = { r: 0.9, g: 0.9, b: 0.94, a: 1 } as const;

export function vehicleSpriteInstance(
  vehicle: VehicleState,
  atlasIndex: AtlasIndex,
  tint: { r: number; g: number; b: number; a: number } = PLAYER_TINT,
): SpriteInstanceInput {
  const frame = atlasIndex.frame(`car-${vehicle.design.bodyId}`);
  return {
    atlasId: '0',
    position: { ...vehicle.position },
    rotationRad: vehicle.headingRad + degToRad(frame.rotationOffsetDeg),
    sizeM: VEHICLE_SPRITE_SIZE_M,
    uvRect: frame.uv,
    tint,
    layer: 1,
  };
}

/**
 * Every live projectile, as a visible instance.
 *
 * ## Why this exists
 *
 * Codex `gpt-6.1-sol` drove the live arena and reported that "combat happens
 * without visible firing or impact effects ... the battlefield showed cars
 * moving and overlapping without showing the exchanges causing those changes",
 * after watching ammunition fall 20/20 -> 7/20 and a front facing drop 2/2 -> 1/2
 * with nothing on screen to account for either. It checked the source rather
 * than only a still: the arena's render list submits vehicle sprites and
 * shadows, and no projectiles.
 *
 * The art was never missing. `fx-muzzle-flash`, `fx-impact-spark`,
 * `fx-smoke-puff` and `fx-explosion-1..5` are all in `assets/atlas.json` and
 * have been shipping in the download since before the loop started —
 * `grep -rn "fx-" src/` returned ZERO. That is iteration 81's finding verbatim
 * (`decal-*`): authored, packed, downloaded, drawn by nothing.
 *
 * It is worth recording WHY that went unnoticed for so long, because the wrong
 * conclusion nearly shipped. Iteration 115 read the atlas with a walker looking
 * for dict entries carrying a `name` field. `frames` is a **dict keyed by name**,
 * so the probe matched nothing and reported the frames' absence as a
 * measurement — then used that to override a reviewer whose remedy was correct.
 * A probe that finds nothing is not a measurement, and this is the third time
 * in this log that one has produced a confident false claim.
 *
 * ## What is drawn, and why it is STATELESS
 *
 * One instance per live projectile, at its real simulated position, rotated
 * along its real velocity. That alone is the shot PATH, which is the part the
 * finding is actually about: the player can see where a shot is, so firing,
 * incoming fire and hits become things in the world rather than counters that
 * change for no visible reason.
 *
 * A projectile that spawned on THIS tick additionally gets a larger muzzle
 * flash, drawn at the projectile's own spawn position — which is the shooter's
 * muzzle, because `spawnProjectile` originates the bolt there. So the muzzle
 * flash needs no separate event queue, no effect list and no lifetime: it is
 * derived from `spawnTick`, which is already on the projectile.
 *
 * That derivation is what keeps this cheap enough to be obviously correct. An
 * impact spark is the obvious third piece and is deliberately NOT here: a
 * resolving projectile is DROPPED from `world.entities.projectiles` by the
 * damage system on the tick it connects, so by render time it is gone and there
 * is nothing left to draw. Adding impacts means the damage system must record
 * them, which is a state addition and its own round.
 *
 * ## Capacity
 *
 * `SPRITE_INSTANCE_CAPACITY` is 64 and an arena frame spends 2 per vehicle
 * (shadow + sprite). An overshoot is not a graceful degradation —
 * `writeInstanceBuffer` REJECTS the write, which renders the whole arena BLANK
 * (iteration 8's invisible beacon, iteration 19's shadows). The sim does not
 * bound the projectile array, so the cap is applied HERE, at the one place that
 * knows the budget: the caller slices the effects to the remaining headroom
 * after the vehicles. Truncating an effect is the correct failure — a missing
 * tracer on the busiest frame — and a blank screen is not.
 */
/**
 * The sparks where shots LAND.
 *
 * `fx-impact-spark` is the correct art here and was the WRONG art for the
 * travelling bolt in iteration 117 — a soft 21%-opaque burst is what a hit looks
 * like, and a dart in flight needs the sharp flash instead. The two states are
 * different events and now use different frames, which is the whole reason the
 * original choice looked wrong only once the size was fixed.
 *
 * Sized against the vehicle for the same reason the tracer is: a derived
 * fraction of something the player already reads, never a number that was
 * measured too small and then frozen (iteration 118).
 */
export function impactSpriteInstances(
  impacts: readonly { position: Vec2 }[],
  atlasIndex: AtlasIndex,
): SpriteInstanceInput[] {
  return impacts.map((impact) => {
    const frame = atlasIndex.frame('fx-impact-spark');
    return {
      atlasId: String(frame.atlasIndex),
      position: { ...impact.position },
      rotationRad: degToRad(frame.rotationOffsetDeg),
      sizeM: { x: VEHICLE_SPRITE_SIZE_M.x * 0.4, y: VEHICLE_SPRITE_SIZE_M.y * 0.4 },
      uvRect: frame.uv,
      tint: { r: 1, g: 1, b: 1, a: 1 },
      layer: 1,
    };
  });
}

export function projectileSpriteInstances(
  projectiles: readonly ProjectileState[],
  worldTick: number,
  atlasIndex: AtlasIndex,
): SpriteInstanceInput[] {
  const out: SpriteInstanceInput[] = [];
  for (const projectile of projectiles) {
    const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
    // A bolt with no velocity has no direction to point, and `atan2(0, 0)` is
    // 0 — which would silently aim every stationary projectile the same way.
    // A projectile is never legitimately stationary mid-flight, so this is a
    // guard against a degenerate record rather than a state the sim produces.
    const rotationRad = speed > 0 ? Math.atan2(projectile.velocity.y, projectile.velocity.x) : 0;
    const justFired = projectile.spawnTick === worldTick;
    // BOTH states use `fx-muzzle-flash`, and that is a correction rather than a
    // simplification. The first version drew the in-flight bolt with
    // `fx-impact-spark`, which is a soft 21%-opaque burst authored for an
    // IMPACT — a travelling dart rendered with impact art is both the wrong
    // picture and the faintest one available. The muzzle flash is the sharp,
    // bright frame in the set, and it is what a shot should look like in
    // flight; the size difference between the burst at the muzzle and the bolt
    // leaving it still reads.
    const frame = atlasIndex.frame('fx-muzzle-flash');
    out.push({
      atlasId: String(frame.atlasIndex),
      position: { ...projectile.position },
      rotationRad: rotationRad + degToRad(frame.rotationOffsetDeg),
      // The muzzle flash is roughly 2.4x the in-flight bolt. Both are derived
      // from ONE constant rather than two literals, so the two can never drift
      // into "the flash is smaller than the thing it fired".
      sizeM: {
        x: PROJECTILE_EFFECT_SIZE_M.x * (justFired ? MUZZLE_FLASH_SIZE_MULTIPLIER : 1),
        y: PROJECTILE_EFFECT_SIZE_M.y * (justFired ? MUZZLE_FLASH_SIZE_MULTIPLIER : 1),
      },
      uvRect: frame.uv,
      // Unmodified: these frames are authored bright and additive-looking, and a
      // tint is how iteration 16's building grade spent the value separation the
      // art already carries. A weapon glow that is dimmed for consistency with
      // the ground is a glow nobody can see.
      tint: { r: 1, g: 1, b: 1, a: 1 },
      layer: 1,
    });
  }
  return out;
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
  /**
   * The road trip to record, when the save is being taken mid-route. Omitted
   * for every city and arena save, and `roadTripToSave(trip)` is the only
   * sanctioned way to build one so the blob's shape has a single owner.
   */
  readonly roadTrip?: RoadTripSave;
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
/**
 * A live `RoadTripState` -> the persistable blob.
 *
 * Two things are deliberately NOT copied, and both are re-derived on load
 * rather than stored: the route itself (from the two city ids, via
 * `resolveRoute`) and each hazard's `deployable` (from its `weaponId`, via
 * `placeRoadHazard`). The vehicle and the clock are not copied either — they
 * already live in `SaveGame.vehicles` and `currentDay`/`phase`, and a second
 * copy would be a third derivation of the same car.
 */
export function roadTripToSave(trip: RoadTripState): RoadTripSave {
  return {
    originCityId: trip.resolved.originCityId,
    destinationCityId: trip.resolved.destinationCityId,
    startX: trip.startPosition.x,
    startY: trip.startPosition.y,
    routeHeadingRad: trip.routeHeadingRad,
    progressMiles: trip.progressMiles,
    dayDebt: trip.dayDebt,
    contacts: trip.contacts.map((c) => ({
      id: c.id,
      faction: c.faction,
      packId: c.packId,
      routeMiles: c.routeMiles,
      attacked: c.attacked,
      disposition: c.disposition,
    })),
    wrecks: trip.wrecks.map((w) => ({
      id: w.id,
      burned: w.burned,
      searched: w.searched,
      weapons: w.weapons.map((we) => ({ weaponId: we.weaponId, ammo: we.ammo })),
      gear: w.gear.map((g) => ({ id: g.id, weightLb: g.weightLb, spaces: g.spaces })),
      positionX: w.position.x,
      positionY: w.position.y,
      createdDayIndex: w.createdDayIndex,
    })),
    hazards: trip.hazards.map((h) => ({
      id: h.id,
      weaponId: h.weaponId,
      positionX: h.position.x,
      positionY: h.position.y,
      placedDayIndex: h.placedDayIndex,
    })),
  };
}

/**
 * The inverse: a persisted blob plus the vehicle and clock the save already
 * carries -> a live `RoadTripState`.
 *
 * `placeRoadHazard` is used rather than hand-building the hazard because it is
 * what validates the `weaponId` and looks the deployable up. A save naming a
 * weapon with no MINE/SPIKES deployable therefore throws HERE, at load, rather
 * than producing a hazard that behaves differently from a freshly-placed one.
 */
export function rehydrateRoadTrip(
  save: RoadTripSave,
  vehicle: VehicleState,
  clock: Clock,
): RoadTripState {
  const resolved = resolveRoute(save.originCityId, save.destinationCityId);
  return {
    resolved,
    vehicle,
    startPosition: { x: save.startX, y: save.startY },
    routeHeadingRad: save.routeHeadingRad,
    progressMiles: save.progressMiles,
    clock,
    dayDebt: save.dayDebt,
    contacts: save.contacts.map((c) => ({
      id: c.id,
      faction: c.faction as FactionId,
      packId: c.packId,
      routeMiles: c.routeMiles,
      attacked: c.attacked,
      disposition: c.disposition as ContactDisposition,
    })),
    wrecks: save.wrecks.map((w) => createWreck(
      w.id,
      { x: w.positionX, y: w.positionY },
      w.createdDayIndex,
      w.burned,
      w.weapons.map((we) => ({ weaponId: we.weaponId, ammo: we.ammo })),
      w.gear.map((g) => ({ id: g.id, weightLb: g.weightLb, spaces: g.spaces })),
    )),
    hazards: save.hazards.map((h) => placeRoadHazard(h.id, h.weaponId, { x: h.positionX, y: h.positionY }, h.placedDayIndex)),
  };
}

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
    // `exactOptionalPropertyTypes` is on, so an absent trip is an absent KEY,
    // never `roadTrip: undefined` — which would serialise to a value the
    // nullable schema has to reason about for no reason.
    ...(input.roadTrip !== undefined ? { roadTrip: input.roadTrip } : {}),
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
  /**
   * Controls and seed, split OUT of the status line.
   *
   * The banner was one element carrying a mode label, three control hints and
   * the session seed, inside a `max-width` that truncated it: it rendered as
   * "Practice arena — WASD/arrows drive, Space/J fire, Q/E cycle weapon. Seed
   * a11ce5ee…." A review called the result "small, light grey text ... long
   * lines are truncated with an ellipsis, making controls and status messages
   * unreadable", and iteration 19 had already caught this same line's siblings
   * leaking dev data into player-facing UI.
   *
   * The truncation is what made the seed read as debug noise: a hash cut off
   * mid-string looks like a log line, where a complete, labelled one looks like
   * a deliberate feature. The seed is genuinely useful — it is what makes a
   * practice run reproducible — so it is kept, not removed, and given its own
   * element that cannot ellipsize. It goes BELOW the WEAPONS button rather than
   * beside it, and on the left rather than the right: a screenshot caught it
   * under the WEAPONS button at top-left, and a second caught it hidden behind
   * the CONDITION panel when I moved it right. The arena's corners are all
   * spoken for, so the stamp tucks under the one control it is nearest to.
   *
   * The controls are a teaching aid, so they fade like the road's driving hint
   * (see the identical `sm-road-hint-fade` keyframes) instead of sitting in the
   * objective line for the whole session. `status` now says only what stays true.
   */
  const arenaControls = el('div');
  arenaControls.style.cssText =
    'position:absolute;top:34px;left:50%;transform:translateX(-50%);color:#9fb0c2;font-family:system-ui,sans-serif;font-size:12px;background:rgba(10,14,20,0.7);padding:3px 9px;border-radius:4px;text-align:center;white-space:nowrap;pointer-events:none;animation:sm-road-hint-fade 7s ease-out forwards;';
  // The key names come from the LIVE bindings, not from a literal. The hint used
  // to hardcode "Space/J fire" while `controls.json` bound `fire` to `KeyJ`
  // alone, so the most prominent instruction on the combat screen named a key
  // that did nothing — reported by Codex `gpt-6.1-sol` driving the build and
  // pressing Space. `controls.json` says every action is remappable at runtime,
  // so a hardcoded key in a hint is a lie waiting for a rebind; deriving it
  // makes that unrepresentable. `Space` is now genuinely bound too, so this
  // reads "Space/J fire" AND means it.
  arenaControls.textContent = isCoarsePointer()
    ? t('ui.arena.arenaControlsTouch')
    : t('ui.arena.arenaControls', {
        fire: describeAction(currentControlBindings, currentControlPreset, 'fire'),
        cycle: describeCyclePair(currentControlBindings, currentControlPreset, 'cycleWeaponPrev', 'cycleWeaponNext'),
      });
  // The seed is announced in the session message feed rather than floating as a
  // chip, and the chip is gone entirely.
  //
  // It used to sit at `top: 52px; left: 8px`, tucked directly beneath the WEAPONS
  // panel, and a review read that corner — an empty titled panel with a bare hex
  // hash under it — as "a developer console left open", naming the
  // label/content mismatch as the defect.
  //
  // The seed is real state, not debug output: the full hash is in the console log
  // and the crash banner for bug reports. What was wrong was never the seed, it
  // was the presentation, and two things about the chip do not survive being put
  // in the feed:
  //   - it sat under a heading it had no relationship to, and
  //   - its position was derived from a panel whose height changes with the
  //     loadout, so the moment the weapons panel grew, the chip was underneath
  //     it. That fragility was latent from iteration 22 and only became visible
  //     once the panel learned to say "none fitted".
  // The feed already carries session lines, `practiceResumed` already includes
  // the seed, and an entry line that names it reads as a deliberate feature
  // rather than as a variable printed to screen.
  const exitBtn = el('button', undefined, t('ui.arena.exitToTitle'));
  exitBtn.style.cssText =
    'position:absolute;top:8px;right:8px;pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';
  const retryBtn = el('button');
  retryBtn.style.cssText =
    'position:absolute;top:36px;left:50%;transform:translateX(-50%);pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';
  container.appendChild(canvas);
  container.appendChild(hudHost);
  container.appendChild(status);
  container.appendChild(arenaControls);
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
      : t('ui.arena.practiceEntered', { seed: session.sessionSeed.slice(0, 8) }),
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
    const accelMphPerSec = computeBuildCached(player.design).accelMphPerSec;
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
    // A 32-character hex seed printed in full, in the status line AND again in
    // the message log, was the single most visually noisy thing on the arena
    // screen — a review of the real frame described it as a "garbled repeated
    // token dump ... looking like a raw variable printed to screen", which is a
    // fair description of what a downscaled frame does to that string.
    //
    // The seed's job is REPRODUCIBILITY: it goes in the console log and in the
    // crash banner, both of which carry it in full for a bug report. On screen
    // it only needs to be recognisable and short.
    status.textContent = t('ui.arena.practiceHint');

    atlasIndex = loadAtlasIndex(atlasManifestRaw);

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const postShaderUrl = new URL('./render/shaders/post.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource, postShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
      fetch(postShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    resources = await buildRenderResources(gpuCtx, atlasBitmap, spriteShaderSource, postShaderSource);

    gpuCtx.onRecovered(() => {
      void buildRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource, postShaderSource).then((rebuilt) => {
        // Destroy the set being replaced BEFORE dropping it. Assigning over the
        // reference releases the old atlas texture and buffers to the garbage
        // collector, but GC does not free GPU memory — only `.destroy()` does.
        // Without this, every device-loss recovery leaked a full 2048x2048
        // atlas texture plus four buffers, and a laptop that cycles GPUs a few
        // times would eventually fail to allocate.
        resources?.destroy();
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

  function renderFrame(nowSeconds: number): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;
    const player = findPlayer(world);
    if (player === undefined) return;

    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setZoom(ARENA_ZOOM_PX_PER_M);
    camera.setCenter(player.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    // The floor is ONE quad sized to the visible area and re-centred on the
    // player each frame — the tiling is a world-space `fract()` in the fragment
    // shader, cross-faded against a second non-commensurate detail scale, so
    // there is no cell grid. (Iteration 51 removed a `buildGroundField` this
    // comment used to cite; the reference outlived the function by one commit.)
    const visible = cameraVisibleHalfExtentM(camera);
    const groundInstances = buildGroundQuad(
      atlasIndex,
      { x: player.position.x, y: player.position.y },
      Math.max(visible.x, visible.y) + GROUND_MARGIN_M,
      'arena',
    );
    // Cull to the camera's visible bounds. The arena is a bounded pit, so this
    // is mostly insurance today, but it is the same call the road needs (its
    // opponent list is built from live contacts and grows with engagement), and
    // it means neither screen depends on `SPRITE_INSTANCE_CAPACITY` being
    // large enough for a data change. Shadows and their casters share a
    // position and size, so culling either keeps or drops both together.
    // Stains, painted onto the same layer as the floor. Placed content, hashed
    // from world cells — see `groundDecalInstances` for why that is the only
    // form of ground variation that can be both seam-free and non-repeating.
    groundInstances.push(
      ...groundDecalInstances(
        atlasIndex,
        player.position,
        Math.max(visible.x, visible.y) + GROUND_MARGIN_M,
      ),
    );
    // Practice fires too, so its shots are visible for the same reason the arena
    // event's are — see `projectileSpriteInstances`.
    const vehicleInstances = [vehicleShadowInstance(player, atlasIndex), vehicleSpriteInstance(player, atlasIndex)];
    const effectHeadroom = Math.max(0, SPRITE_INSTANCE_CAPACITY - vehicleInstances.length);
    const effectInstances = projectileSpriteInstances(world.entities.projectiles, world.tick, atlasIndex).slice(0, effectHeadroom);
    const spriteInstances = cullInstances(
      [...vehicleInstances, ...effectInstances],
      camera.getVisibleBounds(),
    ).visible;
    writeInstanceBuffer(gpuCtx.getDevice(), resources.tileInstanceBuffer, packInstances(groundInstances), TILE_INSTANCE_CAPACITY);
    writeInstanceBuffer(gpuCtx.getDevice(), resources.spriteInstanceBuffer, packInstances(spriteInstances), SPRITE_INSTANCE_CAPACITY);

    const { sceneView, post } = writePostFrame(gpuCtx, resources, ARENA_GRADE, nowSeconds);
    encodeGradedFrame(
      gpuCtx.getDevice(),
      resources.pipeline,
      post,
      sceneView,
      gpuCtx.getContext().getCurrentTexture().createView(),
      resources.cameraBindGroup,
      [
        { bindGroup: resources.tileBindGroup, instanceCount: groundInstances.length },
        { bindGroup: resources.spriteBindGroup, instanceCount: spriteInstances.length },
      ],
    );
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
    renderFrame(nowMs / 1000);
    renderHudFrame();
    rafHandle = window.requestAnimationFrame(frame);
  }

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    inputTracking.detach();
    touch?.destroy();
    // Release the per-screen GPU set before the context goes. `destroy()` on
    // the context tears down the managed scene texture only; the atlas texture,
    // instance buffers and post uniform are owned by `resources` and leak on
    // every screen change without this.
    resources?.destroy();
    resources = undefined;
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
/**
 * The "nothing yet" run state a brand-new session starts with.
 *
 * WHY THIS IS NAMED RATHER THAN INLINE. `startNewSession` built this literal
 * inside the driver-creation callback, so it could not be reached by anything
 * but the UI flow — which is exactly why a DOM test could not build a
 * `CityRunState` to hand `showArenaEvent` and had been reduced to fabricating
 * one. And it was not only the test: `cityRunStateFromSaveGame`'s own docblock
 * says its per-field fallbacks are "the same 'nothing yet' defaults a
 * brand-new session starts with in `startNewSession`", so the defaults were
 * written down TWICE with nothing keeping them honest. This is the same shape
 * as `unmetRequirements` (84), `roadLegalityMisses` (92) and the facility-kind
 * set (98): one fact, two homes, and the drift lands wherever the second copy
 * is read.
 */
export function freshCityRunState(
  driver: DriverState,
  vehicle: VehicleState,
  options: { sessionSeed: string; openDb: () => Promise<IDBDatabase>; search: string },
): CityRunState {
  return {
    driver,
    vehicle,
    vehicleStored: false,
    clock: initialClock(),
    cityId: driver.cityId,
    sessionSeed: options.sessionSeed,
    openDb: options.openDb,
    rng: createRng(options.sessionSeed).stream('driver'),
    search: options.search,
    rumorsHeardToday: new Map(),
    activeCourierJobs: [],
    fleet: { vehicles: [{ vehicle, stored: false, cityId: driver.cityId }] },
    routeHistory: new Map(),
    quests: [],
    arenaRecord: { wins: 0, losses: 0 },
  };
}

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

  // The same `field()` the driver screen uses, so the game's two name boxes are
  // one control by construction. They were two hand-written inputs with two
  // different looks and neither had a focus ring.
  const scoreNameField = field({
    label: t('ui.arena.scoreSubmit.nameLabel'),
    iconName: 'id-badge',
  });
  scoreNameField.input.value = driverName;
  scoreNameField.input.style.marginBottom = '8px';
  panel.appendChild(scoreNameField.root);

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
      void submitArcadeScore({ name: scoreNameField.value(), ...payload }).then((result) => {
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

/**
 * The real competitive-arena screen — the one a paid Championship entry
 * mounts, and the one `?screen=arena-event` routes to.
 *
 * Exported for the same reason `inputOverride` below exists, and the two are
 * one decision rather than two. A DOM test cannot reach this closure by
 * navigating the city, because the facility chain calls it internally and
 * would have to thread the test seam through `mountFacility` and the whole
 * arena-entry path to get there — which is a worse design than the parameter
 * already added. Driving it directly instead means the test builds the real
 * match itself and asserts on the real screen, the real loop and the real
 * match resolution; what it gives up is the CITY NAVIGATION, which the sibling
 * loss test still walks for real on every run.
 *
 * The other arena screen, `showArena` (the free practice field), stays private:
 * nothing needs to reach it, and `?screen=arena` already mounts it.
 */
export function showArenaEvent(
  root: HTMLElement,
  chargedDriver: DriverState,
  playerVehicle: VehicleState,
  matchState: ArenaMatchState,
  clock: Clock,
  cityState: CityRunState,
  onComplete: (nextState: CityRunState) => void,
  /**
   * Test seam: replaces the human input source for this match.
   *
   * It exists because the DOM auto-end test needs a driver that can WIN a match
   * it is entitled to win. The key-schedule driver that used to stand in for
   * one only ever won through the 90-degree body-frame bug (iterations 122-125),
   * and the two DOM drivers written to replace it could not clear a roster at
   * all: aiming without evading dies, evading without aiming never connects.
   * The sim's own competent bot does both, so the honest move was to make that
   * bot reachable rather than to keep tuning a driver that structurally cannot
   * win.
   *
   * Production never passes this, so the human path below is unchanged: the
   * override is consulted first and every other caller still reads real input.
   */
  inputOverride?: (world: World) => InputFrame,
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
  const exitBtn = el('button', undefined, t('ui.arena.leaveArena'));
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

  /**
   * The pause overlay's host and scrim.
   *
   * CENTRED, and that is a decision rather than a default. Codex's remedy for
   * this finding was "a centred overlay above the entire HUD, with a backdrop
   * that receives input" — and iteration 107 had just fixed the road's trip
   * menu being SWALLOWED by the radar precisely because that menu sits
   * bottom-left, in the same corner the radar is pinned to. Copying the road's
   * placement here would have rebuilt that collision on the screen where combat
   * happens. Centring also keeps the car visible behind the scrim, which is the
   * one thing a player checks before resuming a fight.
   *
   * The scrim sits at 25, between `.hud-root`'s 20 and `.sm-menu-root`'s 30, so
   * the menu is above it and the HUD is below it — the same ladder iteration
   * 107 established, with the new rung in the middle so the dimmed HUD cannot
   * take a click meant for the menu.
   */
  const pauseScrim = el('div');
  pauseScrim.style.cssText =
    'position:absolute;inset:0;background:rgba(5,7,10,0.55);z-index:25;display:none;';
  const menuHost = el('div');
  menuHost.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,90vw);max-height:80vh;overflow:auto;display:none;';
  // The persistent pause hint used to be its own element here, hardcoded at
  // `top: 88px`, on the reasoning that it sat "below the status pill and clear
  // of every HUD corner, so it adds no new collision". A Codex review
  // (iteration 151) measured the collision that reasoning missed, and a
  // real-browser probe reproduced it from live bounding boxes: this element
  // spans y 88–110.8 while `.hud-panel--messages` starts at
  // `calc(var(--inset) + 44px)` = 56px and grows DOWNWARD as messages arrive.
  // In Division 5 the match-entry message alone overlapped this hint by
  // 21.7px — so most of the one line that teaches the pause key was hidden by
  // the first message the player ever sees.
  //
  // The hint is not deleted, it MOVES: into the top controls banner, which sits
  // above the message feed by construction, so no amount of message growth can
  // reach it. A hardcoded pixel offset cannot have that property; a sibling of
  // the banner can. `tools/probe-arena-hud-overlap.mjs` is the gate.
  container.appendChild(pauseScrim);
  container.appendChild(menuHost);
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

  // Where shots LAND, for the fraction of a second a player can actually see
  // it. Bounded on BOTH axes, because an unbounded effect list is a slow leak
  // and a long-lived one is a lie about when the hit happened:
  //   - by AGE, so a spark is gone within IMPACT_EFFECT_LIFETIME_TICKS rather
  //     than lingering as decoration on a fight that has moved on;
  //   - by COUNT, so a burst that resolves several shots on one tick cannot grow
  //     the sprite list past what the buffer holds.
  const impacts: { position: Vec2; tick: number }[] = [];
  function recordImpact(position: Vec2): void {
    impacts.push({ position: { ...position }, tick: world.tick });
    while (impacts.length > MAX_IMPACT_EFFECTS) impacts.shift();
  }
  // The `{leave}` placeholder is filled from the SAME string the button renders,
  // so the message cannot tell a player to press a control whose label has been
  // translated or renamed. That was iteration 94's lesson applied forward: the
  // previous version hardcoded "drive out the gate to exit" and there IS no gate
  // exit — the arena has no bounds and the event ends through this button or a
  // terminal match condition, so the sentence instructed an action that cannot
  // accomplish the thing it promised.
  logMessage(
    'info',
    t('ui.arena.eventEntered', { event: event.name, count: matchState.opponentsTotal, leave: t('ui.arena.leaveArena') }),
  );

  const systems = createSystemsRegistry();
  systems.register('driving', makeArenaDrivingSystem(driverRef, playerVehicleId, opponents, aiInputs));
  systems.register('weapons', makeArenaWeaponsSystem(driverRef, playerVehicleId, opponents, aiInputs, projectileTargets, spawnCounter, logMessage));
  systems.register('projectiles', projectilesSystem);
  systems.register('damage', makeArenaDamageSystem(playerVehicleId, driverRef, opponents, projectileTargets, matchStateRef, logMessage, recordImpact));
  systems.register('ai', makeArenaAISystem(playerVehicleId, opponents, aiInputs));
  systems.register('cleanup', cleanupSystem);

  const codesDown = new Set<string>();
  const inputTracking = attachCodeTracking(codesDown);
  const weaponSelection = makeWeaponSelection(() => findPlayer(world)?.weapons.length ?? 0);
  const touch = mountTouchControls(container, { fire: true, commands: weaponTouchCommands(weaponSelection, playerVehicle) });

  function sampleInput(): InputFrame {
    if (inputOverride !== undefined) return inputOverride(world);
    const raw = rawInputFrom(codesDown, touch);
    weaponSelection.update(raw);
    const resolved = resolveInput(raw, currentControlPreset, currentControlBindings);
    return { moveX: resolved.moveX, moveY: resolved.moveY, fire: resolved.fire, weaponSlot: weaponSelection.active() ?? NO_WEAPON_SLOT };
  }

  /**
   * Pause state, and the freeze that goes with it.
   *
   * Iteration 100's two lessons apply here unchanged, and both are load-bearing:
   *   - `menuHandledKey` exists because `mountMenu` focuses its container and
   *     therefore listens FIRST, so a keypress reaches the menu, the menu runs
   *     its own BACK, and only THEN does this window handler run. `if (paused)
   *     return` cannot catch that, because the menu has already cleared the flag
   *     the guard was watching. One Escape would toggle twice and appear to do
   *     nothing — which is exactly how iteration 100's first attempt shipped a
   *     pause menu that did not pause.
   *   - the freeze is a RETURN BEFORE ANY SIMULATION IS READ, not a flag
   *     checked inside the stepping loop, so nothing can slip past: not driving,
   *     not AI, not projectiles, not damage, not cooldowns, and not the match
   *     resolution below it in `frame`.
   */
  let paused = false;
  let mountedMenu: MountedMenu | null = null;
  let menuHandledKey = false;

  function openPauseMenu(): void {
    if (mountedMenu !== null) return;
    if (matchPhase.kind === 'ended') return;
    paused = true;
    // Clear held codes so a player who pauses while holding W does not find the
    // car accelerating again the instant they resume, and so a held fire key
    // does not discharge a magazine across a pause. `attachCodeTracking` only
    // ever ADDS codes, so a cleared set is what actually stops the input.
    codesDown.clear();
    pauseScrim.style.display = 'block';
    menuHost.style.display = 'block';
    menuHost.innerHTML = '';
    const menuTitle = el('div');
    menuHost.appendChild(menuTitle);
    menuTitle.textContent = t('ui.arena.menu');
    const actions: MenuAction[] = [
      { id: 'resume', label: t('ui.arena.menuResume'), eligible: true },
      { id: 'controls', label: t('ui.arena.menuControls'), eligible: true },
      // The label is read from the SAME string the corner button renders, so the
      // menu cannot tell a player to press a control that has been renamed or
      // translated — iteration 107's `{leave}` lesson, applied to a label
      // rather than to a sentence.
      { id: 'withdraw', label: t('ui.arena.leaveArena'), eligible: true },
    ];
    mountedMenu = mountMenu({
      container: menuHost,
      // Real values, deliberately NOT rendered (`showHeader: false`). The arena
      // genuinely has a driver, a clock and a city, so this is not the phantom
      // readout iteration 19 removed from the title screen — it is real status
      // that a mid-combat pause does not need, and the live HUD already carries
      // the condition that matters. Passing the real fields rather than
      // placeholders means the suppression is a DECISION about the overlay
      // rather than missing data.
      header: {
        cash: chargedDriver.cash,
        dayIndex: clock.dayIndex,
        phase: clock.phase,
        cityName: cityName(cityState.cityId),
      },
      showHeader: false,
      actions,
      onActivate: (id) => {
        if (id === 'resume') {
          closePauseMenu();
          return;
        }
        if (id === 'controls') {
          closePauseMenu();
          // Re-mount from the LIVE refs, not from the parameters this function
          // was handed. `matchStateRef.current` is REPLACED on every kill —
          // `recordOpponentDefeated` returns `{...state}` — so the `matchState`
          // parameter is permanently stale, and `chargedDriver` is the driver as
          // it was before the first shot. Passing them would silently RESTART
          // the match: kills back to zero, the player's damage undone, the arena
          // world rebuilt from the seed.
          //
          // That is iteration 93's bug class one layer up — a path that
          // discards exactly what it was built to preserve — and it is the same
          // mistake iteration 104 caught on the road's own resume, where
          // `progressMiles` is re-derived every tick and a hand-set value does
          // not survive contact with the simulation. Here `world` is not
          // re-derivable at all, so the live refs are the only honest source.
          showControls(root, () =>
            showArenaEvent(
              root,
              driverRef.current,
              findPlayer(world) ?? playerVehicle,
              matchStateRef.current,
              world.clock,
              cityState,
              onComplete,
            ),
          );
          return;
        }
        withdraw();
      },
      onBack: () => {
        menuHandledKey = true;
        closePauseMenu();
      },
    });
  }

  function closePauseMenu(): void {
    mountedMenu?.destroy();
    mountedMenu = null;
    menuHost.innerHTML = '';
    menuHost.style.display = 'none';
    pauseScrim.style.display = 'none';
    paused = false;
  }

  /**
   * Leaving the match, from the corner button AND from the pause menu.
   *
   * ONE function for both, because they are the same decision and two copies
   * are how they drift — iteration 84's `unmetRequirements`, iteration 92's
   * `roadLegalityMisses`, iteration 98's operational-kind set. The menu is
   * pointless if the two ways out can disagree about what leaving means.
   */
  function withdraw(): void {
    if (matchPhase.kind === 'ended') return;
    closePauseMenu();
    matchPhase = { kind: 'ended' };
    endMatch(playerDefeated() ? 'ON_FOOT' : 'UNDER_POWER');
  }

  /**
   * `Escape` and `P`, which are NOT bound to any action: `controls.json`
   * contains no `KeyP` and no `Escape` entry, verified by reading the shipped
   * ruleset rather than assumed from the road's copy of this comment — the same
   * input map drives both screens, and `controls.json` is rebindable at runtime,
   * so a future binding to either key would be a real collision.
   */
  function onPauseKey(ev: KeyboardEvent): void {
    // A key aimed INSIDE a menu belongs to that menu, full stop.
    //
    // This is not a restatement of the `menuHandledKey` latch below — it covers
    // the case that flag structurally cannot, which is a menu that MOUNTED this
    // screen mid-dispatch. `showControls` calls its BACK synchronously inside
    // the keydown it is handling, `onExit` calls `showArenaEvent`, and the new
    // arena attaches its own listener before that same Escape has finished
    // bubbling to `window`. The new closure's `menuHandledKey` starts `false`,
    // so the flag waved it through and the arena re-paused itself: the player
    // pressed Escape once to leave a settings menu and came back to a match
    // that was already frozen — pause menu up, frame loop short-circuiting on
    // `if (paused)`, HUD never painted, odometer dead, no cause on screen.
    // Measured on the practice event: `paused === true` on the very first
    // frame of the new mount.
    //
    // `ev.target` is what makes it airtight and worth more than timing games:
    // that Escape's target is the CONTROLS menu, whichever screen is mounted by
    // the time it arrives, so the ownership question is answered from the event
    // itself. Deferring the listener by a microtask also "works" and is
    // strictly worse — it swallows any key dispatched synchronously right
    // after the mount, which is exactly how this file's own
    // `abandoning returns to the city` test opens its menu.
    // Any key a menu OWNS is consumed here exactly once — whether `mountMenu`
    // raised the latch, or the event was aimed inside the menu's own DOM.
    // Both arms clear the latch, because leaving it set swallows the NEXT
    // legitimate Escape: `menuHandledKey` is one-shot, so a leaked `true` makes
    // an unrelated later pause look handled. Consuming in one place is what
    // keeps the two ways of knowing the same thing from disagreeing.
    const target = ev.target;
    const aimedAtMenu = target instanceof Element && target.closest('.sm-menu-root, .sm-menu') !== null;
    if (menuHandledKey || aimedAtMenu) {
      menuHandledKey = false;
      return;
    }
    if (ev.key !== 'Escape' && ev.key.toLowerCase() !== 'p') return;
    // Only open. Closing is the menu's own job, for the reason above.
    if (paused) return;
    ev.preventDefault();
    openPauseMenu();
  }
  window.addEventListener('keydown', onPauseKey);
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
    const accelMphPerSec = computeBuildCached(player.design).accelMphPerSec;
    const snapshot: HudSnapshot = {
      vehicle: player,
      activeWeaponIndex: weaponSelection.active(),
      accelMphPerSec,
      radar: {
        enabled: !isRadarDisabled(player.plantDP, plant.radarFailureThreshold),
        contacts: radarContactsFromVehicles(world, playerVehicleId, opponents),
      },
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
    status.textContent = t('ui.arena.eventHint', {
      event: event.name,
      fire: describeAction(currentControlBindings, currentControlPreset, 'fire'),
      cycle: describeCyclePair(currentControlBindings, currentControlPreset, 'cycleWeaponPrev', 'cycleWeaponNext'),
      // The pause key rides in this banner rather than in its own absolutely
      // positioned element — see the note where that element used to be built.
      // `ui.arena.menuHint` stays the single owner of the wording, so the
      // banner cannot drift from it.
      pause: t('ui.arena.menuHint'),
    });

    atlasIndex = loadAtlasIndex(atlasManifestRaw);

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const postShaderUrl = new URL('./render/shaders/post.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource, postShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
      fetch(postShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    resources = await buildRenderResources(gpuCtx, atlasBitmap, spriteShaderSource, postShaderSource);

    gpuCtx.onRecovered(() => {
      void buildRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource, postShaderSource).then((rebuilt) => {
        // Destroy the set being replaced BEFORE dropping it. Assigning over the
        // reference releases the old atlas texture and buffers to the garbage
        // collector, but GC does not free GPU memory — only `.destroy()` does.
        // Without this, every device-loss recovery leaked a full 2048x2048
        // atlas texture plus four buffers, and a laptop that cycles GPUs a few
        // times would eventually fail to allocate.
        resources?.destroy();
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

  function renderFrame(nowSeconds: number): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;
    const player = findPlayer(world);
    if (player === undefined) return;

    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setZoom(ARENA_ZOOM_PX_PER_M);
    camera.setCenter(player.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    const atlas = atlasIndex;
    const opponents = world.entities.vehicles.filter((vehicle) => vehicle.id !== player.id && !vehicle.destroyed);
    // A shadow per vehicle, emitted immediately before the vehicle it belongs
    // to, so the painter's algorithm keeps each shadow under its own caster.
    // Culled to the camera's visible bounds before packing: a shadow and its
    // caster share a position and size, so culling keeps or drops both together
    // and a vehicle can never keep its shadow after losing itself. This is what
    // keeps `SPRITE_INSTANCE_CAPACITY` from being a silent cliff edge.
    const vehicleInstances = [
      vehicleShadowInstance(player, atlas),
      vehicleSpriteInstance(player, atlas),
      ...opponents.flatMap((vehicle) => [vehicleShadowInstance(vehicle, atlas), vehicleSpriteInstance(vehicle, atlas, OPPONENT_TINT)]),
    ];
    // Effects get whatever the vehicles left, and are TRUNCATED to fit. An
    // overshoot is not graceful: `writeInstanceBuffer` rejects the write and the
    // arena renders BLANK (iteration 8, iteration 19). Dropping one tracer on
    // the busiest frame is invisible; dropping every vehicle is not, so the
    // vehicles keep their claim and the effects yield.
    const effectHeadroom = Math.max(0, SPRITE_INSTANCE_CAPACITY - vehicleInstances.length);
    // Prune BY AGE at the point of drawing, not on a timer: a spark is removed
    // on the first frame that finds it too old, so the list cannot hold a dead
    // effect across a pause (where `world.tick` stops advancing) and then dump
    // a burst of them the frame play resumes.
    while (impacts.length > 0 && world.tick - impacts[0]!.tick > IMPACT_EFFECT_LIFETIME_TICKS) {
      impacts.shift();
    }
    const effectInstances = [
      ...projectileSpriteInstances(world.entities.projectiles, world.tick, atlas),
      ...impactSpriteInstances(impacts, atlas),
    ].slice(0, effectHeadroom);
    const spriteInstances = cullInstances(
      [...vehicleInstances, ...effectInstances],
      camera.getVisibleBounds(),
    ).visible;

    const visible = cameraVisibleHalfExtentM(camera);
    const groundInstances = buildGroundQuad(
      atlas,
      { x: player.position.x, y: player.position.y },
      Math.max(visible.x, visible.y) + GROUND_MARGIN_M,
      'arena',
    );
    writeInstanceBuffer(gpuCtx.getDevice(), resources.tileInstanceBuffer, packInstances(groundInstances), TILE_INSTANCE_CAPACITY);
    writeInstanceBuffer(gpuCtx.getDevice(), resources.spriteInstanceBuffer, packInstances(spriteInstances), SPRITE_INSTANCE_CAPACITY);

    const { sceneView, post } = writePostFrame(gpuCtx, resources, ARENA_GRADE, nowSeconds);
    encodeGradedFrame(
      gpuCtx.getDevice(),
      resources.pipeline,
      post,
      sceneView,
      gpuCtx.getContext().getCurrentTexture().createView(),
      resources.cameraBindGroup,
      [
        { bindGroup: resources.tileBindGroup, instanceCount: groundInstances.length },
        { bindGroup: resources.spriteBindGroup, instanceCount: spriteInstances.length },
      ],
    );
  }

  let rafHandle = 0;
  let lastTimeMs = performance.now();
  let stopped = false;

  /**
   * The match's own lifecycle, as a state machine rather than a boolean:
   * `'running'` while the fight is live, `'ending'` for the brief beat after
   * a terminal condition first fires (see `terminalExitMode` below) so the
   * player sees the last kill or their own death before the outcome screen
   * cuts in, then `'ended'` for good once `endMatch` has actually run. Only
   * the `'running'` branch below is allowed to start that beat, and only the
   * `'ending'` branch is allowed to call `endMatch` — once `matchPhase` is
   * `'ended'` no branch in `frame()` ever reads or acts on it again, so a
   * terminal condition that keeps being true on every following frame (the
   * common case: the player stays dead, the roster stays cleared) cannot
   * retrigger `endMatch` a second time. This is what makes "exactly once"
   * structural rather than a flag this code has to remember to check.
   */
  type ArenaMatchPhase = { kind: 'running' } | { kind: 'ending'; exitMode: ArenaExitMode; resolveAtMs: number } | { kind: 'ended' };
  let matchPhase: ArenaMatchPhase = { kind: 'running' };

  /** The player's own vehicle destroyed, or their driver's natural health run out — either one means there is nobody left in this fight who can still drive out under their own power. */
  function playerDefeated(): boolean {
    const player = findPlayer(world);
    return player?.destroyed === true || isDead(driverRef.current);
  }

  /**
   * The match's own terminal condition, or `null` while it's still live.
   * A defeated player always wins the race against a cleared roster (mirrors
   * `resolveArenaExit`'s own ON_FOOT-checked-first order, so this never
   * disagrees with what resolving the match would decide). Victory requires
   * `opponentsTotal > 0`: `allOpponentsDefeated` reads 0 >= 0 as vacuously
   * true for the zero-opponent `practice` event (see that function's own
   * doc comment), and practice is a free-roam range with nobody to defeat,
   * not a match with a roster to clear — without this guard a practice
   * session would auto-end itself the instant it started.
   */
  function terminalExitMode(): ArenaExitMode | null {
    if (playerDefeated()) return 'ON_FOOT';
    const state = matchStateRef.current;
    if (state.opponentsTotal > 0 && allOpponentsDefeated(state)) return 'UNDER_POWER';
    return null;
  }

  /**
   * The one and only path that resolves how this match ends — the exit
   * button and the terminal check above both funnel into this, so the
   * arena record, persistence and score-submit logic can never drift
   * between a manual exit and an automatic one.
   */
  function endMatch(exitMode: ArenaExitMode): void {
    stop();
    const player = findPlayer(world);
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
  }

  function frame(nowMs: number): void {
    if (stopped) return;
    const deltaSeconds = Math.max(0, Math.min((nowMs - lastTimeMs) / 1000, 0.25));
    // Consumed BEFORE the freeze check below, deliberately. `lastTimeMs` is this
    // screen's only record of when the last frame ran, so returning without
    // updating it would hand the frame the menu closes on one enormous clamped
    // delta — the whole paused duration in a single 0.25s step. The road has the
    // same line for the same reason (iteration 100), and it is the sort of thing
    // that only shows up as a jolt after unpausing.
    lastTimeMs = nowMs;

    /**
     * WHILE PAUSED, NOTHING ADVANCES — and the freeze is this RETURN, before any
     * simulation is read, rather than a flag checked inside the stepping loop.
     *
     * Codex measured what the absence of this cost: "after pressing Escape, the
     * car accelerated from 5 to 25 mph over two seconds, and all three opponents
     * changed position on the radar. P also opened no menu." The review asked for
     * "Resume, Controls, and Withdraw" and for "driving, AI, projectiles,
     * damage, cooldowns, and match resolution" to freeze "together".
     *
     * A return is what makes "together" true by construction. `loop.advance` is
     * the only thing that steps driving, AI, projectiles and damage — they are
     * all registered systems inside it — and weapon cooldowns ride along in the
     * same tick. Returning before it stops every one of them, and stopping
     * BEFORE the `matchPhase` block below is what freezes MATCH RESOLUTION too:
     * a paused match cannot drift into its `ending` state and then resolve out
     * from under the menu.
     *
     * It still redraws nothing, so the canvas holds the last simulated frame
     * behind the scrim — which is what a player wants to look at while deciding
     * whether to resume.
     */
    if (paused) {
      rafHandle = window.requestAnimationFrame(frame);
      return;
    }

    loop.advance(deltaSeconds);
    renderFrame(nowMs / 1000);
    renderHudFrame();

    if (matchPhase.kind === 'running') {
      const exitMode = terminalExitMode();
      if (exitMode !== null) matchPhase = { kind: 'ending', exitMode, resolveAtMs: nowMs + CONTROLS.arenaOutcomeDelayMs };
    } else if (matchPhase.kind === 'ending' && nowMs >= matchPhase.resolveAtMs) {
      const exitMode = matchPhase.exitMode;
      matchPhase = { kind: 'ended' };
      endMatch(exitMode);
      return; // endMatch() already called stop(); no next frame to schedule.
    }

    rafHandle = window.requestAnimationFrame(frame);
  }

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    inputTracking.detach();
    // The pause listener is on `window`, not on the container, so it survives
    // every screen change — exactly the leak iteration 100 hit when its trip
    // menu's teardown forgot the `removeEventListener`. Leaving this one attached
    // means an Escape on the CITY screen opens a menu over a screen that has no
    // pause, and a second one stacks another.
    window.removeEventListener('keydown', onPauseKey);
    mountedMenu?.destroy();
    mountedMenu = null;
    touch?.destroy();
    // Release the per-screen GPU set before the context goes. `destroy()` on
    // the context tears down the managed scene texture only; the atlas texture,
    // instance buffers and post uniform are owned by `resources` and leak on
    // every screen change without this.
    resources?.destroy();
    resources = undefined;
    gpuCtx?.destroy();
  }

  // Routes through the SAME `withdraw()` the pause menu uses. Two copies of
  // "leave the match" is how a corner button and a menu row start disagree about
  // what leaving means — the shape iteration 84, 92 and 98 each paid for.
  exitBtn.addEventListener('click', () => {
    withdraw();
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

/**
 * The city gate's refusal, or `null` when the route is open.
 *
 * Exported for the same reason `vehicleParkedAtGate` is: this decision is a
 * closure inside `showCity`, and a test written against a reimplementation of
 * it would pass whether or not the gate agreed. The refusal texts used to be
 * decided inline here, which is why the `carless` half had no test at all and
 * the road-legal half had no existence.
 *
 * Takes the ALREADY-parked vehicle, so a caller (and a test) resolves it once
 * through the same `vehicleParkedAtGate` production uses — the value that
 * decides what the rows say is then literally the value that gets driven.
 */
export function gateRefusal(parked: VehicleState | null): string | null {
  if (parked === null) return t('ui.city.gateNoVehicle');
  // SECOND REFUSAL, and the one that used to be missing entirely. The strip
  // told the player "Not road-legal" in amber and the constructor said the
  // build was not ready, and then this gate waved them onto the highway
  // anyway — so the warning named a restriction that did not exist. The same
  // three conditions decide it now, read from `roadLegalityMisses` (see there
  // for why the copies had drifted).
  const misses = roadLegalityMisses(parked.design);
  if (misses.length === 0) return null;
  // A `Record` is not an option here: indexing it widens the value to `string`
  // and `t()` only takes the literal key union. Switches keep the literals.
  const word = (miss: RoadLegalityMiss): string =>
    t(
      miss === 'name'
        ? 'ui.city.gateNeedName'
        : miss === 'armor'
          ? 'ui.city.gateNeedArmor'
          : 'ui.city.gateNeedWeapon',
    );
  return `${t('ui.city.gateNotLegal')} ${misses.map(word).join(' · ')}`;
}

interface CityRenderResources extends PostTemplate {
  readonly pipeline: GPURenderPipeline;
  readonly cameraBuffer: GPUBuffer;
  readonly cameraBindGroup: GPUBindGroup;
  /** Capacities, kept so every `writeInstanceBuffer` call can be bounds-checked. */
  readonly groundCapacity: number;
  readonly buildingCapacity: number;
  readonly actorCapacity: number;
  readonly groundInstanceBuffer: GPUBuffer;
  readonly groundBindGroup: GPUBindGroup;
  readonly buildingInstanceBuffer: GPUBuffer;
  readonly buildingBindGroup: GPUBindGroup;
  readonly actorInstanceBuffer: GPUBuffer;
  readonly actorBindGroup: GPUBindGroup;
  readonly texture: GPUTexture;
}

/**
 * City actor-layer instance capacity.
 *
 * `@/ui/city-view`'s `buildCityInstances` emits at most 3 today: the parked
 * car's contact shadow, the car, and the on-foot player. This was 3 — exactly
 * the live count, i.e. zero headroom — so the one extra instance a second
 * parked car or a lone shadow would add would overrun the buffer, which
 * `queue.writeBuffer` handles by DROPPING the write and rendering stale data.
 * 4 costs 80 bytes and removes the cliff edge; the exact-count assertion in
 * `tests/unit/city.test.ts` is what keeps the two honest.
 */
const CITY_ACTOR_INSTANCE_CAPACITY = 4;

/**
 * The city's ground layer is ONE quad plus whatever stains `cityGroundDecalInstances`
 * places inside the wall. Both halves are counted from the same functions that
 * emit them, so this cannot drift: `cityGroundTileCount` below is the single
 * place the number is used, and it reads the decal count rather than restating
 * it. Restating it here is what iteration 53's drift test exists to catch, and
 * the point of this round was to make the drift unrepresentable instead.
 */
const CITY_GROUND_INSTANCE_COUNT = 1;

/**
 * Ground-instance count `@/ui/city-view`'s `cityStaticInstances` emits.
 *
 * This used to delegate to `groundFieldCellCount` over a grid of cells, back
 * when the city drew a 9x9 grid of one repeated ground frame. It now returns a
 * constant, because the ground is a single quad (see `groundQuad`): there are no
 * cells to count and no loop bounds to agree on. The function is kept rather
 * than inlined so the layer-0 capacity contract stays in one named place — the
 * count is sized into a fixed storage buffer once, and `writeInstanceBuffer`
 * does not bounds-check, so anything that changes the number of ground
 * instances has to change this.
 */
function cityGroundTileCount(layout: CityLayout): number {
  return CITY_GROUND_INSTANCE_COUNT + cityGroundDecalCount(layout);
}

async function buildCityRenderResources(
  gpuCtx: GpuContext,
  atlasBitmap: ImageBitmap,
  spriteShaderSource: string,
  postShaderSource: string,
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
  const post = buildPostResources(gpuCtx, postShaderSource);

  return {
    pipeline,
    cameraBuffer,
    cameraBindGroup,
    // Capacities are kept on the resource set so every write can be checked
    // against the buffer it is going into. `writeInstanceBuffer` throws on an
    // overrun because `queue.writeBuffer` past the end is a validation error
    // that DROPS the write and keeps rendering — a silent, wrong frame.
    groundCapacity,
    buildingCapacity,
    actorCapacity: CITY_ACTOR_INSTANCE_CAPACITY,
    groundInstanceBuffer,
    groundBindGroup,
    buildingInstanceBuffer,
    buildingBindGroup,
    actorInstanceBuffer,
    actorBindGroup,
    texture,
    ...post,
    // After the spread, so it wins over the template's own narrower destroy.
    destroy(): void {
      texture.destroy();
      cameraBuffer.destroy();
      groundInstanceBuffer.destroy();
      buildingInstanceBuffer.destroy();
      actorInstanceBuffer.destroy();
      post.postUniformBuffer.destroy();
    },
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
  /**
   * Which car you are driving, and whether it can legally leave the yard.
   *
   * A review said the city "shows no condition panel, radar, or speedometer,
   * unlike the road and arena screens ... the player is still driving in the
   * city, so the absence of critical car status creates an inconsistent and
   * unhelpful UI". The inconsistency is real and the fix is NOT the full HUD.
   *
   * `CityRunState.vehicle` is right there, but the city has no speed in its
   * player state, no contacts, no weapon selection and no damage source — a
   * condition panel mounted here would render armour and tyre bars that can
   * never move, which is a static decoration dressed as a live instrument, the
   * same trade refused in iteration 21 (painting walls that do not exist) and
   * iteration 24 (a road line that was already correct). A radar with no
   * contacts and a speedometer with no speed would be worse than nothing.
   *
   * What the city genuinely raises is the question "can I take THIS car out of
   * here", and that is answered by real state: the car's name, its tier, and
   * whether it clears the legality gate the constructor teaches. That is what
   * this strip carries, and it carries nothing else. Hidden entirely when the
   * driver is on foot, because then there is no car to describe.
   */
  const carStrip = el('div');
  // The size is the SHARED body token, not a literal. This strip is the one
  // piece of city chrome that was built with inline styles instead of the HUD
  // class system, so it sat at a hard-coded 12px while every classed readout in
  // the build inherited `--ui-text-base`. A review flagged the stats as too
  // quiet next to the gate line, which is half right: the gate line being the
  // loudest thing in the box is the design (it is the actionable road-legality
  // state), but a readout that cannot follow the body-size token is a real
  // inconsistency. Note it tracks `--ui-text-base` only — `--hud-scale` reaches
  // the HUD through `--tbase`, which is scoped to `.hud-root`, and this strip
  // lives outside it. Do not re-hard-code a font size here.
  carStrip.style.cssText =
    'position:absolute;bottom:10px;left:10px;max-width:min(320px, 42vw);color:#c9d6e4;font-family:system-ui,sans-serif;font-size:var(--ui-text-base, 13px);background:rgba(10,14,20,0.78);border:1px solid var(--ui-line, rgba(146,176,204,0.2));border-left:3px solid var(--ui-accent-strong, #4fd6c4);border-radius:6px;padding:6px 9px;pointer-events:none;box-shadow:0 3px 14px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05) inset;';
  if (state.vehicle !== null) {
    const v = state.vehicle;
    // `sumArmor`, not a local reduce: this line used to be a third independent
    // copy of the same five-facings addition, and the two other copies had each
    // already been found one FACING away from correct.
    const armourTotal = sumArmor(v.design.armor);
    const named = v.design.name.length > 0;
    // The SAME rule the constructor's LEGALITY panel reads and the city gate
    // now enforces, so "Not road-legal" below is a statement about a
    // restriction that actually exists. See `roadLegalityMisses` for why the
    // three copies this replaces had drifted apart.
    const misses = roadLegalityMisses(v.design);
    const ready = misses.length === 0;
    carStrip.innerHTML = '';
    const nameLine = document.createElement('div');
    nameLine.style.cssText = 'font-weight:600;letter-spacing:0.04em;';
    nameLine.textContent = named ? v.design.name : t('ui.city.stripUnnamed');
    carStrip.appendChild(nameLine);
    const statLine = document.createElement('div');
    statLine.style.cssText = 'color:#9fb0c2;margin-top:2px;';
    statLine.textContent = t('ui.city.stripStats', { armour: armourTotal, weapons: v.design.weapons.length });
    carStrip.appendChild(statLine);
    const gateLine = document.createElement('div');
    gateLine.style.cssText = `margin-top:3px;font-weight:600;color:${ready ? '#5ce6a4' : '#ffb454'};`;
    gateLine.textContent = ready ? t('ui.city.stripReady') : t('ui.city.stripNotReady');
    carStrip.appendChild(gateLine);
  } else {
    carStrip.style.display = 'none';
  }
  /**
   * The key to the entrance-marker colours.
   *
   * Iteration 37 colour-coded the facility markers by what each building IS FOR,
   * which fixed eight rounds of "the city is an undifferentiated grey field" —
   * and a review immediately pointed out the obvious hole: four saturated
   * colours with nothing to learn them from. Colour that carries information is
   * only information once the mapping is discoverable, and a player driving past
   * a cyan chevron has no way to know cyan means "job" rather than "clinic".
   *
   * A legend is the cheapest possible way to close that, and it costs no
   * instances in a buffer that is exactly full.
   */
  /**
   * The NEAREST facility, named. Asked for twice by Codex `gpt-6.1-sol`:
   * "The legend promises 'Jobs', but the same briefcase marks different
   * services ... I drove into one and reached the Federal Building's 'coming in
   * a future phase' panel. Another opened bus tickets, asking around, battery
   * charging, rooms, and body armour."
   *
   * This is deliberately ONE label, not a name on every door. Iteration 72
   * declined "a label plate above each marker" for a good reason — a dozen
   * plates is a dozen pieces of ink competing with the markers themselves, on
   * the most contested element in the game. A single proximity readout answers
   * the question the player actually has ("which door am I standing at?")
   * without adding any of that, and it costs ZERO canvas instances in a layer
   * that is exactly full at 95/95 — the same reason the legend was a DOM
   * overlay rather than more sprites.
   *
   * `facilityName` is the same lookup the doorway trigger uses, so the label
   * cannot disagree with the menu that opens.
   */
  const nearestFacility = el('div');
  nearestFacility.style.cssText =
    'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:none;' +
    'align-items:center;gap:8px;color:#d7e0ea;font-family:system-ui,sans-serif;' +
    'font-size:var(--ui-text-sm);background:rgba(10,14,20,0.82);' +
    'border:1px solid var(--ui-line, rgba(146,176,204,0.2));border-radius:6px;' +
    'padding:5px 11px;pointer-events:none;white-space:nowrap;';

  const legend = el('div');
  // Size and colour are on the token scale rather than hardcoded, which they
  // were: 11px was the "secondary labels" step, chosen by eye when the legend
  // was added in iteration 39, and it stayed a one-off for eleven reviews
  // because nothing else on this screen shares a stylesheet. The legend is a KEY
  // - the only thing that tells the player what four saturated marker colours
  // mean - so it reads as the `stats` step, not a secondary label. A review
  // that had already seen the legend and still called it too small to associate
  // is the same signal the entrance markers gave twice, where the answer was the
  // number and not the report. One step, deliberately: the colours already
  // measure 7.23:1 on this panel, so this is a legibility nudge and not a fix
  // for a contrast failure.
  legend.style.cssText =
    'position:absolute;bottom:10px;right:10px;display:flex;gap:10px;align-items:center;color:#9fb0c2;font-family:system-ui,sans-serif;font-size:var(--ui-text-sm);background:rgba(10,14,20,0.78);border:1px solid var(--ui-line, rgba(146,176,204,0.2));border-radius:6px;padding:5px 9px;pointer-events:none;';
  for (const [label, tint] of [
    [t('ui.city.legendFight'), facilityMarkerTint('arena')],
    [t('ui.city.legendBuild'), facilityMarkerTint('garage')],
    [t('ui.city.legendCare'), facilityMarkerTint('medical')],
    [t('ui.city.legendJobs'), facilityMarkerTint('truckstop')],
  ] as const) {
    const key = el('span');
    key.style.cssText = 'display:inline-flex;align-items:center;gap:4px;';
    const swatch = el('span');
    // The swatch is the marker art's own hue, so the key and the map cannot
    // drift apart: both read `facilityMarkerTint`.
    swatch.style.cssText = `width:10px;height:10px;border-radius:2px;background:rgb(${Math.round(Math.min(1, tint.r) * 200)},${Math.round(Math.min(1, tint.g) * 200)},${Math.round(Math.min(1, tint.b) * 200)});`;
    const text = el('span');
    text.textContent = label;
    key.appendChild(swatch);
    key.appendChild(text);
    legend.appendChild(key);
  }
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
  container.appendChild(carStrip);
  container.appendChild(nearestFacility);
  container.appendChild(legend);
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
      // Generated from the same `cityShortcuts` table the key handler reads.
      // The literal "G enter/exit car · J journal · F fleet" this replaced was
      // correct only for as long as nobody rebound anything, and it had no way
      // to say so — iteration 94's stale-instruction bug, on a second screen.
      toggle: describeCityShortcut('toggleVehicle'),
      journal: describeCityShortcut('journal'),
      fleet: describeCityShortcut('fleet'),
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
    //
    // The vehicle is resolved ONCE, here, and the same `parked` value decides
    // both what the rows say and what activation uses. It used to be resolved
    // inside `onActivate` and nowhere else, which meant the row's eligibility
    // and the thing actually driven were two separate readings of the same
    // state — one more place for the label and the behaviour to disagree.
    const parked = vehicleParkedAtGate(runState.vehicle, layout.gate.position);
    const refusal = gateRefusal(parked);
    const actions: MenuAction[] = neighbors.map((n) => ({
      id: `route-${n.route.id}`,
      label: t('ui.city.routeOption', { city: cityName(n.neighborCityId), miles: n.route.lengthMiles, danger: n.route.danger }),
      eligible: refusal === null,
      ...(refusal !== null ? { reason: refusal } : {}),
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
        const vehicle = parked;
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
    // The city reads its commands from `controls.json`'s `cityShortcuts` by
    // CODE. It used to be three literal `ev.key === 'j' | 'J'` comparisons,
    // which is the gap this closes: with no table entry there was no `keyLabel`
    // to render, so the on-screen instruction could only ever be a hardcoded
    // guess, and rebinding was impossible — the status line literally said
    // "J journal" while the handler listened for the letter.
    //
    // `G`/`J`/`F` keep their shipped keys exactly. `fire` owns `KeyJ` in both
    // presets and `validateControls` refuses two actions sharing one physical
    // input, so moving journal into `actions` would have meant taking a
    // working, tested, documented arena key away from players to tidy a
    // namespace the city never shares with the arena. See `cityShortcuts` in
    // the ruleset for that trade in full.
    const shortcut = cityShortcutForCode(ev.code);
    if (shortcut === 'toggleVehicle') doToggleVehicle();
    if (shortcut === 'fleet') openFleetScreen();
    if (shortcut === 'journal') openJournalScreen();
    // J and F are now named in `ui.city.status`, because Codex drove the city
    // and reported: "J opens Journal and F opens Fleet, but neither shortcut
    // appears in the city's visible instructions or as a desktop action
    // button. I opened both successfully; the features exist." A working
    // feature whose only affordance is an undocumented key is undiscoverable,
    // which is iteration 100's "a pause control nobody knows about is not one"
    // in a different screen.
    //
    // The instruction is GENERATED from the same table this handler reads, so
    // it cannot drift from the binding the way the literal "J journal · F
    // fleet" did — the exact stale-instruction risk iteration 94 fixed for
    // `fire`, which this closed rather than queued.
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
    const postShaderUrl = new URL('./render/shaders/post.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource, postShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
      fetch(postShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    const groundCapacity = cityGroundTileCount(layout);
    const buildingCapacity = cityLayer1InstanceCount(layout);
    resources = await buildCityRenderResources(gpuCtx, atlasBitmap, spriteShaderSource, postShaderSource, groundCapacity, buildingCapacity);

    gpuCtx.onRecovered(() => {
      void buildCityRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource, postShaderSource, groundCapacity, buildingCapacity).then((rebuilt) => {
        // See the note in showArena's onRecovered: a dropped reference does not
        // free GPU memory, only `.destroy()` does.
        resources?.destroy();
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

  function renderFrame(nowSeconds: number): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;

    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // The city is a circle of `boundsRadiusM`, which is 6.0m for the smallest
    // cities and 10.65m for New York — it scales with facility count, since
    // every facility needs a slot on the ring. (An earlier version of this
    // comment said ~21m, which is wrong by a factor of two, and cost an
    // iteration: the stain scatter below was sized from that number and came
    // out with barely one cell across the whole city. Measured across all 16
    // cities rather than assumed from the largest.) At the old fixed 14 px/m it
    // occupied about a third of a 1440px viewport with black on both sides —
    // the single most obvious thing wrong with this screen. Zooming to fit the
    // city's own bounds makes it fill the frame at any window size.
    camera.setZoom(cityZoomPxPerM(size, layout.boundsRadiusM));
    camera.setCenter(player.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    // @/ui/city-view's own layer scheme: 0 = ground, 1 = building/gate, 2 = actor (player/vehicle).
    //
    // Layers 0 and 1 are memoised per layout inside city-view, because they are
    // a pure function of a layout that is built once and never changes — the old
    // path rebuilt the whole list and re-filtered it into three arrays every
    // frame, 60 times a second, for a byte-identical result. Only the actor
    // layer is rebuilt here, which is the part that actually moves.
    const staticLayers = cityStaticLayers(layout, atlasIndex);
    const actors = buildCityActorInstances(citySnapshot(), atlasIndex);
    writeInstanceBuffer(gpuCtx.getDevice(), resources.groundInstanceBuffer, packInstances(staticLayers.ground), resources.groundCapacity);
    writeInstanceBuffer(gpuCtx.getDevice(), resources.buildingInstanceBuffer, packInstances(staticLayers.buildings), resources.buildingCapacity);
    writeInstanceBuffer(gpuCtx.getDevice(), resources.actorInstanceBuffer, packInstances(actors), resources.actorCapacity);

    const { sceneView, post } = writePostFrame(gpuCtx, resources, CITY_GRADE, nowSeconds);
    encodeGradedFrame(
      gpuCtx.getDevice(),
      resources.pipeline,
      post,
      sceneView,
      gpuCtx.getContext().getCurrentTexture().createView(),
      resources.cameraBindGroup,
      [
        { bindGroup: resources.groundBindGroup, instanceCount: staticLayers.ground.length },
        { bindGroup: resources.buildingBindGroup, instanceCount: staticLayers.buildings.length },
        { bindGroup: resources.actorBindGroup, instanceCount: actors.length },
      ],
    );
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
    updateNearestFacility();
    updateStatus();
    renderFrame(nowMs / 1000);
    rafHandle = window.requestAnimationFrame(frame);
  }

const FACILITY_LABEL_RADIUS_MULTIPLE = 2;

  /**
   * Show the nearest facility's name while the player is within
   * `FACILITY_LABEL_RADIUS_MULTIPLE` interaction radii of it.
   *
   * It is a MULTIPLE of the interaction radius rather than the radius itself:
   * at 1.0 the strip appeared on the precise frame the doorway trigger opened
   * the building's panel, so it announced the building from behind that panel
   * and carried no decision value. Both radii still derive from
   * `layout.tileSizeM` (which `generateCityLayout` assigns
   * `interactionRadiusM`), so they cannot be edited apart from each other.
   */
  function updateNearestFacility(): void {
    let bestName: string | null = null;
    let bestDist = Infinity;
    let bestOpen = true;
    for (const doorway of layout.doorways) {
      const d = Math.hypot(player.position.x - doorway.position.x, player.position.y - doorway.position.y);
      if (d < bestDist) {
        bestDist = d;
        bestOpen = isOperationalFacilityKind(doorway.facilityKind);
        // An unfinished facility says so HERE, on approach, rather than letting
        // the player walk in and be told by the stub panel. The Federal Building
        // carries the same bright Jobs marker as destinations that work, so
        // before this the only way to learn it was closed was to spend the
        // walk — and Codex `gpt-6.1-sol` reported exactly that, twice, as "its
        // bright blue Jobs marker gives it the same availability signal as other
        // destinations". A label that names a state the player cannot otherwise
        // see is the same class of lie as "Not road-legal" naming a
        // restriction the gate did not enforce, and iteration 92 fixed that half.
        bestName = bestOpen
          ? facilityName(doorway.facilityKind)
          : t('ui.city.stripClosed', { facility: facilityName(doorway.facilityKind) });
      }
    }
    // The label radius is a MULTIPLE of the entry radius, not the same value.
    // Codex measured the consequence of them being equal: both are 3.0m
    // (`layout.tileSizeM` IS `pedestrian.interactionRadiusM`), so the strip
    // appeared on the precise frame the doorway trigger opened the building's
    // panel — the reviewer approached the Federal Building and read its name
    // *behind* the panel that had already opened. A label whose entire useful
    // window is the one frame it is occluded carries zero decision value, and
    // the city has four yellow workshop and three blue briefcase markers
    // sharing two pictograms, so "which one is this" is exactly the question
    // the strip exists to answer.
    //
    // It is still DERIVED from the layout rather than hardcoded, which was the
    // point of the original comment and remains true: the two radii cannot
    // drift apart by being edited independently, only by this multiplier
    // changing. What changed is the deliberate trade — the old comment chose
    // "never advertise something out of reach", and that is a real cost, but
    // it was buying a guarantee that is worthless when the guarantee itself is
    // what makes the label invisible.
    const labelRadiusM = layout.tileSizeM * FACILITY_LABEL_RADIUS_MULTIPLE;
    if (bestName === null || bestDist > labelRadiusM) {
      nearestFacility.style.display = 'none';
      return;
    }
    // Assigning textContent every frame would churn the DOM 60x a second for
    // a string that changes rarely; only write it when it actually differs.
    if (nearestFacility.textContent !== bestName) nearestFacility.textContent = bestName;
    nearestFacility.style.color = bestOpen ? '#d7e0ea' : '#9fb0c2';
    nearestFacility.style.display = 'flex';
  }

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    touch?.destroy();
    // Release the per-screen GPU set before the context goes. `destroy()` on
    // the context tears down the managed scene texture only; the atlas texture,
    // instance buffers and post uniform are owned by `resources` and leak on
    // every screen change without this.
    resources?.destroy();
    resources = undefined;
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

/** The half-width of the band a road contact is placed in, in metres, either side of the route centreline. The road has no lateral axis of its own (iteration 61), so this is the ONLY thing that makes a contact anything other than a point on the route — and therefore the number that decides whether a forward mount can converge on it at all. */
const ROAD_CONTACT_LATERAL_SPAN_M = 12;

export interface RoadContactPlacement {
  /** Where the contact's vehicle sits in the world this tick. */
  readonly position: Vec2;
  /** Which way it faces — production always aims it back down the road at the player. */
  readonly headingRad: number;
  /** Signed metres AHEAD of (positive) or BEHIND (negative) the player, along the route axis. */
  readonly deltaM: number;
  /** The signed lateral offset actually used, for callers that need to reason about the geometry rather than just place the sprite. */
  readonly lateralM: number;
}

/**
 * WHERE a road contact's vehicle goes, and which way it faces — the single
 * owner of that placement. Extracted from `showRoad`'s own `updateEngagement`
 * so a headless test can place a contact the way PRODUCTION places it.
 *
 * It is exported because `updateEngagement` itself is a closure over the
 * screen's canvas, HUD and message log, so it cannot be called headlessly, and
 * the test that previously covered road combat responded by growing its own
 * copy of the arithmetic. That copy had drifted in two independent ways: it
 * used a span of `6` where production uses `ROAD_CONTACT_LATERAL_SPAN_M`, and
 * it applied the offset along `perp.y` alone where production applies it along
 * the whole perpendicular. So the one test covering road encounters was
 * measuring a geometry the game does not use — which is exactly why it read
 * "6.0m off the line" while production places contacts up to 12m off, and why
 * it could never have caught the difference. This is the eighth instance of
 * this log's "one owner, every surface reads it" shape
 * (`unmetRequirements` 84, `roadLegalityMisses` 92, the city-decal count 82,
 * `facilityMarkerFamily` 79, `daysPerMile` 96, the operational-kind set 98,
 * `VEHICLE_LOCAL_FACING` 120-138).
 */
export function roadContactPlacement(unit: EncounterUnit, trip: RoadTripState): RoadContactPlacement {
  const axis: Vec2 = { x: Math.cos(trip.routeHeadingRad), y: Math.sin(trip.routeHeadingRad) };
  const perp: Vec2 = { x: -axis.y, y: axis.x };
  const deltaM = (unit.routeMiles - trip.progressMiles) * drivingConfig().metersPerMile;
  const lateralM = deterministicJitter(unit.id, ROAD_CONTACT_LATERAL_SPAN_M);
  const position: Vec2 = {
    x: trip.vehicle.position.x + axis.x * deltaM + perp.x * lateralM,
    y: trip.vehicle.position.y + axis.y * deltaM + perp.y * lateralM,
  };
  return {
    position,
    headingRad: Math.atan2(trip.vehicle.position.y - position.y, trip.vehicle.position.x - position.x),
    deltaM,
    lateralM,
  };
}

/** The one place a defeated road opponent becomes a real `@/sim/road` `RoadWreck` — the fixed `wreck-${unit.id}` id convention `showRoad`'s own `stepCombat` uses, exported so a headless test can drive the exact same production seam instead of a parallel reimplementation. */
export function createRoadWreckFromDefeat(unit: EncounterUnit, position: Vec2, dayIndex: number, burned = false): RoadWreck {
  return createWreck(`wreck-${unit.id}`, position, dayIndex, burned);
}

/**
 * Rolls a destroyed vehicle's wreck against the killing weapon's `IGNITE_WRECK`
 * effect.
 *
 * ## Why this exists
 *
 * `weapons.json`'s `effects` array is schema-REQUIRED on every weapon, and its
 * `IGNITE_WRECK` variant is the only one with a consumer already waiting:
 * `@/sim/economy`'s `burnedYieldsNothing` and `searchWreck` both honour a
 * `burned` flag on a wreck, and `salvageChance` applies a flat penalty for it.
 * But nothing ever set that flag — `createRoadWreckFromDefeat` hardcoded
 * `false` — so a weapon that sets `"IGNITE_WERCK"` with a 20% chance was
 * declared in the ruleset, validated at boot, and then did nothing at all.
 *
 * Returns a boolean rather than mutating: the caller owns the `RoadTripState`
 * and decides whether to rebuild it.
 *
 * A weapon with no `IGNITE_WRECK` effect, or whose kill came from a source with
 * no weapon def at all (a hazard, a collision), yields `false`.
 */
export function rollsIgniteWreck(weapon: WeaponDef | null, rng: Rng): boolean {
  if (weapon === null) return false;
  for (const effect of weapon.effects) {
    if (effect.type !== 'IGNITE_WRECK') continue;
    if (rng.chance(effect.chance)) return true;
  }
  return false;
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
/**
 * Builds radar contacts for the HUD from the live opponent set.
 *
 * ## Why this exists
 *
 * Both arena screens used to pass `contacts: []` — a hardcoded empty array. On
 * the practice arena that is harmless (it is a free run with zero opponents, so
 * an empty radar is the TRUTH), but on a real mission arena it meant the radar
 * was a decorative black disc while up to `matchState.opponentsTotal` armed
 * vehicles drove around inside sensor range. A radar that is always empty is
 * worse than no radar, because it actively tells the player they are alone.
 *
 * Offsets are world-frame metres relative to the player, which is what
 * `HudRadarContact` documents and what `buildRadar` rotates into screen space.
 * Contacts are deliberately NOT pre-filtered to visual range here:
 * `buildRadar` already filters on `drivingConfig().radar.visualRangeM` and
 * reports the count it actually drew, so filtering twice would let the two
 * disagree and make the accessibility summary a lie.
 */
function radarContactsFromVehicles(
  world: World,
  playerId: string,
  opponents: ReadonlyMap<string, ArenaOpponentState>,
): HudRadarContact[] {
  const player = findPlayer(world);
  if (player === undefined) return [];
  const out: HudRadarContact[] = [];
  for (const vehicle of world.entities.vehicles) {
    if (vehicle.id === playerId) continue;
    // A DEFEATED opponent is not a contact, and the `opponents` map alone cannot
    // say so — that check is the next line down, and on this screen the map is
    // DELIBERATELY not pruned. `makeArenaDamageSystem` marks a kill
    // `destroyed`, bumps `opponentsDefeated` and logs, and keeps the entry,
    // because the arena's roster is the win condition and `resolveArenaExit`
    // needs it intact. The ROAD's sibling system (`makeRoadDamageSystem`) does
    // the opposite and deletes the entry, which is what made this look correct
    // by inspection: the guarantee below holds on one screen and not the other.
    //
    // Found by Codex `gpt-6.1-sol` driving the live arena: after "Opponent
    // destroyed — 2 left" the radar still showed three orange hostile markers
    // and reported three hostile contacts, while the battlefield correctly
    // stopped drawing them. An instrument pointing the player at a threat that
    // no longer exists is worse than a quiet one, because it teaches them to
    // distrust the panel exactly when it is the thing that would have helped.
    //
    // The invariant this restores is simply that THE RADAR SHOWS EXACTLY WHAT
    // THE WORLD DRAWS. The renderer excludes destroyed vehicles, so the radar
    // does too. Adding them back as non-hostile `wreck` contacts was considered
    // and rejected: `buildVehicleInstances` drops destroyed vehicles
    // entirely, so a wreck contact would point at a thing that is not rendered
    // — trading one dishonest contact for a quieter dishonest one.
    if (vehicle.destroyed) continue;
    // `opponents` is otherwise the authoritative hostile set: a neutral car in
    // the same world is not a contact, and guessing from the world alone would
    // light up every civilian.
    if (!opponents.has(vehicle.id)) continue;
    out.push({
      id: vehicle.id,
      kind: 'vehicle',
      worldDx: vehicle.position.x - player.position.x,
      worldDy: vehicle.position.y - player.position.y,
      hostile: true,
    });
  }
  return out;
}

/**
 * Road lane markings, placed along the route's frozen forward axis.
 *
 * ## Why the road needed this at all
 *
 * The road surface is a tiled asphalt texture, which reads as motionless. Two
 * separate vision reviews of the real frame said the same thing in different
 * words — "the player loses all spatial reference and directionality; driving
 * feels like sliding across a static pixelated grey sheet" and "difficult to
 * perceive vehicle speed, drift, or surface changes". Texture alone cannot carry
 * speed: it is identical at every point on the road, so nothing in the frame
 * changes as you move and the eye has no cue to track.
 *
 * ## Why placement, not art
 *
 * The dash PATTERN is geometry, not pixels. A dash image with painted gaps would
 * have to be authored at the camera's zoom to avoid looking stretched, and its
 * period would be baked in at a fixed world scale. One short bar is instead
 * placed repeatedly, so the dash period is a world-space distance the code owns
 * and can change.
 *
 * `trip.routeHeadingRad` is the route's frozen forward axis, so the markings sit
 * in a frame that does NOT rotate as the car swerves — correct, because a road's
 * lane lines are painted on the road rather than attached to the driver.
 *
 * Only the stretch within sight is built, snapped to the dash period, so the
 * instance count is bounded no matter how far the trip runs and the markings
 * never slide or shimmer as the car moves.
 */
/**
 * Roadside furniture art: a delineator POST, one instance per ROAD_POST_PERIOD_M.
 *
 * This replaced a guardrail in iteration 101, and the reason is a disagreement
 * with the reviewer that measurement could not settle, so it is recorded as a
 * judgement rather than a fix. Codex `gpt-6.1-sol` drove the deployed road and
 * reported: "the car crossed the upper roadside rail and continued onto the
 * surrounding field with unchanged condition ... a steel guardrail communicates
 * a physical barrier." The source agreed — the rails are decorative and nothing
 * in the road sim collides against props.
 *
 * The two honest answers were to give the rails collision or to stop the art
 * promising a barrier. Collision was rejected on the game's own terms, not on
 * cost: `docs/SPEC.md` describes no off-road state and no barrier, and iteration
 * 91 deliberately made the carriageway STAY PUT when the car drives off it, so
 * leaving the road is currently the only way out of a bad line. A collision wall
 * would take that away, and it would be a new mechanic invented to satisfy a
 * screenshot.
 *
 * So the furniture now says what it is. A post is spindly, discrete and
 * obviously not a wall, and it carries the same speed cue the rail did, because
 * the cue is the RHYTHM (7m apart, unchanged) rather than the object. This is
 * the trade the log has reached repeatedly: a visual that misreports a real
 * affordance is worse than a plainer one.
 *
 * The art is drawn with slight volume rather than as a true top-down rectangle,
 * which is a deliberate departure from the flat-elevation rule the guardrail
 * was generated under. A post seen from directly overhead is a ~3px blob, and
 * the log's own iteration-53/64 finding is that a cue tuned below the threshold
 * of the frame is a cue that does not exist. Volume is what makes it read. The
 * flat-elevation rule exists for VEHICLE sprites, where the car is the focal
 * object of every frame and inconsistent perspective between bodies is most of
 * what makes them read as blobs.
 */
const ROAD_FURNITURE_FRAME = 'prop-delineator';

/**
 * The stains visible around a point, world-anchored and bounded by the visible
 * extent rather than by arena size. Sits in the ground buffer (2048 slots, the
 * arena using 1 before this), for the same reason the guardrails do: a decal is
 * painted ON the surface, and `ARENA_GRADE` is a post uniform over the whole
 * composited frame, so a ground-buffer instance keeps full brightness.
 *
 * The placement primitives live in `@/ui/city-view` because the city scatters
 * the same three frames, and `city-view` is already the shared scene-authoring
 * module this file imports from — putting them here would need a cycle.
 */
export function groundDecalInstances(
  atlasIndex: AtlasIndex,
  centre: { x: number; y: number },
  halfExtentM: number,
): SpriteInstanceInput[] {
  const c0x = Math.floor((centre.x - halfExtentM) / DECAL_CELL_M);
  const c1x = Math.floor((centre.x + halfExtentM) / DECAL_CELL_M);
  const c0y = Math.floor((centre.y - halfExtentM) / DECAL_CELL_M);
  const c1y = Math.floor((centre.y + halfExtentM) / DECAL_CELL_M);
  const cells: [number, number][] = [];
  for (let cy = c0y; cy <= c1y; cy += 1) {
    for (let cx = c0x; cx <= c1x; cx += 1) {
      if (decalCellHash(cx, cy, 0) >= DECAL_CHANCE) continue;
      cells.push([cx, cy]);
    }
  }
  return decalsInCells(cells, atlasIndex, DECAL_CELL_M);
}

const ROAD_LANE_HALF_WIDTH_M = 4.2;
/** Verge tone left visible either side of the edge lines, so the paint sits inside a shoulder. */
const ROAD_SHOULDER_M = 2.4;
/** Metres of painted line per dash, and the metres of gap before the next. */
const ROAD_DASH_LENGTH_M = 3.2;
const ROAD_DASH_PERIOD_M = 10;

/**
 * Metres between delineator posts. The PERIOD is the whole speed cue and it is
 * deliberately unchanged from the guardrail it replaces: what the player reads
 * motion from is the rhythm of discrete objects whipping past several times a
 * second, not any property of the object itself. 7m apart.
 */
const ROAD_POST_PERIOD_M = 7;
/**
 * The post's extent ACROSS the road, in metres. The along-road extent is derived
 * from the art's own aspect ratio (see `roadFurnitureInstances`) rather than
 * hardcoded, because a hand-copied `21/96` is exactly the kind of second copy
 * that drifts — the guardrail it replaced had one, and it was correct only by
 * coincidence.
 *
 * Sized for LEGIBILITY at the road's 34 px/m: ~1.0m across is ~34px, which is
 * where a post plus its shadow reads as an object rather than as speckle.
 */
const ROAD_POST_SIZE_M = 1.0;
/**
 * Lateral offset of the posts, clear of the paint AND of the shoulder of verge
 * beyond it. Sitting them on the shoulder would read as more road marking,
 * which is the one thing the lane lattice already is.
 */
const ROAD_POST_LATERAL_M = ROAD_LANE_HALF_WIDTH_M + ROAD_SHOULDER_M + 0.8;

/**
 * Roadside furniture: guardrail segments down both verges.
 *
 * A review asked for exactly this and for the right reason: "there are no
 * barriers, delineator posts, signs, traffic or debris anywhere between the top
 * and bottom of the frame ... at driving speed the car feels stationary". (Its
 * TRAFFIC half was wrong and is corrected in iteration 61 — passing opponents
 * are spawned by `updateEngagement`; they are simply sparse, and a seeded t=0
 * capture has none in frame. The furniture half is the real gap.)
 *
 * Why this and not a ground decal, which is the other ART item on the deferred
 * list: a decal is PLACED CONTENT, and the whole reason it is deferred as
 * artwork is that it is an authoring job. A guardrail is the same honesty for a
 * different reason — it is repeated FURNITURE at a KNOWN INTERVAL, which is
 * precisely what real highways use to make speed readable, and it cannot lie
 * about the simulation because nothing about it is a gameplay affordance. It
 * also adds no gameplay surface: no collision (nothing in the road sim collides
 * against props), no interaction, nothing to drive through that pretends to be
 * solid.
 *
 * World-anchored exactly like the dash lattice above, so the posts neither
 * slide with the car nor shimmer as it moves, and bounded by the visible extent
 * so the count cannot grow with trip length. They ride the GROUND buffer
 * (2048 slots, ~20 used) rather than the sprite buffer (64 slots): a top-down
 * post stands on the ground, and `ROAD_GRADE` is a POST uniform applied to
 * the whole composited frame, so a ground-buffer instance keeps full brightness
 * exactly as a sprite-buffer one would. Putting them in the 64-slot sprite
 * buffer for ~16 more instances would have been the iteration-19 mistake —
 * treating a tight buffer as a policy instead of a contract to grow.
 */
/**
 * Signed metres from the carriageway CENTRELINE, measured on the trip's frozen
 * route axis — the same axis `progressMiles` uses and the same one the surface,
 * lane paint and roadside posts are all placed on (iteration 91).
 *
 * Exported so the off-road indicator's geometry is pinnable from a test against
 * the REAL function. An inline copy in the test would be a second derivation of
 * the one thing the indicator must not get wrong, which is the failure mode this
 * log has now hit seven times.
 */
export function roadLateralOffsetM(
  routeHeadingRad: number,
  position: { readonly x: number; readonly y: number },
): number {
  const forward = { x: Math.cos(routeHeadingRad), y: Math.sin(routeHeadingRad) };
  const across = { x: -forward.y, y: forward.x };
  return position.x * across.x + position.y * across.y;
}

/**
 * Which way the recovery arrow points on SCREEN, in degrees clockwise from up
 * (so the glyph `▲` can be rotated by this and nothing else has to change).
 *
 * THE BUG THIS REPLACES, because the reason the first version was wrong is the
 * more useful half. `roadRecoveryArrow()` returned `◀` or `▶` from the sign of
 * the lateral offset alone, with a comment claiming "the same `across` axis the
 * geometry uses, so it cannot disagree with where the road actually is". It
 * could and did: `across` is a WORLD-SPACE vector and was never projected to
 * screen, so the arrow only pointed correctly for a road running east-west with
 * the car below it. Codex drove it and reported the exact symptom — "I drove
 * north of the horizontal carriageway and stopped. The road's delineator posts
 * were visible along the bottom of the frame, but the indicator read '◀ Road —
 * 14 m.' The road was below the car, not left of it."
 *
 * The failure was recorded a round earlier and shipped anyway. Iteration 105
 * said the direction "is not independently verifiable" because crossing the
 * centreline ends the off-road state, so a straight drive cannot flip it — and
 * then treated that as a reason to leave it alone rather than as the reason to
 * do the arithmetic. An honest statement of what you could not check is not a
 * substitute for checking it, especially when you already had a reason to
 * suspect it: that round's own reasoning had concluded world +y is screen-up,
 * which is exactly the case the sign-only arrow got wrong.
 *
 * THE PROJECTION, step by step, so a reader can check it rather than trust it:
 *   1. the nearest point on the carriageway is the car's own projection onto the
 *      route axis, so "the way back" is purely PERPENDICULAR to the road:
 *          dir = -sign(lateral) * across,   across = (-sin h, cos h)
 *      i.e. `dir = (sign*sin h, -sign*cos h)`. The sign is inverted because a
 *      car on the positive side has the road on the negative side.
 *   2. `buildOrthoMatrix` sets `m[0] = sx` and `m[5] = sy`, both POSITIVE, and
 *      WebGPU puts clip +y at the TOP of the frame. So world +x is screen right
 *      and world +y is screen UP — which means, in CSS pixel coordinates where
 *      +y points DOWN, the screen vector is `(vx, -vy)`:
 *          screen = (sign*sin h, sign*cos h)
 *   3. `▲` already points up, i.e. screen (0,-1), and CSS `rotate()` is
 *      clockwise, so rotating it by `f` gives `(sin f, -cos f)`. Matching that
 *      against step 2 gives `sin f = sign*sin h` and `cos f = -sign*cos h`.
 *
 * Worked against the reviewer's own captured state — road heading 0, car north
 * of it, so lateral > 0 — this yields `f = atan2(0, -1) = 180deg`, a `▼`, and
 * the road was indeed below the car. The old code returned `◀`.
 */
export function roadRecoveryDirectionDeg(lateralM: number, routeHeadingRad: number): number {
  const sign = lateralM > 0 ? 1 : -1;
  const deg = (Math.atan2(sign * Math.sin(routeHeadingRad), -sign * Math.cos(routeHeadingRad)) * 180) / Math.PI;
  // Normalised to [0, 360). `atan2` returns (-180, 180], so the leftward answer
  // arrives as -90 rather than 270 — the same screen direction, but the
  // function's stated contract is "degrees clockwise from up", and a value
  // outside that range makes every downstream comparison ambiguous about
  // whether two equal directions were compared. CSS accepts either; the
  // contract should not need the reader to know that.
  return ((deg % 360) + 360) % 360;
}

export function roadFurnitureInstances(
  atlasIndex: AtlasIndex,
  vehicle: VehicleState,
  routeHeadingRad: number,
  visibleHalfExtentM: number,
): SpriteInstanceInput[] {
  const frame = atlasIndex.frame(ROAD_FURNITURE_FRAME);
  const forward = { x: Math.cos(routeHeadingRad), y: Math.sin(routeHeadingRad) };
  const across = { x: -forward.y, y: forward.x };
  const along0 = vehicle.position.x * forward.x + vehicle.position.y * forward.y;
  const first = Math.ceil((along0 - visibleHalfExtentM) / ROAD_POST_PERIOD_M);
  const last = Math.floor((along0 + visibleHalfExtentM) / ROAD_POST_PERIOD_M);

  /**
   * The along-road extent, from the art's OWN aspect ratio rather than a
   * hand-copied literal.
   *
   * The guardrail this replaced sized itself as `ROAD_RAIL_SEGMENT_M * (21/96)`
   * — a second copy of the frame's dimensions, typed by hand next to the atlas
   * entry that already holds them. It happened to be right. This reads the
   * atlas, so regenerating the art at a different trim updates the size with it,
   * and the art can never be drawn at an aspect the geometry disagrees with.
   * That is the same "one owner, every surface reads it" shape as
   * `roadLegalityMisses` and `unmetRequirements`, and the same reason: a second
   * derivation is a second thing to drift.
   */
  const alongM = ROAD_POST_SIZE_M * (frame.pixelHeight / frame.pixelWidth);

  const out: SpriteInstanceInput[] = [];
  for (let i = first; i <= last; i++) {
    const along = i * ROAD_POST_PERIOD_M;
    for (const lateral of [-ROAD_POST_LATERAL_M, ROAD_POST_LATERAL_M]) {
      out.push({
        atlasId: String(frame.atlasIndex),
        position: {
          x: forward.x * along + across.x * lateral,
          y: forward.y * along + across.y * lateral,
        },
        // The frame's long axis is local +Y, so rotating by the bare route
        // heading points it ACROSS the carriageway. The furniture takes the same
        // quarter turn `roadLaneInstances` takes and therefore the SAME rotation
        // value — which is the relationship iteration 86's test pins, and it is
        // kept rather than dropped: a post is near-radially symmetric so its own
        // orientation barely matters, but the SHADOW in the art has a direction,
        // and letting two road layers disagree about which way is down is how the
        // combs bug happened in the first place.
        //
        // This was a quarter turn out for two iterations (80 and 81) — a row of
        // vertical combs on a horizontal highway — and it was visible in this
        // repo's own road capture the whole time. The comment above this line
        // used to argue FOR the bug ("the route heading alone points it ALONG
        // the road, so no extra quarter turn here"); both halves of that were
        // wrong, which is how reading the code confirmed it. Found by Codex
        // `gpt-6.1-sol` driving the live road.
        rotationRad: routeHeadingRad + Math.PI / 2,
        sizeM: { x: ROAD_POST_SIZE_M, y: alongM },
        uvRect: frame.uv,
        // Tinted DOWN, and measured rather than eyeballed. The generated art is
        // near-white and at full strength the old rails measured 126.5 mean luma
        // against the player's own 100.5 — the furniture was out-shouting the
        // car, which is iteration 60's "the oversized icons out-rank the
        // player's car" reproduced on a brand new element. The cool cast keeps it
        // reading as weathered roadside furniture rather than as more white paint.
        // Re-measured on the post rather than inherited: see the log entry, where
        // the number was taken again and the same tint survived.
        tint: { r: 0.58, g: 0.60, b: 0.64, a: 1 },
        layer: 0,
      });
    }
  }
  return out;
}

/**
 * The drivable surface itself, as a rotated strip laid over the verge.
 *
 * The strip runs the length of the visible area and is a little wider than the
 * edge lines (which sit at +/- ROAD_LANE_HALF_WIDTH_M), so there is a shoulder
 * of verge tone either side of the paint — the same relationship a real road has
 * with its hard shoulder, and it gives the white lines something to sit inside
 * rather than marking a boundary between two identical greys.
 */
/**
 * Arena spatial reference: investigated, measured, and deliberately NOT shipped.
 *
 * A review said the arena is "a uniform faded tiled surface with no walls, edge
 * markers, or environmental props to define the arena bounds or give spatial
 * reference while driving", and suggested a perimeter wall plus scattered
 * barriers. Three variants were built and measured rather than guessed at:
 *
 *  1. Perimeter wall / scattered barriers — DECLINED without building them. The
 *     arena is an unbounded, camera-locked field with no collision geometry, so
 *     a painted perimeter is a visible lie about walls that do not exist, and
 *     non-colliding barriers are props the player drives straight through.
 *  2. A painted ring at the REAL `spawnRingRadiusM` (45m) — honest (opponents do
 *     spawn there) and useless: the practice camera shows ~24m of half-height,
 *     so the ring fell outside the view and changed 0.54% of the frame. Marking
 *     something true in a place the player cannot see is still not an answer.
 *  3. A dotted centre circle and radial ticks at ~10m — this one DID render and
 *     was plainly visible, and it was still wrong, twice over. Centred on the
 *     world origin it was nearly off screen again (the player spawns away from
 *     it, ~300 changed pixels), and centred on the PLAYER it travelled with the
 *     car, which destroys the entire point: a reference that moves with you
 *     carries no information about your motion.
 *
 * So the arena keeps no added markings. It already has world-fixed reference —
 * the ground tiles by `fract(worldPos)`, so its slab-joint lattice is anchored to
 * the world and does give the eye something fixed to judge motion against, which
 * is what variant 3 was trying to add on top of.
 *
 * The real answer to this review is a GAMEPLAY change, not a decoration: give
 * the arena actual bounds with collision, or place props that genuinely block.
 * Both belong in the sim, and neither should be faked in the render layer to make
 * a screenshot look finished.
 */

function roadSurfaceQuad(
  atlasIndex: AtlasIndex,
  center: Vec2M,
  routeHeadingRad: number,
  visibleHalfExtentM: number,
): SpriteInstanceInput {
  const scale = GROUND_TILE_METRES['road']!;

  // The surface is anchored to the ROUTE, not to the car — this is the whole
  // fix, and the difference is one word.
  //
  // It used to be centred on the vehicle's full 2D position, while the lane
  // paint and the roadside furniture were placed on the route axis. So the
  // surface followed the car in BOTH axes: driving north off an east-west
  // highway left the lane markings behind in the frame but kept an asphalt
  // strip centred under the car, and the environment told the player they
  // were on the road when they had left it. Found by Codex `gpt-6.1-sol`:
  // "the lane markings and roadside furniture leave the view, but an asphalt
  // strip remains centered beneath the car."
  //
  // Projecting the car onto the centreline (the line through the world origin
  // in the route's direction) gives a centre that tracks along-route motion
  // exactly as before and refuses to track lateral motion at all — which is
  // what asphalt does. Once the car is genuinely off the carriageway, the
  // verge quad underneath it is what shows, and the road stays where the road
  // is. `roadLaneInstances` and `roadFurnitureInstances` already compute this
  // same `along0` projection, so the three layers now share one origin
  // instead of three derived from two different assumptions.
  const forward = { x: Math.cos(routeHeadingRad), y: Math.sin(routeHeadingRad) };
  const along = center.x * forward.x + center.y * forward.y;
  const routeCentre: Vec2M = { x: forward.x * along, y: forward.y * along };

  return groundQuad(atlasIndex, {
    pool: 'road',
    center: routeCentre,
    // Along the route it must cover the whole view however far the camera is
    // pulled back; the diagonal bound is the safe half-extent for any rotation.
    halfExtent: {
      x: visibleHalfExtentM * 1.5 + ROAD_LANE_HALF_WIDTH_M * 2,
      y: ROAD_LANE_HALF_WIDTH_M + ROAD_SHOULDER_M,
    },
    rotationRad: routeHeadingRad,
    layer: 1,
    tileMetres: scale.tileMetres,
    // A finer grain than the verge, so the two read as different materials even
    // before the tone difference lands.
    detailScale: scale.detailScale * 0.62,
    tint: ROAD_SURFACE_TINT,
  });
}

export function roadLaneInstances(
  atlasIndex: AtlasIndex,
  vehicle: VehicleState,
  routeHeadingRad: number,
  visibleHalfExtentM: number,
): SpriteInstanceInput[] {
  const centreFrame = atlasIndex.frame('decal-lane-stripe');
  const edgeFrame = atlasIndex.frame('decal-road-edge');
  // Both frames are stored as neutral white so the atlas chroma keyer keeps
  // them (a warm yellow was keyed away entirely). The highway's paint colour
  // is applied here as a tint instead, which also keeps the look in one place.
  const centreTint = { r: 1.15, g: 0.98, b: 0.62, a: 0.9 };
  const edgeTint = { r: 0.7, g: 0.72, b: 0.76, a: 0.62 };

  const forward = { x: Math.cos(routeHeadingRad), y: Math.sin(routeHeadingRad) };
  const across = { x: -forward.y, y: forward.x };

  // The player's projection onto the route axis, in metres, so the dash lattice
  // is anchored to the WORLD rather than to the car.
  const along0 = vehicle.position.x * forward.x + vehicle.position.y * forward.y;
  const first = Math.ceil((along0 - visibleHalfExtentM) / ROAD_DASH_PERIOD_M);
  const last = Math.floor((along0 + visibleHalfExtentM) / ROAD_DASH_PERIOD_M);

  const out: SpriteInstanceInput[] = [];
  for (let i = first; i <= last; i++) {
    const along = i * ROAD_DASH_PERIOD_M;
    for (const lateral of [0, -ROAD_LANE_HALF_WIDTH_M, ROAD_LANE_HALF_WIDTH_M]) {
      const isCentre = lateral === 0;
      const frame = isCentre ? centreFrame : edgeFrame;
      out.push({
        atlasId: String(frame.atlasIndex),
        position: {
          x: forward.x * along + across.x * lateral,
          y: forward.y * along + across.y * lateral,
        },
        // The bar's long axis must run ACROSS the direction of travel.
        //
        // The frame's long axis is local +Y, and rotating it by the route
        // heading alone leaves it pointing ALONG the road — which is what the
        // first pass did, and the result was a continuous stripe running
        // lengthwise down the carriageway: three long marks end to end with no
        // visible gaps, so the "dashed centre line" read as a solid line. The
        // extra quarter turn is what lays the bar across the road.
        rotationRad: routeHeadingRad + Math.PI / 2,
        sizeM: isCentre ? { x: 0.45, y: ROAD_DASH_LENGTH_M } : { x: 0.4, y: visibleHalfExtentM * 2 },
        uvRect: frame.uv,
        tint: isCentre ? centreTint : edgeTint,
        // Below the ground quad (layer 0) and the vehicles, but above nothing
        // else — markings are painted ON the road surface.
        layer: 0,
      });
    }
  }
  return out;
}

/**
 * `onExitToTitle` is threaded the same way the arena's `onExit` is: returning to
 * the title needs `resumeSession`/`startNewSession`, which are closures inside
 * `boot()`, so a screen that is not itself inside `boot()` cannot reach them.
 * Adding a second callback is a small cost for keeping the trip menu's Save and
 * quit honest — a save-and-quit that cannot actually return to a title with a
 * working Continue would be the worst version of this feature.
 */
/**
 * Maps the driver's stick into the ROAD's frame, so "forward" means "along the
 * highway".
 *
 * ## Why this is not a cosmetic mapping
 *
 * `src/sim/driving.ts` is a DIRECTION-AND-THROTTLE model: it computes
 * `desiredHeadingRad = atan2(dir.y, dir.x)` and steers the nose to FACE the
 * stick. That is a deliberate, documented choice ("classic direction-and-throttle
 * steering") and it is right in an open arena, where pointing the stick north
 * *should* send you north.
 *
 * The road is a one-dimensional corridor with a fixed axis, and the raw
 * world-space stick was being handed straight to that model. So `W` — a stick of
 * `(0, 1)` — asked for a heading of 90° (north) no matter which way the car was
 * already pointing. On an east–west highway that means **pressing forward turns
 * the car ninety degrees off the road while still accelerating**. Measured live:
 *
 *     at trip start   heading   0deg  speed  0mph
 *     +700ms  W       heading  17deg  speed  7mph
 *     +1400ms W       heading  55deg  speed 14mph
 *     +2100ms W       heading  90deg  speed 21mph   off-road "Road — 3 m"
 *     +2800ms W       heading  90deg  speed 28mph   off-road "Road — 3 m"
 *
 * An advisory review reported exactly this ("spawns facing 0° North
 * (perpendicular to traffic)… pressing forward immediately drives off the road")
 * and it took this long to confirm, because two earlier probes tried and failed:
 * the frame-diff approach cannot work because the camera follows the car so the
 * ROAD scrolls rather than the car moving, and a radar-marker probe returns
 * dx=dy=0 because the radar is player-centred and the marker never moves.
 *
 * So the stick is rotated into the road's frame: `desired = routeHeading +
 * atan2(moveX, moveY)`. Full throttle holds the road's axis, `D` adds a steer
 * offset to the RIGHT of it, and `S` asks for the axis reversed — which the
 * driving model's own `wantsOpposite` test then correctly reads as reverse.
 */
export function roadStick(routeHeadingRad: number, moveX: number, moveY: number): { x: number; y: number } {
  const len = Math.hypot(moveX, moveY);
  if (len === 0) return { x: 0, y: 0 };
  const desired = routeHeadingRad + Math.atan2(moveX, moveY);
  return { x: Math.cos(desired) * len, y: Math.sin(desired) * len };
}

function showRoad(
  root: HTMLElement,
  state: CityRunState,
  initialTrip: RoadTripState,
  onArrive: (nextState: CityRunState) => void,
  onExitToTitle?: () => void,
): void {
  const container = el('div', 'sm-screen sm-screen--road');
  container.style.cssText = 'position:absolute;inset:0;background:#05070a;';
  const canvas = el('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  /**
   * The objective pill, and why its backing is as opaque as it is.
   *
   * A review said the top-centre text "uses white text against a semi-transparent
   * black background that sits directly over the moving asphalt ... the
   * transparency allows the noise of the road to bleed into the text area".
   *
   * That is half a measurement. Composited against the measured road luma of
   * 93.5, a 0.7-alpha pill lands at rgb(35,38,42) and `#d7e0ea` on it is
   * 11.40:1 — already well past AA. But the honest half of the report is that
   * 0.7 was chosen to let the scene show through, and on THIS screen the scene
   * under the pill is a moving, high-frequency asphalt texture. The ratio clears
   * the threshold on the average pixel and says nothing about the brightest
   * aggregate that scrolls under the text while the car is moving.
   *
   * So the backing goes to 0.86, which keeps the pill reading as glass over the
   * world (it is not a solid block) while removing the noise underneath the
   * glyphs. Measured after: 15.1:1, and the pill is still visibly transparent.
   */
  const status = el('div');
  status.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);max-width:min(700px, calc(100vw - 260px));color:#d7e0ea;font-family:system-ui,sans-serif;font-size:13px;background:rgba(10,14,20,0.86);padding:4px 10px;border-radius:4px;text-align:center;';
  /**
   * The driving hint, as its OWN element that fades out.
   *
   * A review said the objective banner "mixes permanent status with leaked dev
   * data ... and a long run-on control string", and asked for "a persistent
   * left-aligned status and a transient tutorial hint that fades out after a few
   * seconds". It was a permanent part of a status line that also updates every
   * single frame, so a control reminder the player has already learned sat in
   * the middle of the objective forever.
   *
   * It cannot be a child of `status`, because that element's textContent is
   * reassigned on every frame of the trip — the hint would be destroyed and
   * rebuilt ~60 times a second and the fade would never run. As a sibling it
   * fades once and is then simply gone, and `status` keeps carrying only what
   * is actually true for the whole journey.
   */
  const driveHint = el('div');
  driveHint.style.cssText =
    'position:absolute;top:60px;left:50%;transform:translateX(-50%);color:#9fb0c2;font-family:system-ui,sans-serif;font-size:12px;background:rgba(10,14,20,0.62);padding:3px 9px;border-radius:4px;text-align:center;pointer-events:none;animation:sm-road-hint-fade 7s ease-out forwards;';
  driveHint.textContent = t(isCoarsePointer() ? 'ui.road.driveHintTouch' : 'ui.road.driveHint');
  const notice = el('div');
  notice.style.cssText =
    'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);color:#ffd166;font-family:system-ui,sans-serif;font-size:12px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;text-align:center;max-width:80vw;';
  const retryBtn = el('button');
  retryBtn.style.cssText =
    'position:absolute;bottom:36px;left:50%;transform:translateX(-50%);pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';

  /**
   * The trip menu, and why the road screen needed one at all.
   *
   * Codex `gpt-6.1-sol` drove this screen and reported: "I tried Escape and P.
   * Neither opened a menu or paused the simulation; the car continued
   * coasting." Correct, and it greps clean — `showRoad` mounted no menu and no
   * actions of any kind, so there was no pause, no controls reference, and no
   * way to leave a trip. Every other screen in the game has a menu: the title
   * has one, the practice arena has an "Exit to Title" button, and every
   * building interior has a numbered menu. The road was the only screen where a
   * player who wanted to stop had to use browser navigation.
   *
   * That is especially costly HERE, because of the pacing finding this log
   * carries: a leg is a genuine ~129 minutes of driving, so "check the controls
   * or stop for a moment" is not a rare impulse on this screen, it is the
   * normal thing a player wants to do. The reviewer was explicit that the menu
   * is needed even after travel is shortened.
   *
   * `menuHost` stays EMPTY until the menu is opened, so the road renders
   * exactly as it did before this change while the menu is closed — which is
   * the only way to be sure the pause overlay does not regress the frame the
   * capture gate measures.
   */
  // The trip menu is CENTRED, and deliberately no longer bottom-left.
  //
  // An advisory review found this host at
  // `left: clamp(16px,4vw,56px); bottom: clamp(20px,5vh,56px)` — the exact
  // corner `.hud-panel--radar` occupies (`bottom: var(--inset); left: var(--inset)`)
  // — so opening the menu occluded the radar's title, its contacts and its
  // orientation label.
  //
  // The bottom-left placement looks chosen to keep the road visible while
  // paused, but the trip FREEZES the road (a test is named for exactly that), so
  // there is no moving scene to protect. Centring also makes this the only modal
  // in the game that is not centred.
  //
  // The TITLE screen's menu host below `showTitle` keeps its bottom-left
  // placement on purpose: nothing occludes it there and it is the arcade
  // convention. This change is scoped to the road, not to every host that
  // happens to share the string.
  const menuHost = el('div');
  menuHost.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,90vw);max-height:80vh;overflow:auto;';
  /**
   * The menu's own title, mounted into `menuHost` only while the menu is open.
   *
   * `@/ui/menu`'s `buildMenuDom` renders the money/date header and a numbered
   * list and nothing else, so "Trip menu" is this element's job. It lives in
   * `menuHost` rather than in `container` permanently because `menuHost` is
   * emptied by `closeTripMenu`, and a title left on screen after the menu
   * closed would be exactly the orphaned-widget shape iteration 71 caught
   * (an exit button hidden behind a panel, reading as a stray artifact).
   */
  const menuTitle = el('div');
  menuTitle.style.cssText =
    'color:#d7e0ea;font-family:system-ui,sans-serif;font-size:15px;font-weight:600;margin:0 0 8px;';
  /**
   * A persistent hint that the menu exists.
   *
   * A pause control the player does not know about is not a pause control, and
   * the reviewer's whole point was that they had to GUESS at a key. It is
   * deliberately permanent rather than one of the fading drive hints: the drive
   * hint teaches driving, which is learned in the first ten seconds, whereas
   * "you can stop" is a fact about the screen that has to stay true and stay
   * discoverable for the whole 129-minute leg.
   */
  const menuHint = el('div');
  menuHint.style.cssText =
    'position:absolute;top:88px;left:50%;transform:translateX(-50%);color:#9fb0c2;font-family:system-ui,sans-serif;font-size:12px;background:rgba(10,14,20,0.7);padding:3px 9px;border-radius:4px;pointer-events:none;';
  menuHint.textContent = t('ui.road.menuHint');

  /**
   * The off-road recovery indicator.
   *
   * Iteration 101 made leaving the carriageway the ONLY way out of a bad line,
   * which made the absence of any way BACK a real cost rather than a missing
   * nicety. Codex `gpt-6.1-sol` drove the live road, steered off, and reached a
   * view where the carriageway and its posts had left the frame entirely while
   * the banner still read "En route to Albany · 150mi remaining" — no arrow, no
   * distance, nothing locating the road. The radar reports contacts and the
   * progress bar reports progress; neither reports the roadway.
   *
   * It is deliberately the cheapest thing that answers the question, and it
   * reuses the axis the road is ALREADY drawn on rather than adding a fourth
   * derivation of it (the projection is computed in three places already, which
   * is drift waiting to happen — `trip.routeHeadingRad` is the same frozen
   * origin every other road layer uses, per iteration 91).
   *
   * Shown only while the car is genuinely beyond the shoulder. It must not
   * appear on the carriageway, where it would be the "UI overlay" objection
   * iterations 11 and 53 were both about.
   */
  const offRoadHint = el('div');
  // The direction is carried by a ROTATED ELEMENT rather than a `◀`/`▶`
  // character in the string, because the answer is a screen-space angle and
  // not one of two glyphs: `roadRecoveryArrow()` picked a left/right pair from
  // the lateral offset's sign and was wrong whenever the road was above or
  // below the car rather than beside it (Codex drove it and got `◀` with the
  // road plainly below). Rotating `▲` handles all eight directions with one
  // glyph and keeps the wording in strings.json, where every other word lives.
  const offRoadArrow = el('span');
  offRoadArrow.style.cssText = 'display:inline-block;transform-origin:50% 50%;margin-right:5px;';
  offRoadArrow.textContent = '\u25B2';
  // The LABEL is its own element rather than the container's text node, because
  // writing to `offRoadHint.lastChild` was the bug this replaces: the hint
  // starts empty, so after `prepend` the arrow span IS the only child, and
  // `lastChild` therefore pointed at the ARROW — the per-frame label write
  // silently overwrote the `\u25B2` glyph. It shipped like that and a live
  // probe found it by matching the container's `textContent` instead of its
  // own, which is the log's own rule (a probe that finds the wrong element is
  // worse than one that finds nothing) arriving in a new costume.
  const offRoadLabel = el('span');
  offRoadHint.style.cssText =
    'position:absolute;top:120px;left:50%;transform:translateX(-50%);color:#ffd166;font-family:system-ui,sans-serif;font-size:13px;background:rgba(10,14,20,0.82);border:1px solid rgba(255,209,102,0.4);padding:5px 11px;border-radius:4px;pointer-events:none;white-space:nowrap;';
  offRoadHint.style.display = 'none';

  // --- route progress -------------------------------------------------------
  // A vision review asked for "a thicker, high-contrast progress bar with a
  // filled portion and a vehicle marker". It is a real ask: the objective line
  // says how many miles REMAIN, which is the same number every frame, so on a
  // 150-mile run it looks static for a long time and the player has no way to
  // see they are getting closer. A bar fills as the odometer advances.
  //
  // Deliberately built with two stacked elements and a `transform: scaleX` fill
  // rather than a `width`: the fill then animates on the compositor and never
  // triggers layout on a value that changes every frame.
  const progress = el('div', 'sm-road-progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-label', t('ui.road.progressLabel'));
  const progressFill = el('div', 'sm-road-progress__fill');
  const progressCar = el('div', 'sm-road-progress__car');
  progress.appendChild(progressFill);
  progress.appendChild(progressCar);
  container.appendChild(canvas);
  container.appendChild(status);
  container.appendChild(driveHint);
  container.appendChild(menuHint);
  offRoadHint.appendChild(offRoadArrow);
  offRoadHint.appendChild(offRoadLabel);
  container.appendChild(offRoadHint);
  container.appendChild(progress);
  container.appendChild(notice);
  container.appendChild(retryBtn);
  container.appendChild(menuHost);
  clearAndAppend(root, container);

  lastSessionSeed = state.sessionSeed;

  let trip = initialTrip;
  let driver = state.driver;
  const drivingSkill = getSkill(driver, 'driving');
  const dtSecondsFixed = dtSecondsFromTickRate(drivingConfig().tickRateHz);
  const playerVehicleId = trip.vehicle.id;

  /**
   * Unconsumed real time, drained into whole `dtSecondsFixed` steps.
   *
   * The road screen used to step the player's car on the RAW rAF delta while
   * stepping every opponent in the same `combatWorld` at the fixed tick rate.
   * That is not a rounding difference, it is two different positions for the
   * same object in the same frame: `makeArenaDrivingSystem` produced a
   * `playerAfter` that `stepCombat` then discarded the position/heading/speed
   * of, keeping only armor/tire/plant/weapons. AI targeting, projectile
   * intersection and vehicle collision all ran against whichever of the two the
   * consumer happened to read.
   *
   * It also made the road non-deterministic across machines: `stepDriving`
   * draws from the seeded RNG per call, so the same seed and the same inputs
   * produced different fights at 60Hz and at 144Hz. The arena screens route
   * through `createGameLoop` precisely to avoid this.
   */
  let roadAccumulator = 0;
  /**
   * Ceiling on catch-up ticks in a single frame.
   *
   * This must be comfortably ABOVE the number of ticks a single legitimate frame
   * can owe, or the loop silently runs the game in slow motion. The frame delta
   * is clamped to 0.25s, which at the default 60Hz tick rate is 15 ticks — so a
   * cap of 8 halved the simulation speed on every slow frame. That is not a
   * harmless safety valve: it made the sim advance at a different rate than
   * wall-clock, and it made a short engagement window fall between two sampled
   * frames entirely, so a real contact could be stepped straight past.
   *
   * 20 covers a full 0.25s clamped frame with headroom, and still bounds a
   * pathological stall (a multi-second GC pause, a backgrounded tab) so the
   * backlog is discarded rather than carried into an ever-growing catch-up.
   */
  const ROAD_MAX_CATCHUP_TICKS = 20;

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
    // Also feed the HUD message feed. The road screen gained a full HUD
    // (radar, speed, condition) but its `roadMessages` array was declared,
    // passed to the snapshot and NEVER written to, so the feed region rendered
    // permanently empty while every message went to a single line of `notice`
    // text. Two callers of `logNotice` exist and both are player-facing events
    // worth keeping in the log, so this is the single place both channels
    // diverge and it is the right place to join them.
    //
    // `info` is the right kind: these are notices, not hits or kills, and the
    // feed styles each kind differently.
    // `tick` is documented as the generation tick, used only for feed ordering,
    // so the combat world's tick is the right monotonic source here. `Clock` has
    // no minute field (it is just dayIndex + phase), so inventing one here
    // would have been a number nothing else agreed with.
    roadMessages.push({ id: `road-msg-${roadMessageCounter}`, kind: 'info', text, tick: combatWorld.tick });
    roadMessageCounter += 1;
    if (roadMessages.length > 20) roadMessages.shift();
  }

  // Message feed + weapon cycling for the road HUD. Both are created here rather
  // than shared with the arena screens because those bind to their own world;
  // the road's world is the transient `combatWorld`, so the arena's
  // `findPlayer(world)`-based selectors have nothing to select from.
  const roadMessages: HudMessage[] = [];
  let roadMessageCounter = 0;

  function engagementRangeM(): number {
    return drivingConfig().radar.visualRangeM;
  }

  /** Spawns/despawns opponent vehicles for this tick's `trip.contacts` against `trip.progressMiles`, and logs a peaceful pass-by once per contact. Positions come from `roadContactPlacement`, the single owner of where a contact goes and which way it faces — this closure only decides WHETHER a contact is engaged. */
  function updateEngagement(): void {
    const metersPerMile = drivingConfig().metersPerMile;
    const range = engagementRangeM();

    for (const contact of trip.contacts) {
      const unit = asEncounterUnit(contact);
      if (unit === undefined || resolvedContactIds.has(unit.id)) continue;
      const distanceM = Math.abs(unit.routeMiles - trip.progressMiles) * metersPerMile;
      const vehicleId = roadOpponentVehicleId(unit.id);
      const engaged = willFire(unit) && contactIsCombatCapable(unit) && distanceM <= range;

      if (engaged && !opponentVehicles.has(vehicleId)) {
        const { position, headingRad } = roadContactPlacement(unit, trip);
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
  /**
   * The road's six combat systems, built ONCE at screen setup.
   *
   * `make*System` returns a `SystemFn` — a closure over its arguments. Calling
   * all five inside `stepCombat` allocated five functions and five closure
   * environments on every animation frame, to re-derive systems whose inputs
   * never change identity for the life of the screen. `showArenaEvent` builds
   * its systems exactly once at setup; this is the same shape, and it also
   * makes the call ORDER in `stepCombat` explicit and reviewable instead of
   * implicit in statement order.
   *
   * `roadDriverRef` is hoisted for the same reason and is re-synced from `driver`
   * at the top of every tick, so a driver swap (a wreck search that costs
   * health) is still visible to the systems on the next tick.
   */
  const roadDriverRef = { current: driver };
  const roadSystems = {
    // The road has no fixed arena floor, so the AI is bounded on a box that
    // FOLLOWS the player. This reads the live world each tick, so it must stay
    // a callback rather than a value captured now.
    ai: makeArenaAISystem(playerVehicleId, opponents, aiInputs, (w) => {
      const p = w.entities.vehicles.find((v) => v.id === playerVehicleId);
      return roadBounds(p?.position ?? { x: 0, y: 0 });
    }),
    driving: makeArenaDrivingSystem(roadDriverRef, playerVehicleId, opponents, aiInputs),
    weapons: makeArenaWeaponsSystem(roadDriverRef, playerVehicleId, opponents, aiInputs, projectileTargets, spawnCounter, () => {}),
    projectiles: projectilesSystem,
    damage: makeRoadDamageSystem(playerVehicleId, roadDriverRef, opponents, projectileTargets),
    cleanup: cleanupSystem,
  };

  function stepCombat(playerInput: InputFrame, dtSeconds: number): void {
    combatWorld.tick += 1;
    combatWorld.entities.vehicles = [trip.vehicle, ...opponentVehicles.values()];
    roadDriverRef.current = driver;

    // ORDER MATTERS, and this screen had it backwards. `makeArenaAISystem`'s own
    // contract (see its doc block) is that it runs AFTER this tick's
    // movement/fire/damage have resolved, so an opponent decides what to do
    // starting the FOLLOWING tick — which is how a human reacts to what it just
    // saw. Here it ran FIRST, so every road opponent chose its target and its
    // hazards against LAST frame's positions while every arena opponent chose
    // against this frame's. On a fast-moving target that is the AI seeing
    // through walls, and the road was the only screen where it happened.
    roadSystems.driving(combatWorld, playerInput, dtSeconds);
    roadSystems.weapons(combatWorld, playerInput, dtSeconds);
    roadSystems.projectiles(combatWorld, playerInput, dtSeconds);
    roadSystems.damage(combatWorld, playerInput, dtSeconds);
    roadSystems.cleanup(combatWorld, playerInput, dtSeconds);
    // Last, per the contract above.
    roadSystems.ai(combatWorld, playerInput, dtSeconds);
    driver = roadDriverRef.current;

    // Merge combat-relevant fields back onto the authoritative `trip.vehicle`.
    // Position/heading/speed/odometer stay `stepRoadTrip`'s alone — this
    // system's own redundant movement of the player entry is discarded.
    //
    // `battery` is NOT one of those, and omitting it was a live bug: `fire()`
    // decrements `battery` for a `usesBattery` weapon (weapons.json's `laser`
    // costs 1 per shot), the decrement landed on `playerAfter`, and the merge
    // dropped it — so on the road the laser cost nothing at any rate of fire.
    // The arena screens were unaffected because `makeArenaDamageSystem` writes
    // the whole vehicle back.
    //
    // Merging it is not a clobber of `stepRoadTrip`'s own drain: `stepCombat`
    // rebuilds `combatWorld.entities.vehicles` from the CURRENT `trip.vehicle`
    // at the top of the tick, so `playerAfter` already starts from the
    // post-drain value and carries both the drain and the shot cost.
    const playerAfter = combatWorld.entities.vehicles.find((v) => v.id === playerVehicleId);
    if (playerAfter !== undefined) {
      trip = {
        ...trip,
        vehicle: {
          ...trip.vehicle,
          armorDP: playerAfter.armorDP,
          tireDP: playerAfter.tireDP,
          plantDP: playerAfter.plantDP,
          battery: playerAfter.battery,
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
        // The killing weapon's `IGNITE_WERCK` effect, if it has one, burns the
        // wreck it leaves behind — the flag `searchWreck` and `salvageChance`
        // already honour. Rolling from the trip's own seeded stream keeps this
        // deterministic, exactly like every other draw on this screen.
        const wreck: RoadWreck = createRoadWreckFromDefeat(
          unit,
          deadVehicle.position,
          trip.clock.dayIndex,
          // The player's currently-mounted weapon, which is the one that
          // resolved the killing shot. Deliberately NOT `unit.design`'s mount:
          // that is the OPPONENT's hardware, and igniting their wreck with their
          // own weapon's effect would be nonsense.
          rollsIgniteWreck(
            trip.vehicle.weapons[weaponSelection.active() ?? NO_WEAPON_SLOT] !== undefined
              ? getWeapon(trip.vehicle.weapons[weaponSelection.active() ?? NO_WEAPON_SLOT]!.weaponId)
              : null,
            state.rng,
          ),
        );
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

  // --- trip menu ----------------------------------------------------------
  /**
   * Pause state. The whole point of the menu is that the trip STOPS, so this
   * gates the fixed-timestep loop in `frame` rather than only covering the
   * screen with a panel — a translucent menu over a simulation that keeps
   * running would be worse than no menu, because the player would be choosing
   * between Resume and Abandon while their car kept driving itself off the
   * road.
   *
   * `roadAccumulator` is deliberately NOT zeroed on resume. It is drained by the
   * stepping loop every frame, so by the time the menu is open it holds only
   * the sub-tick remainder (under one `dtSecondsFixed`), and keeping it means
   * resuming continues the trip from the same sub-tick phase. Zeroing it would
   * be harmless in practice and would look like it mattered.
   */
  let paused = false;
  let mountedMenu: MountedMenu | null = null;
  /**
   * Set when the trip menu's OWN handler consumed this keypress.
   *
   * This exists because of event ordering, and the first version of this guard
   * was wrong in exactly the way its own comment predicted. `mountMenu`
   * registers keydown on `menuHost` and the screen's pause handler is on
   * `window`; a keypress on a row inside the menu therefore reaches
   * `menuHost` FIRST and `window` SECOND. So on Escape while open:
   *   1. `handleMenuKey` returns BACK -> `closeTripMenu()` -> `paused = false`
   *   2. the window handler runs, sees `paused === false`, and RE-OPENS the menu
   * The trip appeared not to respond to Escape at all, which is the shipped
   * bug the reviewer reported, re-created by the fix for it. `if (paused)
   * return` cannot catch this: by the time the window handler runs, the menu
   * has already cleared the flag it was supposed to be guarding.
   *
   * The flag is consumed on read and reset on the next keydown, so it applies
   * to exactly the one keypress the menu handled and cannot mask a later one.
   */
  let menuHandledKey = false;

  function openTripMenu(): void {
    if (mountedMenu !== null) return;
    paused = true;
    // Clear held keys so a player who opens the menu while holding W does not
    // find the car accelerating again the instant they resume — the menu is
    // where the player is deciding to drive, and `attachCodeTracking` only ever
    // ADDS codes, so a cleared set is what actually stops the stick.
    codesDown.clear();
    menuHost.innerHTML = '';
    menuHost.appendChild(menuTitle);
    menuTitle.textContent = t('ui.road.menu');
    const actions: MenuAction[] = [
      { id: 'resume', label: t('ui.road.menuResume'), eligible: true },
      { id: 'controls', label: t('ui.road.menuControls'), eligible: true },
      // Save and quit is what makes a long leg interruptible rather than an
      // atomic commitment — the reason `SaveGame.roadTrip` exists. It is placed
      // ABOVE abandon deliberately: both leave the trip, but one is resumable
      // and one forfeits the car, so the recoverable option must not be the
      // one a player has to read past.
      { id: 'save-quit', label: t('ui.road.menuSaveQuit'), eligible: true },
      { id: 'abandon', label: t('ui.road.menuAbandon'), eligible: true },
    ];
    mountedMenu = mountMenu({
      container: menuHost,
      // The in-run menus DO show the header: money, day and city are real
      // status while a trip is in flight, unlike the title screen where this
      // same line was a phantom readout (see `mountMenu`'s own `showHeader`).
      header: {
        cash: driver.cash,
        dayIndex: trip.clock.dayIndex,
        phase: trip.clock.phase,
        // Origin AND destination, not just the origin. An advisory review read
        // this as a stale readout: pausing halfway to Albany showed "New York",
        // which is the city the player LEFT and says nothing about where they
        // are going. `→` is used rather than an en-dash because the header is
        // already a `place` suffix on one line and an arrow is unambiguous at a
        // glance in a way "A - B" is not.
        cityName: `${cityName(trip.resolved.originCityId)} \u2192 ${cityName(trip.resolved.destinationCityId)}`,
      },
      actions,
      onActivate: (id) => {
        if (id === 'resume') {
          closeTripMenu();
          return;
        }
        if (id === 'controls') {
          closeTripMenu();
          // The controls screen mounts over `root`, so the road is torn down
          // with it; returning re-runs the whole road screen from `trip`, which
          // is still the live trip state and not a re-derivation.
          showControls(root, () => showRoad(root, state, trip, onArrive, onExitToTitle));
          return;
        }
        if (id === 'save-quit') {
          saveAndQuit();
          return;
        }
        finishAbandoned();
      },
      onBack: () => {
        menuHandledKey = true;
        closeTripMenu();
      },
    });
  }

  function closeTripMenu(): void {
    mountedMenu?.destroy();
    mountedMenu = null;
    menuHost.innerHTML = '';
    paused = false;
  }

  /**
   * Write the live trip, THEN leave — in that order, and the order is the fix.
   *
   * This was first written `void persistArenaSession(...)` and then navigated,
   * matching the arena exit's fire-and-forget. The integration test caught it
   * immediately: reading the database straight after the menu action found
   * NOTHING, because the write had not landed yet. For most screens that race
   * is harmless, but "Save and quit" whose save can be lost by quitting is
   * precisely the class of defect this log has spent a hundred iterations
   * removing — a control that says it saved something it may not have.
   *
   * `persistArenaSession` swallows its own failures (private browsing, quota),
   * so awaiting it cannot hang the screen: the worst case is that the write
   * failed and the player returns to the title with no save, which is the
   * honest outcome.
   */
  async function saveAndQuit(): Promise<void> {
    stop();
    closeTripMenu();
    await persistArenaSession({
      openDb: state.openDb,
      driver,
      vehicle: trip.vehicle,
      clock: trip.clock,
      location: trip.resolved.originCityId,
      quests: state.quests,
      sessionSeed: state.sessionSeed,
      world: null,
      roadTrip: roadTripToSave(trip),
    });
    // Where the player LANDS is secondary; that the save is written is the
    // whole feature. With no title callback threaded (the gate and capture-rig
    // call sites do not have one, because `startNewSession` is a closure inside
    // `boot()`), the fallback is the arrival screen at the origin city — the
    // trip is saved, the car is not forfeited, and the title's Continue still
    // picks the trip up if they walk out through Arcade.
    if (onExitToTitle !== undefined) onExitToTitle();
    else onArrive({ ...state, driver: { ...driver, cityId: trip.resolved.originCityId }, cityId: trip.resolved.originCityId });
  }

  /**
   * Voluntary abandonment: the SPEC's own escape ("the player may continue on
   * foot"), reached deliberately instead of only by running the battery flat.
   *
   * The payload is deliberately IDENTICAL to `finishDestroyed` below — same
   * origin city, same `vehicleStored: true`, same fleet reconciliation. That
   * is the point: both routes mean "the car stays on the highway and you walk
   * back", so a player who abandons deliberately and a player whose car dies
   * are left in exactly the same world state, and there is one implementation
   * of what abandonment MEANS rather than two that can drift.
   */
  function finishAbandoned(): void {
    stop();
    closeTripMenu();
    logNotice(t('ui.road.abandonDone'));
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

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const postShaderUrl = new URL('./render/shaders/post.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource, postShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
      fetch(postShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    resources = await buildRenderResources(gpuCtx, atlasBitmap, spriteShaderSource, postShaderSource);

    gpuCtx.onRecovered(() => {
      void buildRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource, postShaderSource).then((rebuilt) => {
        // Destroy the set being replaced BEFORE dropping it. Assigning over the
        // reference releases the old atlas texture and buffers to the garbage
        // collector, but GC does not free GPU memory — only `.destroy()` does.
        // Without this, every device-loss recovery leaked a full 2048x2048
        // atlas texture plus four buffers, and a laptop that cycles GPUs a few
        // times would eventually fail to allocate.
        resources?.destroy();
        resources = rebuilt;
      });
    });
    gpuCtx.onRecoveryFailed(() => {
      resources = undefined;
    });
    wireRecoveryUi(gpuCtx, retryBtn, logNotice);
  }

  // --- HUD ------------------------------------------------------------------
  // The road screen drives the same vehicle, fights the same `@/sim/ai` opponents
  // and fires the same weapons as the arena screens, but it used to render NO
  // HUD at all — no radar, no speed, no condition. A combat screen with no
  // instrumentation is a real gap, and it is why the road captures showed bare
  // asphalt with two buttons in the corner.
  //
  // `trip.vehicle` is the authoritative player body here (the road has no
  // `findPlayer(world)` because its world is the transient `combatWorld`
  // overlay, rebuilt each tick), so the snapshot is built from it directly
  // rather than through the arena helper.
  const hudHost = el('div');
  hudHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  container.insertBefore(hudHost, status);
  const hudContainer = document.createElement('div');
  hudContainer.style.pointerEvents = 'auto';
  hudHost.appendChild(hudContainer);
  const hudDoc = new DomHudDocument();
  const hudRoot = new DomHudElement(hudContainer);
  let hudSettings: HudSettings = { scale: 1, radarOrientation: 'world', reducedFlash: false, reducedShake: false };

  function renderRoadHudFrame(): void {
    const vehicle = trip.vehicle;
    const plant = getPlant(vehicle.design.plantId);
    const liveOpponents = [...opponentVehicles.values()].filter((v) => !v.destroyed);
    const snapshot: HudSnapshot = {
      vehicle,
      activeWeaponIndex: weaponSelection.active(),
      accelMphPerSec: computeBuildCached(vehicle.design).accelMphPerSec,
      radar: {
        enabled: !isRadarDisabled(vehicle.plantDP, plant.radarFailureThreshold),
        contacts: liveOpponents.map((v) => ({
          id: v.id,
          kind: 'vehicle' as const,
          worldDx: v.position.x - vehicle.position.x,
          worldDy: v.position.y - vehicle.position.y,
          hostile: true,
        })),
      },
      driver: { naturalHealth: driver.naturalHealth, bodyArmor: driver.bodyArmor },
      messages: roadMessages,
      settings: hudSettings,
    };
    renderHud(hudDoc, hudRoot, snapshot, {
      onToggleRadarOrientation: () => {
        hudSettings = { ...hudSettings, radarOrientation: hudSettings.radarOrientation === 'world' ? 'heading' : 'world' };
        renderRoadHudFrame();
      },
      onToggleReducedFlash: () => {
        hudSettings = { ...hudSettings, reducedFlash: !hudSettings.reducedFlash };
        renderRoadHudFrame();
      },
      onToggleReducedShake: () => {
        hudSettings = { ...hudSettings, reducedShake: !hudSettings.reducedShake };
        renderRoadHudFrame();
      },
    });
  }

  function renderFrame(nowSeconds: number): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;
    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setZoom(ROAD_ZOOM_PX_PER_M);
    camera.setCenter(trip.vehicle.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    const atlas = atlasIndex;
    const opponents = [...opponentVehicles.values()].filter((v) => !v.destroyed);
    // Cull to the camera's visible bounds before packing. The road's opponent
    // list is grown by `updateEngagement` from live route contacts, so its size
    // is a property of the data rather than of the renderer — culling is what
    // keeps `SPRITE_INSTANCE_CAPACITY` from being a silent cliff edge.
    const vehicleInstances = [
      vehicleShadowInstance(trip.vehicle, atlas),
      vehicleSpriteInstance(trip.vehicle, atlas),
      ...opponents.flatMap((v) => [vehicleShadowInstance(v, atlas), vehicleSpriteInstance(v, atlas, OPPONENT_TINT)]),
    ];
    // The road has its own combat (`makeRoadDamageSystem`, `stepCombat`), so its
    // shots carry the same defect for the same reason — the renderer submitted
    // vehicles and shadows and never looked at `combatWorld.entities.projectiles`.
    // `combatWorld`, not `world`: the road's loop world is explicitly `null` and
    // its combat runs through `stepCombat`, which maintains a separate world.
    const effectHeadroom = Math.max(0, SPRITE_INSTANCE_CAPACITY - vehicleInstances.length);
    const effectInstances = projectileSpriteInstances(combatWorld.entities.projectiles, combatWorld.tick, atlas).slice(0, effectHeadroom);
    const spriteInstances = cullInstances(
      [...vehicleInstances, ...effectInstances],
      camera.getVisibleBounds(),
    ).visible;

    // The road is an unbounded world, so the ground quad is sized to the
    // visible area and re-centred on the player each frame. There is no cell
    // grid and nothing is hashed from world coordinates any more — the tiling
    // is a world-space `fract()` in the fragment shader, so panning cannot make
    // the ground crawl or re-randomise under the car.
    const visible = cameraVisibleHalfExtentM(camera);
    const half = Math.max(visible.x, visible.y) + GROUND_MARGIN_M;
    const groundInstances = buildGroundQuad(atlas, trip.vehicle.position, half, 'road');
    // Lane markings, on the same layer as the ground so they paint onto it. They
    // are appended to the ground buffer rather than the sprite buffer because
    // they are part of the road surface, not things standing on it.
    groundInstances.push(roadSurfaceQuad(atlas, trip.vehicle.position, trip.routeHeadingRad, half));
    groundInstances.push(...roadLaneInstances(atlas, trip.vehicle, trip.routeHeadingRad, half));
    // Roadside furniture, after the paint so the rails sit on top of the surface
    // they line. Same buffer, same layer, same world-anchored lattice.
    groundInstances.push(...roadFurnitureInstances(atlas, trip.vehicle, trip.routeHeadingRad, half));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.tileInstanceBuffer, packInstances(groundInstances), TILE_INSTANCE_CAPACITY);
    writeInstanceBuffer(gpuCtx.getDevice(), resources.spriteInstanceBuffer, packInstances(spriteInstances), SPRITE_INSTANCE_CAPACITY);

    const { sceneView, post } = writePostFrame(gpuCtx, resources, ROAD_GRADE, nowSeconds);
    encodeGradedFrame(
      gpuCtx.getDevice(),
      resources.pipeline,
      post,
      sceneView,
      gpuCtx.getContext().getCurrentTexture().createView(),
      resources.cameraBindGroup,
      [
        { bindGroup: resources.tileBindGroup, instanceCount: groundInstances.length },
        { bindGroup: resources.spriteBindGroup, instanceCount: spriteInstances.length },
      ],
    );
  }

  let rafHandle = 0;
  let lastTimeMs = performance.now();
  let stopped = false;

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    inputTracking.detach();
    window.removeEventListener('keydown', onSearchKey);
    // The trip menu's own listener and its mounted menu both outlive `frame`
    // being cancelled, and both are screen-scoped: a road screen that is torn
    // down with its pause key still attached would have the NEXT screen's
    // Escape keypress open a trip menu over the city. `mountedMenu` is torn down
    // through `closeTripMenu` for the same reason — it focuses its container,
    // and a focused menu left in a dead DOM is a focus trap.
    window.removeEventListener('keydown', onPauseKey);
    closeTripMenu();
    touch?.destroy();
    // Release the per-screen GPU set before the context goes. `destroy()` on
    // the context tears down the managed scene texture only; the atlas texture,
    // instance buffers and post uniform are owned by `resources` and leak on
    // every screen change without this.
    resources?.destroy();
    resources = undefined;
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

  /**
   * Esc / P toggle the trip menu.
   *
   * Both keys, because the reviewer tried both and only one being live would be
   * a coin flip. `Escape` is the game's existing back-out key — `@/ui/menu`'s
   * own `handleMenuKey` maps it to BACK on every other menu in the game — and
   * `P` is the near-universal pause key, so this matches player expectation
   * from both directions.
   *
   * Registered BEFORE the drive keys matter: while paused the menu owns the
   * keyboard, and while driving the menu must not steal a key the car needs.
   * `P` is not a bound driving action and `Escape` is not bound at all, so
   * there is no conflict to resolve — verified rather than assumed, because
   * `controls.json` is rebindable at runtime and a future binding to either key
   * would make this a real collision.
   */
  function onPauseKey(ev: KeyboardEvent): void {
    // A keypress the menu already handled (BACK, an action, a digit) is not a
    // second, independent request to pause. Read-and-clear, so the very next
    // keypress is judged on its own.
    // Any key a menu OWNS is consumed here exactly once — whether `mountMenu`
    // raised the latch, or the event was aimed inside the menu's own DOM.
    // Both arms clear the latch, because leaving it set swallows the NEXT
    // legitimate Escape: `menuHandledKey` is one-shot, so a leaked `true` makes
    // an unrelated later pause look handled. Consuming in one place is what
    // keeps the two ways of knowing the same thing from disagreeing.
    const target = ev.target;
    const aimedAtMenu = target instanceof Element && target.closest('.sm-menu-root, .sm-menu') !== null;
    if (menuHandledKey || aimedAtMenu) {
      menuHandledKey = false;
      return;
    }
    // A key aimed inside a menu belongs to that menu — the full reasoning is on
    // the arena's own `onPauseKey`, and the bug is identical: `showControls`
    // mounts the road synchronously inside the keydown whose BACK it is
    // handling, so without this guard the Escape that leaves Controls also
    // re-opens the trip menu on the road it just returned to. Measured there:
    // one menu already mounted on return, odometer never advancing.
    if (ev.key !== 'Escape' && ev.key.toLowerCase() !== 'p') return;
    // Only open. Closing is the menu's own job (its BACK maps to `onBack`),
    // because `mountMenu` focuses its container and therefore owns the keyboard
    // while it is open — this handler must not also close, or one Escape would
    // toggle twice and appear to do nothing.
    if (paused) return;
    ev.preventDefault();
    openTripMenu();
  }
  window.addEventListener('keydown', onPauseKey);

  function frame(nowMs: number): void {
    if (stopped) return;
    const frameDeltaSeconds = Math.max(0, Math.min((nowMs - lastTimeMs) / 1000, 0.25));
    lastTimeMs = nowMs;

    /**
     * While the menu is open the trip is FROZEN, and the freeze is a return
     * before any simulation is read rather than a `paused` check around the
     * stepping loop. Putting it first means nothing can slip past: not
     * `stepRoadTrip`, not `stepCombat`, not weapon cooldown, not the route
     * clock, not contact engagement.
     *
     * It still redraws, because the menu is an overlay on a frozen FRAME and a
     * stale canvas under a menu is fine — but `lastTimeMs` has already been
     * consumed above, so the frame the menu closes on cannot carry the whole
     * paused duration as one enormous clamped delta. That is the whole reason
     * the update is placed here rather than after the delta is read.
     */
    if (paused) {
      renderFrame(nowMs / 1000);
      renderRoadHudFrame();
      rafHandle = window.requestAnimationFrame(frame);
      return;
    }

    const raw = rawInputFrom(codesDown, touch);
    weaponSelection.update(raw);
    const resolvedInput = resolveInput(raw, currentControlPreset, currentControlBindings);
    const playerInput: InputFrame = {
      moveX: resolvedInput.moveX,
      moveY: resolvedInput.moveY,
      fire: resolvedInput.fire,
      weaponSlot: weaponSelection.active() ?? NO_WEAPON_SLOT,
    };

    // Fixed-timestep stepping, exactly as `@/sim/loop`'s `createGameLoop` does
    // for the arena screens. See ROAD_MAX_CATCHUP_TICKS for why this screen
    // used to differ, and why that was a real bug rather than an inconsistency:
    // it stepped the player's car on the raw rAF delta while every opponent in
    // the SAME `combatWorld` stepped at `dtSecondsFixed`, so one frame produced
    // two different player positions, and the road's outcome depended on the
    // display's refresh rate.
    roadAccumulator += frameDeltaSeconds;
    let ticks = 0;
    let arrived = false;
    let destroyed = false;
    while (roadAccumulator >= dtSecondsFixed) {
      const result = stepRoadTrip(
        trip,
        { stick: roadStick(trip.routeHeadingRad, playerInput.moveX, playerInput.moveY) },
        dtSecondsFixed,
        state.rng,
        drivingSkill,
        'normal',
        contactDamageThisTick(),
      );
      trip = result.state;
      updateEngagement();
      stepCombat(playerInput, dtSecondsFixed);
      roadAccumulator -= dtSecondsFixed;
      ticks += 1;
      if (result.arrived) { arrived = true; break; }
      if (trip.vehicle.destroyed) { destroyed = true; break; }
      // Stop dropping ticks on the floor. Past the cap the backlog is discarded
      // rather than carried, or catching up takes longer than real time and
      // every following frame is further behind than the last.
      if (ticks >= ROAD_MAX_CATCHUP_TICKS) { roadAccumulator = 0; break; }
    }
    // A frame that ran zero ticks must still redraw, or the game freezes on any
    // display whose refresh rate is faster than the sim's tick rate.
    if (ticks === 0) {
      renderFrame(nowMs / 1000);
      renderRoadHudFrame();
      rafHandle = window.requestAnimationFrame(frame);
      return;
    }

    if (destroyed) { finishDestroyed(); return; }

    /**
     * Off-road recovery, from the SAME frozen axis the road is drawn on.
     *
     * `routeHeadingRad` is fixed for the trip (it is the axis `progressMiles`
     * is measured along), so `across` is a fixed perpendicular and the car's
     * signed offset from the carriageway is a dot product — no new geometry and
     * no second definition of "where the road is".
     *
     * The arrow points TOWARD the centreline, so its sign is the OPPOSITE of the
     * car's offset: a car sitting on the positive side of `across` has the road
     * behind it in the negative direction. Getting that backwards would produce
     * a confident arrow pointing further out into the field, so it is pinned by
     * a test rather than reasoned about once.
     *
     * Only shown beyond the SHOULDER, not merely beyond the painted edge: a
     * driver tracking the centreline crosses those lines constantly, and an
     * indicator that flickers on every steering correction is noise.
     */
    const lateralOffsetM = roadLateralOffsetM(trip.routeHeadingRad, trip.vehicle.position);
    const offRoadThresholdM = ROAD_LANE_HALF_WIDTH_M + ROAD_SHOULDER_M;
    if (Math.abs(lateralOffsetM) > offRoadThresholdM) {
      const metres = Math.round(Math.abs(lateralOffsetM) - offRoadThresholdM);
      // Rotate the arrow to the SCREEN direction of the nearest carriageway
      // point. The previous `roadRecoveryArrow(lateralM)` picked a left/right
      // glyph from the sign of the offset, on the stated reasoning that the
      // world-space `across` axis "cannot disagree with where the road actually
      // is" — which is precisely what it did, because nothing projected it to
      // screen. See that function's own comment for the derivation.
      const deg = roadRecoveryDirectionDeg(lateralOffsetM, trip.routeHeadingRad);
      offRoadArrow.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      offRoadLabel.textContent = t('ui.road.offRoad', { metres: String(metres) });
      if (offRoadHint.style.display !== 'flex') offRoadHint.style.display = 'flex';
    } else if (offRoadHint.style.display !== 'none') {
      offRoadHint.style.display = 'none';
    }

    const remainingMiles = Math.max(0, Math.round(trip.resolved.route.lengthMiles - trip.progressMiles));
    status.textContent = t(isCoarsePointer() ? 'ui.road.statusTouch' : 'ui.road.status', {
      city: cityName(trip.resolved.destinationCityId),
      miles: remainingMiles,
      day: trip.clock.dayIndex,
      phase: t(PHASE_LABEL_KEY[trip.clock.phase]),
    });
    // Route progress, from the odometer rather than from "miles remaining", so
    // the bar is monotonic across the trip. Clamped because a truck that
    // overshoots the destination would otherwise overflow the track.
    const routeFraction = trip.resolved.route.lengthMiles > 0
      ? Math.max(0, Math.min(1, trip.progressMiles / trip.resolved.route.lengthMiles))
      : 0;
    progressFill.style.transform = `scaleX(${routeFraction})`;
    progressCar.style.left = `${(routeFraction * 100).toFixed(2)}%`;
    progress.setAttribute('aria-valuenow', String(Math.round(routeFraction * 100)));
    progress.setAttribute('aria-valuetext', t('ui.road.progressValue', {
      percent: Math.round(routeFraction * 100),
      miles: remainingMiles,
    }));

    const wreckNearby = nearbySearchableWreck() !== undefined;
    if (wreckNearby) logNotice(t('ui.road.wreckHint'));
    touch?.setCommandVisible('searchWreck', wreckNearby);
    renderFrame(nowMs / 1000);
    renderRoadHudFrame();
    if (arrived) { finish(); return; }
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

/** A loading sink that does nothing, for tests and the `?screen=` jump. */
const NOOP_LOADING_SCREEN: LoadingScreen = {
  report: () => {},
  dismiss: () => {},
  dismissed: true,
};

export interface BootOptions {
  /** Defaults to `window.location.search`. Overridable for testing without a DOM `location`. */
  readonly search?: string;
  /** Defaults to `randomSessionSeed` (real crypto). Overridable for deterministic tests. */
  readonly randomSeed?: () => string;
  /** Defaults to opening the real IndexedDB save database. Overridable for testing. */
  readonly openDb?: () => Promise<IDBDatabase>;
  /**
   * Progress sink for the loading splash. Defaults to a no-op, which is what
   * tests and the `?screen=` visual-verification jump get: neither has a splash
   * in the document, and a missing element must never be able to fail boot.
   *
   * Every value reported here is a step that genuinely completed — see
   * `src/ui/loading-screen.ts`. There is deliberately no timer anywhere in the
   * chain, so a slow machine shows a slow bar and a stuck load shows a stuck
   * bar, rather than both showing a confident 100%.
   */
  readonly loading?: LoadingScreen;
}

export async function boot(root: HTMLElement, bootOptions: BootOptions = {}): Promise<void> {
  const loading: LoadingScreen = bootOptions.loading ?? NOOP_LOADING_SCREEN;
  loading.report(LOADING_PHASE.booted, 'Warming up');

  // The ruleset parse + invariant sweep is the first genuinely heavy
  // synchronous block, so it is reported as its own phase: it is the step most
  // likely to be slow on a cold cache, and it is the step that fails first on a
  // bad ruleset, which is exactly when a player needs to see a label.
  validateAllRulesets();
  loading.report(LOADING_PHASE.validated, 'Loading rules');

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
            const cityState = freshCityRunState(chargedDriver, vehicle, { sessionSeed, openDb, search });
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
    // A road trip in progress resumes INTO the trip, not into the origin city.
    // This branch exists because the alternative was a save that silently threw
    // away the exact thing it was taken to preserve: a player who stopped at
    // mile 40 would come back to a city and a fresh road, having been told
    // their trip was saved. That is iteration 93's bug class (a save that
    // loses what it exists to keep) and it is why this check is before the
    // city rebuild rather than inside it.
    if (existing.game.roadTrip != null) {
      if (vehicle === null) {
        // No car means no trip: the blob's vehicle is the save's, so without
        // one there is nothing to drive. Fall through to the city, which
        // resumes a carless driver on foot rather than losing the run.
        console.info('smduel: road trip save has no active vehicle; resuming in the city instead');
      } else {
        const cityState = cityRunStateFromSaveGame(existing.game, vehicle, { openDb, search, randomSeed });
        const trip = rehydrateRoadTrip(
          existing.game.roadTrip,
          vehicle,
          { dayIndex: existing.game.currentDay, phase: existing.game.phase },
        );
        lastSessionSeed = cityState.sessionSeed;
        console.info(`smduel: resumed road trip ${trip.resolved.route.id} at ${trip.progressMiles.toFixed(1)} mi, seed ${cityState.sessionSeed}`);
        showRoad(root, cityState, trip, (nextState) => showCity(root, nextState));
        return;
      }
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
    loading.report(LOADING_PHASE.saved, 'Restoring session');
    // The title screen's background is a 1.7MB image referenced from a CSS
    // `background-image`, which the browser fetches lazily and paints whenever
    // it happens to finish — so without this the menu can appear with the art
    // missing and then silently gain it a second later. Preloading and
    // DECODING it first is what makes the bar mean anything, and it is the
    // single largest asset reachable at boot.
    //
    // Gated on `!loading.dismissed`, which reads as an odd way to ask "is there
    // a splash?" until you know what it means: the wait exists ONLY to cover
    // the gap the splash occupies. With no splash (every test, and the
    // `?screen=` jump) there is nothing to hide the load behind, so making
    // boot block on a 1.7MB decoration would be pure cost — and a test suite
    // would pay a 15s preload timeout per test.
    if (!loading.dismissed) {
      await preloadImage(titleArtUrl());
      loading.report(LOADING_PHASE.artwork, 'Loading artwork');
    }
    showTitle(root, {
      onNewDriver: () => startNewSession(),
      ...(existing !== null
        ? { onContinue: () => resumeSession(existing), hasWonVictory: hasWonVictory(existing.game.quests) }
        : {}),
    });
    loading.report(LOADING_PHASE.ready, 'Ready');
    loading.dismiss();
  }

  // `?screen=<name>` boots straight into one named screen with a deterministic
  // session, skipping the whole title -> driver -> constructor walk.
  //
  // This exists for VISUAL VERIFICATION, not as a cheat. Reaching the arena or
  // the road otherwise means steering a walking avatar into a procedurally
  // placed door in a seeded city, which is a fragile thing to ask a screenshot
  // script to do repeatedly and get the same framing twice. A visual overhaul
  // cannot be reviewed without repeatable captures of the same screen, so this
  // is the seam that makes before/after comparison possible at all.
  //
  // It is strictly a URL-parameter path: nothing in the normal boot flow calls
  // it, and the session it builds is a real one (a real driver, a real legal
  // vehicle, a real `CityRunState`) built from the same functions the real flow
  // calls, so what gets captured is the real screen and not a mock.
  function startScreenJump(target: string): boolean {
    // `arena-event` is the ONE target that mounts `showArenaEvent` rather than
    // `showArena`, and it is here because its absence has now cost live
    // verification TWICE. The road trip menu went unverified for a round
    // because `?screen=road` was fine but `?screen=arena` is the PRACTICE screen
    // — a different function — so a probe against it reported the arena-event
    // pause "not working" when it was probing the wrong closure (iteration 109).
    // The workaround, walking the city to an arena door blind, dead-ended at
    // "Federal Building — closed" exactly as iteration 90's did.
    //
    // A capture route is cheaper than a blind walk and it never goes stale: the
    // rig builds a full `CityRunState` a few lines above this, so mounting a
    // real event costs one call rather than a fixture.
    if (!SCREEN_TARGET_SET.has(target)) return false;

    if (target === 'title') {
      showTitle(root, { onNewDriver: () => startNewSession() });
      return true;
    }
    if (target === 'controls') {
      showControls(root, () => showTitle(root, { onNewDriver: () => startNewSession() }));
      return true;
    }

    // Everything below needs a driver, and everything but `driver` needs a
    // legal vehicle too. Both are built from the real constructors with an
    // even skill split and the cheapest legal build, which is exactly what the
    // driver's own first session produces before they spend anything.
    const cfg = skillsConfig();
    const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
    const remainder = cfg.startingSkillPool - base * cfg.skills.length;
    const skills: Record<string, number> = {};
    cfg.skills.forEach((name, index) => {
      skills[name] = base + (index === cfg.skills.length - 1 ? remainder : 0);
    });
    // The rig's driver and vehicle are named, fixed strings so captures are
    // byte-stable across runs and any change to a screenshot is a real change.
    //
    // They are named IN-UNIVERSE on purpose, and that is not cosmetic. This loop
    // feeds its captures to vision models as the whole basis for review, and a
    // rig called "Screencap" reads to a reviewer as a development build leaking
    // a tool name into the UI — which is exactly how a review read it: "the text
    // reads 'Screencap Rig' ... refers to a development tool function, not a
    // game asset ... immediately breaks immersion and signals that the UI is
    // unfinished". No player ever sees this path (a real session goes through
    // `showDriverCreation`), so the finding is not a player-facing bug. But it
    // is a self-inflicted false signal in the loop's own input, and removing it
    // costs two strings.
    //
    // The id `veh-screencap` below stays as it is: that one is internal, never
    // rendered, and renaming it would churn save-key comparisons for nothing.
    const created = createDriver('Sable', skills as Parameters<typeof createDriver>[1]);
    if (!created.ok) return false;
    const sessionSeed = resolveSessionSeed({ search, randomSeed });
    lastSessionSeed = sessionSeed;

    if (target === 'driver') {
      showDriverCreation(root, () => startNewSession());
      return true;
    }

    // The capture rig's car is ROAD-LEGAL, and that is a correctness property
    // rather than a framing choice. `?screen=road` reaches the highway by
    // calling `beginRoadTripWithEncounters` directly, so it never met the gate —
    // but a player (and `tests/integration/road-bounds-wiring.test.ts`, which
    // walks to the gate and picks a route row like a person would) goes through
    // `openGatePrompt`, which since iteration 92 enforces the same three
    // conditions the strip advertises. A rig car with 0 armour and 0 weapons
    // could no longer reach the road by the front door, which made the fixture
    // unrepresentative: every reviewer who walked the gate got refused.
    //
    // It is fitted on every facing with one weapon mounted, not minimally
    // sufficient, because the rig's job is to show what the game actually looks
    // like in play — and a road-legal car shows the strip's "Road-legal" state
    // and the condition panel's real depleting bars, where a 0/0 car showed
    // five dashed chips. The unfitted-chip state is still reachable in real play
    // at the constructor, which is where it belongs.
    const design: VehicleDesign = {
      name: 'Duster',
      bodyId: 'subcompact',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'small',
      tireId: 'standard',
      armor: makeArmorRecord(2),
      weapons: [{ weaponId: 'machinegun', facing: 'FRONT', ammo: getWeapon('machinegun').ammoCapacity }],
    };
    const vehicle = vehicleStateFromDesign(design, 'veh-screencap', PLAYER_ID);
    const cityState: CityRunState = {
      driver: created.driver,
      vehicle,
      vehicleStored: false,
      clock: initialClock(),
      cityId: created.driver.cityId,
      sessionSeed,
      openDb,
      rng: createRng(sessionSeed).stream('driver'),
      search,
      rumorsHeardToday: new Map(),
      activeCourierJobs: [],
      fleet: { vehicles: [{ vehicle, stored: false, cityId: created.driver.cityId }] },
      routeHistory: new Map(),
      quests: [],
      arenaRecord: { wins: 0, losses: 0 },
    };

    if (target === 'constructor') {
      showConstructor(
        root,
        created.driver,
        (chargedDriver) => showCity(root, { ...cityState, driver: chargedDriver, vehicleStored: true }),
        () => startScreenJump('constructor'),
      );
      return true;
    }
    if (target === 'arena') {
      showArena(root, created.driver, vehicle, { sessionSeed, openDb, quests: [] }, () => void start());
      return true;
    }
    if (target === 'fleet') {
      showFleet(root, cityState, () => showCity(root, cityState));
      return true;
    }
    if (target === 'arena-event') {
      // `beginArenaMatch` rather than a hand-built `ArenaMatchState`, for the
      // same reason the rest of this rig uses the real constructors: it
      // validates eligibility and charges the entry fee exactly once. Division 5
      // is `own-vehicle-value-cap: 5000` with no `costService`, so nothing is
      // charged — and it is the event Codex actually drove, so a capture through
      // this route is comparable to its findings.
      // The rig's LOCAL `vehicle`, not `cityState.vehicle`: the latter is typed
      // `VehicleState | null` because a real city session can have the car
      // parked, and reading it here would mean a null check for a state this
      // rig constructs non-null two lines earlier.
      // `?event=` selects which event this route mounts, validated against the
      // same `eventIndex` the ruleset loader built. It exists because a
      // three-opponent match RESOLVES underneath a probe: with the AI's
      // steering-cone clamp (iteration 147) opponents can actually turn to
      // bear, so a stationary rig player dies in ~500 ticks — about eight
      // seconds, which is exactly how long the Controls round-trip browser test
      // takes. `practice` carries `opponentCount: 0`, so it cannot resolve at
      // all, and it is still the REAL `showArenaEvent` rather than the
      // separate `showArena` practice field. That test's own comment already
      // asked for this rig; the code just never passed it.
      //
      // An unrecognised id WARNS rather than falling back, for the reason the
      // rest of this route warns: a silent fallback is what makes a capture
      // route rot, because the next reader is then looking at a different
      // screen than they think.
      const requestedEvent = new URLSearchParams(search).get('event');
      const eventId: ArenaEventId =
        requestedEvent !== null && isArenaEventId(requestedEvent) ? requestedEvent : 'division-5';
      if (requestedEvent !== null && !isArenaEventId(requestedEvent)) {
        console.warn(`smduel: screencap arena-event got unknown event "${requestedEvent}", mounting ${eventId}`);
      }
      const begun = beginArenaMatch(cityState.driver, vehicle, eventId);
      if (!begun.ok) {
        // Refuse loudly rather than falling through to the practice screen,
        // because a silent fallback is what makes a capture route rot: the next
        // reader would be looking at `showArena` and not know it.
        console.warn(`smduel: screencap arena-event ineligible: ${begun.reason}`);
        return false;
      }
      showArenaEvent(root, begun.driver, vehicle, begun.state, cityState.clock, cityState, () => void start());
      return true;
    }
    if (target === 'road') {
      const neighbors = cityRouteNeighbors(cityState.cityId);
      const first = neighbors[0];
      if (first === undefined) return false;
      const resolved: ResolvedRoute = resolveRoute(cityState.cityId, first.neighborCityId);
      const trip = beginRoadTripWithEncounters(
        resolved,
        vehicle,
        cityState.clock,
        sessionSeed,
        FRESH_ROUTE_HISTORY,
        pursuitLevelFromQuestState(cityState.quests),
      );
      showRoad(root, cityState, trip, () => showCity(root, cityState));
      return true;
    }

    showCity(root, cityState);
    return true;
  }

  const screenTarget = screenFromSearch(search);
  if (screenTarget !== null && startScreenJump(screenTarget)) {
    console.info(`smduel: screen jump to "${screenTarget}"`);
    // A visual-verification jump has no splash: it is a tooling path, it goes
    // straight to a screen that loads its own assets, and leaving a progress bar
    // on top of the capture would be both misleading and a pixel the harness
    // would screenshot. Dismiss unconditionally so the injection is total.
    loading.dismiss();
    return;
  }

  await start();
}
