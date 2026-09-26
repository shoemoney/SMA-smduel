import { describe, expect, it } from 'vitest';
import {
  advanceDays,
  advanceForTimeCost,
  closeOutDay,
  daysLate,
  formatDate,
  fromDate,
  initialClock,
  isFacilityOpen,
  isLate,
  nextChampionshipDay,
  timeCostOf,
  toDate,
  type Clock,
} from '@/sim/calendar';
import { citiesConfig, economy, skillsConfig, UnknownRulesetIdError } from '@/data/rulesets';
import type { TimeCostAction } from '@/sim/types';

const TIME_COST_ENTRIES = Object.entries(economy().timeCostDays) as Array<[TimeCostAction, number]>;
const ALWAYS_OPEN = economy().alwaysOpenFacilities;
const CADENCE = citiesConfig().championships.cadenceDays;

function requireDefined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}

const ALBANY_FIRST_DAY = requireDefined(citiesConfig().championships.firstDay['albany'], 'albany championship firstDay');

function day(dayIndex: number, phase: Clock['phase']): Clock {
  return { dayIndex, phase };
}

describe('calendar: epoch conversions', () => {
  it('dayIndex 0 matches skills.json startingDate exactly (not a hardcoded literal)', () => {
    const startingDate = skillsConfig().startingDate;
    expect(formatDate(0)).toBe(startingDate);
    expect(fromDate(startingDate)).toBe(0);
  });

  it('fromDate is the inverse of formatDate/toDate across a range', () => {
    for (const dayIndex of [0, 1, 30, 31, 364, 365, 366, 1000, -1, -30]) {
      expect(fromDate(formatDate(dayIndex))).toBe(dayIndex);
    }
  });

  it('toDate advances by exactly one UTC day per dayIndex', () => {
    const epoch = fromDate(skillsConfig().startingDate);
    expect(toDate(epoch + 1).getTime() - toDate(epoch).getTime()).toBe(24 * 60 * 60 * 1000);
    expect(toDate(epoch + 31).getTime() - toDate(epoch).getTime()).toBe(31 * 24 * 60 * 60 * 1000);
  });

  it('fromDate rejects malformed or non-calendar dates', () => {
    expect(() => fromDate('not-a-date')).toThrow();
    expect(() => fromDate('2030-13-01')).toThrow();
    expect(() => fromDate('2030-02-30')).toThrow();
  });
});

describe('calendar: clock and phase', () => {
  it('initialClock starts at day 0, DAY phase', () => {
    expect(initialClock()).toEqual({ dayIndex: 0, phase: 'DAY' });
  });

  it('advanceDays(clock, 0) is a no-op', () => {
    const clock = day(5, 'NIGHT');
    expect(advanceDays(clock, 0)).toBe(clock);
  });

  it('advanceDays moves dayIndex forward and resets phase to DAY', () => {
    const clock = day(5, 'NIGHT');
    expect(advanceDays(clock, 1)).toEqual({ dayIndex: 6, phase: 'DAY' });
    expect(advanceDays(clock, 7)).toEqual({ dayIndex: 12, phase: 'DAY' });
  });

  it('advanceDays rejects negative or non-integer n', () => {
    const clock = initialClock();
    expect(() => advanceDays(clock, -1)).toThrow();
    expect(() => advanceDays(clock, 1.5)).toThrow();
  });

  it('closeOutDay flips to NIGHT without changing dayIndex', () => {
    const clock = day(3, 'DAY');
    expect(closeOutDay(clock)).toEqual({ dayIndex: 3, phase: 'NIGHT' });
  });

  it('closeOutDay is idempotent on an already-NIGHT clock', () => {
    const clock = day(3, 'NIGHT');
    expect(closeOutDay(clock)).toBe(clock);
  });
});

describe('calendar: advanceForTimeCost (production path for a charged action)', () => {
  it('a 0-day cost is a no-op, same as advanceDays(clock, 0)', () => {
    const clock = day(5, 'NIGHT');
    expect(advanceForTimeCost(clock, 0)).toBe(clock);
  });

  it('a 1-day cost closes today out to NIGHT without moving to the next day', () => {
    const clock = day(5, 'DAY');
    expect(advanceForTimeCost(clock, 1)).toEqual({ dayIndex: 5, phase: 'NIGHT' });
  });

  it('an N-day cost (N >= 2) advances the N-1 full intervening days, then closes out the final day', () => {
    const clock = day(5, 'DAY');
    expect(advanceForTimeCost(clock, 3)).toEqual({ dayIndex: 7, phase: 'NIGHT' });
  });

  it('reaches NIGHT and makes daytime-only facilities close, matching the spec rule for a >= 1 day action', () => {
    const daytimeOnly = 'garage';
    let clock = day(0, 'DAY');
    expect(isFacilityOpen(daytimeOnly, clock)).toBe(true);

    clock = advanceForTimeCost(clock, 1);
    expect(isFacilityOpen(daytimeOnly, clock)).toBe(false);

    clock = advanceDays(clock, 1);
    expect(isFacilityOpen(daytimeOnly, clock)).toBe(true);
  });

  it('rejects negative or non-integer day costs', () => {
    const clock = initialClock();
    expect(() => advanceForTimeCost(clock, -1)).toThrow();
    expect(() => advanceForTimeCost(clock, 1.5)).toThrow();
  });
});

describe('calendar: time costs (table-driven over every economy.json entry)', () => {
  it.each(TIME_COST_ENTRIES)('timeCostOf(%s) === economy.json value (%i)', (action, expected) => {
    expect(timeCostOf(action)).toBe(expected);
  });
});

describe('calendar: facility hours', () => {
  it.each(ALWAYS_OPEN)('%s is open in both DAY and NIGHT (alwaysOpenFacilities)', (facilityKind) => {
    expect(isFacilityOpen(facilityKind, day(0, 'DAY'))).toBe(true);
    expect(isFacilityOpen(facilityKind, day(0, 'NIGHT'))).toBe(true);
  });

  it('a facility outside alwaysOpenFacilities is DAY-only', () => {
    const daytimeOnly = 'garage';
    expect(ALWAYS_OPEN).not.toContain(daytimeOnly);
    expect(isFacilityOpen(daytimeOnly, day(0, 'DAY'))).toBe(true);
    expect(isFacilityOpen(daytimeOnly, day(0, 'NIGHT'))).toBe(false);
  });

  it('closing out the day closes daytime-only facilities until the next day begins', () => {
    const daytimeOnly = 'garage';
    let clock = day(0, 'DAY');
    expect(isFacilityOpen(daytimeOnly, clock)).toBe(true);

    clock = closeOutDay(clock);
    expect(isFacilityOpen(daytimeOnly, clock)).toBe(false);
    // always-open facilities are unaffected
    const alwaysOpenSample = ALWAYS_OPEN[0];
    if (alwaysOpenSample !== undefined) {
      expect(isFacilityOpen(alwaysOpenSample, clock)).toBe(true);
    }

    clock = advanceDays(clock, 1);
    expect(isFacilityOpen(daytimeOnly, clock)).toBe(true);
  });

  it('throws UnknownRulesetIdError for a facility kind not in cities.json facilityKinds', () => {
    expect(() => isFacilityOpen('garrage', day(0, 'DAY'))).toThrow(UnknownRulesetIdError);
    expect(() => isFacilityOpen('not-a-facility', day(0, 'NIGHT'))).toThrow(UnknownRulesetIdError);
    expect(() => isFacilityOpen('', day(0, 'DAY'))).toThrow(UnknownRulesetIdError);
  });

  it('accepts every real facility kind from cities.json without throwing', () => {
    for (const kind of citiesConfig().facilityKinds) {
      expect(() => isFacilityOpen(kind, day(0, 'DAY'))).not.toThrow();
    }
  });
});

describe('calendar: deadlines', () => {
  it('isLate is false on or before the due day, true strictly after', () => {
    expect(isLate(10, day(9, 'DAY'))).toBe(false);
    expect(isLate(10, day(10, 'DAY'))).toBe(false);
    expect(isLate(10, day(11, 'DAY'))).toBe(true);
  });

  it('daysLate is 0 on or before the due day, and the exact overrun after', () => {
    expect(daysLate(10, day(9, 'DAY'))).toBe(0);
    expect(daysLate(10, day(10, 'DAY'))).toBe(0);
    expect(daysLate(10, day(13, 'DAY'))).toBe(3);
  });

  it('deadlines compare dayIndex only, ignoring phase', () => {
    expect(isLate(10, day(11, 'NIGHT'))).toBe(true);
    expect(daysLate(10, day(13, 'NIGHT'))).toBe(3);
  });
});

describe('calendar: championship cadence', () => {
  it('returns firstDay when currentDay === firstDay', () => {
    expect(nextChampionshipDay(ALBANY_FIRST_DAY, ALBANY_FIRST_DAY)).toBe(ALBANY_FIRST_DAY);
  });

  it('returns firstDay when currentDay is before the first championship', () => {
    expect(nextChampionshipDay(ALBANY_FIRST_DAY, 0)).toBe(ALBANY_FIRST_DAY);
    expect(nextChampionshipDay(ALBANY_FIRST_DAY, ALBANY_FIRST_DAY - 1)).toBe(ALBANY_FIRST_DAY);
  });

  it('lands exactly on the boundary day of a later cycle', () => {
    const secondCycleDay = ALBANY_FIRST_DAY + CADENCE;
    expect(nextChampionshipDay(ALBANY_FIRST_DAY, secondCycleDay)).toBe(secondCycleDay);
  });

  it('wraps forward across at least 4 cycles', () => {
    for (let cycle = 1; cycle <= 4; cycle += 1) {
      const boundary = ALBANY_FIRST_DAY + cycle * CADENCE;
      // the day right after a boundary should point at the NEXT boundary
      expect(nextChampionshipDay(ALBANY_FIRST_DAY, boundary + 1)).toBe(boundary + CADENCE);
      // a day partway through the cycle should still point at the upcoming boundary
      const midCycle = boundary + Math.floor(CADENCE / 2);
      expect(nextChampionshipDay(ALBANY_FIRST_DAY, midCycle)).toBe(boundary + CADENCE);
    }
  });

  // The "cadence isn't hardcoded" property is NOT provable from assertions
  // that compare against a CADENCE constant read from the same loader the
  // implementation reads (a hardcoded literal that happened to match
  // cities.json's real value would still pass those). That property is
  // instead proven in calendar.cadence-not-hardcoded.test.ts, which mocks
  // @/data/rulesets to a DIFFERENT cadence and checks the implementation's
  // output moves with it.
});
