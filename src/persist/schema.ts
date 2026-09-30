/**
 * Structural JSON Schema (ajv, draft-07) for a persisted `SaveGame`, applied
 * as the last step of `migrateSave` regardless of whether any migration
 * actually ran.
 *
 * Why this exists: a generation record's checksum only proves the bytes read
 * back are the bytes written - it says nothing about whether those bytes are
 * a well-formed SaveGame. A hand-edited or partially-written blob like
 * `{"schemaVersion":2}` recomputes to a self-consistent checksum (nothing
 * corrupted it after the fact) and, at exactly `CURRENT_SCHEMA_VERSION`,
 * skips every migration step - so without a shape check here it sails
 * through as a "valid" SaveGame with `driver`, `vehicles`, `world`, etc. all
 * silently `undefined`. Callers then either crash on first field access
 * (classic-mode `applyLoadMode` reading `snapshot.day`) or, worse, resolve
 * with a plausible-looking but wrong value (safe mode). Validating the final
 * shape here turns both into one honest `SaveMigrationError` raised at the
 * one place that already understands "this blob doesn't load."
 *
 * Schema describes SHAPE only, matching `@/sim/types` and `@/sim/world`
 * field-for-field. No gameplay numbers live here.
 */
import Ajv from 'ajv';
import type { SchemaObject, ValidateFunction } from 'ajv';
import { drivingConfig } from '@/data/rulesets';
import { FACINGS, SKILL_NAMES } from '@/sim/types';
import type { SaveGame } from '@/persist/save';

// ---------------------------------------------------------------------------
// Schema building blocks (same shapes as @/data/schema.ts, kept local so the
// persist module doesn't reach into the ruleset loader for them)
// ---------------------------------------------------------------------------

const NUM: SchemaObject = { type: 'number' };
const INT: SchemaObject = { type: 'integer' };
const BOOL: SchemaObject = { type: 'boolean' };
const STR: SchemaObject = { type: 'string' };
const NON_EMPTY_STR: SchemaObject = { type: 'string', minLength: 1 };
const NULLABLE_STR: SchemaObject = { type: ['string', 'null'] };

function enumOf(values: readonly string[]): SchemaObject {
  return { type: 'string', enum: [...values] };
}

function arrayOf(items: SchemaObject, extra: SchemaObject = {}): SchemaObject {
  return { type: 'array', items, ...extra };
}

/** Closed object: every listed property, `required` keys mandatory, nothing else allowed. */
function obj(properties: Record<string, SchemaObject>, required: readonly string[] = Object.keys(properties)): SchemaObject {
  return { type: 'object', properties, required: [...required], additionalProperties: false };
}

/** Object whose keys are exactly `keys`, each valued by `value`. */
function recordOf(keys: readonly string[], value: SchemaObject): SchemaObject {
  const properties: Record<string, SchemaObject> = {};
  for (const key of keys) properties[key] = value;
  return obj(properties, keys);
}

/** `schema`, or `null`. */
function nullable(schema: SchemaObject): SchemaObject {
  return { oneOf: [{ type: 'null' }, schema] };
}

const DAY_PHASE = enumOf(['DAY', 'NIGHT']);
const FACING = enumOf(FACINGS);
const ARENA_KIND = enumOf(['arena', 'route']);

// ---------------------------------------------------------------------------
// sim/types.ts shapes
// ---------------------------------------------------------------------------

const vec2Schema = obj({ x: NUM, y: NUM });

const armorRecordSchema = recordOf(FACINGS, NUM);

const mountedWeaponSchema = obj({
  weaponId: NON_EMPTY_STR,
  facing: FACING,
  ammo: INT,
});

const vehicleDesignSchema = obj({
  name: STR,
  bodyId: NON_EMPTY_STR,
  chassisId: NON_EMPTY_STR,
  suspensionId: NON_EMPTY_STR,
  plantId: NON_EMPTY_STR,
  tireId: NON_EMPTY_STR,
  armor: armorRecordSchema,
  weapons: arrayOf(mountedWeaponSchema),
});

const weaponStateSchema = obj({
  weaponId: NON_EMPTY_STR,
  facing: FACING,
  ammo: INT,
  dp: NUM,
  maxDP: NUM,
  cooldownRemaining: NUM,
  destroyed: BOOL,
});

const cargoStateSchema = obj({
  id: NON_EMPTY_STR,
  kind: enumOf(['payload', 'salvage']),
  weightLb: NUM,
  spaces: NUM,
  integrity: NUM,
});

const statusEffectSchema = obj({
  kind: STR,
  ticksRemaining: NUM,
  magnitude: NUM,
});

const tireDPTupleSchema: SchemaObject = {
  type: 'array',
  items: NUM,
  minItems: 4,
  maxItems: 4,
};

const vehicleStateSchema = obj({
  id: NON_EMPTY_STR,
  ownerId: NON_EMPTY_STR,
  design: vehicleDesignSchema,
  position: vec2Schema,
  headingRad: NUM,
  speedMps: NUM,
  // Sourced, not retyped: 99 is driving.json battery.full. A save schema that
  // hardcodes it would start rejecting valid saves the moment the ruleset changed.
  battery: { type: 'integer', minimum: 0, maximum: drivingConfig().battery.full },
  odometerMiles: NUM,
  armorDP: armorRecordSchema,
  tireDP: tireDPTupleSchema,
  plantDP: NUM,
  weapons: arrayOf(weaponStateSchema),
  cargo: arrayOf(cargoStateSchema),
  controlStress: NUM,
  controlLossTicks: NUM,
  statusEffects: arrayOf(statusEffectSchema),
  destroyed: BOOL,
  /**
   * Both added by `@/sim/driving` and BOTH OPTIONAL, because `obj()` below
   * makes `required` default to every declared property and a save written
   * before either field existed must still validate.
   *
   * `batteryDebt` is the fractional battery point carried between ticks so the
   * public `battery` stays a true integer. Its own type comment says it lives
   * on the vehicle "so it survives a save/load round-trip" — and until this
   * entry it could not: the schema rejected the property, `migrateSave` threw
   * `SaveMigrationError`, and `persistArenaSession` swallowed that into a
   * `console.warn`. So driving the car at all made every autosave fail, and a
   * player who reloaded lost everything since their last successful save with
   * no message on screen. Found by Codex `gpt-6.1-sol` driving the live build
   * and reading the console.
   *
   * The ranges are what the sim actually produces: `stepDriving` floors the
   * accumulated debt and carries the remainder, so a SAVED value is in [0, 1).
   * Only the lower bound is asserted — the upper end is a floating-point
   * remainder and a hard `maximum: 1` would reject a legitimate 0.99999999 from
   * a subtract that was not exact. The corruption worth catching here is a
   * negative or NaN debt, which would make drain never accumulate again.
   */
  batteryDebt: { type: 'number', minimum: 0 },
  /** Sustained spin-out direction, +1 or -1, chosen when a lockout begins. */
  controlLossSpinSign: { type: 'number', enum: [-1, 1] },
}, [
  'id', 'ownerId', 'design', 'position', 'headingRad', 'speedMps', 'battery',
  'odometerMiles', 'armorDP', 'tireDP', 'plantDP', 'weapons', 'cargo',
  'controlStress', 'controlLossTicks', 'statusEffects', 'destroyed',
]);

const vehicleRecordSchema: SchemaObject = {
  type: 'object',
  additionalProperties: vehicleStateSchema,
};

const skillRecordSchema = recordOf(SKILL_NAMES, INT);

const driverStateSchema = obj({
  name: STR,
  skills: skillRecordSchema,
  naturalHealth: NUM,
  bodyArmor: NUM,
  prestige: { ...INT, minimum: 0 },
  cash: INT,
  cityId: NON_EMPTY_STR,
  cloneCityId: NULLABLE_STR,
  cloneSkills: nullable(skillRecordSchema),
});

// ---------------------------------------------------------------------------
// @/util/rng shape
// ---------------------------------------------------------------------------

const rngStateSchema = obj({
  seedKey: NON_EMPTY_STR,
  words: { type: 'array', items: INT, minItems: 4, maxItems: 4 },
});

// ---------------------------------------------------------------------------
// @/sim/world shapes
// ---------------------------------------------------------------------------

const gameClockSchema = obj({ dayIndex: INT, phase: DAY_PHASE });

const projectileStateSchema = obj({
  id: NON_EMPTY_STR,
  ownerId: NON_EMPTY_STR,
  weaponId: NON_EMPTY_STR,
  position: vec2Schema,
  velocityMps: vec2Schema,
  ticksRemaining: NUM,
});

const deployableStateSchema = obj({
  id: NON_EMPTY_STR,
  ownerId: NON_EMPTY_STR,
  kind: STR,
  position: vec2Schema,
  radiusM: NUM,
  ticksRemaining: NUM,
});

const cloudStateSchema = obj({
  id: NON_EMPTY_STR,
  kind: STR,
  position: vec2Schema,
  radiusM: NUM,
  ticksRemaining: NUM,
});

const wreckStateSchema = obj({
  id: NON_EMPTY_STR,
  position: vec2Schema,
  headingRad: NUM,
  ticksRemaining: NUM,
});

const pedestrianStateSchema = obj({
  id: NON_EMPTY_STR,
  position: vec2Schema,
  headingRad: NUM,
  alive: BOOL,
});

const worldEntitiesSchema = obj({
  vehicles: arrayOf(vehicleStateSchema),
  projectiles: arrayOf(projectileStateSchema),
  deployables: arrayOf(deployableStateSchema),
  clouds: arrayOf(cloudStateSchema),
  wrecks: arrayOf(wreckStateSchema),
  pedestrians: arrayOf(pedestrianStateSchema),
});

const arenaContextSchema = obj({ id: NON_EMPTY_STR, kind: ARENA_KIND });

const worldSchema = obj({
  tick: { ...INT, minimum: 0 },
  clock: gameClockSchema,
  rngState: rngStateSchema,
  entities: worldEntitiesSchema,
  arena: arenaContextSchema,
});

// ---------------------------------------------------------------------------
// SaveGame shape
// ---------------------------------------------------------------------------

const jobStateSchema = obj({
  id: NON_EMPTY_STR,
  originCityId: NON_EMPTY_STR,
  destinationCityId: NON_EMPTY_STR,
  payout: INT,
  deadlineDay: INT,
  accepted: BOOL,
  completed: BOOL,
});

const questStateSchema = obj({
  id: NON_EMPTY_STR,
  stage: INT,
  completed: BOOL,
  flags: { type: 'object', additionalProperties: BOOL },
});

const safeCitySnapshotSchema = obj(
  {
    day: INT,
    phase: DAY_PHASE,
    location: NON_EMPTY_STR,
    driver: driverStateSchema,
    vehicles: vehicleRecordSchema,
    activeVehicleId: NON_EMPTY_STR,
  },
  ['day', 'phase', 'location', 'driver', 'vehicles'],
);

/**
 * A road trip in progress. Every field is REQUIRED once the object is present
 * — a half-written trip blob would resume into a trip whose progress axis or
 * origin is missing, which is worse than not resuming at all. The field itself
 * is optional on `SaveGame`, so every city save and every pre-existing fixture
 * is unaffected.
 *
 * Note what is NOT here: the route, and `RoadHazard.deployable`. Both are
 * re-derived from ids on resume, so this blob cannot disagree with
 * `cities.json` or `weapons.json` about a rule.
 */
const roadTripSchema = obj({
  originCityId: NON_EMPTY_STR,
  destinationCityId: NON_EMPTY_STR,
  startX: NUM,
  startY: NUM,
  routeHeadingRad: NUM,
  progressMiles: NUM,
  dayDebt: NUM,
  contacts: arrayOf(
    obj({
      id: NON_EMPTY_STR,
      faction: NON_EMPTY_STR,
      packId: NULLABLE_STR,
      routeMiles: NUM,
      attacked: BOOL,
      disposition: NON_EMPTY_STR,
    }),
  ),
  wrecks: arrayOf(
    obj({
      id: NON_EMPTY_STR,
      burned: BOOL,
      searched: BOOL,
      weapons: arrayOf(obj({ weaponId: NON_EMPTY_STR, ammo: NUM })),
      gear: arrayOf(obj({ id: NON_EMPTY_STR, weightLb: NUM, spaces: NUM })),
      positionX: NUM,
      positionY: NUM,
      createdDayIndex: INT,
    }),
  ),
  hazards: arrayOf(
    obj({
      id: NON_EMPTY_STR,
      weaponId: NON_EMPTY_STR,
      positionX: NUM,
      positionY: NUM,
      placedDayIndex: INT,
    }),
  ),
});

export const saveGameSchema: SchemaObject = obj(
  {
    schemaVersion: INT,
    rulesetVersion: NON_EMPTY_STR,
    seed: NUM,
    currentDay: INT,
    phase: DAY_PHASE,
    location: NON_EMPTY_STR,
    driver: driverStateSchema,
    activeVehicleId: NON_EMPTY_STR,
    vehicles: vehicleRecordSchema,
    jobs: arrayOf(jobStateSchema),
    quests: arrayOf(questStateSchema),
    world: nullable(worldSchema),
    rngState: rngStateSchema,
    lastSafeCitySnapshot: safeCitySnapshotSchema,
    // Optional (not in `required` below): absent from every save written
    // before this field existed, and from every pre-existing fixture in this
    // suite - see `SaveGame.controlPreset`'s own doc comment in @/persist/save.
    controlPreset: NON_EMPTY_STR,
    controlBindings: { type: 'object' },
    // Optional (not in `required`): a road trip in progress, absent from every
    // city save and every save written before this field existed. See
    // `SaveGame.roadTrip`'s own doc comment for why it stores two city ids
    // rather than the route.
    roadTrip: nullable(roadTripSchema),
  },
  [
    'schemaVersion',
    'rulesetVersion',
    'seed',
    'currentDay',
    'phase',
    'location',
    'driver',
    'vehicles',
    'jobs',
    'quests',
    'world',
    'rngState',
    'lastSafeCitySnapshot',
  ],
);

const ajv = new Ajv({ allErrors: true, strict: true });
const validate: ValidateFunction<SaveGame> = ajv.compile<SaveGame>(saveGameSchema);

/**
 * Type guard: narrows `data` to `SaveGame` when it matches the shape.
 * `describeShapeErrors()` reads the same compiled validator's `.errors`
 * synchronously right after a failed call - ajv sets it in place before
 * returning, so there is no gap for another validation to interleave and
 * overwrite it (this module has one Ajv instance and one compiled
 * validator, called from single-threaded, non-reentrant `migrateSave`).
 */
export function isSaveGame(data: unknown): data is SaveGame {
  return validate(data);
}

/** Human-readable messages for the most recent failed `isSaveGame()` call. */
export function describeShapeErrors(): readonly string[] {
  const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'failed schema validation'}`);
  return errors.length > 0 ? errors : ['unknown schema error'];
}
