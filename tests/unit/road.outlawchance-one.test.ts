/**
 * Complement of tests/unit/road.outlawchance-zero.test.ts — see that file's
 * header for the full rationale. This file mocks danger 0's `outlawChance`
 * up to exactly 1 and checks an outlaw ambush spawns on EVERY seed, even
 * though danger 0's REAL `factionWeights.outlaw` is exactly 0 (so the
 * weighted traffic-mix roll alone could never guarantee that).
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
        (tier as { danger: number }).danger === 0 ? { ...(tier as object), outlawChance: 1 } : tier,
      ),
    },
  };
});

const { generateRouteContacts } = await import('@/sim/road');
const { createRng } = await import('@/util/rng');

describe('road: outlawChance mocked to exactly 1 at danger 0', () => {
  it('spawns an outlaw ambush at danger 0 on every seed', () => {
    const route = { id: 'mocked-outlawchance-one-route', a: 'x', b: 'y', lengthMiles: 200, danger: 0 };
    for (let i = 0; i < 20; i++) {
      const contacts = generateRouteContacts(route, createRng(`one-seed-${i}`));
      expect(contacts.some((c) => c.faction === 'outlaw')).toBe(true);
    }
  });
});
