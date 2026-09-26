import { describe, expect, it } from 'vitest';
import { createRng } from '@/util/rng';
import { rearPenetrationWeights } from '@/data/rulesets';
import { makeArmorRecord } from '@/sim/types';
import type { ArmorRecord, CargoState, DriverState, MineDeployable, TireDPTuple, TireDef, VehicleState, WeaponState } from '@/sim/types';
import {
  applyCargoDamage,
  applyDriverDamage,
  applyMineDamage,
  applyPenetratingDamage,
  applySpikeDamage,
  applyTireDamage,
  facingForLocalDirection,
  impactFacingFromPositions,
  isPenetratingFacing,
} from '@/sim/damage';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function weaponState(overrides: Partial<WeaponState> = {}): WeaponState {
  return { weaponId: 'machinegun', facing: 'FRONT', ammo: 20, dp: 3, maxDP: 3, cooldownRemaining: 0, destroyed: false, ...overrides };
}

function cargoItem(overrides: Partial<CargoState> = {}): CargoState {
  return { id: 'cargo-1', kind: 'payload', weightLb: 100, spaces: 1, integrity: 100, ...overrides };
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

function driver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    name: 'Test',
    skills: { driving: 20, marksmanship: 20, mechanic: 10 },
    naturalHealth: 3,
    bodyArmor: 0,
    prestige: 0,
    cash: 2000,
    cityId: 'newyork',
    cloneCityId: null,
    cloneSkills: null,
    ...overrides,
  };
}

const SOLID_TIRE: TireDef = { id: 'solid', name: 'Solid', price: 500, weightLb: 75, maxDP: 12, spikeImmune: true };
const STANDARD_TIRE: TireDef = { id: 'standard', name: 'Standard', price: 50, weightLb: 30, maxDP: 4, spikeImmune: false };

const MINE: MineDeployable = { kind: 'MINE', targetsFacing: 'UNDERBODY', tireSplash: true, lifetimeDays: 1, triggerRadiusM: 2.2 };

// ---------------------------------------------------------------------------
// Impact facing — every case including exact diagonals
// ---------------------------------------------------------------------------

describe('facingForLocalDirection', () => {
  it.each([
    [{ x: 0, y: 1 }, 'FRONT'],
    [{ x: 0, y: -1 }, 'REAR'],
    [{ x: 1, y: 0 }, 'RIGHT'],
    [{ x: -1, y: 0 }, 'LEFT'],
    // Exact diagonals fall through to the FRONT/REAR branch (abs(x) > abs(y) is false).
    [{ x: 1, y: 1 }, 'FRONT'],
    [{ x: -1, y: 1 }, 'FRONT'],
    [{ x: 1, y: -1 }, 'REAR'],
    [{ x: -1, y: -1 }, 'REAR'],
  ] as const)('local %o -> %s', (local, expected) => {
    expect(facingForLocalDirection(local)).toBe(expected);
  });

  it('never produces UNDERBODY', () => {
    const facing = facingForLocalDirection({ x: 0.0001, y: 0.0001 });
    expect(isPenetratingFacing(facing)).toBe(true);
  });
});

describe('impactFacingFromPositions', () => {
  it('a shot arriving from directly ahead of a north-facing target lands FRONT', () => {
    // Target faces "north" (heading 0 -> forward = (0,1)). Attacker is further north
    // (positive y) than the target, so the impact came from ahead.
    const facing = impactFacingFromPositions({ x: 0, y: 10 }, { x: 0, y: 0 }, 0);
    expect(facing).toBe('FRONT');
  });

  it('a shot arriving from behind a north-facing target lands REAR', () => {
    const facing = impactFacingFromPositions({ x: 0, y: -10 }, { x: 0, y: 0 }, 0);
    expect(facing).toBe('REAR');
  });

  it('rotates with target heading — a target facing east reads the same attacker as its LEFT', () => {
    // heading = -90deg so forward = (1, 0) i.e. "east". An attacker due north of the
    // target is now off its left flank.
    const heading = -Math.PI / 2;
    const facing = impactFacingFromPositions({ x: 0, y: 10 }, { x: 0, y: 0 }, heading);
    expect(facing).toBe('LEFT');
  });
});

// ---------------------------------------------------------------------------
// Front penetration order: armor -> front weapons -> plant -> driver
// ---------------------------------------------------------------------------

describe('applyPenetratingDamage — FRONT order', () => {
  it('absorbs into armor first, leaves plant and driver untouched when armor eats it all', () => {
    const v = vehicle({ armorDP: { ...makeArmorRecord(0), FRONT: 5 } });
    const d = driver();
    const { vehicle: v2, driver: d2, report } = applyPenetratingDamage(v, d, 'FRONT', 3, createRng('t'));
    expect(report.armorAbsorbed).toBe(3);
    expect(v2.armorDP.FRONT).toBe(2);
    expect(report.plantDamageApplied).toBe(0);
    expect(report.driverHealthDamageApplied).toBe(0);
    expect(d2).toBe(d);
  });

  it('spills through armor into the front-mounted weapon before the plant', () => {
    const v = vehicle({
      armorDP: { ...makeArmorRecord(0), FRONT: 2 },
      weapons: [weaponState({ weaponId: 'machinegun', facing: 'FRONT', dp: 2 })],
      plantDP: 5,
    });
    const d = driver({ naturalHealth: 3, bodyArmor: 0 });
    const { vehicle: v2, driver: d2, report } = applyPenetratingDamage(v, d, 'FRONT', 4, createRng('t'));
    expect(report.armorAbsorbed).toBe(2);
    expect(report.weaponHits).toEqual([{ weaponId: 'machinegun', damageApplied: 2, destroyed: true }]);
    expect(v2.weapons[0]?.destroyed).toBe(true);
    expect(v2.weapons[0]?.dp).toBe(0);
    // 4 incoming - 2 armor - 2 weapon = 0 overflow left for plant/driver.
    expect(report.plantDamageApplied).toBe(0);
    expect(d2.naturalHealth).toBe(3);
  });

  it('reaches the plant before the driver, and only overkill reaches the driver', () => {
    const v = vehicle({
      armorDP: { ...makeArmorRecord(0), FRONT: 2 },
      weapons: [weaponState({ weaponId: 'machinegun', facing: 'FRONT', dp: 2 })],
      plantDP: 5,
    });
    const d = driver({ naturalHealth: 3, bodyArmor: 0 });
    // 12 incoming: 2 armor, 2 weapon (destroyed), 5 plant (destroyed), 3 driver health (defeated).
    const { vehicle: v2, driver: d2, report } = applyPenetratingDamage(v, d, 'FRONT', 12, createRng('t'));
    expect(report.armorAbsorbed).toBe(2);
    expect(report.weaponHits[0]?.destroyed).toBe(true);
    expect(report.plantDamageApplied).toBe(5);
    expect(v2.plantDP).toBe(0);
    expect(report.plantDestroyed).toBe(true);
    expect(report.driverHealthDamageApplied).toBe(3);
    expect(d2.naturalHealth).toBe(0);
    expect(report.driverDefeated).toBe(true);
    expect(report.overflowDissipated).toBe(0);
  });

  it('a destroyed plant alone does not add extra damage to the driver beyond overflow', () => {
    const v = vehicle({ armorDP: makeArmorRecord(0), weapons: [], plantDP: 4 });
    const d = driver({ naturalHealth: 3, bodyArmor: 0 });
    // Exactly enough to destroy the plant with nothing left over.
    const { driver: d2, report } = applyPenetratingDamage(v, d, 'FRONT', 4, createRng('t'));
    expect(report.plantDestroyed).toBe(true);
    expect(report.driverHealthDamageApplied).toBe(0);
    expect(d2.naturalHealth).toBe(3);
  });

  it('driver damage consumes body armor before natural health', () => {
    const v = vehicle({ armorDP: makeArmorRecord(0), plantDP: 0 });
    const d = driver({ naturalHealth: 3, bodyArmor: 3 });
    const { driver: d2, report } = applyPenetratingDamage(v, d, 'FRONT', 2, createRng('t'));
    expect(report.driverArmorDamageApplied).toBe(2);
    expect(report.driverHealthDamageApplied).toBe(0);
    expect(d2.bodyArmor).toBe(1);
    expect(d2.naturalHealth).toBe(3);
  });
});

describe('applyPenetratingDamage — plantDestroyed/driverDefeated report the TRANSITION, not the state', () => {
  it('does not re-report plantDestroyed on a hit that does no plant damage at all', () => {
    // Plant already at 0 DP; armor fully absorbs this hit, so the plant takes no
    // damage from it — plantDestroyed must be false, not true just because the
    // plant happens to already be dead.
    const v = vehicle({ armorDP: { ...makeArmorRecord(0), FRONT: 1 }, plantDP: 0 });
    const d = driver({ naturalHealth: 3, bodyArmor: 0 });
    const { report } = applyPenetratingDamage(v, d, 'FRONT', 1, createRng('t'));
    expect(report.armorAbsorbed).toBe(1);
    expect(report.plantDamageApplied).toBe(0);
    expect(report.plantDestroyed).toBe(false);
  });

  it('reports plantDestroyed true only on the hit that actually zeroes the plant', () => {
    const v = vehicle({ armorDP: makeArmorRecord(0), plantDP: 4 });
    const d = driver({ naturalHealth: 3, bodyArmor: 0 });
    const first = applyPenetratingDamage(v, d, 'FRONT', 4, createRng('t'));
    expect(first.report.plantDestroyed).toBe(true);
    expect(first.vehicle.plantDP).toBe(0);
    // A second hit against the now-dead plant must not re-fire the transition.
    const second = applyPenetratingDamage(first.vehicle, first.driver, 'FRONT', 1, createRng('t2'));
    expect(second.report.plantDestroyed).toBe(false);
  });

  it('does not re-report driverDefeated once the driver is already dead', () => {
    const v = vehicle({ armorDP: makeArmorRecord(0), plantDP: 0 });
    const d = driver({ naturalHealth: 0, bodyArmor: 0 });
    const { report } = applyPenetratingDamage(v, d, 'FRONT', 1, createRng('t'));
    expect(report.driverDefeated).toBe(false);
  });

  it('reports driverDefeated true only on the hit that actually drops health to 0', () => {
    const v = vehicle({ armorDP: makeArmorRecord(0), plantDP: 0 });
    const d = driver({ naturalHealth: 2, bodyArmor: 0 });
    const first = applyPenetratingDamage(v, d, 'FRONT', 2, createRng('t'));
    expect(first.report.driverDefeated).toBe(true);
    expect(first.driver.naturalHealth).toBe(0);
    const second = applyPenetratingDamage(first.vehicle, first.driver, 'FRONT', 1, createRng('t2'));
    expect(second.report.driverDefeated).toBe(false);
  });
});

describe('applyPenetratingDamage — SIDE order', () => {
  it('reaches driver, then plant, then cargo (in that order) after side weapons', () => {
    const v = vehicle({
      armorDP: makeArmorRecord(0),
      plantDP: 5,
      cargo: [cargoItem({ integrity: 10 })],
    });
    const d = driver({ naturalHealth: 1, bodyArmor: 0 });
    // 1 kills the driver outright before anything reaches the plant.
    const { driver: d2, vehicle: v2, report } = applyPenetratingDamage(v, d, 'LEFT', 1, createRng('t'));
    expect(report.driverHealthDamageApplied).toBe(1);
    expect(d2.naturalHealth).toBe(0);
    expect(report.plantDamageApplied).toBe(0);
    expect(v2.plantDP).toBe(5);
    expect(report.cargoHits).toEqual([]);
  });

  it('spills past a defeated driver into plant, then cargo', () => {
    const v = vehicle({ armorDP: makeArmorRecord(0), plantDP: 2, cargo: [cargoItem({ integrity: 10 })] });
    const d = driver({ naturalHealth: 1, bodyArmor: 0 });
    const { driver: d2, vehicle: v2, report } = applyPenetratingDamage(v, d, 'RIGHT', 5, createRng('t'));
    expect(d2.naturalHealth).toBe(0);
    expect(report.plantDamageApplied).toBe(2);
    expect(v2.plantDP).toBe(0);
    expect(report.cargoHits).toEqual([{ cargoId: 'cargo-1', damageApplied: 2, failed: false }]);
    expect(v2.cargo[0]?.integrity).toBe(8);
  });
});

describe('applyPenetratingDamage — REAR weighted table', () => {
  it('reads a plant/driver/cargo weight table from the weapons ruleset, not a TS literal', () => {
    const weights = rearPenetrationWeights();
    expect(weights.plant).toBeGreaterThan(0);
    expect(weights.driver).toBeGreaterThan(0);
    expect(weights.cargo).toBeGreaterThan(0);
  });

  it('re-rolls per POINT of damage: a large REAR hit spreads across plant and driver instead of dumping the whole shot into whichever one the first roll picks', () => {
    // Reproduces the exact regression this guards against: plant 99, driver natural
    // health 99, no cargo, 50 incoming REAR damage. The broken implementation gave
    // plant=50 / driver=0 on every one of these seeds because the first roll's
    // component absorbed the entire shot; re-rolling per point makes that
    // astronomically unlikely (chance of the driver never being picked in 50
    // independent draws at its ruleset weight is on the order of 1e-11).
    for (const seed of ['rear-a', 'rear-b', 'rear-c', 'rear-d', 'rear-e']) {
      const v = vehicle({ armorDP: makeArmorRecord(0), plantDP: 99, cargo: [] });
      const d = driver({ naturalHealth: 99, bodyArmor: 0 });
      const { report } = applyPenetratingDamage(v, d, 'REAR', 50, createRng(seed));
      const driverTotal = report.driverArmorDamageApplied + report.driverHealthDamageApplied;
      expect(report.plantDamageApplied).toBeGreaterThan(0);
      expect(driverTotal).toBeGreaterThan(0);
      expect(report.plantDamageApplied + driverTotal).toBe(50);
    }
  });

  it('merges a distributed hit into a single per-item cargoHits entry, not one entry per point', () => {
    const v = vehicle({ armorDP: makeArmorRecord(0), plantDP: 0, cargo: [cargoItem({ id: 'cargo-1', integrity: 40 })] });
    const d = driver({ naturalHealth: 0, bodyArmor: 0 });
    const { vehicle: v2, report } = applyPenetratingDamage(v, d, 'REAR', 20, createRng('rear-cargo'));
    expect(report.cargoHits).toHaveLength(1);
    expect(report.cargoHits[0]).toMatchObject({ cargoId: 'cargo-1', failed: false });
    expect(report.cargoHits[0]?.damageApplied).toBe(20);
    expect(v2.cargo[0]?.integrity).toBe(20);
  });

  it('conserves total damage across armor, weapons, plant, driver and cargo', () => {
    const v = vehicle({
      armorDP: { ...makeArmorRecord(0), REAR: 2 },
      weapons: [weaponState({ facing: 'REAR', dp: 1 })],
      plantDP: 3,
      cargo: [cargoItem({ integrity: 4 })],
    });
    const d = driver({ naturalHealth: 3, bodyArmor: 2 });
    const incoming = 15; // comfortably more than every pool combined
    const { report } = applyPenetratingDamage(v, d, 'REAR', incoming, createRng('rear-seed'));
    const weaponsTotal = report.weaponHits.reduce((sum, h) => sum + h.damageApplied, 0);
    const cargoTotal = report.cargoHits.reduce((sum, h) => sum + h.damageApplied, 0);
    const accounted =
      report.armorAbsorbed +
      weaponsTotal +
      report.plantDamageApplied +
      report.driverArmorDamageApplied +
      report.driverHealthDamageApplied +
      cargoTotal +
      report.overflowDissipated;
    expect(accounted).toBe(incoming);
  });

  it('is deterministic for a fixed seed', () => {
    const build = (): [VehicleState, DriverState] => [
      vehicle({ plantDP: 3, cargo: [cargoItem({ integrity: 4 })] }),
      driver({ naturalHealth: 3, bodyArmor: 2 }),
    ];
    const [v1, d1] = build();
    const [v2, d2] = build();
    const r1 = applyPenetratingDamage(v1, d1, 'REAR', 7, createRng('same-seed'));
    const r2 = applyPenetratingDamage(v2, d2, 'REAR', 7, createRng('same-seed'));
    expect(r1.report).toEqual(r2.report);
  });
});

// ---------------------------------------------------------------------------
// Spikes vs tires
// ---------------------------------------------------------------------------

describe('applySpikeDamage', () => {
  it('deals zero against spike-immune (solid) tires', () => {
    const tireDP: TireDPTuple = [4, 4, 4, 4];
    const result = applySpikeDamage(tireDP, SOLID_TIRE, 5, createRng('spike'));
    expect(result.damageApplied).toBe(0);
    expect(result.tireDP).toEqual(tireDP);
  });

  it('damages a non-immune tire normally', () => {
    const tireDP: TireDPTuple = [4, 4, 4, 4];
    const result = applySpikeDamage(tireDP, STANDARD_TIRE, 3, createRng('spike'));
    expect(result.damageApplied).toBe(3);
    expect(result.tireDP[result.tireIndex]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Mines
// ---------------------------------------------------------------------------

describe('applyMineDamage', () => {
  it('hits UNDERBODY armor and splashes overflow onto a tire', () => {
    const armorDP: ArmorRecord = { ...makeArmorRecord(0), UNDERBODY: 3 };
    const tireDP: TireDPTuple = [4, 4, 4, 4];
    const result = applyMineDamage(armorDP, tireDP, MINE, 7, createRng('mine'));
    expect(result.underbodyAbsorbed).toBe(3);
    expect(result.armorDP.UNDERBODY).toBe(0);
    expect(result.overflow).toBe(4);
    expect(result.tireHit).not.toBeNull();
    expect(result.tireHit?.damageApplied).toBe(4);
  });

  it('does not splash when the mine has no tireSplash flag', () => {
    const noSplash: MineDeployable = { ...MINE, tireSplash: false };
    const armorDP: ArmorRecord = makeArmorRecord(0);
    const tireDP: TireDPTuple = [4, 4, 4, 4];
    const result = applyMineDamage(armorDP, tireDP, noSplash, 5, createRng('mine'));
    expect(result.tireHit).toBeNull();
    expect(result.overflow).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Driver / cargo helpers
// ---------------------------------------------------------------------------

describe('applyDriverDamage', () => {
  it('consumes body armor before natural health', () => {
    const d = driver({ bodyArmor: 3, naturalHealth: 3 });
    const result = applyDriverDamage(d, 2);
    expect(result.armorDamageApplied).toBe(2);
    expect(result.healthDamageApplied).toBe(0);
    expect(result.driver.bodyArmor).toBe(1);
    expect(result.driver.naturalHealth).toBe(3);
    expect(result.defeated).toBe(false);
  });

  it('spills into health once armor is exhausted, and reports defeat at 0', () => {
    const d = driver({ bodyArmor: 1, naturalHealth: 2 });
    const result = applyDriverDamage(d, 3);
    expect(result.armorDamageApplied).toBe(1);
    expect(result.healthDamageApplied).toBe(2);
    expect(result.driver.naturalHealth).toBe(0);
    expect(result.defeated).toBe(true);
  });
});

describe('applyCargoDamage', () => {
  it('marks the payload failed once integrity hits 0', () => {
    const cargo = cargoItem({ kind: 'payload', integrity: 5 });
    const result = applyCargoDamage(cargo, 10);
    expect(result.cargo.integrity).toBe(0);
    expect(result.failed).toBe(true);
    expect(result.damageApplied).toBe(5);
  });

  it('does not mark a payload failed while integrity remains', () => {
    const cargo = cargoItem({ kind: 'payload', integrity: 5 });
    const result = applyCargoDamage(cargo, 2);
    expect(result.cargo.integrity).toBe(3);
    expect(result.failed).toBe(false);
  });
});

describe('applyTireDamage', () => {
  it('clamps at 0 and reports destroyed', () => {
    const result = applyTireDamage([2, 2, 2, 2], 1, 10);
    expect(result.tireDP).toEqual([2, 0, 2, 2]);
    expect(result.destroyed).toBe(true);
  });
});
