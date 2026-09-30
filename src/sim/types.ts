/**
 * Shared domain types for the whole game. Every other module imports from here.
 * No gameplay numbers live in this file; they come from the ruleset JSON via
 * `@/data/rulesets`.
 */

// ---------------------------------------------------------------------------
// Primitive unions
// ---------------------------------------------------------------------------

export type Facing = 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT' | 'UNDERBODY';
export type BodyClass = 'automobile' | 'cargo';
export type WeaponMode = 'PROJECTILE' | 'HITSCAN' | 'CONE' | 'DEPLOYABLE';
export type DayPhase = 'DAY' | 'NIGHT';
export type SkillName = 'driving' | 'marksmanship' | 'mechanic';

export const FACINGS = ['FRONT', 'REAR', 'LEFT', 'RIGHT', 'UNDERBODY'] as const satisfies readonly Facing[];
export const BODY_CLASSES = ['automobile', 'cargo'] as const satisfies readonly BodyClass[];
export const WEAPON_MODES = ['PROJECTILE', 'HITSCAN', 'CONE', 'DEPLOYABLE'] as const satisfies readonly WeaponMode[];
export const SKILL_NAMES = ['driving', 'marksmanship', 'mechanic'] as const satisfies readonly SkillName[];

export function isFacing(value: unknown): value is Facing {
  return typeof value === 'string' && (FACINGS as readonly string[]).includes(value);
}

export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Vehicle body-local frame — THE single owner of "which local axis is the nose"
//
// This table existed FIVE times before, and four of the copies said +Y while
// the renderer said +X. Every subsystem was internally consistent: the shot
// flew along the mount table, the same table decided which facing absorbed it,
// the collider measured length on the same axis, the preview drew FRONT on it.
// Each was individually correct, so the 90-degree disagreement between the
// combat geometry and the DRIVEN car was invisible to file-by-file reading and
// survived 120 iterations and 82 vision reviews. It lives only in the SPACES
// BETWEEN subsystems — which is precisely what a duplication makes unreadable.
//
// The derivation, from the three sources that all agree the rendered nose is
// local +X:
//   - `assets/atlas.json` gives every car frame `rotationOffsetDeg: 270`.
//     `tests/unit/vehicle-sprite-orientation.test.ts` derives that value from
//     the RAW ART and documents the method (hood and windshield at the top,
//     rear louvres and bumper at the bottom, on all nine bodies), and its
//     comment states the reason: "nose at local +Y needs 270". So 270 maps the
//     art's nose-UP nose onto local +X.
//   - `@/sim/driving`'s `newForward = (cos h, sin h)` — a car's heading is a
//     world angle, so heading 0 must be world +X, and the renderer's
//     `rotationRad: vehicle.headingRad` inherits exactly that.
//   - `sprite.wgsl` applies that rotation in WORLD space, CCW, in an
//     up-positive frame (`buildOrthoMatrix` puts clip +y at the top).
//
// HANDEDNESS, which is the part a rotated table quietly gets backwards: CCW in
// that frame means a car pointing screen-RIGHT has its right hand screen-DOWN,
// which is -Y. So RIGHT is (0, -1) at heading 0, and LEFT is (0, +1).
// `combat.test.ts`'s antiparallel check is what pins this: a table with RIGHT
// at +Y satisfies every perpendicular check and fails that one.
// ---------------------------------------------------------------------------

/** The four facings a penetrating shot can be absorbed through. `UNDERBODY` has no direction and is excluded. */
export type PenetratingFacing = 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT';

/** Unit direction, in the vehicle's OWN local frame, each facing points. Rotated by `headingRad` to reach world space. */
export const VEHICLE_LOCAL_FACING: Record<PenetratingFacing, Vec2> = {
  FRONT: { x: 1, y: 0 },
  REAR: { x: -1, y: 0 },
  RIGHT: { x: 0, y: -1 },
  LEFT: { x: 0, y: 1 },
};

// ---------------------------------------------------------------------------
// Armor helpers
// ---------------------------------------------------------------------------

export type ArmorRecord = Record<Facing, number>;

/** Build an ArmorRecord with every facing set to `value`. */
export function makeArmorRecord(value: number): ArmorRecord {
  return { FRONT: value, REAR: value, LEFT: value, RIGHT: value, UNDERBODY: value };
}

/** Build an ArmorRecord by evaluating `fn` for each facing. */
export function mapFacings(fn: (facing: Facing) => number): ArmorRecord {
  return {
    FRONT: fn('FRONT'),
    REAR: fn('REAR'),
    LEFT: fn('LEFT'),
    RIGHT: fn('RIGHT'),
    UNDERBODY: fn('UNDERBODY'),
  };
}

export function sumArmor(armor: ArmorRecord): number {
  return armor.FRONT + armor.REAR + armor.LEFT + armor.RIGHT + armor.UNDERBODY;
}

// ---------------------------------------------------------------------------
// Ruleset definitions (mirror rulesets/classic/*.json exactly)
// ---------------------------------------------------------------------------

export interface BodyDef {
  id: string;
  name: string;
  price: number;
  weightLb: number;
  baseMaxLoadLb: number;
  spaces: number;
  class: BodyClass;
  armorCostPerPoint: number;
  armorWeightPerPoint: number;
  /** Oriented-rectangle collider length in metres (Reconstruction — see fidelity-notes.yaml). */
  colliderLengthM: number;
  /** Oriented-rectangle collider width in metres (Reconstruction). */
  colliderWidthM: number;
}

/**
 * Fixed vehicle-wide construction rules, not per-body-row data. Currently just
 * the tire count every design mounts (every classic-ruleset vehicle carries
 * four identical tires) - see fidelity-notes.yaml "bodies.vehicleLimits.wheelCount".
 */
export interface VehicleLimits {
  wheelCount: number;
}

export interface ChassisDef {
  id: string;
  name: string;
  loadMultiplier: number;
  bodyPriceModifier: number;
}

export interface SuspensionDef {
  id: string;
  name: string;
  bodyPriceModifier: number;
  handlingClass: Record<BodyClass, number>;
}

export interface AccelerationTier {
  powerRatio: number;
  mphPerSecond: number;
}

export interface PlantDef {
  id: string;
  name: string;
  price: number;
  weightLb: number;
  spaces: number;
  maxDP: number;
  power: number;
  topSpeedMph: number;
  radarFailureThreshold: number;
}

export interface TireDef {
  id: string;
  name: string;
  price: number;
  weightLb: number;
  maxDP: number;
  spikeImmune: boolean;
}

// --- weapon sub-shapes -------------------------------------------------------

export interface BurstDamage {
  kind: 'BURST';
  checks: number;
  minPerCheck: number;
  maxPerCheck: number;
}

export interface RangeDamage {
  kind: 'RANGE';
  min: number;
  max: number;
}

export interface NoDamage {
  kind: 'NONE';
}

export type WeaponDamage = BurstDamage | RangeDamage | NoDamage;

export interface SmokeEffect {
  type: 'SMOKE';
  durationTicks: number;
  radiusM: number;
}

export interface IgniteWreckEffect {
  type: 'IGNITE_WRECK';
  chance: number;
}

export type WeaponEffect = SmokeEffect | IgniteWreckEffect;

export interface MineDeployable {
  kind: 'MINE';
  targetsFacing: Facing;
  tireSplash: boolean;
  lifetimeDays: number;
  triggerRadiusM: number;
}

export interface SpikesDeployable {
  kind: 'SPIKES';
  targetsTiresOnly: boolean;
  zeroVsSpikeImmune: boolean;
  lifetimeDays: number;
  triggerRadiusM: number;
}

export interface CloudDeployable {
  kind: 'CLOUD';
  radiusM: number;
  lifetimeTicks: number;
  accuracyPenalty: number;
  blocksLineOfSight?: boolean;
  drivingPenalty?: number;
  windshieldImpair?: boolean;
}

export interface SlickDeployable {
  kind: 'SLICK';
  radiusM: number;
  lifetimeTicks: number;
  controlPenalty: number;
  speedCapFraction: number;
}

export type WeaponDeployable = MineDeployable | SpikesDeployable | CloudDeployable | SlickDeployable;

export interface WeaponDef {
  id: string;
  name: string;
  price: number;
  weightLb: number;
  spaces: number;
  maxDP: number;
  ammoCost: number;
  ammoWeightLb: number;
  ammoCapacity: number;
  allowedFacings: Facing[];
  mode: WeaponMode;
  rangeM: number;
  cooldownTicks: number;
  baseAccuracy: number;
  minChance: number;
  maxChance: number;
  skillAccuracyScale: number;
  damageSkillDivisor: number;
  damage: WeaponDamage;
  effects: WeaponEffect[];
  // Optional reconstruction / special-case fields
  minRangeM?: number;
  coneHalfAngleDeg?: number;
  projectileSpeedMps?: number;
  penetrationBonus?: number;
  usesBattery?: boolean;
  batteryPerShot?: number;
  ammoIncluded?: boolean;
  oneShot?: boolean;
  removeAfterFire?: boolean;
  deployable?: WeaponDeployable;
}

// --- economy -----------------------------------------------------------------

export type ServiceId =
  | 'busToAdjacentCity'
  | 'batteryRecharge'
  | 'truckStopRoomNight'
  | 'bodyArmor'
  | 'storeCar'
  | 'retrieveCar'
  | 'mechanicLesson'
  | 'arenaPractice'
  | 'clone'
  | 'braintapeUpdate'
  | 'medicalPerPoint'
  | 'drink';

export interface ServiceDef {
  price: number;
  days: number;
  restoresTo?: number;
  dp?: number;
  paidOnRetrieval?: number;
}

export type TimeCostAction =
  | 'walkInCity'
  | 'readRumor'
  | 'readRoadInfo'
  | 'readSchedule'
  | 'readJobList'
  | 'recharge'
  | 'buyBodyArmor'
  | 'bus'
  | 'buildCar'
  | 'weaponTransaction'
  | 'repairCar'
  | 'acceptCourierWork'
  | 'arenaEvent'
  | 'cloneOrUpdate'
  | 'mechanicLesson'
  | 'healOnePoint';

export interface EconomyReconstruction {
  _note?: string;
  saleValueConditionFloor: number;
  saleValueConditionCeiling: number;
  repairCostFactor: number;
  salvageBaseChance: number;
  salvageMechanicScale: number;
  salvageBurnPenalty: number;
  salvageChanceMin: number;
  salvageChanceMax: number;
  latePayDecayPerDay: number;
  collisionArmorLossSpeedMph: number;
  /** Integrity a freshly-recovered salvage item starts at, on the same scale damage.ts uses. */
  cargoFullIntegrity: number;
}

export interface PokerPayouts {
  pair: number;
  twoPair: number;
  threeOfAKind: number;
  straight: number;
  flush: number;
  fullHouse: number;
  fourOfAKind: number;
  straightFlush: number;
  allowDiscardAllFive: boolean;
  allowAceLowStraight: boolean;
  /** Lowest card rank in the deck (2). Deck shape, paired with `maxRank`. */
  minRank: number;
  /** Highest card rank in the deck (14 = Ace); also the ace-detection marker used by `handValue`. */
  maxRank: number;
  /** Cards dealt/held in a poker hand (5). Deck/hand structure - unrelated to blackjack's `fiveCardCount`. */
  handSize: number;
}

export interface BlackjackRules {
  dealerHitsThrough: number;
  dealerWinsTies: boolean;
  fiveCardNonBustWins: boolean;
  exactTwentyOneWins: boolean;
  ordinaryPayout: number;
  twoCardBlackjackPayout: number;
  /** Bust threshold / winning target (21). */
  targetScore: number;
  /** Value of an Ace counted high (11). */
  aceHighValue: number;
  /** Value of an Ace counted low, once counting it high would bust the hand (1). */
  aceLowValue: number;
  /** Value of a J/Q/K (10). */
  faceCardValue: number;
  /**
   * Lowest card RANK treated as a face card (11 = Jack). This is a card rank,
   * NOT a point value - it happens to equal `aceHighValue` (11 points) today,
   * but the two are semantically unrelated and must be tuned independently.
   */
  faceCardMinRank: number;
  /** Card count at which a non-bust hand wins outright when `fiveCardNonBustWins` is set (5). */
  fiveCardCount: number;
}

export interface CasinoConfig {
  poker: PokerPayouts;
  blackjack: BlackjackRules;
}

export interface EconomyConfig {
  $schemaVersion: number;
  startingCash: number;
  maxFleetSize: number;
  maxPayloads: number;
  salvageCountsAsPayload: boolean;
  services: Record<ServiceId, ServiceDef>;
  timeCostDays: Record<TimeCostAction, number>;
  alwaysOpenFacilities: string[];
  _reconstruction: EconomyReconstruction;
  casino: CasinoConfig;
}

// --- skills ------------------------------------------------------------------

export interface DriverConfig {
  naturalHealthDP: number;
  bodyArmorDP: number;
  bodyArmorRepairable: boolean;
  prestigeFloor: number;
  nameMaxLength: number;
}

export interface DrivingSkillCoefficients {
  handlingClassWeight: number;
  drivingSkillWeight: number;
  tireIntegrityBonusPerTire: number;
  destroyedTirePenalty: number;
  controlScoreMin: number;
  controlScoreMax: number;
  turnStressThreshold: number;
  turnStressDecayPerSecond: number;
  speedPenaltyScale: number;
  oilSurfacePenalty: number;
  controlLossTicksMin: number;
  controlLossTicksMax: number;
  /** Divisor turning handlingClassWeight/drivingSkillWeight/tireIntegrityBonusPerTire/destroyedTirePenalty/oilSurfacePenalty into fractional multipliers on `baseTurnRateDegPerSec` — the single knob that sets how hard any of those coefficients actually bites, instead of a bare `100` welded into the TS. */
  handlingScaleDivisor: number;
  /** Floor on the tire-condition handling multiplier (see `handlingScaleDivisor`): four destroyed tires degrade steering severely but must never reach a literal, permanent 0. */
  minTireHandlingFactor: number;
}

export interface MarksmanshipCoefficients {
  skillPivot: number;
}

export interface MechanicCoefficients {
  lessonGainBase: number;
  lessonGainSkillScale: number;
  lessonGainMin: number;
  lessonGainMax: number;
  lessonGainMinPoints: number;
  lessonGainMaxPoints: number;
  salvageSkillGainWeights: number[];
}

export interface SkillsReconstruction {
  _note?: string;
  driving: DrivingSkillCoefficients;
  marksmanship: MarksmanshipCoefficients;
  mechanic: MechanicCoefficients;
  prestigeGates: number[];
}

export interface SkillsConfig {
  $schemaVersion: number;
  startingSkillPool: number;
  skillMin: number;
  skillMax: number;
  skills: SkillName[];
  driver: DriverConfig;
  startingLocation: string;
  startingDate: string;
  _reconstruction: SkillsReconstruction;
}

// --- driving -----------------------------------------------------------------

export interface BatteryConfig {
  full: number;
  movementDrainPerMileBase: number;
  weightPowerRatioScale: number;
  speedFractionScale: number;
}

export interface CollisionConfig {
  armorLossSpeedMph: number;
  armorLossFacing: Facing;
  armorLossPoints: number;
  /** Radius used when testing a projectile against a vehicle collider. */
  projectileRadiusM: number;
  /** Minimum gap kept between two vehicles resolving a collision. */
  vehicleSeparationM: number;
  /** `vehicleSeparationM` scaled by this much is how close the player must be to a wreck to search it. */
  wreckSearchRangeMultiplier: number;
  /** `vehicleSeparationM` scaled by this much is the range within which a passed peaceful contact triggers the one-time "traffic passing" notice. */
  trafficPassRangeMultiplier: number;
}

/** Where arena opponents are placed at match start. */
export interface ArenaSpawnConfig {
  spawnRingRadiusM: number;
  minSpawnSeparationM: number;
}

export interface RadarConfig {
  rangeMiles: number;
  visualRangeM: number;
  /** `visualRangeM` scaled by this much sizes a road opponent's `decideAI` hazard-avoidance box. */
  aiHazardBoxRangeMultiplier: number;
}

export interface PedestrianConfig {
  speedMps: number;
  colliderRadiusM: number;
  interactionRadiusM: number;
}

/** Moving around a walled city on the `@/sim/city` plaza, as opposed to the highway. */
export interface CityDrivingConfig {
  _note?: string;
  /** How fast the player's own car crosses the plaza while the driver is riding it (`stepWalk`). Its own value, not the car's road top speed: a plaza is tens of meters across. */
  vehicleSpeedMps: number;
}

export interface DrivingConfig {
  $schemaVersion: number;
  _note?: string;
  tickRateHz: number;
  metersPerMile: number;
  maxReverseSpeedMph: number;
  reverseInputDotThreshold: number;
  reverseThresholdMph: number;
  baseTurnRateDegPerSec: number;
  speedTurnCurveExponent: number;
  brakeRateMphPerSec: number;
  coastDragMphPerSec: number;
  reverseAccelMphPerSec: number;
  battery: BatteryConfig;
  collision: CollisionConfig;
  arena: ArenaSpawnConfig;
  radar: RadarConfig;
  pedestrian: PedestrianConfig;
  city: CityDrivingConfig;
}

// --- raw file shapes (one per JSON file) --------------------------------------

export interface BodiesFile {
  $schemaVersion: number;
  bodies: BodyDef[];
  vehicleLimits: VehicleLimits;
}
export interface ChassisFile {
  $schemaVersion: number;
  chassis: ChassisDef[];
}
export interface SuspensionFile {
  $schemaVersion: number;
  suspension: SuspensionDef[];
}
export interface PlantsFile {
  $schemaVersion: number;
  accelerationTiers: AccelerationTier[];
  plants: PlantDef[];
}
export interface TiresFile {
  $schemaVersion: number;
  tires: TireDef[];
}
export interface RearPenetrationWeights {
  plant: number;
  driver: number;
  cargo: number;
}

export interface WeaponsReconstruction {
  _note?: string;
  /**
   * REAR-facing overflow lottery weights (see `applyPenetratingDamage` in
   * `@/sim/damage`). RECONSTRUCTION - tunable, see fidelity-notes.yaml.
   */
  rearPenetrationWeights: RearPenetrationWeights;
}

export interface WeaponsFile {
  $schemaVersion: number;
  _note?: string;
  weapons: WeaponDef[];
  _reconstruction: WeaponsReconstruction;
}

// --- cities ------------------------------------------------------------------

export interface CityDef {
  id: string;
  name: string;
  x: number;
  y: number;
  facilities: string[];
}

export interface RouteDef {
  id: string;
  a: string;
  b: string;
  lengthMiles: number;
  danger: number;
}

export interface ChampionshipsConfig {
  _note?: string;
  cadenceDays: number;
  /** Keyed by city id. */
  firstDay: Record<string, number>;
}

export interface CitiesFile {
  $schemaVersion: number;
  _note?: string;
  _cityCountNote?: string;
  facilityKinds: string[];
  cities: CityDef[];
  routes: RouteDef[];
  championships: ChampionshipsConfig;
}

/** The validated aggregate of all ten ruleset files. */
export interface Rulesets {
  bodies: BodiesFile;
  chassis: ChassisFile;
  suspension: SuspensionFile;
  plants: PlantsFile;
  tires: TiresFile;
  weapons: WeaponsFile;
  economy: EconomyConfig;
  skills: SkillsConfig;
  driving: DrivingConfig;
  cities: CitiesFile;
}

export type RulesetFileName = keyof Rulesets;

// ---------------------------------------------------------------------------
// Vehicle design & build
// ---------------------------------------------------------------------------

export interface MountedWeapon {
  weaponId: string;
  facing: Facing;
  ammo: number;
}

export interface VehicleDesign {
  name: string;
  bodyId: string;
  chassisId: string;
  suspensionId: string;
  plantId: string;
  tireId: string;
  armor: Record<Facing, number>;
  weapons: MountedWeapon[];
}

export interface BuildViolation {
  code: string;
  message: string;
}

export interface BuildMetrics {
  costTotal: number;
  weightTotal: number;
  maxLoadLb: number;
  spacesUsed: number;
  spacesTotal: number;
  handlingClass: number;
  accelMphPerSec: number | null;
  topSpeedMph: number;
  legal: boolean;
  violations: BuildViolation[];
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface WeaponState {
  weaponId: string;
  facing: Facing;
  ammo: number;
  dp: number;
  maxDP: number;
  cooldownRemaining: number;
  destroyed: boolean;
  /**
   * A one-shot weapon (`removeAfterFire`) that has fired its round. Distinct
   * from `destroyed`: a spent launcher tube is still bolted to the hull and
   * still absorbs penetrating damage (see `applyPenetratingDamage`) — it is
   * only unfireable, never destroyed, from spending its shot.
   */
  spent?: boolean;
}

export interface CargoState {
  id: string;
  kind: 'payload' | 'salvage';
  weightLb: number;
  spaces: number;
  integrity: number;
}

export interface StatusEffect {
  kind: string;
  ticksRemaining: number;
  magnitude: number;
}

export type TireDPTuple = [number, number, number, number];

export interface VehicleState {
  id: string;
  ownerId: string;
  design: VehicleDesign;
  position: Vec2;
  headingRad: number;
  speedMps: number;
  /** Integer 0..99 */
  battery: number;
  odometerMiles: number;
  armorDP: Record<Facing, number>;
  tireDP: TireDPTuple;
  plantDP: number;
  weapons: WeaponState[];
  cargo: CargoState[];
  controlStress: number;
  controlLossTicks: number;
  /** Sustained spin-out direction (+1/-1) while `controlLossTicks > 0`; meaningless (and unread) otherwise. Chosen once from the seeded `Rng` when a lockout begins so heading keeps rotating one consistent way for its whole duration instead of oscillating. */
  controlLossSpinSign?: number;
  statusEffects: StatusEffect[];
  destroyed: boolean;
  /**
   * Fractional battery point carried between ticks so the public `battery`
   * field stays a true integer while drain (see `driving.json`'s `battery`
   * block) accumulates exactly. Lives on the vehicle (not threaded through
   * `stepDriving` by the caller) so it survives a save/load round-trip and a
   * `rechargeBattery()` call resets it atomically instead of relying on every
   * caller to remember to. Optional so a pre-existing save/fixture without it
   * is read as 0.
   */
  batteryDebt?: number;
}

export interface DriverState {
  name: string;
  skills: Record<SkillName, number>;
  naturalHealth: number;
  bodyArmor: number;
  prestige: number;
  /** Integer dollars */
  cash: number;
  cityId: string;
  cloneCityId: string | null;
  cloneSkills: Record<SkillName, number> | null;
}

export interface GameClock {
  dayIndex: number;
  phase: DayPhase;
}
