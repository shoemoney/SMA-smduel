/**
 * ROAD subsystem: real-time driving of a route between two cities (docs/SPEC.md
 * "Road"). This is not a second movement system — a road trip drives the
 * vehicle with `@/sim/driving`'s `stepDriving` exactly as the arena does, and
 * only adds the road-specific layer on top: route resolution, odometer-vs-
 * route-length arrival, danger-scaled encounter generation, contact
 * faction/disposition, and same-day/overnight persistence for wrecks and
 * road hazards (mines/spikes).
 *
 * Every tunable number is read from the ruleset, never a literal here:
 *  - `cities.json` (via `@/data/rulesets`'s `citiesConfig()`) for routes.
 *  - `driving.json` (via `drivingConfig()`) for meters-per-mile and radar
 *    visual range (outlaws breaking off beyond it).
 *  - `economy.json` (via `economy()`) for the bus service's day cost, reused
 *    below as the ruleset's only existing figure for city-to-city travel
 *    time — see `tripDays()`.
 *  - `weapons.json` (via `getWeapon()`) for a mine/spikes deployable's own
 *    `lifetimeDays`, which is exactly 1 in the current ruleset and is what
 *    "stripped overnight" is built on.
 *  - `rulesets/classic/encounters.json`, which isn't one of the ten files
 *    `@/data/schema` already validates, so it gets its own small ajv schema
 *    here — same pattern `@/sim/arena` uses for `arenas.json`.
 */
import Ajv from 'ajv';
import type { SchemaObject, ValidateFunction } from 'ajv';

import { citiesConfig, drivingConfig, economy, getWeapon } from '@/data/rulesets';
import { advanceDays, type Clock } from '@/sim/calendar';
import { stepDriving } from '@/sim/driving';
import type { DriveInput, Rng as DrivingRng, SurfaceEffect } from '@/sim/driving';
import type { Wreck, WreckGearItem, WreckWeapon } from '@/sim/economy';
import type { MineDeployable, RouteDef, SpikesDeployable, Vec2, VehicleState } from '@/sim/types';
import type { PedestrianState } from '@/sim/world';
import type { Rng } from '@/util/rng';

import encountersJson from '@rulesets/classic/encounters.json';

// ---------------------------------------------------------------------------
// Ruleset shape (rulesets/classic/encounters.json)
// ---------------------------------------------------------------------------

/** Every faction id the road can hand a contact. `pursuer` is campaign-only (docs/SPEC.md "Campaign") and never comes out of `generateRouteContacts`. */
export type FactionId = 'civilian' | 'courier' | 'arenatraveller' | 'vigilante' | 'outlaw' | 'pursuer';

const FACTION_IDS = ['civilian', 'courier', 'arenatraveller', 'vigilante', 'outlaw', 'pursuer'] as const satisfies readonly FactionId[];

/** Factions `dangerLevels[n].factionWeights` actually draws from — every id except campaign-only `pursuer`. */
const ROUTE_FACTION_IDS = ['civilian', 'courier', 'arenatraveller', 'vigilante', 'outlaw'] as const;
type RouteFactionId = (typeof ROUTE_FACTION_IDS)[number];

export interface RouteFaction {
  readonly id: FactionId;
  readonly hostile: boolean;
  readonly retaliates: boolean;
  readonly fleesAtDamageFraction: number;
  readonly hostileTo?: readonly string[];
  readonly breaksOffBeyondVisualRange?: boolean;
  readonly _note?: string;
}

export interface RouteFactionWeights {
  readonly civilian: number;
  readonly courier: number;
  readonly arenatraveller: number;
  readonly vigilante: number;
  readonly outlaw: number;
}

export interface DangerLevelDef {
  readonly danger: number;
  readonly spawnBudget: number;
  readonly spawnsPerHundredMiles: number;
  readonly outlawChance: number;
  readonly packSizeMin: number;
  readonly packSizeMax: number;
  readonly factionWeights: RouteFactionWeights;
}

export interface SalvageConfig {
  readonly wreckPersistsSameDay: boolean;
  readonly strippedOvernight: boolean;
  readonly burnedYieldsNothing: boolean;
  readonly ammoTransfersIfWeaponMatches: boolean;
}

interface EncountersFile {
  readonly $schemaVersion: number;
  readonly _note?: string;
  readonly factions: readonly RouteFaction[];
  readonly dangerLevels: readonly DangerLevelDef[];
  /** Not consumed by this module (route-danger repopulation over time is a separate concern) — validated for shape only. */
  readonly repopulation: unknown;
  /** Not consumed by this module (full AI vehicle archetypes belong to whatever builds real opponents) — validated for shape only. */
  readonly archetypes: readonly unknown[];
  readonly salvage: SalvageConfig;
  readonly _archetypeNote?: string;
}

// ---------------------------------------------------------------------------
// Runtime validation (encounters.json isn't one of the nine files @/data/schema
// already validates, so it gets its own small ajv schema, same pattern @/sim/arena uses).
// ---------------------------------------------------------------------------

const factionSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    hostile: { type: 'boolean' },
    retaliates: { type: 'boolean' },
    fleesAtDamageFraction: { type: 'number' },
    hostileTo: { type: 'array', items: { type: 'string' } },
    breaksOffBeyondVisualRange: { type: 'boolean' },
    _note: { type: 'string' },
  },
  required: ['id', 'hostile', 'retaliates', 'fleesAtDamageFraction'],
  additionalProperties: false,
};

const factionWeightsSchema: SchemaObject = {
  type: 'object',
  properties: {
    civilian: { type: 'number' },
    courier: { type: 'number' },
    arenatraveller: { type: 'number' },
    vigilante: { type: 'number' },
    outlaw: { type: 'number' },
  },
  required: ['civilian', 'courier', 'arenatraveller', 'vigilante', 'outlaw'],
  additionalProperties: false,
};

const dangerLevelSchema: SchemaObject = {
  type: 'object',
  properties: {
    danger: { type: 'number' },
    spawnBudget: { type: 'number' },
    spawnsPerHundredMiles: { type: 'number' },
    outlawChance: { type: 'number' },
    packSizeMin: { type: 'number' },
    packSizeMax: { type: 'number' },
    factionWeights: factionWeightsSchema,
  },
  required: ['danger', 'spawnBudget', 'spawnsPerHundredMiles', 'outlawChance', 'packSizeMin', 'packSizeMax', 'factionWeights'],
  additionalProperties: false,
};

const salvageSchema: SchemaObject = {
  type: 'object',
  properties: {
    _note: { type: 'string' },
    wreckPersistsSameDay: { type: 'boolean' },
    strippedOvernight: { type: 'boolean' },
    burnedYieldsNothing: { type: 'boolean' },
    ammoTransfersIfWeaponMatches: { type: 'boolean' },
  },
  required: ['wreckPersistsSameDay', 'strippedOvernight', 'burnedYieldsNothing', 'ammoTransfersIfWeaponMatches'],
  additionalProperties: false,
};

const encountersSchema: SchemaObject = {
  type: 'object',
  properties: {
    $schemaVersion: { type: 'number' },
    _note: { type: 'string' },
    factions: { type: 'array', items: factionSchema },
    dangerLevels: { type: 'array', items: dangerLevelSchema },
    repopulation: { type: 'object' },
    archetypes: { type: 'array', items: { type: 'object' } },
    salvage: salvageSchema,
    _archetypeNote: { type: 'string' },
  },
  required: ['$schemaVersion', 'factions', 'dangerLevels', 'repopulation', 'archetypes', 'salvage'],
  additionalProperties: false,
};

export class RoadRulesetValidationError extends Error {
  override readonly name = 'RoadRulesetValidationError';
  constructor(readonly problems: readonly string[]) {
    super(`encounters.json failed validation:\n  ${problems.join('\n  ')}`);
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validateEncountersFile: ValidateFunction<EncountersFile> = ajv.compile<EncountersFile>(encountersSchema);

function parseEncounters(data: unknown): EncountersFile {
  if (validateEncountersFile(data)) return data;
  const problems = (validateEncountersFile.errors ?? []).map((e) => {
    const path = e.instancePath === '' ? '/' : e.instancePath;
    return `encounters.json:${path} ${e.message ?? 'is invalid'}`;
  });
  throw new RoadRulesetValidationError(problems.length > 0 ? problems : ['unknown schema error']);
}

/** Validated once at module load, same as the ten files @/data/rulesets loads. */
const ENCOUNTERS: EncountersFile = parseEncounters(encountersJson);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const factionIndex: ReadonlyMap<FactionId, RouteFaction> = new Map(
  ENCOUNTERS.factions.map((faction) => [faction.id as FactionId, faction]),
);

export class UnknownFactionError extends Error {
  override readonly name = 'UnknownFactionError';
  constructor(readonly id: string) {
    super(`unknown road faction id "${id}"`);
  }
}

export function getFaction(id: FactionId): RouteFaction {
  const faction = factionIndex.get(id);
  if (faction === undefined) throw new UnknownFactionError(id);
  return faction;
}

export function allFactionIds(): readonly FactionId[] {
  return FACTION_IDS;
}

const dangerIndex: ReadonlyMap<number, DangerLevelDef> = new Map(ENCOUNTERS.dangerLevels.map((tier) => [tier.danger, tier]));

export class UnknownDangerLevelError extends Error {
  override readonly name = 'UnknownDangerLevelError';
  constructor(readonly danger: number) {
    super(`unknown route danger level ${danger}`);
  }
}

export function dangerLevel(danger: number): DangerLevelDef {
  const tier = dangerIndex.get(danger);
  if (tier === undefined) throw new UnknownDangerLevelError(danger);
  return tier;
}

export function salvageConfig(): SalvageConfig {
  return ENCOUNTERS.salvage;
}

// ---------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------

export class UnknownRouteError extends Error {
  override readonly name = 'UnknownRouteError';
  constructor(
    readonly fromCityId: string,
    readonly toCityId: string,
  ) {
    super(`no route between "${fromCityId}" and "${toCityId}"`);
  }
}

export interface ResolvedRoute {
  readonly route: RouteDef;
  readonly originCityId: string;
  readonly destinationCityId: string;
}

/** cities.json routes are undirected (a route between A and B carries no separate reverse row), so this matches either travel direction. */
export function resolveRoute(fromCityId: string, toCityId: string): ResolvedRoute {
  const route = citiesConfig().routes.find(
    (r) => (r.a === fromCityId && r.b === toCityId) || (r.a === toCityId && r.b === fromCityId),
  );
  if (route === undefined) throw new UnknownRouteError(fromCityId, toCityId);
  return { route, originCityId: fromCityId, destinationCityId: toCityId };
}

// ---------------------------------------------------------------------------
// Contacts: faction + disposition
// ---------------------------------------------------------------------------

/**
 * `peaceful` -> never fires (unless its faction is `hostile` to start, i.e.
 * outlaw/pursuer, which spawn `hostile` directly). `retaliating` only exists
 * because *this* contact was attacked. `fleeing` and `brokeOff` both stop
 * firing but for different reasons — the SPEC "fleesAtDamageFraction" combat
 * threshold vs. an outlaw running out of visual range.
 */
export type ContactDisposition = 'peaceful' | 'hostile' | 'retaliating' | 'fleeing' | 'brokeOff';

export interface RoadContact {
  readonly id: string;
  readonly faction: FactionId;
  /** Contacts spawned together as one outlaw pack share a packId; solo spawns are null. */
  readonly packId: string | null;
  /** Fixed position along the route, in miles from the origin city — this module is 1D (route-graph) space; 2D world placement is assigned by whatever system spawns the contact onto the map. */
  readonly routeMiles: number;
  readonly attacked: boolean;
  readonly disposition: ContactDisposition;
}

function initialDisposition(faction: RouteFaction): ContactDisposition {
  return faction.hostile ? 'hostile' : 'peaceful';
}

function weightOf(weights: RouteFactionWeights, id: RouteFactionId): number {
  return weights[id];
}

function pickFaction(weights: RouteFactionWeights, rng: Rng): RouteFactionId {
  const total = ROUTE_FACTION_IDS.reduce((sum, id) => sum + weightOf(weights, id), 0);
  if (total <= 0) {
    throw new RangeError('encounters.json: a dangerLevel\'s factionWeights must sum to more than 0');
  }
  let roll = rng.nextFloat() * total;
  for (const id of ROUTE_FACTION_IDS) {
    const weight = weightOf(weights, id);
    if (roll < weight) return id;
    roll -= weight;
  }
  // Only reachable by floating-point rounding landing exactly on `total`.
  const fallback = ROUTE_FACTION_IDS[ROUTE_FACTION_IDS.length - 1];
  if (fallback === undefined) throw new RangeError('encounters.json: no route faction ids configured');
  return fallback;
}

/**
 * The full set of contacts a drive down `route` will encounter, rolled once
 * per trip — not a per-tick spawner. `dangerLevels[route.danger]`'s
 * `spawnsPerHundredMiles` and `spawnBudget` (rulesets/classic/encounters.json)
 * decide how many contacts exist and `packSizeMin`/`packSizeMax` +
 * `factionWeights`' `outlaw` share decide how many of them are outlaws
 * running in a pack (docs/SPEC.md "Road": "Outlaws may run in packs;
 * clustered radar contacts are the warning"). `stepRoadTrip` below decides
 * only WHEN each one activates, as the odometer crosses its `routeMiles`.
 */
export function generateRouteContacts(route: RouteDef, rng: Rng): readonly RoadContact[] {
  const tier = dangerLevel(route.danger);
  const expectedSpawns = tier.spawnsPerHundredMiles * (route.lengthMiles / 100);
  const rollCount = Math.min(tier.spawnBudget, Math.round(expectedSpawns));

  const contacts: RoadContact[] = [];
  for (let i = 0; i < rollCount; i++) {
    const factionId = pickFaction(tier.factionWeights, rng);
    const faction = getFaction(factionId);
    const routeMiles = ((i + rng.nextFloat()) / rollCount) * route.lengthMiles;
    const disposition = initialDisposition(faction);

    if (factionId === 'outlaw') {
      const packSize = rng.int(tier.packSizeMin, tier.packSizeMax);
      const packId = `${route.id}-pack-${i}`;
      for (let p = 0; p < packSize; p++) {
        contacts.push({ id: `${packId}-${p}`, faction: factionId, packId, routeMiles, attacked: false, disposition });
      }
    } else {
      contacts.push({ id: `${route.id}-contact-${i}`, faction: factionId, packId: null, routeMiles, attacked: false, disposition });
    }
  }

  // `dangerLevels[n].outlawChance` is its own per-route ambush probability,
  // separate from `factionWeights.outlaw` (the ambient traffic mix rolled
  // above) — previously validated by the schema and never read anywhere,
  // making it a silent no-op knob. This is the roll that actually consumes
  // it: independently of the weighted traffic mix, a route has a
  // `outlawChance` chance of an extra outlaw pack ambushing somewhere along
  // it (SPEC "Road": "Outlaws may run in packs").
  if (rng.nextFloat() < tier.outlawChance) {
    const outlawFaction = getFaction('outlaw');
    const packSize = rng.int(tier.packSizeMin, tier.packSizeMax);
    const packId = `${route.id}-ambush-pack`;
    const routeMiles = rng.nextFloat() * route.lengthMiles;
    const disposition = initialDisposition(outlawFaction);
    for (let p = 0; p < packSize; p++) {
      contacts.push({ id: `${packId}-${p}`, faction: 'outlaw', packId, routeMiles, attacked: false, disposition });
    }
  }

  return applyFactionHostility(contacts);
}

/**
 * A `hostileTo` faction attacks the moment it shares a route with a listed
 * target faction (encounters.json's vigilante: "attacks outlaws on sight") —
 * resolved once at generation time, not per tick, since this is a
 * road-population fact rather than something the player does. Reuses
 * `attackContact`'s existing vocabulary (the `attacked` flag) instead of
 * inventing a new disposition value: a targeted contact starts the trip
 * already having been engaged by a third party, before the player arrives.
 * Previously `hostileTo` was typed and schema-validated but never consulted
 * by anything.
 */
function applyFactionHostility(contacts: readonly RoadContact[]): readonly RoadContact[] {
  const presentFactions = new Set(contacts.map((c) => c.faction));
  const targetedFactionIds = new Set<FactionId>();
  for (const factionId of presentFactions) {
    const hostileTo = getFaction(factionId).hostileTo;
    if (hostileTo === undefined) continue;
    for (const targetId of hostileTo) {
      if (presentFactions.has(targetId as FactionId)) targetedFactionIds.add(targetId as FactionId);
    }
  }
  if (targetedFactionIds.size === 0) return contacts;
  return contacts.map((contact) => (targetedFactionIds.has(contact.faction) ? attackContact(contact) : contact));
}

/**
 * Marks a contact as attacked by the player. A `retaliates` faction (every
 * faction in the current ruleset, but this stays generic) switches from
 * `peaceful` to `retaliating` — SPEC: "lawful drivers pass peacefully if
 * left alone and retaliate if attacked". A contact already `hostile`,
 * `fleeing`, or `brokeOff` keeps that disposition; only `attacked` changes.
 */
export function attackContact(contact: RoadContact): RoadContact {
  const faction = getFaction(contact.faction);
  if (contact.disposition !== 'peaceful' || !faction.retaliates) {
    return { ...contact, attacked: true };
  }
  return { ...contact, attacked: true, disposition: 'retaliating' };
}

/** True while a contact will fire at the player right now. */
export function willFire(contact: RoadContact): boolean {
  return contact.disposition === 'hostile' || contact.disposition === 'retaliating';
}

/** Applies the faction's `fleesAtDamageFraction` combat-damage threshold (SPEC "Road"/archetype personalities). Idempotent past `brokeOff`. */
export function updateContactFlight(contact: RoadContact, damageFraction: number): RoadContact {
  const faction = getFaction(contact.faction);
  if (contact.disposition === 'brokeOff' || contact.disposition === 'fleeing') return contact;
  if (damageFraction >= faction.fleesAtDamageFraction) {
    return { ...contact, disposition: 'fleeing' };
  }
  return contact;
}

/**
 * Outlaws are the only faction that `breaksOffBeyondVisualRange` (SPEC:
 * "Most break off beyond visual range"). `pursuer` explicitly does not
 * ("campaign pursuit - never gives up"), and every other faction doesn't
 * chase far enough for the question to matter.
 */
export function updateContactForProgress(contact: RoadContact, playerRouteMiles: number): RoadContact {
  const faction = getFaction(contact.faction);
  if (faction.breaksOffBeyondVisualRange !== true || contact.disposition === 'brokeOff') return contact;

  // A contact spawned farther down the route than the player has reached yet
  // is waiting, not disengaging — `brokeOff` is TERMINAL (the early return
  // above), so applying it before the player was ever close would
  // permanently silence every distant outlaw on tick one of a real trip,
  // deleting the whole hostile-encounter half of the road.
  if (playerRouteMiles < contact.routeMiles) return contact;

  const distanceM = Math.abs(playerRouteMiles - contact.routeMiles) * drivingConfig().metersPerMile;
  if (distanceM > drivingConfig().radar.visualRangeM) {
    return { ...contact, disposition: 'brokeOff' };
  }
  return contact;
}

// ---------------------------------------------------------------------------
// Wrecks and road hazards (mines/spikes) — same-day persistence, overnight strip
// ---------------------------------------------------------------------------

/**
 * Extends `@/sim/economy`'s own `Wreck` (id, burned, searched, weapons,
 * gear) rather than duplicating a structurally-incompatible shape — a
 * `RoadWreck` IS a `Wreck` plus its road position and the day it was
 * created, so it can be handed straight to `salvageRoll` (the `searched`
 * flag it carries is exactly the one that guards against a reroll, per
 * docs/SPEC.md's "a searched flag prevents save-scumming a reroll").
 */
export interface RoadWreck extends Wreck {
  readonly position: Vec2;
  readonly createdDayIndex: number;
}

export function createWreck(
  id: string,
  position: Vec2,
  dayIndex: number,
  burned: boolean,
  weapons: WreckWeapon[] = [],
  gear: WreckGearItem[] = [],
): RoadWreck {
  return { id, position, createdDayIndex: dayIndex, burned, searched: false, weapons, gear };
}

/**
 * SPEC "Road": "Wrecks persist for a same-day return and are stripped
 * overnight." Both halves read straight from encounters.json's `salvage`
 * flags rather than assuming either is true, so a ruleset that turned
 * `strippedOvernight` off would make wrecks permanent instead of silently
 * still expiring.
 */
export function isWreckPresent(wreck: RoadWreck, currentDayIndex: number): boolean {
  const salvage = ENCOUNTERS.salvage;
  if (currentDayIndex <= wreck.createdDayIndex) return salvage.wreckPersistsSameDay;
  return !salvage.strippedOvernight;
}

export function stripWrecksOvernight(wrecks: readonly RoadWreck[], currentDayIndex: number): readonly RoadWreck[] {
  return wrecks.filter((wreck) => isWreckPresent(wreck, currentDayIndex));
}

export interface RoadHazard {
  readonly id: string;
  readonly weaponId: string;
  readonly deployable: MineDeployable | SpikesDeployable;
  readonly position: Vec2;
  readonly placedDayIndex: number;
}

/** Builds a road hazard from a mine/spikes weapon id (e.g. "minedropper", "spikedropper") — throws for a weapon with no MINE/SPIKES deployable. */
export function placeRoadHazard(id: string, weaponId: string, position: Vec2, dayIndex: number): RoadHazard {
  const deployable = getWeapon(weaponId).deployable;
  if (deployable === undefined || (deployable.kind !== 'MINE' && deployable.kind !== 'SPIKES')) {
    throw new RangeError(`road hazard weapon "${weaponId}" must have a MINE or SPIKES deployable`);
  }
  return { id, weaponId, deployable, position, placedDayIndex: dayIndex };
}

/** Mines/spikes carry their own `lifetimeDays` (weapons.json) — 1 in the current ruleset, which is exactly "stripped overnight". */
export function isHazardActive(hazard: RoadHazard, currentDayIndex: number): boolean {
  return currentDayIndex - hazard.placedDayIndex < hazard.deployable.lifetimeDays;
}

export function stripExpiredHazards(hazards: readonly RoadHazard[], currentDayIndex: number): readonly RoadHazard[] {
  return hazards.filter((hazard) => isHazardActive(hazard, currentDayIndex));
}

// ---------------------------------------------------------------------------
// The road trip itself
// ---------------------------------------------------------------------------

export interface RoadTripState {
  readonly resolved: ResolvedRoute;
  readonly vehicle: VehicleState;
  /** The vehicle's world position when the trip began — the fixed origin `progressMiles` is measured from. */
  readonly startPosition: Vec2;
  /** The vehicle's heading when the trip began, frozen as the route's forward axis for the whole trip. */
  readonly routeHeadingRad: number;
  /**
   * Signed miles of PROGRESS toward the destination, measured along
   * `routeHeadingRad` — NOT the odometer, which is `Math.abs(distance)`
   * (`@/sim/driving`'s `odometerMiles`) and so treats reversing or driving
   * in circles as forward progress toward the destination gate.
   */
  readonly progressMiles: number;
  readonly clock: Clock;
  /** Fractional calendar-day carried between steps, same fractional-carry pattern as `@/sim/driving`'s `batteryDebt` — see `daysPerMile()`. */
  readonly dayDebt: number;
  readonly contacts: readonly RoadContact[];
  readonly wrecks: readonly RoadWreck[];
  readonly hazards: readonly RoadHazard[];
}

export function beginRoadTrip(resolved: ResolvedRoute, vehicle: VehicleState, clock: Clock, rng: Rng): RoadTripState {
  return {
    resolved,
    vehicle,
    startPosition: { ...vehicle.position },
    routeHeadingRad: vehicle.headingRad,
    progressMiles: 0,
    clock,
    dayDebt: 0,
    contacts: generateRouteContacts(resolved.route, rng),
    wrecks: [],
    hazards: [],
  };
}

export function milesIntoRoute(state: RoadTripState): number {
  return state.progressMiles;
}

export function hasReachedDestination(state: RoadTripState): boolean {
  return milesIntoRoute(state) >= state.resolved.route.lengthMiles;
}

/**
 * The calendar-day cost of an "average adjacent hop" (docs/SPEC.md's open
 * fidelity question "route mileages and the distance-to-calendar
 * conversion"). Reuses economy.json's `busToAdjacentCity` service days — the
 * ruleset's only existing figure for "how long does city-to-city travel
 * take" — rather than inventing a mile-to-day constant.
 */
function tripDays(): number {
  return economy().services.busToAdjacentCity.days;
}

/**
 * cities.json's own average route length — the "typical adjacent hop"
 * `tripDays()` is priced against. Derived from the ruleset's real route
 * table, never a literal, so it moves if the map's routes ever do.
 */
function referenceRouteMiles(): number {
  const routes = citiesConfig().routes;
  const total = routes.reduce((sum, r) => sum + r.lengthMiles, 0);
  if (routes.length === 0 || total <= 0) {
    throw new RangeError('cities.json: routes must be non-empty with a positive total lengthMiles to derive a road day-cost rate');
  }
  return total / routes.length;
}

/**
 * Calendar days of debt per mile actually driven. A route's total cost is
 * this rate times its OWN `lengthMiles`, so a route four times longer than
 * average costs four times as many days — not the flat `tripDays()`
 * regardless of length that shipped by scaling `tripDays()` by the FRACTION
 * of the route covered (`milesMoved / route.lengthMiles`), which always
 * integrates to exactly `tripDays()` at arrival no matter how long the route
 * is.
 */
/**
 * Exported so `@/sim/world-map`'s `travelDaysFor` prices a route by calling
 * this same rate rather than restating `tripDays()`/`referenceRouteMiles()`
 * as a second, independently-maintained formula that could silently drift
 * from this one.
 */
export function daysPerMile(): number {
  return tripDays() / referenceRouteMiles();
}

export interface RoadStepResult {
  readonly state: RoadTripState;
  readonly arrived: boolean;
  /** Whole calendar days this single step advanced (usually 0 — see `dayDebt`). */
  readonly daysAdvanced: number;
}

/**
 * One real-time tick of road travel: drives the vehicle through
 * `@/sim/driving`'s `stepDriving` (no second movement system), accumulates
 * the odometer-derived calendar-day debt, and — only on a whole-day
 * crossing, i.e. "after a significant road interval, not per tick" — closes
 * out the day and strips overnight wrecks/hazards.
 *
 * `contactDamage`, keyed by `RoadContact.id`, is this tick's cumulative
 * combat-damage fraction per contact (supplied by whatever resolves road
 * combat) — it drives `updateContactFlight`'s `fleesAtDamageFraction` check.
 * Omitted entries simply aren't updated; the default (no map) changes
 * nothing, so every existing caller keeps working unmodified.
 */
export function stepRoadTrip(
  state: RoadTripState,
  input: DriveInput,
  dtSeconds: number,
  rng: Rng,
  drivingSkill: number,
  surface: SurfaceEffect,
  contactDamage: ReadonlyMap<string, number> = new Map(),
): RoadStepResult {
  const odometerBefore = state.vehicle.odometerMiles;
  const drivingRng: DrivingRng = { next: () => rng.nextFloat() };
  const { vehicle } = stepDriving({ vehicle: state.vehicle, input, dtSeconds, rng: drivingRng, drivingSkill, surface });
  const milesMoved = vehicle.odometerMiles - odometerBefore;

  const debtGain = milesMoved * daysPerMile();
  const dayDebtRaw = state.dayDebt + debtGain;
  const daysAdvanced = Math.floor(dayDebtRaw);
  const dayDebt = dayDebtRaw - daysAdvanced;

  const clock = daysAdvanced > 0 ? advanceDays(state.clock, daysAdvanced) : state.clock;
  const wrecks = daysAdvanced > 0 ? stripWrecksOvernight(state.wrecks, clock.dayIndex) : state.wrecks;
  const hazards = daysAdvanced > 0 ? stripExpiredHazards(state.hazards, clock.dayIndex) : state.hazards;

  // Signed forward progress along the route's fixed initial-heading axis —
  // NOT the odometer, which is abs(distance) and would credit reverse or
  // circular motion as progress toward the destination gate.
  const axis: Vec2 = { x: Math.cos(state.routeHeadingRad), y: Math.sin(state.routeHeadingRad) };
  const displacement: Vec2 = { x: vehicle.position.x - state.startPosition.x, y: vehicle.position.y - state.startPosition.y };
  const progressMiles = (displacement.x * axis.x + displacement.y * axis.y) / drivingConfig().metersPerMile;

  const contacts = state.contacts
    .map((contact) => updateContactForProgress(contact, progressMiles))
    .map((contact) => {
      const damageFraction = contactDamage.get(contact.id);
      return damageFraction === undefined ? contact : updateContactFlight(contact, damageFraction);
    });

  const nextState: RoadTripState = { ...state, vehicle, clock, dayDebt, wrecks, hazards, contacts, progressMiles };
  return { state: nextState, arrived: hasReachedDestination(nextState), daysAdvanced };
}

// ---------------------------------------------------------------------------
// Gate crossing and abandonment
// ---------------------------------------------------------------------------

export interface GateCrossing {
  readonly cityId: string;
  readonly vehicle: VehicleState;
}

/** Crossing the destination gate transfers into that city (SPEC "Road"); null until the odometer actually reaches the route's lengthMiles. */
export function crossDestinationGate(state: RoadTripState): GateCrossing | null {
  if (!hasReachedDestination(state)) return null;
  return { cityId: state.resolved.destinationCityId, vehicle: state.vehicle };
}

export interface AbandonResult {
  /** The car, left behind exactly where it was — abandoning it does not delete or teleport it. */
  readonly strandedVehicle: VehicleState;
  /** The player, now on foot at the same spot. Reusing `@/sim/world`'s `PedestrianState` (no vehicle, no armor, no weapons) is what gives them "poor odds" — no separate odds multiplier is invented here. */
  readonly pedestrian: PedestrianState;
}

/** Abandoning the car leaves it on the route; the player may continue on foot (SPEC "Road"). */
export function abandonVehicle(state: RoadTripState, pedestrianId: string): AbandonResult {
  return {
    strandedVehicle: state.vehicle,
    pedestrian: {
      id: pedestrianId,
      position: { ...state.vehicle.position },
      headingRad: state.vehicle.headingRad,
      alive: true,
    },
  };
}
