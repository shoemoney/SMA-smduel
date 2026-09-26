import { describe, expect, it } from 'vitest';
import { computeBuild, validateDesign, type BuildDesign } from '@/sim/construct';
import { getBody, getPlant, getTire, getWeapon } from '@/data/rulesets';
import { makeArmorRecord } from '@/sim/types';
import type { MountedWeapon } from '@/sim/types';
// MAX_WEAPON_ROWS is a UI layout constant, not a legality rule, so its one
// definition lives in `@/ui/hud`, not `@/sim/construct` — see that module's
// file header.
import { MAX_WEAPON_ROWS } from '@/ui/hud';

function baseDesign(overrides: Partial<BuildDesign> = {}): BuildDesign {
  return {
    name: 'Test Rig',
    bodyId: 'subcompact',
    chassisId: 'standard',
    suspensionId: 'light',
    plantId: 'medium',
    tireId: 'standard',
    armor: makeArmorRecord(0),
    weapons: [],
    ...overrides,
  };
}

function violationCodes(design: BuildDesign, cash = 1_000_000): string[] {
  return validateDesign(design, cash).map((v) => v.code);
}

describe('computeBuild — baseline sanity', () => {
  it('produces a legal, violation-free build for a modest valid design', () => {
    const design = baseDesign();
    const metrics = computeBuild(design);

    const body = getBody('subcompact');
    const plant = getPlant('medium');
    const tire = getTire('standard');

    expect(metrics.weightTotal).toBe(body.weightLb + plant.weightLb + 4 * tire.weightLb);
    expect(metrics.spacesUsed).toBe(plant.spaces);
    expect(metrics.spacesTotal).toBe(body.spaces);
    expect(metrics.maxLoadLb).toBe(body.baseMaxLoadLb); // standard chassis: multiplier 1.0
    expect(metrics.topSpeedMph).toBe(plant.topSpeedMph);
    expect(metrics.accelMphPerSec).not.toBeNull();
    expect(metrics.legal).toBe(true);
    expect(metrics.violations).toHaveLength(0);
  });

  it('folds cargo weight and spaces into the totals', () => {
    const withoutCargo = computeBuild(baseDesign());
    const withCargo = computeBuild(baseDesign({ cargoWeightLb: 200, cargoSpaces: 2 }));

    expect(withCargo.weightTotal).toBe(withoutCargo.weightTotal + 200);
    expect(withCargo.spacesUsed).toBe(withoutCargo.spacesUsed + 2);
  });
});

describe('computeBuild / validateDesign — violation codes', () => {
  it('MISSING_COMPONENT fires for every unknown component id, including weapons', () => {
    const design = baseDesign({
      bodyId: 'nonexistent-body',
      chassisId: 'nonexistent-chassis',
      weapons: [{ weaponId: 'nonexistent-weapon', facing: 'FRONT', ammo: 0 }],
    });
    const codes = violationCodes(design);
    expect(codes.filter((c) => c === 'MISSING_COMPONENT')).toHaveLength(3);
  });

  it('NEGATIVE_ARMOR fires when any facing carries negative armor', () => {
    const design = baseDesign({ armor: { ...makeArmorRecord(0), LEFT: -5 } });
    expect(violationCodes(design)).toContain('NEGATIVE_ARMOR');
  });

  it('mount count alone never blocks a build — docs/SPEC.md gates only on spaces', () => {
    // MAX_WEAPON_ROWS is a UI row-count constant, not a legality rule, so
    // mounting more than it — while staying inside the body's spaces budget —
    // must stay legal. Every expected number is derived from the ruleset
    // tables, never retyped.
    const paintsprayer = getWeapon('paintsprayer');
    const van = getBody('van');
    const plant = getPlant('small');
    const mountCount = MAX_WEAPON_ROWS + 1;
    const manyWeapons: MountedWeapon[] = Array.from({ length: mountCount }, () => ({
      weaponId: 'paintsprayer',
      facing: 'REAR',
      ammo: 0,
    }));
    const expectedSpacesUsed = plant.spaces + mountCount * paintsprayer.spaces;
    // Sanity check on the fixture itself: this design must actually still fit,
    // or the test would not be exercising the "over the slot count, under the
    // spaces budget" case it claims to.
    expect(expectedSpacesUsed).toBeLessThanOrEqual(van.spaces);

    const design = baseDesign({ bodyId: 'van', plantId: 'small', weapons: manyWeapons });
    const metrics = computeBuild(design);

    expect(metrics.spacesUsed).toBe(expectedSpacesUsed);
    expect(metrics.legal).toBe(true);
    expect(metrics.violations).toHaveLength(0);
  });

  it('OVER_SPACES still fires once the same weapon count pushes past the spaces budget', () => {
    const antitankgun = getWeapon('antitankgun');
    const subcompact = getBody('subcompact');
    const plant = getPlant('large');
    const design = baseDesign({
      bodyId: 'subcompact',
      plantId: 'large',
      weapons: [{ weaponId: 'antitankgun', facing: 'FRONT', ammo: 0 }],
    });
    const expectedSpacesUsed = plant.spaces + antitankgun.spaces;
    expect(expectedSpacesUsed).toBeGreaterThan(subcompact.spaces);
    expect(violationCodes(design)).toContain('OVER_SPACES');
  });

  it('negative or fractional ammo is rejected, not silently accepted into cost/weight', () => {
    const antitankgun = getWeapon('antitankgun');
    const van = getBody('van');
    const plant = getPlant('medium'); // baseDesign()'s default plantId
    const tire = getTire('standard'); // baseDesign()'s default tireId
    const negative = baseDesign({
      bodyId: 'van',
      weapons: [{ weaponId: 'antitankgun', facing: 'FRONT', ammo: -1000 }],
    });
    const fractional = baseDesign({
      bodyId: 'van',
      weapons: [{ weaponId: 'antitankgun', facing: 'FRONT', ammo: 3.7 }],
    });

    // Independently derived: negative/fractional ammo must clamp to 0 rounds
    // for the math, so this is exactly what a legal 0-ammo mount would cost/weigh.
    const expectedCost = van.price + plant.price + 4 * tire.price + antitankgun.price;
    const expectedWeight = van.weightLb + plant.weightLb + 4 * tire.weightLb + antitankgun.weightLb;

    const negativeMetrics = computeBuild(negative);
    // -1000 is a whole number, just an out-of-range one — NEGATIVE_AMMO only.
    expect(violationCodes(negative)).toContain('NEGATIVE_AMMO');
    expect(violationCodes(negative)).not.toContain('NON_INTEGER_AMMO');
    expect(negativeMetrics.legal).toBe(false);
    expect(negativeMetrics.costTotal).toBe(expectedCost);
    expect(negativeMetrics.weightTotal).toBe(expectedWeight);

    const fractionalMetrics = computeBuild(fractional);
    expect(violationCodes(fractional)).toContain('NON_INTEGER_AMMO');
    expect(violationCodes(fractional)).not.toContain('NEGATIVE_AMMO');
    // 3.7 truncates to 3 rounds for the math (still flagged illegal above).
    expect(fractionalMetrics.costTotal).toBe(expectedCost + 3 * antitankgun.ammoCost);
    expect(Number.isInteger(fractionalMetrics.costTotal)).toBe(true);

    // Negative AND fractional together fires both codes, and still clamps to 0.
    const negativeFractional = baseDesign({
      bodyId: 'van',
      weapons: [{ weaponId: 'antitankgun', facing: 'FRONT', ammo: -2.5 }],
    });
    const codes = violationCodes(negativeFractional);
    expect(codes).toContain('NEGATIVE_AMMO');
    expect(codes).toContain('NON_INTEGER_AMMO');
    expect(computeBuild(negativeFractional).costTotal).toBe(expectedCost);
  });

  it('NON_INTEGER_ARMOR fires for fractional armor points and keeps costTotal an integer', () => {
    const design = baseDesign({ armor: { ...makeArmorRecord(0), FRONT: 2.5 } });
    expect(violationCodes(design)).toContain('NON_INTEGER_ARMOR');
    expect(Number.isInteger(computeBuild(design).costTotal)).toBe(true);
  });

  it('a missing component reports derived metrics as NaN ("?????"), never a plausible 0', () => {
    const missingBody = baseDesign({ bodyId: 'no-such-body' });
    const metrics = computeBuild(missingBody);

    expect(Number.isNaN(metrics.maxLoadLb)).toBe(true);
    expect(Number.isNaN(metrics.handlingClass)).toBe(true);
    expect(Number.isNaN(metrics.spacesTotal)).toBe(true);
    // No fabricated cascade from comparing weight/spaces against a fake 0.
    expect(metrics.violations.map((v) => v.code)).toEqual(['MISSING_COMPONENT']);

    // Contrast: a fully-resolved build can have a genuinely real 0 for the
    // same field, and that must NOT read as NaN — 0 and "unknown" are
    // different states.
    const vanLightSuspension = computeBuild(baseDesign({ bodyId: 'van', suspensionId: 'light' }));
    expect(vanLightSuspension.handlingClass).toBe(0);
    expect(Number.isNaN(vanLightSuspension.handlingClass)).toBe(false);
  });

  it('OVER_SPACES fires once spaces used exceeds the body total', () => {
    // subcompact has 7 spaces; a large plant (5 spaces) plus a spacious weapon blows past it.
    const design = baseDesign({
      plantId: 'large',
      weapons: [{ weaponId: 'antitankgun', facing: 'FRONT', ammo: 0 }], // 4 spaces
    });
    expect(violationCodes(design)).toContain('OVER_SPACES');
  });

  it('OVER_WEIGHT fires once vehicle weight exceeds the modified max load', () => {
    const design = baseDesign({ bodyId: 'subcompact', cargoWeightLb: 100_000 });
    expect(violationCodes(design)).toContain('OVER_WEIGHT');
  });

  it('OVER_BUDGET only appears through validateDesign, never through computeBuild alone', () => {
    const design = baseDesign();
    const metrics = computeBuild(design);
    expect(metrics.violations.map((v) => v.code)).not.toContain('OVER_BUDGET');
    expect(validateDesign(design, 1).map((v) => v.code)).toContain('OVER_BUDGET');
    expect(validateDesign(design, metrics.costTotal).map((v) => v.code)).not.toContain('OVER_BUDGET');
    expect(validateDesign(design, metrics.costTotal - 1).map((v) => v.code)).toContain('OVER_BUDGET');
  });

  it('validateDesign is a superset of computeBuild violations plus OVER_BUDGET', () => {
    const design = baseDesign({ armor: { ...makeArmorRecord(0), FRONT: -1 } });
    const metrics = computeBuild(design);
    const validated = validateDesign(design, 0);
    for (const v of metrics.violations) {
      expect(validated.map((x) => x.code)).toContain(v.code);
    }
    expect(validated.map((v) => v.code)).toContain('OVER_BUDGET');
  });
});

describe('chassis and suspension add cost only, never weight or spaces', () => {
  it('swapping chassis/suspension leaves weight and spaces untouched', () => {
    const light = computeBuild(baseDesign({ chassisId: 'light', suspensionId: 'light' }));
    const heavy = computeBuild(baseDesign({ chassisId: 'extraheavy', suspensionId: 'heavy' }));

    expect(heavy.weightTotal).toBe(light.weightTotal);
    expect(heavy.spacesUsed).toBe(light.spacesUsed);
    expect(heavy.spacesTotal).toBe(light.spacesTotal);
    expect(heavy.costTotal).not.toBe(light.costTotal);
  });
});
