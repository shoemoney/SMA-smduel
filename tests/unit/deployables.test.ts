import { describe, expect, it } from 'vitest';

import { cleanupSystem, findPlayer, vehicleStateFromDesign, PLAYER_ID } from '@/app';
import { defaultInputFrame } from '@/sim/loop';
import { createWorld, type World } from '@/sim/world';
import type { VehicleDesign } from '@/sim/types';

/**
 * Mines and spike strips were INERT for the life of the game.
 *
 * `weapons.json` ships five deployable-mode weapons (`minedropper`,
 * `spikedropper`, `smokescreen`, `paintsprayer`, `oiljet`). The weapons systems
 * only handled `spawn.kind === 'PROJECTILE'`, so a `DEPLOYABLE` spawn consumed
 * the ammo, set the cooldown, and dropped the returned `DeployableState` on the
 * floor. Nothing ever pushed to `world.entities.deployables`, which left
 * `combat.triggerMine` and `combat.triggerSpikes` unreachable from any
 * production path — both were exercised only by their own unit tests, which is
 * exactly the shape of a feature that is written, validated, shipped in the
 * ruleset, and does nothing.
 *
 * These tests pin the wiring that now makes the two CONTACT deployables real.
 */

const DESIGN: VehicleDesign = {
  name: 'Deployable Rig',
  bodyId: 'subcompact',
  chassisId: 'standard',
  suspensionId: 'light',
  plantId: 'small',
  tireId: 'standard',
  armor: { FRONT: 20, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 },
  weapons: [],
};

function worldWithVehicle(): World {
  const world = createWorld({ rngSeed: 12345, arena: { id: 'test', kind: 'arena' }, entities: { vehicles: [] } });
  world.entities.vehicles.push(vehicleStateFromDesign(DESIGN, PLAYER_ID, PLAYER_ID, { x: 0, y: 0 }, 0));
  return world;
}

function mine(id: string, x: number, y: number, triggerRadiusM = 3) {
  return {
    id,
    ownerId: PLAYER_ID,
    weaponId: 'minedropper',
    position: { x, y },
    spawnTick: 0,
    deployable: {
      kind: 'MINE' as const,
      targetsFacing: 'FRONT' as const,
      tireSplash: true,
      lifetimeDays: 1,
      triggerRadiusM,
    },
  };
}

function spikes(id: string, x: number, y: number, triggerRadiusM = 3) {
  return {
    id,
    ownerId: PLAYER_ID,
    weaponId: 'spikedropper',
    position: { x, y },
    spawnTick: 0,
    deployable: {
      kind: 'SPIKES' as const,
      targetsTiresOnly: true,
      zeroVsSpikeImmune: false,
      lifetimeDays: 1,
      triggerRadiusM,
    },
  };
}

function runCleanup(world: World): void {
  cleanupSystem(world, defaultInputFrame(), 1 / 60);
}

describe('cleanupSystem: deployables are triggered and consumed', () => {
  it('a mine inside the vehicle radius fires once, damages armour, and is consumed', () => {
    const world = worldWithVehicle();
    world.entities.deployables.push(mine('m1', 0.5, 0));
    const before = findPlayer(world)!;
    const armorBefore = before.armorDP.FRONT;

    runCleanup(world);

    const after = findPlayer(world)!;
    expect(after.armorDP.FRONT).toBeLessThan(armorBefore);
    // Consumed: a deployable fires ONCE, so it must not be left in the world to
    // hit the same vehicle again on every subsequent frame.
    expect(world.entities.deployables).toHaveLength(0);
  });

  it('a mine OUTSIDE its trigger radius does not fire and survives', () => {
    const world = worldWithVehicle();
    world.entities.deployables.push(mine('m1', 40, 0, 3));
    const before = findPlayer(world)!.armorDP.FRONT;

    runCleanup(world);

    expect(findPlayer(world)!.armorDP.FRONT).toBe(before);
    expect(world.entities.deployables).toHaveLength(1);
  });

  it('a spike strip inside the radius damages a tire and is consumed', () => {
    const world = worldWithVehicle();
    world.entities.deployables.push(spikes('s1', -0.5, 0));
    const tireBefore = { ...findPlayer(world)!.tireDP };

    runCleanup(world);

    const after = findPlayer(world)!.tireDP;
    // `targetsTiresOnly: true` — the point of the test is that the TIRE changed,
    // which is what `triggerSpikes` exists to do and which nothing could
    // previously reach from production code.
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(tireBefore));
    expect(world.entities.deployables).toHaveLength(0);
  });

  it('a non-contact deployable (CLOUD/SLICK) is retained, not silently eaten', () => {
    const world = worldWithVehicle();
    world.entities.deployables.push({
      id: 'c1',
      ownerId: PLAYER_ID,
      weaponId: 'smokescreen',
      position: { x: 0, y: 0 },
      spawnTick: 0,
      deployable: { kind: 'CLOUD' as const, radiusM: 10, lifetimeTicks: 240, accuracyPenalty: 0.2, blocksLineOfSight: true },
    });

    runCleanup(world);

    // Cloud/SLICK have no contact trigger, so they must survive the pass rather
    // than being consumed by a branch that only knows about MINE and SPIKES.
    expect(world.entities.deployables).toHaveLength(1);
  });

  it('a deployable is not triggered by an already-destroyed vehicle', () => {
    const world = worldWithVehicle();
    const vehicle = world.entities.vehicles[0]!;
    world.entities.vehicles[0] = { ...vehicle, destroyed: true };
    world.entities.deployables.push(mine('m1', 0, 0));

    runCleanup(world);

    // Nothing to hit, so the mine must be left for a live vehicle rather than
    // being consumed by a wreck.
    expect(world.entities.deployables).toHaveLength(1);
  });

  it('triggering a mine draws from the world RNG stream, so it stays deterministic', () => {
    // Same seed, same world state, same result. A mine that consumed a fresh
    // unseeded RNG would pass the damage assertions above and still break
    // replay.
    const run = (): number => {
      const world = createWorld({ rngSeed: 4242, arena: { id: 'test', kind: 'arena' }, entities: { vehicles: [] } });
      world.entities.vehicles.push(vehicleStateFromDesign(DESIGN, PLAYER_ID, PLAYER_ID, { x: 0, y: 0 }, 0));
      world.entities.deployables.push(mine('m1', 0.5, 0));
      runCleanup(world);
      return findPlayer(world)!.armorDP.FRONT;
    };
    expect(run()).toBe(run());
  });
});
