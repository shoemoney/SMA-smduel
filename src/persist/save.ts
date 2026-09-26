/**
 * Save persistence: IndexedDB-backed, two-phase-commit save/load with a
 * checksum on every generation and three rolling generations kept at a time.
 *
 * Two-phase commit shape:
 *   1. `beginSave`  - serialize the game, write it under a fresh generation
 *                     key alongside its checksum. The `active` pointer is
 *                     NOT touched here.
 *   2. `commitSave` - read the just-written generation back, recompute its
 *                     checksum and compare. Only once that verification
 *                     passes does the `active` pointer move to the new
 *                     generation, and only then are old generations pruned.
 *
 * If step 2 throws (a torn write, a bit flipped in flight, whatever), the
 * pointer never moves, so `load()` keeps returning the last known-good
 * generation. No gameplay data ever lives only in the pointer record: the
 * pointer only ever names a generation whose blob has already been verified.
 */
import type { DayPhase, DriverState, VehicleState } from '@/sim/types';
import type { World } from '@/sim/world';
import type { RngState } from '@/util/rng';
import type { AllBindings } from '@/ui/input';
import { migrateSave } from '@/persist/migrate';

// ---------------------------------------------------------------------------
// Save shape
// ---------------------------------------------------------------------------

/** Re-exported so callers (and `@/persist/migrate`) can name the RNG's serialized shape without reaching into `@/util/rng` directly. */
export type { RngState } from '@/util/rng';

export interface JobState {
  readonly id: string;
  readonly originCityId: string;
  readonly destinationCityId: string;
  readonly payout: number;
  readonly deadlineDay: number;
  readonly accepted: boolean;
  readonly completed: boolean;
}

export interface QuestState {
  readonly id: string;
  readonly stage: number;
  readonly completed: boolean;
  readonly flags: Readonly<Record<string, boolean>>;
}

/**
 * The last state the driver was in at a city (a safe haven, never mid-road
 * or mid-arena). "Classic Save" reverts to this on load; "Safe Save" ignores
 * it and restores the exact saved state instead.
 */
export interface SafeCitySnapshot {
  readonly day: number;
  readonly phase: DayPhase;
  readonly location: string;
  readonly driver: DriverState;
  readonly vehicles: Readonly<Record<string, VehicleState>>;
  readonly activeVehicleId?: string;
}

export interface SaveGame {
  readonly schemaVersion: number;
  readonly rulesetVersion: string;
  readonly seed: number;
  readonly currentDay: number;
  readonly phase: DayPhase;
  readonly location: string;
  readonly driver: DriverState;
  readonly activeVehicleId?: string;
  readonly vehicles: Readonly<Record<string, VehicleState>>;
  readonly jobs: readonly JobState[];
  /**
   * Campaign quest save-state - `@/app`'s `CityRunState.quests`, threaded
   * through `persistArenaSession`/`cityRunStateFromSaveGame` on every save
   * and resume. There is deliberately NO `arenaRecord` field alongside this
   * one: `@/sim/victory`'s own `ArenaRecord` doc comment documents that a
   * running arena win/loss tally is intentionally session-only, caller-
   * tracked state, never save data - the same reason `@/app`'s
   * `cityRunStateFromSaveGame` always resumes it at `{ wins: 0, losses: 0 }`
   * rather than reading a field that doesn't exist here.
   */
  readonly quests: readonly QuestState[];
  /**
   * The live road/arena tick-loop simulation (tick count, entities, arena
   * context, its own RNG stream) when the driver is mid-session; `null`
   * while safely in a city with no simulation in flight. This is the real
   * `World` from `@/sim/world`, not a parallel shape, so a road or arena
   * save can actually be resumed rather than only reverted to the last
   * city (see `applyLoadMode`'s classic-mode branch below).
   */
  readonly world: World | null;
  /** The driver-level RNG stream (jobs, quests, economy) - independent of any `world.rngState` a live simulation carries. */
  readonly rngState: RngState;
  /**
   * The live control preset/rebindings (`@/ui/input`'s `CONTROLS.presets` /
   * `AllBindings`) at save time - optional (and absent from every older
   * save/fixture, no schema version bump needed) so a rebind made this
   * session survives a reload instead of silently reverting to
   * controls.json's shipped defaults. `@/app`'s `boot()` restores both via
   * `restoreControls()` when present, and otherwise leaves the module's own
   * defaults in place exactly as before this field existed.
   */
  readonly controlPreset?: string;
  readonly controlBindings?: AllBindings;
  readonly lastSafeCitySnapshot: SafeCitySnapshot;
}

export type SaveMode = 'classic' | 'safe';

// ---------------------------------------------------------------------------
// IndexedDB storage contract
// ---------------------------------------------------------------------------

export const DB_NAME = 'smduel-save';
export const DB_VERSION = 1;
export const STORE_GENERATIONS = 'generations';
export const STORE_POINTER = 'pointer';
const POINTER_KEY = 'active';

/** How many rolling generations of save data are kept at once. */
export const MAX_GENERATIONS = 3;

export interface GenerationRecord {
  readonly generation: number;
  readonly json: string;
  readonly checksum: string;
  readonly schemaVersion: number;
  readonly writtenAt: number;
}

export interface PointerRecord {
  readonly key: 'active';
  readonly generation: number;
}

export class SaveVerificationError extends Error {
  override readonly name = 'SaveVerificationError';
  constructor(
    readonly generation: number,
    message: string,
  ) {
    super(message);
  }
}

export class SaveNotFoundError extends Error {
  override readonly name = 'SaveNotFoundError';
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------

export function openSaveDatabase(factory: IDBFactory = globalThis.indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_GENERATIONS)) {
        db.createObjectStore(STORE_GENERATIONS, { keyPath: 'generation' });
      }
      if (!db.objectStoreNames.contains(STORE_POINTER)) {
        db.createObjectStore(STORE_POINTER, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('failed to open save database'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Deterministic 32-bit FNV-1a checksum, hex-encoded. Not cryptographic - just corruption detection. */
export function computeChecksum(payload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function getActivePointer(db: IDBDatabase): Promise<number | undefined> {
  const tx = db.transaction(STORE_POINTER, 'readonly');
  const record = await requestToPromise<PointerRecord | undefined>(tx.objectStore(STORE_POINTER).get(POINTER_KEY));
  await transactionDone(tx);
  return record?.generation;
}

async function readGenerationRecord(db: IDBDatabase, generation: number): Promise<GenerationRecord | undefined> {
  const tx = db.transaction(STORE_GENERATIONS, 'readonly');
  const record = await requestToPromise<GenerationRecord | undefined>(
    tx.objectStore(STORE_GENERATIONS).get(generation),
  );
  await transactionDone(tx);
  return record;
}

async function pruneOldGenerations(db: IDBDatabase, latestGeneration: number): Promise<void> {
  const cutoff = latestGeneration - (MAX_GENERATIONS - 1);
  const tx = db.transaction(STORE_GENERATIONS, 'readwrite');
  const store = tx.objectStore(STORE_GENERATIONS);
  const keys = await requestToPromise<IDBValidKey[]>(store.getAllKeys());
  for (const key of keys) {
    if (typeof key === 'number' && key < cutoff) {
      store.delete(key);
    }
  }
  await transactionDone(tx);
}

// ---------------------------------------------------------------------------
// Two-phase commit
// ---------------------------------------------------------------------------

export interface BeginSaveResult {
  readonly generation: number;
  readonly checksum: string;
}

/**
 * Phase 1: write the new generation's blob + checksum. Never touches the
 * pointer at all (that's `commitSave`'s job) - the next generation number
 * comes from `STORE_GENERATIONS` itself, read and written inside one
 * transaction against that store.
 *
 * That's load-bearing, not incidental. The generation number is derived from
 * the highest key ALREADY WRITTEN into `STORE_GENERATIONS`, not from the
 * active pointer - and that read-then-write happens inside one transaction
 * against that store. Two `beginSave` calls racing each other (e.g. an
 * autosave on city entry overlapping one firing after a completed
 * transaction, which docs/SPEC.md's Safe Save explicitly allows) both need a
 * 'readwrite' lock on `STORE_GENERATIONS`, so IndexedDB serializes them: the
 * second call's transaction cannot start until the first one has committed
 * ITS OWN new generation record, so the second call always sees the first
 * one's reservation and computes a strictly higher number.
 *
 * Deriving the number from the active pointer instead (the previous shape,
 * and a shape that was tried and measured to still fail here) does not work
 * even with locking: the pointer's VALUE only ever changes in `commitSave`,
 * a later, separate transaction, so two `beginSave` calls run back-to-back -
 * not just concurrently - still read the same not-yet-advanced pointer and
 * derive the identical generation number, and the second one's write
 * silently clobbers the first's record.
 */
export async function beginSave(db: IDBDatabase, game: SaveGame): Promise<BeginSaveResult> {
  const json = JSON.stringify(game);
  const checksum = computeChecksum(json);

  const tx = db.transaction(STORE_GENERATIONS, 'readwrite');
  const store = tx.objectStore(STORE_GENERATIONS);
  const existingKeys = await requestToPromise<IDBValidKey[]>(store.getAllKeys());
  const highestExisting = existingKeys.reduce<number>(
    (max, key) => (typeof key === 'number' && key > max ? key : max),
    -1,
  );
  const generation = highestExisting + 1;
  const record: GenerationRecord = {
    generation,
    json,
    checksum,
    schemaVersion: game.schemaVersion,
    writtenAt: Date.now(),
  };
  store.put(record);
  await transactionDone(tx);
  return { generation, checksum };
}

/**
 * Read a generation back, recompute its checksum from the stored bytes and
 * compare it to what is stored (catches a torn/corrupted write) and,
 * optionally, to a caller-supplied expected value (catches the write phase
 * having handed back a checksum that doesn't match what actually landed).
 * Throws `SaveVerificationError` on any mismatch or missing record.
 */
export async function verifyGeneration(
  db: IDBDatabase,
  generation: number,
  expectedChecksum?: string,
): Promise<SaveGame> {
  const record = await readGenerationRecord(db, generation);
  if (record === undefined) {
    throw new SaveVerificationError(generation, `save generation ${generation} not found`);
  }
  const recomputed = computeChecksum(record.json);
  if (recomputed !== record.checksum) {
    throw new SaveVerificationError(
      generation,
      `save generation ${generation} failed checksum verification (stored ${record.checksum}, recomputed ${recomputed})`,
    );
  }
  if (expectedChecksum !== undefined && recomputed !== expectedChecksum) {
    throw new SaveVerificationError(
      generation,
      `save generation ${generation} checksum does not match the value returned at write time`,
    );
  }
  const parsed: unknown = JSON.parse(record.json);
  return migrateSave(parsed);
}

/**
 * Phase 2: verify the generation written by `beginSave`, and only on success
 * advance the active pointer to it and prune old generations. If
 * verification fails, this throws and the pointer is left exactly where it
 * was.
 */
export async function commitSave(db: IDBDatabase, generation: number, expectedChecksum: string): Promise<void> {
  await verifyGeneration(db, generation, expectedChecksum);
  const tx = db.transaction(STORE_POINTER, 'readwrite');
  const pointer: PointerRecord = { key: POINTER_KEY, generation };
  tx.objectStore(STORE_POINTER).put(pointer);
  await transactionDone(tx);
  await pruneOldGenerations(db, generation);
}

export interface SaveResult {
  readonly generation: number;
}

/** Convenience wrapper: `beginSave` then `commitSave`. */
export async function save(db: IDBDatabase, game: SaveGame): Promise<SaveResult> {
  const { generation, checksum } = await beginSave(db, game);
  await commitSave(db, generation, checksum);
  return { generation };
}

// ---------------------------------------------------------------------------
// Load, with Classic/Safe save-mode and generation fallback
// ---------------------------------------------------------------------------

export interface LoadOptions {
  /** 'safe' (default) restores the exact saved state; 'classic' reverts to `lastSafeCitySnapshot`. */
  readonly mode?: SaveMode;
}

export interface LoadResult {
  readonly game: SaveGame;
  readonly generation: number;
}

function omitActiveVehicleId<T extends { activeVehicleId?: string }>(value: T): Omit<T, 'activeVehicleId'> {
  const { activeVehicleId, ...rest } = value;
  void activeVehicleId;
  return rest;
}

/**
 * Classic mode reverts the whole driver/day/location/phase state to the last
 * safe city snapshot AND discards any live road/arena simulation, since
 * reverting to a city means there is no longer a mid-session `World` to speak
 * of - keeping the old one around (or only patching its `clock`) is exactly
 * how `currentDay`/`phase` and `world.clock.dayIndex`/`world.clock.phase`
 * went out of sync before: they are two views of "what day is it" that must
 * never both exist as independently-driftable fields once a load happens.
 */
function applyLoadMode(game: SaveGame, mode: SaveMode): SaveGame {
  if (mode === 'safe') return game;
  const snapshot = game.lastSafeCitySnapshot;
  const base: SaveGame = {
    ...omitActiveVehicleId(game),
    currentDay: snapshot.day,
    phase: snapshot.phase,
    location: snapshot.location,
    driver: snapshot.driver,
    vehicles: snapshot.vehicles,
    world: null,
  };
  return snapshot.activeVehicleId !== undefined ? { ...base, activeVehicleId: snapshot.activeVehicleId } : base;
}

/**
 * Loads the active generation. If it fails checksum verification (bit rot
 * at rest, not just a torn write), falls back through older surviving
 * generations, newest first, and reports which one it actually used. Throws
 * `SaveNotFoundError` only if every kept generation fails.
 */
export async function load(db: IDBDatabase, options: LoadOptions = {}): Promise<LoadResult> {
  const pointer = await getActivePointer(db);
  if (pointer === undefined) {
    throw new SaveNotFoundError('no active save pointer - nothing has been saved yet');
  }

  const tx = db.transaction(STORE_GENERATIONS, 'readonly');
  const keys = await requestToPromise<IDBValidKey[]>(tx.objectStore(STORE_GENERATIONS).getAllKeys());
  await transactionDone(tx);

  const candidates = keys
    .filter((key): key is number => typeof key === 'number' && key <= pointer)
    .sort((a, b) => b - a);

  const mode = options.mode ?? 'safe';
  let lastError: unknown;
  for (const generation of candidates) {
    try {
      const game = await verifyGeneration(db, generation);
      return { game: applyLoadMode(game, mode), generation };
    } catch (error) {
      // Only a checksum/corruption failure means "this generation is bad,
      // try the next-older one" - that's the one case a torn or bit-rotted
      // write can actually explain. A SaveMigrationError (unsupported
      // future schema version, or a checksum-valid-but-structurally-garbage
      // blob) is a DIFFERENT failure: the save exists and its bytes are
      // exactly what was written, it just cannot be loaded by this build.
      // Reporting that identically to "no save found" told the driver their
      // save was missing when it was actually present and unsupported, so
      // it must propagate as itself instead of being swallowed here.
      if (error instanceof SaveVerificationError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw new SaveNotFoundError(
    candidates.length === 0
      ? 'no save generations available'
      : `every kept save generation failed verification: ${String(lastError)}`,
  );
}
