/**
 * Boot acceptance gate: the app module graph must import cleanly under
 * node (no DOM/GPU access at module scope), the shipped ruleset tables
 * must validate, a driver + a legal build + a practice arena event must be
 * constructible end to end in memory, and a scripted input stream run
 * through the app's own exported systems must be reproducibly
 * deterministic over 600 ticks — the same acceptance bar
 * `tests/unit/loop.test.ts` holds the raw loop to, but here against the
 * real driving/weapons/projectiles/cleanup systems `@/app` wires up.
 */
import { describe, expect, it } from 'vitest';

import { drivingConfig, economy, skillsConfig, RAW_RULESETS } from '@/data/rulesets';
import { validateRulesets } from '@/data/schema';
import { beginArenaMatch } from '@/sim/arena';
import { computeBuild, type BuildDesign } from '@/sim/construct';
import { createDriver } from '@/sim/driver';
import { createGameLoop, createSystemsRegistry, dtSecondsFromTickRate, type InputFrame } from '@/sim/loop';
import { makeArmorRecord, type DriverState, type SkillName, type VehicleDesign } from '@/sim/types';
import { createWorld, snapshot } from '@/sim/world';

import { attemptConfirm, createBuilderState, type BuilderConfirmedBuild, type BuilderContext } from '@/ui/builder';

// ---------------------------------------------------------------------------
// Module graph
// ---------------------------------------------------------------------------

describe('app module graph', () => {
  it('imports cleanly under node with no DOM/GPU access at module scope', async () => {
    const appModule = await import('@/app');
    expect(typeof appModule.boot).toBe('function');
    expect(typeof appModule.vehicleStateFromConfirmedBuild).toBe('function');
    expect(typeof appModule.makeDrivingSystem).toBe('function');
    expect(typeof appModule.makeWeaponsSystem).toBe('function');
  });

  it('validateRulesets() passes for the shipped ruleset tables', () => {
    expect(() => validateRulesets(RAW_RULESETS)).not.toThrow();
    const validated = validateRulesets(RAW_RULESETS);
    expect(validated.bodies.bodies.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function evenSkillSplit(): Record<SkillName, number> {
  const cfg = skillsConfig();
  const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
  const remainder = cfg.startingSkillPool - base * cfg.skills.length;
  const skills = {} as Record<SkillName, number>;
  cfg.skills.forEach((name, index) => {
    skills[name] = base + (index === cfg.skills.length - 1 ? remainder : 0);
  });
  return skills;
}

function createTestDriver(name: string): DriverState {
  const result = createDriver(name, evenSkillSplit());
  if (!result.ok) throw new Error(`test fixture: expected a legal skill split, got "${result.reason}"`);
  return result.driver;
}

/** The constructor's own default state (first body/chassis/suspension/plant/tire, no weapons, no armor) confirmed through the real reducer — proves the UI's own starting point is legal and affordable, not a hand-picked fixture. */
function confirmDefaultBuild(cash: number): BuilderConfirmedBuild {
  const context: BuilderContext = { cash, existingCarNames: [], ownedCarCount: 0 };
  const named = { ...createBuilderState(), name: 'Boot Test Rig' };
  const result = attemptConfirm(named, context);
  if (!result.ok) {
    throw new Error(`test fixture: expected the default builder state to be legal/affordable: ${JSON.stringify(result.violations)}`);
  }
  return result.confirmed;
}

/** A legal, armed build (subcompact + one front-mounted heavy rocket) so the 600-tick run below actually exercises fire/projectile/cleanup, not just driving. */
function confirmArmedBuild(cash: number): BuilderConfirmedBuild {
  const design: VehicleDesign = {
    name: 'Boot Test Rig (Armed)',
    bodyId: 'subcompact',
    chassisId: 'standard',
    suspensionId: 'light',
    plantId: 'small',
    tireId: 'standard',
    armor: makeArmorRecord(0),
    weapons: [{ weaponId: 'heavyrocket', facing: 'FRONT', ammo: 1 }],
  };
  const buildDesign: BuildDesign = design;
  const metrics = computeBuild(buildDesign);
  if (!metrics.legal || metrics.costTotal > cash) {
    throw new Error(`test fixture: expected an armed subcompact to be legal/affordable, got ${JSON.stringify(metrics)}`);
  }
  return { design, costTotal: metrics.costTotal, daysCost: economy().timeCostDays.buildCar };
}

// ---------------------------------------------------------------------------
// Driver -> build -> arena, end to end in memory
// ---------------------------------------------------------------------------

describe('driver -> build -> arena, end to end in memory', () => {
  it('creates a driver, a legal build, and enters the practice arena event', async () => {
    const { vehicleStateFromConfirmedBuild, PLAYER_ID, ARENA_EVENT_ID } = await import('@/app');

    const driver = createTestDriver('Boot Tester');
    const confirmed = confirmDefaultBuild(driver.cash);
    expect(confirmed.costTotal).toBeGreaterThan(0);
    expect(confirmed.costTotal).toBeLessThanOrEqual(driver.cash);

    const chargedDriver: DriverState = { ...driver, cash: driver.cash - confirmed.costTotal };
    const vehicle = vehicleStateFromConfirmedBuild(confirmed, PLAYER_ID);
    expect(vehicle.design.bodyId).toBe(confirmed.design.bodyId);
    expect(vehicle.destroyed).toBe(false);

    const matchResult = beginArenaMatch(chargedDriver, { design: vehicle.design, destroyed: false }, ARENA_EVENT_ID);
    expect(matchResult.ok).toBe(true);
    if (matchResult.ok) {
      expect(matchResult.state.eventId).toBe(ARENA_EVENT_ID);
      expect(matchResult.state.opponentsTotal).toBe(0);
      // practice charges its arenaPractice service fee exactly once.
      expect(matchResult.driver.cash).toBeLessThan(chargedDriver.cash);
    }
  });
});

// ---------------------------------------------------------------------------
// 600-tick determinism gate
// ---------------------------------------------------------------------------

/** Pure function of tick index — no Math.random, no Date.now, matches the scripted-input-stream pattern `tests/unit/loop.test.ts` already uses for the raw loop. */
function scriptedInput(tick: number): InputFrame {
  return {
    moveX: Math.sin(tick * 0.11) >= 0 ? 1 : -1,
    moveY: Math.cos(tick * 0.053) >= 0 ? 1 : -1,
    fire: tick % 17 === 0,
    weaponSlot: 0,
  };
}

describe('600 ticks of a scripted input stream', () => {
  it('produce an identical, reproducible world state hash across two independent runs', async () => {
    const { vehicleStateFromConfirmedBuild, makeDrivingSystem, makeWeaponsSystem, projectilesSystem, cleanupSystem, PLAYER_ID, ARENA_EVENT_ID } =
      await import('@/app');

    const driver = createTestDriver('Determinism 1');
    const confirmed = confirmArmedBuild(driver.cash);
    const chargedDriver: DriverState = { ...driver, cash: driver.cash - confirmed.costTotal };
    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
    const seed = 424242;

    function runOnce(): { hash: string; tick: number; projectilesSeen: number } {
      const vehicle = vehicleStateFromConfirmedBuild(confirmed, PLAYER_ID);
      const world = createWorld({ rngSeed: seed, arena: { id: ARENA_EVENT_ID, kind: 'arena' }, entities: { vehicles: [vehicle] } });
      const driverRef = { current: chargedDriver };
      const spawnCounter = { current: 0 };
      const systems = createSystemsRegistry();
      systems.register('driving', makeDrivingSystem(driverRef));
      systems.register('weapons', makeWeaponsSystem(driverRef, spawnCounter, () => {}));
      systems.register('projectiles', projectilesSystem);
      systems.register('cleanup', cleanupSystem);

      const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: () => scriptedInput(world.tick) });
      let projectilesSeen = 0;
      for (let i = 0; i < 600; i++) {
        loop.advance(dtSeconds);
        projectilesSeen += world.entities.projectiles.length;
      }
      return { hash: snapshot(world), tick: world.tick, projectilesSeen };
    }

    const runA = runOnce();
    const runB = runOnce();

    expect(runA.tick).toBe(600);
    expect(runA.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(runA.hash).toBe(runB.hash);
    // The scripted stream fires every 17 ticks with a one-shot rocket mounted
    // FRONT: confirms the weapons/projectiles chain actually ran, not just driving.
    expect(runA.projectilesSeen).toBeGreaterThan(0);
    expect(runA.projectilesSeen).toBe(runB.projectilesSeen);
  });

  it('is sensitive to the seed (a different seed produces a different hash)', async () => {
    const { vehicleStateFromConfirmedBuild, makeDrivingSystem, makeWeaponsSystem, projectilesSystem, cleanupSystem, PLAYER_ID, ARENA_EVENT_ID } =
      await import('@/app');
    const driver = createTestDriver('Determinism 2');
    const confirmed = confirmArmedBuild(driver.cash);
    const chargedDriver: DriverState = { ...driver, cash: driver.cash - confirmed.costTotal };
    const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);

    function runWithSeed(seed: number): string {
      const vehicle = vehicleStateFromConfirmedBuild(confirmed, PLAYER_ID);
      const world = createWorld({ rngSeed: seed, arena: { id: ARENA_EVENT_ID, kind: 'arena' }, entities: { vehicles: [vehicle] } });
      const driverRef = { current: chargedDriver };
      const spawnCounter = { current: 0 };
      const systems = createSystemsRegistry();
      systems.register('driving', makeDrivingSystem(driverRef));
      systems.register('weapons', makeWeaponsSystem(driverRef, spawnCounter, () => {}));
      systems.register('projectiles', projectilesSystem);
      systems.register('cleanup', cleanupSystem);
      const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: () => scriptedInput(world.tick) });
      for (let i = 0; i < 600; i++) loop.advance(dtSeconds);
      return snapshot(world);
    }

    expect(runWithSeed(1)).not.toBe(runWithSeed(2));
  });
});
