/**
 * CALENDAR subsystem: integer day index, DAY/NIGHT phase, time costs,
 * facility hours, and championship cadence.
 *
 * dayIndex 0 maps to skills.json's `startingDate`, read through the
 * validated ruleset loader (`@/data/rulesets`) - never a literal here. All
 * date math is done against explicit UTC timestamps (Date.UTC / getUTC*), so
 * it never depends on the host's local timezone or on the current wall-clock
 * time (no Date.now()).
 */
import { citiesConfig, economy, hasFacilityKind, skillsConfig, UnknownRulesetIdError } from '@/data/rulesets';
import type { TimeCostAction } from '@/sim/types';

// ---------------------------------------------------------------------------
// Epoch
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses and strictly validates an ISO "YYYY-MM-DD" string's Y/M/D fields. */
function parseIsoDateStrict(iso: string, context: string): { year: number; month: number; day: number } {
  const match = ISO_DATE_RE.exec(iso);
  if (match === null) {
    throw new Error(`${context}: "${iso}" is not an ISO YYYY-MM-DD date`);
  }
  const yearStr = match[1];
  const monthStr = match[2];
  const dayStr = match[3];
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    throw new Error(`${context}: "${iso}" is not an ISO YYYY-MM-DD date`);
  }
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const ms = Date.UTC(year, month - 1, day);
  const parsed = new Date(ms);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${context}: "${iso}" is not a real calendar date`);
  }
  return { year, month, day };
}

function isoDateToUtcMs(iso: string, context: string): number {
  const { year, month, day } = parseIsoDateStrict(iso, context);
  return Date.UTC(year, month - 1, day);
}

/** 00:00:00Z of skills.json's `startingDate`, in epoch milliseconds. dayIndex 0 maps here. */
const CALENDAR_EPOCH_UTC_MS = isoDateToUtcMs(skillsConfig().startingDate, 'skills.json startingDate');

/** Converts a dayIndex into the UTC Date it represents. Pure integer math. */
export function toDate(dayIndex: number): Date {
  return new Date(CALENDAR_EPOCH_UTC_MS + dayIndex * MS_PER_DAY);
}

/** Parses an ISO "YYYY-MM-DD" string into its dayIndex. */
export function fromDate(iso: string): number {
  const ms = isoDateToUtcMs(iso, 'fromDate');
  return Math.round((ms - CALENDAR_EPOCH_UTC_MS) / MS_PER_DAY);
}

/** Formats a dayIndex back to an ISO "YYYY-MM-DD" string. */
export function formatDate(dayIndex: number): string {
  const date = toDate(dayIndex);
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Clock (dayIndex + phase)
// ---------------------------------------------------------------------------

export type Phase = 'DAY' | 'NIGHT';

export interface Clock {
  readonly dayIndex: number;
  readonly phase: Phase;
}

/** A fresh clock at dayIndex 0, daytime. */
export function initialClock(): Clock {
  return { dayIndex: 0, phase: 'DAY' };
}

/**
 * Advances the clock by n whole days. Moving to a new day always opens back
 * up into DAY phase — whatever closed the previous day's daytime businesses
 * (see isFacilityOpen) no longer applies once the next day begins.
 */
export function advanceDays(clock: Clock, n: number): Clock {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`advanceDays: n must be a non-negative integer, got ${n}`);
  }
  if (n === 0) return clock;
  return { dayIndex: clock.dayIndex + n, phase: 'DAY' };
}

/**
 * Ends the current day's daytime early (NIGHT phase, same dayIndex). Used
 * after taking an action whose time cost is >= 1 day: the action consumes
 * the rest of today, so daytime-only facilities close until the next day
 * (advanceDays) begins.
 */
export function closeOutDay(clock: Clock): Clock {
  if (clock.phase === 'NIGHT') return clock;
  return { dayIndex: clock.dayIndex, phase: 'NIGHT' };
}

/**
 * Advances the clock by the time cost of an action, in whole days, applying
 * the spec rule that an action costing >= 1 day closes daytime businesses
 * until the next day begins: any FULL intervening days (days - 1) are
 * advanced normally, and the final day is then closed out (NIGHT, same
 * dayIndex) rather than opened back into DAY. A cost of 0 leaves the clock
 * untouched. Callers that charge a ruleset time cost (economy.json's
 * `timeCostDays`) against the world clock should advance it through this
 * function rather than through bare `advanceDays`, so that reaching NIGHT is
 * actually possible in play instead of only in a synthetic Clock literal.
 */
export function advanceForTimeCost(clock: Clock, days: number): Clock {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`advanceForTimeCost: days must be a non-negative integer, got ${days}`);
  }
  if (days === 0) return clock;
  return closeOutDay(advanceDays(clock, days - 1));
}

// ---------------------------------------------------------------------------
// Time costs
// ---------------------------------------------------------------------------

/** Reads an action's time cost, in whole days, from economy.json. */
export function timeCostOf(action: TimeCostAction): number {
  return economy().timeCostDays[action];
}

// ---------------------------------------------------------------------------
// Facility hours
// ---------------------------------------------------------------------------

/**
 * True when a facility of the given kind is open right now. Facilities
 * listed in economy.json's alwaysOpenFacilities never close; every other
 * facility kind is DAY-phase only.
 *
 * Throws `UnknownRulesetIdError` for a `facilityKind` that isn't one of
 * cities.json's authoritative `facilityKinds` - an unknown or typo'd kind is
 * a bug at the call site, not a fact about whether some undocumented shop
 * happens to be open.
 */
export function isFacilityOpen(facilityKind: string, clock: Clock): boolean {
  if (!hasFacilityKind(facilityKind)) {
    throw new UnknownRulesetIdError('facilityKind', facilityKind);
  }
  const { alwaysOpenFacilities } = economy();
  if (alwaysOpenFacilities.includes(facilityKind)) return true;
  return clock.phase === 'DAY';
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/** Whether a dueDay deadline has already passed as of the clock's dayIndex. */
export function isLate(dueDay: number, clock: Clock): boolean {
  return clock.dayIndex > dueDay;
}

/** How many whole days past a dueDay deadline the clock currently sits, floored at 0. */
export function daysLate(dueDay: number, clock: Clock): number {
  return Math.max(0, clock.dayIndex - dueDay);
}

// ---------------------------------------------------------------------------
// Championship cadence
// ---------------------------------------------------------------------------

/**
 * The next championship dayIndex at or after currentDay, for a city whose
 * first championship fell on firstDay and which repeats every cadenceDays
 * (from cities.json, read through the validated loader on every call) - so a
 * change to that ruleset value, or a mocked loader in a test, is honored
 * immediately with nothing cached at module load. Inclusive: if currentDay
 * already lands on a championship day, that same day is returned.
 */
export function nextChampionshipDay(firstDay: number, currentDay: number): number {
  if (currentDay <= firstDay) return firstDay;
  const cadenceDays = citiesConfig().championships.cadenceDays;
  const cyclesElapsed = Math.ceil((currentDay - firstDay) / cadenceDays);
  return firstDay + cyclesElapsed * cadenceDays;
}
