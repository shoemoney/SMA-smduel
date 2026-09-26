/**
 * ROAD ENCOUNTER generation (docs/SPEC.md "Road") — the layer on top of
 * `@/sim/road`'s per-trip `generateRouteContacts` that:
 *
 *  1. Derives the draw stream deterministically from (seed, route.id, day),
 *     so reloading a save on the same day of the same route replays the
 *     IDENTICAL contact list instead of rerolling it — `@/sim/road` itself
 *     takes a caller-supplied `Rng` and is agnostic to how that stream was
 *     derived; this module is that derivation.
 *  2. Assigns each contact a real, already-legal opponent `VehicleDesign`
 *     from `rulesets/classic/encounters.json`'s `archetypes[]`, matching
 *     BOTH the contact's faction (an outlaw contact can never draw the
 *     civilian archetype) and the route's current danger (within a faction,
 *     the toughest archetype only shows up at the top danger tier).
 *  3. Applies `repopulation` (encounters.json): a route just cleared of
 *     outlaws goes quiet for `clearedRouteQuietDays`, then its outlaw
 *     presence climbs back at `repopulationPerDay` per day; deliveries
 *     permanently shave `wellTravelledDangerReductionPerDelivery` off a
 *     route's effective danger, floored at `minEffectiveDanger`.
 *
 * `archetypes[]` is validated independently here (own small ajv schema),
 * same pattern `@/sim/arena` and `@/sim/road` each already use for their own
 * slice of this same file — `@/sim/arena`'s copy deliberately drops the
 * per-archetype `factions` list (arena rosters are picked by value band
 * alone), which is exactly the field this module needs, so it cannot reuse
 * that copy without either widening arena.ts's public type or duplicating a
 * schema anyway; a fresh, self-contained parse is the smaller change. The
 * `repopulation` block is validated here too — `@/sim/road` explicitly
 * leaves it as `unknown` ("a separate concern").
 */
import Ajv from 'ajv';
import type { SchemaObject, ValidateFunction } from 'ajv';

import { getWeapon } from '@/data/rulesets';
import {
  generateRouteContacts,
  type ContactDisposition,
  type FactionId,
  type RoadContact,
} from '@/sim/road';
import { FACINGS } from '@/sim/types';
import type { RouteDef, VehicleDesign } from '@/sim/types';
import { createRng } from '@/util/rng';

import encountersJson from '@rulesets/classic/encounters.json';

// ---------------------------------------------------------------------------
// Ruleset shape this module reads for itself: archetypes[] (with factions)
// and repopulation{}.
// ---------------------------------------------------------------------------

export interface EncounterSkill {
  readonly driving: number;
  readonly marksmanship: number;
}

export interface EncounterPersonality {
  readonly aggression: number;
  readonly caution: number;
  readonly playerThreatBias: number;
}

export interface EncounterArchetype {
  readonly id: string;
  readonly valueBand: readonly [number, number];
  readonly factions: readonly string[];
  readonly design: VehicleDesign;
  readonly skill: EncounterSkill;
  readonly personality: EncounterPersonality;
  readonly buildCost: number;
}

export interface RepopulationConfig {
  readonly clearedRouteQuietDays: number;
  readonly repopulationPerDay: number;
  readonly wellTravelledDangerReductionPerDelivery: number;
  readonly minEffectiveDanger: number;
}

const facingSchema: SchemaObject = { enum: [...FACINGS] };

const armorSchema: SchemaObject = {
  type: 'object',
  properties: Object.fromEntries(FACINGS.map((facing) => [facing, { type: 'number' }])),
  required: [...FACINGS],
  additionalProperties: false,
};

const mountedWeaponSchema: SchemaObject = {
  type: 'object',
  properties: { weaponId: { type: 'string' }, facing: facingSchema, ammo: { type: 'number' } },
  required: ['weaponId', 'facing', 'ammo'],
  additionalProperties: false,
};

const vehicleDesignSchema: SchemaObject = {
  type: 'object',
  properties: {
    bodyId: { type: 'string' },
    chassisId: { type: 'string' },
    suspensionId: { type: 'string' },
    plantId: { type: 'string' },
    tireId: { type: 'string' },
    armor: armorSchema,
    weapons: { type: 'array', items: mountedWeaponSchema },
  },
  required: ['bodyId', 'chassisId', 'suspensionId', 'plantId', 'tireId', 'armor', 'weapons'],
  additionalProperties: false,
};

const archetypeSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    valueBand: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    factions: { type: 'array', items: { type: 'string' }, minItems: 1 },
    design: vehicleDesignSchema,
    skill: {
      type: 'object',
      properties: { driving: { type: 'number' }, marksmanship: { type: 'number' } },
      required: ['driving', 'marksmanship'],
      additionalProperties: false,
    },
    personality: {
      type: 'object',
      properties: {
        aggression: { type: 'number' },
        caution: { type: 'number' },
        playerThreatBias: { type: 'number' },
      },
      required: ['aggression', 'caution', 'playerThreatBias'],
      additionalProperties: false,
    },
    buildCost: { type: 'number' },
  },
  required: ['id', 'valueBand', 'factions', 'design', 'skill', 'personality', 'buildCost'],
  additionalProperties: false,
};

const archetypesArraySchema: SchemaObject = { type: 'array', items: archetypeSchema, minItems: 1 };

const repopulationSchema: SchemaObject = {
  type: 'object',
  properties: {
    _note: { type: 'string' },
    clearedRouteQuietDays: { type: 'number' },
    repopulationPerDay: { type: 'number' },
    wellTravelledDangerReductionPerDelivery: { type: 'number' },
    minEffectiveDanger: { type: 'number' },
  },
  required: [
    'clearedRouteQuietDays',
    'repopulationPerDay',
    'wellTravelledDangerReductionPerDelivery',
    'minEffectiveDanger',
  ],
  additionalProperties: false,
};

export class EncounterRulesetValidationError extends Error {
  override readonly name = 'EncounterRulesetValidationError';
  constructor(readonly problems: readonly string[]) {
    super(`encounters.json failed validation:\n  ${problems.join('\n  ')}`);
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validateArchetypes: ValidateFunction<EncounterArchetype[]> = ajv.compile<EncounterArchetype[]>(archetypesArraySchema);
const validateRepopulation: ValidateFunction<RepopulationConfig> = ajv.compile<RepopulationConfig>(repopulationSchema);

function parse<T>(validate: ValidateFunction<T>, data: unknown, label: string): T {
  if (validate(data)) return data;
  const problems = (validate.errors ?? []).map((e) => {
    const path = e.instancePath === '' ? '/' : e.instancePath;
    return `${label}${path} ${e.message ?? 'is invalid'}`;
  });
  throw new EncounterRulesetValidationError(problems.length > 0 ? problems : ['unknown schema error']);
}

/** Validated once at module load, same pattern `@/sim/arena` and `@/sim/road` each already use for this file. */
const ARCHETYPES: readonly EncounterArchetype[] = parse(
  validateArchetypes,
  (encountersJson as { archetypes: unknown }).archetypes,
  'archetypes',
);

const REPOPULATION: RepopulationConfig = parse(
  validateRepopulation,
  (encountersJson as { repopulation: unknown }).repopulation,
  'repopulation',
);

/**
 * The full set of `dangerLevels[].danger` ids the ruleset defines, read
 * straight off the same JSON import `@/sim/road` already validates in full
 * at its own module load (this file imports `@/sim/road`, so that
 * validation has already run by the time this executes) — reading it again
 * here would be a second copy of `@/sim/road`'s `dangerLevelSchema`, so this
 * only pulls the one field (`danger`) it needs.
 */
const DANGER_IDS: readonly number[] = [
  ...new Set((encountersJson as { dangerLevels: ReadonlyArray<{ danger: number }> }).dangerLevels.map((tier) => tier.danger)),
].sort((a, b) => a - b);

if (DANGER_IDS.length === 0) {
  throw new RangeError('encounters.json: dangerLevels must be non-empty');
}

export function allEncounterArchetypes(): readonly EncounterArchetype[] {
  return ARCHETYPES;
}

export function repopulationConfig(): RepopulationConfig {
  return REPOPULATION;
}

// ---------------------------------------------------------------------------
// Archetype selection — respects BOTH the contact's faction and the route's
// (effective) danger level.
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The nearest danger id encounters.json actually defines to a (possibly fractional) target. */
function nearestAvailableDanger(target: number): number {
  let best = DANGER_IDS[0] as number;
  let bestDistance = Infinity;
  for (const id of DANGER_IDS) {
    const distance = Math.abs(id - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }
  return best;
}

/** `archetype.factions[]` (encounters.json) as raw strings; road contacts only ever carry `RouteFactionId`s, so a straight `.includes` is enough. */
function archetypesForFaction(factionId: FactionId): readonly EncounterArchetype[] {
  return ARCHETYPES.filter((archetype) => archetype.factions.includes(factionId)).slice().sort((a, b) => a.valueBand[0] - b.valueBand[0]);
}

export class NoArchetypeForFactionError extends Error {
  override readonly name = 'NoArchetypeForFactionError';
  constructor(readonly factionId: string) {
    super(`encounters.json has no archetype whose factions[] includes "${factionId}"`);
  }
}

/**
 * Picks the archetype for `factionId` whose position in that faction's own
 * value-ordered roster matches how far `danger` sits between the ruleset's
 * lowest and highest defined danger id — e.g. outlaw's roster (roadthug,
 * raider, warwagon, ascending value) resolves to roadthug at the bottom
 * danger tiers and warwagon at the top, with raider in between; a faction
 * with only one archetype (civilian/courier/vigilante in the current
 * ruleset) always resolves to that one archetype regardless of danger.
 *
 * Buckets `danger`'s fractional position into one of `pool.length` equal-
 * width slices (`index = min(pool.length - 1, floor(fraction * pool.length))`)
 * rather than rounding to the NEAREST pool index. Rounding-to-nearest snaps
 * roughly half the danger range to the two ENDPOINT archetypes and leaves
 * only a sliver in between for everything else — with this ruleset's 5
 * danger ids and 3 outlaw archetypes that put the bottom archetype
 * (roadthug) at the one danger tier (0) whose `factionWeights.outlaw` the
 * ruleset sets to 0, so it could never actually spawn in play while the top
 * archetype (warwagon) became the default on more than half the map's
 * routes. Equal-width bucketing instead gives every archetype in the pool a
 * genuine, non-degenerate slice of the danger range.
 */
export function selectArchetypeForEncounter(factionId: FactionId, danger: number): EncounterArchetype {
  const pool = archetypesForFaction(factionId);
  const first = pool[0];
  if (first === undefined) throw new NoArchetypeForFactionError(factionId);
  if (pool.length === 1) return first;

  const minDanger = DANGER_IDS[0] as number;
  const maxDanger = DANGER_IDS[DANGER_IDS.length - 1] as number;
  const span = maxDanger - minDanger;
  const fraction = span <= 0 ? 0 : clamp((danger - minDanger) / span, 0, 1);
  const index = Math.min(pool.length - 1, Math.floor(fraction * pool.length));
  return pool[index] as EncounterArchetype;
}

// ---------------------------------------------------------------------------
// Repopulation: effective danger for a route on a given calendar day.
// ---------------------------------------------------------------------------

/**
 * Per-route, per-driver progress that feeds repopulation: the day the route
 * was last fully cleared of outlaws (null if it never has been) and how
 * many deliveries have been completed on it. Deliberately its own small
 * shape rather than a field bolted onto `@/sim/types`'s `DriverState` — a
 * per-ROUTE count doesn't belong on a single driver-wide record, and this
 * module doesn't own that type anyway.
 */
export interface RouteEncounterHistory {
  readonly routeClearedOnDayIndex: number | null;
  readonly deliveriesCompleted: number;
}

/** A route nobody has ever driven or cleared: full base danger, no repopulation discount. */
export const FRESH_ROUTE_HISTORY: RouteEncounterHistory = {
  routeClearedOnDayIndex: null,
  deliveriesCompleted: 0,
};

/** `deliveriesCompleted` in `history` bumped by one delivery — never mutates `history`. */
export function recordDelivery(history: RouteEncounterHistory): RouteEncounterHistory {
  return { ...history, deliveriesCompleted: history.deliveriesCompleted + 1 };
}

/** The route just had every outlaw on it defeated on `dayIndex` — starts (or restarts) the quiet/repopulation clock. */
export function recordRouteCleared(history: RouteEncounterHistory, dayIndex: number): RouteEncounterHistory {
  return { ...history, routeClearedOnDayIndex: dayIndex };
}

/**
 * `route.danger` after repopulation.json's two effects:
 *
 *  - deliveries permanently shave `wellTravelledDangerReductionPerDelivery`
 *    off the base danger, floored at `minEffectiveDanger`;
 *  - clearing the route suppresses danger to `minEffectiveDanger` for
 *    `clearedRouteQuietDays`, then that suppression fades at
 *    `repopulationPerDay` per day past the quiet window (so it takes
 *    `1 / repopulationPerDay` more days to fully repopulate back to the
 *    delivery-adjusted base) — never below `minEffectiveDanger` and never
 *    above the delivery-adjusted base.
 *
 * The result is a real number (`generateEncounters` rounds it to the
 * nearest danger id encounters.json actually defines) so a partial recovery
 * genuinely sits BETWEEN two tiers rather than snapping early.
 */
export function effectiveDangerForRoute(route: RouteDef, day: number, history: RouteEncounterHistory): number {
  const repop = REPOPULATION;
  const deliveryAdjusted = Math.max(
    repop.minEffectiveDanger,
    route.danger - history.deliveriesCompleted * repop.wellTravelledDangerReductionPerDelivery,
  );

  if (history.routeClearedOnDayIndex === null) return deliveryAdjusted;

  const daysSinceCleared = day - history.routeClearedOnDayIndex;
  if (daysSinceCleared < 0) return deliveryAdjusted; // a query for a day before the clear happened: nothing to suppress yet

  // `recoveryDays` is already 0 for the entire quiet window (`daysSinceCleared
  // - clearedRouteQuietDays` clamped up to 0 by the Math.max above), which
  // already makes `recoveredFraction` 0 and `suppressionFraction` 1 for that
  // whole window on its own — a separate `daysSinceCleared < clearedRouteQuietDays
  // ? 1 : ...` branch here was dead weight computing the same value a second,
  // easier-to-desync way (see docs on the quiet-window test in
  // tests/unit/encounters.test.ts for the mutation that exposed it).
  const recoveryDays = Math.max(0, daysSinceCleared - repop.clearedRouteQuietDays);
  const recoveredFraction = repop.repopulationPerDay > 0 ? clamp(recoveryDays * repop.repopulationPerDay, 0, 1) : recoveryDays > 0 ? 1 : 0;
  const suppressionFraction = 1 - recoveredFraction;

  return deliveryAdjusted - (deliveryAdjusted - repop.minEffectiveDanger) * suppressionFraction;
}

// ---------------------------------------------------------------------------
// generateEncounters
// ---------------------------------------------------------------------------

/**
 * A road contact plus the real, legal opponent build it fields — everything
 * `@/sim/road`'s own `RoadContact` already carries (id, faction, packId,
 * routeMiles, attacked, disposition — so `@/sim/road`'s `attackContact` /
 * `willFire` / `updateContactFlight` / `updateContactForProgress` all work
 * on this unchanged) plus the archetype assigned to it.
 */
export interface EncounterUnit extends RoadContact {
  readonly archetypeId: string;
  readonly design: VehicleDesign;
  readonly skill: EncounterSkill;
  readonly personality: EncounterPersonality;
}

function toEncounterUnit(contact: RoadContact, danger: number): EncounterUnit {
  const archetype = selectArchetypeForEncounter(contact.faction, danger);
  return {
    ...contact,
    archetypeId: archetype.id,
    design: archetype.design,
    skill: archetype.skill,
    personality: archetype.personality,
  };
}

/**
 * The full set of road encounters for one drive down `route` on calendar
 * `day`, deterministic in (seed, route.id, day) alone: reloading a save and
 * re-requesting the SAME route on the SAME day, with the SAME `history`,
 * reproduces the identical contact list, faction mix, pack groupings, and
 * archetype assignments bit-for-bit — nothing here depends on wall-clock
 * time, prior draws, or call order. `history` (this driver's repopulation
 * progress on this route) is the one input that legitimately changes the
 * output across two calls with the same seed/route/day, and it does so
 * exactly by shifting the effective danger tier `@/sim/road`'s own
 * `generateRouteContacts` generates against — the contact-generation rules
 * themselves (faction weights, pack sizes, disposition, hostileTo) are
 * `@/sim/road`'s, reused here rather than re-implemented.
 */
export function generateEncounters(
  route: RouteDef,
  day: number,
  seed: string | number,
  history: RouteEncounterHistory = FRESH_ROUTE_HISTORY,
): readonly EncounterUnit[] {
  const danger = nearestAvailableDanger(effectiveDangerForRoute(route, day, history));
  const generationRoute: RouteDef = { ...route, danger };
  const rng = createRng(seed).stream(`encounters|route:${route.id}|day:${day}`);
  const contacts = generateRouteContacts(generationRoute, rng);
  return contacts.map((contact) => toEncounterUnit(contact, danger));
}

/** True while `archetype` mounts at least one weapon whose `weapons.json` `damage.kind` is not `NONE` — mirrors `@/sim/arena`'s `isCombatCapableArchetype` (kept separate: that module filters ITS OWN typed archetype list, this one filters this module's). */
export function isCombatCapableArchetype(archetype: EncounterArchetype): boolean {
  return archetype.design.weapons.some((mount) => getWeapon(mount.weaponId).damage.kind !== 'NONE');
}

export type { ContactDisposition, FactionId, RoadContact };
