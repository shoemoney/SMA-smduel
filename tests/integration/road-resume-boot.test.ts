// @vitest-environment happy-dom
/**
 * `resumeSession` must restore a ROAD TRIP, and until this file existed
 * nothing proved it did.
 *
 * ITERATION 103 SHIPPED THE SAVE SIDE AND RECORDED THIS LIMIT ITSELF: the trip
 * menu writes a correct blob (proven by `road-trip-save.test.ts` against the
 * real schema and the real converters), and the resume branch exists — but
 * `resumeSession` is a closure inside `boot()`, so neutering its `roadTrip`
 * branch left the ENTIRE SUITE GREEN. The restore path was unprotected, and
 * the failure it would cause is the worst kind this log has catalogued: a
 * player who saved mid-journey reloads and silently finds themselves in a
 * city with the trip gone. Iteration 93's bug class, one layer up.
 *
 * This file closes it by driving the ONLY path that exercises the closure:
 * write a real save, boot the real app against the real database, press the
 * real Continue row, and read the real rendered screen. Nothing here calls an
 * unexported function.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { citiesConfig, skillsConfig } from '@/data/rulesets';
import type { SkillName } from '@/sim/types';
import { initialClock } from '@/sim/calendar';
import { createRng } from '@/util/rng';
import { beginRoadTrip, resolveRoute, stepRoadTrip, type RoadTripState } from '@/sim/road';
import { createDriver } from '@/sim/driver';
import { openSaveDatabase, type QuestState } from '@/persist/save';
import { makeArmorRecord, type VehicleState } from '@/sim/types';

// `vehicleStateFromDesign` and `PLAYER_ID` are exported from `@/app` itself —
// which is where `screens.test.ts` imports them from. Guessing `@/sim/construct`
// for both cost two more rounds of the same fixture-from-memory class.
import { PLAYER_ID, persistArenaSession, vehicleStateFromDesign } from '@/app';
import { cityName } from '@/ui/strings';

// ---------------------------------------------------------------------------
// rAF stub: capture, never auto-run. `showRoad` starts its own render loop and
// a real one here would drive the sim with no clock we control.
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function dispatchKey(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function requireOne(selector: string): Element {
  const found = document.querySelectorAll(selector);
  if (found.length !== 1) throw new Error(`test: expected exactly one "${selector}", found ${found.length}`);
  return found[0] as Element;
}

/**
 * The game's OWN database, via the game's OWN opener.
 *
 * The first draft of this file hand-built a `saves` object store and the real
 * `load()` rejected it with "No object store named pointer" — the fourteenth
 * fixture-from-memory in this log. The layout is `STORE_GENERATIONS` +
 * `STORE_POINTER` at v1 and `openSaveDatabase` already knows all three.
 */
let dbPromise: Promise<IDBDatabase> | null = null;
let dbHandle: IDBDatabase | null = null;
function openTestDb(): Promise<IDBDatabase> {
  if (dbPromise === null) {
    dbPromise = openSaveDatabase().then((db) => {
      dbHandle = db;
      return db;
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_SEED = 'road-resume-boot-seed';

/**
 * A legal starting skill split, DERIVED from `skills.json` rather than typed.
 *
 * The first draft hardcoded `{ driving: 12, marksmanship: 8, mechanic: 6 }` and
 * every test failed on "skills must sum to exactly 50 (got 26)". The guard was
 * right and the fixture was wrong — the same class as the thirteen before it,
 * and the rule has not changed: read the value from the ruleset that owns it.
 * `screens.test.ts` already had this helper; it is module-private there, so it
 * is re-derived here from the same source rather than imported.
 */
function evenSkillSplit(): Record<SkillName, number> {
  const cfg = skillsConfig();
  const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
  const remainder = cfg.startingSkillPool - base * cfg.skills.length;
  const skills = {} as Record<SkillName, number>;
  cfg.skills.forEach((name, index) => {
    skills[name] = base + (index < remainder ? 1 : 0);
  });
  return skills;
}

/**
 * The route is read from the REAL ruleset rather than typed in, so a rename in
 * `cities.json` fails this test for a reason that has nothing to do with
 * resume. `startingLocation` -> its first neighbour, which is how the gate
 * itself picks a destination.
 */
function pickRoute(): { from: string; to: string; lengthMiles: number } {
  const from = skillsConfig().startingLocation;
  const routes = citiesConfig().routes.filter((r) => r.a === from || r.b === from);
  const first = routes[0];
  if (first === undefined) throw new Error(`test fixture: "${from}" has no outbound route`);
  return { from, to: first.a === from ? first.b : first.a, lengthMiles: first.lengthMiles };
}

/** The DESTINATION's display name, read through the game's own lookup. */
function cityNameFor(cityId: string): string {
  return cityName(cityId);
}

function fixtureDriver() {
  const r = createDriver('ResumeTest', evenSkillSplit());
  if (!r.ok) throw new Error(`test fixture: legal skill split expected, got "${r.reason}"`);
  return r.driver;
}

function makeTrip(origin: string, destination: string): RoadTripState {
  const vehicle: VehicleState = vehicleStateFromDesign(
    {
      name: 'Hauler',
      bodyId: 'subcompact',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'small',
      tireId: 'standard',
      armor: makeArmorRecord(2),
      weapons: [{ weaponId: 'machinegun', facing: 'FRONT', ammo: 200 }],
    } as never,
    'veh-resume-test',
    PLAYER_ID,
  );

  return beginRoadTrip(resolveRoute(origin, destination), vehicle, initialClock(), createRng(SESSION_SEED));
}

let root: HTMLElement;
let openDbHandle: () => Promise<IDBDatabase>;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  dbPromise = null;
  dbHandle = null;
  openDbHandle = () => openTestDb();
});

afterEach(async () => {
  // The database is SHARED with sibling files via `fake-indexeddb` on the real
  // DB_NAME, so this only clears the ACTIVE POINTER rather than dropping the
  // database — deleting it wiped a store other files were using in iteration
  // 103 and made this class of test flaky. Pointer-scoped is enough: `boot`
  // resumes through the pointer.
  // The handle AND the promise cache are reset together. Resetting only
  // `dbHandle` left `dbPromise` holding the CLOSED connection, so every
  // subsequent `openDbHandle()` returned a dead db and the save silently
  // vanished — which showed up as the title screen offering no Continue and
  // sent me looking for a bug in the resume path that was not there.
  dbHandle?.close();
  dbHandle = null;
  dbPromise = null;
  const fresh = await openSaveDatabase();
  await new Promise<void>((resolve) => {
    const req = fresh.transaction('pointer', 'readwrite').objectStore('pointer').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
  fresh.close();
});

describe('boot: resuming a saved road trip', () => {
  it('pressing Continue returns the driver to the ROAD, mid-journey, not to a city', async () => {
    const { from, to, lengthMiles } = pickRoute();
    const trip = makeTrip(from, to);

    // Write the save the way the trip menu's Save and quit does — through the
    // REAL `persistArenaSession` and the REAL `roadTripToSave`, so the fixture
    // cannot drift from the shape the game actually writes.
    // DRIVE the real sim rather than hand-setting `progressMiles`.
    //
    // `progressMiles` is DERIVED state: `stepRoadTrip` recomputes it every tick
    // from `vehicle.position - startPosition` projected on the route axis, and
    // writes position and progressMiles into the same next-state. Writing a
    // progressMiles with the vehicle still parked at the start therefore
    // produces a state the simulation can never be in — and on resume the first
    // tick overwrites it with 0. That is a fixture lie, not a game bug, and the
    // game is right: production saves `trip.vehicle` with its live position and
    // the two always agree.
    const driven = stepRoadTrip(
      trip,
      { stick: { x: 0, y: 1 } },
      1 / 60,
      createRng(SESSION_SEED),
      12,
      'normal',
      new Map(),
    ).state;
    expect(driven.progressMiles).toBeGreaterThan(0);

    await persistArenaSession({
      openDb: openDbHandle,
      driver: fixtureDriver(),
      vehicle: driven.vehicle,
      clock: driven.clock,
      location: from,
      quests: [] as readonly QuestState[],
      sessionSeed: SESSION_SEED,
      world: null,
      roadTrip: roadTripShape(driven),
    });

    installRafStub();
    simNowMs = 0;
    const { boot } = await import('@/app');
    await boot(root, { search: '', randomSeed: () => 'unused-fresh-seed', openDb: openDbHandle });
    for (let i = 0; i < 4; i++) await flushMicrotasks();

    // A real save exists, so Continue is offered and is the FIRST row
    // (`showTitle` unshifts it whenever `onContinue` exists).
    const titleMenu = requireOne('.sm-menu');
    dispatchKey(titleMenu, { key: 'Enter' });
    for (let i = 0; i < 8; i++) await flushMicrotasks();

    // THE ASSERTION. The road screen, not the city: a resume that rebuilt a
    // city instead would look identical to the pre-iteration-103 behaviour and
    // lose the trip without any error.
    requireOne('.sm-screen--road');
    expect(document.querySelector('.sm-screen--city')).toBeNull();

    // The status pill is written only on a frame that ran at least one SIM
    // TICK — `frame` returns early on `ticks === 0`, which is correct behaviour
    // (a zero-tick frame must still redraw) but does mean a single 250ms step
    // can land on one. Two steps guarantee the second ticks.
    for (let f = 0; f < 2; f++) { const cb = rafCallback; if (cb !== null) cb((simNowMs += 250));
      console.log('frame', f, 'road=', document.querySelectorAll('.sm-screen--road').length); }
    for (let i = 0; i < 4; i++) await flushMicrotasks();

    // ...on the RIGHT route carrying the SAVED progress. The expected mileage is
    // derived from the route the test picked out of `cities.json` and the
    // progress it wrote, so it cannot drift with the ruleset.
    // re-queried AFTER the frames: the earlier `road` reference predates the
    // render pass that writes the status pill.
    const text = requireOne('.sm-screen--road').textContent ?? '';
    expect(text).toContain(cityNameFor(to));
    expect(text).toMatch(new RegExp(`${Math.round(lengthMiles - driven.progressMiles)}\\s*mi remaining`));
  });

  it('a save with NO roadTrip still resumes into a city (the new field is optional)', async () => {
    const { from } = pickRoute();
    const trip = makeTrip(from, pickRoute().to);
    await persistArenaSession({
      openDb: openDbHandle,
      driver: fixtureDriver(),
      vehicle: trip.vehicle,
      clock: initialClock(),
      location: from,
      quests: [] as readonly QuestState[],
      sessionSeed: SESSION_SEED,
      world: null,
      // deliberately NO roadTrip
    });

    installRafStub();
    simNowMs = 0;
    const { boot } = await import('@/app');
    await boot(root, { search: '', randomSeed: () => 'unused-fresh-seed', openDb: openDbHandle });
    for (let i = 0; i < 4; i++) await flushMicrotasks();
    dispatchKey(requireOne('.sm-menu'), { key: 'Enter' });
    for (let i = 0; i < 8; i++) await flushMicrotasks();

    requireOne('.sm-screen--city');
    expect(document.querySelector('.sm-screen--road')).toBeNull();
  });

  it('a trip save with NO active vehicle falls through to the city rather than losing the run', async () => {
    const { from, to } = pickRoute();
    const trip = makeTrip(from, to);
    const driverResult = createDriver('ResumeTest', evenSkillSplit());
    if (!driverResult.ok) throw new Error('test fixture: legal skill split expected');

    const game = {
      schemaVersion: 2,
      rulesetVersion: 'classic-1',
      seed: 1,
      currentDay: 0,
      phase: 'DAY' as const,
      location: from,
      driver: fixtureDriver(),
      // no activeVehicleId and no vehicles: the trip has no car to put the
      // driver in, so resuming into the road would render an empty cockpit.
      vehicles: {},
      jobs: [],
      quests: [] as readonly QuestState[],
      world: null,
      rngState: createRng(SESSION_SEED).stream('driver').serialize(),
      roadTrip: roadTripShape(trip),
      lastSafeCitySnapshot: {
        day: 0,
        phase: 'DAY' as const,
        location: from,
        driver: fixtureDriver(),
        vehicles: {},
      },
    };
    const { save } = await import('@/persist/save');
    await save(await openDbHandle(), game as never);

    installRafStub();
    simNowMs = 0;
    const { boot } = await import('@/app');
    await boot(root, { search: '', randomSeed: () => 'unused-fresh-seed', openDb: openDbHandle });
    for (let i = 0; i < 4; i++) await flushMicrotasks();
    dispatchKey(requireOne('.sm-menu'), { key: 'Enter' });
    for (let i = 0; i < 8; i++) await flushMicrotasks();

    requireOne('.sm-screen--city');
    expect(document.querySelector('.sm-screen--road')).toBeNull();
  });
});

/** The real converter, so the fixture cannot drift from what the menu writes. */
function roadTripShape(trip: RoadTripState): import('@/persist/save').RoadTripSave {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return roadTripToSaveRef(trip);
}

// Bound once at module scope: `@/app` is a heavy module and the boot path
// already imports it; re-importing inside each test would reset its caches.
import { roadTripToSave as roadTripToSaveRef } from '@/app';
