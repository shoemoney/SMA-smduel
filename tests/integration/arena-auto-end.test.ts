// @vitest-environment happy-dom
/**
 * Before this pass, `showArenaEvent`'s ONLY resolution path was the exit
 * button's click handler — nothing reacted to the match state going
 * terminal, so a player who cleared amateur-night's roster or got destroyed
 * sat in a dead arena with no prompt (winning) or no way forward (dying),
 * unless they happened to click a button labeled "Exit to Title" that
 * actually returns to the city.
 *
 * This suite drives the REAL `showArenaEvent` — never a sim-level shortcut —
 * through `@/app`'s own `boot()`, real DOM `KeyboardEvent`/click dispatch,
 * and the real city -> arena-building navigation, exactly the pattern
 * `tests/integration/screens.test.ts` established for DOM acceptance gates.
 * `window.requestAnimationFrame` is captured (never auto-scheduled) so every
 * tick this file drives is deterministic and instant.
 *
 * Reaching a real amateur-night WIN or DEATH without hand-writing match
 * state means driving genuine combat: real spawns, real `decideAI`, real
 * `fire()`/`applyResolvedShot()`. `showArenaEvent` exposes no world-state to
 * a caller outside its own closure (by design — it is a screen, not a test
 * seam), so the player's own "controller" here is a FIXED, non-reactive key
 * schedule (never reads position/bearing), found the same way
 * `tests/integration/arena-victory.test.ts`'s own `AMATEUR_NIGHT_VICTORY_SEED`
 * was: sweeping session seeds against a fixed script and keeping ones where
 * the real combat RNG produces the outcome needed. `WIN_SEED`/`DEATH_SEED`
 * and the schedule constants below are that whole fixture; changing any one
 * of them changes the outcome, so none of it is "cleaned up" to rounder
 * numbers. `createArenaWorld(sessionSeed, ...)` reads only its own two
 * arguments (see its own doc comment) — no draws any OTHER stream
 * (`@/util/rng`'s own `.stream(label)` is independently derived, per that
 * function's doc comment) has made — so a `boot()` seeded with the same
 * string, entering the same house-sourced event, reproduces the exact same
 * fight `tests/integration/arena-victory.test.ts`'s own harness would.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { drivingConfig, skillsConfig } from '@/data/rulesets';
import { generateCityLayout } from '@/sim/city';
import { beginArenaMatch, getArenaEvent, houseLoanerDesign, type ArenaEventId } from '@/sim/arena';
import { createArenaAutopilot } from '@/sim/arena-autopilot';
import { createDriver } from '@/sim/driver';
import {
  PLAYER_ID,
  freshCityRunState,
  showArenaEvent,
  vehicleStateFromDesign,
} from '@/app';
import type { SkillName } from '@/sim/types';
import { t } from '@/ui/strings';

// ---------------------------------------------------------------------------
// requestAnimationFrame stub: capture, never auto-run (mirrors
// tests/integration/screens.test.ts's own installRafStub/stepFrame).
// ---------------------------------------------------------------------------

type Raf = (nowMs: number) => void;
let rafCallback: Raf | null = null;
let rafHandleCounter = 0;

function installRafStub(): void {
  rafCallback = null;
  rafHandleCounter = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCallback = cb as Raf;
    return ++rafHandleCounter;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {
    rafCallback = null;
  }) as typeof window.cancelAnimationFrame;
}

let simNowMs = 0;
function stepFrame(deltaMs: number): void {
  simNowMs += deltaMs;
  const cb = rafCallback;
  if (cb === null) throw new Error('test: no frame callback registered — the screen has not started its render loop yet');
  cb(simNowMs);
}

/** driving.json's own tickRateHz (60): one fixed sim tick, in wall-clock ms. */
const TICK_MS = 1000 / 60;

/**
 * Advances the arena's `loop.advance()` accumulator by exactly `n` fixed
 * ticks. `frame()`'s own dt clamp caps every call at 0.25s of simulated time
 * (15 ticks at 60Hz) regardless of the wall-clock jump handed to it — the
 * rest is silently dropped, never carried to the next call — so this chunks
 * into <=15-tick `stepFrame` calls rather than one big one. Stops early,
 * without error, once the screen has already ended the match on its own
 * (no more `requestAnimationFrame` callback registered).
 */
const MAX_TICKS_PER_FRAME = 15;
function advanceTicks(n: number): void {
  let remaining = n;
  while (remaining > 0 && rafCallback !== null) {
    const chunk = Math.min(remaining, MAX_TICKS_PER_FRAME);
    stepFrame(chunk * TICK_MS);
    remaining -= chunk;
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function dispatchKeyDown(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}
function dispatchKeyUp(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init }));
}

function requireOne(selector: string): Element {
  const found = document.querySelectorAll(selector);
  if (found.length !== 1) throw new Error(`test: expected exactly one "${selector}", found ${found.length}`);
  const el = found[0];
  if (el === undefined) throw new Error(`test: "${selector}" missing`);
  return el;
}

// ---------------------------------------------------------------------------
// Boot helper: real Title -> Driver Creation -> Constructor -> City, purely
// through dispatched DOM events — same restriction as screens.test.ts (every
// screen function here is module-private in @/app).
// ---------------------------------------------------------------------------

const CITY_ID = 'newyork'; // skillsConfig().startingLocation

async function bootToCity(root: HTMLElement, seed: string, search: string): Promise<void> {
  const { boot } = await import('@/app');

  installRafStub();
  simNowMs = 0;

  const bootPromise = boot(root, {
    search,
    randomSeed: () => seed,
    openDb: () => Promise.reject(new Error('test: no save database — always start a fresh session')),
  });
  await bootPromise;

  const titleMenu = requireOne('.sm-menu');
  dispatchKeyDown(titleMenu, { key: '1' });

  const submit = requireOne('.sm-screen--driver button');
  submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  // Default build (no weapon mounts) is legal except its empty name — same
  // as screens.test.ts's own bootToCity. amateur-night issues its own house
  // loaner regardless of what this car is, so it never needs weapons here.
  const constructorScreen = requireOne('.sm-screen--constructor');
  for (const ch of 'TestRig') dispatchKeyDown(constructorScreen, { key: ch });
  for (let i = 0; i < 40; i++) dispatchKeyDown(constructorScreen, { key: 'ArrowDown' });
  dispatchKeyDown(constructorScreen, { key: 'Enter' });

  // showCity's own initRenderer() (WebGPU probe, always unavailable under
  // happy-dom) resolves on a microtask before its .finally() registers the
  // first requestAnimationFrame callback.
  await flushMicrotasks();
  await flushMicrotasks();

  requireOne('.sm-screen--city');
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Walks the on-foot driver in a straight axis-aligned line from `from` to
 * `to`, purely via held WASD keys. City movement's own convention
 * (`@/sim/city`'s `DIRECTION_UNIT_VECTORS`, consumed via `stepWalk`'s
 * `direction` — NOT `resolveInput`'s raw moveY): 'w' is north, which is world
 * **+Y**, and 's' is south, world **-Y**. That is the opposite of what this
 * comment asserted for the game's whole life, and it is why this helper drove
 * the player the wrong way and every test using it failed once the compass was
 * fixed. World +y is screen UP because `buildOrthoMatrix` sets `m[5] = sy`
 * (positive) and WebGPU puts clip +y at the top of the frame. The X mapping
 * below is unaffected — east has always been +x — which is exactly why the
 * horizontal controls worked and only the vertical ones were broken.
 * `xFirst` picks which axis leads first — see `safeXFirst`,
 * which computes it rather than a caller guessing. A 50ms step (~0.11m at
 * `pedestrian.speedMps`) keeps the worst-case overshoot small relative to
 * `safeXFirst`'s own margins.
 */
function walkBetween(from: Point, to: Point, xFirst: boolean): void {
  const STEP_MS = 50;
  const stepDistanceM = drivingConfig().pedestrian.speedMps * (STEP_MS / 1000);

  function walkAxis(delta: number, positiveKey: KeyboardEventInit, negativeKey: KeyboardEventInit): void {
    if (delta === 0) return;
    const key = delta >= 0 ? positiveKey : negativeKey;
    const steps = Math.ceil(Math.abs(delta) / stepDistanceM);
    dispatchKeyDown(window, key);
    for (let i = 0; i < steps; i++) stepFrame(STEP_MS);
    dispatchKeyUp(window, key);
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const walkX = (): void => walkAxis(dx, { key: 'd', code: 'KeyD' }, { key: 'a', code: 'KeyA' });
  // Positive dy means increasing world y, which is NORTH, which is 'w'.
  const walkY = (): void => walkAxis(dy, { key: 'w', code: 'KeyW' }, { key: 's', code: 'KeyS' });
  if (xFirst) {
    walkX();
    walkY();
  } else {
    walkY();
    walkX();
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const along = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
  const cx = a.x + along * abx;
  const cy = a.y + along * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Picks whichever axis order (X-then-Y, or Y-then-X) keeps `from -> to`
 * farthest from every OTHER doorway/gate's own trigger circle, for the
 * given city layout — computed fresh per seed rather than hand-picked, so
 * this file never has to re-derive "which order is safe" by hand for a new
 * seed. Throws if NEITHER order clears the real interaction radius, since a
 * seed that can't route this way at all is a fixture problem, not something
 * to silently drive through anyway.
 */
function safeXFirst(sessionSeed: string, from: Point, to: Point): boolean {
  const layout = generateCityLayout(CITY_ID, sessionSeed);
  const interactionRadiusM = drivingConfig().pedestrian.interactionRadiusM;
  const hazards: Point[] = [layout.gate.position, ...layout.doorways.map((d) => d.position)].filter(
    (p) => Math.hypot(p.x - from.x, p.y - from.y) > interactionRadiusM && Math.hypot(p.x - to.x, p.y - to.y) > interactionRadiusM,
  );

  function worstDistance(xFirst: boolean): number {
    const waypoint: Point = xFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
    let worst = Infinity;
    for (const hazard of hazards) {
      worst = Math.min(worst, distanceToSegment(hazard, from, waypoint), distanceToSegment(hazard, waypoint, to));
    }
    return worst;
  }

  const xFirstMargin = worstDistance(true);
  const yFirstMargin = worstDistance(false);
  if (Math.max(xFirstMargin, yFirstMargin) <= interactionRadiusM) {
    throw new Error(`test: no safe axis order from ${JSON.stringify(from)} to ${JSON.stringify(to)} for seed "${sessionSeed}"`);
  }
  return xFirstMargin >= yFirstMargin;
}

/**
 * Walks between two ring points via the map centre rather than directly —
 * every doorway/gate sits on the SAME ring, so a straight `from -> to` leg
 * can pass close enough to a THIRD ring point that neither axis order
 * clears it (seed-dependent; not every pair of doorways has a safe direct
 * route). Relaying through the centre turns one seed-dependent leg into two
 * that are almost always safe (a run toward/away from the centre stays far
 * from every other ring point — see `safeXFirst`'s own hazard exclusion),
 * so this is what every doorway-to-doorway walk in this file uses.
 */
function walkViaOrigin(sessionSeed: string, from: Point, to: Point): void {
  const origin: Point = { x: 0, y: 0 };
  walkBetween(from, origin, safeXFirst(sessionSeed, from, origin));
  walkBetween(origin, to, safeXFirst(sessionSeed, origin, to));
}

function doorwayPosition(sessionSeed: string, facilityKind: string): Point {
  const layout = generateCityLayout(CITY_ID, sessionSeed);
  const doorway = layout.doorways.find((d) => d.facilityKind === facilityKind);
  if (doorway === undefined) throw new Error(`test: "${CITY_ID}" has no "${facilityKind}" doorway for seed "${sessionSeed}"`);
  return doorway.position;
}

function gatePosition(sessionSeed: string): Point {
  return generateCityLayout(CITY_ID, sessionSeed).gate.position;
}

/** Clicks a real rendered `.sm-menu` row by its exact label text — never a digit key, so it works regardless of the row's position. */
function clickMenuRowByLabel(label: string): void {
  const labels = Array.from(document.querySelectorAll('.sm-menu__label'));
  const match = labels.find((node) => node.textContent === label);
  if (match === undefined) throw new Error(`test: no menu row labeled "${label}"`);
  const row = match.closest('.sm-menu__item');
  if (row === null) throw new Error('test: menu row label had no parent item');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Clicks a real rendered `.sm-menu` row whose label STARTS WITH `prefix` — for rows (like salvage's "Sell {car} — ${price}") whose full text depends on values this test does not want to re-derive. */
function clickMenuRowByPrefix(prefix: string): void {
  const labels = Array.from(document.querySelectorAll('.sm-menu__label'));
  const match = labels.find((node) => node.textContent?.startsWith(prefix) === true);
  if (match === undefined) throw new Error(`test: no menu row starting with "${prefix}"`);
  const row = match.closest('.sm-menu__item');
  if (row === null) throw new Error('test: menu row label had no parent item');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** The arena screen's own exit button, found by its rendered text — `retryBtn` (the WebGPU-recovery button) never gets a label under happy-dom's always-unavailable WebGPU, so this text is unambiguous. */
function findArenaExitButton(): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll('.sm-screen--arena button')) as HTMLButtonElement[];
  const match = buttons.find((b) => b.textContent === t('ui.arena.leaveArena'));
  if (match === undefined) throw new Error('test: arena exit button not found with the expected "Leave Arena" label');
  return match;
}

const CAR_NAME = 'TestRig'; // typed into the Constructor's name field in bootToCity

async function enterArenaMenu(eventId: ArenaEventId): Promise<void> {
  clickMenuRowByLabel(t('building.arena.enter', { event: getArenaEvent(eventId).name }));
  await flushMicrotasks();
  await flushMicrotasks();
  requireOne('.sm-screen--arena');
}

/** practice's eligibility is `own-active-vehicle-affordable` — the fresh build from bootToCity already qualifies, so this walks straight from the gate. */
async function enterPracticeFromGate(sessionSeed: string): Promise<void> {
  walkViaOrigin(sessionSeed, gatePosition(sessionSeed), doorwayPosition(sessionSeed, 'arena'));
  await enterArenaMenu('practice');
}

/**
 * amateur-night's eligibility is `on-foot-under-threshold`, which refuses
 * anyone who owns an active vehicle at all (see `eligibilityFor`'s own
 * `on-foot-under-threshold` case: `vehicle !== null` is an outright refusal,
 * not a value check) — so this sells the just-built car at Salvage FIRST,
 * exactly the reachable "carless driver" path
 * `tests/integration/no-active-vehicle.test.ts` fixed, then walks on to the
 * arena from there.
 */
async function becomeCarlessThenEnterAmateurNight(sessionSeed: string): Promise<void> {
  walkViaOrigin(sessionSeed, gatePosition(sessionSeed), doorwayPosition(sessionSeed, 'salvage'));
  clickMenuRowByPrefix(`Sell ${CAR_NAME}`);
  clickMenuRowByLabel(t('building.leave'));

  // The doorway trigger is edge-triggered on the step that crosses INTO its
  // radius, not "arrived exactly at its center" — so the real position after
  // leaving Salvage is only known to be SOMEWHERE within one interaction
  // radius of the doorway, along the approach line. That uncertainty carries
  // straight through an open-loop walk (it does not shrink with distance),
  // so `safeXFirst` is what actually keeps this leg honest: it measures the
  // real margin against every OTHER doorway/gate for THIS seed's real
  // layout and throws rather than silently walking through one.
  walkViaOrigin(sessionSeed, doorwayPosition(sessionSeed, 'salvage'), doorwayPosition(sessionSeed, 'arena'));
  await enterArenaMenu('amateur-night');
}

// ---------------------------------------------------------------------------
// Direct arena mount: the REAL screen with the REAL autopilot as its input
// source.
//
// WHY THIS EXISTS ALONGSIDE THE CITY WALK ABOVE. Reaching `showArenaEvent`
// by walking the city means the match is entered through the facility chain,
// which builds its own match internally and therefore cannot be handed a test
// input source. The victory test needs one — its old fixed key schedule only
// ever won through the 90-degree body-frame bug (iterations 122-125), and the
// replacement drivers written for it structurally could not clear a roster at
// all: aiming without evading dies, evading without aiming never connects.
// So the test builds the real match with production constructors and mounts
// the real screen directly.
//
// WHAT THAT TRADES AWAY, STATED PLAINLY: this test no longer walks the city.
// The loss test beside it still does, on every run, through the real gate and
// the real carless path, so the entry chain keeps its coverage — a victory test
// and a loss test cannot both be the only proof of the same walk.
// ---------------------------------------------------------------------------

const ARENA_EVENT_ID = 'amateur-night';

/**
 * A seed `tests/integration/arena-victory.test.ts` already swept for THIS
 * exact event with THIS exact autopilot clearing the roster, and that file is
 * the authority on the number rather than this one: it measured 57.3% over 40
 * seeds with the same bot. Copying a proven value out of the file that
 * established it is the alternative to re-sweeping it here, and this test
 * deliberately asserts no property of that seed — a different winning seed
 * would satisfy every assertion below just as well.
 */
const AMATEUR_NIGHT_VICTORY_SEED = 'sweep-seed-500';

/**
 * A marksman-heavy split, DERIVED from the ruleset rather than typed.
 *
 * `skills.json` states the pool (50) and the per-skill clamp (0..99), and
 * `createDriver` refuses anything that does not satisfy both — so the numbers
 * here are computed, not recalled, and a future pool or cap change cannot
 * quietly make the fixture illegal. This exists because the sibling test's own
 * split is a deliberate choice with a long comment explaining why an even one
 * lost to better-armed opponents, and copying that reasoning from a type would
 * be the fixture-from-memory trap `AGENTS.md` is written about.
 */
function arenaTestSkills(): Record<SkillName, number> {
  const cfg = skillsConfig();
  const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
  const skills = {} as Record<SkillName, number>;
  for (const name of cfg.skills) skills[name] = base;
  // Everything that is not marksmanship moves into marksmanship, within the
  // ruleset's own clamp, so the total still equals `startingSkillPool`.
  let spare = cfg.startingSkillPool - base * cfg.skills.length;
  for (const name of cfg.skills) {
    if (name === 'marksmanship') continue;
    const take = Math.min(spare, cfg.skillMax - skills[name]);
    skills[name] += take;
    spare -= take;
  }
  skills.marksmanship = Math.min(cfg.skillMax, skills.marksmanship + spare);
  return skills;
}

/**
 * Mounts the real arena screen over a freshly built amateur-night match and
 * drives its input from the production autopilot.
 *
 * The autopilot is built ONCE and memoized, and that is load-bearing rather
 * than tidier: `createArenaAutopilot` holds a sticky target lock in closure
 * state, so constructing it inside the per-tick override would hand back a
 * brand-new driver on every sample and the car would never stop re-acquiring —
 * which reads as "the autopilot cannot aim" rather than as the bug it is. The
 * first sample is what has a world to lock a target from.
 */
function mountAmateurNightWithAutopilot(root: HTMLElement, sessionSeed: string): void {
  const skillResult = createDriver('Arena Tester', arenaTestSkills());
  if (!skillResult.ok) throw new Error(`test fixture: expected a legal skill split, got "${skillResult.reason}"`);
  const driver = skillResult.driver;

  // `null` vehicle: amateur-night is entered on foot (see
  // `eligibilityFor`'s `on-foot-under-threshold` case), so eligibility has
  // nothing to check — the same argument `showArenaEvent` passes itself.
  const matchResult = beginArenaMatch(driver, null, ARENA_EVENT_ID);
  if (!matchResult.ok) {
    throw new Error(`test fixture: expected ${ARENA_EVENT_ID} to be enterable, got "${matchResult.reason}"`);
  }

  // The REAL loaner `showArenaEvent` hands a carless entrant, not the
  // opponents' kart — the same distinction arena-victory.test.ts made when
  // amateur-night proved unplayable the other way.
  const playerVehicle = vehicleStateFromDesign(houseLoanerDesign(), 'veh-player', PLAYER_ID);
  const cityState = freshCityRunState(driver, playerVehicle, {
    sessionSeed,
    openDb: () => Promise.reject(new Error('test: no save database')),
    // `endMatch` only mounts the score-submit screen when
    // `arcadeScoringEnabled` is true, and that reads `cityState.search` for
    // `arcade=1` (`@/arcade/client`) — the same `BootOptions.search` the city
    // walk passed through. Without it the match resolves into `onComplete`
    // instead and the screen this whole test exists to assert never appears,
    // which looks exactly like "the roster did not clear".
    search: 'arcade=1',
  });

  let autopilot: ReturnType<typeof createArenaAutopilot> | null = null;
  showArenaEvent(
    root,
    matchResult.driver,
    playerVehicle,
    matchResult.state,
    cityState.clock,
    cityState,
    () => {},
    (world) => {
      autopilot ??= createArenaAutopilot(world, playerVehicle.id, 'competent');
      return autopilot.sample();
    },
  );
}

// ---------------------------------------------------------------------------
// Combat script: a FIXED, non-reactive key schedule (see the file header).
// Neither schedule below ever steers: `showArenaEvent` exposes no world
// state to react to, and a steering schedule was tried first (found offline
// the same way `tests/integration/arena-victory.test.ts`'s own seeds were —
// sweeping candidates against a fixed script) but never reproduced its
// offline outcome through this file's real DOM harness. The reason: driving
// physics' own control-loss mechanic (`@/sim/driving`'s `rollControlCheck`)
// only draws its own random check once accumulated turning stress crosses a
// threshold, so ANY steering schedule leaves the fight's own RNG stream
// position sensitive to exactly when that happens — a real, reproducible
// source of drift between this harness and a plain sim-level replay loop.
// Holding still (heading frozen at spawn, so that stress accumulator can
// never start) sidesteps the whole mechanic and reproduces perfectly.
// ---------------------------------------------------------------------------

const FIRE_KEY: KeyboardEventInit = { key: 'j', code: 'KeyJ' };
function digitKey(slot: number): KeyboardEventInit {
  return { key: String(slot + 1), code: `Digit${slot + 1}` };
}

interface CombatFrame {
  readonly fire: boolean;
  readonly weaponDigit: number | null;
}

function sameFrame(a: CombatFrame, b: CombatFrame): boolean {
  return a.fire === b.fire && a.weaponDigit === b.weaponDigit;
}

/** Session seed found (offline sweep) where standing still and cycling mounts CLEARS amateur-night's real 5-opponent roster. */
const WIN_SEED = 'still-seed-2331';
const WEAPON_TICKS = 90;

function winScheduleAt(tick: number): CombatFrame {
  return { fire: true, weaponDigit: Math.floor(tick / WEAPON_TICKS) % 4 };
}

/**
 * A session seed MEASURED (not swept) under the rotated body frame, on which a
 * driver who never moves and never fires is destroyed by amateur-night's real
 * roster: player destroyed at tick 2863, `endMatch` at 2939.
 *
 * It replaces a swept seed whose documented death tick was 347, because the
 * rotation invalidated it — the same "the premise was a property of the bug"
 * finding that retired `WIN_SEED`. Re-picking a seed by sweeping for a property
 * the bug used to supply is how the old one got there in the first place, so
 * this one is a number that was read off a run.
 */
const DEATH_SEED = 'sweep-loss-1';
function passiveScheduleAt(): CombatFrame {
  return { fire: false, weaponDigit: null };
}

function applyCombatFrame(frame: CombatFrame, previous: CombatFrame | null): void {
  if (previous === null || previous.fire !== frame.fire) {
    if (frame.fire) dispatchKeyDown(window, FIRE_KEY);
    else dispatchKeyUp(window, FIRE_KEY);
  }
  if (previous !== null && previous.weaponDigit !== null && previous.weaponDigit !== frame.weaponDigit) {
    dispatchKeyUp(window, digitKey(previous.weaponDigit));
  }
  if (frame.weaponDigit !== null && (previous === null || previous.weaponDigit !== frame.weaponDigit)) {
    dispatchKeyDown(window, digitKey(frame.weaponDigit));
  }
}

/** Drives a fixed schedule tick-by-tick (run-length coalesced), advanceable in stages so a test can inspect mid-fight state. */
function makeCombatDriver(scheduleAt: (tick: number) => CombatFrame): { advanceTo(targetTick: number): void } {
  let previous: CombatFrame | null = null;
  let tick = 0;
  return {
    // Stops early, without error, once the screen itself has already ended
    // the match (no more `requestAnimationFrame` callback registered) —
    // legitimate whenever the terminal condition resolves partway through
    // an in-progress advance, not just at a caller-chosen boundary.
    advanceTo(targetTick: number): void {
      while (tick < targetTick && rafCallback !== null) {
        const frame = scheduleAt(tick);
        if (previous === null || !sameFrame(frame, previous)) applyCombatFrame(frame, previous);
        let runLength = 1;
        while (tick + runLength < targetTick && sameFrame(scheduleAt(tick + runLength), frame)) runLength++;
        advanceTicks(runLength);
        tick += runLength;
        previous = frame;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('showArenaEvent: the match ends itself', () => {
  let root: HTMLElement;
  let originalRaf: typeof window.requestAnimationFrame;
  let originalCancelRaf: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
  });

  it('a zero-opponent event (practice) never auto-ends on its own, and its exit button — relabeled "Leave Arena" — still resolves a manual exit', async () => {
    await bootToCity(root, 'practice-guard-seed', '');
    await enterPracticeFromGate('practice-guard-seed');

    // `allOpponentsDefeated` reads 0 >= 0 as vacuously true for practice's
    // empty roster (see that function's own doc comment) — without the
    // `opponentsTotal > 0` guard in `terminalExitMode`, practice would
    // auto-end itself the instant it started. Run many ticks and prove it
    // does not.
    advanceTicks(600);
    requireOne('.sm-screen--arena');

    const exitBtn = findArenaExitButton();
    expect(exitBtn.textContent).toBe('Leave Arena');
    exitBtn.click();

    requireOne('.sm-screen--city');
    expect(document.querySelector('.sm-screen--arcade-submit')).toBeNull();
  });

  it('clears destroyed opponents off the radar, and the contact count only ever falls', async () => {
    // Found by Codex `gpt-6.1-sol` driving the live arena: after "Opponent
    // destroyed — 2 left" the radar still showed three orange hostile markers.
    //
    // The mechanism is that `makeArenaDamageSystem` deliberately does NOT prune
    // the `opponents` map — the roster IS the win condition and
    // `resolveArenaExit` needs it intact — so "is this id an opponent" is not
    // the same question as "is this vehicle still a threat". The ROAD's
    // sibling system deletes the entry, which is what made the radar look
    // correct by inspection on exactly one of the two screens sharing it.
    await bootToCity(root, WIN_SEED, 'arcade=1');
    await becomeCarlessThenEnterAmateurNight(WIN_SEED);

    const hostileContacts = (): number => document.querySelectorAll('.hud-radar-contact--hostile').length;

    const driver = makeCombatDriver(winScheduleAt);
    // The baseline is read AFTER a few ticks, because the HUD is painted from
    // inside `frame()` and there is no radar at all on the frame the screen
    // mounts. Capturing at mount read 0 contacts and made the first sample look
    // like four contacts had APPEARED — the third time in two rounds that a
    // reading taken before the first frame produced a confident wrong answer
    // about this HUD (iterations 111 and 112 both hit it in this file).
    driver.advanceTo(5);
    const initial = hostileContacts();
    // Staged, because the match resolving unmounts the arena and takes the radar
    // with it — the invariant is only observable mid-fight. Stage boundaries are
    // deliberately NOT this seed's kill ticks, which are a property of its RNG.
    const counts: number[] = [initial];
    for (const stage of [200, 400, 600, 800, 1000]) {
      driver.advanceTo(stage);
      counts.push(hostileContacts());
    }

    // A dead opponent leaving the radar is a DECREASE, and nothing else in this
    // match can add a contact, so the count is monotonically non-increasing.
    // Asserting the exact number each stage would need the roster as an oracle,
    // and the two obvious oracles are both unsound: the `.hud-message` feed
    // COALESCES repeated lines into "Machine Gun fired x7" and ROTATES, so the
    // "Opponent destroyed - N left" line had already scrolled away by the second
    // sample; and a hardcoded roster size is a second derivation of the event's
    // own data. Two versions of this test failed on exactly those, reporting a
    // correct radar as wrong — the log's own "a probe that finds the wrong thing
    // is worse than one that finds nothing", reached from the other direction.
    for (let i = 1; i < counts.length; i++) {
      expect(
        counts[i],
        `radar contacts rose from ${counts[i - 1]} to ${counts[i]} at sample ${i}; a kill must only ever remove one`,
      ).toBeLessThanOrEqual(counts[i - 1] ?? 0);
    }

    // AND THE SIGNAL MUST HAVE MOVED. Without this the monotonicity above is
    // satisfied by a radar that never cleared anything — e.g. if the seed
    // resolved early, or the schedule killed nothing, every assertion would pass
    // while proving nothing. This is what makes the rest mean something.
    const last = counts[counts.length - 1] ?? initial;
    expect(
      last,
      `radar contacts never fell below ${initial}, so no destroyed opponent was ever observed and the run proved nothing`,
    ).toBeLessThan(initial);
  });

  it('clearing amateur-night\'s real roster ends the match automatically and shows the score submit screen, with no click — and a stale click afterward cannot resolve it twice', async () => {
    // The arena's WebGPU probe resolves on a microtask before its `.finally()`
    // registers the first frame, exactly as in `bootToCity`.
    installRafStub();
    simNowMs = 0;
    mountAmateurNightWithAutopilot(root, AMATEUR_NIGHT_VICTORY_SEED);
    await flushMicrotasks();
    await flushMicrotasks();

    // Captured BEFORE the match resolves, and never re-queried — a real
    // player's device could still deliver a queued click to this exact node
    // after the screen has already moved on.
    const staleExitBtn = findArenaExitButton();

    // The autopilot is the sim's own competent bot, and
    // `arena-victory.test.ts` already measures it clearing this exact roster
    // at 57.3% over 40 seeds, so no seed search is involved here: this
    // asserts the SCREEN's resolution path, not that the fight is winnable.
    // 3000 ticks is comfortably past the measured win tick plus the full
    // `arenaOutcomeDelayMs` beat, and `advanceTicks` stops on its own once the
    // match resolves, so overshooting is harmless.
    advanceTicks(3000);

    expect(document.querySelectorAll('.sm-screen--arena').length).toBe(0);
    expect(document.querySelectorAll('.sm-screen--arcade-submit').length).toBe(1);

    // A second `endMatch` would remount `showArcadeScoreSubmit` — same
    // visible outcome (still exactly one `.sm-screen--arcade-submit`, since
    // `clearAndAppend` replaces rather than duplicates), but a NEW DOM node,
    // discarding whatever the player had already typed into the name field.
    // Editing it, then proving the SAME node is still connected after the
    // stale click, catches a double-resolution a plain element count cannot.
    const nameInput = document.querySelector('.sm-screen--arcade-submit input') as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    nameInput.value = 'EDITED-BY-TEST';

    staleExitBtn.click();

    expect(nameInput.isConnected).toBe(true);
    expect(nameInput.value).toBe('EDITED-BY-TEST');
    expect(document.querySelectorAll('.sm-screen--arcade-submit').length).toBe(1);
  });

  it('the player dying in amateur-night ends the match automatically with the loss resolved, no click — and a stale click afterward cannot re-trigger it', async () => {
    await bootToCity(root, DEATH_SEED, 'arcade=1');
    await becomeCarlessThenEnterAmateurNight(DEATH_SEED);

    const staleExitBtn = findArenaExitButton();

    const driver = makeCombatDriver(passiveScheduleAt);
    // Measured under the ROTATED body frame, on this seed: the player is
    // destroyed at tick 2863 and `endMatch` runs at 2939, the 76-tick
    // `arenaOutcomeDelayMs` beat after it.
    //
    // It used to be 347. That is not a tuning change anyone made — it is the
    // collider rotation showing up as balance. Before the body-frame fix the
    // player's collider measured its LENGTH along the aim axis, so opponents
    // firing along their own mounts met a 4.8m target; they now fire along the
    // nose and meet a 1.8m one, so glancing shots miss and the fight runs
    // about eight times longer. The 90-degree bug was not what was killing a
    // passive player; a fat collider was, and correcting it is what made the
    // honest number 2863.
    //
    // A MID-BEAT checkpoint is kept because "the arena is still up" is a
    // distinct claim from "the arena eventually goes away" — without it, a
    // screen that unmounts on frame 1 satisfies the same assertion.
    driver.advanceTo(1000);
    requireOne('.sm-screen--arena');

    // Past the death tick and the full outcome delay.
    driver.advanceTo(3400);

    expect(document.querySelectorAll('.sm-screen--arena').length).toBe(0);
    // A loss is never an arcade submission (shouldSubmitArcadeScore requires
    // VICTORY) even with arcade scoring enabled.
    expect(document.querySelectorAll('.sm-screen--arcade-submit').length).toBe(0);
    const cityScreen = requireOne('.sm-screen--city');

    // A second `endMatch` would remount `showCity` via `onComplete` — the
    // element count looks identical either way (still exactly one
    // `.sm-screen--city`), so the real proof is that THIS SAME node is
    // still the one in the document afterward, not a fresh replacement.
    staleExitBtn.click();

    expect(cityScreen.isConnected).toBe(true);
    requireOne('.sm-screen--city');
    expect(document.querySelectorAll('.sm-screen--arcade-submit').length).toBe(0);
  });
});

/**
 * The pause menu, and the freeze it promises.
 *
 * Found by Codex `gpt-6.1-sol` driving the live arena: "Escape does not pause
 * combat. In Division 5, after pressing Escape, the car accelerated from 5 to
 * 25 mph over two seconds, and all three opponents changed position on the
 * radar. P also opened no menu." Its remedy was "an Escape/P pause menu with
 * Resume, Controls, and Withdraw" that freezes "driving, AI, projectiles,
 * damage, cooldowns, and match resolution together".
 *
 * THE SIGNAL IS THE REVIEWER'S OWN MEASUREMENT, and that matters more than it
 * sounds. The car accelerating from 5 to 25 mph is a claim about a CONTINUOUS
 * value, so the guard reads a continuous value: the speed dial's inline
 * `--hud-speed-frac`, which `renderHudFrame` rewrites every frame from
 * `mph / maxTopSpeedMph`.
 *
 * **THE CONTROL IS THE POINT, AND IT IS WHAT ITERATION 100'S PAUSE TEST
 * LACKED.** A frozen number is only evidence if the same number is shown
 * MOVING when the thing under test is not engaged — otherwise "unchanged" is
 * indistinguishable from "saturated", which is exactly the trap that made
 * iteration 100's first live verification vacuous (the odometer read flat
 * because progress stops advancing off-axis). So every assertion here is a
 * triple: it climbs while driving, it holds while paused, and it climbs again
 * after resuming. Removing any one of those three would let a broken freeze
 * pass for a working one.
 */
describe('showArenaEvent: the match can be paused', () => {
  let root: HTMLElement;
  let originalRaf: typeof window.requestAnimationFrame;
  let originalCancelRaf: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
  });

  /** The dial's continuous speed fraction, read off the inline custom property. */
  function speedFrac(): number {
    const dial = requireOne('.hud-speed-dial') as HTMLElement;
    const raw = dial.style.getPropertyValue('--hud-speed-frac');
    const n = Number.parseFloat(raw);
    if (Number.isNaN(n)) throw new Error(`speed dial has no readable --hud-speed-frac (got "${raw}")`);
    return n;
  }

  function holdThrottleFor(milliseconds: number): void {
    dispatchKeyDown(window, { key: 'w', code: 'KeyW' });
    advanceTicks(Math.round(milliseconds / TICK_MS));
    dispatchKeyUp(window, { key: 'w', code: 'KeyW' });
    advanceTicks(2);
  }

  it('freezes driving while paused, and resumes it afterwards', async () => {
    await bootToCity(root, 'practice-guard-seed', '');
    await enterPracticeFromGate('practice-guard-seed');

    advanceTicks(20);
    // --- CONTROL: the signal must MOVE, or "frozen" proves nothing. ---
    const atRest = speedFrac();
    holdThrottleFor(1500);
    const whileDriving = speedFrac();
    expect(
      whileDriving,
      `the speed dial never left ${atRest.toFixed(3)} while holding throttle, so a later "frozen" reading would be meaningless`,
    ).toBeGreaterThan(atRest + 0.01);

    dispatchKeyDown(window, { key: 'Escape' });
    await flushMicrotasks();

    // --- PAUSED: the menu is up and the dial is held. ---
    const labels = [...document.querySelectorAll('.sm-menu__item')].map((i) => (i.textContent ?? '').trim());
    expect(labels.join('|'), 'the pause menu should offer Resume, Controls and Leave Arena').toMatch(/Resume/i);
    expect(labels.join('|')).toMatch(/Controls/i);
    expect(labels.join('|')).toMatch(/Leave Arena/i);

    // Throttle HELD THROUGH the pause: the codes were cleared when the menu
    // opened, so nothing should accelerate, and nothing should coast either.
    dispatchKeyDown(window, { key: 'w', code: 'KeyW' });
    advanceTicks(90); // ~1.5s of simulated time the player must not get
    dispatchKeyUp(window, { key: 'w', code: 'KeyW' });
    advanceTicks(30);
    const whilePaused = speedFrac();
    expect(
      Math.abs(whilePaused - whileDriving),
      `the car moved from ${whileDriving.toFixed(3)} to ${whilePaused.toFixed(3)} while paused`,
    ).toBeLessThan(0.005);

    // --- RESUME: the same signal must move again. ---
    //
    // Dispatched to the MENU, not to `window`, and that asymmetry is the whole
    // shape of iteration 100's bug. `mountMenu` focuses its container and
    // therefore owns the keyboard while it is open, so a real Escape is handled
    // by the menu's own BACK — which is what sets `menuHandledKey` and closes it.
    // Dispatching at `window` bypasses the container entirely, so the menu never
    // sees it, `menuHandledKey` stays false, the window handler finds `paused`
    // still true and returns — and the menu cannot be closed at all. That is
    // exactly the failure `menuHandledKey` exists to make impossible, and the
    // first version of this test reproduced it precisely.
    dispatchKeyDown(requireOne('.sm-menu-root'), { key: 'Escape' });
    await flushMicrotasks();
    holdThrottleFor(1500);
    const afterResume = speedFrac();
    expect(
      afterResume,
      `the dial stayed at ${afterResume.toFixed(3)} after resuming; the freeze gate never released`,
    ).toBeGreaterThan(whilePaused + 0.01);
  });

  it('returns from Controls to a LIVE match, not an already-paused one', async () => {
    // The practice event, deliberately. Its eligibility aside, it is the one
    // event with ZERO opponents, and `tests/integration/arena-auto-end.test.ts`
    // already proves it never auto-ends on its own — which makes it the only
    // arena in this file whose mid-match state can be observed at a known time.
    // Every attempt to observe this round trip on amateur-night failed for one
    // reason: Division 5 legitimately resolves within the probe's drive, so the
    // "before" reading was taken on a finished match and the "after" reading on
    // the title screen. The rig was the problem, not the fix.
    await bootToCity(root, 'roundtrip-seed', '');
    await enterPracticeFromGate('roundtrip-seed');
    advanceTicks(20);
    holdThrottleFor(1200);

    dispatchKeyDown(window, { key: 'Escape' });
    await flushMicrotasks();
    clickMenuRowByLabel(t('ui.arena.menuControls'));
    await flushMicrotasks();
    await flushMicrotasks();
    requireOne('.sm-screen--controls');

    // Back out of Controls. Dispatched at the controls MENU, because that menu
    // owns the keyboard while it is mounted and this is its own BACK.
    dispatchKeyDown(requireOne('.sm-menu-root'), { key: 'Escape' });
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    requireOne('.sm-screen--arena');
    // THE BUG. The Escape above mounts this arena synchronously, and the arena
    // attached its own pause listener synchronously too — so that same Escape
    // was still propagating and landed on the screen it had just built. The
    // player pressed Escape once to leave a settings menu and returned to an
    // already-paused match: menu up, frame loop short-circuiting on
    // `if (paused)`, HUD never painted, odometer dead. No error, no clue on
    // screen. Asserting the menu is absent is the direct statement of that.
    expect(
      document.querySelectorAll('.sm-screen--arena .sm-menu-root').length,
      'Controls round trip came back to a paused arena — the Escape that mounted it re-paused it',
    ).toBe(0);

    // The HUD is only painted from inside `frame()`, so it cannot exist until a
    // real frame runs. Its absence before that is not a defect.
    advanceTicks(2);
    const returned = speedFrac();
    // CONTROL: the signal must be able to MOVE, or the rest proves nothing.
    holdThrottleFor(1200);
    const afterReturn = speedFrac();
    expect(
      afterReturn,
      `the car stayed at ${afterReturn.toFixed(3)} after returning from Controls; the match did not resume`,
    ).toBeGreaterThan(returned + 0.01);
  });
});
