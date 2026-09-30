import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  AI_NODES,
  acquireTarget,
  alignHeadingFor,
  avoidHazardNode,
  computeAlignmentInput,
  decideAI,
  engageWeaponNode,
  hasLineOfSight,
  idleNode,
  pursueNode,
  ramAndPinNode,
  retreatNode,
  type AIContext,
  type AIPersonality,
  type AIWorldView,
  type HazardInstance,
} from '@/sim/ai';
import { getPlant, getWeapon } from '@/data/rulesets';
import { FACINGS, makeArmorRecord, VEHICLE_LOCAL_FACING, type Facing, type VehicleDesign, type VehicleState, type WeaponState } from '@/sim/types';
// The authoritative fire pipeline itself — used throughout below as an
// INDEPENDENT cross-check, so these tests actually fail if ai.ts's geometry
// ever again drifts out of sync with what validateFire really enforces,
// instead of re-checking ai.ts's own private formula against itself.
import { facingWorldDirection, validateFire } from '@/sim/combat';
import { facingForLocalDirection, rotateVec } from '@/sim/damage';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeWeaponState(weaponId: string, facing: Facing, overrides: Partial<WeaponState> = {}): WeaponState {
  const def = getWeapon(weaponId);
  return {
    weaponId,
    facing,
    ammo: def.ammoCapacity,
    dp: def.maxDP,
    maxDP: def.maxDP,
    cooldownRemaining: 0,
    destroyed: false,
    ...overrides,
  };
}

function makeVehicle(id: string, overrides: Partial<VehicleState> = {}, designOverrides: Partial<VehicleDesign> = {}): VehicleState {
  const design: VehicleDesign = {
    name: id,
    bodyId: 'midsized',
    chassisId: 'standard',
    suspensionId: 'light',
    plantId: 'medium',
    tireId: 'standard',
    armor: makeArmorRecord(10),
    weapons: [],
    ...designOverrides,
  };
  return {
    id,
    ownerId: id,
    design,
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 99,
    odometerMiles: 0,
    armorDP: makeArmorRecord(10),
    tireDP: [4, 4, 4, 4],
    plantDP: getPlant(design.plantId).maxDP,
    weapons: [],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    ...overrides,
  };
}

function makePersonality(overrides: Partial<AIPersonality> = {}): AIPersonality {
  return { aggression: 0.5, caution: 0.5, skill: 0.5, playerThreatBias: 0, ...overrides };
}

function makeWorld(overrides: Partial<AIWorldView> = {}): AIWorldView {
  return {
    tick: 0,
    bounds: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
    vehicles: [],
    hazards: [],
    playerVehicleId: 'player',
    ...overrides,
  };
}

function makeCtx(
  self: VehicleState,
  world: AIWorldView,
  personality: AIPersonality = makePersonality(),
  seed = 1,
): AIContext {
  return { self, world, personality, seed };
}

const FRONT_WEAPON = () => makeWeaponState('machinegun', 'FRONT');
const LEFT_WEAPON = () => makeWeaponState('machinegun', 'LEFT');
const REAR_WEAPON = () => makeWeaponState('machinegun', 'REAR');

// ---------------------------------------------------------------------------
// Alignment math
// ---------------------------------------------------------------------------

describe('facing alignment', () => {
  const BEARINGS = [0, 0.4, 1.1, Math.PI / 2, Math.PI, -1.3, -Math.PI / 2, 2.9];
  const FACINGS_TO_CHECK: Facing[] = ['FRONT', 'REAR', 'LEFT', 'RIGHT'];

  it('computes a heading for every facing that actually brings it to bear, checked against combat.ts\'s OWN quadrant test', () => {
    // This is deliberately NOT ai.ts's private `bearingQuadrant` re-called on
    // itself (that would just prove the two halves of ai.ts agree with each
    // other, which is exactly how the original bug passed 39 tests). It
    // imports `rotateVec`/`facingForLocalDirection` straight from
    // `@/sim/damage` — the same two functions `combat.ts`'s `validateFire`
    // composes — so this fails for real if `alignHeadingFor` ever drifts from
    // what the fire pipeline actually enforces.
    for (const bearing of BEARINGS) {
      for (const facing of FACINGS_TO_CHECK) {
        const heading = alignHeadingFor(bearing, facing);
        const worldDelta = { x: Math.cos(bearing), y: Math.sin(bearing) };
        const local = rotateVec(worldDelta, -heading);
        expect(facingForLocalDirection(local)).toBe(facing);
      }
    }
  });

  it("every alignment heading validates as a real shot against combat.ts's validateFire, for every facing and bearing", () => {
    for (const bearing of BEARINGS) {
      for (const facing of FACINGS_TO_CHECK) {
        const headingRad = alignHeadingFor(bearing, facing);
        const self = makeVehicle('self', { position: { x: 0, y: 0 }, headingRad, weapons: [makeWeaponState('machinegun', facing)] });
        const targetPosition = { x: Math.cos(bearing) * 50, y: Math.sin(bearing) * 50 };
        expect(validateFire(self, 0, targetPosition)).toMatchObject({ ok: true, reason: null });
      }
    }
  });

  it('computeAlignmentInput points the joystick at whatever heading makes `facing`\'s combat.ts world direction match the bearing', () => {
    // Independent of any hardcoded expected numbers: derive the expectation
    // from combat.ts's own `facingWorldDirection` for each facing/bearing.
    for (const bearing of BEARINGS) {
      for (const facing of FACINGS_TO_CHECK) {
        const { moveX, moveY } = computeAlignmentInput(bearing, facing);
        const heading = Math.atan2(moveY, moveX);
        const worldDir = facingWorldDirection(heading, facing);
        expect(worldDir.x).toBeCloseTo(Math.cos(bearing), 5);
        expect(worldDir.y).toBeCloseTo(Math.sin(bearing), 5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Target acquisition
// ---------------------------------------------------------------------------

describe('acquireTarget', () => {
  it('prefers the nearer, more vulnerable AI opponent over a healthy, distant player (free-for-all)', () => {
    const self = makeVehicle('ai-1');
    const woundedAI = makeVehicle('ai-2', {
      position: { x: 10, y: 0 },
      armorDP: makeArmorRecord(1),
    });
    const healthyPlayer = makeVehicle('player', { position: { x: 900, y: 900 } });
    const world = makeWorld({ vehicles: [self, woundedAI, healthyPlayer], playerVehicleId: 'player' });
    const ctx = makeCtx(self, world, makePersonality({ playerThreatBias: 0 }));

    const acquired = acquireTarget(ctx);
    expect(acquired?.vehicle.id).toBe('ai-2');
    expect(acquired?.vehicle.id).not.toBe(world.playerVehicleId);
  });

  it('playerThreatBias is a real, tunable knob that can flip target choice toward the player', () => {
    const self = makeVehicle('ai-1');
    // Two otherwise-identical, equidistant opponents; one happens to be the player.
    const otherAI = makeVehicle('ai-2', { position: { x: 20, y: 0 } });
    const player = makeVehicle('player', { position: { x: -20, y: 0 } });
    const world = makeWorld({ vehicles: [self, otherAI, player], playerVehicleId: 'player' });

    const neutral = acquireTarget(makeCtx(self, world, makePersonality({ playerThreatBias: 0 })));
    const biased = acquireTarget(makeCtx(self, world, makePersonality({ playerThreatBias: 5 })));

    expect(biased?.vehicle.id).toBe('player');
    // Sanity: the bias is additive score, not a hidden constant baked elsewhere.
    expect(biased?.score).toBeGreaterThan(neutral?.score ?? Infinity);
  });

  it('ignores destroyed vehicles and itself', () => {
    const self = makeVehicle('ai-1');
    const wreck = makeVehicle('ai-2', { position: { x: 5, y: 0 }, destroyed: true });
    const world = makeWorld({ vehicles: [self, wreck] });
    expect(acquireTarget(makeCtx(self, world))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Engage: facing-based behavior selection + fire gating
// ---------------------------------------------------------------------------

describe('engageWeaponNode', () => {
  it('fires immediately when a FRONT weapon already bears, in range, with LOS (ALIGN_AND_FIRE)', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    // headingRad picked via the module's own alignment math so FRONT
    // actually bears per combat.ts's real facing test — then independently
    // confirmed against validateFire itself, not just asserted.
    const headingRad = alignHeadingFor(Math.atan2(0, 50), 'FRONT');
    const self = makeVehicle('self', { headingRad, weapons: [FRONT_WEAPON()] });
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision?.behavior).toBe('ALIGN_AND_FIRE');
    expect(decision?.input.fire).toBe(true);
    expect(decision?.input.weaponSlot).toBe(0);
    expect(validateFire(self, 0, target.position)).toMatchObject({ ok: true, reason: null });
  });

  it('turns (CIRCLE) instead of firing when only a LEFT weapon is mounted and the nose is not yet aligned', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const self = makeVehicle('self', { weapons: [LEFT_WEAPON()] }); // headingRad 0: not aligned for LEFT
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision?.behavior).toBe('CIRCLE');
    expect(decision?.input.fire).toBe(false);
    // Confirmed against the real pipeline, not just "didn't fire": this
    // heading genuinely would be rejected as WRONG_FACING.
    expect(validateFire(self, 0, target.position).reason).toBe('WRONG_FACING');
  });

  it('runs while aiming a REAR weapon (KITE_REAR): steers toward the heading that brings REAR to bear, not straight at the target', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const self = makeVehicle('self', { weapons: [REAR_WEAPON()] }); // headingRad 0: not aligned for REAR yet
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision?.behavior).toBe('KITE_REAR');
    expect(decision?.input.fire).toBe(false);
    expect(validateFire(self, 0, target.position).reason).toBe('WRONG_FACING');
    // Not the naive "seek target" vector (1, 0) — it steers toward the
    // heading `alignHeadingFor` names for REAR at this bearing.
    const expectedHeading = alignHeadingFor(Math.atan2(0, 50), 'REAR');
    expect(decision!.input.moveX).toBeCloseTo(Math.cos(expectedHeading), 5);
    expect(decision!.input.moveY).toBeCloseTo(Math.sin(expectedHeading), 5);
  });

  it('once heading is turned so REAR actually bears (per combat.ts), it fires', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const headingRad = alignHeadingFor(Math.atan2(0, 50), 'REAR');
    const self = makeVehicle('self', { headingRad, weapons: [REAR_WEAPON()] });
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision?.input.fire).toBe(true);
    expect(decision?.input.weaponSlot).toBe(0);
    expect(validateFire(self, 0, target.position)).toMatchObject({ ok: true, reason: null });
  });

  it('refuses to fire out of range even when perfectly aligned', () => {
    const def = getWeapon('machinegun');
    const target = makeVehicle('target', { position: { x: def.rangeM + 50, y: 0 } });
    const headingRad = alignHeadingFor(Math.atan2(0, def.rangeM + 50), 'FRONT');
    const self = makeVehicle('self', { headingRad, weapons: [FRONT_WEAPON()] });
    // validateFire itself has no range gate at all (only `minRangeM` forces a
    // 0% hit chance later, in `effectiveHitChance`) — this shot validates ok.
    expect(validateFire(self, 0, target.position)).toMatchObject({ ok: true, reason: null });
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    // ...but engageWeaponNode still refuses: range is ai.ts's own tactical
    // gate against wasting ammo on a shot that can never reach, and this test
    // must actually exercise it (aligned, not just "not yet turned").
    expect(decision?.input.fire).toBe(false);
  });

  it('refuses to fire while on cooldown', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const headingRad = alignHeadingFor(Math.atan2(0, 50), 'FRONT');
    const self = makeVehicle('self', { headingRad, weapons: [makeWeaponState('machinegun', 'FRONT', { cooldownRemaining: 12 })] });
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision?.input.fire).toBe(false);
    expect(validateFire(self, 0, target.position).reason).toBe('COOLDOWN');
  });

  it('refuses to fire with zero ammo, and never grants itself more', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const headingRad = alignHeadingFor(Math.atan2(0, 50), 'FRONT');
    const self = makeVehicle('self', { headingRad, weapons: [makeWeaponState('machinegun', 'FRONT', { ammo: 0 })] });
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision?.input.fire).toBe(false);
    expect(validateFire(self, 0, target.position).reason).toBe('NO_AMMO');
  });

  it('a laser refuses to fire without enough battery, and battery is read, never bumped up', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const headingRad = alignHeadingFor(Math.atan2(0, 50), 'FRONT');
    const self = makeVehicle('self', { headingRad, battery: 0, weapons: [makeWeaponState('laser', 'FRONT')] });
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision?.input.fire).toBe(false);
    expect(self.battery).toBe(0);
    expect(validateFire(self, 0, target.position).reason).toBe('NO_BATTERY');
  });

  it('skips a destroyed weapon and a weapon with 0 DP entirely', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const self = makeVehicle('self', {
      weapons: [makeWeaponState('machinegun', 'FRONT', { destroyed: true }), makeWeaponState('rocketlauncher', 'FRONT', { dp: 0 })],
    });
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision).toBeNull();
  });

  it('never shoots through a smoke cloud, including its own', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const headingRad = alignHeadingFor(Math.atan2(0, 50), 'FRONT');
    const self = makeVehicle('self', { headingRad, weapons: [FRONT_WEAPON()] });
    const smoke: HazardInstance = {
      id: 'smoke-1',
      kind: 'SMOKE',
      position: { x: 25, y: 0 },
      radiusM: 10,
      blocksLineOfSight: true,
      ownerId: self.id,
    };
    const world = makeWorld({ vehicles: [self, target], hazards: [smoke] });
    expect(hasLineOfSight(world, self.position, target.position)).toBe(false);
    const decision = engageWeaponNode(makeCtx(self, world), target);
    expect(decision?.input.fire).toBe(false);
    // Aligned and in range — the ONLY thing stopping this shot is the smoke.
    expect(validateFire(self, 0, target.position)).toMatchObject({ ok: true, reason: null });
  });

  it('a cloud that does not block LOS (e.g. paint sprayer) does not stop fire', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const self = makeVehicle('self', { weapons: [FRONT_WEAPON()] });
    const paint: HazardInstance = { id: 'paint-1', kind: 'SMOKE', position: { x: 25, y: 0 }, radiusM: 10 };
    const world = makeWorld({ vehicles: [self, target], hazards: [paint] });
    expect(hasLineOfSight(world, self.position, target.position)).toBe(true);
  });

  it('does not treat a REAR minedropper as fireable at a target directly behind but far outside its own trigger radius (proximity gate)', () => {
    // Reproduces the reviewer's probe: a deployable used to be scored
    // bearsNow=inRange=losClear=true unconditionally, so it could out-score
    // and fire regardless of distance.
    const self = makeVehicle('self', { position: { x: 0, y: 0 }, headingRad: 0, weapons: [makeWeaponState('minedropper', 'REAR')] });
    const target = makeVehicle('target', { position: { x: 0, y: -900 } }); // bears REAR, nowhere near triggerRadiusM
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision?.input.fire).toBe(false);
  });

  it('does fire a REAR minedropper once the target is close enough behind to plausibly run over it', () => {
    const self = makeVehicle('self', { position: { x: 0, y: 0 }, headingRad: 0, weapons: [makeWeaponState('minedropper', 'REAR')] });
    // Behind the car, placed along the owner's REAR direction rather than a
    // typed coordinate: this was `{x: 0, y: -2}`, which is FRONT-and-right in
    // the rotated frame. Well inside triggerRadiusM (2.2m).
    const rear = VEHICLE_LOCAL_FACING.REAR;
    const target = makeVehicle('target', { position: { x: rear.x * 2, y: rear.y * 2 } });
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision?.input.fire).toBe(true);
    expect(decision?.input.weaponSlot).toBe(0);
  });

  it('does not empty a deployable magazine at a target far outside both its bearing and its effect radius (probe regression)', () => {
    const self = makeVehicle('self', {
      position: { x: 0, y: 0 },
      headingRad: 0,
      weapons: [FRONT_WEAPON(), makeWeaponState('minedropper', 'REAR')],
    });
    const target = makeVehicle('target', { position: { x: 900, y: 0 } });
    const decision = engageWeaponNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision?.input.fire).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Avoidance
// ---------------------------------------------------------------------------

describe('avoidHazardNode', () => {
  it('steers away from a nearby mine, scaled by skill, and never fires while dodging', () => {
    const self = makeVehicle('self', { position: { x: 0, y: 0 } });
    const mine: HazardInstance = { id: 'mine-1', kind: 'MINE', position: { x: 3, y: 0 }, radiusM: 2.2 };
    const world = makeWorld({ vehicles: [self], hazards: [mine] });
    const decision = avoidHazardNode(makeCtx(self, world, makePersonality({ skill: 0.9 })), null);
    expect(decision?.behavior).toBe('AVOID_HAZARD');
    expect(decision?.input.fire).toBe(false);
    // Moving away from (5,0) means a negative x component.
    expect(decision!.input.moveX).toBeLessThan(0);
  });

  it('a low-skill AI does not notice a hazard outside its (smaller) detection radius', () => {
    const self = makeVehicle('self', { position: { x: 0, y: 0 } });
    const mine: HazardInstance = { id: 'mine-1', kind: 'MINE', position: { x: 100, y: 0 }, radiusM: 2.2 };
    const world = makeWorld({ vehicles: [self], hazards: [mine] });
    const decision = avoidHazardNode(makeCtx(self, world, makePersonality({ skill: 0 })), null);
    expect(decision).toBeNull();
  });

  it('steers back toward the arena center once out of bounds', () => {
    const bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const self = makeVehicle('self', { position: { x: 150, y: 0 } });
    const world = makeWorld({ vehicles: [self], bounds });
    const decision = avoidHazardNode(makeCtx(self, world), null);
    expect(decision?.behavior).toBe('AVOID_HAZARD');
    expect(decision!.input.moveX).toBeLessThan(0);
  });

  it('does NOT treat a smoke cloud as a threat to dodge — it is a visibility problem, not a hazard', () => {
    const self = makeVehicle('self', { position: { x: 0, y: 0 } });
    const smoke: HazardInstance = { id: 'smoke-1', kind: 'SMOKE', position: { x: 3, y: 0 }, radiusM: 22, blocksLineOfSight: true };
    const world = makeWorld({ vehicles: [self], hazards: [smoke] });
    const decision = avoidHazardNode(makeCtx(self, world, makePersonality({ skill: 1 })), null);
    expect(decision).toBeNull();
  });

  it('still dodges a live mine at the same distance/radius a smoke cloud is ignored at (kind still matters, not just distance)', () => {
    const self = makeVehicle('self', { position: { x: 0, y: 0 } });
    const mine: HazardInstance = { id: 'mine-1', kind: 'MINE', position: { x: 3, y: 0 }, radiusM: 22 };
    const world = makeWorld({ vehicles: [self], hazards: [mine] });
    const decision = avoidHazardNode(makeCtx(self, world, makePersonality({ skill: 1 })), null);
    expect(decision?.behavior).toBe('AVOID_HAZARD');
  });

  it('does not lock the AI out of firing after it deploys its own smoke (decideAI still engages)', () => {
    // Reproduces the reviewer's probe: self ready to fire, a live target in
    // range, and one of self's OWN smoke clouds nearby used to force
    // AVOID_HAZARD with fire suppressed for the cloud's entire lifetime.
    const target = makeVehicle('target', { position: { x: 30, y: 0 } });
    const headingRad = alignHeadingFor(Math.atan2(0, 30), 'FRONT');
    const self = makeVehicle('self', { position: { x: 0, y: 0 }, headingRad, weapons: [FRONT_WEAPON()] });
    const ownSmoke: HazardInstance = { id: 'own-smoke', kind: 'SMOKE', position: { x: -30, y: 0 }, radiusM: 22, ownerId: 'self' };
    const world = makeWorld({ vehicles: [self, target], hazards: [ownSmoke] });
    const decision = decideAI(makeCtx(self, world, makePersonality({ skill: 1 })));
    expect(decision.behavior).not.toBe('AVOID_HAZARD');
    expect(decision.input.fire).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retreat / ram / pursue / idle
// ---------------------------------------------------------------------------

function heavilyDamaged(id: string, position = { x: 0, y: 0 }): VehicleState {
  return makeVehicle(
    id,
    {
      position,
      armorDP: makeArmorRecord(1),
      plantDP: 1,
      tireDP: [1, 1, 1, 1],
      weapons: [REAR_WEAPON()],
    },
    { armor: makeArmorRecord(10) },
  );
}

describe('retreatNode', () => {
  it('flees the nearest threat once condition drops below the caution threshold', () => {
    const self = heavilyDamaged('self', { x: 0, y: 0 });
    const threat = makeVehicle('threat', { position: { x: 50, y: 0 } });
    const world = makeWorld({ vehicles: [self, threat] });
    const decision = retreatNode(makeCtx(self, world, makePersonality({ caution: 0.9 })), threat);
    expect(decision?.behavior).toBe('RETREAT');
    expect(decision!.input.moveX).toBeLessThan(0); // away from threat at +x
  });

  it('fires its rear weapon while fleeing once it bears (run while firing rear weapons)', () => {
    // Turned so REAR actually bears per combat.ts's real facing test — this
    // is the "in the middle of a kiting run" moment, not the first tick of
    // it (running straight away does not, by itself, put REAR on the
    // threat — see the file header on why FRONT/REAR/LEFT/RIGHT's world
    // directions are combat.ts's own convention, not "opposite the nose").
    const threat = makeVehicle('threat', { position: { x: 50, y: 0 } });
    const headingRad = alignHeadingFor(Math.atan2(0, 50), 'REAR');
    const self = { ...heavilyDamaged('self', { x: 0, y: 0 }), headingRad };
    const world = makeWorld({ vehicles: [self, threat] });
    const decision = retreatNode(makeCtx(self, world, makePersonality({ caution: 0.9 })), threat);
    expect(decision!.input.fire).toBe(true);
    expect(decision!.input.weaponSlot).toBe(0);
    // Authoritative cross-check against the real fire pipeline.
    expect(validateFire(self, 0, threat.position)).toMatchObject({ ok: true, reason: null });
  });

  it('does not trigger when condition is above the caution threshold', () => {
    const self = makeVehicle('self');
    const threat = makeVehicle('threat', { position: { x: 50, y: 0 } });
    const world = makeWorld({ vehicles: [self, threat] });
    expect(retreatNode(makeCtx(self, world, makePersonality({ caution: 0.9 })), threat)).toBeNull();
  });
});

describe('ramAndPinNode', () => {
  it('rams when aggressive, heavier, and permitted', () => {
    const self = makeVehicle('self', { position: { x: 0, y: 0 } }, { bodyId: 'luxury' });
    const target = makeVehicle('target', { position: { x: 30, y: 0 } }, { bodyId: 'subcompact' });
    const world = makeWorld({ vehicles: [self, target] });
    const decision = ramAndPinNode(makeCtx(self, world, makePersonality({ aggression: 0.9, caution: 0.1 })), target);
    expect(decision?.behavior).toBe('RAM');
    expect(decision!.input.moveX).toBeCloseTo(1, 5);
  });

  it('refuses to ram a heavier opponent', () => {
    const self = makeVehicle('self', { position: { x: 0, y: 0 } }, { bodyId: 'subcompact' });
    const target = makeVehicle('target', { position: { x: 30, y: 0 } }, { bodyId: 'luxury' });
    const world = makeWorld({ vehicles: [self, target] });
    expect(ramAndPinNode(makeCtx(self, world, makePersonality({ aggression: 0.9, caution: 0.1 })), target)).toBeNull();
  });

  it('refuses to ram when caution outweighs aggression', () => {
    const self = makeVehicle('self', { position: { x: 0, y: 0 } }, { bodyId: 'luxury' });
    const target = makeVehicle('target', { position: { x: 30, y: 0 } }, { bodyId: 'subcompact' });
    const world = makeWorld({ vehicles: [self, target] });
    expect(ramAndPinNode(makeCtx(self, world, makePersonality({ aggression: 0.2, caution: 0.8 })), target)).toBeNull();
  });

  it('does not ram from far outside its own mounted weapons\' range (probe regression: was RAM from 700m with a single LEFT machinegun)', () => {
    const def = getWeapon('machinegun');
    const self = makeVehicle('self', { position: { x: 0, y: 0 }, weapons: [LEFT_WEAPON()] }, { bodyId: 'luxury' });
    const target = makeVehicle('target', { position: { x: 700, y: 0 } }, { bodyId: 'subcompact' });
    expect(700).toBeGreaterThan(def.rangeM); // sanity: the probe distance really is out of range
    const world = makeWorld({ vehicles: [self, target] });
    const decision = ramAndPinNode(makeCtx(self, world, makePersonality({ aggression: 0.9, caution: 0.1 })), target);
    expect(decision).toBeNull();
  });

  it('still rams once the target is within its mounted weapon\'s range', () => {
    const def = getWeapon('machinegun');
    const self = makeVehicle('self', { position: { x: 0, y: 0 }, weapons: [LEFT_WEAPON()] }, { bodyId: 'luxury' });
    const target = makeVehicle('target', { position: { x: def.rangeM - 5, y: 0 } }, { bodyId: 'subcompact' });
    const world = makeWorld({ vehicles: [self, target] });
    const decision = ramAndPinNode(makeCtx(self, world, makePersonality({ aggression: 0.9, caution: 0.1 })), target);
    expect(decision?.behavior).toBe('RAM');
  });

  it('has no range gate at all when it has no ranged weapon to compare against (nothing better to do than close in)', () => {
    const self = makeVehicle('self', { position: { x: 0, y: 0 }, weapons: [] }, { bodyId: 'luxury' });
    const target = makeVehicle('target', { position: { x: 5000, y: 0 } }, { bodyId: 'subcompact' });
    const world = makeWorld({ vehicles: [self, target] });
    const decision = ramAndPinNode(makeCtx(self, world, makePersonality({ aggression: 0.9, caution: 0.1 })), target);
    expect(decision?.behavior).toBe('RAM');
  });
});

describe('pursueNode / idleNode', () => {
  it('pursues a target with no fire when nothing can bear', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const self = makeVehicle('self');
    const decision = pursueNode(makeCtx(self, makeWorld({ vehicles: [self, target] })), target);
    expect(decision.behavior).toBe('PURSUE');
    expect(decision.input.fire).toBe(false);
    expect(decision.input.moveX).toBeCloseTo(1, 5);
  });

  it('idles with a neutral InputFrame when the world is empty', () => {
    const self = makeVehicle('self');
    const decision = idleNode(makeCtx(self, makeWorld({ vehicles: [self] })));
    expect(decision).toEqual({ behavior: 'IDLE', targetId: null, input: { moveX: 0, moveY: 0, fire: false, weaponSlot: -1 } });
  });
});

// ---------------------------------------------------------------------------
// decideAI: full priority chain + free-for-all + purity + determinism
// ---------------------------------------------------------------------------

describe('decideAI', () => {
  it('exposes every named node used by the priority chain', () => {
    expect(Object.keys(AI_NODES).sort()).toEqual(
      ['acquireTarget', 'avoidHazardNode', 'engageWeaponNode', 'idleNode', 'pursueNode', 'ramAndPinNode', 'retreatNode'].sort(),
    );
  });

  it('proves free-for-all: an AI can select another AI as its target over the player', () => {
    const self = makeVehicle('ai-1', { weapons: [FRONT_WEAPON()] });
    const otherAI = makeVehicle('ai-2', { position: { x: 10, y: 0 }, armorDP: makeArmorRecord(1) });
    const player = makeVehicle('player', { position: { x: 900, y: 900 } });
    const world = makeWorld({ vehicles: [self, otherAI, player], playerVehicleId: 'player' });
    const decision = decideAI(makeCtx(self, world, makePersonality({ playerThreatBias: 0 })));
    expect(decision.targetId).toBe('ai-2');
  });

  it('avoid-hazard outranks every other priority', () => {
    const self = heavilyDamaged('self', { x: 0, y: 0 });
    const threat = makeVehicle('threat', { position: { x: 50, y: 0 } });
    const mine: HazardInstance = { id: 'm1', kind: 'MINE', position: { x: 3, y: 0 }, radiusM: 2.2 };
    const world = makeWorld({ vehicles: [self, threat], hazards: [mine] });
    const decision = decideAI(makeCtx(self, world, makePersonality({ caution: 0.9 })));
    expect(decision.behavior).toBe('AVOID_HAZARD');
  });

  it('idles when there is nothing else alive in the world', () => {
    const self = makeVehicle('self');
    const decision = decideAI(makeCtx(self, makeWorld({ vehicles: [self] })));
    expect(decision).toEqual({ behavior: 'IDLE', targetId: null, input: { moveX: 0, moveY: 0, fire: false, weaponSlot: -1 } });
  });

  it('engageWeaponNode becomes reachable once ram is range-gated out at long range (was unreachable dead code)', () => {
    const self = makeVehicle('self', { position: { x: 0, y: 0 }, weapons: [FRONT_WEAPON()] }, { bodyId: 'luxury' });
    const target = makeVehicle('target', { position: { x: 700, y: 0 } }, { bodyId: 'subcompact' });
    const world = makeWorld({ vehicles: [self, target] });
    const decision = decideAI(makeCtx(self, world, makePersonality({ aggression: 0.9, caution: 0.1 })));
    expect(decision.behavior).not.toBe('RAM');
  });

  it('only ever produces an InputFrame — no other shape leaks out', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const self = makeVehicle('self', { weapons: [FRONT_WEAPON()] });
    const decision = decideAI(makeCtx(self, makeWorld({ vehicles: [self, target] })));
    expect(Object.keys(decision.input).sort()).toEqual(['fire', 'moveX', 'moveY', 'weaponSlot']);
    expect(typeof decision.input.moveX).toBe('number');
    expect(typeof decision.input.moveY).toBe('number');
    expect(typeof decision.input.fire).toBe('boolean');
    expect(typeof decision.input.weaponSlot).toBe('number');
  });

  it('never mutates the world or vehicle state it was handed (InputFrame is the only output)', () => {
    const target = makeVehicle('target', { position: { x: 50, y: 0 } });
    const self = makeVehicle('self', { weapons: [FRONT_WEAPON()] });
    const world = makeWorld({ vehicles: [self, target] });
    const beforeSelf = JSON.stringify(self);
    const beforeTarget = JSON.stringify(target);
    const beforeWorld = JSON.stringify(world);

    decideAI(makeCtx(self, world, makePersonality(), 42));

    expect(JSON.stringify(self)).toBe(beforeSelf);
    expect(JSON.stringify(target)).toBe(beforeTarget);
    expect(JSON.stringify(world)).toBe(beforeWorld);
  });

  it('the source file never bypasses the fire pipeline or writes vehicle/world state directly', () => {
    const path = fileURLToPath(new URL('../../src/sim/ai.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const forbidden = [
      'Math.random(',
      'Date.now(',
      '.speedMps =',
      '.position =',
      '.armorDP =',
      '.tireDP =',
      '.plantDP =',
      '.destroyed = true',
      '.ammo =',
      '.dp =',
      '.battery =',
      'applyDamage',
      'fireWeapon(',
      'resolveCombat(',
    ];
    for (const token of forbidden) {
      expect(source.includes(token), `ai.ts must not contain "${token}"`).toBe(false);
    }
  });

  it('is deterministic: same world + same seed => same decision, across independently-built copies', () => {
    function buildWorld(): { self: VehicleState; world: AIWorldView } {
      const self = makeVehicle('ai-1', { weapons: [LEFT_WEAPON(), REAR_WEAPON()] });
      const a = makeVehicle('ai-2', { position: { x: 20, y: 0 } });
      const b = makeVehicle('ai-3', { position: { x: -20, y: 0 } }); // score-symmetric with `a`
      const world = makeWorld({ vehicles: [self, a, b], playerVehicleId: 'player-not-present' });
      return { self, world };
    }

    const run1 = buildWorld();
    const run2 = buildWorld();
    const decision1 = decideAI(makeCtx(run1.self, run1.world, makePersonality(), 777));
    const decision2 = decideAI(makeCtx(run2.self, run2.world, makePersonality(), 777));
    expect(decision1).toEqual(decision2);

    // Same tie-break scenario, repeated many times with the same seed, must
    // always resolve to the same target — proving the RNG is seeded, not
    // wall-clock or otherwise nondeterministic.
    const repeats = new Set(
      Array.from({ length: 20 }, () => {
        const { self, world } = buildWorld();
        return acquireTarget(makeCtx(self, world, makePersonality(), 777))?.vehicle.id;
      }),
    );
    expect(repeats.size).toBe(1);
  });

  it('is deterministic across a simulated multi-tick, multi-agent free-for-all', () => {
    function buildWorld(tick: number): AIWorldView {
      const a = makeVehicle('ai-1', { position: { x: 0, y: 0 }, weapons: [FRONT_WEAPON()] });
      const b = makeVehicle('ai-2', { position: { x: 40, y: 5 }, weapons: [REAR_WEAPON()] });
      const c = makeVehicle('ai-3', { position: { x: -30, y: -10 }, weapons: [LEFT_WEAPON()] });
      return makeWorld({ tick, vehicles: [a, b, c] });
    }

    function runAllTicks(): unknown[] {
      const decisions: unknown[] = [];
      for (let tick = 0; tick < 5; tick++) {
        const world = buildWorld(tick);
        for (const vehicle of world.vehicles) {
          decisions.push(decideAI(makeCtx(vehicle, world, makePersonality(), 2024)));
        }
      }
      return decisions;
    }

    expect(runAllTicks()).toEqual(runAllTicks());
  });
});

// Sanity on the fixture helper itself: every facing used by these tests is a
// real one from the shared type, not a typo'd string literal.
describe('fixtures', () => {
  it('use real Facing values', () => {
    expect(FACINGS).toContain('FRONT');
    expect(FACINGS).toContain('REAR');
    expect(FACINGS).toContain('LEFT');
    expect(FACINGS).toContain('RIGHT');
  });
});
