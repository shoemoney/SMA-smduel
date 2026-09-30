// @vitest-environment happy-dom
/**
 * The road screen's trip menu, and the freeze it promises.
 *
 * Codex `gpt-6.1-sol` drove the deployed road and reported: "I tried Escape
 * and P. Neither opened a menu or paused the simulation; the car continued
 * coasting." That greps clean — `showRoad` mounted no menu and no actions at
 * all, so the road was the only screen in the game with no way to stop.
 *
 * The assertion here is deliberately the FREEZE and not the menu's existence.
 * A translucent panel over a simulation that keeps stepping would look
 * complete, mount a `.sm-menu`, and pass any test that only asked "is there a
 * menu" — while the car drove itself down the highway with the player choosing
 * between Resume and Abandon. So the load-bearing check here is that the
 * odometer does not advance across frames while the menu is open, and that the
 * menu is reachable by BOTH keys the reviewer actually tried.
 *
 * Drives the REAL `@/app` through Title -> Driver -> Constructor -> City ->
 * Gate -> Road purely via dispatched `KeyboardEvent`s, the same shape as
 * `road-bounds-wiring.test.ts` (boot helpers are module-private there, hence
 * duplicated rather than imported — the drift risk that duplication carries is
 * recorded in that file's own comment above `bootToCity`).
 */
import 'fake-indexeddb/auto';

import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRoadLegalCar, dispatchKey } from './constructor-fixture';

import { citiesConfig, skillsConfig } from '@/data/rulesets';
import { DB_NAME, openSaveDatabase } from '@/persist/save';

// ---------------------------------------------------------------------------
// rAF stub: capture, never auto-run.
// ---------------------------------------------------------------------------

type Raf = (nowMs: number) => void;
let rafCallback: Raf | null = null;
let rafHandleCounter = 0;
let simNowMs = 0;

function installRafStub(): void {
  rafCallback = null;
  rafHandleCounter = 0;
  simNowMs = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCallback = cb as Raf;
    return ++rafHandleCounter;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {
    rafCallback = null;
  }) as typeof window.cancelAnimationFrame;
}

function stepFrame(deltaMs = 250): void {
  simNowMs += deltaMs;
  const cb = rafCallback;
  if (cb === null) throw new Error('test: no frame callback registered — the screen has not started its render loop yet');
  cb(simNowMs);
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function requireOne(selector: string): Element {
  const found = document.querySelectorAll(selector);
  if (found.length !== 1) throw new Error(`test: expected exactly one "${selector}", found ${found.length}`);
  return found[0] as Element;
}

function queryAll(selector: string): Element[] {
  return [...document.querySelectorAll(selector)];
}

// ---------------------------------------------------------------------------
// Boot: real Title -> Driver -> Constructor -> City -> Gate -> Road.
// ---------------------------------------------------------------------------

const TEST_SEED = 'screens-test-seed-1';

/**
 * The game's OWN `openSaveDatabase`, not a hand-built schema.
 *
 * This file's first attempt created a `saves` object store by hand, and the
 * real `load()` then failed with "No object store named pointer" — the
 * fourteenth fixture in this log written from memory of a shape rather than
 * from the thing itself, and the second one in this session to guess a
 * persistence detail that already had an owner. The database layout is
 * `STORE_GENERATIONS` + `STORE_POINTER` at `DB_VERSION` 1, and
 * `openSaveDatabase` already knows all three.
 */
let dbPromise: Promise<IDBDatabase> | null = null;
let openDb_: IDBDatabase | null = null;
function openTestDb(): Promise<IDBDatabase> {
  if (dbPromise === null) {
    dbPromise = openSaveDatabase().then((db) => {
      openDb_ = db;
      return db;
    });
  }
  return dbPromise;
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  vi.restoreAllMocks();
});

/**
 * The live road's total length, derived from the route the test actually
 * selected rather than remembered.
 *
 * This used to subtract from a hardcoded `150`, which was `ny-albany`'s
 * pre-rescale length. The 2026-09-30 world rescale divided every route by 5,
 * so the subtraction silently became nonsense — 150 - 30 = 120 miles driven
 * after ten frames — and the test failed for the right reason at the wrong
 * layer. That is the fixture-from-memory class this log has now paid for
 * eighteen times, and the number here was the most load-bearing one in the
 * file: every assertion about the saved blob is measured against it.
 */
function routeLengthMiles(): number {
  // Mirrors `cityRouteNeighbors` in `src/app.ts` — routes touching the city,
  // in `cities.json` order, which is the order the gate menu renders them in.
  // Re-derived from the ruleset rather than importing app's copy: that helper
  // is module-private, and widening app's API for a test would be a worse
  // trade than six lines of the same filter. The test reads the SOURCE OF
  // TRUTH (`cities.json`), which is the point — the old code read neither.
  const cityId = skillsConfig().startingLocation;
  const touching = citiesConfig().routes.filter((r) => r.a === cityId || r.b === cityId);
  const chosen = touching[0];
  if (!chosen) throw new Error(`cities.json has no route touching ${cityId}`);
  return chosen.lengthMiles;
}

/** Reads whatever the game actually wrote, through the real loader. */
async function readSavedGame(): Promise<{ roadTrip?: { originCityId: string; progressMiles: number } } | null> {
  const { load } = await import('@/persist/save');
  try {
    const result = await load(await openTestDb());
    return (result as unknown as { game: { roadTrip?: { originCityId: string; progressMiles: number } } }).game ?? null;
  } catch {
    return null; // nothing saved — the caller's assertion says so
  }
}

async function bootFresh(root: HTMLElement): Promise<Element> {
  const { boot } = await import('@/app');
  installRafStub();
  const bootPromise = boot(root, {
    search: '',
    randomSeed: () => TEST_SEED,
    // A REAL per-test database, not a rejecting stub. The save has to be
    // readable back, because "Save and quit" and "Abandon trip" both leave the
    // road for the city and the only honest difference between them is what one
    // writes and the other does not. Asserting only the screen transition let a
    // mutation that swapped the two paths pass — this file caught that, and the
    // fix is to observe the artefact rather than the symptom.
    openDb: () => openTestDb(),
  });
  await bootPromise;
  return requireOne('.sm-menu');
}

async function bootToCity(root: HTMLElement): Promise<void> {
  const titleMenu = await bootFresh(root);
  dispatchKey(titleMenu, { key: '1' });
  requireOne('.sm-screen--driver button').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  // A ROAD-LEGAL car, fitted by the one shared owner. This file used to carry
  // its own row indexes and a hand-rolled keystroke sequence that re-implemented
  // what `screens.test.ts`'s helpers already did; see constructor-fixture.ts.
  const constructorScreen = requireOne('.sm-screen--constructor');
  buildRoadLegalCar(constructorScreen, 'MenuRig');

  await flushMicrotasks();
  await flushMicrotasks();
  requireOne('.sm-screen--city');
}

/**
 * Walks through the real gate trigger and takes the first route, landing on the
 * Road screen. Two legs, because the player spawns ON the gate and the doorway
 * trigger is an edge (was-outside -> is-inside), not a level test.
 */
async function walkThroughGateToRoad(): Promise<void> {
  const cityId = skillsConfig().startingLocation;
  const { generateCityLayout } = await import('@/sim/city');
  const gate = generateCityLayout(cityId, TEST_SEED).gate.position;

  const inward: KeyboardEventInit[] = [];
  if (-gate.x > 0) inward.push({ key: 'd', code: 'KeyD' });
  else if (-gate.x < 0) inward.push({ key: 'a', code: 'KeyA' });
  if (gate.y > 0) inward.push({ key: 's', code: 'KeyS' });
  else if (gate.y < 0) inward.push({ key: 'w', code: 'KeyW' });
  const outward: KeyboardEventInit[] = inward.map((k) => {
    if (k.code === 'KeyD') return { key: 'a', code: 'KeyA' };
    if (k.code === 'KeyA') return { key: 'd', code: 'KeyD' };
    if (k.code === 'KeyW') return { key: 's', code: 'KeyS' };
    return { key: 'w', code: 'KeyW' };
  });

  for (const k of inward) window.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
  for (let i = 0; i < 15; i++) stepFrame();
  for (const k of inward) window.dispatchEvent(new KeyboardEvent('keyup', { ...k, bubbles: true }));

  for (const k of outward) window.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
  for (let i = 0; i < 15; i++) stepFrame();
  for (const k of outward) window.dispatchEvent(new KeyboardEvent('keyup', { ...k, bubbles: true }));

  await flushMicrotasks();
  const gateMenu = requireOne('.sm-menu');
  dispatchKey(gateMenu, { key: '1' });
  await flushMicrotasks();
  requireOne('.sm-screen--road');
}

async function bootToRoad(root: HTMLElement): Promise<void> {
  await bootToCity(root);
  await walkThroughGateToRoad();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let root: HTMLElement;

beforeEach(async () => {
  document.body.innerHTML = '';
  // Wipe between tests, and CLOSE the previous connection first —
  // `deleteDatabase` blocks forever while any connection is open, which is what
  // turned every test after the first into a 10s hook timeout. A stale blob
  // from a prior test would otherwise satisfy the assertion below without this
  // feature writing anything.
  openDb_?.close();
  openDb_ = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  dbPromise = null;
  root = document.createElement('div');
  document.body.appendChild(root);
  vi.restoreAllMocks();
});

/** Reads the trip's identity straight off the screen, so the assertion is about game state. */
async function p3(): Promise<{ origin: string }> {
  return { origin: await import('@/data/rulesets').then((m) => m.skillsConfig().startingLocation) };
}

describe('road trip menu', () => {
  it('opens on Escape and the trip FREEZES while it is open', async () => {
    await bootToRoad(root);

    // Drive a little so the odometer is genuinely moving when we pause; a
    // frozen-at-zero odometer would satisfy "did not advance" for the wrong
    // reason, which is the mistake this test exists to avoid.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    for (let i = 0; i < 12; i++) stepFrame();

    /**
     * The STATUS LINE alone, not the whole screen's text.
     *
     * The first version of this compared `.sm-screen--road`'s entire
     * textContent, and it failed while the freeze was working correctly — the
     * only difference was the menu this very change added. Comparing the whole
     * screen means the test fails for the feature it is testing. The status
     * line is the odometer readout, which is the thing that must not move.
     */
    const statusEl = requireOne('.sm-screen--road').querySelector('div');
    const statusBefore = statusEl?.textContent ?? '';

    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(1);

    // The car is still being asked to drive (KeyW never released), so if the
    // freeze were not real these frames would move the odometer.
    for (let i = 0; i < 20; i++) stepFrame();
    expect(requireOne('.sm-screen--road').querySelector('div')?.textContent ?? '').toBe(statusBefore);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
  });

  it('offers Resume, Controls, Save and quit and Abandon trip', async () => {
    await bootToRoad(root);
    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();

    const labels = queryAll('.sm-menu__item').map((i) => (i.textContent ?? '').trim());
    expect(labels.length).toBe(4);
    expect(labels.join('|')).toMatch(/Resume/i);
    expect(labels.join('|')).toMatch(/Controls/i);
    // Save-and-quit sits ABOVE abandon on purpose: both leave the trip, but one
    // is resumable and one forfeits the car, so the recoverable option must not
    // be the one a player has to read past.
    expect(labels.join('|')).toMatch(/Save/i);
    expect(labels.findIndex((l) => /Save/i.test(l)))
      .toBeLessThan(labels.findIndex((l) => /Abandon/i.test(l)));
  });

  it('Save and quit leaves the trip RESUMABLE rather than forfeiting the car', async () => {
    await bootToRoad(root);
    const before = await p3();
    // Drive a measurable distance FIRST, so the saved blob can be matched
    // against a number this test controls.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    for (let i = 0; i < 10; i++) stepFrame();

    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    // row 3 is Save and quit; `handleMenuKey` maps digit 3 to index 2
    dispatchKey(requireOne('.sm-menu'), { key: '3' });
    // `saveAndQuit` AWAITS the write before it navigates, so the screen change
    // is deliberately not synchronous. Drain the microtask chain rather than
    // asserting immediately — and note that this ordering is the assertion that
    // the save is written BEFORE the player leaves, which is the whole reason
    // it is awaited rather than fire-and-forget.
    for (let i = 0; i < 8; i++) await flushMicrotasks();

    expect(queryAll('.sm-screen--road').length).toBe(0);
    expect(queryAll('.sm-screen--city').length).toBe(1);

    // The load-bearing assertion: the trip was actually WRITTEN, read back out
    // of the real database. The first version of this test only checked the
    // screen transition, and a mutation that made Save-and-quit take the
    // ABANDON path passed it — both leave the road for the city, so the
    // transition proves nothing about which one ran. Reading the artefact back
    // is the only thing that separates them, and it is the same discipline
    // iteration 102 applied to the converter.
    const saved = await readSavedGame();
    expect(saved).not.toBeNull();
    expect(saved!.roadTrip).toBeDefined();
    expect(saved!.roadTrip!.originCityId).toBe(before.origin);
    // The trip the player was DRIVING, not some other writer's blob. Several
    // test files share `fake-indexeddb` on the REAL `DB_NAME`, so this file
    // deliberately does NOT delete the database — doing that in `beforeEach`
    // wiped a store other files were using and made this test itself flaky (1
    // failure in 2 full-suite runs, with the delete as the cause). The assertion
    // is self-discriminating instead: drive a measurable distance first, then
    // require the saved progress to MATCH IT. A stale or foreign blob cannot
    // satisfy that, so no destructive cleanup is needed.
    // The claim this test actually makes is "the trip was WRITTEN, not
    // forfeited" — the blob exists, carries a road trip, and carries a driver
    // position past the origin.
    //
    // It used to assert `toBeCloseTo(droveMiles, 2)` against a value derived
    // from the HUD's "Nmi remaining" text. After the /5 rescale that stopped
    // being measurable: the route is 30 miles, the HUD rounds to whole miles,
    // and ten frames of driving is ~0.003 of a mile, so the screen can only
    // report "30mi remaining" and the derived delta is 0. `toBeCloseTo(0, 2)`
    // passes for anything under half a mile — an assertion that cannot fail is
    // worse than no assertion, so the exact round trip is NOT claimed here.
    // `road-resume-boot.test.ts` owns that, against state the sim derives.
    // What is claimed here is that a real, non-zero, in-range distance was
    // persisted, which is what distinguishes Save-and-quit from Abandon.
    expect(saved!.roadTrip!.originCityId).toBe(skillsConfig().startingLocation);
    expect(saved!.roadTrip!.progressMiles).toBeGreaterThan(0);
    expect(saved!.roadTrip!.progressMiles).toBeLessThanOrEqual(routeLengthMiles());
  });

  it('opens on P as well as Escape — the reviewer tried both', async () => {
    await bootToRoad(root);
    dispatchKey(window, { key: 'p' });
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(1);
  });

  it('resumes and the trip moves again', async () => {
    await bootToRoad(root);

    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    const menu = requireOne('.sm-menu');
    dispatchKey(menu, { key: 'Escape' }); // BACK -> close, which is the onBack path
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    for (let i = 0; i < 24; i++) stepFrame();
    const status = requireOne('.sm-screen--road').textContent ?? '';
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
    // Progress means the remaining-miles readout changed from the paused value.
    expect(status).toMatch(/remaining/);
  });

  it('abandoning returns to the city with the car left behind, same as a wreck', async () => {
    await bootToRoad(root);
    const originCity = skillsConfig().startingLocation;

    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    // Row 3 is Abandon; `handleMenuKey` maps digit 3 to index 2.
    dispatchKey(requireOne('.sm-menu'), { key: '3' });
    await flushMicrotasks();
    await flushMicrotasks();

    // Back in a city, at the ORIGIN — not teleported to the destination. The
    // assertion is on the DISPLAY name, not `originCity`: `skillsConfig()
    // .startingLocation` is the ruleset id ('newyork') and the screen renders
    // `cityName(id)` ('New York'). Comparing the raw id against rendered text is
    // the ninth instance in this log of a fixture written from the shape of the
    // data rather than from its value, and it fails for a reason that has
    // nothing to do with the feature under test.
    const { cityName } = await import('@/ui/strings');
    const city = requireOne('.sm-screen--city');
    const cityText = city.textContent ?? '';
    expect(cityText).toContain(cityName(originCity));
    // And the car is left behind, not parked at the player's feet.
    expect(cityText).not.toMatch(/Not road-legal/);
  });

  it('leaves no menu mounted when the screen is torn down while paused', async () => {
    await bootToRoad(root);
    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(1);

    // Abandon is the only road path that returns to another screen; going
    // through it proves `stop()` unmounts the menu and detaches the key
    // listener rather than leaving a screen-scoped Escape handler behind.
    dispatchKey(requireOne('.sm-menu'), { key: '3' });
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(0);

    // A stray Escape on the city must NOT open a road menu.
    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(0);
  });

  it('returns from Controls to a LIVE trip, not an already-paused one', async () => {
    await bootToRoad(root);
    const speedOf = (): number => {
      const raw = requireOne('.sm-screen--road').textContent ?? '';
      const match = /(\d+)\s*mph/.exec(raw);
      if (match === null) throw new Error(`road status carried no speed readout: ${raw.slice(0, 120)}`);
      return Number.parseInt(match[1] ?? '', 10);
    };

    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    const controlsRow = queryAll('.sm-menu__item').find((i) => /Controls/i.test(i.textContent ?? ''));
    expect(controlsRow, 'the trip menu should offer Controls').toBeDefined();
    controlsRow?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushMicrotasks();
    await flushMicrotasks();
    requireOne('.sm-screen--controls');

    dispatchKey(requireOne('.sm-menu'), { key: 'Escape' });
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    requireOne('.sm-screen--road');
    // THE BUG, same shape as the arena's: `showControls` mounts the road
    // synchronously inside the keydown whose BACK it is handling, so the road's
    // own Escape handler — attached synchronously — caught that same Escape and
    // re-opened the trip menu on the road it had just returned to. Measured
    // before the fix: one menu already mounted on return, odometer dead.
    expect(
      queryAll('.sm-menu').length,
      'Controls round trip came back to a paused trip — the Escape that mounted it re-paused it',
    ).toBe(0);

    // The HUD is painted from inside `frame()`, so its readout does not exist
    // on the first frame after a mount. Its absence before that is not a defect.
    for (let i = 0; i < 3; i++) stepFrame();

    // CONTROL: the signal must be able to MOVE, or "not paused" proves nothing.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    const before = speedOf();
    for (let i = 0; i < 20; i++) stepFrame();
    const after = speedOf();
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
    expect(after, `the trip stayed at ${after} mph after returning from Controls`).toBeGreaterThan(before);
  });
});
