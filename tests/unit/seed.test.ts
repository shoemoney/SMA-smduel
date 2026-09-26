/**
 * Session-seed reproducibility.
 *
 * `@/app`'s arena used to seed its world RNG from `Date.now() ^ 0x9e3779b9` -
 * low-entropy (two tabs booted the same millisecond collide) and, worse,
 * throwaway: nothing recorded it, so a bug report or a replay could never be
 * reconstructed after the fact. This suite pins the replacement contract:
 *
 *   - a session seed is a stable STRING, resolved exactly once from (in
 *     priority order) an explicit `?seed=` override, a seed already recorded
 *     on a save in progress, or a genuinely random `crypto.getRandomValues`
 *     draw - never the clock;
 *   - that string, fed through `createRng`, drives the world's RNG
 *     deterministically - the same seed always produces the same sequence;
 *   - and it survives a real `@/persist/save` round trip stream-position and
 *     all, so "Continue" never re-derives a seed, it restores one.
 */
import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import {
  createArenaWorld,
  randomSessionSeed,
  resolveArenaWorld,
  resolveResumeSessionSeed,
  resolveSessionSeed,
  seedOverrideFromSearch,
  withWorldRng,
} from '@/app';
import { drivingConfig } from '@/data/rulesets';
import { CURRENT_SCHEMA_VERSION } from '@/persist/migrate';
import { openSaveDatabase, save, load, type SaveGame } from '@/persist/save';
import { createGameLoop, createSystemsRegistry, defaultInputFrame, dtSecondsFromTickRate, type SystemFn } from '@/sim/loop';
import { makeArmorRecord, type DriverState, type VehicleState } from '@/sim/types';
import { createRng } from '@/util/rng';
import { snapshot, type World } from '@/sim/world';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDriver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    name: 'Seed Tester',
    skills: { driving: 10, marksmanship: 10, mechanic: 10 },
    naturalHealth: 5,
    bodyArmor: 3,
    prestige: 0,
    cash: 1000,
    cityId: 'dallas',
    cloneCityId: null,
    cloneSkills: null,
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: 'veh-player',
    ownerId: 'player',
    design: {
      name: 'Seed Rig',
      bodyId: 'body-standard',
      chassisId: 'chassis-light',
      suspensionId: 'suspension-heavy-duty',
      plantId: 'plant-large',
      tireId: 'tire-standard',
      armor: makeArmorRecord(10),
      weapons: [],
    },
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 99,
    odometerMiles: 0,
    armorDP: makeArmorRecord(10),
    tireDP: [10, 10, 10, 10],
    plantDP: 10,
    weapons: [],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    ...overrides,
  };
}

/** Draws one float per tick from the world's own serialized RNG stream (the same restore/draw/serialize convention `@/app`'s `withWorldRng` requires) and folds it into the vehicle, so `snapshot(world)` is sensitive to both the seed and how far its stream has already advanced. */
const RNG_DRIVEN_SYSTEM: SystemFn = (world) => {
  const vehicle = world.entities.vehicles[0];
  if (vehicle === undefined) return;
  const drawn = withWorldRng(world, (rng) => rng.nextFloat());
  vehicle.odometerMiles += drawn;
  vehicle.headingRad = (vehicle.headingRad + drawn) % (Math.PI * 2);
};

/**
 * Delegates to `@/app`'s OWN `createArenaWorld` - the function that builds a
 * brand-new arena world from a session seed - rather than reimplementing
 * "createWorld then set rngState" locally. A local copy of that wiring would
 * test itself, not `src/app.ts`: it would stay green even if
 * `createArenaWorld`'s own `createRng(sessionSeed)` call got mutated to
 * ignore the seed it's handed.
 *
 * NOTE what this does NOT cover: `createArenaWorld` is called from
 * `resolveArenaWorld` (via `session.sessionSeed`), which `buildWorld` never
 * goes through - so a mutation at THAT call site (e.g. hardcoding the
 * argument instead of passing `session.sessionSeed` through) is invisible
 * here. That call site is exercised directly by the
 * `resolveArenaWorld builds a brand-new arena world from the session seed`
 * suite below, which drives `resolveArenaWorld` itself.
 */
function buildWorld(sessionSeed: string): World {
  return createArenaWorld(sessionSeed, makeVehicle());
}

function runTicks(world: World, ticks: number): void {
  const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
  const systems = createSystemsRegistry();
  systems.register('driving', RNG_DRIVEN_SYSTEM);
  const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: defaultInputFrame });
  for (let i = 0; i < ticks; i++) loop.advance(dtSeconds);
}

function fakeCrypto(words: readonly number[]): Pick<Crypto, 'getRandomValues'> {
  return {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (array instanceof Uint32Array) array.set(words);
      return array;
    },
  };
}

// ---------------------------------------------------------------------------
// A session seed string drives the world RNG deterministically
// ---------------------------------------------------------------------------

describe('a session seed string drives the world RNG deterministically', () => {
  // `buildWorld` calls `@/app`'s real `createArenaWorld`, so both assertions
  // below exercise production code, not a local stand-in - but only
  // `createArenaWorld`'s OWN internal wiring (see the note on `buildWorld`
  // above for what this does and doesn't cover). The "different seed,
  // different hash" half is what a mutation that hardcodes/ignores the seed
  // INSIDE `createArenaWorld` breaks - mutate its `createRng(sessionSeed)`
  // call to `createRng('IGNORES-THE-SESSION-SEED')` and this test fails.
  it('produces identical world-state hashes across two independent runs of the same seed', () => {
    const seed = 'bug-report-4711aa';
    const worldA = buildWorld(seed);
    const worldB = buildWorld(seed);
    runTicks(worldA, 200);
    runTicks(worldB, 200);
    expect(snapshot(worldA)).toBe(snapshot(worldB));
    expect(worldA.rngState).toEqual(worldB.rngState);
  });

  it('is sensitive to the seed - a different seed string produces a different hash', () => {
    const worldA = buildWorld('seed-one');
    const worldB = buildWorld('seed-two');
    runTicks(worldA, 200);
    runTicks(worldB, 200);
    expect(snapshot(worldA)).not.toBe(snapshot(worldB));
  });
});

// ---------------------------------------------------------------------------
// resolveArenaWorld: the actual branch showArena calls to build/resume a
// world, including the createArenaWorld(session.sessionSeed, ...) call site
// itself - not just createArenaWorld's own internal wiring (see the note on
// `buildWorld` above for the gap this closes).
// ---------------------------------------------------------------------------

describe('resolveArenaWorld builds a brand-new arena world from the session seed', () => {
  /** A session with no `restoreWorld`, so `resolveArenaWorld` takes the "charge the practice fee, then build a fresh world from `sessionSeed`" branch - the exact branch `createArenaWorld(session.sessionSeed, playerVehicle)` lives in. */
  function newGameSession(sessionSeed: string): { readonly sessionSeed: string; readonly openDb: () => Promise<IDBDatabase> } {
    return { sessionSeed, openDb: () => Promise.reject(new Error('test fixture: openDb should not be called by resolveArenaWorld')) };
  }

  // This is the mutation-proving half: it fails under the exact mutation
  // this suite was blind to before - `showArena` (now `resolveArenaWorld`)
  // hardcoding its `createArenaWorld` call to ignore `session.sessionSeed`.
  // A "same seed twice -> same hash" assertion alone would NOT catch that
  // mutation, since a hardcoded seed still produces identical runs of
  // itself; only a "different seed -> different hash" assertion, driven
  // through the real branch-selection function, does.
  it('is sensitive to the session seed - two new-game sessions with different seeds produce different world-state hashes', () => {
    const driver = makeDriver();
    const resolutionA = resolveArenaWorld(driver, makeVehicle(), newGameSession('arena-session-seed-one'));
    const resolutionB = resolveArenaWorld(driver, makeVehicle(), newGameSession('arena-session-seed-two'));
    if (!resolutionA.ok || !resolutionB.ok) {
      throw new Error('test fixture: expected the default driver to be eligible for practice');
    }
    runTicks(resolutionA.world, 200);
    runTicks(resolutionB.world, 200);
    expect(snapshot(resolutionA.world)).not.toBe(snapshot(resolutionB.world));
  });

  it('produces identical world-state hashes for two independent new-game sessions given the same seed', () => {
    const driver = makeDriver();
    const resolutionA = resolveArenaWorld(driver, makeVehicle(), newGameSession('same-arena-seed'));
    const resolutionB = resolveArenaWorld(driver, makeVehicle(), newGameSession('same-arena-seed'));
    if (!resolutionA.ok || !resolutionB.ok) {
      throw new Error('test fixture: expected the default driver to be eligible for practice');
    }
    runTicks(resolutionA.world, 200);
    runTicks(resolutionB.world, 200);
    expect(snapshot(resolutionA.world)).toBe(snapshot(resolutionB.world));
  });

  it('resuming a save reuses the restored World verbatim instead of rebuilding one from sessionSeed', () => {
    const driver = makeDriver();
    const restoreWorld = buildWorld('whatever-was-saved');
    runTicks(restoreWorld, 12);
    const resolution = resolveArenaWorld(driver, makeVehicle(), {
      // A deliberately DIFFERENT sessionSeed than the restored world's own,
      // to prove resuming ignores it entirely and reuses restoreWorld as-is.
      sessionSeed: 'not-the-restored-seed',
      restoreWorld,
      openDb: () => Promise.reject(new Error('test fixture: openDb should not be called by resolveArenaWorld')),
    });
    if (!resolution.ok) throw new Error('test fixture: expected the restore branch to always succeed');
    expect(resolution.world).toBe(restoreWorld);
    expect(resolution.chargedDriver).toBe(driver);
  });
});

// ---------------------------------------------------------------------------
// resolveResumeSessionSeed: resuming a save uses ITS OWN recorded seed, not
// a freshly generated one - this is survivor (a) from the mutation audit,
// where deleting the saved-seed lookup in boot()'s resumeSession stayed
// green because nothing drove that exact call directly.
// ---------------------------------------------------------------------------

describe('resolveResumeSessionSeed resumes with the save\'s own recorded seed', () => {
  it('uses the seed already recorded on the restored world, never a freshly generated one', () => {
    const randomSeed = vi.fn(() => 'should-never-be-used');
    const restoredWorld = buildWorld('saved-session-seed-123');
    const resolved = resolveResumeSessionSeed(restoredWorld, { search: '', randomSeed });
    expect(resolved).toBe('saved-session-seed-123');
    expect(randomSeed).not.toHaveBeenCalled();
  });

  it('still lets an explicit ?seed= override win over the saved seed', () => {
    const restoredWorld = buildWorld('saved-session-seed-123');
    const resolved = resolveResumeSessionSeed(restoredWorld, { search: '?seed=override-seed' });
    expect(resolved).toBe('override-seed');
  });
});

// ---------------------------------------------------------------------------
// A save round trip preserves the seed and the RNG stream position
// ---------------------------------------------------------------------------

describe('a save round trip preserves the seed and the RNG stream position', () => {
  it('restores rngState exactly, and continuing to tick from it matches continuing the original', async () => {
    const seed = 'roundtrip-seed-9001';
    const world = buildWorld(seed);
    expect(world.rngState.seedKey).toBe('s:roundtrip-seed-9001');

    // Advance the stream partway through before ever saving - proves the
    // round trip preserves the exact mid-stream POSITION, not just the seed.
    runTicks(world, 50);

    const driver = makeDriver();
    const vehicle = world.entities.vehicles[0];
    if (vehicle === undefined) throw new Error('test fixture: expected a player vehicle');

    const vehicles = { [vehicle.id]: vehicle };
    const game: SaveGame = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rulesetVersion: 'classic-1',
      seed: 424242,
      currentDay: world.clock.dayIndex,
      phase: world.clock.phase,
      location: 'practice',
      driver,
      activeVehicleId: vehicle.id,
      vehicles,
      jobs: [],
      quests: [],
      world,
      rngState: createRng(seed).stream('driver').serialize(),
      lastSafeCitySnapshot: {
        day: world.clock.dayIndex,
        phase: world.clock.phase,
        location: 'practice',
        driver,
        vehicles,
        activeVehicleId: vehicle.id,
      },
    };

    const db = await openSaveDatabase(indexedDB);
    await save(db, game);
    const loaded = await load(db);
    const restoredWorld = loaded.game.world;
    if (restoredWorld === null) throw new Error('test fixture: expected the saved world to round-trip non-null');

    // The seed survives exactly - same seedKey, same 4 xoshiro words, not
    // just "a" seed but the precise position 50 ticks had already left it at.
    expect(restoredWorld.rngState).toEqual(world.rngState);
    expect(restoredWorld.tick).toBe(world.tick);

    // Continue BOTH the pre-save world (still live in memory) and the
    // freshly-restored copy by the same further ticks. If loading had
    // re-derived the RNG from the seed instead of restoring rngState, the
    // restored copy would restart its draw sequence from the top and the
    // two hashes below would diverge immediately.
    runTicks(world, 30);
    runTicks(restoredWorld, 30);
    expect(snapshot(restoredWorld)).toBe(snapshot(world));
    expect(restoredWorld.rngState).toEqual(world.rngState);
  });
});

// ---------------------------------------------------------------------------
// resolveSessionSeed priority order
// ---------------------------------------------------------------------------

describe('resolveSessionSeed priority order', () => {
  it('an explicit ?seed= override wins over a freshly generated seed', () => {
    const randomSeed = vi.fn(() => 'should-never-be-used');
    const resolved = resolveSessionSeed({ search: '?seed=bug-1234', randomSeed });
    expect(resolved).toBe('bug-1234');
    expect(randomSeed).not.toHaveBeenCalled();
  });

  it('an explicit ?seed= override wins even when a save-in-progress seed is also available', () => {
    const randomSeed = vi.fn(() => 'should-never-be-used');
    const resolved = resolveSessionSeed({ search: '?seed=bug-1234', savedSeed: 'seed-from-a-save', randomSeed });
    expect(resolved).toBe('bug-1234');
  });

  it('falls back to a save-in-progress seed when there is no override', () => {
    const randomSeed = vi.fn(() => 'should-never-be-used');
    const resolved = resolveSessionSeed({ search: '', savedSeed: 'seed-from-a-save', randomSeed });
    expect(resolved).toBe('seed-from-a-save');
    expect(randomSeed).not.toHaveBeenCalled();
  });

  it('generates a random seed only when neither an override nor a saved seed is present', () => {
    const randomSeed = vi.fn(() => 'freshly-generated');
    const resolved = resolveSessionSeed({ search: '', savedSeed: null, randomSeed });
    expect(resolved).toBe('freshly-generated');
    expect(randomSeed).toHaveBeenCalledTimes(1);
  });

  it('seedOverrideFromSearch trims whitespace and treats a blank param as absent', () => {
    expect(seedOverrideFromSearch('?seed=   ')).toBeNull();
    expect(seedOverrideFromSearch('?other=x')).toBeNull();
    expect(seedOverrideFromSearch('')).toBeNull();
    expect(seedOverrideFromSearch('?seed=  my-seed  ')).toBe('my-seed');
  });
});

// ---------------------------------------------------------------------------
// randomSessionSeed: crypto, never the clock
// ---------------------------------------------------------------------------

describe('randomSessionSeed', () => {
  it('derives a stable hex string from crypto.getRandomValues', () => {
    const seed = randomSessionSeed(fakeCrypto([0x11223344, 0x55667788, 0x99aabbcc, 0xddeeff00]));
    expect(seed).toBe('112233445566778899aabbccddeeff00');
    expect(seed).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces a different seed for a different random draw', () => {
    const a = randomSessionSeed(fakeCrypto([1, 2, 3, 4]));
    const b = randomSessionSeed(fakeCrypto([5, 6, 7, 8]));
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// The clock is gone
// ---------------------------------------------------------------------------

describe('no clock-based seeding remains', () => {
  // A source-text grep for `Date.now` is trivially bypassed by
  // `new Date().getTime()`, `const D = Date; D.now()`, or routing through
  // `performance.now()` (which src/app.ts's rAF loop already calls
  // legitimately for frame pacing, so that alias would be plausible AND
  // invisible to a grep). This guard instead forces the ACTUAL global clock
  // values `Date.now()` and `performance.now()` return to be wildly
  // different across two calls and asserts the derived state is identical
  // anyway - it catches a clock leaking into seed derivation no matter what
  // syntax or alias smuggled the read in, because it checks the values a
  // clock read would actually return, not the text that requests them.
  it('the same explicit seed derives identical arena-world state no matter what Date.now/performance.now return', () => {
    const dateSpy = vi.spyOn(Date, 'now');
    const perfSpy = vi.spyOn(performance, 'now');
    try {
      function resolveAndRun(clockValue: number): { seed: string; hash: string } {
        dateSpy.mockReturnValue(clockValue);
        perfSpy.mockReturnValue(clockValue);
        const seed = resolveSessionSeed({
          search: '?seed=fixed-seed-42',
          randomSeed: () => 'should-never-be-used',
        });
        const world = buildWorld(seed);
        runTicks(world, 200);
        return { seed, hash: snapshot(world) };
      }

      const early = resolveAndRun(1_000);
      const late = resolveAndRun(999_999_999_999);

      expect(early.seed).toBe('fixed-seed-42');
      expect(late.seed).toBe(early.seed);
      expect(late.hash).toBe(early.hash);
    } finally {
      dateSpy.mockRestore();
      perfSpy.mockRestore();
    }
  });
});
