/**
 * Driving model: classic direction-and-throttle steering, control loss,
 * collisions, and battery drain. Pure functions over `VehicleState` — no
 * Math.random(), no Date.now(), no GPU. Every tunable number is read from
 * `driving.json` / `skills.json._reconstruction.driving` via `@/data/rulesets`;
 * nothing gameplay-numeric is literal in this file.
 *
 * Classic control contract (see docs/SPEC.md "Controls"): the input vector's
 * DIRECTION sets desired heading, its MAGNITUDE (clamped 0..1) sets desired
 * speed as a fraction of top speed. Centering the stick coasts to a stop
 * (gentle `coastDragMphPerSec`); it does not brake hard. Pulling opposite to
 * the car's current heading brakes to zero first, then reverses, capped at
 * `maxReverseSpeedMph` regardless of the design's top speed.
 *
 * `@/sim/driver`'s `controlScore(hc, driving, tireBonus, turnStress,
 * surfacePenalty, speedPenalty)` does the scoring; this module computes each
 * of those signed inputs (tire condition, current stress, surface, speed)
 * and rolls the result against the world's seeded `Rng`.
 */
import { controlScore } from '@/sim/driver';

import {
  accelerationTiers,
  drivingConfig,
  getBody,
  getPlant,
  getSuspension,
  getTire,
  getWeapon,
  skillsConfig,
  wheelCount,
} from '@/data/rulesets';
import { sumArmor } from '@/sim/types';
import type { DrivingSkillCoefficients, Facing, TireDPTuple, Vec2, VehicleState } from '@/sim/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A deterministic, seeded random source. The world owns the instance; this module only draws from it. */
export interface Rng {
  /** Returns a float in the half-open interval [0, 1). */
  next(): number;
}

/** Surface the vehicle currently occupies. Combat deployables (oil, paint) are read by the caller; driving only needs the classification. */
export type SurfaceEffect = 'normal' | 'oil' | 'paint';

/** Direction-and-throttle input: length (clamped 0..1) is desired speed as a fraction of top speed, direction is desired heading. The zero vector means the stick is centered. */
export interface DriveInput {
  stick: Vec2;
}

export interface StepDrivingParams {
  vehicle: VehicleState;
  input: DriveInput;
  dtSeconds: number;
  rng: Rng;
  /** The driver's current `driving` skill, 0..99. */
  drivingSkill: number;
  surface: SurfaceEffect;
}

export interface StepDrivingResult {
  vehicle: VehicleState;
}

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function vecLength(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Wraps to (-PI, PI]. */
function normalizeAngle(rad: number): number {
  let a = rad % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

function rotateToward(current: number, target: number, maxDelta: number): number {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(delta) * maxDelta);
}

/** Moves `current` toward `target` by at most `maxDelta`, never overshooting. */
function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return current;
}

export function mphToMps(mph: number, metersPerMile: number): number {
  return (mph * metersPerMile) / 3600;
}

export function mpsToMph(mps: number, metersPerMile: number): number {
  return (mps * 3600) / metersPerMile;
}

// ---------------------------------------------------------------------------
// Ruleset-derived vehicle facts
// ---------------------------------------------------------------------------

/**
 * Full vehicle weight per the construction formula in docs/SPEC.md:
 * `body + plant + 4*tire + weapons + ammo + armorPoints*armorWeightPerPoint + cargo`.
 * Uses the DESIGN's assigned armor (weight doesn't change as armor takes damage).
 */
export function computeVehicleWeightLb(vehicle: VehicleState): number {
  const body = getBody(vehicle.design.bodyId);
  const plant = getPlant(vehicle.design.plantId);
  const tire = getTire(vehicle.design.tireId);
  const armorPoints = sumArmor(vehicle.design.armor);

  let weaponsAndAmmoWeight = 0;
  for (const weapon of vehicle.weapons) {
    const def = getWeapon(weapon.weaponId);
    weaponsAndAmmoWeight += def.weightLb + def.ammoWeightLb * weapon.ammo;
  }

  let cargoWeight = 0;
  for (const cargo of vehicle.cargo) cargoWeight += cargo.weightLb;

  return (
    body.weightLb +
    plant.weightLb +
    // wheelCount() rather than a literal 4: construct.ts already sources it, and a
    // mutation proved these two silently disagreed under any other wheel count —
    // bodies.json wheelCount 4 -> 6 left driving.test.ts fully green while the
    // constructor's golden tests failed, i.e. the car you BUILD and the car you
    // DRIVE would have had different masses.
    wheelCount() * tire.weightLb +
    weaponsAndAmmoWeight +
    cargoWeight +
    armorPoints * body.armorWeightPerPoint
  );
}

/**
 * Looks up the acceleration tier (mph/s) for a plant's power against a
 * vehicle's total weight, per plants.json's `accelerationTiers`. Returns
 * `null` when the design is genuinely below every tier — docs/SPEC.md's
 * `power >= weight/3` boundary is ILLEGAL below that, never a plausible-
 * looking 0 mph/s. `@/sim/construct` rejects this at build time, but salvage
 * cargo added after construction can push an already-legal build past it
 * with no re-validation, so `stepDriving` has to handle `null` itself.
 */
export function accelMphPerSecondFor(power: number, weightLb: number): number | null {
  for (const tier of orderedAccelerationTiers()) {
    // tier.powerRatio is a ruleset-supplied decimal approximation of 1/1,
    // 1/2, 1/3 (see @/sim/construct's identical fix): comparing the ratio as
    // a float drifts past the true weight/3 boundary for the exact case
    // docs/SPEC.md calls out. Comparing via the rounded integer reciprocal
    // (power * 3 >= weight) is exact and isn't sensitive to how many decimal
    // places the ruleset chose.
    const ratioDenominator = Math.round(1 / tier.powerRatio);
    if (power * ratioDenominator >= weightLb) return tier.mphPerSecond;
  }
  return null;
}

/** Tiers sorted by descending powerRatio so the first match is the best-fitting one — mirrors `@/sim/construct`'s `orderedAccelerationTiers`, kept private here since only this module's lookup needs it. */
function orderedAccelerationTiers() {
  return [...accelerationTiers()].sort((a, b) => b.powerRatio - a.powerRatio);
}

/** True once plant damage has fallen to or below the plant's radar failure threshold. */
export function isRadarDisabled(plantDP: number, radarFailureThreshold: number): boolean {
  return plantDP <= radarFailureThreshold;
}

// ---------------------------------------------------------------------------
// Handling
// ---------------------------------------------------------------------------

interface HandlingInputs {
  coefficients: DrivingSkillCoefficients;
  handlingClass: number;
  drivingSkill: number;
  tireDP: TireDPTuple;
  tireMaxDP: number;
  surface: SurfaceEffect;
}

/** Signed tire-condition contribution shared by the continuous handling multiplier and the discrete control check: a bonus per intact tire scaled by its remaining integrity, a flat penalty per destroyed tire. */
function tireHandlingBonus(coefficients: DrivingSkillCoefficients, tireDP: TireDPTuple, tireMaxDP: number): number {
  let bonus = 0;
  for (const dp of tireDP) {
    if (dp <= 0) {
      bonus -= coefficients.destroyedTirePenalty;
    } else {
      const integrityFraction = tireMaxDP > 0 ? dp / tireMaxDP : 0;
      bonus += integrityFraction * coefficients.tireIntegrityBonusPerTire;
    }
  }
  return bonus;
}

// No dedicated "paint" constant exists in the ruleset; both slick deployables
// share `oilSurfacePenalty` (Reconstruction, see docs/SPEC.md).
function surfacePenaltyFor(surface: SurfaceEffect, coefficients: DrivingSkillCoefficients): number {
  return surface === 'normal' ? 0 : coefficients.oilSurfacePenalty;
}

/** The multiplier applied to `baseTurnRateDegPerSec`, combining suspension class, driver skill, tire integrity, and surface. 0 at the low end (cannot meaningfully steer), uncapped at the high end. */
export function computeHandlingResponse(inputs: HandlingInputs): number {
  const { coefficients, handlingClass, drivingSkill, tireDP, tireMaxDP, surface } = inputs;

  const divisor = coefficients.handlingScaleDivisor;

  const classSkillBonus = handlingClass * coefficients.handlingClassWeight + drivingSkill * coefficients.drivingSkillWeight;
  const classSkillFactor = 1 + classSkillBonus / divisor;

  const tireBonus = tireHandlingBonus(coefficients, tireDP, tireMaxDP);
  // Floored above 0: four destroyed tires must degrade steering severely,
  // never make it literally and permanently impossible (docs/SPEC.md only
  // documents destroyed tires feeding "control loss", not a hard lockout).
  const tireFactor = clamp((divisor + tireBonus) / divisor, coefficients.minTireHandlingFactor, Number.POSITIVE_INFINITY);

  const surfacePenaltyPercent = surfacePenaltyFor(surface, coefficients);
  const surfaceFactor = clamp((divisor - surfacePenaltyPercent) / divisor, 0, 1);

  return Math.max(0, classSkillFactor * tireFactor * surfaceFactor);
}

// ---------------------------------------------------------------------------
// Control loss
// ---------------------------------------------------------------------------

interface ControlCheckInputs extends HandlingInputs {
  controlStress: number;
  speedFraction: number;
}

function rollControlCheck(rng: Rng, inputs: ControlCheckInputs): boolean {
  const tireBonus = tireHandlingBonus(inputs.coefficients, inputs.tireDP, inputs.tireMaxDP);
  const surfacePenalty = surfacePenaltyFor(inputs.surface, inputs.coefficients);
  const speedPenalty = inputs.speedFraction * inputs.coefficients.speedPenaltyScale;
  const score = controlScore(inputs.handlingClass, inputs.drivingSkill, tireBonus, inputs.controlStress, surfacePenalty, speedPenalty);
  return rng.next() * 100 < score;
}

function seededLockTicks(rng: Rng, coefficients: DrivingSkillCoefficients): number {
  const span = coefficients.controlLossTicksMax - coefficients.controlLossTicksMin;
  return coefficients.controlLossTicksMin + Math.floor(rng.next() * (span + 1));
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

/**
 * A collision above `collision.armorLossSpeedMph` removes exactly
 * `collision.armorLossPoints` from `collision.armorLossFacing` (FRONT),
 * regardless of what was struck. Below the threshold, nothing changes.
 */
export function applyCollision(vehicle: VehicleState, impactSpeedMph: number): VehicleState {
  const config = drivingConfig();
  if (impactSpeedMph <= config.collision.armorLossSpeedMph) return vehicle;

  const facing: Facing = config.collision.armorLossFacing;
  const current = vehicle.armorDP[facing];
  const next = Math.max(0, current - config.collision.armorLossPoints);
  if (next === current) return vehicle;

  return { ...vehicle, armorDP: { ...vehicle.armorDP, [facing]: next } };
}

/**
 * Zeroes speed on impact with an impenetrable obstacle (a fence). Deliberately
 * does nothing else: no "stuck" flag exists anywhere in this module, so the
 * very next `stepDriving()` call accelerates forward or reverse exactly as
 * normal input dictates — a fence stops the car, it never traps it.
 */
export function stopAtObstacle(vehicle: VehicleState): VehicleState {
  if (vehicle.speedMps === 0) return vehicle;
  return { ...vehicle, speedMps: 0 };
}

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

/** Recharges to a full battery (99) and atomically zeroes the carried fractional `batteryDebt` — both live on the vehicle, so there is nothing left for a caller to remember to reset. */
export function rechargeBattery(vehicle: VehicleState): VehicleState {
  const config = drivingConfig();
  if (vehicle.battery === config.battery.full && (vehicle.batteryDebt ?? 0) === 0) return vehicle;
  return { ...vehicle, battery: config.battery.full, batteryDebt: 0 };
}

function batteryDrainPerMile(weightLb: number, power: number, speedFraction: number): number {
  const config = drivingConfig().battery;
  // `power` is schema-constrained to >= 1 (see POSITIVE_INT in data/schema.ts),
  // so this cannot divide by zero today. The guard is kept anyway because the
  // failure mode is severe and silent: Infinity here drains the battery to 0 on
  // the first tick AND makes `batteryDebt` NaN, which then never drains again
  // because `NaN > 0` is false. A car that can never regain its battery with no
  // error logged is a very expensive mystery.
  const weightPowerRatio = power > 0 ? weightLb / power : 0;
  return (
    config.movementDrainPerMileBase *
    (1 + config.weightPowerRatioScale * weightPowerRatio) *
    (1 + config.speedFractionScale * speedFraction)
  );
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------

export function stepDriving(params: StepDrivingParams): StepDrivingResult {
  const { vehicle, input, dtSeconds, rng, drivingSkill, surface } = params;

  if (vehicle.destroyed) {
    return { vehicle };
  }

  const config = drivingConfig();
  const coefficients = skillsConfig()._reconstruction.driving;
  const body = getBody(vehicle.design.bodyId);
  const suspension = getSuspension(vehicle.design.suspensionId);
  const plant = getPlant(vehicle.design.plantId);
  const tire = getTire(vehicle.design.tireId);

  const handlingClass = suspension.handlingClass[body.class];
  // Schema guarantees >= 1. Clamped defensively because this value is the
  // denominator of FOUR speed-fraction computations, and 0 would make
  // `clamp(x / 0, 0, 1)` NaN — which `clamp` does NOT catch, because
  // `Math.max(0, NaN)` is NaN. A NaN heading is unrecoverable: every later
  // collision test silently returns false and the car drives off forever.
  const topSpeedMph = Math.max(1, plant.topSpeedMph);
  const canAccelerate = vehicle.plantDP > 0;

  const startHeadingRad = vehicle.headingRad;
  const startSpeedMph = mpsToMph(vehicle.speedMps, config.metersPerMile);
  const forward: Vec2 = { x: Math.cos(startHeadingRad), y: Math.sin(startHeadingRad) };
  const stickLen = vecLength(input.stick);
  const dir: Vec2 = stickLen > 0 ? { x: input.stick.x / stickLen, y: input.stick.y / stickLen } : { x: 0, y: 0 };
  // Pulling the stick opposite to the car's current heading is a special case
  // (SPEC "Controls"): it brakes then reverses IN PLACE. It must NOT be read
  // as "steer the nose to face this direction" — that would spin the car
  // around instead of backing up, and blow straight through the reverse cap.
  const wantsOpposite = stickLen > 0 && dir.x * forward.x + dir.y * forward.y < config.reverseInputDotThreshold;

  // A control-loss lockout is a genuine spin-out: the driver has no
  // meaningful throttle, brake, or steering authority for its whole
  // duration, not just a cosmetic heading wobble laid on top of full player
  // control (see the heading block below for the sustained-spin half of this).
  const wasLocked = vehicle.controlLossTicks > 0;

  // --- Speed: throttle / brake / coast / reverse --------------------------
  let speedMph = startSpeedMph;
  if (wasLocked) {
    speedMph = moveToward(startSpeedMph, 0, config.coastDragMphPerSec * dtSeconds);
  } else if (stickLen > 0) {
    if (wantsOpposite) {
      if (startSpeedMph > config.reverseThresholdMph) {
        // Still rolling forward past the threshold: brake to zero BEFORE
        // reversing. Mechanical brakes work without engine power. Signed
        // (not abs) so that once the car is already reversing it keeps
        // building reverse speed instead of re-triggering the brake phase.
        speedMph = moveToward(startSpeedMph, 0, config.brakeRateMphPerSec * dtSeconds);
      } else if (canAccelerate) {
        const desiredReverseMph = Math.min(stickLen, 1) * config.maxReverseSpeedMph;
        speedMph = moveToward(startSpeedMph, -desiredReverseMph, config.reverseAccelMphPerSec * dtSeconds);
      } else {
        speedMph = moveToward(startSpeedMph, 0, config.coastDragMphPerSec * dtSeconds);
      }
      speedMph = Math.max(speedMph, -config.maxReverseSpeedMph);
    } else if (canAccelerate) {
      const desiredSpeedMph = Math.min(stickLen, 1) * topSpeedMph;
      const weightLb = computeVehicleWeightLb(vehicle);
      const accelRate = accelMphPerSecondFor(plant.power, weightLb);
      if (accelRate === null) {
        // Genuinely underpowered for its current weight (e.g. salvage cargo
        // added post-construction, past construct.ts's own build-time check):
        // same physics as a dead plant below — no self-powered acceleration,
        // but it still coasts and steers.
        speedMph = moveToward(startSpeedMph, 0, config.coastDragMphPerSec * dtSeconds);
      } else {
        speedMph = moveToward(startSpeedMph, desiredSpeedMph, accelRate * dtSeconds);
      }
    } else {
      // No power: cannot accelerate, but still coasts (and still steers, below).
      speedMph = moveToward(startSpeedMph, 0, config.coastDragMphPerSec * dtSeconds);
    }
  } else {
    // Centered stick: coast toward a stop, never a hard brake.
    speedMph = moveToward(startSpeedMph, 0, config.coastDragMphPerSec * dtSeconds);
  }

  // --- Heading: steering, or control-loss spin-out -------------------------
  let headingRad = startHeadingRad;
  let controlLossTicks = vehicle.controlLossTicks;
  let controlStress = vehicle.controlStress;
  let controlLossSpinSign = vehicle.controlLossSpinSign ?? 1;

  if (wasLocked) {
    // A fixed direction for the whole lockout (chosen once when it began,
    // below) — NOT re-derived from `controlLossTicks`'s parity, which
    // flips every tick and made the old "spin" cancel to ~0 net heading
    // change. The full base turn rate applies (no speedTurnCurve damping):
    // this is the car losing control, not the driver steering it.
    const impulseRadPerSec = degToRad(config.baseTurnRateDegPerSec) * controlLossSpinSign;
    headingRad = normalizeAngle(startHeadingRad + impulseRadPerSec * dtSeconds);
    controlLossTicks -= 1;
  } else if (stickLen > 0 && !wantsOpposite) {
    const desiredHeadingRad = Math.atan2(dir.y, dir.x);

    const handlingResponse = computeHandlingResponse({
      coefficients,
      handlingClass,
      drivingSkill,
      tireDP: vehicle.tireDP,
      tireMaxDP: tire.maxDP,
      surface,
    });
    const speedFraction = clamp(Math.abs(startSpeedMph) / topSpeedMph, 0, 1);
    const speedTurnCurve = Math.pow(speedFraction, config.speedTurnCurveExponent);
    const turnRateRadPerSec = degToRad(config.baseTurnRateDegPerSec) * handlingResponse * speedTurnCurve;

    headingRad = rotateToward(startHeadingRad, desiredHeadingRad, turnRateRadPerSec * dtSeconds);
  }

  // --- Control-loss stress: accumulate from turning-while-fast, decay while straight ---
  if (!wasLocked) {
    const headingChangeDeg = Math.abs(radToDeg(angleDelta(startHeadingRad, headingRad)));
    const speedFraction = clamp(Math.abs(startSpeedMph) / topSpeedMph, 0, 1);
    // KNOWN UNIT BUG, DELIBERATELY NOT FIXED HERE.
    //
    // `headingChangeDeg` is this tick's heading change, and the turn above
    // already applied `turnRateRadPerSec * dtSeconds`, so it carries one factor
    // of dt. Multiplying by `dtSeconds` again makes the gain `rate * dt^2`
    // while `stressDecay` below is correctly `perSecond * dt` — the two terms
    // are in different time bases, which makes control loss a function of the
    // ruleset's `tickRateHz` rather than of how the player drives. Measured
    // with the shipped constants, full lock at top speed: 0.5s to spin out at
    // 30Hz, 1.6s at 60Hz, 119.6s at 120Hz, and never at 240Hz.
    //
    // Correcting the exponent (divide by dt first) is a two-character change
    // and it is NOT done, because at the default 60Hz it makes the gain 60x
    // LARGER: the coefficients in driving.json were tuned against the buggy
    // formula, so "fixing" the units silently rebalances the entire game and
    // the player loses every arena. That is a deliberate design decision, not
    // a bug fix, and it belongs in a balance pass with the numbers in front of
    // someone who owns the tuning — not smuggled in as a correctness patch.
    const stressGain = headingChangeDeg * speedFraction * coefficients.speedPenaltyScale * dtSeconds;
    const stressDecay = coefficients.turnStressDecayPerSecond * dtSeconds;
    controlStress = Math.max(0, controlStress + stressGain - stressDecay);

    if (controlLossTicks === 0 && controlStress >= coefficients.turnStressThreshold) {
      const passed = rollControlCheck(rng, {
        coefficients,
        handlingClass,
        drivingSkill,
        tireDP: vehicle.tireDP,
        tireMaxDP: tire.maxDP,
        surface,
        controlStress,
        speedFraction,
      });
      if (!passed) {
        // Only reset stress (and pick the fresh spin direction) on an actual
        // spin-out. A PASSED roll leaves stress right where it landed: it
        // keeps accumulating on sustained hard turning, so `stressPenalty`
        // in `controlScore` grows tick over tick instead of forever sitting
        // barely above `turnStressThreshold` — a ten-second full-lock drift
        // gets meaningfully worse odds than one feathered corner, not an
        // identical coin flip.
        controlLossTicks = seededLockTicks(rng, coefficients);
        controlLossSpinSign = rng.next() < 0.5 ? -1 : 1;
        controlStress = 0;
      }
    }
  }

  // --- Position, odometer, battery -----------------------------------------
  const speedMps = mphToMps(speedMph, config.metersPerMile);
  const newForward: Vec2 = { x: Math.cos(headingRad), y: Math.sin(headingRad) };
  const positionDeltaM = speedMps * dtSeconds;
  const position: Vec2 = {
    x: vehicle.position.x + newForward.x * positionDeltaM,
    y: vehicle.position.y + newForward.y * positionDeltaM,
  };
  const milesMoved = Math.abs(positionDeltaM) / config.metersPerMile;
  const odometerMiles = vehicle.odometerMiles + milesMoved;

  const weightLb = computeVehicleWeightLb(vehicle);
  const speedFractionForBattery = clamp(Math.abs(speedMph) / topSpeedMph, 0, 1);
  const drainPoints = batteryDrainPerMile(weightLb, plant.power, speedFractionForBattery) * milesMoved;

  let battery = vehicle.battery;
  let batteryDebt = (vehicle.batteryDebt ?? 0) + drainPoints;
  const wholePoints = Math.floor(batteryDebt);
  if (wholePoints > 0) {
    battery = Math.max(0, vehicle.battery - wholePoints);
    batteryDebt -= wholePoints;
  }

  const next: VehicleState = {
    ...vehicle,
    position,
    headingRad,
    speedMps,
    battery,
    batteryDebt,
    odometerMiles,
    controlStress,
    controlLossTicks,
    controlLossSpinSign,
  };

  return { vehicle: next };
}
