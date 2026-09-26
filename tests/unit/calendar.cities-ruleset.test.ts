/**
 * cities.json used to be imported directly by calendar.ts, bypassing the
 * ajv schema validation every other ruleset file gets from
 * `@/data/rulesets` / `@/data/schema`. That meant a cadenceDays of 0 or
 * negative loaded silently and made nextChampionshipDay return Infinity/NaN
 * instead of failing at startup. cities.json is now the tenth file
 * registered in the loader; these tests pin that it is actually validated,
 * the same way tests/unit/rulesets.test.ts pins the original nine.
 */
import { describe, expect, it } from 'vitest';
import { RAW_RULESETS } from '@/data/rulesets';
import { RulesetValidationError, validateRulesets, type RawRulesetInput } from '@/data/schema';
import type { CitiesFile } from '@/sim/types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneCities(): CitiesFile {
  return clone(RAW_RULESETS.cities as CitiesFile);
}

describe('calendar: cities.json is validated through the loader (not bypassed)', () => {
  it('the shipped cities.json validates cleanly and cadenceDays is a positive integer', () => {
    const cities = validateRulesets(RAW_RULESETS).cities;
    expect(Number.isInteger(cities.championships.cadenceDays)).toBe(true);
    expect(cities.championships.cadenceDays).toBeGreaterThan(0);
  });

  it('rejects a zero championship cadence instead of loading it silently', () => {
    const cities = cloneCities();
    cities.championships.cadenceDays = 0;
    const raw: RawRulesetInput = { ...RAW_RULESETS, cities };
    expect(() => validateRulesets(raw)).toThrow(RulesetValidationError);
  });

  it('rejects a negative championship cadence', () => {
    const cities = cloneCities();
    cities.championships.cadenceDays = -5;
    const raw: RawRulesetInput = { ...RAW_RULESETS, cities };
    expect(() => validateRulesets(raw)).toThrow(RulesetValidationError);
  });

  it('rejects a duplicate city id', () => {
    const cities = cloneCities();
    const first = cities.cities[0];
    const second = cities.cities[1];
    if (first === undefined || second === undefined) throw new Error('expected at least two cities');
    second.id = first.id;
    const raw: RawRulesetInput = { ...RAW_RULESETS, cities };
    expect(() => validateRulesets(raw)).toThrow(/cities\.json:\/cities\/1\/id duplicate id/);
  });

  it('rejects a duplicate route id', () => {
    const cities = cloneCities();
    const first = cities.routes[0];
    const second = cities.routes[1];
    if (first === undefined || second === undefined) throw new Error('expected at least two routes');
    second.id = first.id;
    const raw: RawRulesetInput = { ...RAW_RULESETS, cities };
    expect(() => validateRulesets(raw)).toThrow(/cities\.json:\/routes\/1\/id duplicate id/);
  });
});
