import { describe, expect, it } from 'vitest';
import {
  RAW_RULESETS,
  RULESETS,
  UnknownRulesetIdError,
  accelerationTiers,
  allBodies,
  allChassis,
  allPlants,
  allSuspensions,
  allTires,
  allWeapons,
  drivingConfig,
  economy,
  getBody,
  getChassis,
  getPlant,
  getSuspension,
  getTire,
  getWeapon,
  skillsConfig,
  vehicleLimits,
  wheelCount,
} from '@/data/rulesets';
import { RulesetValidationError, validateRulesets, type RawRulesetInput } from '@/data/schema';
import { FACINGS } from '@/sim/types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function at<T>(rows: readonly T[], index: number): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`no row at ${index}`);
  return row;
}

describe('ruleset validation', () => {
  // A prior version of this suite also asserted, for every file, that
  // `RULESET_SCHEMAS[file]` and `RULESETS[file]` are each `toBeDefined()`.
  // Both are runtime-tautological: `RULESET_SCHEMAS` is typed
  // `Record<RulesetFileName, SchemaObject>` and `RULESETS` is typed
  // `Rulesets`, so a value missing either key would fail `tsc --noEmit`
  // before this file could ever run - there is no way to construct an
  // object literal satisfying either type with a key absent. Deleted; the
  // assertion below that actually exercises `validateRulesets` against the
  // real shipped files is the one that can fail.
  it('validates every shipped ruleset file', () => {
    expect(() => validateRulesets(RAW_RULESETS)).not.toThrow();
  });

  it('is memoized per input bundle', () => {
    expect(validateRulesets(RAW_RULESETS)).toBe(RULESETS);
  });

  it('throws with a readable path when a numeric field is the wrong type', () => {
    const raw: RawRulesetInput = { ...RAW_RULESETS, bodies: clone(RAW_RULESETS.bodies) };
    at((raw.bodies as { bodies: { price: unknown }[] }).bodies, 0).price = 'cheap';
    expect(() => validateRulesets(raw)).toThrow(RulesetValidationError);
    expect(() => validateRulesets(raw)).toThrow(/bodies\.json:\/bodies\/0\/price must be integer/);
  });

  it('rejects unknown properties', () => {
    const raw: RawRulesetInput = { ...RAW_RULESETS, tires: clone(RAW_RULESETS.tires) };
    at((raw.tires as { tires: Record<string, unknown>[] }).tires, 0)['turbo'] = true;
    expect(() => validateRulesets(raw)).toThrow(/tires\.json:\/tires\/0 .*"turbo"/);
  });

  it('rejects an illegal facing on a weapon', () => {
    const raw: RawRulesetInput = { ...RAW_RULESETS, weapons: clone(RAW_RULESETS.weapons) };
    at((raw.weapons as { weapons: { allowedFacings: string[] }[] }).weapons, 0).allowedFacings.push('TOP');
    expect(() => validateRulesets(raw)).toThrow(/weapons\.json:\/weapons\/0\/allowedFacings\/\d+ must be equal to one of the allowed values/);
  });

  it('rejects duplicate ids', () => {
    const raw: RawRulesetInput = { ...RAW_RULESETS, plants: clone(RAW_RULESETS.plants) };
    const plants = (raw.plants as { plants: { id: string }[] }).plants;
    at(plants, 1).id = at(plants, 0).id;
    expect(() => validateRulesets(raw)).toThrow(/plants\.json:\/plants\/1\/id duplicate id/);
  });

  it('rejects a missing file', () => {
    const raw = { ...RAW_RULESETS, driving: undefined } as unknown as RawRulesetInput;
    expect(() => validateRulesets(raw)).toThrow(/driving\.json:\/ must be object/);
  });
});

describe('ruleset counts', () => {
  it('has 7 bodies', () => expect(allBodies()).toHaveLength(7));
  it('has 4 chassis', () => expect(allChassis()).toHaveLength(4));
  it('has 3 suspensions', () => expect(allSuspensions()).toHaveLength(3));
  it('has 4 plants', () => expect(allPlants()).toHaveLength(4));
  it('has 4 tires', () => expect(allTires()).toHaveLength(4));
  it('has 12 weapons', () => expect(allWeapons()).toHaveLength(12));
  it('has 3 acceleration tiers in descending powerRatio order', () => {
    const tiers = accelerationTiers();
    expect(tiers).toHaveLength(3);
    for (let i = 1; i < tiers.length; i++) expect(at(tiers, i).powerRatio).toBeLessThan(at(tiers, i - 1).powerRatio);
  });
});

describe('lookups', () => {
  it('resolves every id in every table', () => {
    for (const b of allBodies()) expect(getBody(b.id)).toBe(b);
    for (const c of allChassis()) expect(getChassis(c.id)).toBe(c);
    for (const s of allSuspensions()) expect(getSuspension(s.id)).toBe(s);
    for (const p of allPlants()) expect(getPlant(p.id)).toBe(p);
    for (const t of allTires()) expect(getTire(t.id)).toBe(t);
    for (const w of allWeapons()) expect(getWeapon(w.id)).toBe(w);
  });

  it('throws UnknownRulesetIdError on unknown ids', () => {
    expect(() => getBody('hovercraft')).toThrow(UnknownRulesetIdError);
    expect(() => getChassis('nope')).toThrow(/unknown chassis id "nope"/);
    expect(() => getSuspension('nope')).toThrow(UnknownRulesetIdError);
    expect(() => getPlant('nope')).toThrow(UnknownRulesetIdError);
    expect(() => getTire('nope')).toThrow(UnknownRulesetIdError);
    expect(() => getWeapon('nope')).toThrow(UnknownRulesetIdError);
  });

  it('exposes config tables', () => {
    expect(economy().startingCash).toBe(2000);
    expect(skillsConfig().startingSkillPool).toBe(50);
    expect(drivingConfig().tickRateHz).toBe(60);
    expect(drivingConfig().metersPerMile).toBe(1609.344);
    expect(drivingConfig().battery.full).toBe(99);
    expect(skillsConfig().driver.prestigeFloor).toBe(0);
  });

  // Mutation-proven gap (2026-09-26). The `exposes config tables` block above
  // pins each accessor against a hand-written literal, which cannot distinguish
  // "the accessor read the JSON" from "the accessor returns a literal". A
  // verifier replaced `wheelCount()`'s body with `return 4;` and the whole
  // suite stayed green - and green even with bodies.json saying 6, which made
  // the ruleset entry decorative and left the gameplay constant a TS literal,
  // just relocated from construct.ts to rulesets.ts.
  //
  // Pinning accessor output against RAW_RULESETS (the parsed JSON itself)
  // closes the class: any accessor that stops reading its table now fails,
  // whatever value it hardcodes.
  it('every accessor returns the value from the JSON, not a literal of its own', () => {
    const raw = RAW_RULESETS as unknown as {
      bodies: { vehicleLimits: { wheelCount: number } };
      economy: { startingCash: number; maxFleetSize: number; maxPayloads: number };
      skills: { startingSkillPool: number; driver: { prestigeFloor: number; naturalHealthDP: number } };
      driving: { tickRateHz: number; metersPerMile: number; battery: { full: number } };
    };

    expect(wheelCount()).toBe(raw.bodies.vehicleLimits.wheelCount);
    expect(vehicleLimits()).toEqual(raw.bodies.vehicleLimits);

    expect(economy().startingCash).toBe(raw.economy.startingCash);
    expect(economy().maxFleetSize).toBe(raw.economy.maxFleetSize);
    expect(economy().maxPayloads).toBe(raw.economy.maxPayloads);

    expect(skillsConfig().startingSkillPool).toBe(raw.skills.startingSkillPool);
    expect(skillsConfig().driver.prestigeFloor).toBe(raw.skills.driver.prestigeFloor);
    expect(skillsConfig().driver.naturalHealthDP).toBe(raw.skills.driver.naturalHealthDP);

    expect(drivingConfig().tickRateHz).toBe(raw.driving.tickRateHz);
    expect(drivingConfig().metersPerMile).toBe(raw.driving.metersPerMile);
    expect(drivingConfig().battery.full).toBe(raw.driving.battery.full);
  });

  it('only uses known facings on weapons', () => {
    for (const w of allWeapons()) {
      for (const f of w.allowedFacings) expect(FACINGS).toContain(f);
    }
  });

  // A prior version of this suite also asserted, for every suspension, that
  // `typeof handlingClass.automobile` and `.cargo` are `'number'`. That's
  // guaranteed by the AJV schema (`handlingClass: recordOf(BODY_CLASSES,
  // NON_NEG_INT)`, both keys required), which runs once at module import via
  // `validateRulesets` - a violation throws before `allSuspensions()` ever
  // returns, so the assertion could never observe a wrong type. Deleted.
});
