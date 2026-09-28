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

import { drivingConfig } from '@/data/rulesets';
import { generateCityLayout } from '@/sim/city';
import { getArenaEvent, type ArenaEventId } from '@/sim/arena';
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
 * `direction` — NOT `resolveInput`'s raw moveY): 'w' is north (-Y), 's' is
 * south (+Y). `xFirst` picks which axis leads first — see `safeXFirst`,
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
  const walkY = (): void => walkAxis(dy, { key: 's', code: 'KeyS' }, { key: 'w', code: 'KeyW' });
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

/** Session seed found (offline sweep) where a driver who never moves and never fires is destroyed by amateur-night's real roster. */
const DEATH_SEED = 'loss-seed-23';
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

  it('clearing amateur-night\'s real roster ends the match automatically and shows the score submit screen, with no click — and a stale click afterward cannot resolve it twice', async () => {
    await bootToCity(root, WIN_SEED, 'arcade=1');
    await becomeCarlessThenEnterAmateurNight(WIN_SEED);

    // Captured BEFORE the match resolves, and never re-queried — a real
    // player's device could still deliver a queued click to this exact node
    // after the screen has already moved on.
    const staleExitBtn = findArenaExitButton();

    const driver = makeCombatDriver(winScheduleAt);
    // Comfortably past the offline-measured win tick (1102) plus the full
    // arenaOutcomeDelayMs beat (1200ms = 72 ticks). `advanceTo` stops on its
    // own once the match resolves, so overshooting this is harmless.
    driver.advanceTo(3000);

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
    // Offline-measured death tick is 347; stop short of the outcome delay
    // (72 ticks) to prove the screen is still live mid-beat.
    driver.advanceTo(380);
    requireOne('.sm-screen--arena');

    // Past the full delay now.
    driver.advanceTo(500);

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
