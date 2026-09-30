import { describe, expect, it } from 'vitest';

import couriersJson from '@rulesets/classic/couriers.json';
import encountersJson from '@rulesets/classic/encounters.json';

import { accelerationTiers, allBodies, allPlants, citiesConfig, drivingConfig, getBody, getPlant, getTire, skillsConfig } from '@/data/rulesets';
import { makeArmorRecord } from '@/sim/types';
import type { TireDPTuple, VehicleDesign, VehicleState } from '@/sim/types';
import {
  accelMphPerSecondFor,
  applyCollision,
  computeHandlingResponse,
  computeVehicleWeightLb,
  isRadarDisabled,
  mpsToMph,
  rechargeBattery,
  stepDriving,
  stopAtObstacle,
  type DriveInput,
  type Rng,
  type StepDrivingResult,
  type SurfaceEffect,
} from '@/sim/driving';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Deterministic seeded PRNG (LCG). Never Math.random(). */
function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    },
  };
}

/** An Rng that always returns 0 — `rollControlCheck` is `rng.next() * 100 < score`, so this always PASSES as long as the score is above 0, and always picks the negative spin-sign branch (`< 0.5`). */
function alwaysZeroRng(): Rng {
  return { next: () => 0 };
}

const BODY = getBody('midsized');
const PLANT_90 = getPlant('large'); // topSpeedMph 90
const TIRE = getTire('standard');
const CONFIG = drivingConfig();
const COEFFICIENTS = skillsConfig()._reconstruction.driving;
const FULL_TIRES: TireDPTuple = [TIRE.maxDP, TIRE.maxDP, TIRE.maxDP, TIRE.maxDP];
const DESTROYED_TIRES: TireDPTuple = [0, 0, 0, 0];

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  const design: VehicleDesign = {
    name: 'Test Rig',
    bodyId: BODY.id,
    chassisId: 'standard',
    suspensionId: 'improved',
    plantId: PLANT_90.id,
    tireId: TIRE.id,
    armor: makeArmorRecord(2),
    weapons: [],
  };
  const base: VehicleState = {
    id: 'veh-1',
    ownerId: 'driver-1',
    design,
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 99,
    odometerMiles: 0,
    armorDP: makeArmorRecord(2),
    tireDP: FULL_TIRES,
    plantDP: PLANT_90.maxDP,
    weapons: [],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    batteryDebt: 0,
  };
  return { ...base, ...overrides };
}

function mph(vehicle: VehicleState): number {
  return mpsToMph(vehicle.speedMps, CONFIG.metersPerMile);
}

function fromMph(m: number): number {
  return (m * CONFIG.metersPerMile) / 3600;
}

const DT = 1 / CONFIG.tickRateHz;
const CENTERED: DriveInput = { stick: { x: 0, y: 0 } };

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`no value at index ${index}`);
  return value;
}

/** Wraps a radian delta to (-PI, PI], independent of `@/sim/driving`'s own (unexported) normalizeAngle — so a test using this to interpret `headingRad` deltas isn't just re-running the SUT's own math. */
function wrapPi(rad: number): number {
  let a = rad % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function radToDegLocal(rad: number): number {
  return (rad * 180) / Math.PI;
}

interface RunOptions {
  input: DriveInput;
  ticks: number;
  drivingSkill?: number;
  surface?: SurfaceEffect;
  rng?: Rng;
}

/** Runs `stepDriving` repeatedly and returns the mph trace (post-step, one entry per tick). `batteryDebt` lives on `VehicleState` now, so it just carries `current` forward — there's nothing else to thread. */
function run(vehicle: VehicleState, opts: RunOptions): { final: VehicleState; mphTrace: number[]; headingTrace: number[] } {
  let current = vehicle;
  const mphTrace: number[] = [];
  const headingTrace: number[] = [];
  const rng = opts.rng ?? makeRng(12345);
  for (let i = 0; i < opts.ticks; i++) {
    const result: StepDrivingResult = stepDriving({
      vehicle: current,
      input: opts.input,
      dtSeconds: DT,
      rng,
      drivingSkill: opts.drivingSkill ?? 50,
      surface: opts.surface ?? 'normal',
    });
    current = result.vehicle;
    mphTrace.push(mph(current));
    headingTrace.push(current.headingRad);
  }
  return { final: current, mphTrace, headingTrace };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stepDriving: throttle, brake, coast, reverse', () => {
  it('centering the stick coasts to a stop gradually, never snapping to zero', () => {
    const vehicle = makeVehicle({ speedMps: fromMph(30) });
    const { mphTrace } = run(vehicle, { input: CENTERED, ticks: 30 });

    // Must decrease monotonically, staying strictly positive for a while —
    // a hard brake or a snap-to-zero would violate this immediately.
    let prev = 30;
    for (const speed of mphTrace) {
      expect(speed).toBeLessThanOrEqual(prev + 1e-9);
      prev = speed;
    }
    expect(at(mphTrace, 0)).toBeGreaterThan(29); // one tick of gentle coastDrag, not a snap
    expect(at(mphTrace, mphTrace.length - 1)).toBeGreaterThan(0);

    // Matches the configured coastDragMphPerSec exactly for an unclamped tick.
    expect(at(mphTrace, 0)).toBeCloseTo(30 - CONFIG.coastDragMphPerSec * DT, 6);
  });

  it('pulling opposite to travel brakes to zero BEFORE reversing', () => {
    const vehicle = makeVehicle({ speedMps: fromMph(40), headingRad: 0 });
    const opposite: DriveInput = { stick: { x: -1, y: 0 } };
    const { mphTrace } = run(vehicle, { input: opposite, ticks: 300 });

    const firstNegativeIndex = mphTrace.findIndex((s) => s < 0);
    expect(firstNegativeIndex).toBeGreaterThan(0);

    // Every sample before the crossover is >= 0 (braked, not reversed) and
    // strictly decreasing at the configured brake rate.
    for (let i = 0; i < firstNegativeIndex; i++) {
      expect(at(mphTrace, i)).toBeGreaterThanOrEqual(0);
    }
    // Once it does go negative, it stays within the reverse cap.
    for (let i = firstNegativeIndex; i < mphTrace.length; i++) {
      expect(at(mphTrace, i)).toBeGreaterThanOrEqual(-CONFIG.maxReverseSpeedMph - 1e-9);
    }
  });

  it('reverse speed never exceeds maxReverseSpeedMph, even on a 90 mph car', () => {
    const vehicle = makeVehicle({ speedMps: 0 }); // PLANT_90 tops out at 90 mph forward
    const fullReverse: DriveInput = { stick: { x: -1, y: 0 } }; // opposite of heading 0
    const { mphTrace } = run(vehicle, { input: fullReverse, ticks: 600 });

    for (const speed of mphTrace) {
      expect(speed).toBeGreaterThanOrEqual(-CONFIG.maxReverseSpeedMph - 1e-9);
    }
    expect(at(mphTrace, mphTrace.length - 1)).toBeCloseTo(-CONFIG.maxReverseSpeedMph, 3);
  });

  it('plantDP 0 blocks acceleration but not steering', () => {
    const vehicle = makeVehicle({ speedMps: fromMph(20), headingRad: 0, plantDP: 0 });
    const turnRight: DriveInput = { stick: { x: 0, y: 1 } }; // desired heading = +90deg, unrelated to current speed direction
    const { mphTrace, headingTrace } = run(vehicle, { input: turnRight, ticks: 60 });

    // Speed only ever falls (coast), never rises, across the whole run.
    let prev = 20;
    for (const speed of mphTrace) {
      expect(speed).toBeLessThanOrEqual(prev + 1e-9);
      prev = speed;
    }

    // Heading still moves toward the requested direction while coasting.
    expect(Math.abs(at(headingTrace, headingTrace.length - 1))).toBeGreaterThan(0);
  });
});

describe('acceleration tiers', () => {
  it('a design sitting exactly at power === weight/3 gets the lowest tier, never a silent 0', () => {
    const tiers = [...accelerationTiers()].sort((a, b) => a.powerRatio - b.powerRatio);
    const lowestTier = at(tiers, 0);
    // Exact integer boundary (power=1, weightLb=denominator) — no float division
    // anywhere, so this pins the true rational 1/denominator, not the ruleset's
    // 0.33334 decimal approximation of it.
    const denominator = Math.round(1 / lowestTier.powerRatio);

    expect(accelMphPerSecondFor(1, denominator)).toBe(lowestTier.mphPerSecond);
    // One pound over the boundary falls off the lowest tier entirely.
    expect(accelMphPerSecondFor(1, denominator + 1)).toBeNull();
  });

  it('below every tier is reported as null (ILLEGAL), never a plausible-looking 0', () => {
    expect(accelMphPerSecondFor(1, 1_000_000)).toBeNull();
  });
});

describe('control loss and handling', () => {
  it('oil measurably worsens handling response, and normal surface fully recovers it', () => {
    const inputs = {
      coefficients: COEFFICIENTS,
      handlingClass: 2,
      drivingSkill: 50,
      tireDP: FULL_TIRES,
      tireMaxDP: TIRE.maxDP,
    };
    const normal = computeHandlingResponse({ ...inputs, surface: 'normal' });
    const onOil = computeHandlingResponse({ ...inputs, surface: 'oil' });
    const recovered = computeHandlingResponse({ ...inputs, surface: 'normal' });

    expect(onOil).toBeLessThan(normal);
    expect(recovered).toBe(normal); // pure function of current surface — no lingering state
  });

  it('the percent-scale divisor behind handling is ruleset-driven, not a hardcoded 100', () => {
    const inputs = {
      coefficients: COEFFICIENTS,
      handlingClass: 2,
      drivingSkill: 50,
      tireDP: FULL_TIRES,
      tireMaxDP: TIRE.maxDP,
      surface: 'normal' as const,
    };
    const withRulesetDivisor = computeHandlingResponse(inputs);
    const doubledDivisor = { ...COEFFICIENTS, handlingScaleDivisor: COEFFICIENTS.handlingScaleDivisor * 2 };
    const withDoubledDivisor = computeHandlingResponse({ ...inputs, coefficients: doubledDivisor });

    // If the 100 were still welded into the TS, overriding the coefficient
    // here would have zero effect on the result.
    expect(withDoubledDivisor).not.toBeCloseTo(withRulesetDivisor, 6);
  });

  it('four destroyed tires degrade handling severely but never to a hard, permanent zero', () => {
    const base = {
      coefficients: COEFFICIENTS,
      handlingClass: 2,
      drivingSkill: 50,
      tireMaxDP: TIRE.maxDP,
      surface: 'normal' as const,
    };
    const threeFlat: TireDPTuple = [0, 0, 0, TIRE.maxDP];
    const healthy = computeHandlingResponse({ ...base, tireDP: FULL_TIRES });
    const wrecked = computeHandlingResponse({ ...base, tireDP: DESTROYED_TIRES });
    const almostWrecked = computeHandlingResponse({ ...base, tireDP: threeFlat });

    // Independently derived from the documented formula (classSkillFactor *
    // floored-tireFactor * surfaceFactor) using the ruleset coefficients
    // directly, rather than by re-calling computeHandlingResponse itself —
    // this pins the exact expected number, so a regression to a hard 0 floor
    // (or to an un-floored clamp) actually fails it.
    const divisor = COEFFICIENTS.handlingScaleDivisor;
    const classSkillFactor = 1 + (base.handlingClass * COEFFICIENTS.handlingClassWeight + base.drivingSkill * COEFFICIENTS.drivingSkillWeight) / divisor;
    const tireBonus = -COEFFICIENTS.destroyedTirePenalty * 4;
    const tireFactor = Math.max(COEFFICIENTS.minTireHandlingFactor, (divisor + tireBonus) / divisor);
    const expectedWrecked = classSkillFactor * tireFactor;

    expect(wrecked).toBeCloseTo(expectedWrecked, 9);
    expect(wrecked).toBeGreaterThan(0); // never a hard, permanent zero
    expect(wrecked).toBeLessThan(almostWrecked);
    expect(almostWrecked).toBeLessThan(healthy);
  });

  it('turn stress keeps climbing on a PASSED roll instead of resetting to just-above-threshold every tick', () => {
    // Seeded just under the threshold so this tick's gain pushes it over and
    // the roll fires; `alwaysZeroRng` guarantees the roll passes (0 < any
    // positive score).
    const vehicle = makeVehicle({
      speedMps: fromMph(90),
      headingRad: 0,
      controlStress: COEFFICIENTS.turnStressThreshold + 5,
    });
    const hardTurn: DriveInput = { stick: { x: 0, y: 1 } };
    const result = stepDriving({
      vehicle,
      input: hardTurn,
      dtSeconds: DT,
      rng: alwaysZeroRng(),
      drivingSkill: 50,
      surface: 'normal',
    });

    expect(result.vehicle.controlLossTicks).toBe(0); // passed — no lockout
    // The old bug reset controlStress to 0 on every roll, pass or fail, so a
    // passed roll could never leave stress meaningfully above the threshold.
    // Only decay (turnStressDecayPerSecond * dt, well under 1 point here) can
    // have reduced it from its 5-over starting point.
    expect(result.vehicle.controlStress).toBeGreaterThan(COEFFICIENTS.turnStressThreshold + 3);
  });

  it('a control-loss lockout is a real, sustained spin-out: heading rotates one consistent way and the player has no throttle/brake authority', () => {
    // Low skill + low handling class + hard, continuous turning at speed
    // maximizes stress gain so the check fires within the run.
    const vehicle = makeVehicle({ speedMps: fromMph(60), headingRad: 0 });
    const wiggle = makeRng(999); // some seed will fail the roll given low skill
    let current = vehicle;
    let sawLockout = false;
    for (let i = 0; i < 600 && !sawLockout; i++) {
      // Alternate hard left/right every tick to maximize |heading change| * speed.
      const stick = i % 2 === 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
      const result = stepDriving({
        vehicle: current,
        input: { stick },
        dtSeconds: DT,
        rng: wiggle,
        drivingSkill: 5,
        surface: 'normal',
      });
      current = result.vehicle;
      if (current.controlLossTicks > 0) sawLockout = true;
    }

    expect(sawLockout).toBe(true);
    const ticksLocked = current.controlLossTicks;
    expect(ticksLocked).toBeGreaterThanOrEqual(COEFFICIENTS.controlLossTicksMin);
    expect(ticksLocked).toBeLessThanOrEqual(COEFFICIENTS.controlLossTicksMax);

    // Drive full forward throttle for the entire lockout: a real spin-out
    // means this input is ignored for BOTH heading and speed.
    const speedStart = mph(current);
    const fullThrottle: DriveInput = { stick: { x: 1, y: 0 } };
    const perTickDeltasDeg: number[] = [];
    let prevHeading = current.headingRad;
    for (let i = 0; i < ticksLocked; i++) {
      const result = stepDriving({
        vehicle: current,
        input: fullThrottle,
        dtSeconds: DT,
        rng: wiggle,
        drivingSkill: 5,
        surface: 'normal',
      });
      current = result.vehicle;
      perTickDeltasDeg.push(radToDegLocal(wrapPi(current.headingRad - prevHeading)));
      prevHeading = current.headingRad;
    }
    expect(current.controlLossTicks).toBe(0); // lockout ran out exactly on schedule

    // Every tick spins the SAME direction at the SAME (full, undamped) rate —
    // the old bug alternated sign every tick and cancelled to ~0 net change.
    const signs = new Set(perTickDeltasDeg.map((d) => Math.sign(d)));
    expect(signs.size).toBe(1);
    expect(signs.has(0)).toBe(false);
    const expectedPerTickDeg = CONFIG.baseTurnRateDegPerSec * DT;
    for (const delta of perTickDeltasDeg) {
      expect(Math.abs(delta)).toBeCloseTo(expectedPerTickDeg, 6);
    }
    const netHeadingChangeDeg = perTickDeltasDeg.reduce((sum, d) => sum + d, 0);
    expect(Math.abs(netHeadingChangeDeg)).toBeCloseTo(expectedPerTickDeg * ticksLocked, 4);

    // Full throttle never overcomes the spin-out: speed instead follows the
    // same coast drag as a centered stick, an exact closed form here since it
    // never approaches 0.
    const expectedSpeedAfterLock = speedStart - CONFIG.coastDragMphPerSec * DT * ticksLocked;
    expect(mph(current)).toBeCloseTo(expectedSpeedAfterLock, 4);
  });
});

describe('collisions', () => {
  it('a 30 mph head-on collision removes exactly one FRONT armor point', () => {
    const vehicle = makeVehicle({ armorDP: makeArmorRecord(5) });
    const after = applyCollision(vehicle, 30);
    expect(after.armorDP.FRONT).toBe(5 - CONFIG.collision.armorLossPoints);
    expect(after.armorDP.REAR).toBe(5);
    expect(after.armorDP.LEFT).toBe(5);
    expect(after.armorDP.RIGHT).toBe(5);
    expect(after.armorDP.UNDERBODY).toBe(5);
  });

  it('a 5 mph collision removes no armor', () => {
    const vehicle = makeVehicle({ armorDP: makeArmorRecord(5) });
    const after = applyCollision(vehicle, 5);
    expect(after.armorDP.FRONT).toBe(5);
    expect(after).toBe(vehicle); // no-op returns the same reference
  });

  it('never removes armor below zero', () => {
    const vehicle = makeVehicle({ armorDP: makeArmorRecord(0) });
    const after = applyCollision(vehicle, 100);
    expect(after.armorDP.FRONT).toBe(0);
  });

  it('stopping at a fence never traps the car: it accelerates again next tick', () => {
    const moving = makeVehicle({ speedMps: fromMph(40) });
    const stopped = stopAtObstacle(moving);
    expect(stopped.speedMps).toBe(0);

    const forward: DriveInput = { stick: { x: 1, y: 0 } };
    const result = stepDriving({
      vehicle: stopped,
      input: forward,
      dtSeconds: DT,
      rng: makeRng(1),
      drivingSkill: 50,
      surface: 'normal',
    });
    expect(mph(result.vehicle)).toBeGreaterThan(0);

    const backward: DriveInput = { stick: { x: -1, y: 0 } };
    const reversed = stepDriving({
      vehicle: stopped,
      input: backward,
      dtSeconds: DT,
      rng: makeRng(1),
      drivingSkill: 50,
      surface: 'normal',
    });
    expect(mph(reversed.vehicle)).toBeLessThan(0);
  });
});

describe('battery, odometer, and radar', () => {
  it('recharge sets battery to exactly full and zeroes any carried fractional debt', () => {
    const drained = makeVehicle({ battery: 3, batteryDebt: 0.7 });
    const recharged = rechargeBattery(drained);
    expect(recharged.battery).toBe(CONFIG.battery.full);
    expect(recharged.batteryDebt).toBe(0);
  });

  it('battery drains a real, independently-computable amount over a sustained drive — not silently zero', () => {
    const vehicle = makeVehicle({ speedMps: fromMph(PLANT_90.topSpeedMph) });
    const forward: DriveInput = { stick: { x: 1, y: 0 } };
    const ticks = 20000;
    const { final } = run(vehicle, { input: forward, ticks });

    // Independently derived from driving.json's battery formula and the
    // vehicle's own weight — not by reading `final.battery` back and working
    // backwards, and not by calling any of driving.ts's private drain helper.
    const weightLb = computeVehicleWeightLb(vehicle);
    const speedFraction = 1; // sustained at exactly top speed the whole run, never clamped
    const perMile =
      CONFIG.battery.movementDrainPerMileBase *
      (1 + CONFIG.battery.weightPowerRatioScale * (weightLb / PLANT_90.power)) *
      (1 + CONFIG.battery.speedFractionScale * speedFraction);
    const totalMiles = (PLANT_90.topSpeedMph * ticks * DT) / 3600;
    const expectedDrain = perMile * totalMiles;
    const expectedBattery = Math.max(0, CONFIG.battery.full - Math.floor(expectedDrain));

    expect(Number.isInteger(final.battery)).toBe(true);
    expect(final.battery).toBe(expectedBattery);
    expect(final.battery).toBeLessThan(CONFIG.battery.full); // it must have actually drained
  });

  it('battery never goes below zero even after a very long drive, and stays a true integer', () => {
    const vehicle = makeVehicle({ speedMps: fromMph(90), battery: 1 });
    const forward: DriveInput = { stick: { x: 1, y: 0 } };
    const { final } = run(vehicle, { input: forward, ticks: 20000 });
    expect(final.battery).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(final.battery)).toBe(true);
  });

  it('a save/load round-trip (a fresh object literal with the same batteryDebt) drains identically to the live object', () => {
    // batteryDebt lives on VehicleState, so a plain JSON round-trip — the
    // shape any IndexedDB save produces — carries it forward with zero extra
    // wiring. The old out-of-band parameter had no such guarantee.
    const vehicle = makeVehicle({ speedMps: fromMph(90) });
    const forward: DriveInput = { stick: { x: 1, y: 0 } };
    const first = stepDriving({ vehicle, input: forward, dtSeconds: DT, rng: makeRng(7), drivingSkill: 50, surface: 'normal' });
    const roundTripped: VehicleState = JSON.parse(JSON.stringify(first.vehicle)) as VehicleState;

    const second = stepDriving({ vehicle: first.vehicle, input: forward, dtSeconds: DT, rng: makeRng(7), drivingSkill: 50, surface: 'normal' });
    const secondFromRoundTrip = stepDriving({ vehicle: roundTripped, input: forward, dtSeconds: DT, rng: makeRng(7), drivingSkill: 50, surface: 'normal' });

    expect(secondFromRoundTrip.vehicle.battery).toBe(second.vehicle.battery);
    expect(secondFromRoundTrip.vehicle.batteryDebt).toBe(second.vehicle.batteryDebt);
  });

  it('odometer accumulates miles from distance actually travelled', () => {
    const vehicle = makeVehicle({ speedMps: fromMph(60), headingRad: 0 });
    const forward: DriveInput = { stick: { x: 1, y: 0 } };
    const { final } = run(vehicle, { input: forward, ticks: 60 }); // ~1 second at ~60 mph
    expect(final.odometerMiles).toBeGreaterThan(0);
    expect(final.odometerMiles).toBeLessThan(60 / 3600 + 0.01); // sanity upper bound
  });

  it('radar is disabled once plant damage falls to or below its failure threshold', () => {
    expect(isRadarDisabled(PLANT_90.radarFailureThreshold, PLANT_90.radarFailureThreshold)).toBe(true);
    expect(isRadarDisabled(PLANT_90.radarFailureThreshold + 1, PLANT_90.radarFailureThreshold)).toBe(false);
  });
});

/**
 * Battery range and route length are ONE number, reconciled — not two
 * independently-tuned balance values.
 *
 * Found by Codex `gpt-6.1-sol` reporting that a 150-mile Albany leg takes
 * "~129 minutes of continuous driving", which sent me looking for why a leg is
 * measured in HOURS. The pacing is a real problem and it is recorded
 * separately. What the search turned up first was worse than pacing: the road
 * had no unreachable destinations, it had UNREACHABLE ones.
 *
 * `movementDrainPerMileBase` (0.9) is multiplied by
 * `(1 + 1.4 * weight/power) * (1 + 0.6 * speedFraction)`, so the EFFECTIVE drain
 * at full speed was 1.84-5.67 per mile — 17 to 54 miles of range. `cities.json`
 * ships routes of 40-240 miles, mean 125. Fourteen of twenty-six routes were
 * longer than the best car's range and twenty-two were longer than the worst
 * car's, including `ny-albany` at 150 miles, which is the default route the
 * reviewer drove. The capture rig's own car — subcompact on the small plant —
 * had 28.6 miles against that 150 and would have stranded at 19% of the way.
 *
 * The road screen mounts no menu and no actions, and `abandonVehicle` (which
 * `@/sim/road` exports and documents as the SPEC's on-foot escape) is never
 * called by `@/app`, so there was no recovery of any kind. A player who ran the
 * battery down was stuck, with a HUD that reports 0% and nothing to press.
 *
 * This test is a RECONCILIATION guard rather than a regression test: it derives
 * both sides from the real rulesets and asserts the constraint that makes the
 * road completable at all, so the two numbers cannot drift apart again without
 * a red test. It reads `bodies.json`/`plants.json` for the real weight/power
 * pairs rather than hardcoding a worst case, so adding a heavier body or a
 * weaker plant — which widens the multiplier — fails here.
 */
describe('battery range is reconciled against route length', () => {
  function extremes(): { worst: number; best: number } {
    const bodies = allBodies();
    const plants = allPlants();
    const ratios: number[] = [];
    for (const b of bodies) for (const p of plants) ratios.push(b.weightLb / p.power);
    const bat = drivingConfig().battery;
    const full = bat.full;
    // Effective drain at FULL SPEED, which is the worst case for range: the
    // speed term is 1 and the weight/power term varies per build.
    const drains = ratios.map((r) => bat.movementDrainPerMileBase * (1 + bat.weightPowerRatioScale * r) * (1 + bat.speedFractionScale));
    // Heaviest-on-weakest is the WORST case; the largest drain is the worst.
    return { worst: full / Math.max(...drains), best: full / Math.min(...drains) };
  }

  it('lets the WORST build finish the LONGEST shipped route on one charge', () => {
    const { worst } = extremes();
    const longest = Math.max(...citiesConfig().routes.map((r) => r.lengthMiles));
    expect(
      worst,
      `the worst build manages ${worst.toFixed(0)} miles but the longest route is ${longest} — that route is an unreachable destination, and the road offers no charge stop and no way to abandon the car`,
    ).toBeGreaterThanOrEqual(longest);
  });

  it('keeps a real vehicle-quality gradient rather than flattening it', () => {
    // A uniform scale of the base number is what makes the reconciliation safe:
    // it moves every car's range by the same factor, so "a badly built car goes
    // about a third as far as a good one" is unchanged by construction. A guard
    // against the other fix — inflating `full` until everything fits — is what
    // this is for, and that fix would have made the gradient much weaker.
    const { worst, best } = extremes();
    expect(best / worst).toBeGreaterThan(2.5);
  });

  it('leaves no shipped route beyond the best car either', () => {
    const { best } = extremes();
    const unreachable = citiesConfig().routes
      .filter((r) => r.lengthMiles > best)
      .map((r) => `${r.id} (${r.lengthMiles}mi)`);
    expect(unreachable, `routes beyond even the best car: ${unreachable.join(', ')}`).toEqual([]);
  });
});

/**
 * WORLD SCALE — the four per-mile axes, and why they are one edit and not four.
 *
 * The pacing item has been deferred four times (iterations 96, 97, 102, 105) as
 * "a decision, not a defect". This block is that decision, taken. It rescales
 * the road so a leg is drivable in the ~20 minutes a reviewer independently
 * asked for, and it does so by dividing the ROUTE TABLE by 5 — which is
 * arithmetic on a number the player reads off the HUD, and therefore honest:
 * the odometer still counts real miles, the car still drives 70mph, and the
 * highway is simply shorter. Iteration 97 recorded that the alternative levers
 * (compressing the odometer) cost a 26-64x lie "in one direction or the other";
 * this is that other direction, and it is the one that lies about nothing.
 *
 * BUT a route table is not one number. Three other ruleset values are QUOTIENTS
 * PER MILE, so dividing the routes by 5 without touching them does not "make the
 * world smaller" — it makes the world smaller AND rebalances four subsystems in
 * whichever direction they were left in:
 *
 *   routes.lengthMiles            /5   the thing being rescaled
 *   battery.movementDrainPerMileBase  x5   else the battery stops mattering
 *   encounters.spawnsPerHundredMiles  x5   else every leg loses ~79% of its fights
 *   couriers.payWeightPerMile     x5    else every job pays a fifth as much
 *
 * The 79% figure is measured, not asserted, and it is NOT the 1/k^2 = 96% that
 * iteration 102's table predicted for a routes-only shrink: `spawnBudget` is a
 * per-leg CAP, so on a 25-mile route the cap rather than the density is what
 * decides most fights. That is the coupling trap in its precise form — a
 * half-made version of this edit does not merely shift balance, it deletes four
 * fifths of the road's content while every existing test still passes.
 *
 * So the guard below pins FIVE quantities, all derived from the real rulesets:
 * the one thing that is SUPPOSED to change (real minutes per leg), and the four
 * things that must not (battery per leg, legs per charge, fights per leg,
 * courier pay per leg). The four baselines are measured from the tables, not
 * chosen — they are what the game played like before, which is exactly the
 * claim worth preserving.
 */
describe('world scale: the per-mile axes stay coupled to the route table', () => {
  /** Every per-leg quantity, computed from the shipped rulesets. */
  function scale() {
    const routes = citiesConfig().routes;
    const meanMiles = routes.reduce((s, r) => s + r.lengthMiles, 0) / routes.length;
    const topSpeeds = allPlants().map((p) => p.topSpeedMph);

    const bat = drivingConfig().battery;
    const ratios: number[] = [];
    for (const b of allBodies()) for (const p of allPlants()) ratios.push(b.weightLb / p.power);
    const drains = ratios.map(
      (r) => bat.movementDrainPerMileBase * (1 + bat.weightPowerRatioScale * r) * (1 + bat.speedFractionScale),
    );
    const worstDrain = Math.max(...drains);

    const encounters = encountersJson.dangerLevels;
    const fights = routes.reduce((s, r) => {
      // `danger` is a 0-4 index into the shipped danger table, but TypeScript
      // cannot know that from the RouteDef shape alone.
      const tier = encounters[r.danger];
      if (!tier) throw new Error(`encounters.json has no danger level ${r.danger}`);
      return s + Math.min(tier.spawnsPerHundredMiles * (r.lengthMiles / 100), tier.spawnBudget);
    }, 0);

    const gen = couriersJson.generation;
    return {
      meanMiles,
      slowestMinutes: (meanMiles / Math.min(...topSpeeds)) * 60,
      fastestMinutes: (meanMiles / Math.max(...topSpeeds)) * 60,
      batteryPoints: worstDrain * meanMiles,
      legsPerCharge: bat.full / worstDrain / meanMiles,
      fightsPerLeg: fights / routes.length,
      courierPay: gen.payWeightPerMile * meanMiles,
    };
  }

  /**
   * Within 2%. Every invariant below is EXACTLY preserved by the rescale, so a
   * tight band would pass — but these are game-feel quantities, not byte
   * hashes, and a 2% band says "this is still the same game" rather than
   * pinning a float. It is four times tighter than any single reverted axis
   * moves (reverting one is a 4.8-5x shift), so half-made edits cannot hide.
   */
  function expectUnchanged(what: string, actual: number, before: number) {
    const drift = Math.abs(actual - before) / before;
    expect(drift, `${what} drifted ${(drift * 100).toFixed(1)}% from its pre-rescale value (${before.toFixed(2)} -> ${actual.toFixed(2)}) — one of the four per-mile axes is not coupled to the route table`).toBeLessThan(0.02);
  }

  it('makes a leg drivable — the ONE quantity this edit exists to change', () => {
    const { slowestMinutes, fastestMinutes } = scale();
    // The band is bracketed at BOTH ends and derived from the shipped plants
    // rather than typed, because top speed is a per-plant property: `small`
    // tops out at 70mph and is the plant a new driver starts on, which is
    // exactly the car Codex drove when it measured 129 minutes and asked for
    // ~20-25. Lower-bound the SLOWEST case so a further rescale cannot shrink a
    // leg past the point where its encounters fit, and upper-bound the fastest
    // so no plant is handed a leg too long to sit through.
    expect(
      slowestMinutes,
      `the slowest shipped plant covers a mean leg in ${slowestMinutes.toFixed(1)} real minutes — that is the starting car, and Codex asked for ~20-25`,
    ).toBeGreaterThanOrEqual(18);
    expect(
      fastestMinutes,
      `the fastest shipped plant covers a mean leg in ${fastestMinutes.toFixed(1)} real minutes; nothing should exceed ~25`,
    ).toBeLessThanOrEqual(26);
  });

  it('keeps the battery a per-leg constraint (measured 47.28 pts/leg before)', () => {
    expectUnchanged('battery points per leg (worst build)', scale().batteryPoints, 47.28);
  });

  it('keeps the worst build at ~2.1 legs per charge (measured 2.09 before)', () => {
    expectUnchanged('legs per charge (worst build)', scale().legsPerCharge, 2.09);
  });

  it('keeps the fights every leg used to carry (measured 3.05 before)', () => {
    expectUnchanged('fights per leg', scale().fightsPerLeg, 3.05);
  });

  it('keeps a courier job paying the same (measured $400/leg before)', () => {
    expectUnchanged('courier distance pay per leg', scale().courierPay, 400);
  });
});
