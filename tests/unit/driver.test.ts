import { describe, expect, it } from 'vitest';
import { economy, skillsConfig } from '@/data/rulesets';
import {
  addPrestige,
  addSkill,
  buyBodyArmor,
  controlScore,
  createClone,
  createDriver,
  damageDriver,
  getSkill,
  hitChance,
  isDead,
  losePrestige,
  mechanicLesson,
  reviveFromClone,
  salvageChance,
  updateClone,
} from '@/sim/driver';
import { getWeapon } from '@/data/rulesets';
import type { DriverState, SkillName } from '@/sim/types';

const cfg = skillsConfig();

function skills(driving: number, marksmanship: number, mechanic: number): Record<SkillName, number> {
  return { driving, marksmanship, mechanic };
}

function mustCreate(driving: number, marksmanship: number, mechanic: number): DriverState {
  const result = createDriver('Ace', skills(driving, marksmanship, mechanic));
  if (!result.ok) throw new Error(result.reason);
  return result.driver;
}

/** Deterministic fake RNG: returns the queued values in order, then repeats the last. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)] as number;
    i += 1;
    return v;
  };
}

describe('createDriver: the 50-point rule', () => {
  it('rejects 49 total', () => {
    const result = createDriver('Ace', skills(20, 15, 14));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/50/);
  });

  it('accepts exactly 50', () => {
    const result = createDriver('Ace', skills(20, 15, 15));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.driver.skills).toEqual({ driving: 20, marksmanship: 15, mechanic: 15 });
    }
  });

  it('rejects 51 total', () => {
    const result = createDriver('Ace', skills(20, 16, 15));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/50/);
  });

  it('rejects an out-of-range individual skill even if the sum could work', () => {
    const result = createDriver('Ace', skills(100, -50, 0));
    expect(result.ok).toBe(false);
  });

  it('rejects a name outside 1..nameMaxLength', () => {
    const tooLong = 'x'.repeat(cfg.driver.nameMaxLength + 1);
    expect(createDriver('', skills(20, 15, 15)).ok).toBe(false);
    expect(createDriver(tooLong, skills(20, 15, 15)).ok).toBe(false);
  });

  it('seeds a new driver from ruleset data, not literals', () => {
    const result = createDriver('Ace', skills(20, 15, 15));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.driver;
    expect(d.cash).toBe(economy().startingCash);
    expect(d.naturalHealth).toBe(cfg.driver.naturalHealthDP);
    expect(d.bodyArmor).toBe(0);
    expect(d.prestige).toBe(cfg.driver.prestigeFloor);
    expect(d.cityId).toBe(cfg.startingLocation);
    expect(d.cloneCityId).toBeNull();
    expect(d.cloneSkills).toBeNull();
  });
});

describe('skill accessors', () => {
  it('addSkill never exceeds skillMax', () => {
    const driver = mustCreate(20, 15, 15);
    const bumped = addSkill(driver, 'mechanic', 1000);
    expect(getSkill(bumped, 'mechanic')).toBe(cfg.skillMax);
  });

  it('addSkill never goes below skillMin', () => {
    const driver = mustCreate(20, 15, 15);
    const dropped = addSkill(driver, 'mechanic', -1000);
    expect(getSkill(dropped, 'mechanic')).toBe(cfg.skillMin);
  });
});

describe('prestige', () => {
  it('has a hard floor', () => {
    const driver = mustCreate(20, 15, 15);
    const raised = addPrestige(driver, 10);
    expect(raised.prestige).toBe(10);
    const dropped = losePrestige(raised, 1000);
    expect(dropped.prestige).toBe(cfg.driver.prestigeFloor);
  });

  it('never dips below the floor from a fresh driver', () => {
    const driver = mustCreate(20, 15, 15);
    expect(losePrestige(driver, 5).prestige).toBe(cfg.driver.prestigeFloor);
  });

  it('addPrestige never drops below the floor either', () => {
    const driver = mustCreate(20, 15, 15);
    expect(addPrestige(driver, -5).prestige).toBe(cfg.driver.prestigeFloor);
  });

  it('addPrestige rounds a fractional amount to the nearest integer', () => {
    const driver = mustCreate(20, 15, 15);
    expect(addPrestige(driver, 0.5).prestige).toBe(1);
    expect(addPrestige(driver, 0.4).prestige).toBe(0);
  });
});

describe('health: armor absorbs before natural health', () => {
  it('spends armor first, leaves health untouched while armor covers it', () => {
    const driver = buyBodyArmor(mustCreate(20, 15, 15));
    expect(driver.bodyArmor).toBe(cfg.driver.bodyArmorDP);
    const { driver: hit, dead } = damageDriver(driver, 1);
    expect(hit.bodyArmor).toBe(cfg.driver.bodyArmorDP - 1);
    expect(hit.naturalHealth).toBe(cfg.driver.naturalHealthDP);
    expect(dead).toBe(false);
  });

  it('spills over into natural health once armor is exhausted', () => {
    const driver = buyBodyArmor(mustCreate(20, 15, 15));
    const overkill = cfg.driver.bodyArmorDP + 1;
    const { driver: hit, dead } = damageDriver(driver, overkill);
    expect(hit.bodyArmor).toBe(0);
    expect(hit.naturalHealth).toBe(cfg.driver.naturalHealthDP - 1);
    expect(dead).toBe(false);
  });

  it('marks the driver dead once natural health hits 0, never negative', () => {
    const driver = mustCreate(20, 15, 15);
    const { driver: hit, dead } = damageDriver(driver, cfg.driver.naturalHealthDP + 50);
    expect(hit.naturalHealth).toBe(0);
    expect(dead).toBe(true);
    expect(isDead(hit)).toBe(true);
  });

  it('buying a new suit replaces (never adds to) the old armor and is never repaired', () => {
    let driver = buyBodyArmor(mustCreate(20, 15, 15));
    driver = damageDriver(driver, 1).driver;
    expect(driver.bodyArmor).toBe(cfg.driver.bodyArmorDP - 1);
    driver = buyBodyArmor(driver);
    expect(driver.bodyArmor).toBe(cfg.driver.bodyArmorDP);
  });
});

describe('cloning and revival', () => {
  it('createClone snapshots current skills at a city', () => {
    const driver = mustCreate(20, 15, 15);
    const cloned = createClone(driver, 'atlanta');
    expect(cloned.cloneCityId).toBe('atlanta');
    expect(cloned.cloneSkills).toEqual({ driving: 20, marksmanship: 15, mechanic: 15 });
  });

  it('updateClone replaces the stored snapshot', () => {
    const driver = mustCreate(20, 15, 15);
    const cloned = createClone(driver, 'atlanta');
    const leveled = addSkill(cloned, 'mechanic', 5);
    const updated = updateClone(leveled, 'boston');
    expect(updated.cloneCityId).toBe('boston');
    expect(updated.cloneSkills).toEqual({ driving: 20, marksmanship: 15, mechanic: 20 });
  });

  it('reviveFromClone fails with a reason when there is no clone on file', () => {
    const driver = mustCreate(20, 15, 15);
    const result = reviveFromClone(driver, 'car-1');
    expect(result.ok).toBe(false);
  });

  it('reviveFromClone restores stored skills, keeps cash and prestige, and loses the vehicle', () => {
    let driver = mustCreate(20, 15, 15);
    driver = createClone(driver, 'atlanta');
    // Diverge post-snapshot state: gain skill, spend cash, gain prestige, take damage.
    driver = addSkill(driver, 'mechanic', 10);
    driver = addPrestige(driver, 7);
    driver = { ...driver, cash: driver.cash - 500 };
    driver = damageDriver(driver, cfg.driver.naturalHealthDP).driver; // dies

    const result = reviveFromClone(driver, 'car-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.lostVehicleId).toBe('car-1');
    expect(result.driver.skills).toEqual({ driving: 20, marksmanship: 15, mechanic: 15 }); // pre-lesson snapshot
    expect(result.driver.cash).toBe(driver.cash); // kept
    expect(result.driver.prestige).toBe(7); // kept
    expect(result.driver.cityId).toBe('atlanta'); // respawns at the clone's city
    expect(result.driver.naturalHealth).toBe(cfg.driver.naturalHealthDP); // fresh body
    expect(result.driver.bodyArmor).toBe(0);
    expect(isDead(result.driver)).toBe(false);
    // the snapshot is consumed
    expect(result.driver.cloneCityId).toBeNull();
    expect(result.driver.cloneSkills).toBeNull();
  });

  it('reviveFromClone with no active vehicle reports no lost vehicle', () => {
    let driver = mustCreate(20, 15, 15);
    driver = createClone(driver, 'atlanta');
    driver = damageDriver(driver, cfg.driver.naturalHealthDP).driver; // dies
    const result = reviveFromClone(driver, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lostVehicleId).toBeNull();
  });

  it('reviveFromClone refuses a driver who is still alive, even with a clone on file', () => {
    let driver = mustCreate(20, 15, 15);
    driver = createClone(driver, 'atlanta');
    expect(isDead(driver)).toBe(false);
    const result = reviveFromClone(driver, 'car-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/dead/);
  });
});

describe('mechanic lessons', () => {
  const c = cfg._reconstruction.mechanic;

  it('takes a seeded rng and never calls Math.random', () => {
    const driver = mustCreate(20, 15, 15);
    // First draw well under the success threshold, second draw picks the low end of the point range.
    const rng = seq(0, 0);
    const result = mechanicLesson(driver, rng);
    expect(result.success).toBe(true);
    expect(result.gained).toBe(c.lessonGainMinPoints);
    expect(result.driver.skills.mechanic).toBe(15 + c.lessonGainMinPoints);
  });

  it('fails when the roll is above the computed chance', () => {
    const driver = mustCreate(20, 15, 15);
    const rng = seq(0.999999);
    const result = mechanicLesson(driver, rng);
    expect(result.success).toBe(false);
    expect(result.gained).toBe(0);
    expect(result.driver).toBe(driver); // unchanged on failure
  });

  it('picks the top of the point range on the max roll', () => {
    const driver = mustCreate(20, 15, 15);
    const rng = seq(0, 0.999999);
    const result = mechanicLesson(driver, rng);
    expect(result.success).toBe(true);
    expect(result.gained).toBe(c.lessonGainMaxPoints);
  });

  it('a higher mechanic skill lowers the gain chance', () => {
    const low = mustCreate(20, 15, 15); // mechanic 15 -> chance 78
    const high = addSkill(low, 'mechanic', 80); // 15+80 clamped to 95 -> chance 14
    const rng = () => 0.5; // a 50% roll
    expect(mechanicLesson(low, rng).success).toBe(true);
    expect(mechanicLesson(high, rng).success).toBe(false);
  });
});

describe('reconstruction formulas', () => {
  it('controlScore clamps to the configured range', () => {
    const c = cfg._reconstruction.driving;
    expect(controlScore(0, 0, 0, 0, 0, 1000)).toBe(c.controlScoreMin);
    expect(controlScore(1000, 99, 1000, 0, 0, 0)).toBe(c.controlScoreMax);
  });

  it('controlScore only penalizes turn stress past the threshold', () => {
    const c = cfg._reconstruction.driving;
    // hc kept within suspension.json's real domain (handlingClass 0..3) so the
    // formula stays well clear of controlScoreMin/Max and the threshold's
    // effect on the raw score is actually observable.
    const hc = 3;
    const driving = 50;
    const noPenaltyScore = hc * c.handlingClassWeight + driving * c.drivingSkillWeight;

    const underThreshold = controlScore(hc, driving, 0, c.turnStressThreshold - 5, 0, 0);
    const atThreshold = controlScore(hc, driving, 0, c.turnStressThreshold, 0, 0);
    const overThreshold = controlScore(hc, driving, 0, c.turnStressThreshold + 1, 0, 0);

    expect(underThreshold).toBe(noPenaltyScore);
    expect(atThreshold).toBe(noPenaltyScore);
    expect(overThreshold).toBe(noPenaltyScore - 1);
  });

  it('hitChance clamps to the weapon own min/max and moves with skill', () => {
    const weapon = getWeapon('machinegun');
    const atPivot = hitChance(weapon, cfg._reconstruction.marksmanship.skillPivot, 0);
    expect(atPivot).toBe(weapon.baseAccuracy);
    expect(hitChance(weapon, 0, 0)).toBeGreaterThanOrEqual(weapon.minChance);
    expect(hitChance(weapon, 99, 0)).toBeLessThanOrEqual(weapon.maxChance);
    expect(hitChance(weapon, 99, 0)).toBeGreaterThan(atPivot);
  });

  it('salvageChance applies the burn penalty and clamps', () => {
    const r = economy()._reconstruction;
    expect(salvageChance(0, false)).toBe(r.salvageBaseChance);
    expect(salvageChance(0, true)).toBe(Math.max(r.salvageChanceMin, r.salvageBaseChance - r.salvageBurnPenalty));
    expect(salvageChance(99, false)).toBeLessThanOrEqual(r.salvageChanceMax);
  });
});
