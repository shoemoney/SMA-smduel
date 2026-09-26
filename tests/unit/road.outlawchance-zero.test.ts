/**
 * `dangerLevels[n].outlawChance` (rulesets/classic/encounters.json) used to
 * be validated by road.ts's own ajv schema and then never read by anything
 * — `grep -rn outlawChance src tests` matched only its type/schema
 * declarations. This file (paired with road.outlawchance-one.test.ts —
 * split into two files because `generateRouteContacts` reads a
 * module-level constant parsed from this JSON import ONCE at import time,
 * so one file can only ever prove one mocked value) mocks danger 0's
 * `outlawChance` down to exactly 0 and checks NO outlaw ever spawns there,
 * even though the real ruleset's own `outlawChance` (0.05) would
 * occasionally produce one over enough seeds — see
 * tests/unit/road.outlawchance-one.test.ts for the complementary proof at
 * exactly 1. Together the two pin the exact mechanism (not just "outlaws
 * show up sometimes"), the way
 * tests/unit/calendar.cadence-not-hardcoded.test.ts pins a ruleset number
 * via '@/data/rulesets' mocking.
 *
 * Danger 0's REAL `factionWeights.outlaw` is exactly 0, so the weighted
 * traffic-mix roll in `generateRouteContacts` can never produce an outlaw
 * there by itself — any outlaw at danger 0 can only come from this knob.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@rulesets/classic/encounters.json', async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  const realDangerLevels = actual.default['dangerLevels'];
  if (!Array.isArray(realDangerLevels)) throw new Error('encounters.json: dangerLevels missing in mock passthrough');
  return {
    default: {
      ...actual.default,
      dangerLevels: realDangerLevels.map((tier) =>
        (tier as { danger: number }).danger === 0 ? { ...(tier as object), outlawChance: 0 } : tier,
      ),
    },
  };
});

const { generateRouteContacts } = await import('@/sim/road');
const { createRng } = await import('@/util/rng');

describe('road: outlawChance mocked to exactly 0 at danger 0', () => {
  it('never spawns an outlaw at danger 0, across many seeds', () => {
    const route = { id: 'mocked-outlawchance-zero-route', a: 'x', b: 'y', lengthMiles: 200, danger: 0 };
    let anyOutlaw = false;
    for (let i = 0; i < 50; i++) {
      const contacts = generateRouteContacts(route, createRng(`zero-seed-${i}`));
      if (contacts.some((c) => c.faction === 'outlaw')) anyOutlaw = true;
    }
    expect(anyOutlaw).toBe(false);
  });
});
