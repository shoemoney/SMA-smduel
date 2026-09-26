/**
 * `computeBuild`'s tire weight/cost math must read the wheel count (four
 * identical tires per vehicle) from `@/data/rulesets` at call time, not from
 * a bare `4` retyped into construct.ts. A hardcoded `4 * tire.weightLb` would
 * pass every other test in construct.test.ts, since every current ruleset
 * body genuinely mounts four tires — that suite is tautological on this
 * point alone, exactly like the calendar cadence case documented in
 * calendar.cadence-not-hardcoded.test.ts.
 *
 * This file defeats that tautology by mocking `@/data/rulesets` to report a
 * DIFFERENT wheel count (6 instead of the real 4) and checking that
 * `computeBuild`'s weight/cost move to 6x. A hardcoded implementation could
 * not react to this — only one that calls `wheelCount()` at build time can.
 */
import { describe, expect, it, vi } from 'vitest';
import { makeArmorRecord } from '@/sim/types';

const MOCK_WHEEL_COUNT = 6;

vi.mock('@/data/rulesets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/rulesets')>();
  return {
    ...actual,
    wheelCount: () => MOCK_WHEEL_COUNT,
  };
});

const { computeBuild } = await import('@/sim/construct');
const { getBody, getPlant, getTire } = await import('@/data/rulesets');

describe('computeBuild: wheel count is read through @/data/rulesets, not hardcoded', () => {
  it('tireWeight/tireCost scale with a mocked wheelCount() instead of the real ruleset 4', () => {
    const body = getBody('subcompact');
    const plant = getPlant('medium');
    const tire = getTire('standard');

    const metrics = computeBuild({
      name: 'Mock Rig',
      bodyId: 'subcompact',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'medium',
      tireId: 'standard',
      armor: makeArmorRecord(0),
      weapons: [],
    });

    const expectedWeight = body.weightLb + plant.weightLb + MOCK_WHEEL_COUNT * tire.weightLb;
    const expectedCost = Math.round(body.price + plant.price + MOCK_WHEEL_COUNT * tire.price);

    expect(metrics.weightTotal).toBe(expectedWeight);
    expect(metrics.costTotal).toBe(expectedCost);

    // Sanity: the mocked count must actually differ from the real ruleset
    // value, or this test would not be exercising anything.
    expect(MOCK_WHEEL_COUNT).not.toBe(4);
    expect(metrics.weightTotal).not.toBe(body.weightLb + plant.weightLb + 4 * tire.weightLb);
  });
});
