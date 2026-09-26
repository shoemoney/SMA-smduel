import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import {
  STORE_GENERATIONS,
  STORE_POINTER,
  SaveNotFoundError,
  SaveVerificationError,
  beginSave,
  commitSave,
  computeChecksum,
  load,
  openSaveDatabase,
  save,
  type GenerationRecord,
  type PointerRecord,
  type SaveGame,
} from '@/persist/save';
import { CURRENT_SCHEMA_VERSION, SaveMigrationError, migrateSave, type SaveGameV1 } from '@/persist/migrate';
import { makeArmorRecord, type DriverState, type VehicleState } from '@/sim/types';
import { createWorld, type World } from '@/sim/world';
import { createRng } from '@/util/rng';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDriver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    name: 'Duke',
    skills: { driving: 12, marksmanship: 8, mechanic: 6 },
    naturalHealth: 5,
    bodyArmor: 3,
    prestige: 2,
    cash: 1500,
    cityId: 'dallas',
    cloneCityId: null,
    cloneSkills: null,
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: 'v1',
    ownerId: 'driver-1',
    design: {
      name: 'Widowmaker',
      bodyId: 'body-standard',
      chassisId: 'chassis-light',
      suspensionId: 'suspension-heavy-duty',
      plantId: 'plant-large',
      tireId: 'tire-standard',
      armor: makeArmorRecord(10),
      weapons: [],
    },
    position: { x: 10, y: 20 },
    headingRad: 0,
    speedMps: 0,
    battery: 99,
    odometerMiles: 42,
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

/** A real, populated World - not a stub - so a mid-session round trip actually exercises tick/entities/arena/rngState. */
function makeWorld(overrides: Partial<World> = {}): World {
  const base = createWorld({
    rngSeed: 777,
    arena: { id: 'arena-kart', kind: 'arena' },
    entities: {
      vehicles: [makeVehicle({ id: 'v1' }), makeVehicle({ id: 'npc-1', ownerId: 'ai-1' })],
    },
  });
  return { ...base, tick: 120, ...overrides };
}

function makeGame(overrides: Partial<SaveGame> = {}): SaveGame {
  const driver = makeDriver();
  const vehicle = makeVehicle();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rulesetVersion: 'classic-1',
    seed: 12345,
    currentDay: 10,
    phase: 'DAY',
    location: 'dallas',
    driver,
    activeVehicleId: vehicle.id,
    vehicles: { [vehicle.id]: vehicle },
    jobs: [],
    quests: [],
    world: null,
    rngState: createRng(12345).serialize(),
    lastSafeCitySnapshot: {
      day: 10,
      phase: 'DAY',
      location: 'dallas',
      driver,
      vehicles: { [vehicle.id]: vehicle },
      activeVehicleId: vehicle.id,
    },
    ...overrides,
  };
}

async function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('request failed'));
  });
}

async function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('tx failed'));
  });
}

/** Directly overwrites a generation's stored bytes, simulating corruption/a torn write. */
async function corruptGeneration(db: IDBDatabase, generation: number): Promise<void> {
  const tx = db.transaction(STORE_GENERATIONS, 'readwrite');
  const store = tx.objectStore(STORE_GENERATIONS);
  const record = await idbRequest<GenerationRecord | undefined>(store.get(generation));
  if (record === undefined) throw new Error(`no generation ${generation} to corrupt`);
  const corrupted: GenerationRecord = { ...record, json: record.json.slice(0, -5) + 'XXXXX' };
  store.put(corrupted);
  await txDone(tx);
}

/** Writes a generation record whose JSON is hand-crafted (not produced by `beginSave`), with a genuinely matching checksum. */
async function putRawGeneration(
  db: IDBDatabase,
  generation: number,
  json: string,
  schemaVersion: number,
): Promise<void> {
  const record: GenerationRecord = { generation, json, checksum: computeChecksum(json), schemaVersion, writtenAt: 0 };
  const tx = db.transaction(STORE_GENERATIONS, 'readwrite');
  tx.objectStore(STORE_GENERATIONS).put(record);
  await txDone(tx);
  const pointerTx = db.transaction(STORE_POINTER, 'readwrite');
  pointerTx.objectStore(STORE_POINTER).put({ key: 'active', generation } satisfies PointerRecord);
  await txDone(pointerTx);
}

async function getAllGenerationKeys(db: IDBDatabase): Promise<number[]> {
  const tx = db.transaction(STORE_GENERATIONS, 'readonly');
  const keys = await idbRequest<IDBValidKey[]>(tx.objectStore(STORE_GENERATIONS).getAllKeys());
  await txDone(tx);
  return keys.filter((key): key is number => typeof key === 'number').sort((a, b) => a - b);
}

async function readGeneration(db: IDBDatabase, generation: number): Promise<GenerationRecord | undefined> {
  const tx = db.transaction(STORE_GENERATIONS, 'readonly');
  const record = await idbRequest<GenerationRecord | undefined>(tx.objectStore(STORE_GENERATIONS).get(generation));
  await txDone(tx);
  return record;
}

async function getPointer(db: IDBDatabase): Promise<number | undefined> {
  const tx = db.transaction(STORE_POINTER, 'readonly');
  const record = await idbRequest<PointerRecord | undefined>(tx.objectStore(STORE_POINTER).get('active'));
  await txDone(tx);
  return record?.generation;
}

/**
 * One IndexedDB connection for the whole file (opening/closing/deleting a
 * real IndexedDB per test is racy under fake-indexeddb - a delete blocks
 * forever behind a connection nothing ever closes). Each test instead gets a
 * clean slate by clearing both object stores before it runs.
 */
let db: IDBDatabase;

async function clearStore(name: string): Promise<void> {
  const tx = db.transaction(name, 'readwrite');
  tx.objectStore(name).clear();
  await txDone(tx);
}

beforeEach(async () => {
  db = await openSaveDatabase(indexedDB);
  await clearStore(STORE_GENERATIONS);
  await clearStore(STORE_POINTER);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('save/load round trip', () => {
  it('saves and loads back an equal SaveGame at generation 0', async () => {
    const game = makeGame();

    const result = await save(db, game);
    expect(result.generation).toBe(0);

    const loaded = await load(db);
    expect(loaded.generation).toBe(0);
    expect(loaded.game).toEqual(game);
  });

  it('advances the generation on each successive save', async () => {
    await save(db, makeGame({ currentDay: 1 }));
    const second = await save(db, makeGame({ currentDay: 2 }));
    expect(second.generation).toBe(1);

    const loaded = await load(db);
    expect(loaded.generation).toBe(1);
    expect(loaded.game.currentDay).toBe(2);
  });

  it('round-trips a live road/arena World (tick, entities, arena) byte-for-byte, not just the calendar fields', async () => {
    const world = makeWorld();
    const game = makeGame({ location: 'arena-kart', world });

    await save(db, game);
    const loaded = await load(db, { mode: 'safe' });

    // Independently re-derive what a correct round trip must preserve,
    // rather than just re-asserting `toEqual(world)` against the same
    // object the save call was given.
    expect(loaded.game.world).not.toBeNull();
    expect(loaded.game.world?.tick).toBe(120);
    expect(loaded.game.world?.arena).toEqual({ id: 'arena-kart', kind: 'arena' });
    expect(loaded.game.world?.entities.vehicles.map((v) => v.id)).toEqual(['v1', 'npc-1']);
    expect(loaded.game.world?.rngState).toEqual(world.rngState);
  });

  it('preserves the seeded RNG stream across a save boundary bit-for-bit', async () => {
    // The documented rule (@/util/rng.ts) is that `serialize()` + `restore()`
    // must reproduce the exact same draw sequence. A save/load cycle is
    // just persistence sitting in between those two calls, so the value
    // this test derives its expectation from is the RNG's OWN contract,
    // not `save`/`load`'s implementation.
    const live = createRng('release-gate-2');
    for (let i = 0; i < 37; i++) live.nextU32(); // arbitrary prior activity before the save point
    const snapshot = live.serialize();
    const expectedNext = (() => {
      const reference = createRng('unrelated-seed');
      reference.restore(snapshot);
      return reference.nextU32();
    })();

    await save(db, makeGame({ rngState: snapshot }));
    const loaded = await load(db);

    const restored = createRng('unrelated-seed');
    restored.restore(loaded.game.rngState);
    expect(restored.nextU32()).toBe(expectedNext);
  });
});

describe('two-phase commit', () => {
  it('leaves the pointer untouched and the driver intact when the verify step throws on a torn write', async () => {
    const goodGame = makeGame({ currentDay: 1, driver: makeDriver({ name: 'Duke', cash: 1500 }) });
    await save(db, goodGame);
    expect(await getPointer(db)).toBe(0);

    const badGame = makeGame({ currentDay: 2, driver: makeDriver({ name: 'Impostor', cash: 0 }) });
    const { generation, checksum } = await beginSave(db, badGame);
    expect(generation).toBe(1);

    // Simulate the write getting torn / corrupted after beginSave wrote it,
    // before commitSave gets a chance to verify it.
    await corruptGeneration(db, generation);

    await expect(commitSave(db, generation, checksum)).rejects.toThrow(SaveVerificationError);

    // Pointer must not have moved.
    expect(await getPointer(db)).toBe(0);

    const loaded = await load(db);
    expect(loaded.generation).toBe(0);
    expect(loaded.game.driver.name).toBe('Duke');
    expect(loaded.game.driver.cash).toBe(1500);
  });

  it('falls back to the previous generation when the active generation is corrupted at rest, reporting which one it used', async () => {
    await save(db, makeGame({ currentDay: 1, driver: makeDriver({ name: 'Duke' }) }));
    await save(db, makeGame({ currentDay: 2, driver: makeDriver({ name: 'Later Duke' }) }));
    expect(await getPointer(db)).toBe(1);

    // Bit rot after the fact - the active generation's bytes no longer match
    // their own checksum.
    await corruptGeneration(db, 1);

    const loaded = await load(db);
    expect(loaded.generation).toBe(0);
    expect(loaded.game.driver.name).toBe('Duke');
  });

  it('throws SaveNotFoundError when every kept generation is corrupted', async () => {
    await save(db, makeGame());
    await corruptGeneration(db, 0);
    await expect(load(db)).rejects.toThrow(SaveNotFoundError);
  });

  it('never derives the same generation number from two saves racing each other, and loses neither', async () => {
    const gameA = makeGame({ driver: makeDriver({ name: 'AAA', cash: 111 }) });
    const gameB = makeGame({ driver: makeDriver({ name: 'BBB', cash: 222 }) });

    const results = await Promise.allSettled([save(db, gameA), save(db, gameB)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const generations = results.map((r) => (r as PromiseFulfilledResult<{ generation: number }>).value.generation);

    // Two distinct generation numbers - the whole bug was both racing calls
    // computing the SAME number and one clobbering the other's record.
    expect(new Set(generations).size).toBe(2);
    expect(await getAllGenerationKeys(db)).toEqual([0, 1]);

    // Read each generation directly (not just through `load`, which only
    // ever returns the active pointer's one generation) to prove BOTH
    // driver identities actually made it to storage.
    const names = new Set<string>();
    for (const generation of [0, 1]) {
      const record = await readGeneration(db, generation);
      expect(record).toBeDefined();
      const parsed = JSON.parse(record?.json ?? '{}') as SaveGame;
      names.add(parsed.driver.name);
    }
    expect(names).toEqual(new Set(['AAA', 'BBB']));
  });
});

describe('generation pruning', () => {
  it('keeps exactly 3 rolling generations, pruning the oldest', async () => {
    for (let day = 0; day < 5; day += 1) {
      await save(db, makeGame({ currentDay: day }));
    }
    const keys = await getAllGenerationKeys(db);
    expect(keys).toEqual([2, 3, 4]);

    const loaded = await load(db);
    expect(loaded.generation).toBe(4);
    expect(loaded.game.currentDay).toBe(4);
  });
});

describe('Classic Save vs Safe Save', () => {
  it('represents both an exact state and a last-safe-city snapshot in one save, and Classic fully reverts every snapshot field', async () => {
    const safeDriver = makeDriver({ name: 'Duke', cash: 1500 });
    const safeVehicle = makeVehicle({ id: 'v1' });
    const roadDriver = makeDriver({ name: 'Duke', cash: 900 });
    const roadVehicle = makeVehicle({ id: 'v1', odometerMiles: 900 });
    const roadWorld = makeWorld();
    const originalRngState = createRng('mid-session').serialize();
    const jobs = [
      {
        id: 'job-1',
        originCityId: 'dallas',
        destinationCityId: 'houston',
        payout: 500,
        deadlineDay: 12,
        accepted: true,
        completed: false,
      },
    ];
    const quests = [{ id: 'quest-1', stage: 1, completed: false, flags: {} }];

    const game = makeGame({
      currentDay: 10,
      phase: 'NIGHT',
      location: 'arena-kart',
      driver: roadDriver,
      vehicles: { v1: roadVehicle },
      world: roadWorld,
      rngState: originalRngState,
      jobs,
      quests,
      lastSafeCitySnapshot: {
        day: 7,
        phase: 'DAY',
        location: 'dallas',
        driver: safeDriver,
        vehicles: { v1: safeVehicle },
        activeVehicleId: 'v1',
      },
    });

    await save(db, game);

    const safe = await load(db, { mode: 'safe' });
    expect(safe.game.location).toBe('arena-kart');
    expect(safe.game.currentDay).toBe(10);
    expect(safe.game.phase).toBe('NIGHT');
    expect(safe.game.driver.cash).toBe(900);
    expect(safe.game.world?.tick).toBe(120);

    const classic = await load(db, { mode: 'classic' });
    // Every field the last-safe-city snapshot actually carries must come
    // from the SNAPSHOT, not a mix of snapshot and live-session values -
    // that mixing (day reverted, phase left live) is the exact desync bug.
    expect(classic.game.location).toBe('dallas');
    expect(classic.game.currentDay).toBe(7);
    expect(classic.game.phase).toBe('DAY');
    expect(classic.game.driver.cash).toBe(1500);
    expect(classic.game.vehicles['v1']?.odometerMiles).toBe(42);
    // Reverting to a safe city means there is no more in-progress road/arena
    // simulation to resume - carrying the old World forward (or only patching
    // its clock) would leave tick/entities/arena pointing at a session that
    // no longer exists from the driver's perspective.
    expect(classic.game.world).toBeNull();
    // Progression that isn't tied to "where the driver physically is" must
    // survive a Classic revert untouched.
    expect(classic.game.jobs).toEqual(jobs);
    expect(classic.game.quests).toEqual(quests);
    // The master RNG stream is never rewound by a location revert - doing so
    // would replay already-consumed random numbers on the next draw.
    expect(classic.game.rngState).toEqual(originalRngState);
  });
});

describe('schema migration', () => {
  it('migrates a schema v1 save (no lastSafeCitySnapshot) up to the current version', () => {
    const driver = makeDriver({ name: 'Duke' });
    const vehicle = makeVehicle({ id: 'v1' });
    const v1: SaveGameV1 = {
      schemaVersion: 1,
      rulesetVersion: 'classic-1',
      seed: 7,
      currentDay: 3,
      phase: 'NIGHT',
      location: 'dallas',
      driver,
      activeVehicleId: 'v1',
      vehicles: { v1: vehicle },
      jobs: [],
      quests: [],
      world: null,
      rngState: createRng(7).serialize(),
    };

    const migrated = migrateSave(v1);

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.driver.name).toBe('Duke');
    expect(migrated.lastSafeCitySnapshot).toBeDefined();
    expect(migrated.lastSafeCitySnapshot.location).toBe('dallas');
    // The migrated snapshot's phase must come from the v1 save's own phase,
    // not a default - a v1 save has no better record of it than its own
    // current state (same reasoning the migration already applies to day/
    // location/driver/vehicles).
    expect(migrated.lastSafeCitySnapshot.phase).toBe('NIGHT');
    expect(migrated.lastSafeCitySnapshot.driver.name).toBe('Duke');
    expect(migrated.lastSafeCitySnapshot.activeVehicleId).toBe('v1');
  });

  it('migrates a v1 save read back through the full save/load pipeline', async () => {
    const driver = makeDriver({ name: 'Old Timer' });
    const vehicle = makeVehicle({ id: 'v1' });
    const v1: SaveGameV1 = {
      schemaVersion: 1,
      rulesetVersion: 'classic-1',
      seed: 1,
      currentDay: 1,
      phase: 'DAY',
      location: 'dallas',
      driver,
      vehicles: { v1: vehicle },
      jobs: [],
      quests: [],
      world: null,
      rngState: createRng(1).serialize(),
    };
    await putRawGeneration(db, 0, JSON.stringify(v1), 1);

    const loaded = await load(db);
    expect(loaded.game.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(loaded.game.driver.name).toBe('Old Timer');
    expect(loaded.game.lastSafeCitySnapshot.location).toBe('dallas');
    expect(loaded.game.lastSafeCitySnapshot.phase).toBe('DAY');
  });

  it('rejects a save schema version newer than this build supports, instead of silently opening it', () => {
    const fromTheFuture = { schemaVersion: CURRENT_SCHEMA_VERSION + 97, somethingThisBuildHasNeverHeardOf: true };
    expect(() => migrateSave(fromTheFuture)).toThrow(SaveMigrationError);
  });

  it('rejects a checksum-valid but structurally-empty blob at the current schema version, in both load modes', async () => {
    // No migration step runs for this (it's already at CURRENT_SCHEMA_VERSION),
    // so the only thing that can catch it is structural validation.
    const garbage = JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION });
    await putRawGeneration(db, 0, garbage, CURRENT_SCHEMA_VERSION);

    // Must be reported as itself (a real, diagnosable migration failure),
    // never silently accepted and never relabelled as "no save found" - both
    // of those hide from the driver that a save exists and is unsupported.
    await expect(load(db, { mode: 'safe' })).rejects.toThrow(SaveMigrationError);
    await expect(load(db, { mode: 'classic' })).rejects.toThrow(SaveMigrationError);
  });

  it('still falls back past a corrupted newer generation to an older, valid one', async () => {
    await save(db, makeGame({ driver: makeDriver({ name: 'Duke' }) }));
    // A newer generation exists but is bit-rotted (checksum mismatch) -
    // this is the "actually try an older generation" case, distinct from
    // the structurally-garbage-but-checksum-valid case above.
    await save(db, makeGame({ driver: makeDriver({ name: 'Later Duke' }) }));
    await corruptGeneration(db, 1);

    const loaded = await load(db);
    expect(loaded.generation).toBe(0);
    expect(loaded.game.driver.name).toBe('Duke');
  });
});
