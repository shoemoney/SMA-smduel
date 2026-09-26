/**
 * `@/sim/pursuit` is the "sustained pursuit" layer on top of
 * `@/sim/encounters` (road) and `@/sim/road` (faction rules) that a marked
 * driver — docs/SPEC.md "Campaign": "Taking the last job ... marks them, and
 * creates sustained pursuit including attacks while resting" — faces and an
 * unmarked one never does. This suite proves the ADDED layer only:
 *
 *  - road generation gains pursuer contacts strictly ON TOP of the existing
 *    table, scaled by pursuitLevel, without perturbing that existing table;
 *  - a pursuer contact this module builds behaves like the ruleset says a
 *    pursuer should (never breaks off) where an outlaw contact from the SAME
 *    underlying generation does not;
 *  - the rest-time assassination roll is a genuine coin flip deterministic
 *    per (seed, day, cityId) - not "never" and not "every single rest";
 *  - a TRIGGERED attempt's contacts actually fire at the resting driver
 *    (`resolveRestAssassinationCombat`) through the real accuracy/damage/
 *    penetration formulas - real health/armor/vehicle risk, not a text
 *    notice with zero game effect, and never an unconditional casualty.
 *
 * `@/sim/road`'s own suite already proves faction weighting/packs/
 * disposition/hostileTo; `@/sim/encounters`'s own suite already proves the
 * base table's determinism and archetype assignment. Neither is re-proven
 * here.
 */
import { describe, expect, it } from 'vitest';

import { dangerLevel, getFaction, updateContactForProgress, willFire } from '@/sim/road';
import { drivingConfig, skillsConfig } from '@/data/rulesets';
import { FRESH_ROUTE_HISTORY, generateEncounters, selectArchetypeForEncounter, type EncounterUnit } from '@/sim/encounters';
import {
  generateEncountersWithPursuit,
  pursuitLevelFromQuestState,
  resolveRestAssassinationCombat,
  rollRestAssassinationAttempt,
} from '@/sim/pursuit';
import { createDriver } from '@/sim/driver';
import { questDefs } from '@/sim/victory';
import type { DriverState, RouteDef, SkillName, VehicleDesign, VehicleState } from '@/sim/types';
import { PLAYER_ID, vehicleStateFromDesign } from '@/app';

function route(overrides: Partial<RouteDef> = {}): RouteDef {
  return { id: 'test-route', a: 'city-a', b: 'city-b', lengthMiles: 300, danger: 2, ...overrides };
}

// ---------------------------------------------------------------------------
// Fixtures for resolveRestAssassinationCombat: a real driver and a real
// (unarmed, unarmored, so the combat resolution itself is what's on trial -
// not this fixture's own defenses) vehicle, plus a single real `pursuer`
// contact built off the ruleset's own archetype table exactly the way
// `@/sim/pursuit`'s own `buildPursuerUnit` does.
// ---------------------------------------------------------------------------

function evenSkillSplit(): Record<SkillName, number> {
  const cfg = skillsConfig();
  const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
  const remainder = cfg.startingSkillPool - base * cfg.skills.length;
  const skills = {} as Record<SkillName, number>;
  cfg.skills.forEach((name, index) => {
    skills[name] = base + (index === cfg.skills.length - 1 ? remainder : 0);
  });
  return skills;
}

function makeDriver(overrides: Partial<DriverState> = {}): DriverState {
  const result = createDriver('PursuitTest', evenSkillSplit());
  if (!result.ok) throw new Error(`fixture: expected a legal skill split, got "${result.reason}"`);
  return { ...result.driver, ...overrides };
}

const UNARMED_UNARMORED_DESIGN: VehicleDesign = {
  name: 'Pursuit Test Rig',
  bodyId: 'subcompact',
  chassisId: 'standard',
  suspensionId: 'light',
  plantId: 'small',
  tireId: 'standard',
  armor: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
  weapons: [],
};

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return { ...vehicleStateFromDesign(UNARMED_UNARMORED_DESIGN, 'veh-pursuit-test', PLAYER_ID), ...overrides };
}

/** One real `pursuer` contact, built off the ruleset's own archetype table exactly like `@/sim/pursuit`'s own (unexported) `buildPursuerUnit`. */
function singlePursuerContact(id = 'test-pursuer'): EncounterUnit {
  const archetype = selectArchetypeForEncounter('pursuer', 4);
  return {
    id,
    faction: 'pursuer',
    packId: 'test-pack',
    routeMiles: 0,
    attacked: false,
    disposition: 'hostile',
    archetypeId: archetype.id,
    design: archetype.design,
    skill: archetype.skill,
    personality: archetype.personality,
  };
}

/** Empirical trigger rate of `rollRestAssassinationAttempt` over `trials` distinct days, one independent (seed, day, cityId, pursuitLevel) draw per day. */
function empiricalRestTriggerRate(seed: string, cityId: string, pursuitLevel: number, trials: number): number {
  let triggers = 0;
  for (let day = 0; day < trials; day++) {
    if (rollRestAssassinationAttempt(seed, day, cityId, pursuitLevel).triggered) triggers++;
  }
  return triggers / trials;
}

// ---------------------------------------------------------------------------
// Road: pursuit adds on top; it never touches the base table.
// ---------------------------------------------------------------------------

describe('generateEncountersWithPursuit: additive, never rewrites the base table', () => {
  it('an unmarked driver (pursuitLevel 0) generates zero pursuer contacts on a route/seed/day where a marked driver generates some', () => {
    const r = route({ danger: 3, lengthMiles: 400 });
    const unmarked = generateEncountersWithPursuit(r, 12, 'pursuit-seed-1', 0, FRESH_ROUTE_HISTORY);
    const marked = generateEncountersWithPursuit(r, 12, 'pursuit-seed-1', 4, FRESH_ROUTE_HISTORY);

    expect(unmarked.some((c) => c.faction === 'pursuer')).toBe(false);
    const pursuerContacts = marked.filter((c) => c.faction === 'pursuer');
    expect(pursuerContacts.length).toBeGreaterThan(0);
  });

  it('being marked adds contacts on top of the base table without changing the base table itself', () => {
    const r = route({ danger: 3, lengthMiles: 400 });
    const base = generateEncounters(r, 12, 'pursuit-seed-1', FRESH_ROUTE_HISTORY);
    const withPursuit = generateEncountersWithPursuit(r, 12, 'pursuit-seed-1', 4, FRESH_ROUTE_HISTORY);

    // The base portion is untouched: same length, same contacts, same order.
    expect(withPursuit.slice(0, base.length)).toEqual(base);
    // And pursuit only ever appends.
    expect(withPursuit.length).toBe(base.length + withPursuit.filter((c) => c.faction === 'pursuer').length);
  });

  it('pursuit contacts scale with pursuitLevel', () => {
    const r = route({ danger: 2, lengthMiles: 400 });
    const low = generateEncountersWithPursuit(r, 8, 'pursuit-scale-seed', 1, FRESH_ROUTE_HISTORY);
    const high = generateEncountersWithPursuit(r, 8, 'pursuit-scale-seed', 4, FRESH_ROUTE_HISTORY);

    const lowCount = low.filter((c) => c.faction === 'pursuer').length;
    const highCount = high.filter((c) => c.faction === 'pursuer').length;
    expect(lowCount).toBe(1);
    expect(highCount).toBe(4);
    expect(highCount).toBeGreaterThan(lowCount);
  });

});

// ---------------------------------------------------------------------------
// A pursuer never breaks off beyond visual range; an outlaw does.
// ---------------------------------------------------------------------------

describe('pursuer contacts never break off beyond visual range, unlike outlaws', () => {
  it('a pursuer contact built by generateEncountersWithPursuit stays hostile far beyond radar range; an outlaw from the same base table breaks off', () => {
    const r = route({ danger: 4, lengthMiles: 500 }); // highest outlaw weight, to find one quickly
    let outlaw: ReturnType<typeof generateEncounters>[number] | undefined;
    let day = 0;
    for (; day < 100; day++) {
      const base = generateEncounters(r, day, 'breakoff-search-seed', FRESH_ROUTE_HISTORY);
      outlaw = base.find((c) => c.faction === 'outlaw');
      if (outlaw !== undefined) break;
    }
    if (outlaw === undefined) throw new Error('fixture never spawned an outlaw across 100 days - widen the search');

    const withPursuit = generateEncountersWithPursuit(r, day, 'breakoff-search-seed', 3, FRESH_ROUTE_HISTORY);
    const pursuer = withPursuit.find((c) => c.faction === 'pursuer');
    if (pursuer === undefined) throw new Error('expected at least one pursuer contact with pursuitLevel 3');

    const visualRangeMiles = drivingConfig().radar.visualRangeM / drivingConfig().metersPerMile;
    // Past BOTH contacts' routeMiles by more than visual range - a genuine
    // "was close, now far" for each, evaluated independently below.
    const farMiles = Math.max(outlaw.routeMiles, pursuer.routeMiles) + visualRangeMiles + 1;

    const farOutlaw = updateContactForProgress(outlaw, farMiles);
    expect(farOutlaw.disposition).toBe('brokeOff');
    expect(willFire(farOutlaw)).toBe(false);

    const farPursuer = updateContactForProgress(pursuer, farMiles);
    expect(farPursuer.disposition).toBe('hostile');
    expect(willFire(farPursuer)).toBe(true);

    // Tie the pursuer's behavior explicitly to the ruleset record
    // `buildPursuerUnit` is supposed to read (`@/sim/pursuit`'s
    // `pursuerDisposition`) rather than a hardcoded 'hostile'/'never breaks
    // off' pair duplicated in this module — if `encounters.json`'s pursuer
    // faction entry ever disagreed with what a built contact actually does,
    // this catches it even though the far-range simulation above happens to
    // agree with it today.
    const pursuerFaction = getFaction('pursuer');
    expect(pursuerFaction.hostile).toBe(true);
    expect(pursuerFaction.breaksOffBeyondVisualRange).toBe(false);
    expect(pursuer.disposition).toBe(pursuerFaction.hostile ? 'hostile' : 'peaceful');
  });
});

// ---------------------------------------------------------------------------
// Rest-time assassination: deterministic per (seed, day, cityId).
// ---------------------------------------------------------------------------

describe('rollRestAssassinationAttempt: deterministic, not "never" and not "every rest"', () => {
  it('unmarked (pursuitLevel 0) never triggers an attempt, for any day/city', () => {
    for (let day = 0; day < 10; day++) {
      const result = rollRestAssassinationAttempt('rest-seed', day, 'watertown', 0);
      expect(result.triggered).toBe(false);
      expect(result.contacts).toEqual([]);
    }
  });

  it('is deterministic across a save reload: the identical (seed, day, cityId, pursuitLevel) call reproduces the identical result', () => {
    // Simulates "reload the save and rest again on the same day" - a second,
    // completely independent call with the same inputs (no shared state, no
    // prior draws) must reproduce bit-for-bit the same outcome.
    let triggeredDay: number | null = null;
    for (let day = 0; day < 60 && triggeredDay === null; day++) {
      const probe = rollRestAssassinationAttempt('reload-seed', day, 'watertown', 4);
      if (probe.triggered) triggeredDay = day;
    }
    if (triggeredDay === null) throw new Error('fixture never triggered an attempt across 60 days - widen the search');

    const first = rollRestAssassinationAttempt('reload-seed', triggeredDay, 'watertown', 4);
    const second = rollRestAssassinationAttempt('reload-seed', triggeredDay, 'watertown', 4);
    expect(second).toEqual(first);
    expect(first.triggered).toBe(true);
    expect(first.contacts.length).toBeGreaterThan(0);
  });

  it('a triggered attempt is an ordinary hostile pursuer pack sized within the ruleset\'s own pack bounds', () => {
    let attempt: ReturnType<typeof rollRestAssassinationAttempt> | null = null;
    for (let day = 0; day < 60 && attempt === null; day++) {
      const probe = rollRestAssassinationAttempt('bounds-seed', day, 'newyork', 4);
      if (probe.triggered) attempt = probe;
    }
    if (attempt === null) throw new Error('fixture never triggered an attempt across 60 days - widen the search');

    const tier = dangerLevel(4);
    expect(attempt.contacts.length).toBeGreaterThanOrEqual(tier.packSizeMin);
    expect(attempt.contacts.length).toBeLessThanOrEqual(tier.packSizeMax);
    for (const contact of attempt.contacts) {
      expect(contact.faction).toBe('pursuer');
      expect(contact.disposition).toBe('hostile');
      expect(willFire(contact)).toBe(true);
    }
  });

  /**
   * MUTATION-PROVEN (see this module's confirmed-defects note #3): the old
   * version of this test only asserted "not never and not always", which
   * holds for ANY chance in the open interval (0, 1) - it passed identically
   * whether the code actually used `dangerLevel(4).outlawChance` (0.66) or,
   * via a mutation, `dangerLevel(0).outlawChance` (0.05, a 13x reduction) or
   * `dangerLevel(1).outlawChance` (0.155, 4.3x). This version measures the
   * EMPIRICAL trigger rate over many independent days and checks it against
   * the ruleset's own number for that tier, tight enough that either
   * mutation lands far outside the tolerance, and loose enough (a few
   * standard deviations of sampling noise at 400 trials) to never flake.
   */
  it('the trigger chance at rest is dangerLevel(pursuitLevel).outlawChance, not a fixed guess - and different tiers are genuinely distinguishable', () => {
    const TRIALS = 400;
    const TOLERANCE = 0.12;

    const rateAtTier1 = empiricalRestTriggerRate('chance-tier1-seed', 'chicago', 1, TRIALS);
    const rateAtTier4 = empiricalRestTriggerRate('chance-tier4-seed', 'chicago', 4, TRIALS);

    const expectedTier1 = dangerLevel(1).outlawChance;
    const expectedTier4 = dangerLevel(4).outlawChance;

    expect(rateAtTier1).toBeGreaterThan(expectedTier1 - TOLERANCE);
    expect(rateAtTier1).toBeLessThan(expectedTier1 + TOLERANCE);
    expect(rateAtTier4).toBeGreaterThan(expectedTier4 - TOLERANCE);
    expect(rateAtTier4).toBeLessThan(expectedTier4 + TOLERANCE);

    // No existing test before this one ever distinguished pursuitLevel 1
    // from pursuitLevel 4 at rest - this is the property that actually
    // catches "the code always uses the SAME tier's chance regardless of
    // pursuitLevel".
    expect(rateAtTier4).toBeGreaterThan(rateAtTier1 + 0.2);
  });

  it('can trigger some rests and not others for the same marked driver - not "never" and not "every rest"', () => {
    let sawTriggered = false;
    let sawNotTriggered = false;
    for (let day = 0; day < 60 && (!sawTriggered || !sawNotTriggered); day++) {
      const result = rollRestAssassinationAttempt('coinflip-seed', day, 'chicago', 4);
      if (result.triggered) sawTriggered = true;
      else sawNotTriggered = true;
    }
    expect(sawTriggered).toBe(true);
    expect(sawNotTriggered).toBe(true);
  });

  /**
   * MUTATION-PROVEN weak spot (see confirmed-defects note #3, second bullet):
   * the old version only searched for ANY day where the two cities'
   * triggered flags disagreed at least once in 60 days - true as long as
   * cityId appears ANYWHERE in the stream key, even alongside a wrong
   * chance/tier/pack. This version instead measures how often the two
   * cities' results AGREE across many days: two genuinely independent
   * per-city Bernoulli(p) streams agree at rate p^2 + (1-p)^2 (~0.55 for
   * p=0.66), while a mechanism that silently shares one stream across
   * cities (ignoring cityId beyond decoration) agrees 100% of the time.
   */
  it('a different cityId on the same (seed, day, pursuitLevel) rolls a genuinely independent stream, not a shared one merely labeled per-city', () => {
    const TRIALS = 300;
    let agreements = 0;
    for (let day = 0; day < TRIALS; day++) {
      const a = rollRestAssassinationAttempt('per-city-seed', day, 'city-alpha', 4);
      const b = rollRestAssassinationAttempt('per-city-seed', day, 'city-beta', 4);
      if (a.triggered === b.triggered) agreements++;
    }
    const agreementRate = agreements / TRIALS;
    expect(agreementRate).toBeLessThan(0.85);
    expect(agreementRate).toBeGreaterThan(0.3);
  });

  // -------------------------------------------------------------------------
  // Regression coverage for the confirmed defects fixed in this pass.
  // -------------------------------------------------------------------------

  it('regression: a pursuitLevel far past every known danger tier no longer throws (previously RangeError for target >= 69 away from every defined id)', () => {
    expect(() => rollRestAssassinationAttempt('probe-seed', 0, 'chicago', 69)).not.toThrow();
    expect(() => rollRestAssassinationAttempt('probe-seed', 0, 'chicago', 100)).not.toThrow();
    expect(() => rollRestAssassinationAttempt('probe-seed', 0, 'chicago', 1_000_000)).not.toThrow();
  });

  it('regression: rest-time pressure keeps escalating past the highest defined danger tier instead of saturating (pursuitLevel 8 vs 4)', () => {
    const TRIALS = 400;
    const rateAtMaxTier = empiricalRestTriggerRate('escalate-max-seed', 'chicago', 4, TRIALS);
    const rateAtDoubleMaxTier = empiricalRestTriggerRate('escalate-double-seed', 'chicago', 8, TRIALS);

    // Before the fix, pursuitLevel 8 clamped into the SAME single
    // dangerLevel(4) draw as pursuitLevel 4 - byte-identical trigger rates.
    // The fix rolls one additional independent tier-4 round per full
    // multiple of the highest defined tier, so 8 (two rounds) must be
    // measurably more likely to trigger than 4 (one round):
    // 1 - (1 - outlawChance)^2 vs outlawChance.
    expect(rateAtDoubleMaxTier).toBeGreaterThan(rateAtMaxTier + 0.1);
  });

  it('regression: a fractional pursuitLevel in (0, 1) is unmarked on BOTH the road and at rest - never marked in one and hunted in the other', () => {
    const r = route({ danger: 2, lengthMiles: 400 });
    const withPursuit = generateEncountersWithPursuit(r, 7, 'fraction-seed', 0.6, FRESH_ROUTE_HISTORY);
    expect(withPursuit.some((c) => c.faction === 'pursuer')).toBe(false);

    for (let day = 0; day < 30; day++) {
      expect(rollRestAssassinationAttempt('fraction-seed', day, 'chicago', 0.6).triggered).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveRestAssassinationCombat: the attempt actually fires, for real.
// ---------------------------------------------------------------------------

describe('resolveRestAssassinationCombat: fires a triggered attempt at the resting driver through the real combat path', () => {
  it('is deterministic across a save reload: the identical (seed, day, cityId, contacts, driver, vehicle) call reproduces the identical result', () => {
    const contact = singlePursuerContact();
    const driver = makeDriver();
    const vehicle = makeVehicle();
    const first = resolveRestAssassinationCombat('combat-determinism-seed', 5, 'chicago', [contact], driver, vehicle);
    const second = resolveRestAssassinationCombat('combat-determinism-seed', 5, 'chicago', [contact], driver, vehicle);
    expect(second).toEqual(first);
  });

  it('an untriggered attempt (no contacts) never changes the driver or vehicle', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle();
    const result = resolveRestAssassinationCombat('combat-empty-seed', 0, 'chicago', [], driver, vehicle);
    expect(result.driver).toEqual(driver);
    expect(result.vehicle).toEqual(vehicle);
  });

  /**
   * MUTATION-PROVEN: this is the test that actually catches the confirmed
   * defect (contacts that never reached `@/sim/combat`, never touched
   * `driver.naturalHealth`, never touched the vehicle). Neutering
   * `resolveRestAssassinationCombat`'s loop body into a no-op (returning
   * `{ driver, vehicle }` unchanged) makes `sawDamage` stay `false` forever
   * and fails this test - confirmed by running it against that mutation
   * before writing this comment (see the task's mutation-proof pass).
   */
  it('a lone, unarmored, vehicle-less driver takes real naturalHealth/bodyArmor damage across enough independent attempts - not never', () => {
    const contact = singlePursuerContact();
    let sawDamage = false;
    for (let day = 0; day < 100 && !sawDamage; day++) {
      const driver = makeDriver();
      const result = resolveRestAssassinationCombat('combat-onfoot-seed', day, 'chicago', [contact], driver, null);
      if (result.driver.naturalHealth < driver.naturalHealth || result.driver.bodyArmor < driver.bodyArmor) sawDamage = true;
    }
    expect(sawDamage).toBe(true);
  });

  it('the same single contact can also miss - not every attempt is a hit, across enough independent days', () => {
    const contact = singlePursuerContact();
    let sawMiss = false;
    for (let day = 0; day < 100 && !sawMiss; day++) {
      const driver = makeDriver();
      const result = resolveRestAssassinationCombat('combat-miss-seed', day, 'chicago', [contact], driver, null);
      if (result.driver.naturalHealth === driver.naturalHealth && result.driver.bodyArmor === driver.bodyArmor) sawMiss = true;
    }
    expect(sawMiss).toBe(true);
  });

  it('surviving a real attempt is possible: across many independent (multi-contact) triggered attempts the driver is not defeated every single time - an unavoidable death on every rest would be a wall, not a mechanic', () => {
    let sawTriggered = false;
    let sawSurvived = false;
    for (let day = 0; day < 100; day++) {
      const attempt = rollRestAssassinationAttempt('combat-survival-seed', day, 'newyork', 4);
      if (!attempt.triggered) continue;
      sawTriggered = true;
      const driver = makeDriver();
      const result = resolveRestAssassinationCombat('combat-survival-seed', day, 'newyork', attempt.contacts, driver, null);
      if (result.driver.naturalHealth > 0) sawSurvived = true;
    }
    expect(sawTriggered).toBe(true);
    expect(sawSurvived).toBe(true);
  });

  it('armor absorbs BEFORE health does: a vehicle with heavy REAR armor takes the hit and the driver stays untouched', () => {
    const contact = singlePursuerContact();
    let sawArmorLoss = false;
    for (let day = 0; day < 100; day++) {
      const driver = makeDriver();
      const vehicle = makeVehicle({ armorDP: { FRONT: 0, REAR: 999, LEFT: 0, RIGHT: 0, UNDERBODY: 0 } });
      const result = resolveRestAssassinationCombat('combat-armor-seed', day, 'chicago', [contact], driver, vehicle);
      if (result.vehicle !== null && result.vehicle.armorDP.REAR < 999) sawArmorLoss = true;
      // Heavy armor absorbs the whole shot every time (damage.kind RANGE
      // tops out well under 999) - the driver's own health/armor must never
      // move while the vehicle's armor is what's actually taking the hit.
      expect(result.driver.naturalHealth).toBe(driver.naturalHealth);
      expect(result.driver.bodyArmor).toBe(driver.bodyArmor);
    }
    expect(sawArmorLoss).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pursuitLevelFromQuestState: the real production caller's own input.
// ---------------------------------------------------------------------------

describe('pursuitLevelFromQuestState: derives the campaign pursuit level from save-state alone', () => {
  it('is 0 for no quest state, and for quest state that has not been marked', () => {
    expect(pursuitLevelFromQuestState([])).toBe(0);
    expect(pursuitLevelFromQuestState([{ id: 'the-boss-tape', stage: 2, completed: false, flags: {} }])).toBe(0);
  });

  it('is the marked quest\'s own onAccept.pursuitLevel once its save-state carries the marked flag - real quests.json data, never invented', () => {
    const def = questDefs().find((candidate) => candidate.onAccept?.pursuitLevel !== undefined);
    if (def === undefined) throw new Error('fixture requires a quests.json entry with onAccept.pursuitLevel');
    const expectedLevel = def.onAccept?.pursuitLevel;

    const level = pursuitLevelFromQuestState([{ id: def.id, stage: def.clueChain.length, completed: false, flags: { marked: true } }]);
    expect(level).toBe(expectedLevel);
  });

  it('ignores a quest with no marked flag even if it has its own pursuitLevel, and ignores flags on unrelated quests', () => {
    const def = questDefs().find((candidate) => candidate.onAccept?.pursuitLevel !== undefined);
    if (def === undefined) throw new Error('fixture requires a quests.json entry with onAccept.pursuitLevel');

    const level = pursuitLevelFromQuestState([
      { id: def.id, stage: 1, completed: false, flags: {} },
      { id: 'some-other-quest-id', stage: 1, completed: false, flags: { marked: true } },
    ]);
    expect(level).toBe(0);
  });
});
