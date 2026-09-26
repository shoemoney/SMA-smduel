/**
 * Driver subsystem: creation, skill management, prestige, health/armor, cloning,
 * mechanic lessons, and the pure reconstruction formulas that other sim modules
 * (movement, combat, salvage) read for control/hit/salvage odds.
 *
 * Every tunable number here comes from `skillsConfig()` / `economy()`
 * (rulesets/classic/skills.json, rulesets/classic/economy.json) via the
 * validated loader in `@/data/rulesets` — nothing gameplay-relevant is a
 * literal in this file.
 */
import { economy, skillsConfig } from '@/data/rulesets';
import type { DriverState, SkillName, WeaponDef } from '@/sim/types';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateDriverResult = { ok: true; driver: DriverState } | { ok: false; reason: string };

export type ReviveResult =
  | { ok: true; driver: DriverState; lostVehicleId: string | null }
  | { ok: false; reason: string };

export interface DamageResult {
  driver: DriverState;
  dead: boolean;
}

export interface LessonResult {
  driver: DriverState;
  success: boolean;
  gained: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampNum(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * name: 1..nameMaxLength chars. skills: must sum to EXACTLY startingSkillPool,
 * each within [skillMin, skillMax]. Rejects with a human-readable reason
 * instead of throwing, so callers (UI forms) can surface it directly.
 */
export function createDriver(name: string, skills: Record<SkillName, number>): CreateDriverResult {
  const cfg = skillsConfig();

  if (name.length < 1 || name.length > cfg.driver.nameMaxLength) {
    return { ok: false, reason: `name must be 1-${cfg.driver.nameMaxLength} characters` };
  }

  let sum = 0;
  for (const skillName of cfg.skills) {
    const value = skills[skillName];
    if (!Number.isInteger(value) || value < cfg.skillMin || value > cfg.skillMax) {
      return { ok: false, reason: `${skillName} must be an integer between ${cfg.skillMin} and ${cfg.skillMax}` };
    }
    sum += value;
  }
  if (sum !== cfg.startingSkillPool) {
    return { ok: false, reason: `skills must sum to exactly ${cfg.startingSkillPool} (got ${sum})` };
  }

  const initialSkills = {} as Record<SkillName, number>;
  for (const skillName of cfg.skills) initialSkills[skillName] = skills[skillName];

  return {
    ok: true,
    driver: {
      name,
      skills: initialSkills,
      naturalHealth: cfg.driver.naturalHealthDP,
      bodyArmor: 0,
      prestige: cfg.driver.prestigeFloor,
      cash: economy().startingCash,
      cityId: cfg.startingLocation,
      cloneCityId: null,
      cloneSkills: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/** Clamped read; defensive against a corrupt/deserialized driver record. */
export function getSkill(driver: DriverState, skill: SkillName): number {
  const cfg = skillsConfig();
  return clampNum(driver.skills[skill], cfg.skillMin, cfg.skillMax);
}

/** Never pushes the skill above skillMax (99), never below skillMin (0). */
export function addSkill(driver: DriverState, skill: SkillName, amount: number): DriverState {
  const cfg = skillsConfig();
  const next = clampNum(driver.skills[skill] + amount, cfg.skillMin, cfg.skillMax);
  return { ...driver, skills: { ...driver.skills, [skill]: next } };
}

// ---------------------------------------------------------------------------
// Prestige
// ---------------------------------------------------------------------------

/** Rounds to the nearest integer and enforces the same hard floor as losePrestige. */
export function addPrestige(driver: DriverState, amount: number): DriverState {
  const floor = skillsConfig().driver.prestigeFloor;
  const next = Math.max(floor, Math.round(driver.prestige + amount));
  return { ...driver, prestige: next };
}

/** Hard floor from skillsConfig().driver.prestigeFloor — never goes negative. */
export function losePrestige(driver: DriverState, amount: number): DriverState {
  const floor = skillsConfig().driver.prestigeFloor;
  return { ...driver, prestige: Math.max(floor, driver.prestige - amount) };
}

// ---------------------------------------------------------------------------
// Health & armor
// ---------------------------------------------------------------------------

/** bodyArmor absorbs damage FIRST, remainder comes off naturalHealth. */
export function damageDriver(driver: DriverState, amount: number): DamageResult {
  let remaining = amount;
  let armor = driver.bodyArmor;
  if (armor > 0 && remaining > 0) {
    const absorbed = Math.min(armor, remaining);
    armor -= absorbed;
    remaining -= absorbed;
  }
  const health = Math.max(0, driver.naturalHealth - remaining);
  const next: DriverState = { ...driver, bodyArmor: armor, naturalHealth: health };
  return { driver: next, dead: health <= 0 };
}

export function isDead(driver: DriverState): boolean {
  return driver.naturalHealth <= 0;
}

/** Buying a new suit REPLACES whatever armor remains; armor is never repaired. */
export function buyBodyArmor(driver: DriverState): DriverState {
  return { ...driver, bodyArmor: skillsConfig().driver.bodyArmorDP };
}

// ---------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------

export function createClone(driver: DriverState, cityId: string): DriverState {
  return { ...driver, cloneCityId: cityId, cloneSkills: { ...driver.skills } };
}

/** Replaces whatever snapshot was already on file. */
export function updateClone(driver: DriverState, cityId: string): DriverState {
  return createClone(driver, cityId);
}

/**
 * Restores skills from the stored snapshot, keeps current cash and prestige,
 * respawns at the clone's stored city with a fresh body (full health, no
 * armor), and consumes the snapshot. The caller's active vehicle is always
 * lost — its id is handed back so the caller can drop it from the fleet.
 *
 * Only valid on a dead driver: this is what a killed driver does instead of
 * medicalPerPoint healing/relocation (economy.json), not a free shortcut past
 * them for someone who is still alive.
 */
export function reviveFromClone(driver: DriverState, activeVehicleId: string | null): ReviveResult {
  if (!isDead(driver)) {
    return { ok: false, reason: 'driver is not dead' };
  }
  if (driver.cloneCityId === null || driver.cloneSkills === null) {
    return { ok: false, reason: 'no clone on file' };
  }
  const cfg = skillsConfig();
  return {
    ok: true,
    driver: {
      ...driver,
      skills: { ...driver.cloneSkills },
      naturalHealth: cfg.driver.naturalHealthDP,
      bodyArmor: 0,
      cityId: driver.cloneCityId,
      cloneCityId: null,
      cloneSkills: null,
    },
    lostVehicleId: activeVehicleId,
  };
}

// ---------------------------------------------------------------------------
// Mechanic lessons
// ---------------------------------------------------------------------------

/**
 * lessonGainChance = clamp(base - mechanicSkill*scale, min, max) (a 0..100
 * percentage). On success, gains a seeded randomInt(minPoints, maxPoints).
 * `rng` must be a seeded generator returning a value in [0, 1) — never
 * Math.random.
 */
export function mechanicLesson(driver: DriverState, rng: () => number): LessonResult {
  const c = skillsConfig()._reconstruction.mechanic;
  const skill = getSkill(driver, 'mechanic');
  const chance = clampNum(c.lessonGainBase - skill * c.lessonGainSkillScale, c.lessonGainMin, c.lessonGainMax);
  const succeeded = rng() * 100 < chance;
  if (!succeeded) return { driver, success: false, gained: 0 };
  const gained = randomInt(rng, c.lessonGainMinPoints, c.lessonGainMaxPoints);
  return { driver: addSkill(driver, 'mechanic', gained), success: true, gained };
}

// ---------------------------------------------------------------------------
// Reconstruction formulas (pure; read coefficients from skills.json/economy.json)
// ---------------------------------------------------------------------------

/**
 * Composite control score used by the driving sim: handling class and driving
 * skill push it up, tire condition (already resolved by the caller into a
 * signed bonus) shifts it, and turn stress beyond the configured threshold,
 * surface penalties (e.g. oil) and speed penalties (already computed by the
 * caller) pull it down. Clamped to [controlScoreMin, controlScoreMax].
 */
export function controlScore(
  hc: number,
  driving: number,
  tireBonus: number,
  turnStress: number,
  surfacePenalty: number,
  speedPenalty: number,
): number {
  const c = skillsConfig()._reconstruction.driving;
  const stressPenalty = Math.max(0, turnStress - c.turnStressThreshold);
  const raw =
    hc * c.handlingClassWeight + driving * c.drivingSkillWeight + tireBonus - stressPenalty - surfacePenalty - speedPenalty;
  return clampNum(raw, c.controlScoreMin, c.controlScoreMax);
}

/**
 * Per-weapon accuracy pivoted on marksmanship.json's skillPivot: skill above
 * the pivot raises the chance by the weapon's own skillAccuracyScale, skill
 * below it lowers it, `penalties` (range/movement/etc., already computed by
 * the caller) subtracts further. Clamped to the weapon's own [minChance,
 * maxChance].
 */
export function hitChance(weapon: WeaponDef, marksmanship: number, penalties: number): number {
  const pivot = skillsConfig()._reconstruction.marksmanship.skillPivot;
  const raw = weapon.baseAccuracy + (marksmanship - pivot) * weapon.skillAccuracyScale - penalties;
  return clampNum(raw, weapon.minChance, weapon.maxChance);
}

/**
 * Salvage odds from economy.json's reconstruction block: mechanic skill raises
 * it, a burned wreck applies a flat penalty. Clamped to [salvageChanceMin,
 * salvageChanceMax].
 */
export function salvageChance(mechanic: number, burned: boolean): number {
  const r = economy()._reconstruction;
  const raw = r.salvageBaseChance + mechanic * r.salvageMechanicScale - (burned ? r.salvageBurnPenalty : 0);
  return clampNum(raw, r.salvageChanceMin, r.salvageChanceMax);
}
