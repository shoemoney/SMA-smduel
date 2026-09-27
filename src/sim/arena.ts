/**
 * ARENA subsystem: eligibility, rosters, and the victory / escape / forfeiture
 * / reward resolution for arena events (rulesets/classic/arenas.json).
 *
 * Every tunable number comes from rulesets/classic/arenas.json (imported
 * below as ARENAS) or from economy()/skillsConfig() through `@/data/rulesets`
 * — nothing gameplay-relevant is a literal in this file. Prestige/skill
 * mutations reuse `@/sim/driver`'s reconstruction formulas rather than
 * re-implementing them here.
 */
import Ajv from 'ajv';
import type { SchemaObject, ValidateFunction } from 'ajv';
import { economy, getBody, getWeapon, skillsConfig } from '@/data/rulesets';
import type { AIPersonality } from '@/sim/ai';
import { computeBuild } from '@/sim/construct';
import { facingForLocalDirection, rotateVec, subtractVec, vecLength, type PenetrationReport } from '@/sim/damage';
import { addPrestige, addSkill, losePrestige } from '@/sim/driver';
import { FACINGS } from '@/sim/types';
import type { DriverState, Facing, MountedWeapon, ServiceId, Vec2, VehicleDesign, VehicleState } from '@/sim/types';
import arenasJson from '@rulesets/classic/arenas.json';
import encountersJson from '@rulesets/classic/encounters.json';

// ---------------------------------------------------------------------------
// Ruleset shape (rulesets/classic/arenas.json)
// ---------------------------------------------------------------------------

export type ArenaEligibility =
  /** Own, non-destroyed vehicle; also gates on affording a named economy service (practice's $20 fee). */
  | { kind: 'own-active-vehicle-affordable'; costService: ServiceId }
  /** Entered on foot (no vehicle); eligible while under either threshold (amateur-night). */
  | { kind: 'on-foot-under-threshold'; cashBelow: number; prestigeBelow: number }
  /** Own, non-destroyed vehicle whose construction value is at or under the cap (divisions). */
  | { kind: 'own-vehicle-value-cap'; maxValue: number }
  /** Own, non-destroyed vehicle, no value cap (unlimited, city championship). */
  | { kind: 'own-vehicle-any-value' };

export type ArenaCadence =
  | { kind: 'on-demand' }
  | { kind: 'weekly' }
  | { kind: 'weekly-plus-non-championship-saturday' }
  | { kind: 'scheduled' }
  | { kind: 'city-championship-cycle' };

export type ArenaVehicleSource = 'own' | 'house';

export type ArenaEventId =
  | 'practice'
  | 'amateur-night'
  | 'division-5'
  | 'division-10'
  | 'division-15'
  | 'division-20'
  | 'unlimited'
  | 'city-championship';

export interface ArenaEventDef {
  id: ArenaEventId;
  name: string;
  eligibility: ArenaEligibility;
  opponentCount: number;
  vehicleSource: ArenaVehicleSource;
  cadence: ArenaCadence;
  cashReward: number;
  prestigeReward: number;
  /** Field names on this event whose values are tunable seeds, not documented numbers. */
  _reconstruction?: string[];
}

export interface ArenaHouseVehicle {
  id: string;
  name: string;
  bodyId: string;
  chassisId: string;
  suspensionId: string;
  plantId: string;
  tireId: string;
  armor: Record<Facing, number>;
  weapons: MountedWeapon[];
  /** Opponents plus the player's own loaner. */
  totalCount: number;
  /** House stock is never added to anyone's salvage pool, win or lose. */
  salvageable: boolean;
}

export interface ArenaReconstruction {
  escapePrestigePenalty: number;
  victorySkillGain: { driving: number; marksmanship: number };
}

interface ArenasFile {
  $schemaVersion: number;
  _note?: string;
  houseVehicle: ArenaHouseVehicle;
  events: ArenaEventDef[];
  _reconstruction: ArenaReconstruction;
}

// ---------------------------------------------------------------------------
// Runtime validation (arenas.json isn't one of the nine files @/data/schema
// already validates, so it gets its own small ajv schema here, same pattern).
// ---------------------------------------------------------------------------

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

const houseVehicleSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    bodyId: { type: 'string' },
    chassisId: { type: 'string' },
    suspensionId: { type: 'string' },
    plantId: { type: 'string' },
    tireId: { type: 'string' },
    armor: armorSchema,
    weapons: { type: 'array', items: mountedWeaponSchema },
    totalCount: { type: 'number' },
    salvageable: { type: 'boolean' },
    _note: { type: 'string' },
  },
  required: ['id', 'name', 'bodyId', 'chassisId', 'suspensionId', 'plantId', 'tireId', 'armor', 'weapons', 'totalCount', 'salvageable'],
  additionalProperties: false,
};

const eligibilitySchema: SchemaObject = {
  oneOf: [
    {
      type: 'object',
      properties: { kind: { const: 'own-active-vehicle-affordable' }, costService: { type: 'string' } },
      required: ['kind', 'costService'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'on-foot-under-threshold' },
        cashBelow: { type: 'number' },
        prestigeBelow: { type: 'number' },
      },
      required: ['kind', 'cashBelow', 'prestigeBelow'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: { const: 'own-vehicle-value-cap' }, maxValue: { type: 'number' } },
      required: ['kind', 'maxValue'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: { const: 'own-vehicle-any-value' } },
      required: ['kind'],
      additionalProperties: false,
    },
  ],
};

const cadenceSchema: SchemaObject = {
  type: 'object',
  properties: {
    kind: {
      enum: ['on-demand', 'weekly', 'weekly-plus-non-championship-saturday', 'scheduled', 'city-championship-cycle'],
    },
  },
  required: ['kind'],
  additionalProperties: false,
};

const eventSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    eligibility: eligibilitySchema,
    opponentCount: { type: 'number' },
    vehicleSource: { enum: ['own', 'house'] },
    cadence: cadenceSchema,
    cashReward: { type: 'number' },
    prestigeReward: { type: 'number' },
    _reconstruction: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'name', 'eligibility', 'opponentCount', 'vehicleSource', 'cadence', 'cashReward', 'prestigeReward'],
  additionalProperties: false,
};

const arenasSchema: SchemaObject = {
  type: 'object',
  properties: {
    $schemaVersion: { type: 'number' },
    _note: { type: 'string' },
    houseVehicle: houseVehicleSchema,
    events: { type: 'array', items: eventSchema },
    _reconstruction: {
      type: 'object',
      properties: {
        _note: { type: 'string' },
        escapePrestigePenalty: { type: 'number' },
        victorySkillGain: {
          type: 'object',
          properties: { driving: { type: 'number' }, marksmanship: { type: 'number' } },
          required: ['driving', 'marksmanship'],
          additionalProperties: false,
        },
      },
      required: ['escapePrestigePenalty', 'victorySkillGain'],
      additionalProperties: false,
    },
  },
  required: ['$schemaVersion', 'houseVehicle', 'events', '_reconstruction'],
  additionalProperties: false,
};

export class ArenaValidationError extends Error {
  override readonly name = 'ArenaValidationError';
  constructor(readonly problems: readonly string[]) {
    super(`arenas.json failed validation:\n  ${problems.join('\n  ')}`);
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validateArenasFile: ValidateFunction<ArenasFile> = ajv.compile<ArenasFile>(arenasSchema);

function parseArenas(data: unknown): ArenasFile {
  if (validateArenasFile(data)) return data;
  const problems = (validateArenasFile.errors ?? []).map((e) => {
    const path = e.instancePath === '' ? '/' : e.instancePath;
    return `arenas.json:${path} ${e.message ?? 'is invalid'}`;
  });
  throw new ArenaValidationError(problems.length > 0 ? problems : ['unknown schema error']);
}

/** Validated once at module load, same as the nine files @/data/rulesets loads. */
const ARENAS: ArenasFile = parseArenas(arenasJson);

const eventIndex: ReadonlyMap<ArenaEventId, ArenaEventDef> = new Map(ARENAS.events.map((event) => [event.id, event]));

export class UnknownArenaEventError extends Error {
  override readonly name = 'UnknownArenaEventError';
  constructor(readonly id: string) {
    super(`unknown arena event id "${id}"`);
  }
}

export function getArenaEvent(id: ArenaEventId): ArenaEventDef {
  const event = eventIndex.get(id);
  if (event === undefined) throw new UnknownArenaEventError(id);
  return event;
}

export function allArenaEvents(): readonly ArenaEventDef[] {
  return ARENAS.events;
}

export function houseVehicleDef(): ArenaHouseVehicle {
  return ARENAS.houseVehicle;
}

/** Builds the house kart as a real VehicleDesign, ready to run through `@/sim/construct`. */
export function houseKartDesign(): VehicleDesign {
  const hv = ARENAS.houseVehicle;
  return {
    name: hv.name,
    bodyId: hv.bodyId,
    chassisId: hv.chassisId,
    suspensionId: hv.suspensionId,
    plantId: hv.plantId,
    tireId: hv.tireId,
    armor: { ...hv.armor },
    weapons: hv.weapons.map((w) => ({ ...w })),
  };
}

export function isHouseVehicleSalvageable(): boolean {
  return ARENAS.houseVehicle.salvageable;
}

// ---------------------------------------------------------------------------
// Vehicle value (division caps read the constructor's own cost total)
// ---------------------------------------------------------------------------

/** The subset of vehicle state eligibility and value-cap checks need. */
export interface ArenaVehicleStatus {
  design: VehicleDesign;
  destroyed: boolean;
}

export function vehicleValue(vehicle: ArenaVehicleStatus): number {
  return computeBuild(vehicle.design).costTotal;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** Returns a human-readable refusal reason, or null when the driver is eligible. */
export function eligibilityFor(
  driver: DriverState,
  vehicle: ArenaVehicleStatus | null,
  eventId: ArenaEventId,
): string | null {
  const event = getArenaEvent(eventId);
  const elig = event.eligibility;

  switch (elig.kind) {
    case 'own-active-vehicle-affordable': {
      if (vehicle === null) return `${event.name} requires an active vehicle`;
      if (vehicle.destroyed) return `${event.name} requires an operational vehicle`;
      const price = economy().services[elig.costService].price;
      if (driver.cash < price) return `${event.name} costs $${price}, you have $${driver.cash}`;
      return null;
    }
    case 'on-foot-under-threshold': {
      if (vehicle !== null) return `${event.name} is entered on foot`;
      const eligible = driver.cash < elig.cashBelow || driver.prestige < elig.prestigeBelow;
      if (!eligible) {
        return `${event.name} requires cash under $${elig.cashBelow} or prestige under ${elig.prestigeBelow}`;
      }
      return null;
    }
    case 'own-vehicle-value-cap': {
      if (vehicle === null) return `${event.name} requires an active vehicle`;
      if (vehicle.destroyed) return `${event.name} requires an operational vehicle`;
      const value = vehicleValue(vehicle);
      if (value > elig.maxValue) return `${event.name} caps vehicle value at $${elig.maxValue} (yours is $${value})`;
      return null;
    }
    case 'own-vehicle-any-value': {
      if (vehicle === null) return `${event.name} requires an active vehicle`;
      if (vehicle.destroyed) return `${event.name} requires an operational vehicle`;
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Rosters
// ---------------------------------------------------------------------------

export interface ArenaRoster {
  eventId: ArenaEventId;
  opponentCount: number;
  vehicleSource: ArenaVehicleSource;
  /** Populated only when vehicleSource === 'house'; every opponent drives this exact design. */
  houseOpponentDesign: VehicleDesign | null;
}

export function rosterFor(eventId: ArenaEventId): ArenaRoster {
  const event = getArenaEvent(eventId);
  return {
    eventId,
    opponentCount: event.opponentCount,
    vehicleSource: event.vehicleSource,
    houseOpponentDesign: event.vehicleSource === 'house' ? houseKartDesign() : null,
  };
}

// ---------------------------------------------------------------------------
// Match state
// ---------------------------------------------------------------------------

export interface ArenaMatchState {
  eventId: ArenaEventId;
  opponentsTotal: number;
  opponentsDefeated: number;
  driverDefeatedCount: number;
}

export type BeginArenaMatchResult =
  | { ok: true; state: ArenaMatchState; driver: DriverState }
  | { ok: false; reason: string };

/**
 * Validates eligibility and, if eligible, deals the roster into a fresh
 * match state. `eligibilityFor` only checks whether the entry fee (e.g.
 * practice's arenaPractice service) is AFFORDABLE — it never moves money, so
 * this is the one place that actually charges it, exactly once, at the
 * moment the match starts. Events with no costService (everything but
 * practice) leave `driver` untouched.
 */
export function beginArenaMatch(
  driver: DriverState,
  vehicle: ArenaVehicleStatus | null,
  eventId: ArenaEventId,
): BeginArenaMatchResult {
  const reason = eligibilityFor(driver, vehicle, eventId);
  if (reason !== null) return { ok: false, reason };
  const event = getArenaEvent(eventId);

  const charged: DriverState =
    event.eligibility.kind === 'own-active-vehicle-affordable'
      ? { ...driver, cash: driver.cash - economy().services[event.eligibility.costService].price }
      : driver;

  return {
    ok: true,
    state: { eventId, opponentsTotal: event.opponentCount, opponentsDefeated: 0, driverDefeatedCount: 0 },
    driver: charged,
  };
}

/**
 * Records one opponent defeated. Clamps at opponentsTotal; never goes negative or over.
 * `driverDefeated` increments `driverDefeatedCount` past this SAME clamp guard, never at
 * the call site, so `driverDefeatedCount <= opponentsDefeated` can never drift out from
 * under a caller that forgets to check the roster is still open.
 */
export function recordOpponentDefeated(state: ArenaMatchState, driverDefeated = false): ArenaMatchState {
  if (state.opponentsDefeated >= state.opponentsTotal) return state;
  return {
    ...state,
    opponentsDefeated: state.opponentsDefeated + 1,
    driverDefeatedCount: state.driverDefeatedCount + (driverDefeated ? 1 : 0),
  };
}

/** True once every opponent in the roster (0 for practice) has been defeated. */
export function allOpponentsDefeated(state: ArenaMatchState): boolean {
  return state.opponentsDefeated >= state.opponentsTotal;
}

// ---------------------------------------------------------------------------
// Exit resolution: victory, escape, forfeiture, rewards
// ---------------------------------------------------------------------------

export type ArenaExitMode =
  /** Still in the car, driving it out under its own power. */
  | 'UNDER_POWER'
  /** Bailed out and is leaving on foot. */
  | 'ON_FOOT';

export type ArenaOutcome = 'VICTORY' | 'ESCAPE' | 'FORFEIT';

export interface ArenaResolution {
  outcome: ArenaOutcome;
  cashAwarded: number;
  prestigeDelta: number;
  /**
   * True when the PLAYER'S OWN vehicle is lost for good (on-foot exit).
   * Only meaningful for an 'own' vehicleSource event — a house-sourced event
   * (e.g. amateur-night) is entered on foot in the first place, so there is
   * never a player vehicle at stake to forfeit.
   */
  vehicleForfeited: boolean;
  /**
   * Whether the house kart driven in this event feeds the player's salvage
   * pool. Mirrors `isHouseVehicleSalvageable()` (documented as always false)
   * for a house-sourced event, and null when this event uses the player's
   * own vehicle, where the question doesn't apply.
   */
  houseVehicleSalvageable: boolean | null;
  daysConsumed: number;
  driver: DriverState;
}

function escapeResolution(
  driver: DriverState,
  outcome: ArenaOutcome,
  vehicleForfeited: boolean,
  daysConsumed: number,
  houseVehicleSalvageable: boolean | null,
): ArenaResolution {
  const penalized = losePrestige(driver, ARENAS._reconstruction.escapePrestigePenalty);
  return {
    outcome,
    cashAwarded: 0,
    prestigeDelta: penalized.prestige - driver.prestige,
    vehicleForfeited,
    houseVehicleSalvageable,
    daysConsumed,
    driver: penalized,
  };
}

/**
 * Resolves how a driver leaves an arena event.
 *
 * Victory requires BOTH every opponent defeated AND exiting under the car's
 * own power — the exit clause is the win condition, not the last kill. Any
 * exit that doesn't clear the roster is an escape (prestige penalty, car
 * kept). Exiting on foot forfeits the vehicle whenever it's the player's
 * OWN vehicle at stake (event.vehicleSource === 'own'), because "driving out
 * under its own power" is exactly what didn't happen; a house-sourced event
 * never puts a player vehicle at risk, since the roster of that event has
 * the player entering (and always leaving) on foot in the first place — the
 * loaner itself is never salvageable, win or lose (see
 * `isHouseVehicleSalvageable`/`houseVehicle.salvageable`).
 *
 * Days consumed comes from the event's own cost: a costService-gated event
 * (practice) uses that service's `days` (0), everything else uses the
 * generic `economy.timeCostDays.arenaEvent` (1) — the two are not
 * interchangeable, matching each event's own data.
 */
export function resolveArenaExit(
  state: ArenaMatchState,
  driver: DriverState,
  exitMode: ArenaExitMode,
): ArenaResolution {
  const event = getArenaEvent(state.eventId);

  const daysConsumed =
    event.eligibility.kind === 'own-active-vehicle-affordable'
      ? economy().services[event.eligibility.costService].days
      : economy().timeCostDays.arenaEvent;

  const houseVehicleSalvageable = event.vehicleSource === 'house' ? isHouseVehicleSalvageable() : null;

  if (exitMode === 'ON_FOOT') {
    const vehicleForfeited = event.vehicleSource === 'own';
    return escapeResolution(driver, 'FORFEIT', vehicleForfeited, daysConsumed, houseVehicleSalvageable);
  }

  if (!allOpponentsDefeated(state)) {
    return escapeResolution(driver, 'ESCAPE', false, daysConsumed, houseVehicleSalvageable);
  }

  const gain = ARENAS._reconstruction.victorySkillGain;
  let next = addPrestige(driver, event.prestigeReward);
  next = { ...next, cash: next.cash + event.cashReward };
  next = addSkill(next, 'driving', gain.driving);
  next = addSkill(next, 'marksmanship', gain.marksmanship);

  return {
    outcome: 'VICTORY',
    cashAwarded: event.cashReward,
    prestigeDelta: next.prestige - driver.prestige,
    vehicleForfeited: false,
    houseVehicleSalvageable,
    daysConsumed,
    driver: next,
  };
}

// ---------------------------------------------------------------------------
// Opponent archetypes (rulesets/classic/encounters.json's `archetypes[]`) —
// full, already-legal VehicleDesigns plus the skill/personality `@/sim/ai`'s
// `decideAI` needs to drive one. `@/sim/road` already validates this same
// file for its own (unrelated) road-encounter concerns and deliberately
// leaves `archetypes` untyped ("belongs to whatever builds real opponents" —
// see its own file header); this is that seam, validated here the same way
// `@/sim/arena` already validates arenas.json — its own small ajv schema,
// not a second copy of road.ts's.
// ---------------------------------------------------------------------------

export interface ArenaOpponentArchetype {
  readonly id: string;
  readonly valueBand: readonly [number, number];
  readonly design: VehicleDesign;
  readonly skill: { readonly driving: number; readonly marksmanship: number };
  /**
   * The FULL `@/sim/ai` `AIPersonality` `decideAI` needs, including `skill`
   * (its own decision-quality knob — hazard-avoidance radius, tie-break
   * sharpness). encounters.json's own `personality` object only carries
   * aggression/caution/playerThreatBias (`RawArchetypePersonality` below) —
   * it was never authored with an arena AI's decision-quality knob in mind —
   * so `skill` is derived once, at parse time, from this SAME archetype's
   * own `driving` skill normalized against `skillsConfig().skillMax`, never
   * a literal welded on here.
   */
  readonly personality: AIPersonality;
}

interface RawArchetypePersonality {
  readonly aggression: number;
  readonly caution: number;
  readonly playerThreatBias: number;
}

interface RawArenaOpponentArchetype {
  readonly id: string;
  readonly valueBand: readonly [number, number];
  readonly design: VehicleDesign;
  readonly skill: { readonly driving: number; readonly marksmanship: number };
  readonly personality: RawArchetypePersonality;
}

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
    factions: { type: 'array', items: { type: 'string' } },
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

export class ArenaArchetypeValidationError extends Error {
  override readonly name = 'ArenaArchetypeValidationError';
  constructor(readonly problems: readonly string[]) {
    super(`encounters.json archetypes failed validation:\n  ${problems.join('\n  ')}`);
  }
}

const validateArchetypes: ValidateFunction<RawArenaOpponentArchetype[]> = ajv.compile<RawArenaOpponentArchetype[]>(archetypesArraySchema);

function parseArchetypes(data: unknown): readonly RawArenaOpponentArchetype[] {
  if (validateArchetypes(data)) return data;
  const problems = (validateArchetypes.errors ?? []).map((e) => {
    const path = e.instancePath === '' ? '/' : e.instancePath;
    return `archetypes${path} ${e.message ?? 'is invalid'}`;
  });
  throw new ArenaArchetypeValidationError(problems.length > 0 ? problems : ['unknown schema error']);
}

/** Normalizes a raw `driving` skill (0..skillsConfig().skillMax) to the 0..1 `AIPersonality.skill` knob `decideAI` reads. */
function decisionSkillFromDriving(driving: number): number {
  const cfg = skillsConfig();
  const span = cfg.skillMax - cfg.skillMin;
  if (span <= 0) return 0;
  return clampNum((driving - cfg.skillMin) / span, 0, 1);
}

function toArenaOpponentArchetype(raw: RawArenaOpponentArchetype): ArenaOpponentArchetype {
  return {
    id: raw.id,
    valueBand: raw.valueBand,
    design: raw.design,
    skill: raw.skill,
    personality: {
      aggression: raw.personality.aggression,
      caution: raw.personality.caution,
      skill: decisionSkillFromDriving(raw.skill.driving),
      playerThreatBias: raw.personality.playerThreatBias,
    },
  };
}

/** Validated once at module load, same as ARENAS above. */
const ARCHETYPES: readonly ArenaOpponentArchetype[] = parseArchetypes((encountersJson as { archetypes: unknown }).archetypes).map(
  toArenaOpponentArchetype,
);

export function allArenaArchetypes(): readonly ArenaOpponentArchetype[] {
  return ARCHETYPES;
}

/**
 * Picks the archetype whose `valueBand` is the best match for `targetValue`:
 * the containing band if one exists, else the band whose nearer edge is
 * closest (ties broken by array order, so the result is a pure, deterministic
 * function of `targetValue` alone). `targetValue` for an `own`-vehicleSource
 * event is that event's `maxValue` cap (or `Infinity` for the uncapped
 * unlimited/city-championship events, which always resolves to the
 * highest-banded archetype); for a `house`-sourced event (amateur-night) it
 * is the house kart's own real construction value (`vehicleValue`) — there
 * is no player-vehicle cap to read, but the house kart's own value is a real,
 * ruleset-derived number, not a literal.
 */
/**
 * Whether an archetype can actually FIGHT: it mounts at least one weapon whose
 * weapons.json `damage.kind` is not `NONE`.
 *
 * This gate exists because it was missing. encounters.json's archetype pool is
 * shared with the ROAD, so it deliberately contains non-combatants: `beater` is
 * a civilian with no weapons at all, and `runner` is a courier whose only mount
 * is a REAR smokescreen. Selecting purely by value band handed amateur-night the
 * `runner` — so every opponent in the arena was an unarmed evasive courier that
 * behaved RETREAT every tick, the player took literally zero damage across a
 * full match, and the "victory" was uncontested. The suite was green throughout,
 * because the only assertion about player survival was `destroyed === false`,
 * which an untouched player satisfies trivially.
 *
 * Utility-only mounts (smoke, paint, oil) are exactly what `damage.kind: NONE`
 * marks in weapons.json, so this reads the rule off the data rather than listing
 * weapon ids here.
 */
export function isCombatCapableArchetype(archetype: ArenaOpponentArchetype): boolean {
  return archetype.design.weapons.some((mount) => getWeapon(mount.weaponId).damage.kind !== 'NONE');
}

/** The arena-eligible subset of `ARCHETYPES` — fighters only. */
export function arenaEligibleArchetypes(): readonly ArenaOpponentArchetype[] {
  return ARCHETYPES.filter(isCombatCapableArchetype);
}

export function selectArchetypeByValue(targetValue: number): ArenaOpponentArchetype {
  let best: ArenaOpponentArchetype | null = null;
  let bestDistance = Infinity;
  for (const archetype of arenaEligibleArchetypes()) {
    const [min, max] = archetype.valueBand;
    const distance = targetValue < min ? min - targetValue : targetValue > max ? targetValue - max : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = archetype;
    }
  }
  if (best === null) {
    throw new RangeError('arena: encounters.json has no COMBAT-CAPABLE archetypes to select from (every archetype mounts only utility weapons)');
  }
  return best;
}

/** The highest-banded archetype — every uncapped event (unlimited, city-championship). */
function highestBandedArchetype(): ArenaOpponentArchetype {
  let best: ArenaOpponentArchetype | null = null;
  // Fighters only, same reason as selectArchetypeByValue — an uncapped event
  // must not field a civilian with no weapons just because it banded highest.
  for (const archetype of arenaEligibleArchetypes()) {
    if (best === null || archetype.valueBand[1] > best.valueBand[1]) best = archetype;
  }
  if (best === null) {
    throw new RangeError('arena: encounters.json has no COMBAT-CAPABLE archetypes to select from');
  }
  return best;
}

/** The archetype an event's opponents should be built from — see `selectArchetypeByValue`. */
export function selectArchetypeForEvent(event: ArenaEventDef): ArenaOpponentArchetype {
  if (event.vehicleSource === 'house') {
    return selectArchetypeByValue(vehicleValue({ design: houseKartDesign(), destroyed: false }));
  }
  if (event.eligibility.kind === 'own-vehicle-value-cap') {
    return selectArchetypeByValue(event.eligibility.maxValue);
  }
  // own-vehicle-any-value (unlimited, city-championship): no cap to read —
  // `Infinity - max` would be `Infinity` for every band (an unbreakable tie),
  // so this is resolved directly rather than routed through
  // `selectArchetypeByValue`.
  return highestBandedArchetype();
}

// ---------------------------------------------------------------------------
// Spawn placement — an even ring around the arena's center (where the player
// starts), rotated by one draw from the match's own seeded RNG so the
// arrangement varies session to session without ever risking two opponents
// closer than `minSpawnSeparationM`: `n` points evenly spaced around a circle
// of radius `radiusM` are `2 * radiusM * sin(pi / n)` apart, which the guard
// below re-derives and checks rather than trusting by construction, and
// spacing is invariant to the rotation offset, so this is checked once, not
// per rotation.
// ---------------------------------------------------------------------------

export function computeArenaSpawnPositions(
  count: number,
  radiusM: number,
  rotationOffsetRad: number,
  minSeparationM: number,
): Vec2[] {
  if (count > 1) {
    const separationM = 2 * radiusM * Math.sin(Math.PI / count);
    if (separationM < minSeparationM) {
      throw new RangeError(
        `arena: spawn ring too small for ${count} opponents at radius ${radiusM}m — ${separationM}m apart, need ${minSeparationM}m`,
      );
    }
  }
  const positions: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rotationOffsetRad + (2 * Math.PI * i) / count;
    positions.push({ x: Math.cos(angle) * radiusM, y: Math.sin(angle) * radiusM });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Oriented-rectangle geometry (bodies.json's colliderLengthM/colliderWidthM)
// for vehicle-vs-vehicle and projectile-vs-vehicle collision. Local frame
// matches `@/sim/combat`'s own mount convention (FRONT/REAR along local Y,
// LEFT/RIGHT along local X — see its `FACING_LOCAL_UNIT` table), reached via
// the exact `rotateVec`/`subtractVec` `@/sim/damage` and `@/sim/ai` already
// use for this same rotation, not a second hand-typed transform.
// ---------------------------------------------------------------------------

export interface OrientedRect {
  readonly center: Vec2;
  readonly halfLengthM: number;
  readonly halfWidthM: number;
  readonly headingRad: number;
}

/** A vehicle's collider as an oriented rectangle, straight off its body's own `colliderLengthM`/`colliderWidthM`. */
export function vehicleOrientedRect(vehicle: VehicleState): OrientedRect {
  const body = getBody(vehicle.design.bodyId);
  return {
    center: vehicle.position,
    halfLengthM: body.colliderLengthM / 2,
    halfWidthM: body.colliderWidthM / 2,
    headingRad: vehicle.headingRad,
  };
}

function clampNum(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** True when a circle (a travelling projectile, radius `driving.json`'s `collision.projectileRadiusM`) overlaps an oriented rectangle (a vehicle's collider). */
export function circleIntersectsOrientedRect(circleCenter: Vec2, circleRadiusM: number, rect: OrientedRect): boolean {
  const local = rotateVec(subtractVec(circleCenter, rect.center), -rect.headingRad);
  const clampedX = clampNum(local.x, -rect.halfWidthM, rect.halfWidthM);
  const clampedY = clampNum(local.y, -rect.halfLengthM, rect.halfLengthM);
  const dx = local.x - clampedX;
  const dy = local.y - clampedY;
  return dx * dx + dy * dy <= circleRadiusM * circleRadiusM;
}

function rectAxes(rect: OrientedRect): readonly [Vec2, Vec2] {
  // Local +Y (FRONT/REAR) and +X (LEFT/RIGHT) rotated into world space —
  // the same rotation `vehicleOrientedRect`'s local frame is built from,
  // applied forward instead of inverted.
  const forward = rotateVec({ x: 0, y: 1 }, rect.headingRad);
  const right = rotateVec({ x: 1, y: 0 }, rect.headingRad);
  return [forward, right];
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function projectedExtent(rect: OrientedRect, axis: Vec2): number {
  const [forward, right] = rectAxes(rect);
  return rect.halfLengthM * Math.abs(dot(forward, axis)) + rect.halfWidthM * Math.abs(dot(right, axis));
}

/** True when two vehicles' oriented-rectangle colliders overlap (separating-axis test over both rects' own forward/right axes). */
export function orientedRectsOverlap(a: OrientedRect, b: OrientedRect): boolean {
  const centerDelta = subtractVec(b.center, a.center);
  const [aForward, aRight] = rectAxes(a);
  const [bForward, bRight] = rectAxes(b);
  for (const axis of [aForward, aRight, bForward, bRight]) {
    const separation = Math.abs(dot(centerDelta, axis));
    if (separation > projectedExtent(a, axis) + projectedExtent(b, axis)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Fire-target acquisition for a fixed mount: whichever LIVE vehicle is
// currently within this weapon's own facing quadrant, in range, and nearest
// — never "nearest enemy overall" (that could be behind the shooter). Reuses
// the exact `rotateVec`/`facingForLocalDirection` pair `@/sim/combat`'s
// `validateFire` and `@/sim/ai`'s private `bearingQuadrant` both already
// compose for this same test, so a shot that finds a target here is
// guaranteed to pass `validateFire`'s own bearing check against it.
// ---------------------------------------------------------------------------

export function facingQuadrant(headingRad: number, worldDelta: Vec2): Facing {
  return facingForLocalDirection(rotateVec(worldDelta, -headingRad));
}

/**
 * The nearest live, non-self vehicle in `candidates` that this `facing`
 * mount currently bears on, within `[minRangeM, rangeM]`. `null` when
 * nothing qualifies — the caller (the weapons system) still fires into empty
 * space in that case (ammo/cooldown spent, exactly like a human's missed
 * shot), it just has no real target to pre-roll a hit against.
 */
export function findBearingTarget(
  shooter: VehicleState,
  facing: Facing,
  candidates: readonly VehicleState[],
  rangeM: number,
  minRangeM: number | undefined,
): VehicleState | null {
  if (facing === 'UNDERBODY') return null;
  let best: VehicleState | null = null;
  let bestDistanceM = Infinity;
  for (const candidate of candidates) {
    if (candidate.id === shooter.id || candidate.destroyed) continue;
    const delta = subtractVec(candidate.position, shooter.position);
    const distanceM = vecLength(delta);
    if (distanceM > rangeM) continue;
    if (minRangeM !== undefined && distanceM < minRangeM) continue;
    if (facingQuadrant(shooter.headingRad, delta) !== facing) continue;
    if (distanceM < bestDistanceM) {
      bestDistanceM = distanceM;
      best = candidate;
    }
  }
  return best;
}

/**
 * Whether a resolved `applyPenetratingDamage` report means the vehicle it
 * landed on is OUT — plant destroyed (can't drive itself out any more) or
 * its driver defeated (nobody left to drive it out). Single source of truth
 * for "opponent defeated" so the arena-event screen and its tests read the
 * same rule instead of two independently-typed copies of it.
 */
export function opponentDefeatedByReport(report: PenetrationReport): boolean {
  return report.plantDestroyed || report.driverDefeated;
}
