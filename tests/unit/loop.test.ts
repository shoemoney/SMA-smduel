import { describe, expect, it } from 'vitest';

import { drivingConfig } from '@/data/rulesets';
import {
  createGameLoop,
  createSystemsRegistry,
  defaultInputFrame,
  dtSecondsFromTickRate,
  SYSTEM_ORDER,
  type GameLoop,
  type InputFrame,
  type SystemFn,
  type SystemName,
} from '@/sim/loop';
import { makeArmorRecord, type VehicleDesign, type VehicleState } from '@/sim/types';
import { createWorld, snapshot, type World } from '@/sim/world';
import { advanceProjectile, projectileExpired } from '@/sim/combat';
import { createRng } from '@/util/rng';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeVehicle(id: string, x: number, y: number): VehicleState {
  const design: VehicleDesign = {
    name: 'test-car',
    bodyId: 'test-body',
    chassisId: 'test-chassis',
    suspensionId: 'test-suspension',
    plantId: 'test-plant',
    tireId: 'test-tire',
    armor: makeArmorRecord(10),
    weapons: [],
  };
  return {
    id,
    ownerId: 'driver-1',
    design,
    position: { x, y },
    headingRad: 0,
    speedMps: 0,
    battery: 99,
    odometerMiles: 0,
    armorDP: makeArmorRecord(10),
    tireDP: [10, 10, 10, 10],
    plantDP: 10,
    weapons: [],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
  };
}

/** Deterministic, non-random "scripted input stream": a pure function of tick index. */
function scriptedInput(tick: number): InputFrame {
  return {
    moveX: Math.sin(tick * 0.13) >= 0 ? 1 : -1,
    moveY: Math.cos(tick * 0.07) >= 0 ? 1 : -1,
    fire: tick % 11 === 0,
    weaponSlot: tick % 3,
  };
}

/**
 * Draws one word from the world's real seeded RNG (`@/util/rng`) and writes
 * the advanced state back onto the world, so this test exercises the
 * project's actual RngState integration instead of a PRNG defined only in
 * this test file. `createRng(0)` is a throwaway seed: `restore()` overwrites
 * both the internal words and the active seed key from `world.rngState`
 * regardless of what the throwaway Rng was constructed with.
 */
function drawFromWorldRng(world: World): void {
  const rng = createRng(0);
  rng.restore(world.rngState);
  rng.nextU32();
  world.rngState = rng.serialize();
}

const TEST_MOVE_SPEED_MPS = 20;
const TEST_PROJECTILE_SPEED_MPS = 100;
const TEST_PROJECTILE_LIFETIME_TICKS = 5;

const drivingSystem: SystemFn = (world, input, dtSeconds) => {
  for (const vehicle of world.entities.vehicles) {
    vehicle.position.x += input.moveX * TEST_MOVE_SPEED_MPS * dtSeconds;
    vehicle.position.y += input.moveY * TEST_MOVE_SPEED_MPS * dtSeconds;
    vehicle.headingRad += input.moveX * dtSeconds;
  }
};

// maxRangeM chosen so the projectile expires (traveledM >= maxRangeM) after
// exactly TEST_PROJECTILE_LIFETIME_TICKS ticks at TEST_PROJECTILE_SPEED_MPS,
// matching this suite's original ticksRemaining-based lifetime.
const TEST_DT_SECONDS = dtSecondsFromTickRate(drivingConfig().tickRateHz);
const TEST_PROJECTILE_MAX_RANGE_M = TEST_PROJECTILE_SPEED_MPS * TEST_DT_SECONDS * TEST_PROJECTILE_LIFETIME_TICKS;

const weaponsSystem: SystemFn = (world, input, _dtSeconds) => {
  drawFromWorldRng(world);
  const shooter = world.entities.vehicles[0];
  if (input.fire && shooter !== undefined) {
    world.entities.projectiles.push({
      id: `proj-${world.tick}`,
      ownerId: shooter.id,
      weaponId: 'test-weapon',
      mountFacing: 'FRONT',
      position: { ...shooter.position },
      velocity: { x: TEST_PROJECTILE_SPEED_MPS, y: 0 },
      spawnTick: world.tick,
      maxRangeM: TEST_PROJECTILE_MAX_RANGE_M,
      traveledM: 0,
      outcome: { hit: false, damage: 0, facing: null },
    });
  }
};

const projectilesSystem: SystemFn = (world, _input, dtSeconds) => {
  world.entities.projectiles = world.entities.projectiles.map((projectile) => advanceProjectile(projectile, dtSeconds));
};

const cleanupSystem: SystemFn = (world, _input, _dtSeconds) => {
  world.entities.projectiles = world.entities.projectiles.filter((p) => !projectileExpired(p));
};

function buildTestLoop(seed: number): { loop: GameLoop; world: World } {
  const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
  const world = createWorld({
    rngSeed: seed,
    arena: { id: 'arena-kart', kind: 'arena' },
    entities: { vehicles: [makeVehicle('car-a', 0, 0), makeVehicle('car-b', 10, 10)] },
  });
  const systems = createSystemsRegistry();
  systems.register('driving', drivingSystem);
  systems.register('weapons', weaponsSystem);
  systems.register('projectiles', projectilesSystem);
  systems.register('cleanup', cleanupSystem);

  let tickCounter = 0;
  const loop = createGameLoop({
    world,
    dtSeconds,
    systems,
    sampleInput: () => scriptedInput(tickCounter++),
  });
  return { loop, world };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fixed-tick simulation loop', () => {
  it('produces identical hash sequences across two independent runs of the same scripted input', () => {
    const runA = buildTestLoop(0xc0ffee);
    const runB = buildTestLoop(0xc0ffee);
    const hashesA: string[] = [];
    const hashesB: string[] = [];

    for (let i = 0; i < 600; i += 1) {
      runA.loop.sampleInput();
      runA.loop.step();
      hashesA.push(snapshot(runA.world));

      runB.loop.sampleInput();
      runB.loop.step();
      hashesB.push(snapshot(runB.world));
    }

    expect(runA.world.tick).toBe(600);
    expect(hashesA).toEqual(hashesB);
    // Sanity: the world actually changes tick to tick, so this isn't just 600 copies of one hash.
    expect(new Set(hashesA).size).toBeGreaterThan(1);
  });

  it('diverges from a run with a different seed (the hash is sensitive to rngState, not just positions)', () => {
    const runA = buildTestLoop(1);
    const runB = buildTestLoop(2);
    let sawDivergence = false;

    for (let i = 0; i < 50; i += 1) {
      runA.loop.sampleInput();
      runA.loop.step();
      runB.loop.sampleInput();
      runB.loop.step();
      if (snapshot(runA.world) !== snapshot(runB.world)) sawDivergence = true;
    }

    expect(sawDivergence).toBe(true);
  });

  it('clamps a 300ms frame spike to exactly the ticks 250ms covers, never more', () => {
    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
    const world = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'arena' } });
    const systems = createSystemsRegistry();
    const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: defaultInputFrame });

    const expectedTicks = Math.floor(0.25 / dtSeconds + 1e-9);
    const ticksRun = loop.advance(0.3);

    expect(ticksRun).toBe(expectedTicks);
    expect(world.tick).toBe(expectedTicks);
  });

  it('never spirals: repeated 300ms spikes each produce only the clamped tick count, not a growing backlog', () => {
    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
    const world = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'arena' } });
    const systems = createSystemsRegistry();
    const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: defaultInputFrame });
    const expectedTicks = Math.floor(0.25 / dtSeconds + 1e-9);

    const runs = [loop.advance(0.3), loop.advance(0.3), loop.advance(0.3)];

    expect(runs).toEqual([expectedTicks, expectedTicks, expectedTicks]);
    expect(world.tick).toBe(expectedTicks * 3);
  });

  it('keeps alpha in [0, 1) across a mix of frame deltas, including exact multiples of dt and a spike', () => {
    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
    const world = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'route' } });
    const systems = createSystemsRegistry();
    const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: defaultInputFrame });

    const deltas = [dtSeconds * 0.5, dtSeconds * 1.5, dtSeconds * 3.25, 0.3, dtSeconds * 0.1, 0];
    for (const delta of deltas) {
      loop.advance(delta);
      expect(loop.alpha).toBeGreaterThanOrEqual(0);
      expect(loop.alpha).toBeLessThan(1);
    }
  });

  it('rejects a NaN frameDeltaSeconds instead of poisoning the accumulator forever', () => {
    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
    const world = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'arena' } });
    const systems = createSystemsRegistry();
    const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: defaultInputFrame });

    expect(() => loop.advance(Number.NaN)).toThrow(RangeError);
    // The rejected call must not have mutated the accumulator: a follow-up
    // well-behaved advance() runs ticks normally instead of reading NaN forever.
    const ticksRun = loop.advance(dtSeconds * 4);
    expect(ticksRun).toBe(4);
    expect(world.tick).toBe(4);
  });

  it('rejects a negative frameDeltaSeconds instead of driving alpha negative and stalling', () => {
    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
    const world = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'arena' } });
    const systems = createSystemsRegistry();
    const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: defaultInputFrame });

    expect(() => loop.advance(-0.5)).toThrow(RangeError);
    expect(world.tick).toBe(0);
    expect(loop.alpha).toBe(0);
  });

  it('rejects +Infinity frameDeltaSeconds', () => {
    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
    const world = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'arena' } });
    const systems = createSystemsRegistry();
    const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: defaultInputFrame });

    expect(() => loop.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('runs systems in the fixed SYSTEM_ORDER regardless of registration order', () => {
    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
    const world = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'arena' } });
    const systems = createSystemsRegistry();
    const log: string[] = [];
    const registrationOrder: SystemName[] = ['cleanup', 'ai', 'damage', 'deployables', 'projectiles', 'weapons', 'driving'];
    for (const name of registrationOrder) {
      systems.register(name, () => {
        log.push(name);
      });
    }
    expect(systems.order).toEqual(SYSTEM_ORDER);

    const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: defaultInputFrame });

    loop.step();
    expect(log).toEqual([...SYSTEM_ORDER]);

    log.length = 0;
    loop.step();
    expect(log).toEqual([...SYSTEM_ORDER]);
  });

  it('skips unregistered systems without breaking the order of the ones that are registered', () => {
    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
    const world = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'arena' } });
    const systems = createSystemsRegistry();
    const log: string[] = [];
    systems.register('cleanup', () => log.push('cleanup'));
    systems.register('driving', () => log.push('driving'));
    systems.register('damage', () => log.push('damage'));

    const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: defaultInputFrame });
    loop.step();

    expect(log).toEqual(['driving', 'damage', 'cleanup']);
  });
});

describe('createWorld', () => {
  it('gives every world built without an explicit clock its OWN clock object, not a shared reference', () => {
    const worldA = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'arena' } });
    const worldB = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'arena' } });

    expect(worldA.clock).not.toBe(worldB.clock);

    const aiSystem: SystemFn = (world) => {
      world.clock.dayIndex += 1;
    };
    const systemsA = createSystemsRegistry();
    systemsA.register('ai', aiSystem);
    const systemsB = createSystemsRegistry();
    systemsB.register('ai', aiSystem);

    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
    const loopA = createGameLoop({ world: worldA, dtSeconds, systems: systemsA, sampleInput: defaultInputFrame });
    const loopB = createGameLoop({ world: worldB, dtSeconds, systems: systemsB, sampleInput: defaultInputFrame });

    for (let i = 0; i < 10; i += 1) {
      loopA.step();
    }
    for (let i = 0; i < 10; i += 1) {
      loopB.step();
    }

    // Each world only ran its OWN 10 ticks, so each clock only advanced 10
    // days — not 20, which is what a shared mutable clock object would show.
    expect(worldA.clock.dayIndex).toBe(10);
    expect(worldB.clock.dayIndex).toBe(10);
  });

  it('honors an explicit clock override instead of always building a fresh one', () => {
    const world = createWorld({
      rngSeed: 1,
      arena: { id: 'arena-kart', kind: 'arena' },
      clock: { dayIndex: 7, phase: 'NIGHT' },
    });
    expect(world.clock).toEqual({ dayIndex: 7, phase: 'NIGHT' });
  });

  it('holds rngState in the real @/util/rng shape, round-trippable through createRng().restore()', () => {
    const world = createWorld({ rngSeed: 0xc0ffee, arena: { id: 'arena-kart', kind: 'arena' } });

    expect(world.rngState.seedKey).toBe('n:12648430');
    expect(world.rngState.words).toHaveLength(4);

    // Round-trip: restoring world.rngState into a throwaway Rng and drawing
    // from it must match drawing directly from a fresh Rng built the same
    // seed — proving world.rngState really is the project's seeded RNG
    // state, not an opaque number a real Rng can't be reconstructed from.
    const reference = createRng(0xc0ffee);
    const referenceDraw = reference.nextU32();

    const restored = createRng(0);
    restored.restore(world.rngState);
    expect(restored.nextU32()).toBe(referenceDraw);
  });

  it('gives worlds created from different seeds different rngState, so their tick hashes diverge', () => {
    const worldA = createWorld({ rngSeed: 1, arena: { id: 'arena-kart', kind: 'arena' } });
    const worldB = createWorld({ rngSeed: 2, arena: { id: 'arena-kart', kind: 'arena' } });
    expect(worldA.rngState).not.toEqual(worldB.rngState);
  });
});
