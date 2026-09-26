/**
 * Acceptance-gate golden tests for the vehicle constructor. Every assertion
 * here is a specific number or behavior called out by the constructor spec.
 */
import { describe, expect, it } from 'vitest';
import { computeBuild, validateDesign, type BuildDesign } from '@/sim/construct';
import {
  accelerationTiers,
  allBodies,
  allChassis,
  allPlants,
  allSuspensions,
  allTires,
  allWeapons,
  getBody,
  getChassis,
  getPlant,
  getSuspension,
  getTire,
  getWeapon,
} from '@/data/rulesets';
import { makeArmorRecord } from '@/sim/types';

function baseDesign(overrides: Partial<BuildDesign> = {}): BuildDesign {
  return {
    name: 'Golden Rig',
    bodyId: 'subcompact',
    chassisId: 'standard',
    suspensionId: 'light',
    plantId: 'small',
    tireId: 'standard',
    armor: makeArmorRecord(0),
    weapons: [],
    ...overrides,
  };
}

describe('golden 1 — pickup + extra-heavy chassis', () => {
  it('maxLoadLb === 7800', () => {
    const metrics = computeBuild(baseDesign({ bodyId: 'pickup', chassisId: 'extraheavy' }));
    expect(metrics.maxLoadLb).toBe(7800);
  });
});

describe('golden 2 — luxury + heavy suspension', () => {
  it('handlingClass === 3 and the suspension cost contribution === 1200', () => {
    const luxury = getBody('luxury');
    const heavySuspension = getSuspension('heavy');
    expect(luxury.price * heavySuspension.bodyPriceModifier).toBe(1200);
    expect(heavySuspension.handlingClass[luxury.class]).toBe(3);

    const design = baseDesign({ bodyId: 'luxury', suspensionId: 'heavy', chassisId: 'standard' });
    const metrics = computeBuild(design);
    const plant = getPlant(design.plantId);
    const tire = getTire(design.tireId);
    const expectedCost = luxury.price + 0 /* standard chassis modifier */ + 1200 + plant.price + 4 * tire.price;

    expect(metrics.handlingClass).toBe(3);
    expect(metrics.costTotal).toBe(expectedCost);
  });
});

describe('golden 3 — midsized + heavy chassis', () => {
  it('maxLoadLb === 5280 and the chassis cost contribution === 300', () => {
    const midsized = getBody('midsized');
    const heavyChassis = getChassis('heavy');
    expect(midsized.price * heavyChassis.bodyPriceModifier).toBe(300);

    const design = baseDesign({ bodyId: 'midsized', chassisId: 'heavy', suspensionId: 'light' });
    const metrics = computeBuild(design);
    expect(metrics.maxLoadLb).toBe(5280);
  });
});

describe('golden 4 — four solid tires', () => {
  it('cost 2000, weight 300, each tire maxDP 12', () => {
    const solid = getTire('solid');
    expect(solid.maxDP).toBe(12);
    expect(4 * solid.price).toBe(2000);
    expect(4 * solid.weightLb).toBe(300);

    const withStandard = computeBuild(baseDesign({ tireId: 'standard' }));
    const withSolid = computeBuild(baseDesign({ tireId: 'solid' }));
    const standard = getTire('standard');

    expect(withSolid.costTotal - withStandard.costTotal).toBe(4 * solid.price - 4 * standard.price);
    expect(withSolid.weightTotal - withStandard.weightTotal).toBe(4 * solid.weightLb - 4 * standard.weightLb);
  });
});

describe('golden 5 — front-facing flamethrower is illegal', () => {
  it('flamethrower is REAR/LEFT/RIGHT only', () => {
    const flamethrower = getWeapon('flamethrower');
    // copy before sorting — allowedFacings is the shared ruleset array, never mutate it in place.
    expect([...flamethrower.allowedFacings].sort()).toEqual(['LEFT', 'REAR', 'RIGHT'].sort());

    const design = baseDesign({ bodyId: 'van', weapons: [{ weaponId: 'flamethrower', facing: 'FRONT', ammo: 0 }] });
    const codes = validateDesign(design, 1_000_000).map((v) => v.code);
    expect(codes).toContain('ILLEGAL_FACING');
  });

  it('mounted REAR/LEFT/RIGHT is legal (no ILLEGAL_FACING)', () => {
    for (const facing of ['REAR', 'LEFT', 'RIGHT'] as const) {
      const design = baseDesign({ bodyId: 'van', weapons: [{ weaponId: 'flamethrower', facing, ammo: 0 }] });
      const codes = validateDesign(design, 1_000_000).map((v) => v.code);
      expect(codes).not.toContain('ILLEGAL_FACING');
    }
  });
});

describe('golden 6 — anti-tank gun is FRONT/REAR only', () => {
  it('LEFT or RIGHT mount is illegal', () => {
    const antitankgun = getWeapon('antitankgun');
    // copy before sorting — allowedFacings is the shared ruleset array, never mutate it in place.
    expect([...antitankgun.allowedFacings].sort()).toEqual(['FRONT', 'REAR'].sort());

    for (const facing of ['LEFT', 'RIGHT'] as const) {
      const design = baseDesign({ bodyId: 'van', weapons: [{ weaponId: 'antitankgun', facing, ammo: 0 }] });
      const codes = validateDesign(design, 1_000_000).map((v) => v.code);
      expect(codes).toContain('ILLEGAL_FACING');
    }
  });

  it('FRONT or REAR mount is legal (no ILLEGAL_FACING)', () => {
    for (const facing of ['FRONT', 'REAR'] as const) {
      const design = baseDesign({ bodyId: 'van', weapons: [{ weaponId: 'antitankgun', facing, ammo: 0 }] });
      const codes = validateDesign(design, 1_000_000).map((v) => v.code);
      expect(codes).not.toContain('ILLEGAL_FACING');
    }
  });
});

describe('golden 7 — ammo capacity caps', () => {
  it('21 rounds of conventional ammo overflows the 20-round cap', () => {
    const machinegun = getWeapon('machinegun');
    expect(machinegun.ammoCapacity).toBe(20);

    const legal = baseDesign({ bodyId: 'van', weapons: [{ weaponId: 'machinegun', facing: 'FRONT', ammo: 20 }] });
    const illegal = baseDesign({ bodyId: 'van', weapons: [{ weaponId: 'machinegun', facing: 'FRONT', ammo: 21 }] });

    expect(validateDesign(legal, 1_000_000).map((v) => v.code)).not.toContain('AMMO_OVER_CAPACITY');
    expect(validateDesign(illegal, 1_000_000).map((v) => v.code)).toContain('AMMO_OVER_CAPACITY');
  });

  it('heavy rocket caps at 1 round', () => {
    const heavyRocket = getWeapon('heavyrocket');
    expect(heavyRocket.ammoCapacity).toBe(1);

    const legal = baseDesign({ bodyId: 'van', weapons: [{ weaponId: 'heavyrocket', facing: 'FRONT', ammo: 1 }] });
    const illegal = baseDesign({ bodyId: 'van', weapons: [{ weaponId: 'heavyrocket', facing: 'FRONT', ammo: 2 }] });

    expect(validateDesign(legal, 1_000_000).map((v) => v.code)).not.toContain('AMMO_OVER_CAPACITY');
    expect(validateDesign(illegal, 1_000_000).map((v) => v.code)).toContain('AMMO_OVER_CAPACITY');
  });
});

describe('golden 8 — underpowered plant', () => {
  it('power under the lowest acceleration tier is UNDERPOWERED with a null accel', () => {
    const design = baseDesign({ bodyId: 'van', plantId: 'small', cargoWeightLb: 100_000 });
    const metrics = computeBuild(design);
    expect(metrics.accelMphPerSec).toBeNull();
    expect(metrics.violations.map((v) => v.code)).toContain('UNDERPOWERED');
  });
});

describe('golden 9 — acceleration tier boundaries', () => {
  it('flips exactly at power === weight and power === weight/2, and around weight/3', () => {
    const tiers = [...accelerationTiers()].sort((a, b) => b.powerRatio - a.powerRatio);
    const tier1 = tiers[0];
    const tier2 = tiers[1];
    const tier3 = tiers[2];
    if (tier1 === undefined || tier2 === undefined || tier3 === undefined) {
      throw new Error('expected three acceleration tiers');
    }
    expect(tier1.powerRatio).toBe(1);
    expect(tier2.powerRatio).toBe(0.5);

    const plant = getPlant('medium'); // fixed power from the ruleset
    const body = getBody('subcompact');
    const tire = getTire('standard');
    const fixedWeight = body.weightLb + plant.weightLb + 4 * tire.weightLb;

    function withWeight(totalWeight: number): BuildDesign {
      return baseDesign({
        bodyId: 'subcompact',
        plantId: 'medium',
        tireId: 'standard',
        cargoWeightLb: totalWeight - fixedWeight,
      });
    }

    // ratio 1: weight === power, exact (integers, ratio is exactly 1)
    const atTier1 = computeBuild(withWeight(plant.power));
    expect(atTier1.accelMphPerSec).toBe(tier1.mphPerSecond);
    // one lb heavier drops below the tier-1 threshold
    const justUnderTier1 = computeBuild(withWeight(plant.power + 1));
    expect(justUnderTier1.accelMphPerSec).not.toBe(tier1.mphPerSecond);

    // ratio 0.5: weight === power / 0.5 === power * 2, exact (power-of-two divisor)
    const atTier2 = computeBuild(withWeight(plant.power * 2));
    expect(atTier2.accelMphPerSec).toBe(tier2.mphPerSecond);
    const justUnderTier2 = computeBuild(withWeight(plant.power * 2 + 1));
    expect(justUnderTier2.accelMphPerSec).not.toBe(tier2.mphPerSecond);

    // ratio ~1/3 (0.33334 in the ruleset, a decimal approximation of 1/3):
    // comfortably inside vs. comfortably outside the tier.
    const insideTier3Weight = Math.floor(plant.power / tier3.powerRatio) - 5;
    const outsideTier3Weight = Math.ceil(plant.power / tier3.powerRatio) + 5;
    const insideTier3 = computeBuild(withWeight(insideTier3Weight));
    const outsideTier3 = computeBuild(withWeight(outsideTier3Weight));
    expect(insideTier3.accelMphPerSec).toBe(tier3.mphPerSecond);
    expect(outsideTier3.accelMphPerSec).toBeNull();

    // The EXACT boundary, docs/SPEC.md: `power >= weight/3 -> 5 mph/s`. This
    // one IS bit-exact and representable with integers (weight === power*3),
    // so it must resolve to tier 3, not fall through to UNDERPOWERED because
    // the ruleset's 0.33334 is a hair above the true 1/3.
    const atTier3 = computeBuild(withWeight(plant.power * 3));
    expect(atTier3.accelMphPerSec).toBe(tier3.mphPerSecond);
    const justOverTier3 = computeBuild(withWeight(plant.power * 3 + 1));
    expect(justOverTier3.accelMphPerSec).toBeNull();
  });
});

describe('golden 10 — a single tire id drives all four wheels by construction', () => {
  // A prior version of this suite also asserted `typeof design.tireId === 'string'`
  // as "proof" that BuildDesign carries one tireId, not four independent ones.
  // That's runtime-tautological: `tireId` is a statically-typed `string` field
  // (there is no per-wheel array in the type), so the assertion is guaranteed
  // by the compiler before this file ever runs and can never fail. The actual,
  // falsifiable claim - that the single id is applied to all four wheels at
  // runtime - is what the test below measures.
  it('at runtime, the one tireId is applied uniformly to all four tires', () => {
    const solid = getTire('solid');
    const metrics = computeBuild(baseDesign({ tireId: 'solid' }));
    const baseline = computeBuild(baseDesign({ tireId: 'standard' }));
    const standard = getTire('standard');

    expect(metrics.weightTotal - baseline.weightTotal).toBe(4 * (solid.weightLb - standard.weightLb));
    expect(metrics.costTotal - baseline.costTotal).toBe(4 * (solid.price - standard.price));
  });
});

describe('golden — table-driven ruleset loader fidelity', () => {
  it('bodies: every row matches the documented values', () => {
    expect(allBodies()).toEqual([
      { id: 'subcompact', name: 'Subcompact', price: 300, weightLb: 1000, baseMaxLoadLb: 2300, spaces: 7, class: 'automobile', armorCostPerPoint: 11, armorWeightPerPoint: 5 },
      { id: 'compact', name: 'Compact', price: 400, weightLb: 1300, baseMaxLoadLb: 3700, spaces: 10, class: 'automobile', armorCostPerPoint: 13, armorWeightPerPoint: 6 },
      { id: 'midsized', name: 'Mid-sized', price: 600, weightLb: 1600, baseMaxLoadLb: 4800, spaces: 13, class: 'automobile', armorCostPerPoint: 16, armorWeightPerPoint: 8 },
      { id: 'luxury', name: 'Luxury', price: 800, weightLb: 1800, baseMaxLoadLb: 5500, spaces: 19, class: 'automobile', armorCostPerPoint: 20, armorWeightPerPoint: 10 },
      { id: 'stationwagon', name: 'Station Wagon', price: 800, weightLb: 2100, baseMaxLoadLb: 5500, spaces: 21, class: 'cargo', armorCostPerPoint: 20, armorWeightPerPoint: 10 },
      { id: 'pickup', name: 'Pickup', price: 900, weightLb: 2100, baseMaxLoadLb: 6500, spaces: 24, class: 'cargo', armorCostPerPoint: 22, armorWeightPerPoint: 11 },
      { id: 'van', name: 'Van', price: 1000, weightLb: 2000, baseMaxLoadLb: 6000, spaces: 30, class: 'cargo', armorCostPerPoint: 30, armorWeightPerPoint: 14 },
    ]);
  });

  it('chassis: every row matches the documented values', () => {
    expect(allChassis()).toEqual([
      { id: 'light', name: 'Light', loadMultiplier: 0.9, bodyPriceModifier: -0.2 },
      { id: 'standard', name: 'Standard', loadMultiplier: 1.0, bodyPriceModifier: 0.0 },
      { id: 'heavy', name: 'Heavy', loadMultiplier: 1.1, bodyPriceModifier: 0.5 },
      { id: 'extraheavy', name: 'Extra-Heavy', loadMultiplier: 1.2, bodyPriceModifier: 1.0 },
    ]);
  });

  it('suspension: every row matches the documented values', () => {
    expect(allSuspensions()).toEqual([
      { id: 'light', name: 'Light', bodyPriceModifier: 0.0, handlingClass: { automobile: 1, cargo: 0 } },
      { id: 'improved', name: 'Improved', bodyPriceModifier: 1.0, handlingClass: { automobile: 2, cargo: 1 } },
      { id: 'heavy', name: 'Heavy', bodyPriceModifier: 1.5, handlingClass: { automobile: 3, cargo: 2 } },
    ]);
  });

  it('plants: every row (and the acceleration tiers) match the documented values', () => {
    expect(allPlants()).toEqual([
      { id: 'small', name: 'Small', price: 500, weightLb: 500, spaces: 3, maxDP: 5, power: 1000, topSpeedMph: 70, radarFailureThreshold: 1 },
      { id: 'medium', name: 'Medium', price: 1000, weightLb: 700, spaces: 4, maxDP: 8, power: 2300, topSpeedMph: 80, radarFailureThreshold: 2 },
      { id: 'large', name: 'Large', price: 2000, weightLb: 900, spaces: 5, maxDP: 10, power: 3600, topSpeedMph: 90, radarFailureThreshold: 2 },
      { id: 'super', name: 'Super', price: 3000, weightLb: 1100, spaces: 6, maxDP: 12, power: 5000, topSpeedMph: 90, radarFailureThreshold: 3 },
    ]);
    expect(accelerationTiers()).toEqual([
      { powerRatio: 1, mphPerSecond: 15 },
      { powerRatio: 0.5, mphPerSecond: 10 },
      { powerRatio: 0.33334, mphPerSecond: 5 },
    ]);
  });

  it('tires: every row matches the documented values', () => {
    expect(allTires()).toEqual([
      { id: 'standard', name: 'Standard', price: 50, weightLb: 30, maxDP: 4, spikeImmune: false },
      { id: 'heavyduty', name: 'Heavy-Duty', price: 100, weightLb: 40, maxDP: 6, spikeImmune: false },
      { id: 'punctureresistant', name: 'Puncture-Resistant', price: 200, weightLb: 50, maxDP: 9, spikeImmune: false },
      { id: 'solid', name: 'Solid', price: 500, weightLb: 75, maxDP: 12, spikeImmune: true },
    ]);
  });

  it('weapons: every row matches the documented price/weight/spaces/DP/ammo/facings', () => {
    const documented: Record<string, { price: number; weightLb: number; spaces: number; maxDP: number; ammoCost: number; ammoWeightLb: number; ammoCapacity: number; allowedFacings: string[] }> = {
      machinegun: { price: 1000, weightLb: 150, spaces: 1, maxDP: 3, ammoCost: 25, ammoWeightLb: 2, ammoCapacity: 20, allowedFacings: ['FRONT', 'REAR', 'LEFT', 'RIGHT'] },
      flamethrower: { price: 550, weightLb: 465, spaces: 3, maxDP: 3, ammoCost: 25, ammoWeightLb: 5, ammoCapacity: 20, allowedFacings: ['REAR', 'LEFT', 'RIGHT'] },
      rocketlauncher: { price: 1050, weightLb: 215, spaces: 3, maxDP: 3, ammoCost: 35, ammoWeightLb: 5, ammoCapacity: 20, allowedFacings: ['FRONT', 'REAR', 'LEFT', 'RIGHT'] },
      recoillessrifle: { price: 1550, weightLb: 315, spaces: 3, maxDP: 5, ammoCost: 35, ammoWeightLb: 5, ammoCapacity: 20, allowedFacings: ['FRONT', 'REAR', 'LEFT', 'RIGHT'] },
      antitankgun: { price: 2050, weightLb: 615, spaces: 4, maxDP: 6, ammoCost: 50, ammoWeightLb: 10, ammoCapacity: 20, allowedFacings: ['FRONT', 'REAR'] },
      laser: { price: 8000, weightLb: 500, spaces: 2, maxDP: 2, ammoCost: 0, ammoWeightLb: 0, ammoCapacity: 0, allowedFacings: ['FRONT', 'REAR', 'LEFT', 'RIGHT'] },
      minedropper: { price: 550, weightLb: 165, spaces: 3, maxDP: 3, ammoCost: 50, ammoWeightLb: 5, ammoCapacity: 20, allowedFacings: ['REAR'] },
      spikedropper: { price: 150, weightLb: 40, spaces: 2, maxDP: 5, ammoCost: 20, ammoWeightLb: 5, ammoCapacity: 20, allowedFacings: ['REAR'] },
      smokescreen: { price: 300, weightLb: 40, spaces: 2, maxDP: 5, ammoCost: 10, ammoWeightLb: 5, ammoCapacity: 20, allowedFacings: ['REAR', 'LEFT', 'RIGHT'] },
      paintsprayer: { price: 400, weightLb: 25, spaces: 1, maxDP: 2, ammoCost: 10, ammoWeightLb: 2, ammoCapacity: 20, allowedFacings: ['REAR', 'LEFT', 'RIGHT'] },
      oiljet: { price: 250, weightLb: 25, spaces: 2, maxDP: 3, ammoCost: 10, ammoWeightLb: 2, ammoCapacity: 20, allowedFacings: ['REAR'] },
      heavyrocket: { price: 200, weightLb: 100, spaces: 1, maxDP: 2, ammoCost: 0, ammoWeightLb: 0, ammoCapacity: 1, allowedFacings: ['FRONT', 'REAR', 'LEFT', 'RIGHT'] },
    };

    const weapons = allWeapons();
    expect(weapons).toHaveLength(Object.keys(documented).length);
    for (const weapon of weapons) {
      const expected = documented[weapon.id];
      expect(expected, `no documented row for weapon "${weapon.id}"`).toBeDefined();
      expect(weapon.price).toBe(expected?.price);
      expect(weapon.weightLb).toBe(expected?.weightLb);
      expect(weapon.spaces).toBe(expected?.spaces);
      expect(weapon.maxDP).toBe(expected?.maxDP);
      expect(weapon.ammoCost).toBe(expected?.ammoCost);
      expect(weapon.ammoWeightLb).toBe(expected?.ammoWeightLb);
      expect(weapon.ammoCapacity).toBe(expected?.ammoCapacity);
      expect(weapon.allowedFacings).toEqual(expected?.allowedFacings);
    }
  });
});
