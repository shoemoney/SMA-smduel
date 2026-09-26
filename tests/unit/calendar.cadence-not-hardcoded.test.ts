/**
 * A previous version of this suite proved to be tautological: every
 * "expected" value it asserted against was read from the SAME ruleset file
 * (via the SAME loader) that the implementation itself reads, so a
 * hardcoded literal in calendar.ts that happened to match the current
 * ruleset content would still make every assertion pass. Verified by
 * copying calendar.ts, hardcoding `CHAMPIONSHIP_CADENCE_DAYS = 84`, deleting
 * its cities.json import, and running the old suite: 43/43 still passed.
 *
 * This file defeats that tautology by mocking `@/data/rulesets` to return
 * DIFFERENT values than the real ruleset files (a cadence of 37 instead of
 * 84, an economy.json time cost of 999, and a swapped always-open facility
 * list) and checking that calendar.ts's output moves with the mock. A
 * hardcoded implementation could not react to this - only one that reads
 * `economy()` / `citiesConfig()` at call time can.
 */
import { describe, expect, it, vi } from 'vitest';

const MOCK_CADENCE = 37;
const MOCK_REPAIR_CAR_DAYS = 999;

vi.mock('@/data/rulesets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/rulesets')>();
  return {
    ...actual,
    economy: () => ({
      ...actual.economy(),
      timeCostDays: { ...actual.economy().timeCostDays, repairCar: MOCK_REPAIR_CAR_DAYS },
      // Swap which REAL facility kind is always-open (both 'garage' and
      // 'bar' are genuine cities.json facilityKinds, so isFacilityOpen's
      // unknown-kind guard still passes for either).
      alwaysOpenFacilities: ['garage'],
    }),
    citiesConfig: () => {
      const real = actual.citiesConfig();
      return { ...real, championships: { ...real.championships, cadenceDays: MOCK_CADENCE } };
    },
  };
});

const { isFacilityOpen, nextChampionshipDay, timeCostOf } = await import('@/sim/calendar');

describe('calendar: reads every tunable through the loader at call time, not a baked-in literal', () => {
  it('timeCostOf reflects a mocked economy.json value instead of any hardcoded number', () => {
    expect(timeCostOf('repairCar')).toBe(MOCK_REPAIR_CAR_DAYS);
  });

  it('isFacilityOpen reflects a mocked alwaysOpenFacilities list instead of any hardcoded set', () => {
    // The mock makes 'garage' always-open...
    expect(isFacilityOpen('garage', { dayIndex: 0, phase: 'NIGHT' })).toBe(true);
    // ...and demotes 'bar' (really always-open) to daytime-only.
    expect(isFacilityOpen('bar', { dayIndex: 0, phase: 'NIGHT' })).toBe(false);
    expect(isFacilityOpen('bar', { dayIndex: 0, phase: 'DAY' })).toBe(true);
  });

  it('nextChampionshipDay reflects a mocked cadenceDays instead of any hardcoded 84', () => {
    expect(nextChampionshipDay(0, MOCK_CADENCE)).toBe(MOCK_CADENCE);
    expect(nextChampionshipDay(0, MOCK_CADENCE - 1)).toBe(MOCK_CADENCE);
    expect(nextChampionshipDay(0, MOCK_CADENCE + 1)).toBe(MOCK_CADENCE * 2);
    // If 84 were hardcoded anywhere in the implementation, these 37-day
    // boundaries would come out wrong.
    expect(nextChampionshipDay(0, MOCK_CADENCE + 1)).not.toBe(84);
  });
});
