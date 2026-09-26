/**
 * The naming seam: the ONLY place UI code may get user-facing display text.
 *
 * `rulesets/classic/strings.json` holds every string a player sees, keyed by
 * a stable id. This module is a thin, typed reader over that table plus two
 * convenience wrappers (`facilityName`, `cityName`) that resolve through it
 * using the SAME ids `@/data/rulesets` already validates. Structural data
 * (which facilities a city has, which cities exist) stays in cities.json;
 * wording stays here. That split is what makes a future rename of the
 * game's identity a DATA SWAP in strings.json, not a source sweep across
 * every component that prints a name.
 *
 * `t()` throws on an unknown id instead of falling back to the raw id or an
 * empty string - a silent fallback is exactly how a missing string ships
 * unnoticed (see the file header on tests/unit/strings.test.ts's scanner
 * test for the companion half of this guarantee: no UI file may hardcode
 * display text outside this table in the first place).
 */
import stringsFile from '@rulesets/classic/strings.json';
import { citiesConfig, hasFacilityKind, UnknownRulesetIdError } from '@/data/rulesets';

const TABLE: Readonly<Record<string, string>> = stringsFile.strings;

/** Every id strings.json defines, as a literal union - a typo in a caller is a compile error. */
export type StringId = keyof typeof stringsFile.strings;

export type StringParams = Readonly<Record<string, string | number>>;

export class UnknownStringIdError extends Error {
  override readonly name = 'UnknownStringIdError';
  constructor(readonly id: string) {
    super(`unknown string id "${id}" - add it to rulesets/classic/strings.json instead of hardcoding text`);
  }
}

export class MissingStringParamError extends Error {
  override readonly name = 'MissingStringParamError';
  constructor(
    readonly id: string,
    readonly param: string,
  ) {
    super(`string "${id}" has a {${param}} placeholder but no such param was passed`);
  }
}

const PLACEHOLDER_RE = /\{(\w+)\}/g;

function interpolate(id: string, template: string, params: StringParams | undefined): string {
  return template.replace(PLACEHOLDER_RE, (_whole, name: string) => {
    if (params === undefined || !(name in params)) throw new MissingStringParamError(id, name);
    return String(params[name]);
  });
}

/** Look up a display string by its stable id, interpolating `{param}` placeholders from `params`. */
export function t(id: StringId, params?: StringParams): string {
  const template = TABLE[id];
  if (template === undefined) throw new UnknownStringIdError(id);
  return interpolate(id, template, params);
}

// ---------------------------------------------------------------------------
// Structural-id convenience wrappers
// ---------------------------------------------------------------------------

/** Display name for a `facilityKinds` entry (see cities.json), resolved through strings.json. */
export function facilityName(kind: string): string {
  if (!hasFacilityKind(kind)) throw new UnknownRulesetIdError('facility', kind);
  return t(`facility.${kind}` as StringId);
}

const cityIds = new Set(citiesConfig().cities.map((city) => city.id));

/** Display name for a city id (see cities.json), resolved through strings.json. */
export function cityName(id: string): string {
  if (!cityIds.has(id)) throw new UnknownRulesetIdError('city', id);
  return t(`city.${id}` as StringId);
}

// ---------------------------------------------------------------------------
// Coverage guard
// ---------------------------------------------------------------------------

export class MissingStringCoverageError extends Error {
  override readonly name = 'MissingStringCoverageError';
  constructor(readonly missingIds: readonly string[]) {
    super(
      `strings.json is missing wording for: ${missingIds.join(', ')} - ` +
        'every cities.json facilityKind and city id needs a matching "facility.<kind>" / "city.<id>" entry',
    );
  }
}

/**
 * Fails fast (at import time, like `@/data/rulesets`'s own validation) if a
 * facility kind or city id was added to cities.json without matching wording
 * ever making it into strings.json - the seam is only real if it is
 * enforced, not just documented.
 */
export function assertStringCoverage(): void {
  const missing: string[] = [];
  for (const kind of citiesConfig().facilityKinds) {
    if (TABLE[`facility.${kind}`] === undefined) missing.push(`facility.${kind}`);
  }
  for (const city of citiesConfig().cities) {
    if (TABLE[`city.${city.id}`] === undefined) missing.push(`city.${city.id}`);
  }
  if (missing.length > 0) throw new MissingStringCoverageError(missing);
}

assertStringCoverage();
