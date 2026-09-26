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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  randomSessionSeed,
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
import { createWorld, snapshot, type World } from '@/sim/world';

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

function buildWorld(sessionSeed: string): World {
  const world = createWorld({
    rngSeed: 0, // placeholder - immediately replaced below, mirroring @/app's own showArena wiring
    arena: { id: 'seed-test', kind: 'arena' },
    entities: { vehicles: [makeVehicle()] },
  });
  world.rngState = createRng(sessionSeed).serialize();
  return world;
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
  it('src/app.ts never CALLS Date.now() in actual code (comments may still explain why not)', () => {
    const appSource = readFileSync(fileURLToPath(new URL('../../src/app.ts', import.meta.url)), 'utf8');
    const withoutComments = appSource
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments (incl. JSDoc)
      .replace(/\/\/.*$/gm, ''); // line comments
    expect(withoutComments).not.toMatch(/Date\.now/);
  });
});
