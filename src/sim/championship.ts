/**
 * CHAMPIONSHIP subsystem: the recurring city-championship calendar.
 *
 * Every date fact here comes from cities.json's `championships` table (read
 * through the validated `@/data/rulesets` loader on every call, never
 * cached) and from `@/sim/calendar`'s `nextChampionshipDay`, which this
 * module reuses rather than reimplementing the cadence-wrap arithmetic.
 *
 * Only 9 of cities.json's 16 cities carry a `firstDay` entry — the rest
 * never hold a championship. That is a real, representable state (empty
 * schedule / `false` / `null`), not an error: this module never throws for
 * an unscheduled-but-real city, and only throws (via `getCityDef`'s
 * `UnknownRulesetIdError`) for a `cityId` that isn't in cities.json at all.
 */
import { citiesConfig } from '@/data/rulesets';
import { nextChampionshipDay } from '@/sim/calendar';
import { getCityDef } from '@/sim/city';

/**
 * cities.json's `championships.firstDay[cityId]`, or `undefined` if the
 * city never runs one. Validates `cityId` against cities.json's city list
 * first (throws `UnknownRulesetIdError` for a bogus id), so `undefined`
 * here always means "real city, no championship" — never a typo.
 */
function firstChampionshipDayOf(cityId: string): number | undefined {
  getCityDef(cityId);
  return citiesConfig().championships.firstDay[cityId];
}

/**
 * Whether `cityId` holds a championship on `day`. Always `false` for a city
 * with no `firstDay` entry.
 */
export function isChampionshipDay(cityId: string, day: number): boolean {
  const firstDay = firstChampionshipDayOf(cityId);
  if (firstDay === undefined) return false;
  return nextChampionshipDay(firstDay, day) === day;
}

/**
 * Whole days from `day` until `cityId`'s next championship (0 if `day`
 * itself is one, per `nextChampionshipDay`'s inclusive convention). `null`
 * for a city with no `firstDay` entry — there is no "next" to count down to.
 */
export function daysUntilChampionship(cityId: string, day: number): number | null {
  const firstDay = firstChampionshipDayOf(cityId);
  if (firstDay === undefined) return null;
  return nextChampionshipDay(firstDay, day) - day;
}

/**
 * The next `count` championship days for `cityId`, at or after `fromDay`,
 * in ascending order, `cadenceDays` apart. Empty for a city with no
 * `firstDay` entry, or when `count` is 0.
 */
export function scheduleFor(cityId: string, fromDay: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`scheduleFor: count must be a non-negative integer, got ${count}`);
  }
  const firstDay = firstChampionshipDayOf(cityId);
  if (firstDay === undefined || count === 0) return [];
  const cadenceDays = citiesConfig().championships.cadenceDays;
  const first = nextChampionshipDay(firstDay, fromDay);
  return Array.from({ length: count }, (_, cycle) => first + cycle * cadenceDays);
}
