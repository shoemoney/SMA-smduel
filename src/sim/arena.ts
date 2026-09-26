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
import { economy } from '@/data/rulesets';
import { computeBuild } from '@/sim/construct';
import { addPrestige, addSkill, losePrestige } from '@/sim/driver';
import { FACINGS } from '@/sim/types';
import type { DriverState, Facing, MountedWeapon, ServiceId, VehicleDesign } from '@/sim/types';
import arenasJson from '@rulesets/classic/arenas.json';

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
    state: { eventId, opponentsTotal: event.opponentCount, opponentsDefeated: 0 },
    driver: charged,
  };
}

/** Records one opponent defeated. Clamps at opponentsTotal; never goes negative or over. */
export function recordOpponentDefeated(state: ArenaMatchState): ArenaMatchState {
  if (state.opponentsDefeated >= state.opponentsTotal) return state;
  return { ...state, opponentsDefeated: state.opponentsDefeated + 1 };
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
