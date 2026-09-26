// @vitest-environment happy-dom
/**
 * DOM acceptance gate: every other test in this repo drives `@/app` at the
 * sim/exported-function level (`tests/integration/boot.test.ts`'s own header
 * says as much) — none of them mounts a screen and presses a key on it.
 * That gap is exactly what let both of these lines vanish from `showCity`/
 * `showRoad` with the suite still fully green:
 *
 *   if ((ev.key === 'f' || ev.key === 'F') && !paused) openFleetScreen();
 *   if (ev.key === 'x' || ev.key === 'X') trySearchWreck();
 *
 * This file boots the REAL app (`@/app`'s `boot()`) into a real
 * `happy-dom` document, drives it through Title -> Driver Creation ->
 * Constructor -> City purely via dispatched `KeyboardEvent`/click events
 * (never by calling an internal, unexported screen function directly),
 * walks the on-foot player through the city's real gate trigger to reach
 * the Road screen, and then dispatches the two fixed hotkeys at `window`
 * exactly as a player's browser would. The `@vitest-environment happy-dom`
 * docblock at the very top of this file is what gives ONLY this file a
 * DOM — every other suite keeps reading `vite.config.ts`'s own
 * `environment: 'node'`, unchanged.
 *
 * `window.requestAnimationFrame` is stubbed to CAPTURE each screen's frame
 * callback instead of auto-scheduling it (`stepFrame` below invokes it by
 * hand with a controlled `nowMs`) — every tick this file drives is
 * deterministic and instant, no real wall-clock waiting, no flakiness from
 * a throttled polyfill.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { skillsConfig } from '@/data/rulesets';
import { generateCityLayout } from '@/sim/city';

// ---------------------------------------------------------------------------
// requestAnimationFrame stub: capture, never auto-run
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

/** Invokes whatever screen's frame callback is currently registered, advancing its internal clock by `deltaMs` (default 250ms — `frame()`'s own dt clamp in `@/app` is 0.25s, so this is the largest single step every screen already treats as one real tick). */
let simNowMs = 0;
function stepFrame(deltaMs = 250): void {
  simNowMs += deltaMs;
  const cb = rafCallback;
  if (cb === null) throw new Error('test: no frame callback registered — the screen has not started its render loop yet');
  cb(simNowMs);
}

/** Lets any pending microtasks (an in-flight `initRenderer()` promise chain, in particular) settle before the next synchronous step — real time, not `vi.useFakeTimers()`, since this is the one thing this file does NOT want to control down to the millisecond. */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function dispatchKey(target: EventTarget, init: KeyboardEventInit): void {
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
// through dispatched DOM events (no internal screen function called
// directly — `showTitle`/`showDriverCreation`/`showConstructor`/`showCity`/
// `showRoad` are all module-private in `@/app`, by design; this is the only
// way in).
// ---------------------------------------------------------------------------

const TEST_SEED = 'screens-test-seed-1';

async function bootToCity(root: HTMLElement): Promise<void> {
  const { boot } = await import('@/app');

  installRafStub();
  simNowMs = 0;

  const bootPromise = boot(root, {
    search: '',
    randomSeed: () => TEST_SEED,
    openDb: () => Promise.reject(new Error('test: no save database — always start a fresh session')),
  });
  await bootPromise;

  // --- Title: digit '1' activates the first eligible action. With no save
  // to resume (openDb always rejects above), that's 'new-driver'. ---
  const titleMenu = requireOne('.sm-menu');
  dispatchKey(titleMenu, { key: '1' });

  // --- Driver creation: the form's own defaults (name "Driver", an even
  // skill split summing to exactly `startingSkillPool`) are already legal —
  // `tests/integration/boot.test.ts`'s own `confirmDefaultBuild`/driver
  // fixtures prove the same "shipped defaults are legal" invariant this
  // relies on. Just submit. ---
  const submit = requireOne('.sm-screen--driver button');
  submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  // --- Constructor: default builder state (first body/chassis/suspension/
  // plant/tire, no weapons, no armor) is legal EXCEPT its name, which
  // starts empty (`@/ui/builder`'s own `computeViolations`: `NAME_EMPTY`)
  // — type one onto the selected (default-selected, index 0) Name row,
  // same as a player typing character keys, then move down to the
  // 'confirm' row (`ArrowDown`, clamped at the last row so a generous,
  // deliberately-overshooting count of presses is safe regardless of
  // exactly how many rows this build has) and press Enter, exactly what a
  // player's Enter key does there. ---
  const constructorScreen = requireOne('.sm-screen--constructor');
  for (const ch of 'TestRig') dispatchKey(constructorScreen, { key: ch });
  for (let i = 0; i < 40; i++) dispatchKey(constructorScreen, { key: 'ArrowDown' });
  dispatchKey(constructorScreen, { key: 'Enter' });

  // showCity's own initRenderer() (WebGPU probe, always unavailable under
  // happy-dom -> falls back to text status) resolves on a microtask before
  // its `.finally()` registers the first requestAnimationFrame callback.
  await flushMicrotasks();
  await flushMicrotasks();

  requireOne('.sm-screen--city');
}

describe('DOM screens: the two fixed hotkeys a removed `if` cannot fake passing', () => {
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
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 'F' opens the fleet screen
  // -------------------------------------------------------------------------

  it('pressing "f" on the city screen opens the fleet screen', async () => {
    await bootToCity(root);

    expect(document.querySelector('.sm-screen--fleet')).toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));

    expect(document.querySelector('.sm-screen--fleet')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // A key with no binding does nothing
  // -------------------------------------------------------------------------

  it('a key with no binding at all does nothing on the city screen', async () => {
    await bootToCity(root);

    // 'p'/KeyP is not `driveUp/Down/Left/Right`, not `fire`, not a weapon
    // digit, and not 'f'/'g' — no binding anywhere in `rulesets/classic/
    // controls.json` or `@/app`'s own fixed hotkeys reads it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }));

    expect(document.querySelector('.sm-screen--fleet')).toBeNull();
    expect(document.querySelector('.sm-screen--city')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // 'X' attempts a wreck search on the road screen
  // -------------------------------------------------------------------------

  it('pressing "x" on the road screen attempts a wreck search', async () => {
    await bootToCity(root);

    // --- Walk the on-foot player through the real gate trigger: the
    // player spawns exactly ON the gate (`showCity`'s own
    // `layout.gate.position`), so the FIRST step must walk away from it
    // (edge-triggered — starting inside the interaction radius never
    // fires) before walking back triggers it. "Away" is picked as the
    // real `@/app`'s own `cityDirectionFromVector` would classify the
    // vector pointing from the gate toward the map centre, so the walk
    // never runs into `stepWalk`'s `clampToCityWalls` (moving toward the
    // centre only ever shrinks the distance from it, never re-triggers a
    // wall clamp) — the return leg then retraces the exact same line back
    // outward, at the exact same speed, and is guaranteed to cross back
    // within the gate's interaction radius while heading toward it. ---
    const cityId = skillsConfig().startingLocation;
    const layout = generateCityLayout(cityId, TEST_SEED);
    const gate = layout.gate.position;

    const inwardKeys: KeyboardEventInit[] = [];
    if (-gate.x > 0) inwardKeys.push({ key: 'd', code: 'KeyD' });
    else if (-gate.x < 0) inwardKeys.push({ key: 'a', code: 'KeyA' });
    if (gate.y > 0) inwardKeys.push({ key: 'w', code: 'KeyW' });
    else if (gate.y < 0) inwardKeys.push({ key: 's', code: 'KeyS' });
    expect(inwardKeys.length).toBeGreaterThan(0);

    const outwardKeys: KeyboardEventInit[] = inwardKeys.map((k) => {
      if (k.code === 'KeyD') return { key: 'a', code: 'KeyA' };
      if (k.code === 'KeyA') return { key: 'd', code: 'KeyD' };
      if (k.code === 'KeyW') return { key: 's', code: 'KeyS' };
      return { key: 'w', code: 'KeyW' };
    });

    const STEPS_PER_LEG = 15;

    for (const k of inwardKeys) window.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
    for (let i = 0; i < STEPS_PER_LEG; i++) stepFrame();
    for (const k of inwardKeys) dispatchKeyUp(window, k);

    // Still walking (no gate/facility trigger from moving inward, away
    // from every trigger circle on the ring).
    expect(document.querySelector('.sm-menu')).toBeNull();

    for (const k of outwardKeys) window.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
    for (let i = 0; i < STEPS_PER_LEG; i++) stepFrame();
    for (const k of outwardKeys) dispatchKeyUp(window, k);

    // The gate trigger fired: `openGatePrompt()` paused the city loop and
    // mounted a real route-choice menu.
    const routeMenu = requireOne('.sm-menu');
    dispatchKey(routeMenu, { key: '1' });

    // showRoad's own initRenderer() microtask, same as showCity's.
    await flushMicrotasks();
    await flushMicrotasks();

    requireOne('.sm-screen--road');

    // `trySearchWreck()`'s `nearbySearchableWreck()` unconditionally calls
    // `wreckSearchRangeM()` (-> `drivingConfig()`) before it ever looks at
    // whether a wreck is actually in range — the one call on this path
    // that happens regardless of whether `trip.wrecks` is empty (a fresh
    // trip's always is; reaching an actual defeated-opponent wreck is a
    // full combat encounter, out of scope for "the key reaches the
    // handler"). No frame is stepped between the spy reset and the
    // dispatch below, so this is the ONLY thing that can produce a call:
    // remove the `if (ev.key === 'x' ...)` line and this spy count stays
    // at zero.
    const rulesets = await import('@/data/rulesets');
    const drivingConfigSpy = vi.spyOn(rulesets, 'drivingConfig');
    drivingConfigSpy.mockClear();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true }));

    expect(drivingConfigSpy).toHaveBeenCalled();
  });
});
