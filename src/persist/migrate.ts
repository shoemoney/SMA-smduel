/**
 * Save schema migration registry: version -> upgrade function, applied in
 * order until the blob reaches `CURRENT_SCHEMA_VERSION`.
 */
import type { DriverState, VehicleState } from '@/sim/types';
import type { World } from '@/sim/world';
import type { JobState, QuestState, RngState, SaveGame } from '@/persist/save';
import { describeShapeErrors, isSaveGame } from '@/persist/schema';

export const CURRENT_SCHEMA_VERSION = 2;

export class SaveMigrationError extends Error {
  override readonly name = 'SaveMigrationError';
}

type UnknownRecord = Record<string, unknown>;

function isSchemaVersioned(value: unknown): value is UnknownRecord & { schemaVersion: number } {
  return typeof value === 'object' && value !== null && typeof (value as UnknownRecord)['schemaVersion'] === 'number';
}

// ---------------------------------------------------------------------------
// Schema v1: pre-dates Classic/Safe save mode, so there is no
// `lastSafeCitySnapshot` field - every save was an exact snapshot.
// ---------------------------------------------------------------------------

export interface SaveGameV1 {
  readonly schemaVersion: 1;
  readonly rulesetVersion: string;
  readonly seed: number;
  readonly currentDay: number;
  readonly phase: SaveGame['phase'];
  readonly location: string;
  readonly driver: DriverState;
  readonly activeVehicleId?: string;
  readonly vehicles: Readonly<Record<string, VehicleState>>;
  readonly jobs: readonly JobState[];
  readonly quests: readonly QuestState[];
  readonly world: World | null;
  readonly rngState: RngState;
}

function isSaveGameV1(value: UnknownRecord): value is UnknownRecord & SaveGameV1 {
  return (
    value['schemaVersion'] === 1 &&
    typeof value['location'] === 'string' &&
    typeof value['currentDay'] === 'number' &&
    (value['phase'] === 'DAY' || value['phase'] === 'NIGHT') &&
    typeof value['driver'] === 'object' &&
    value['driver'] !== null &&
    typeof value['vehicles'] === 'object' &&
    value['vehicles'] !== null
  );
}

/**
 * v1 -> v2: Classic/Safe save mode was introduced in v2, which needs a
 * `lastSafeCitySnapshot` to revert to. A v1 save has no better record of the
 * last safe city than its own current state, so that becomes the initial
 * snapshot; from then on gameplay code is responsible for refreshing it
 * whenever the driver is actually in a city.
 */
function migrateV1ToV2(input: UnknownRecord): UnknownRecord {
  if (!isSaveGameV1(input)) {
    throw new SaveMigrationError('schema v1 save failed shape validation while migrating to v2');
  }
  const { activeVehicleId, ...rest } = input;
  const lastSafeCitySnapshot: SaveGame['lastSafeCitySnapshot'] = {
    day: input.currentDay,
    phase: input.phase,
    location: input.location,
    driver: input.driver,
    vehicles: input.vehicles,
    ...(activeVehicleId !== undefined ? { activeVehicleId } : {}),
  };
  return {
    ...rest,
    ...(activeVehicleId !== undefined ? { activeVehicleId } : {}),
    schemaVersion: 2,
    lastSafeCitySnapshot,
  };
}

const MIGRATIONS: ReadonlyMap<number, (input: UnknownRecord) => UnknownRecord> = new Map([[1, migrateV1ToV2]]);

/**
 * Upgrades a raw, untyped save blob (as read back from storage) to the
 * current schema, applying every registered migration in order. Throws
 * `SaveMigrationError` if the blob has no version, an unsupported version,
 * or a migration step fails to advance the version.
 */
export function migrateSave(raw: unknown): SaveGame {
  if (!isSchemaVersioned(raw)) {
    throw new SaveMigrationError('save blob is missing a numeric schemaVersion');
  }

  // A blob from a NEWER build than this one carries a schemaVersion this
  // build has never heard of. The `while` loop below only ever counts UP to
  // CURRENT_SCHEMA_VERSION, so without this check it simply never runs for
  // version > CURRENT_SCHEMA_VERSION and falls straight through to the
  // final cast, opening a future save as if it were the current schema.
  if (raw.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new SaveMigrationError(
      `save schema version ${raw.schemaVersion} is newer than this build supports (current ${CURRENT_SCHEMA_VERSION})`,
    );
  }

  let current: UnknownRecord = raw;
  let version = raw.schemaVersion;

  while (version < CURRENT_SCHEMA_VERSION) {
    const upgrade = MIGRATIONS.get(version);
    if (!upgrade) {
      throw new SaveMigrationError(`no migration registered from schema version ${version}`);
    }
    current = upgrade(current);
    const next = current['schemaVersion'];
    if (typeof next !== 'number' || next <= version) {
      throw new SaveMigrationError(`migration from schema version ${version} did not advance schemaVersion`);
    }
    version = next;
  }

  // Structural validation, unconditionally - including the version ===
  // CURRENT_SCHEMA_VERSION case where the loop above never runs a single
  // migration step. A checksum only proves the bytes weren't corrupted in
  // transit/at rest; it says nothing about whether they were ever a
  // well-formed SaveGame, so a hand-edited or torn-but-self-consistent blob
  // at the current version must still be caught here rather than handed to
  // a caller as a plausible-looking `SaveGame` with core fields `undefined`.
  // `isSaveGame` is a type guard, so a successful check also removes the
  // need for a blind cast at the end.
  if (!isSaveGame(current)) {
    throw new SaveMigrationError(
      `save blob does not match schema v${CURRENT_SCHEMA_VERSION}: ${describeShapeErrors().join('; ')}`,
    );
  }

  return current;
}
