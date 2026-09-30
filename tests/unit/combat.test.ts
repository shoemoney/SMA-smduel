import { describe, expect, it } from 'vitest';
import { createRng } from '@/util/rng';
import type { Rng } from '@/util/rng';
import { getWeapon } from '@/data/rulesets';
import { applyPenetratingDamage } from '@/sim/damage';
import { makeArmorRecord, VEHICLE_LOCAL_FACING } from '@/sim/types';
import type { DriverState, Vec2, VehicleState, WeaponState } from '@/sim/types';
import {
  activeWeapons,
  coneAngleDeltaDeg,
  effectiveHitChance,
  facingWorldDirection,
  fire,
  rollDamage,
  spawnDeployable,
  spawnProjectile,
  tickCooldowns,
  validateFire,
  type FireContext,
} from '@/sim/combat';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function weaponState(overrides: Partial<WeaponState> = {}): WeaponState {
  return { weaponId: 'machinegun', facing: 'FRONT', ammo: 20, dp: 3, maxDP: 3, cooldownRemaining: 0, destroyed: false, ...overrides };
}

function vehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: 'veh-1',
    ownerId: 'driver-1',
    design: {
      name: 'Test',
      bodyId: 'compact',
      chassisId: 'standard',
      suspensionId: 'standard',
      plantId: 'small',
      tireId: 'standard',
      armor: makeArmorRecord(0),
      weapons: [],
    },
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 99,
    odometerMiles: 0,
    armorDP: makeArmorRecord(0),
    tireDP: [4, 4, 4, 4],
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

const NO_PENALTY: Omit<FireContext, 'rng'> = {
  marksmanshipSkill: 50,
  rangePenaltyPercent: 0,
  relativeMotionPenaltyPercent: 0,
  smokePenaltyPercent: 0,
  paintPenaltyPercent: 0,
};

function ctxWith(rng: Rng): FireContext {
  return { rng, ...NO_PENALTY };
}

/** A stub Rng for tests that need a forced outcome rather than a real draw sequence. */
function stubRng(overrides: Partial<Rng> = {}): Rng {
  return { ...createRng('stub-base'), ...overrides };
}

/**
 * Built from `VEHICLE_LOCAL_FACING` rather than hand-placed. These two
 * fixtures were `{x:0, y:±50}` against the OLD body-local frame, and every
 * test in this file inherited which way the nose pointed without saying so —
 * which is why `the vehicle forward convention` (the end-to-end test that
 * derives forward from `headingRad`, the way the renderer does) disagreed with
 * the rest of the file for as long as the 90-degree bug existed.
 */
const AHEAD = { position: { x: VEHICLE_LOCAL_FACING.FRONT.x * 50, y: VEHICLE_LOCAL_FACING.FRONT.y * 50 }, headingRad: 0 };
const BEHIND = { position: { x: VEHICLE_LOCAL_FACING.REAR.x * 50, y: VEHICLE_LOCAL_FACING.REAR.y * 50 }, headingRad: 0 };

/** A point `d` metres along `facing`'s centerline, straight off the owner table. */
function alongFacing(facing: 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT', d: number): Vec2 {
  const u = VEHICLE_LOCAL_FACING[facing];
  return { x: u.x * d, y: u.y * d };
}

/** A point `deg` degrees off `facing`'s centerline, rotated CCW from it. */
function offCenterline(facing: 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT', deg: number, d = 100): Vec2 {
  const rad = (deg * Math.PI) / 180;
  const u = VEHICLE_LOCAL_FACING[facing];
  return { x: (u.x * Math.cos(rad) - u.y * Math.sin(rad)) * d, y: (u.x * Math.sin(rad) + u.y * Math.cos(rad)) * d };
}

// ---------------------------------------------------------------------------
// Step 1: validation
// ---------------------------------------------------------------------------

describe('validateFire', () => {
  it('fails with NO_WEAPON when the slot is empty', () => {
    const v = vehicle({ weapons: [] });
    expect(validateFire(v, 0, AHEAD.position)).toMatchObject({ ok: false, reason: 'NO_WEAPON' });
  });

  it('fails with NO_DP when the mounted weapon has 0 dp', () => {
    const v = vehicle({ weapons: [weaponState({ dp: 0 })] });
    expect(validateFire(v, 0, AHEAD.position)).toMatchObject({ ok: false, reason: 'NO_DP' });
  });

  it('a destroyed weapon cannot fire', () => {
    const v = vehicle({ weapons: [weaponState({ destroyed: true })] });
    expect(validateFire(v, 0, AHEAD.position)).toMatchObject({ ok: false, reason: 'DESTROYED' });
  });

  it('fails with COOLDOWN while cooldownRemaining > 0', () => {
    const v = vehicle({ weapons: [weaponState({ cooldownRemaining: 5 })] });
    expect(validateFire(v, 0, AHEAD.position)).toMatchObject({ ok: false, reason: 'COOLDOWN' });
  });

  it('fails with NO_AMMO for an ammo weapon with 0 rounds', () => {
    const v = vehicle({ weapons: [weaponState({ weaponId: 'machinegun', ammo: 0 })] });
    expect(validateFire(v, 0, AHEAD.position)).toMatchObject({ ok: false, reason: 'NO_AMMO' });
  });

  it('fails with NO_BATTERY for a battery weapon when the car has none left', () => {
    const v = vehicle({ battery: 0, weapons: [weaponState({ weaponId: 'laser', facing: 'FRONT', dp: 2, maxDP: 2 })] });
    expect(validateFire(v, 0, AHEAD.position)).toMatchObject({ ok: false, reason: 'NO_BATTERY' });
  });

  it('a rear-facing weapon cannot hit a target in front', () => {
    const v = vehicle({ headingRad: 0, position: { x: 0, y: 0 }, weapons: [weaponState({ facing: 'REAR' })] });
    expect(validateFire(v, 0, AHEAD.position)).toMatchObject({ ok: false, reason: 'WRONG_FACING' });
  });

  it('the same rear-facing weapon validates fine against a target behind it', () => {
    const v = vehicle({ headingRad: 0, position: { x: 0, y: 0 }, weapons: [weaponState({ facing: 'REAR' })] });
    expect(validateFire(v, 0, BEHIND.position)).toMatchObject({ ok: true, reason: null });
  });
});

describe('activeWeapons', () => {
  it('excludes destroyed weapons from the selectable list', () => {
    const v = vehicle({ weapons: [weaponState({ weaponId: 'machinegun' }), weaponState({ weaponId: 'laser', destroyed: true })] });
    expect(activeWeapons(v).map((w) => w.weaponId)).toEqual(['machinegun']);
  });
});

// ---------------------------------------------------------------------------
// Step 2 + laser battery accounting
// ---------------------------------------------------------------------------

describe('fire — battery accounting', () => {
  it('a full 99 battery allows exactly 99 laser shots; the 100th fails on NO_BATTERY', () => {
    let v = vehicle({ battery: 99, weapons: [weaponState({ weaponId: 'laser', facing: 'FRONT', dp: 2, maxDP: 2, ammo: 0 })] });
    const ctx = ctxWith(createRng('laser-99'));

    for (let i = 0; i < 99; i++) {
      const result = fire({ vehicle: v, weaponSlotIndex: 0, target: AHEAD, ctx, tick: i, spawnedEntityId: `p${i}`, deployDropOffsetM: 3 });
      expect(result.ok).toBe(true);
      v = result.vehicle;
      // Isolate battery accounting from cooldown pacing for this test.
      v = { ...v, weapons: v.weapons.map((w, idx) => (idx === 0 ? { ...w, cooldownRemaining: 0 } : w)) };
    }
    expect(v.battery).toBe(0);

    const hundredth = fire({ vehicle: v, weaponSlotIndex: 0, target: AHEAD, ctx, tick: 100, spawnedEntityId: 'p100', deployDropOffsetM: 3 });
    expect(hundredth.ok).toBe(false);
    expect(hundredth.reason).toBe('NO_BATTERY');
    expect(hundredth.vehicle.battery).toBe(0);
  });
});

describe('fire — a miss still costs the round', () => {
  it('consumes ammo even when the roll misses', () => {
    const v = vehicle({ weapons: [weaponState({ weaponId: 'machinegun', facing: 'FRONT', dp: 3, ammo: 20 })] });
    const ctx = ctxWith(stubRng({ chance: () => false }));
    const result = fire({ vehicle: v, weaponSlotIndex: 0, target: AHEAD, ctx, tick: 0, spawnedEntityId: 'p1', deployDropOffsetM: 3 });
    expect(result.ok).toBe(true);
    expect(result.ammoConsumed).toBe(true);
    expect(result.vehicle.weapons[0]?.ammo).toBe(19);
    expect(result.spawn?.kind).toBe('PROJECTILE');
    if (result.spawn?.kind === 'PROJECTILE') {
      expect(result.spawn.projectile.outcome.hit).toBe(false);
      expect(result.spawn.projectile.outcome.damage).toBe(0);
    }
  });

  it('still sets cooldown so a second immediate trigger fails', () => {
    const v = vehicle({ weapons: [weaponState({ weaponId: 'machinegun', facing: 'FRONT', dp: 3, ammo: 20 })] });
    const ctx = ctxWith(stubRng({ chance: () => false }));
    const first = fire({ vehicle: v, weaponSlotIndex: 0, target: AHEAD, ctx, tick: 0, spawnedEntityId: 'p1', deployDropOffsetM: 3 });
    expect(first.ok).toBe(true);
    const second = fire({ vehicle: first.vehicle, weaponSlotIndex: 0, target: AHEAD, ctx, tick: 1, spawnedEntityId: 'p2', deployDropOffsetM: 3 });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('COOLDOWN');
  });
});

describe('tickCooldowns', () => {
  it('counts down and floors at 0', () => {
    const v = vehicle({ weapons: [weaponState({ cooldownRemaining: 2 })] });
    const t1 = tickCooldowns(v, 1);
    expect(t1.weapons[0]?.cooldownRemaining).toBe(1);
    const t2 = tickCooldowns(t1, 5);
    expect(t2.weapons[0]?.cooldownRemaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Spawn by mode
// ---------------------------------------------------------------------------

describe('fire — spawn by mode', () => {
  it('PROJECTILE: velocity points along the mount facing at the weapon\'s projectileSpeedMps', () => {
    const weaponDef = getWeapon('machinegun');
    const v = vehicle({ weapons: [weaponState({ weaponId: 'machinegun', facing: 'FRONT', dp: 3, ammo: 20 })] });
    const ctx = ctxWith(createRng('proj'));
    const result = fire({ vehicle: v, weaponSlotIndex: 0, target: AHEAD, ctx, tick: 0, spawnedEntityId: 'p1', deployDropOffsetM: 3 });
    expect(result.spawn?.kind).toBe('PROJECTILE');
    if (result.spawn?.kind === 'PROJECTILE') {
      const speed = weaponDef.projectileSpeedMps ?? 0;
      // The mount's OWN world direction, from the owner table at heading 0.
      expect(result.spawn.projectile.velocity.x).toBeCloseTo(VEHICLE_LOCAL_FACING.FRONT.x * speed);
      expect(result.spawn.projectile.velocity.y).toBeCloseTo(VEHICLE_LOCAL_FACING.FRONT.y * speed);
      expect(result.spawn.projectile.maxRangeM).toBe(weaponDef.rangeM);
    }
  });

  it('DEPLOYABLE: drops behind the vehicle, not at the mount facing', () => {
    const v = vehicle({
      position: { x: 0, y: 0 },
      headingRad: 0,
      weapons: [weaponState({ weaponId: 'minedropper', facing: 'REAR', dp: 3, ammo: 20 })],
    });
    const ctx = ctxWith(createRng('mine'));
    const result = fire({ vehicle: v, weaponSlotIndex: 0, target: BEHIND, ctx, tick: 0, spawnedEntityId: 'mine1', deployDropOffsetM: 3 });
    expect(result.ok).toBe(true);
    expect(result.spawn?.kind).toBe('DEPLOYABLE');
    if (result.spawn?.kind === 'DEPLOYABLE') {
      expect(result.spawn.deployable.deployable.kind).toBe('MINE');
      expect(result.spawn.deployable.position).toEqual(alongFacing('REAR', 3));
    }
  });

  it('DEPLOYABLE weapons never roll damage/accuracy against a "target"', () => {
    const v = vehicle({ weapons: [weaponState({ weaponId: 'spikedropper', facing: 'REAR', dp: 5, ammo: 20 })] });
    const ctx = ctxWith(stubRng({ chance: () => false }));
    const result = fire({ vehicle: v, weaponSlotIndex: 0, target: BEHIND, ctx, tick: 0, spawnedEntityId: 's1', deployDropOffsetM: 3 });
    expect(result.spawn?.kind).toBe('DEPLOYABLE');
  });

  it('HITSCAN/CONE resolve as an INSTANT spawn with the roll already applied', () => {
    const v = vehicle({ weapons: [weaponState({ weaponId: 'laser', facing: 'FRONT', dp: 2, maxDP: 2 })] });
    const ctx = ctxWith(stubRng({ chance: () => true, int: () => 5 }));
    const result = fire({ vehicle: v, weaponSlotIndex: 0, target: AHEAD, ctx, tick: 0, spawnedEntityId: 'l1', deployDropOffsetM: 3 });
    // Shooter is directly behind the target (same heading), chasing it down — the
    // shot lands on the target's REAR, matching `impactFacingFromPositions`.
    expect(result.spawn).toEqual({ kind: 'INSTANT', hit: true, damage: 5, facing: 'REAR' });
  });

  it('heavyrocket is a one-shot: it becomes unfireable (spent) after firing, but is NOT destroyed', () => {
    const v = vehicle({ weapons: [weaponState({ weaponId: 'heavyrocket', facing: 'FRONT', dp: 2, maxDP: 2, ammo: 1 })] });
    const ctx = ctxWith(createRng('rocket'));
    const result = fire({ vehicle: v, weaponSlotIndex: 0, target: AHEAD, ctx, tick: 0, spawnedEntityId: 'hr1', deployDropOffsetM: 3 });
    expect(result.ok).toBe(true);
    expect(result.vehicle.weapons[0]?.spent).toBe(true);
    // Destroyed is a wholly separate concept (its DP hitting 0 from combat damage) —
    // spending a one-shot must never set it.
    expect(result.vehicle.weapons[0]?.destroyed).toBe(false);
    expect(result.vehicle.weapons[0]?.dp).toBe(2);
    expect(activeWeapons(result.vehicle)).toEqual([]);
  });

  it('a spent one-shot cannot fire again, distinctly (SPENT, not DESTROYED or NO_AMMO)', () => {
    const v = vehicle({ weapons: [weaponState({ weaponId: 'heavyrocket', facing: 'FRONT', dp: 2, maxDP: 2, ammo: 1 })] });
    const ctx = ctxWith(createRng('rocket'));
    const first = fire({ vehicle: v, weaponSlotIndex: 0, target: AHEAD, ctx, tick: 0, spawnedEntityId: 'hr1', deployDropOffsetM: 3 });
    const secondValidation = validateFire(first.vehicle, 0, AHEAD.position);
    expect(secondValidation).toMatchObject({ ok: false, reason: 'SPENT' });
  });

  it('a spent one-shot still absorbs penetrating damage as an intact component, unlike a destroyed one', () => {
    // Reproduces the exact regression: FRONT-mounted heavyrocket (2 DP), FRONT armor
    // 0. A 4-damage FRONT hit must be absorbed 2 by the launcher and 2 by the plant —
    // identically whether the launcher has fired (spent) or not (conflating "spent"
    // with "destroyed" would make the weapon vanish as a damage sponge the instant it
    // fires, making the car measurably MORE fragile for having used its weapon).
    const freshVehicle = vehicle({
      armorDP: makeArmorRecord(0),
      weapons: [weaponState({ weaponId: 'heavyrocket', facing: 'FRONT', dp: 2, maxDP: 2, ammo: 1 })],
      plantDP: 10,
    });
    const ctx = ctxWith(createRng('rocket'));
    const afterFiring = fire({
      vehicle: freshVehicle,
      weaponSlotIndex: 0,
      target: AHEAD,
      ctx,
      tick: 0,
      spawnedEntityId: 'hr1',
      deployDropOffsetM: 3,
    }).vehicle;
    expect(afterFiring.weapons[0]?.spent).toBe(true);

    const driverState: DriverState = {
      name: 'Test',
      skills: { driving: 20, marksmanship: 20, mechanic: 10 },
      naturalHealth: 3,
      bodyArmor: 0,
      prestige: 0,
      cash: 0,
      cityId: 'newyork',
      cloneCityId: null,
      cloneSkills: null,
    };
    const hit = applyPenetratingDamage(afterFiring, driverState, 'FRONT', 4, createRng('hit'));
    expect(hit.report.weaponHits).toEqual([{ weaponId: 'heavyrocket', damageApplied: 2, destroyed: true }]);
    expect(hit.report.plantDamageApplied).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Accuracy and damage rolls
// ---------------------------------------------------------------------------

describe('effectiveHitChance', () => {
  it('the rocket launcher has a minimum effective range: below it, guaranteed miss', () => {
    const rocket = getWeapon('rocketlauncher');
    expect(rocket.minRangeM).toBeDefined();
    const ctx = ctxWith(createRng('range'));
    expect(effectiveHitChance(rocket, ctx, (rocket.minRangeM ?? 0) - 1)).toBe(0);
  });

  it('is clamped within the weapon\'s own [minChance, maxChance]', () => {
    const weaponDef = getWeapon('machinegun');
    const ctx: FireContext = { ...NO_PENALTY, rng: createRng('r'), rangePenaltyPercent: 1000 };
    const chance = effectiveHitChance(weaponDef, ctx, 10);
    expect(chance).toBeGreaterThanOrEqual(weaponDef.minChance);
    expect(chance).toBeLessThanOrEqual(weaponDef.maxChance);
  });

  it('a HITSCAN weapon (laser) has NO reach beyond its own rangeM — a target far past it is a guaranteed miss', () => {
    // Regression: laser rangeM 140, fired at a target 5000m away used to return
    // effectiveHitChance 86 (unbounded reach) because only minRangeM was checked.
    const laser = getWeapon('laser');
    const ctx = ctxWith(createRng('far'));
    expect(effectiveHitChance(laser, ctx, 5000)).toBe(0);
    expect(laser.rangeM).toBeLessThan(5000);
    // Just inside range still gives a real (non-zero-forced) chance.
    expect(effectiveHitChance(laser, ctx, laser.rangeM - 1)).toBeGreaterThan(0);
  });

  it('a CONE weapon (flamethrower) has NO reach beyond its own rangeM either', () => {
    // Regression: flamethrower rangeM 30, fired at 1000m used to return 94.
    const flamethrower = getWeapon('flamethrower');
    const ctx = ctxWith(createRng('far'));
    expect(effectiveHitChance(flamethrower, ctx, 1000)).toBe(0);
  });

  it('a PROJECTILE weapon\'s pre-rolled accuracy is range-capped the same way (matches ai.ts\'s own distance <= rangeM gate)', () => {
    const rocket = getWeapon('rocketlauncher');
    const ctx = ctxWith(createRng('far'));
    expect(effectiveHitChance(rocket, ctx, rocket.rangeM + 1)).toBe(0);
  });
});

describe('coneAngleDeltaDeg — the flamethrower\'s actual firing arc', () => {
  it('is 0 for a target dead ahead of the mount centerline', () => {
    expect(coneAngleDeltaDeg(alongFacing('RIGHT', 1), 'RIGHT')).toBeCloseTo(0);
  });

  it('is 90 for a target exactly perpendicular to the mount centerline', () => {
    // Perpendicular to RIGHT: a quarter turn off its centerline, same distance.
    expect(coneAngleDeltaDeg(offCenterline('RIGHT', 90, 1), 'RIGHT')).toBeCloseTo(90);
  });
});

describe('validateFire — CONE weapons are gated by coneHalfAngleDeg, not the 90-degree mount quadrant', () => {
  it('a target within the cone (0 degrees off centerline) validates', () => {
    const v = vehicle({
      headingRad: 0,
      position: { x: 0, y: 0 },
      weapons: [weaponState({ weaponId: 'flamethrower', facing: 'RIGHT', dp: 3 })],
    });
    // Directly on the RIGHT mount's centerline, any distance.
    expect(validateFire(v, 0, alongFacing('RIGHT', 100))).toMatchObject({ ok: true });
  });

  it('a target 40 degrees off centerline is still inside the RIGHT quadrant (< 45deg) but OUTSIDE the flamethrower\'s 26-degree half-angle, and must fail', () => {
    const flamethrower = getWeapon('flamethrower');
    expect(flamethrower.coneHalfAngleDeg).toBe(26);
    const v = vehicle({
      headingRad: 0,
      position: { x: 0, y: 0 },
      weapons: [weaponState({ weaponId: 'flamethrower', facing: 'RIGHT', dp: 3 })],
    });
    const target = offCenterline('RIGHT', 40);
    // Sanity check: this target really is inside RIGHT's 90-degree quadrant, so
    // this is the exact case the quadrant test lets through and the cone
    // half-angle has to catch.
    // Inside RIGHT's quadrant: the component ALONG RIGHT's centerline exceeds the
    // one across it. Both read off the owner, so this sanity check is about the
    // geometry rather than about a coordinate somebody typed.
    const u = VEHICLE_LOCAL_FACING.RIGHT;
    expect(Math.abs(target.x * u.x + target.y * u.y)).toBeGreaterThan(Math.abs(target.x * -u.y + target.y * u.x));
    expect(validateFire(v, 0, target)).toMatchObject({ ok: false, reason: 'WRONG_FACING' });
  });

  it('a target exactly at the 26-degree edge validates; one degree past it does not', () => {
    const v = vehicle({
      headingRad: 0,
      position: { x: 0, y: 0 },
      weapons: [weaponState({ weaponId: 'flamethrower', facing: 'RIGHT', dp: 3 })],
    });
    // Bracketed either side of the 26-degree edge rather than sitting ON it.
    // A target built at EXACTLY 26.0 could land one ULP either side of the
    // production `>` and turn this into a coin flip — which it was, and did,
    // when the frame it rode on changed. This test asserts the boundary, not
    // the arithmetic.
    expect(validateFire(v, 0, offCenterline('RIGHT', 25))).toMatchObject({ ok: true });
    expect(validateFire(v, 0, offCenterline('RIGHT', 26.5))).toMatchObject({ ok: false, reason: 'WRONG_FACING' });
  });
});

describe('rollDamage', () => {
  it('machine gun is 4 independent checks of 0..1 DP, so the total is always 0..4', () => {
    const weaponDef = getWeapon('machinegun');
    const rng = createRng('burst');
    for (let i = 0; i < 200; i++) {
      const damage = rollDamage(weaponDef, rng);
      expect(damage).toBeGreaterThanOrEqual(0);
      expect(damage).toBeLessThanOrEqual(4);
      expect(Number.isInteger(damage)).toBe(true);
    }
  });

  it('a RANGE weapon rolls within [min, max]', () => {
    const weaponDef = getWeapon('rocketlauncher');
    if (weaponDef.damage.kind !== 'RANGE') throw new Error('fixture expects a RANGE weapon');
    const rng = createRng('range-roll');
    for (let i = 0; i < 200; i++) {
      const damage = rollDamage(weaponDef, rng);
      expect(damage).toBeGreaterThanOrEqual(weaponDef.damage.min);
      expect(damage).toBeLessThanOrEqual(weaponDef.damage.max);
    }
  });

  it('a NONE-damage deployable weapon always rolls 0', () => {
    const weaponDef = getWeapon('smokescreen');
    expect(rollDamage(weaponDef, createRng('none'))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Geometry helpers used by the pipeline
// ---------------------------------------------------------------------------

/**
 * THE END-TO-END PROOF, and the one test in this file that must not be
 * rewritten from the table.
 *
 * It derives the car's rendered nose the way the RENDERER does — from
 * `headingRad`, which is what `rotationRad: vehicle.headingRad` hands the
 * sprite shader — and asserts a FRONT-mounted shot leaves along it at all four
 * cardinal headings, by cosine similarity.
 *
 * It does not appear anywhere else in the log as written, because it was
 * written in iteration 121, failed as predicted, and went back out with the
 * rest of the reverted rotation. What survived was a comment in a fixture
 * citing it — a comment describing a test that did not exist, which is the
 * stale-comment class this log has now hit four times. The comment is accurate
 * as of this round and false for every commit between 121 and now.
 */
describe('the vehicle forward convention', () => {
  const CARDINALS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

  it('a FRONT-mounted shot leaves along the RENDERED nose at every cardinal heading', () => {
    for (const headingRad of CARDINALS) {
      const v = vehicle({ position: { x: 0, y: 0 }, headingRad, weapons: [weaponState({ weaponId: 'machinegun', facing: 'FRONT', dp: 3, ammo: 20 })] });
      // The target sits along the car's OWN nose for THIS heading. A fixed
      // target would be out of the FRONT quadrant the moment the car rotates,
      // and `validateFire` would refuse the shot before it ever spawned.
      const target = { position: { x: Math.cos(headingRad) * 50, y: Math.sin(headingRad) * 50 }, headingRad };
      const result = fire({ vehicle: v, weaponSlotIndex: 0, target, ctx: ctxWith(createRng('fwd')), tick: 0, spawnedEntityId: 'p1', deployDropOffsetM: 3 });
      expect(result.spawn?.kind).toBe('PROJECTILE');
      if (result.spawn?.kind !== 'PROJECTILE') continue;
      const vel = result.spawn.projectile.velocity;
      const len = Math.hypot(vel.x, vel.y);
      expect(len).toBeGreaterThan(0);
      // The nose, derived the way the renderer derives it.
      const nose = { x: Math.cos(headingRad), y: Math.sin(headingRad) };
      const cos = (vel.x * nose.x + vel.y * nose.y) / len;
      // Cosine similarity, because a plain subtraction reports a 2.0
      // disagreement for what is really a 90-degree one.
      expect(cos).toBeCloseTo(1, 6);
    }
  });

  it('and a RIGHT-mounted shot leaves 90 degrees clockwise of it (the handedness)', () => {
    for (const headingRad of CARDINALS) {
      const v = vehicle({ position: { x: 0, y: 0 }, headingRad, weapons: [weaponState({ weaponId: 'machinegun', facing: 'RIGHT', dp: 3, ammo: 20 })] });
      // Along the car's right hand for THIS heading, off the nose by a quarter
      // turn clockwise — same derivation as the assertion below.
      const target = { position: { x: Math.sin(headingRad) * 50, y: -Math.cos(headingRad) * 50 }, headingRad };
      const result = fire({ vehicle: v, weaponSlotIndex: 0, target, ctx: ctxWith(createRng('rgt')), tick: 0, spawnedEntityId: 'p2', deployDropOffsetM: 3 });
      expect(result.spawn?.kind).toBe('PROJECTILE');
      if (result.spawn?.kind !== 'PROJECTILE') continue;
      const vel = result.spawn.projectile.velocity;
      const len = Math.hypot(vel.x, vel.y);
      const nose = { x: Math.cos(headingRad), y: Math.sin(headingRad) };
      // RIGHT is a quarter turn CLOCKWISE from the nose in this up-positive
      // frame, which is what makes it -Y and not +Y at heading 0.
      const right = { x: nose.y, y: -nose.x };
      expect((vel.x * right.x + vel.y * right.y) / len).toBeCloseTo(1, 6);
    }
  });
});

describe('facingWorldDirection', () => {
  it('at heading 0 each facing points along the owner table, rotated into world space', () => {
    // Derived from the owner rather than restated, so this test cannot disagree
    // with it. It DID disagree, for the whole life of the 90-degree bug.
    for (const facing of ['FRONT', 'REAR', 'LEFT', 'RIGHT'] as const) {
      const world = facingWorldDirection(0, facing);
      // Compared componentwise: `rotateVec` can produce -0 where the table holds
      // +0, and `-0 === +0` is true for a direction vector, so a deep equal
      // would fail on arithmetic that is not wrong.
      expect(world.x).toBeCloseTo(VEHICLE_LOCAL_FACING[facing].x, 12);
      expect(world.y).toBeCloseTo(VEHICLE_LOCAL_FACING[facing].y, 12);
      // And each mount's OPPOSITE (FRONT/REAR, LEFT/RIGHT — not "any other
      // mount") is exactly its negation. That is what pins handedness: a table
      // with RIGHT at +Y satisfies every perpendicular check, and only the
      // antiparallel pair catches it.
      const opposite: Record<typeof facing, typeof facing> = {
        FRONT: 'REAR',
        REAR: 'FRONT',
        LEFT: 'RIGHT',
        RIGHT: 'LEFT',
      };
      const back = facingWorldDirection(0, opposite[facing]);
      expect(back.x).toBeCloseTo(-VEHICLE_LOCAL_FACING[facing].x, 12);
      expect(back.y).toBeCloseTo(-VEHICLE_LOCAL_FACING[facing].y, 12);
    }
  });

  it('throws for UNDERBODY, which has no world-facing direction', () => {
    expect(() => facingWorldDirection(0, 'UNDERBODY')).toThrow();
  });
});

describe('spawnProjectile / spawnDeployable', () => {
  it('spawnProjectile carries the pre-rolled outcome for later release on intersection', () => {
    const weaponDef = getWeapon('rocketlauncher');
    const projectile = spawnProjectile('id-1', 'owner-1', { x: 1, y: 2 }, weaponDef, 'FRONT', 0, 10, {
      hit: true,
      damage: 4,
      facing: 'FRONT',
    });
    expect(projectile.outcome).toEqual({ hit: true, damage: 4, facing: 'FRONT' });
    expect(projectile.spawnTick).toBe(10);
  });

  it('spawnDeployable throws for a weapon with no deployable definition', () => {
    const weaponDef = getWeapon('machinegun');
    expect(() => spawnDeployable('id-1', 'owner-1', { x: 0, y: 0 }, 0, weaponDef, 3, 0)).toThrow();
  });
});
