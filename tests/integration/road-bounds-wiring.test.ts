// @vitest-environment happy-dom
/**
 * Closes the coverage hole `tests/unit/road-literals-not-hardcoded.test.ts`
 * names in its own "KNOWN COVERAGE LIMIT" block: that file pins `roadBounds`'
 * OWN behaviour (centred on whatever point it's given) but never proves
 * `showRoad` actually hands that point to `makeArenaAISystem`. Reverting
 * `showRoad`'s call site back to the 3-arg form — which silently falls back
 * to `arenaBounds()`, a box fixed on the world ORIGIN — leaves every other
 * test in the suite green, because nothing else drives a real spawned road
 * opponent far enough from the origin to tell the two boxes apart.
 *
 * This file drives the REAL `@/app` (`boot()`) into a real `happy-dom`
 * document, exactly like `tests/integration/screens.test.ts`'s own DOM
 * acceptance gate: Title -> Driver Creation -> Constructor -> City ->
 * (real gate trigger) -> Road, purely through dispatched `KeyboardEvent`s,
 * never by calling an unexported screen function directly. It then drives
 * the player far enough down the route that a real, seeded hostile
 * `EncounterUnit` engages and `showRoad`'s own `updateEngagement` spawns a
 * real opponent vehicle — thousands of metres from the world origin, well
 * outside the tiny fixed arena floor (9 10m tiles wide, centred on (0,0)).
 *
 * The assertion is the wiring itself, not a reimplementation of
 * `avoidHazardNode`'s out-of-bounds branch: a `vi.spyOn` on the REAL,
 * unmocked `decideAI` (`@/sim/ai`, called through `makeArenaAISystem`
 * exactly as `showRoad` invokes it) captures the `bounds` its `ctx.world`
 * was built with for that spawned opponent. `bounds` centred on the
 * player's own live position (read out of that same `ctx.world.vehicles`,
 * never invented) proves the 4-arg `roadBounds(playerPosition)` call is
 * live; `bounds` centred on the origin instead is exactly the reverted bug.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { citiesConfig, skillsConfig } from '@/data/rulesets';
import type { AIContext } from '@/sim/ai';

// ---------------------------------------------------------------------------
// requestAnimationFrame stub: capture, never auto-run (same approach as
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
function stepFrame(deltaMs = 250): void {
  simNowMs += deltaMs;
  const cb = rafCallback;
  if (cb === null) throw new Error('test: no frame callback registered — the screen has not started its render loop yet');
  cb(simNowMs);
}

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
// through dispatched DOM events. Same shape as screens.test.ts's own
// bootFresh/bootToCity — duplicated here rather than imported because
// those are module-private to that test file.
// ---------------------------------------------------------------------------

// This exact seed is load-bearing: `newYorkNeighborRouteDigit`'s doc comment
// names 'ny-providence' as the neighbour confirmed (offline, against this
// literal seed string) to spawn a hostile combat-capable pack within a few
// miles of trip start on day 0. A different seed reshuffles every
// procedurally-generated encounter and would need re-verifying against it.
const TEST_SEED = 'screens-test-seed-1';

async function bootFresh(root: HTMLElement): Promise<Element> {
  const { boot } = await import('@/app');

  installRafStub();
  simNowMs = 0;

  const bootPromise = boot(root, {
    search: '',
    randomSeed: () => TEST_SEED,
    openDb: () => Promise.reject(new Error('test: no save database — always start a fresh session')),
  });
  await bootPromise;

  return requireOne('.sm-menu');
}

async function bootToCity(root: HTMLElement): Promise<void> {
  const titleMenu = await bootFresh(root);
  dispatchKey(titleMenu, { key: '1' });

  const submit = requireOne('.sm-screen--driver button');
  submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  const constructorScreen = requireOne('.sm-screen--constructor');
  for (const ch of 'TestRig') dispatchKey(constructorScreen, { key: ch });
  for (let i = 0; i < 40; i++) dispatchKey(constructorScreen, { key: 'ArrowDown' });
  dispatchKey(constructorScreen, { key: 'Enter' });

  await flushMicrotasks();
  await flushMicrotasks();

  requireOne('.sm-screen--city');
}

/**
 * Walks the on-foot player from the city through the real gate trigger and
 * takes the route at 1-based menu row `routeDigit` (`@/ui/menu`'s
 * `handleMenuKey` maps digit key `d` to row `d - 1`), landing on the Road
 * screen. Mirrors `screens.test.ts`'s own `walkThroughGateToRoad` (same
 * inward-then-outward two-leg walk, needed for the same reason: the player
 * spawns ON the gate, so the edge-triggered trigger only fires on the
 * return leg) but leaves the route choice a parameter — this file needs a
 * SPECIFIC neighbour route, not just "whichever is first", to land a real
 * hostile encounter within reach of a bounded drive.
 */
async function walkThroughGateToRoad(routeDigit: string): Promise<void> {
  const cityId = skillsConfig().startingLocation;
  const { generateCityLayout } = await import('@/sim/city');
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

  expect(document.querySelector('.sm-menu')).toBeNull();

  for (const k of outwardKeys) window.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
  for (let i = 0; i < STEPS_PER_LEG; i++) stepFrame();
  for (const k of outwardKeys) dispatchKeyUp(window, k);

  const routeMenu = requireOne('.sm-menu');
  dispatchKey(routeMenu, { key: routeDigit });

  await flushMicrotasks();
  await flushMicrotasks();

  requireOne('.sm-screen--road');
}

/**
 * `newyork` (the fixed `startingLocation`) neighbours are `citiesConfig().
 * routes` filtered by touching it, in file order — the SAME order
 * `@/app`'s own (module-private) `cityRouteNeighbors` builds its menu rows
 * from, reproduced here read-only (never duplicated as a hardcoded index)
 * so this test tracks `cities.json` if a route is ever added or reordered.
 * Row 5 (`ny-providence`, this seed) is the one confirmed, offline, to
 * spawn a hostile combat-capable pack within a few miles of trip start on
 * day 0 — every other neighbour's first hostile pack sits tens of miles in.
 */
function newYorkNeighborRouteDigit(neighborCityId: string): string {
  const cityId = skillsConfig().startingLocation;
  const neighbors: string[] = [];
  for (const route of citiesConfig().routes) {
    if (route.a === cityId) neighbors.push(route.b);
    else if (route.b === cityId) neighbors.push(route.a);
  }
  const index = neighbors.indexOf(neighborCityId);
  if (index < 0) throw new Error(`test: "${neighborCityId}" is not a newyork route neighbor in this ruleset`);
  return String(index + 1);
}

describe('showRoad wires roadBounds(playerPosition) into makeArenaAISystem, not the fixed arena floor', () => {
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

  it("a spawned road opponent's AI bounds follow the player thousands of metres from the origin, not a fixed box centred on (0,0)", async () => {
    await bootToCity(root);
    await walkThroughGateToRoad(newYorkNeighborRouteDigit('providence'));

    const aiModule = await import('@/sim/ai');
    const decideAISpy = vi.spyOn(aiModule, 'decideAI');

    // Drive straight down the route's fixed heading axis (routeHeadingRad
    // is 0 — `vehicleParkedAtGate` always zeroes headingRad — so
    // driveRight/KeyD alone covers ground; see this file's own header for
    // why 'ny-providence' is the neighbour that puts a hostile pack within
    // reach). No real wall-clock time passes: `stepFrame` invokes the
    // captured rAF callback by hand.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));

    const opponentCalls = (): AIContext[] =>
      decideAISpy.mock.calls.map(([ctx]) => ctx).filter((ctx) => ctx.self.id !== ctx.world.playerVehicleId);

    const MAX_FRAMES = 1500;
    let frames = 0;
    while (opponentCalls().length === 0 && frames < MAX_FRAMES) {
      stepFrame();
      frames++;
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true }));

    const captured = opponentCalls();
    expect(captured.length).toBeGreaterThan(0);

    const ctx = captured[captured.length - 1] as AIContext;
    const player = ctx.world.vehicles.find((v) => v.id === ctx.world.playerVehicleId);
    if (player === undefined) throw new Error('test: player vehicle missing from the AI world snapshot');

    // Sanity: this drive actually left the tiny fixed arena floor (a 90m
    // square centred on the origin) behind — otherwise a passing test
    // wouldn't tell the two boxes apart either.
    const distanceFromOrigin = Math.hypot(player.position.x, player.position.y);
    expect(distanceFromOrigin).toBeGreaterThan(200);

    const boundsCenter = {
      x: (ctx.world.bounds.minX + ctx.world.bounds.maxX) / 2,
      y: (ctx.world.bounds.minY + ctx.world.bounds.maxY) / 2,
    };
    expect(boundsCenter.x).toBeCloseTo(player.position.x, 5);
    expect(boundsCenter.y).toBeCloseTo(player.position.y, 5);
  }, 30_000);
});
