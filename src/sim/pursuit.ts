/**
 * PURSUIT subsystem (docs/SPEC.md "Campaign": "Taking the last job removes the
 * player's clone, marks them, and creates sustained pursuit including attacks
 * while resting"). This is not a new encounter engine — it is the layer that
 * sits on top of `@/sim/encounters`'s existing (seed, route, day)-deterministic
 * generation and adds exactly two things a marked driver faces that an
 * unmarked one never does:
 *
 *  1. On the road: `generateEncountersWithPursuit` calls `@/sim/encounters`'s
 *     `generateEncounters` UNCHANGED for the route's normal table, then, only
 *     while `pursuitLevel > 0`, appends a separate pack of `pursuer`-faction
 *     contacts on top of it. The base table is drawn from the exact same RNG
 *     stream `generateEncounters` already uses, so a marked and an unmarked
 *     driver on the same (seed, route, day) see IDENTICAL ordinary traffic —
 *     pursuit only ever adds, it never perturbs.
 *  2. At rest (a truck stop or hotel): `rollRestAssassinationAttempt` is a
 *     second, independent deterministic draw keyed on (seed, day, cityId), so
 *     reloading the same save on the same day never rerolls it. It reuses
 *     `rulesets/classic/encounters.json`'s own per-danger-tier `outlawChance`
 *     and `packSizeMin`/`packSizeMax` as the attempt's trigger chance and pack
 *     size — `pursuitLevel` (set once, from the campaign quest's own
 *     `onAccept.pursuitLevel`, never a literal in this file) picks WHICH
 *     danger tier's numbers apply, so a harder-earned mark draws from the
 *     same escalating table the road already uses instead of a bespoke
 *     assassination-only constant. An attempt, when it triggers, is an
 *     ordinary hostile `EncounterUnit` pack, and `resolveRestAssassinationCombat`
 *     below actually fires it at the resting driver through `@/sim/combat`'s own
 *     accuracy/damage rolls and `@/sim/damage`'s own penetration order — the
 *     SAME formulas any road contact's shot resolves through, survivable by the
 *     same means (a miss costs nothing; armor absorbs before health does),
 *     never an unconditional kill.
 *
 * `pursuer` (rulesets/classic/encounters.json's `factions[]`) is always
 * `hostile` and never `breaksOffBeyondVisualRange` — `@/sim/road`'s existing
 * `updateContactForProgress` already reads both flags generically, so a
 * pursuer contact this module hands it keeps chasing at any range the same
 * way an outlaw contact stops, with no pursuit-specific branch required
 * there.
 */
import { getFaction, dangerLevel } from '@/sim/road';
import type { DangerLevelDef } from '@/sim/road';
import {
  FRESH_ROUTE_HISTORY,
  effectiveDangerForRoute,
  generateEncounters,
  selectArchetypeForEncounter,
  type EncounterUnit,
  type RouteEncounterHistory,
} from '@/sim/encounters';
import { effectiveHitChance, rollDamage, type FireContext } from '@/sim/combat';
import { applyPenetratingDamage, type PenetratingFacing } from '@/sim/damage';
import { damageDriver } from '@/sim/driver';
import { getWeapon } from '@/data/rulesets';
import type { DriverState, RouteDef, VehicleState } from '@/sim/types';
import type { QuestState } from '@/persist/save';
import { questDefs } from '@/sim/victory';
import { createRng } from '@/util/rng';
import encountersJson from '@rulesets/classic/encounters.json';

const PURSUER_FACTION_ID = 'pursuer';

/**
 * The full set of danger ids `rulesets/classic/encounters.json`'s own
 * `dangerLevels[]` actually defines, read directly off the ruleset file
 * rather than assumed as a range literal here (`@/sim/road` already
 * validates this same file's shape at its own import time, which runs
 * before this module's — see the import above — so a malformed file would
 * already have thrown there). Used only to CLAMP an out-of-range
 * `pursuitLevel` into the table's real bounds instead of guessing a range.
 */
const KNOWN_DANGER_IDS: readonly number[] = (encountersJson as { dangerLevels: readonly { danger: number }[] }).dangerLevels.map(
  (tier) => tier.danger,
);
const MIN_KNOWN_DANGER_ID = Math.min(...KNOWN_DANGER_IDS);
const MAX_KNOWN_DANGER_ID = Math.max(...KNOWN_DANGER_IDS);

function pursuerDisposition(): EncounterUnit['disposition'] {
  // Read off the ruleset's own faction record rather than assuming "pursuer
  // is always hostile" here as a second copy of that fact — if
  // encounters.json's pursuer entry ever changed, this stays correct instead
  // of silently disagreeing with `@/sim/road`.
  return getFaction(PURSUER_FACTION_ID).hostile ? 'hostile' : 'peaceful';
}

function buildPursuerUnit(id: string, packId: string, routeMiles: number, danger: number): EncounterUnit {
  const archetype = selectArchetypeForEncounter(PURSUER_FACTION_ID, danger);
  return {
    id,
    faction: PURSUER_FACTION_ID,
    packId,
    routeMiles,
    attacked: false,
    disposition: pursuerDisposition(),
    archetypeId: archetype.id,
    design: archetype.design,
    skill: archetype.skill,
    personality: archetype.personality,
  };
}

// ---------------------------------------------------------------------------
// Road: pursuer contacts added on top of the route's normal table.
// ---------------------------------------------------------------------------

/**
 * `pursuitLevel` extra `pursuer` contacts, drawn from a stream distinct from
 * `generateEncounters`'s own `encounters|route:...|day:...` stream so adding
 * pursuit never shifts a single draw of the base table. Non-positive or
 * fractional levels round down to zero contacts (a driver who isn't marked,
 * or whose mark hasn't reached level 1 yet, adds nothing) — the SAME
 * `Math.floor` rule `rollRestAssassinationAttempt` below uses, so a
 * fractional `pursuitLevel` can never be marked on the road and simultaneously
 * hunted at rest (or vice versa).
 *
 * The archetype-selection `danger` passed to `buildPursuerUnit` is
 * `effectiveDangerForRoute` — the SAME repopulation-adjusted figure
 * `generateEncounters` itself resolves against for the base table below,
 * never the route's raw, un-adjusted `route.danger` — so a pursuer pack
 * escalates/de-escalates with the route's real current danger exactly like
 * every other faction on it.
 */
function generatePursuerContacts(
  route: RouteDef,
  day: number,
  seed: string | number,
  pursuitLevel: number,
  history: RouteEncounterHistory,
): readonly EncounterUnit[] {
  const count = Math.max(0, Math.floor(pursuitLevel));
  if (count === 0) return [];

  const danger = effectiveDangerForRoute(route, day, history);
  const rng = createRng(seed).stream(`pursuit|route:${route.id}|day:${day}`);
  const packId = `${route.id}-pursuit-${day}`;
  const contacts: EncounterUnit[] = [];
  for (let i = 0; i < count; i++) {
    const routeMiles = rng.nextFloat() * route.lengthMiles;
    contacts.push(buildPursuerUnit(`${packId}-${i}`, packId, routeMiles, danger));
  }
  return contacts;
}

/**
 * The full road encounter list for one drive down `route` on `day`: the
 * route's own normal table (`@/sim/encounters`'s `generateEncounters`,
 * called exactly as an unmarked driver would call it) plus, only while
 * `pursuitLevel > 0`, a pack of `pursuer` contacts on top. Deterministic in
 * (seed, route.id, day, history, pursuitLevel) alone.
 *
 * `pursuitLevel <= 0` returns the identical list `generateEncounters` itself
 * would — the one behavior this module's tests hold the line on: being
 * unmarked must never add contacts, and being marked must never remove or
 * reorder the ones that were already there.
 */
export function generateEncountersWithPursuit(
  route: RouteDef,
  day: number,
  seed: string | number,
  pursuitLevel: number,
  history: RouteEncounterHistory = FRESH_ROUTE_HISTORY,
): readonly EncounterUnit[] {
  const base = generateEncounters(route, day, seed, history);
  const pursuers = generatePursuerContacts(route, day, seed, pursuitLevel, history);
  return pursuers.length === 0 ? base : [...base, ...pursuers];
}

// ---------------------------------------------------------------------------
// Rest: deterministic assassination-attempt roll.
// ---------------------------------------------------------------------------

export interface RestAssassinationAttempt {
  readonly triggered: boolean;
  readonly contacts: readonly EncounterUnit[];
}

/** No attempt: the shape every non-triggering roll returns, so callers never branch on `contacts` being present vs. absent. */
const NO_ATTEMPT: RestAssassinationAttempt = { triggered: false, contacts: [] };

/**
 * The known danger id closest to `target`, CLAMPED into
 * `[MIN_KNOWN_DANGER_ID, MAX_KNOWN_DANGER_ID]` rather than searched for and
 * thrown on when not found. A `pursuitLevel` past the ruleset's highest
 * defined danger tier means "at least this dangerous" — the same
 * escalating table the road already uses, extended by clamping instead of
 * running out of table and raising — so this never throws for any finite
 * `target`, however far past the defined range (previously it threw a
 * `RangeError` for any `target` more than 64 away from every known id,
 * uncaught anywhere between here and a save-state field an editor of
 * quests.json's `onAccept.pursuitLevel` can set freely).
 */
function nearestKnownDangerId(target: number): number {
  return Math.min(MAX_KNOWN_DANGER_ID, Math.max(MIN_KNOWN_DANGER_ID, target));
}

/**
 * How many independent tier-escalation "rounds" a (floored, non-negative)
 * pursuit `level` implies at rest: one round per full (or partial) multiple
 * of `MAX_KNOWN_DANGER_ID`, so pressure keeps climbing past the ruleset's
 * highest defined danger tier instead of silently saturating there. A
 * `level` at or below `MAX_KNOWN_DANGER_ID` (today's only real data, `4`)
 * is exactly one round at that same clamped tier — byte-identical to this
 * module's pre-fix behavior for every value quests.json has ever used.
 * `level` past it rolls one MORE independent tier-`MAX_KNOWN_DANGER_ID`
 * round per full multiple past it, so a hypothetical `pursuitLevel: 8`
 * mission genuinely differs from one at `4` (roughly double the combined
 * trigger probability and total pack size) instead of the two being
 * indistinguishable, which is what "the road's contact COUNT scales
 * linearly and unbounded in `pursuitLevel` while rest saturated at the
 * table's top tier" actually meant before this fix.
 */
function restEscalationRounds(level: number): readonly number[] {
  if (MAX_KNOWN_DANGER_ID <= 0) return [nearestKnownDangerId(level)];
  const rounds: number[] = [];
  let remaining = level;
  while (remaining > 0) {
    rounds.push(nearestKnownDangerId(remaining));
    remaining -= MAX_KNOWN_DANGER_ID;
  }
  return rounds;
}

/**
 * Sleeping at a truck stop or hotel while marked (`pursuitLevel > 0`) can
 * trigger a hostile `pursuer` encounter right there in the city. Deterministic
 * in (seed, day, cityId, pursuitLevel) alone via its own dedicated RNG
 * stream(s) — reloading a save and resting the SAME day in the SAME city
 * again always reproduces the identical result (triggered or not, and the
 * identical pack if it did), never a reroll.
 *
 * `pursuitLevel` is floored (never rounded) before use — the SAME rule
 * `generatePursuerContacts` applies on the road, so a fractional level in
 * (0, 1) is unmarked in both places, never marked in one and hunted in the
 * other.
 *
 * The trigger chance and pack size for each of `restEscalationRounds`'
 * rounds are `rulesets/classic/encounters.json`'s own
 * `dangerLevels[round].outlawChance` / `packSizeMin`/`packSizeMax` — the
 * same escalating numbers the road already uses for an outlaw ambush,
 * applied here to a `pursuer` pack instead. An attempt is `triggered` the
 * moment ANY round does; its `contacts` are every triggered round's pack
 * concatenated. Every contact is an ordinary hostile `EncounterUnit`
 * (1..packSizeMax pursuer vehicles per round). This function only rolls
 * WHETHER an attempt happens and WHO shows up — the caller (a marked
 * driver's `room` action) hands `contacts` to `resolveRestAssassinationCombat`
 * below to actually fire them at the resting driver.
 *
 * `pursuitLevel <= 0` (unmarked) always returns `{ triggered: false, contacts: [] }`
 * without consuming any RNG stream at all.
 */
export function rollRestAssassinationAttempt(
  seed: string | number,
  day: number,
  cityId: string,
  pursuitLevel: number,
): RestAssassinationAttempt {
  const level = Math.max(0, Math.floor(pursuitLevel));
  if (level === 0) return NO_ATTEMPT;

  const rounds = restEscalationRounds(level);
  let triggered = false;
  const contacts: EncounterUnit[] = [];

  rounds.forEach((dangerId, roundIndex) => {
    const tier: DangerLevelDef = dangerLevel(dangerId);
    const rng = createRng(seed).stream(`pursuit-rest|city:${cityId}|day:${day}|round:${roundIndex}`);
    if (rng.nextFloat() >= tier.outlawChance) return;

    triggered = true;
    const packSize = rng.int(tier.packSizeMin, tier.packSizeMax);
    const packId = `rest-assassination-${cityId}-${day}-${roundIndex}`;
    for (let i = 0; i < packSize; i++) {
      contacts.push(buildPursuerUnit(`${packId}-${i}`, packId, 0, dangerId));
    }
  });

  return triggered ? { triggered: true, contacts } : NO_ATTEMPT;
}

/**
 * A resting driver caught by an assassination attempt (`vehicle` REAR — the
 * ambush finds a parked vehicle with its weapon-forward FRONT never brought
 * to bear, the least-defended facing `@/sim/damage`'s own penetration order
 * reaches). No vehicle at all (on foot) skips the armor/plant/cargo chain
 * entirely and hits the driver's own bodyArmor-then-naturalHealth directly
 * via `@/sim/driver`'s `damageDriver`.
 */
const AMBUSH_FACING: PenetratingFacing = 'REAR';

export interface RestAssassinationCombatResult {
  readonly driver: DriverState;
  readonly vehicle: VehicleState | null;
}

/**
 * Fires a TRIGGERED attempt's `contacts` at the resting driver for real —
 * this is the function `rollRestAssassinationAttempt`'s own doc comment
 * above promises, and the one piece that was missing before this: a marked
 * driver's `contacts` used to stop at a menu label and never reach here.
 *
 * Deliberately ONE shot per attempt, from the first `contacts` entry that
 * mounts a weapon whose `weapons.json` `damage.kind` isn't `NONE` (the same
 * test `@/sim/encounters`'s own `isCombatCapableArchetype` applies to the
 * archetype table row this contact came from) with ammo left — never one
 * shot PER contact in the pack. This is an off-screen ambush resolution with
 * zero player counter-agency (no driving away, no firing back, no picking a
 * better facing), unlike a live road encounter's multi-tick exchange;
 * resolving every one of `packSizeMax`'s (up to 5) contacts as an
 * independent guaranteed-to-fire attacker against a driver with only
 * `naturalHealthDP` (3) and no bought armor would make a triggered attempt a
 * near-certain kill regardless of the accuracy roll — exactly the
 * "unavoidable death on every rest" wall this module must never be. The
 * REST of the pack still reaches the player as a real, honest threat count
 * (`contacts.length`, surfaced by the caller's menu label) — only the
 * damage resolution itself is capped at one shot.
 *
 * Accuracy is `@/sim/combat`'s own `effectiveHitChance` (the shooter's real
 * `skill.marksmanship`, at point-blank 0m — an ambush, never a range the
 * player could have out-driven), damage is that same module's `rollDamage`,
 * both rolled on a dedicated RNG stream keyed on (seed, day, cityId) —
 * deterministic across a save reload exactly like `rollRestAssassinationAttempt`
 * itself, and never the SAME stream that function's own trigger/pack-size
 * draws already consumed. A miss (the SAME accuracy roll a live road
 * contact's shot would fail exactly as often) costs nothing.
 *
 * A hit against a `vehicle` goes through `@/sim/damage`'s own
 * `applyPenetratingDamage` (armor, then that facing's mounted weapons, then
 * plant/driver/cargo) — the identical penetration order any other road
 * contact's shot resolves through, so armor bought at this very truck stop
 * genuinely absorbs it. With no vehicle, the shot goes straight to the
 * driver via `damageDriver` (bodyArmor first, same as armor bought here).
 * Either way, a single shot can miss and a single hit rarely exhausts BOTH
 * bodyArmor and naturalHealth at once, so a triggered attempt is never an
 * unconditional casualty.
 */
export function resolveRestAssassinationCombat(
  seed: string | number,
  day: number,
  cityId: string,
  contacts: readonly EncounterUnit[],
  driver: DriverState,
  vehicle: VehicleState | null,
): RestAssassinationCombatResult {
  const shooter = contacts.find((contact) =>
    contact.design.weapons.some((weapon) => weapon.ammo > 0 && getWeapon(weapon.weaponId).damage.kind !== 'NONE'),
  );
  if (shooter === undefined) return { driver, vehicle };

  const mounted = shooter.design.weapons.find(
    (weapon) => weapon.ammo > 0 && getWeapon(weapon.weaponId).damage.kind !== 'NONE',
  );
  if (mounted === undefined) return { driver, vehicle };

  const rng = createRng(seed).stream(`pursuit-rest-combat|city:${cityId}|day:${day}`);
  const weaponDef = getWeapon(mounted.weaponId);
  const fireCtx: FireContext = {
    rng,
    marksmanshipSkill: shooter.skill.marksmanship,
    rangePenaltyPercent: 0,
    relativeMotionPenaltyPercent: 0,
    smokePenaltyPercent: 0,
    paintPenaltyPercent: 0,
  };
  const hitChance = effectiveHitChance(weaponDef, fireCtx, 0);
  if (!rng.chance(hitChance)) return { driver, vehicle };

  const damage = rollDamage(weaponDef, rng);
  if (damage <= 0) return { driver, vehicle };

  if (vehicle !== null) {
    const resolved = applyPenetratingDamage(vehicle, driver, AMBUSH_FACING, damage, rng);
    return { driver: resolved.driver, vehicle: resolved.vehicle };
  }
  return { driver: damageDriver(driver, damage).driver, vehicle: null };
}

// ---------------------------------------------------------------------------
// Campaign wiring: deriving the real pursuitLevel from save-state.
// ---------------------------------------------------------------------------

/**
 * The `onAccept.setFlag` value quests.json's marking mission sets (currently
 * `the-boss-tape`'s only) — the same string `@/ui/journal`'s own
 * `driverIsMarked` keys off, read here by name rather than by quest id so
 * ANY quest that ever sets it counts, same as that reader.
 */
const MARKED_QUEST_FLAG = 'marked';

/**
 * The campaign's current pursuit level, derived from save-state alone: the
 * highest `onAccept.pursuitLevel` (real quests.json data, `@/sim/victory`'s
 * own typed accessor — never a literal here) among every quest whose saved
 * `flags` already carries the `marked` flag that quest's own `onAccept.setFlag`
 * puts there. `0` for a driver nothing has marked yet.
 *
 * This is the one place `generatePursuerContacts`'s and
 * `rollRestAssassinationAttempt`'s `pursuitLevel` parameter is meant to come
 * from in real play — see `@/ui/buildings/truckstop`'s `room` action, the
 * production caller that reads it off `BuildingContext.quests`.
 */
export function pursuitLevelFromQuestState(quests: readonly QuestState[]): number {
  let level = 0;
  for (const state of quests) {
    if (state.flags[MARKED_QUEST_FLAG] !== true) continue;
    const def = questDefs().find((candidate) => candidate.id === state.id);
    if (def?.onAccept?.pursuitLevel !== undefined) level = Math.max(level, def.onAccept.pursuitLevel);
  }
  return level;
}
