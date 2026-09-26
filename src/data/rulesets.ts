/**
 * Typed ruleset loader. Imports the ten classic ruleset JSON files, validates
 * them ONCE at module load (so a malformed table fails at startup, not
 * mid-game), and exposes id lookups that throw on unknown ids.
 */
import bodiesJson from '@rulesets/classic/bodies.json';
import chassisJson from '@rulesets/classic/chassis.json';
import suspensionJson from '@rulesets/classic/suspension.json';
import plantsJson from '@rulesets/classic/plants.json';
import tiresJson from '@rulesets/classic/tires.json';
import weaponsJson from '@rulesets/classic/weapons.json';
import economyJson from '@rulesets/classic/economy.json';
import skillsJson from '@rulesets/classic/skills.json';
import drivingJson from '@rulesets/classic/driving.json';
import citiesJson from '@rulesets/classic/cities.json';

import { validateRulesets, type RawRulesetInput } from '@/data/schema';
import type {
  AccelerationTier,
  BodyDef,
  ChassisDef,
  CitiesFile,
  DrivingConfig,
  EconomyConfig,
  PlantDef,
  RearPenetrationWeights,
  Rulesets,
  SkillsConfig,
  SuspensionDef,
  TireDef,
  VehicleLimits,
  WeaponDef,
} from '@/sim/types';

export const RAW_RULESETS: RawRulesetInput = {
  bodies: bodiesJson,
  chassis: chassisJson,
  suspension: suspensionJson,
  plants: plantsJson,
  tires: tiresJson,
  weapons: weaponsJson,
  economy: economyJson,
  skills: skillsJson,
  driving: drivingJson,
  cities: citiesJson,
};

/** The validated aggregate. ES module semantics guarantee this runs exactly once. */
export const RULESETS: Rulesets = validateRulesets(RAW_RULESETS);

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export class UnknownRulesetIdError extends Error {
  override readonly name = 'UnknownRulesetIdError';
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super(`unknown ${table} id "${id}"`);
  }
}

function indexById<T extends { id: string }>(rows: readonly T[]): ReadonlyMap<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

const bodyIndex = indexById(RULESETS.bodies.bodies);
const chassisIndex = indexById(RULESETS.chassis.chassis);
const suspensionIndex = indexById(RULESETS.suspension.suspension);
const plantIndex = indexById(RULESETS.plants.plants);
const tireIndex = indexById(RULESETS.tires.tires);
const weaponIndex = indexById(RULESETS.weapons.weapons);

function lookup<T>(table: string, index: ReadonlyMap<string, T>, id: string): T {
  const row = index.get(id);
  if (row === undefined) throw new UnknownRulesetIdError(table, id);
  return row;
}

export function getBody(id: string): BodyDef {
  return lookup('body', bodyIndex, id);
}
export function getChassis(id: string): ChassisDef {
  return lookup('chassis', chassisIndex, id);
}
export function getSuspension(id: string): SuspensionDef {
  return lookup('suspension', suspensionIndex, id);
}
export function getPlant(id: string): PlantDef {
  return lookup('plant', plantIndex, id);
}
export function getTire(id: string): TireDef {
  return lookup('tire', tireIndex, id);
}
export function getWeapon(id: string): WeaponDef {
  return lookup('weapon', weaponIndex, id);
}

export function hasBody(id: string): boolean {
  return bodyIndex.has(id);
}
export function hasChassis(id: string): boolean {
  return chassisIndex.has(id);
}
export function hasSuspension(id: string): boolean {
  return suspensionIndex.has(id);
}
export function hasPlant(id: string): boolean {
  return plantIndex.has(id);
}
export function hasTire(id: string): boolean {
  return tireIndex.has(id);
}
export function hasWeapon(id: string): boolean {
  return weaponIndex.has(id);
}

export function allBodies(): readonly BodyDef[] {
  return RULESETS.bodies.bodies;
}
export function allChassis(): readonly ChassisDef[] {
  return RULESETS.chassis.chassis;
}
export function allSuspensions(): readonly SuspensionDef[] {
  return RULESETS.suspension.suspension;
}
export function allPlants(): readonly PlantDef[] {
  return RULESETS.plants.plants;
}
export function allTires(): readonly TireDef[] {
  return RULESETS.tires.tires;
}
export function allWeapons(): readonly WeaponDef[] {
  return RULESETS.weapons.weapons;
}

export function economy(): EconomyConfig {
  return RULESETS.economy;
}
export function skillsConfig(): SkillsConfig {
  return RULESETS.skills;
}
export function drivingConfig(): DrivingConfig {
  return RULESETS.driving;
}
/** REAR-facing penetration lottery weights (see `applyPenetratingDamage` in `@/sim/damage`). */
export function rearPenetrationWeights(): RearPenetrationWeights {
  return RULESETS.weapons._reconstruction.rearPenetrationWeights;
}
export function citiesConfig(): CitiesFile {
  return RULESETS.cities;
}
/** Acceleration tiers, sorted by descending powerRatio (first match wins when scanning). */
export function accelerationTiers(): readonly AccelerationTier[] {
  return RULESETS.plants.accelerationTiers;
}
/** Fixed vehicle-wide construction rules (currently just tire count). */
export function vehicleLimits(): VehicleLimits {
  return RULESETS.bodies.vehicleLimits;
}
/** Tires mounted per vehicle — every classic-ruleset design carries this many identical tires. */
export function wheelCount(): number {
  return RULESETS.bodies.vehicleLimits.wheelCount;
}

const facilityKindSet = new Set(RULESETS.cities.facilityKinds);

/** Whether `kind` is one of cities.json's authoritative `facilityKinds`. */
export function hasFacilityKind(kind: string): boolean {
  return facilityKindSet.has(kind);
}
