/**
 * JSON Schemas (ajv, draft-07) for the ten ruleset files, plus
 * `validateRulesets()` which narrows raw JSON into the typed `Rulesets`
 * aggregate or throws with a readable `file:/path message` on mismatch.
 *
 * Schemas describe SHAPE only. No gameplay numbers live here.
 */
import Ajv from 'ajv';
import type { ErrorObject, SchemaObject, ValidateFunction } from 'ajv';
import {
  BODY_CLASSES,
  FACINGS,
  SKILL_NAMES,
  WEAPON_MODES,
  type BodiesFile,
  type ChassisFile,
  type CitiesFile,
  type DrivingConfig,
  type EconomyConfig,
  type PlantsFile,
  type RulesetFileName,
  type Rulesets,
  type SkillsConfig,
  type SuspensionFile,
  type TiresFile,
  type WeaponsFile,
} from '@/sim/types';

// ---------------------------------------------------------------------------
// Schema building blocks
// ---------------------------------------------------------------------------

const NUM: SchemaObject = { type: 'number' };
const BOOL: SchemaObject = { type: 'boolean' };
const STR: SchemaObject = { type: 'string' };
const NON_EMPTY_STR: SchemaObject = { type: 'string', minLength: 1 };
const NON_NEG_INT: SchemaObject = { type: 'integer', minimum: 0 };
const NON_NEG_NUM: SchemaObject = { type: 'number', minimum: 0 };
const ID: SchemaObject = { type: 'string', pattern: '^[a-z0-9-]+$' };

function enumOf(values: readonly string[]): SchemaObject {
  return { type: 'string', enum: [...values] };
}

function arrayOf(items: SchemaObject, extra: SchemaObject = {}): SchemaObject {
  return { type: 'array', items, ...extra };
}

/** Closed object: every listed property, `required` keys mandatory, nothing else allowed. */
function obj(
  properties: Record<string, SchemaObject>,
  required: readonly string[] = Object.keys(properties),
): SchemaObject {
  return { type: 'object', properties, required: [...required], additionalProperties: false };
}

/** Object whose keys are exactly `keys`, each valued by `value`. */
function recordOf(keys: readonly string[], value: SchemaObject): SchemaObject {
  const properties: Record<string, SchemaObject> = {};
  for (const key of keys) properties[key] = value;
  return obj(properties, keys);
}

const SCHEMA_VERSION = { $schemaVersion: NON_NEG_INT } as const;

// ---------------------------------------------------------------------------
// Per-file schemas
// ---------------------------------------------------------------------------

export const bodiesSchema: SchemaObject = obj({
  ...SCHEMA_VERSION,
  bodies: arrayOf(
    obj({
      id: ID,
      name: NON_EMPTY_STR,
      price: NON_NEG_INT,
      weightLb: NON_NEG_INT,
      baseMaxLoadLb: NON_NEG_INT,
      spaces: NON_NEG_INT,
      class: enumOf(BODY_CLASSES),
      armorCostPerPoint: NON_NEG_INT,
      armorWeightPerPoint: NON_NEG_INT,
    }),
    { minItems: 1 },
  ),
  // Fixed vehicle-wide construction rules that aren't per-body rows — currently
  // just the tire count every design mounts (front + rear x2), see
  // fidelity-notes.yaml "bodies.vehicleLimits.wheelCount".
  vehicleLimits: obj({
    wheelCount: { type: 'integer', minimum: 1 },
  }),
});

export const chassisSchema: SchemaObject = obj({
  ...SCHEMA_VERSION,
  chassis: arrayOf(
    obj({
      id: ID,
      name: NON_EMPTY_STR,
      loadMultiplier: NON_NEG_NUM,
      bodyPriceModifier: NUM,
    }),
    { minItems: 1 },
  ),
});

export const suspensionSchema: SchemaObject = obj({
  ...SCHEMA_VERSION,
  suspension: arrayOf(
    obj({
      id: ID,
      name: NON_EMPTY_STR,
      bodyPriceModifier: NUM,
      handlingClass: recordOf(BODY_CLASSES, NON_NEG_INT),
    }),
    { minItems: 1 },
  ),
});

export const plantsSchema: SchemaObject = obj({
  ...SCHEMA_VERSION,
  accelerationTiers: arrayOf(
    obj({ powerRatio: NON_NEG_NUM, mphPerSecond: NON_NEG_NUM }),
    { minItems: 1 },
  ),
  plants: arrayOf(
    obj({
      id: ID,
      name: NON_EMPTY_STR,
      price: NON_NEG_INT,
      weightLb: NON_NEG_INT,
      spaces: NON_NEG_INT,
      maxDP: NON_NEG_INT,
      power: NON_NEG_INT,
      topSpeedMph: NON_NEG_INT,
      radarFailureThreshold: NON_NEG_INT,
    }),
    { minItems: 1 },
  ),
});

export const tiresSchema: SchemaObject = obj({
  ...SCHEMA_VERSION,
  tires: arrayOf(
    obj({
      id: ID,
      name: NON_EMPTY_STR,
      price: NON_NEG_INT,
      weightLb: NON_NEG_INT,
      maxDP: NON_NEG_INT,
      spikeImmune: BOOL,
    }),
    { minItems: 1 },
  ),
});

const damageSchema: SchemaObject = {
  oneOf: [
    obj({
      kind: { const: 'BURST' },
      checks: NON_NEG_INT,
      minPerCheck: NON_NEG_INT,
      maxPerCheck: NON_NEG_INT,
    }),
    obj({ kind: { const: 'RANGE' }, min: NON_NEG_INT, max: NON_NEG_INT }),
    obj({ kind: { const: 'NONE' } }),
  ],
};

const effectSchema: SchemaObject = {
  oneOf: [
    obj({ type: { const: 'SMOKE' }, durationTicks: NON_NEG_INT, radiusM: NON_NEG_NUM }),
    obj({ type: { const: 'IGNITE_WRECK' }, chance: { type: 'number', minimum: 0, maximum: 1 } }),
  ],
};

const deployableSchema: SchemaObject = {
  oneOf: [
    obj({
      kind: { const: 'MINE' },
      targetsFacing: enumOf(FACINGS),
      tireSplash: BOOL,
      lifetimeDays: NON_NEG_INT,
      triggerRadiusM: NON_NEG_NUM,
    }),
    obj({
      kind: { const: 'SPIKES' },
      targetsTiresOnly: BOOL,
      zeroVsSpikeImmune: BOOL,
      lifetimeDays: NON_NEG_INT,
      triggerRadiusM: NON_NEG_NUM,
    }),
    obj(
      {
        kind: { const: 'CLOUD' },
        radiusM: NON_NEG_NUM,
        lifetimeTicks: NON_NEG_INT,
        accuracyPenalty: NON_NEG_NUM,
        blocksLineOfSight: BOOL,
        drivingPenalty: NON_NEG_NUM,
        windshieldImpair: BOOL,
      },
      ['kind', 'radiusM', 'lifetimeTicks', 'accuracyPenalty'],
    ),
    obj({
      kind: { const: 'SLICK' },
      radiusM: NON_NEG_NUM,
      lifetimeTicks: NON_NEG_INT,
      controlPenalty: NON_NEG_NUM,
      speedCapFraction: { type: 'number', minimum: 0, maximum: 1 },
    }),
  ],
};

const WEAPON_REQUIRED = [
  'id',
  'name',
  'price',
  'weightLb',
  'spaces',
  'maxDP',
  'ammoCost',
  'ammoWeightLb',
  'ammoCapacity',
  'allowedFacings',
  'mode',
  'rangeM',
  'cooldownTicks',
  'baseAccuracy',
  'minChance',
  'maxChance',
  'skillAccuracyScale',
  'damageSkillDivisor',
  'damage',
  'effects',
] as const;

export const weaponsSchema: SchemaObject = obj(
  {
    ...SCHEMA_VERSION,
    _note: STR,
    weapons: arrayOf(
      obj(
        {
          id: ID,
          name: NON_EMPTY_STR,
          price: NON_NEG_INT,
          weightLb: NON_NEG_INT,
          spaces: NON_NEG_INT,
          maxDP: NON_NEG_INT,
          ammoCost: NON_NEG_INT,
          ammoWeightLb: NON_NEG_INT,
          ammoCapacity: NON_NEG_INT,
          allowedFacings: arrayOf(enumOf(FACINGS), { minItems: 1, uniqueItems: true }),
          mode: enumOf(WEAPON_MODES),
          rangeM: NON_NEG_NUM,
          cooldownTicks: NON_NEG_INT,
          baseAccuracy: NON_NEG_NUM,
          minChance: NON_NEG_NUM,
          maxChance: NON_NEG_NUM,
          skillAccuracyScale: NON_NEG_NUM,
          damageSkillDivisor: NON_NEG_NUM,
          damage: damageSchema,
          effects: arrayOf(effectSchema),
          minRangeM: NON_NEG_NUM,
          coneHalfAngleDeg: NON_NEG_NUM,
          projectileSpeedMps: NON_NEG_NUM,
          penetrationBonus: NON_NEG_INT,
          usesBattery: BOOL,
          batteryPerShot: NON_NEG_INT,
          ammoIncluded: BOOL,
          oneShot: BOOL,
          removeAfterFire: BOOL,
          deployable: deployableSchema,
        },
        WEAPON_REQUIRED,
      ),
      { minItems: 1 },
    ),
    _reconstruction: obj(
      {
        _note: STR,
        rearPenetrationWeights: obj(
          { plant: NON_NEG_INT, driver: NON_NEG_INT, cargo: NON_NEG_INT },
          ['plant', 'driver', 'cargo'],
        ),
      },
      ['rearPenetrationWeights'],
    ),
  },
  ['$schemaVersion', 'weapons', '_reconstruction'],
);

const SERVICE_IDS = [
  'busToAdjacentCity',
  'batteryRecharge',
  'truckStopRoomNight',
  'bodyArmor',
  'storeCar',
  'retrieveCar',
  'mechanicLesson',
  'arenaPractice',
  'clone',
  'braintapeUpdate',
  'medicalPerPoint',
  'drink',
] as const;

const TIME_COST_ACTIONS = [
  'walkInCity',
  'readRumor',
  'readRoadInfo',
  'readSchedule',
  'readJobList',
  'recharge',
  'buyBodyArmor',
  'bus',
  'buildCar',
  'weaponTransaction',
  'repairCar',
  'acceptCourierWork',
  'arenaEvent',
  'cloneOrUpdate',
  'mechanicLesson',
  'healOnePoint',
] as const;

const serviceSchema: SchemaObject = obj(
  {
    price: NON_NEG_INT,
    days: NON_NEG_INT,
    restoresTo: NON_NEG_INT,
    dp: NON_NEG_INT,
    paidOnRetrieval: NON_NEG_INT,
  },
  ['price', 'days'],
);

export const economySchema: SchemaObject = obj({
  ...SCHEMA_VERSION,
  startingCash: NON_NEG_INT,
  maxFleetSize: NON_NEG_INT,
  maxPayloads: NON_NEG_INT,
  salvageCountsAsPayload: BOOL,
  services: recordOf(SERVICE_IDS, serviceSchema),
  timeCostDays: recordOf(TIME_COST_ACTIONS, NON_NEG_INT),
  alwaysOpenFacilities: arrayOf(NON_EMPTY_STR, { uniqueItems: true }),
  _reconstruction: obj(
    {
      _note: STR,
      saleValueConditionFloor: { type: 'number', minimum: 0, maximum: 1 },
      saleValueConditionCeiling: { type: 'number', minimum: 0, maximum: 1 },
      repairCostFactor: NON_NEG_NUM,
      salvageBaseChance: NON_NEG_NUM,
      salvageMechanicScale: NON_NEG_NUM,
      salvageBurnPenalty: NON_NEG_NUM,
      salvageChanceMin: NON_NEG_NUM,
      salvageChanceMax: NON_NEG_NUM,
      latePayDecayPerDay: NON_NEG_NUM,
      collisionArmorLossSpeedMph: NON_NEG_NUM,
      cargoFullIntegrity: NON_NEG_NUM,
    },
    [
      'saleValueConditionFloor',
      'saleValueConditionCeiling',
      'repairCostFactor',
      'salvageBaseChance',
      'salvageMechanicScale',
      'salvageBurnPenalty',
      'salvageChanceMin',
      'salvageChanceMax',
      'latePayDecayPerDay',
      'collisionArmorLossSpeedMph',
      'cargoFullIntegrity',
    ],
  ),
  casino: obj({
    poker: obj({
      pair: NON_NEG_INT,
      twoPair: NON_NEG_INT,
      threeOfAKind: NON_NEG_INT,
      straight: NON_NEG_INT,
      flush: NON_NEG_INT,
      fullHouse: NON_NEG_INT,
      fourOfAKind: NON_NEG_INT,
      straightFlush: NON_NEG_INT,
      allowDiscardAllFive: BOOL,
      allowAceLowStraight: BOOL,
      minRank: NON_NEG_INT,
      maxRank: NON_NEG_INT,
      handSize: NON_NEG_INT,
    }),
    blackjack: obj({
      dealerHitsThrough: NON_NEG_INT,
      dealerWinsTies: BOOL,
      fiveCardNonBustWins: BOOL,
      exactTwentyOneWins: BOOL,
      ordinaryPayout: NON_NEG_INT,
      twoCardBlackjackPayout: NON_NEG_INT,
      targetScore: NON_NEG_INT,
      aceHighValue: NON_NEG_INT,
      aceLowValue: NON_NEG_INT,
      faceCardValue: NON_NEG_INT,
      faceCardMinRank: NON_NEG_INT,
      fiveCardCount: NON_NEG_INT,
    }),
  }),
});

export const skillsSchema: SchemaObject = obj({
  ...SCHEMA_VERSION,
  startingSkillPool: NON_NEG_INT,
  skillMin: NON_NEG_INT,
  skillMax: NON_NEG_INT,
  skills: arrayOf(enumOf(SKILL_NAMES), { minItems: SKILL_NAMES.length, uniqueItems: true }),
  driver: obj({
    naturalHealthDP: NON_NEG_INT,
    bodyArmorDP: NON_NEG_INT,
    bodyArmorRepairable: BOOL,
    prestigeFloor: NON_NEG_INT,
    nameMaxLength: NON_NEG_INT,
  }),
  startingLocation: ID,
  startingDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  _reconstruction: obj(
    {
      _note: STR,
      driving: obj({
        handlingClassWeight: NUM,
        drivingSkillWeight: NUM,
        tireIntegrityBonusPerTire: NUM,
        destroyedTirePenalty: NUM,
        controlScoreMin: NUM,
        controlScoreMax: NUM,
        turnStressThreshold: NUM,
        turnStressDecayPerSecond: NUM,
        speedPenaltyScale: NUM,
        oilSurfacePenalty: NUM,
        controlLossTicksMin: NON_NEG_INT,
        controlLossTicksMax: NON_NEG_INT,
        handlingScaleDivisor: { type: 'number', exclusiveMinimum: 0 },
        minTireHandlingFactor: NON_NEG_NUM,
      }),
      marksmanship: obj({ skillPivot: NUM }),
      mechanic: obj({
        lessonGainBase: NUM,
        lessonGainSkillScale: NUM,
        lessonGainMin: NUM,
        lessonGainMax: NUM,
        lessonGainMinPoints: NON_NEG_INT,
        lessonGainMaxPoints: NON_NEG_INT,
        salvageSkillGainWeights: arrayOf(NON_NEG_NUM, { minItems: 1 }),
      }),
      prestigeGates: arrayOf(NON_NEG_INT, { minItems: 1 }),
    },
    ['driving', 'marksmanship', 'mechanic', 'prestigeGates'],
  ),
});

export const drivingSchema: SchemaObject = obj(
  {
    ...SCHEMA_VERSION,
    _note: STR,
    tickRateHz: { type: 'integer', minimum: 1 },
    metersPerMile: { type: 'number', exclusiveMinimum: 0 },
    maxReverseSpeedMph: NON_NEG_NUM,
    reverseInputDotThreshold: { type: 'number', minimum: -1, maximum: 1 },
    reverseThresholdMph: NON_NEG_NUM,
    baseTurnRateDegPerSec: NON_NEG_NUM,
    speedTurnCurveExponent: NON_NEG_NUM,
    brakeRateMphPerSec: NON_NEG_NUM,
    coastDragMphPerSec: NON_NEG_NUM,
    reverseAccelMphPerSec: NON_NEG_NUM,
    battery: obj({
      full: NON_NEG_INT,
      movementDrainPerMileBase: NON_NEG_NUM,
      weightPowerRatioScale: NON_NEG_NUM,
      speedFractionScale: NON_NEG_NUM,
    }),
    collision: obj({
      armorLossSpeedMph: NON_NEG_NUM,
      armorLossFacing: enumOf(FACINGS),
      armorLossPoints: NON_NEG_INT,
    }),
    radar: obj({ rangeMiles: NON_NEG_NUM, visualRangeM: NON_NEG_NUM }),
    pedestrian: obj({
      speedMps: NON_NEG_NUM,
      colliderRadiusM: NON_NEG_NUM,
      interactionRadiusM: NON_NEG_NUM,
    }),
  },
  [
    '$schemaVersion',
    'tickRateHz',
    'metersPerMile',
    'maxReverseSpeedMph',
    'reverseInputDotThreshold',
    'reverseThresholdMph',
    'baseTurnRateDegPerSec',
    'speedTurnCurveExponent',
    'brakeRateMphPerSec',
    'coastDragMphPerSec',
    'reverseAccelMphPerSec',
    'battery',
    'collision',
    'radar',
    'pedestrian',
  ],
);

const championshipsSchema: SchemaObject = obj(
  {
    _note: STR,
    cadenceDays: { type: 'integer', exclusiveMinimum: 0 },
    // Keyed by city id - not every city runs a championship, so this is an
    // open map rather than a closed set of properties.
    firstDay: { type: 'object', additionalProperties: NON_NEG_INT },
  },
  ['cadenceDays', 'firstDay'],
);

export const citiesSchema: SchemaObject = obj(
  {
    ...SCHEMA_VERSION,
    _note: STR,
    _cityCountNote: STR,
    facilityKinds: arrayOf(ID, { minItems: 1, uniqueItems: true }),
    cities: arrayOf(
      obj({
        id: ID,
        name: NON_EMPTY_STR,
        x: { type: 'number', minimum: 0, maximum: 1 },
        y: { type: 'number', minimum: 0, maximum: 1 },
        facilities: arrayOf(ID, { minItems: 1, uniqueItems: true }),
      }),
      { minItems: 1 },
    ),
    routes: arrayOf(
      obj({
        id: ID,
        a: ID,
        b: ID,
        lengthMiles: NON_NEG_NUM,
        danger: NON_NEG_INT,
      }),
      { minItems: 1 },
    ),
    championships: championshipsSchema,
  },
  ['$schemaVersion', 'facilityKinds', 'cities', 'routes', 'championships'],
);

export const RULESET_SCHEMAS: Readonly<Record<RulesetFileName, SchemaObject>> = {
  bodies: bodiesSchema,
  chassis: chassisSchema,
  suspension: suspensionSchema,
  plants: plantsSchema,
  tires: tiresSchema,
  weapons: weaponsSchema,
  economy: economySchema,
  skills: skillsSchema,
  driving: drivingSchema,
  cities: citiesSchema,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Raw, unvalidated JSON for each of the nine files. */
export type RawRulesetInput = Record<RulesetFileName, unknown>;

export class RulesetValidationError extends Error {
  override readonly name = 'RulesetValidationError';
  constructor(
    readonly file: RulesetFileName,
    readonly problems: readonly string[],
  ) {
    super(`ruleset "${file}" failed validation:\n  ${problems.join('\n  ')}`);
  }
}

function describeError(file: RulesetFileName, err: ErrorObject): string {
  const path = err.instancePath === '' ? '/' : err.instancePath;
  let detail = err.message ?? 'is invalid';
  if (err.keyword === 'additionalProperties' && typeof err.params['additionalProperty'] === 'string') {
    detail += ` ("${err.params['additionalProperty']}")`;
  } else if (err.keyword === 'enum' && Array.isArray(err.params['allowedValues'])) {
    detail += `: ${JSON.stringify(err.params['allowedValues'])}`;
  }
  return `${file}.json:${path} ${detail}`;
}

interface Validators {
  bodies: ValidateFunction<BodiesFile>;
  chassis: ValidateFunction<ChassisFile>;
  suspension: ValidateFunction<SuspensionFile>;
  plants: ValidateFunction<PlantsFile>;
  tires: ValidateFunction<TiresFile>;
  weapons: ValidateFunction<WeaponsFile>;
  economy: ValidateFunction<EconomyConfig>;
  skills: ValidateFunction<SkillsConfig>;
  driving: ValidateFunction<DrivingConfig>;
  cities: ValidateFunction<CitiesFile>;
}

let validators: Validators | null = null;

function getValidators(): Validators {
  if (validators) return validators;
  const ajv = new Ajv({ allErrors: true, strict: true });
  validators = {
    bodies: ajv.compile<BodiesFile>(bodiesSchema),
    chassis: ajv.compile<ChassisFile>(chassisSchema),
    suspension: ajv.compile<SuspensionFile>(suspensionSchema),
    plants: ajv.compile<PlantsFile>(plantsSchema),
    tires: ajv.compile<TiresFile>(tiresSchema),
    weapons: ajv.compile<WeaponsFile>(weaponsSchema),
    economy: ajv.compile<EconomyConfig>(economySchema),
    skills: ajv.compile<SkillsConfig>(skillsSchema),
    driving: ajv.compile<DrivingConfig>(drivingSchema),
    cities: ajv.compile<CitiesFile>(citiesSchema),
  };
  return validators;
}

function check<T>(file: RulesetFileName, validate: ValidateFunction<T>, data: unknown): T {
  if (validate(data)) return data;
  const problems = (validate.errors ?? []).map((e) => describeError(file, e));
  throw new RulesetValidationError(file, problems.length > 0 ? problems : ['unknown schema error']);
}

/**
 * Cross-row checks the schema language cannot express (duplicate ids, min/max
 * order). `field` is the JSON-pointer segment the rows live under; it
 * defaults to `file` since that matches every array-of-the-whole-file case,
 * but a file with more than one top-level array (e.g. cities.json's `cities`
 * and `routes`) passes it explicitly.
 */
function checkInvariants(file: RulesetFileName, rows: readonly { id: string }[], field: string = file): void {
  const seen = new Set<string>();
  const problems: string[] = [];
  rows.forEach((row, i) => {
    if (seen.has(row.id)) problems.push(`${file}.json:/${field}/${i}/id duplicate id "${row.id}"`);
    seen.add(row.id);
  });
  if (problems.length > 0) throw new RulesetValidationError(file, problems);
}

function checkWeaponInvariants(weapons: WeaponsFile): void {
  const problems: string[] = [];
  weapons.weapons.forEach((w, i) => {
    const at = `weapons.json:/weapons/${i}`;
    if (w.minChance > w.maxChance) problems.push(`${at}/minChance exceeds maxChance`);
    if (w.damage.kind === 'RANGE' && w.damage.min > w.damage.max) problems.push(`${at}/damage/min exceeds max`);
    if (w.damage.kind === 'BURST' && w.damage.minPerCheck > w.damage.maxPerCheck) {
      problems.push(`${at}/damage/minPerCheck exceeds maxPerCheck`);
    }
    if (w.mode === 'DEPLOYABLE' && w.deployable === undefined) problems.push(`${at} DEPLOYABLE weapon has no "deployable" block`);
    if (w.mode !== 'DEPLOYABLE' && w.deployable !== undefined) problems.push(`${at} non-DEPLOYABLE weapon has a "deployable" block`);
    if (w.mode === 'CONE' && w.coneHalfAngleDeg === undefined) problems.push(`${at} CONE weapon has no coneHalfAngleDeg`);
    if (w.mode === 'PROJECTILE' && w.projectileSpeedMps === undefined) problems.push(`${at} PROJECTILE weapon has no projectileSpeedMps`);
    if (w.usesBattery === true && w.batteryPerShot === undefined) problems.push(`${at} usesBattery weapon has no batteryPerShot`);
  });
  if (problems.length > 0) throw new RulesetValidationError('weapons', problems);
}

const memo = new WeakMap<RawRulesetInput, Rulesets>();

/**
 * Validate all nine raw ruleset objects and return the typed aggregate.
 * Throws `RulesetValidationError` naming the file and JSON pointer of every problem.
 * Memoized per input object so repeated calls with the same bundle are free.
 */
export function validateRulesets(input: RawRulesetInput): Rulesets {
  const cached = memo.get(input);
  if (cached) return cached;

  const v = getValidators();
  const bodies = check('bodies', v.bodies, input.bodies);
  const chassis = check('chassis', v.chassis, input.chassis);
  const suspension = check('suspension', v.suspension, input.suspension);
  const plants = check('plants', v.plants, input.plants);
  const tires = check('tires', v.tires, input.tires);
  const weapons = check('weapons', v.weapons, input.weapons);
  const economy = check('economy', v.economy, input.economy);
  const skills = check('skills', v.skills, input.skills);
  const driving = check('driving', v.driving, input.driving);
  const cities = check('cities', v.cities, input.cities);

  checkInvariants('bodies', bodies.bodies);
  checkInvariants('chassis', chassis.chassis);
  checkInvariants('suspension', suspension.suspension);
  checkInvariants('plants', plants.plants);
  checkInvariants('tires', tires.tires);
  checkInvariants('weapons', weapons.weapons);
  checkWeaponInvariants(weapons);
  checkInvariants('cities', cities.cities, 'cities');
  checkInvariants('cities', cities.routes, 'routes');

  const result: Rulesets = { bodies, chassis, suspension, plants, tires, weapons, economy, skills, driving, cities };
  memo.set(input, result);
  return result;
}
