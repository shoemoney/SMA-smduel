import { describe, expect, it, vi } from 'vitest';
import { citiesConfig, UnknownRulesetIdError } from '@/data/rulesets';

function requireDefined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}

const CADENCE = citiesConfig().championships.cadenceDays;
const ALBANY_FIRST_DAY = requireDefined(citiesConfig().championships.firstDay['albany'], 'albany championship firstDay');

// A real cities.json city with no championships.firstDay entry at all.
const UNSCHEDULED_CITY = 'baltimore';
if (citiesConfig().championships.firstDay[UNSCHEDULED_CITY] !== undefined) {
  throw new Error(`fixture assumption broken: ${UNSCHEDULED_CITY} now has a championship firstDay`);
}

const { daysUntilChampionship, isChampionshipDay, scheduleFor } = await import('@/sim/championship');

describe('championship: isChampionshipDay', () => {
  it('is true on the exact firstDay boundary', () => {
    expect(isChampionshipDay('albany', ALBANY_FIRST_DAY)).toBe(true);
  });

  it('is false the day before firstDay', () => {
    expect(isChampionshipDay('albany', ALBANY_FIRST_DAY - 1)).toBe(false);
  });

  it('is true again on every later cadence boundary, across 4+ cycles', () => {
    for (let cycle = 1; cycle <= 4; cycle++) {
      expect(isChampionshipDay('albany', ALBANY_FIRST_DAY + cycle * CADENCE)).toBe(true);
      expect(isChampionshipDay('albany', ALBANY_FIRST_DAY + cycle * CADENCE - 1)).toBe(false);
      expect(isChampionshipDay('albany', ALBANY_FIRST_DAY + cycle * CADENCE + 1)).toBe(false);
    }
  });

  it('is false on every day for an unscheduled city', () => {
    expect(isChampionshipDay(UNSCHEDULED_CITY, 0)).toBe(false);
    expect(isChampionshipDay(UNSCHEDULED_CITY, ALBANY_FIRST_DAY)).toBe(false);
    expect(isChampionshipDay(UNSCHEDULED_CITY, ALBANY_FIRST_DAY + 10 * CADENCE)).toBe(false);
  });

  it('throws UnknownRulesetIdError for a city id that is not in cities.json at all', () => {
    expect(() => isChampionshipDay('not-a-real-city', 0)).toThrow(UnknownRulesetIdError);
  });
});

describe('championship: daysUntilChampionship', () => {
  it('is 0 on the exact firstDay boundary', () => {
    expect(daysUntilChampionship('albany', ALBANY_FIRST_DAY)).toBe(0);
  });

  it('counts down to the next boundary from before firstDay', () => {
    expect(daysUntilChampionship('albany', 0)).toBe(ALBANY_FIRST_DAY);
    expect(daysUntilChampionship('albany', ALBANY_FIRST_DAY - 1)).toBe(1);
  });

  it('counts down to the next cadence boundary once past firstDay, across 4+ cycles', () => {
    for (let cycle = 1; cycle <= 4; cycle++) {
      const boundary = ALBANY_FIRST_DAY + cycle * CADENCE;
      expect(daysUntilChampionship('albany', boundary - 5)).toBe(5);
      expect(daysUntilChampionship('albany', boundary)).toBe(0);
    }
  });

  it('is null for an unscheduled city — there is no next date to count down to', () => {
    expect(daysUntilChampionship(UNSCHEDULED_CITY, 0)).toBeNull();
    expect(daysUntilChampionship(UNSCHEDULED_CITY, ALBANY_FIRST_DAY + 5 * CADENCE)).toBeNull();
  });
});

describe('championship: scheduleFor', () => {
  it('returns the exact-boundary day first when fromDay === firstDay', () => {
    expect(scheduleFor('albany', ALBANY_FIRST_DAY, 1)).toEqual([ALBANY_FIRST_DAY]);
  });

  it('returns N consecutive cadence-spaced days, 4+ cycles out, starting at or after fromDay', () => {
    const schedule = scheduleFor('albany', 0, 5);
    expect(schedule).toEqual([
      ALBANY_FIRST_DAY,
      ALBANY_FIRST_DAY + CADENCE,
      ALBANY_FIRST_DAY + 2 * CADENCE,
      ALBANY_FIRST_DAY + 3 * CADENCE,
      ALBANY_FIRST_DAY + 4 * CADENCE,
    ]);
  });

  it('starts from the first boundary at or after a mid-cycle fromDay, not from firstDay', () => {
    const midCycle = ALBANY_FIRST_DAY + 2 * CADENCE - 10;
    const schedule = scheduleFor('albany', midCycle, 3);
    expect(schedule).toEqual([
      ALBANY_FIRST_DAY + 2 * CADENCE,
      ALBANY_FIRST_DAY + 3 * CADENCE,
      ALBANY_FIRST_DAY + 4 * CADENCE,
    ]);
  });

  it('is empty for an unscheduled city', () => {
    expect(scheduleFor(UNSCHEDULED_CITY, 0, 10)).toEqual([]);
  });

  it('is empty when count is 0, even for a scheduled city', () => {
    expect(scheduleFor('albany', 0, 0)).toEqual([]);
  });

  it('rejects a negative or non-integer count', () => {
    expect(() => scheduleFor('albany', 0, -1)).toThrow();
    expect(() => scheduleFor('albany', 0, 1.5)).toThrow();
  });
});

describe('championship: reads cadenceDays through the loader at call time, not a hardcoded 84', () => {
  const MOCK_CADENCE = 37;

  it('scheduleFor spacing moves with a mocked cadenceDays', async () => {
    vi.resetModules();
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        citiesConfig: () => {
          const real = actual.citiesConfig();
          return { ...real, championships: { ...real.championships, cadenceDays: MOCK_CADENCE } };
        },
      };
    });

    const mocked = await import('@/sim/championship');
    const schedule = mocked.scheduleFor('albany', ALBANY_FIRST_DAY, 3);
    expect(schedule).toEqual([ALBANY_FIRST_DAY, ALBANY_FIRST_DAY + MOCK_CADENCE, ALBANY_FIRST_DAY + 2 * MOCK_CADENCE]);
    // If 84 were hardcoded anywhere in the implementation, this boundary
    // would come out wrong.
    expect(schedule).not.toContain(ALBANY_FIRST_DAY + CADENCE);

    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });
});
