import { describe, expect, it } from 'vitest';
import {
  applyService,
  currentValue,
  divisionEligible,
  purchaseValue,
  repairCost,
  saleValue,
  salvageRoll,
  type EconomyWorld,
  type Salvager,
  type Wreck,
} from '@/sim/economy';
import { economy, getBody, getPlant, getTire, skillsConfig } from '@/data/rulesets';
import { initialClock } from '@/sim/calendar';
import { createRng, type Rng } from '@/util/rng';
import type { DriverState, VehicleState, WeaponState } from '@/sim/types';

/**
 * A minimal, fully-typed Rng that always resolves `.chance()` to `result`.
 * salvageRoll only ever calls `.chance()`, so this pins the coin flip
 * deterministically instead of hunting for a seed that happens to hit -
 * every other method throws if salvageRoll's implementation ever starts
 * using it, which would be a signal to update this fixture.
 */
function forcedRng(result: boolean): Rng {
  const unused = (): never => {
    throw new Error('forcedRng: unexpected method call');
  };
  return {
    nextU32: unused,
    nextFloat: unused,
    int: unused,
    roll: unused,
    pick: unused,
    chance: () => result,
    stream: unused,
    serialize: unused,
    restore: unused,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDriver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    name: 'Duelist',
    skills: { driving: 20, marksmanship: 20, mechanic: 10 },
    naturalHealth: skillsConfig().driver.naturalHealthDP,
    bodyArmor: 0,
    prestige: skillsConfig().driver.prestigeFloor,
    cash: economy().startingCash,
    cityId: skillsConfig().startingLocation,
    cloneCityId: null,
    cloneSkills: null,
    ...overrides,
  };
}

function makeWeaponState(weaponId: string, overrides: Partial<WeaponState> = {}): WeaponState {
  return {
    weaponId,
    facing: 'FRONT',
    ammo: 0,
    dp: 6,
    maxDP: 6,
    cooldownRemaining: 0,
    destroyed: false,
    ...overrides,
  };
}

/**
 * A minimal, fully-typed Rng whose `.nextFloat()` always returns a fixed
 * value; every other method throws if the code under test ever starts using
 * it. Used to pin `mechanicLesson`'s success/gain roll deterministically.
 */
function forcedFloatRng(value: number): Rng {
  const unused = (): never => {
    throw new Error('forcedFloatRng: unexpected method call');
  };
  return {
    nextU32: unused,
    nextFloat: () => value,
    int: unused,
    roll: unused,
    pick: unused,
    chance: unused,
    stream: unused,
    serialize: unused,
    restore: unused,
  };
}

/** van / standard chassis / light suspension / large plant / solid tires / one front antitankgun, 85 armor points, 20 rounds of ammo: costTotal 10600. */
function make10600Vehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: 'veh-1',
    ownerId: 'driver-1',
    design: {
      name: 'Test Rig',
      bodyId: 'van',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'large',
      tireId: 'solid',
      armor: { FRONT: 25, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 },
      weapons: [{ weaponId: 'antitankgun', facing: 'FRONT', ammo: 20 }],
    },
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 40,
    odometerMiles: 0,
    armorDP: { FRONT: 25, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 },
    tireDP: [12, 12, 12, 12],
    plantDP: getPlant('large').maxDP,
    weapons: [makeWeaponState('antitankgun', { ammo: 20, dp: 6, maxDP: 6 })],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

describe('vehicle valuation', () => {
  it('purchaseValue and currentValue agree on an undamaged vehicle at 10600 (includes ammo cost)', () => {
    const vehicle = make10600Vehicle();
    // body(1000) + plant(2000) + 4*tire(2000) + weapon(2050) + 20*ammoCost(50)=1000 + armor(85*30=2550)
    expect(purchaseValue(vehicle)).toBe(10600);
    expect(currentValue(vehicle)).toBe(10600);
  });

  it('currentValue drops when armor is damaged but purchaseValue does not', () => {
    const vehicle = make10600Vehicle({ armorDP: { FRONT: 5, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 } });
    // 20 points lost off FRONT * armorCostPerPoint(van)=30 => 600 less than 10600
    expect(currentValue(vehicle)).toBe(10000);
    expect(purchaseValue(vehicle)).toBe(10600);
  });

  it('divisionEligible: a 10600-value car fails cap 10000 and passes cap 10600', () => {
    const vehicle = make10600Vehicle();
    expect(currentValue(vehicle)).toBe(10600);
    expect(divisionEligible(vehicle, 5000)).toBe(false);
    expect(divisionEligible(vehicle, 10000)).toBe(false);
    expect(divisionEligible(vehicle, 10600)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sale value
// ---------------------------------------------------------------------------

describe('saleValue', () => {
  it('floors originalCost * lerp(conditionFloor, conditionCeiling, condition)', () => {
    const r = economy()._reconstruction;
    expect(saleValue(1000, 1)).toBe(Math.floor(1000 * r.saleValueConditionCeiling));
    expect(saleValue(1000, 0)).toBe(Math.floor(1000 * r.saleValueConditionFloor));
    const midFactor = r.saleValueConditionFloor + (r.saleValueConditionCeiling - r.saleValueConditionFloor) * 0.5;
    expect(saleValue(1000, 0.5)).toBe(Math.floor(1000 * midFactor));
  });

  it('clamps out-of-range condition to [0, 1]', () => {
    // Expected values are derived independently from the documented formula
    // and the ruleset's own floor/ceiling constants - NOT by calling
    // saleValue at the in-range boundary and comparing the function to
    // itself, which would pass even if the clamp were removed entirely and
    // condition=2 silently extrapolated past the ceiling (as long as it
    // didn't happen to coincide with condition=1's result).
    const r = economy()._reconstruction;
    expect(saleValue(1000, 2)).toBe(Math.floor(1000 * r.saleValueConditionCeiling));
    expect(saleValue(1000, -1)).toBe(Math.floor(1000 * r.saleValueConditionFloor));
  });
});

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

describe('repairCost', () => {
  it('component: ceil(originalCost * missingDP/maxDP * factor)', () => {
    const plant = getPlant('medium');
    const factor = economy()._reconstruction.repairCostFactor;
    const cost = repairCost({ kind: 'component', originalCost: plant.price, currentDP: 3, maxDP: plant.maxDP });
    expect(cost).toBe(Math.ceil(plant.price * ((plant.maxDP - 3) / plant.maxDP) * factor));
  });

  it('component: an undamaged component costs nothing', () => {
    const plant = getPlant('medium');
    expect(repairCost({ kind: 'component', originalCost: plant.price, currentDP: plant.maxDP, maxDP: plant.maxDP })).toBe(0);
  });

  it('armor: repairs PER POINT, proportional to how many points are bought back', () => {
    const body = getBody('compact');
    const factor = economy()._reconstruction.repairCostFactor;
    const cost = repairCost({ kind: 'armor', costPerPoint: body.armorCostPerPoint, pointsToRepair: 4 });
    expect(cost).toBe(Math.ceil(body.armorCostPerPoint * 4 * factor));
  });

  it('tire: REPLACED at full list price, not scaled by the repair factor', () => {
    const tire = getTire('solid');
    expect(repairCost({ kind: 'tire', tireId: 'solid' })).toBe(tire.price);
  });
});

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

describe('applyService', () => {
  it('charges the price and advances the clock by the service day cost', () => {
    const driver = makeDriver({ cash: 1000 });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };
    const svc = economy().services.mechanicLesson;

    const result = applyService(driver, world, 'mechanicLesson', createRng('svc-charge'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.driver.cash).toBe(1000 - svc.price);
    expect(result.world.clock.dayIndex).toBe(svc.days);
  });

  it('refuses when cash is short and does not mutate anything', () => {
    const driver = makeDriver({ cash: 1 });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };

    const result = applyService(driver, world, 'clone', createRng('svc-short'));
    expect(result).toEqual({ ok: false, reason: 'insufficientFunds' });
  });

  it('never allows negative cash', () => {
    const price = economy().services.braintapeUpdate.price;
    const driver = makeDriver({ cash: price - 1 });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };
    const result = applyService(driver, world, 'braintapeUpdate', createRng('svc-negative'));
    expect(result.ok).toBe(false);
  });

  it('recharge always restores battery to 99 regardless of starting charge, and costs a flat 50', () => {
    const driver = makeDriver({ cash: 200 });
    const svc = economy().services.batteryRecharge;
    expect(svc.price).toBe(50);
    expect(svc.restoresTo).toBe(99);

    for (const startingBattery of [0, 1, 50, 98]) {
      const vehicle = make10600Vehicle({ battery: startingBattery });
      const world: EconomyWorld = { clock: initialClock(), vehicle, vehicleStored: false };
      const result = applyService(driver, world, 'batteryRecharge', createRng('svc-recharge'));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.world.vehicle?.battery).toBe(99);
      expect(result.driver.cash).toBe(200 - 50);
    }
  });

  it('batteryRecharge refuses when no vehicle is selected', () => {
    const driver = makeDriver({ cash: 200 });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };
    expect(applyService(driver, world, 'batteryRecharge', createRng('svc-novehicle'))).toEqual({
      ok: false,
      reason: 'noVehicleSelected',
    });
  });

  it('storing a car is free up front; the charge lands on retrieval', () => {
    const driver = makeDriver({ cash: 1000 });
    const vehicle = make10600Vehicle();
    const stored: EconomyWorld = { clock: initialClock(), vehicle, vehicleStored: false };

    const storeResult = applyService(driver, stored, 'storeCar', createRng('svc-store'));
    expect(storeResult.ok).toBe(true);
    if (!storeResult.ok) throw new Error('expected ok');
    expect(storeResult.driver.cash).toBe(1000); // storeCar's own price is 0
    expect(storeResult.world.vehicleStored).toBe(true);

    const retrieveResult = applyService(storeResult.driver, storeResult.world, 'retrieveCar', createRng('svc-retrieve'));
    expect(retrieveResult.ok).toBe(true);
    if (!retrieveResult.ok) throw new Error('expected ok');
    expect(retrieveResult.driver.cash).toBe(1000 - economy().services.retrieveCar.price);
    expect(retrieveResult.world.vehicleStored).toBe(false);
  });

  it('refuses to store an already-stored car, and refuses to retrieve one that is not stored', () => {
    const driver = makeDriver({ cash: 1000 });
    const vehicle = make10600Vehicle();
    const notStored: EconomyWorld = { clock: initialClock(), vehicle, vehicleStored: false };
    const alreadyStored: EconomyWorld = { clock: initialClock(), vehicle, vehicleStored: true };

    expect(applyService(driver, alreadyStored, 'storeCar', createRng('svc-already'))).toEqual({
      ok: false,
      reason: 'alreadyStored',
    });
    expect(applyService(driver, notStored, 'retrieveCar', createRng('svc-notstored'))).toEqual({
      ok: false,
      reason: 'notStored',
    });
  });

  it('bodyArmor service replaces (never adds past cap) driver.bodyArmor', () => {
    const cap = skillsConfig().driver.bodyArmorDP;
    const driver = makeDriver({ cash: 1000, bodyArmor: 1 });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };
    const result = applyService(driver, world, 'bodyArmor', createRng('svc-armor'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.driver.bodyArmor).toBe(cap);
  });

  it('clone stores a skill snapshot at the current city', () => {
    const driver = makeDriver({ cash: 10_000, cityId: 'boston', skills: { driving: 30, marksmanship: 15, mechanic: 5 } });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };
    const result = applyService(driver, world, 'clone', createRng('svc-clone'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.driver.cloneCityId).toBe('boston');
    expect(result.driver.cloneSkills).toEqual({ driving: 30, marksmanship: 15, mechanic: 5 });
    expect(result.driver.cash).toBe(10_000 - economy().services.clone.price);
  });

  it('braintapeUpdate replaces the skill snapshot without moving the clone from its recorded city', () => {
    const driver = makeDriver({
      cash: 10_000,
      cityId: 'pittsburgh', // driver has since traveled away from the clone's city
      cloneCityId: 'boston',
      cloneSkills: { driving: 10, marksmanship: 10, mechanic: 10 },
      skills: { driving: 40, marksmanship: 20, mechanic: 15 },
    });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };
    const result = applyService(driver, world, 'braintapeUpdate', createRng('svc-braintape'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.driver.cloneCityId).toBe('boston'); // unchanged
    expect(result.driver.cloneSkills).toEqual({ driving: 40, marksmanship: 20, mechanic: 15 }); // refreshed
  });

  it('mechanicLesson applies driver.ts own roll/gain to the skill, not just cash/clock', () => {
    const driver = makeDriver({ cash: 10_000, skills: { driving: 20, marksmanship: 20, mechanic: 10 } });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };
    // nextFloat() pinned to 0 always beats the (positive) success chance and
    // always rolls the minimum gain (lessonGainMinPoints = 1).
    const result = applyService(driver, world, 'mechanicLesson', forcedFloatRng(0));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.driver.skills.mechanic).toBe(11);
  });

  it('medicalPerPoint heals exactly one point of natural health, never past the cap', () => {
    const max = skillsConfig().driver.naturalHealthDP;
    const driver = makeDriver({ cash: 10_000, naturalHealth: max - 2 });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };

    const result = applyService(driver, world, 'medicalPerPoint', createRng('svc-medical'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.driver.naturalHealth).toBe(max - 1);
    expect(result.world.clock.dayIndex).toBe(economy().services.medicalPerPoint.days);

    const fullHealthDriver = makeDriver({ cash: 10_000, naturalHealth: max });
    const atCap = applyService(fullHealthDriver, world, 'medicalPerPoint', createRng('svc-medical-cap'));
    expect(atCap.ok).toBe(true);
    if (!atCap.ok) throw new Error('expected ok');
    expect(atCap.driver.naturalHealth).toBe(max); // never pushed past the cap
  });

  it('busToAdjacentCity moves the driver to a route-adjacent city', () => {
    const driver = makeDriver({ cash: 10_000, cityId: 'newyork' });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };
    const result = applyService(driver, world, 'busToAdjacentCity', createRng('svc-bus'), 'albany');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.driver.cityId).toBe('albany');
    expect(result.driver.cash).toBe(10_000 - economy().services.busToAdjacentCity.price);
  });

  it('busToAdjacentCity refuses (no charge, no travel) a missing or non-adjacent destination', () => {
    const driver = makeDriver({ cash: 10_000, cityId: 'newyork' });
    const world: EconomyWorld = { clock: initialClock(), vehicle: null, vehicleStored: false };

    const missing = applyService(driver, world, 'busToAdjacentCity', createRng('svc-bus-missing'));
    expect(missing).toEqual({ ok: false, reason: 'invalidDestination' });

    // watertown is nowhere near newyork on cities.json's route graph.
    const notAdjacent = applyService(driver, world, 'busToAdjacentCity', createRng('svc-bus-far'), 'watertown');
    expect(notAdjacent).toEqual({ ok: false, reason: 'invalidDestination' });
  });
});

// ---------------------------------------------------------------------------
// Salvage
// ---------------------------------------------------------------------------

describe('salvageRoll', () => {
  function makeWreck(overrides: Partial<Wreck> = {}): Wreck {
    return { id: 'wreck-1', burned: false, searched: false, weapons: [], gear: [], ...overrides };
  }

  it('burned wrecks always yield nothing, and mark searched', () => {
    const salvager: Salvager = { skill: 99, vehicle: make10600Vehicle() };
    const wreck = makeWreck({ burned: true });
    const rng = createRng('salvage-burned');

    const result = salvageRoll(salvager, wreck, rng);
    expect(result).toEqual({ ok: true, success: false, wreck: { ...wreck, searched: true } });
  });

  it('cannot be rerolled once searched', () => {
    const salvager: Salvager = { skill: 99, vehicle: make10600Vehicle() };
    const wreck = makeWreck({ searched: true });
    const rng = createRng('salvage-reroll');
    expect(salvageRoll(salvager, wreck, rng)).toEqual({ ok: false, reason: 'alreadySearched' });
  });

  it('a failed roll (rng.chance false, not burned) yields nothing but still marks searched', () => {
    const salvager: Salvager = { skill: 1, vehicle: make10600Vehicle() };
    const wreck = makeWreck({ weapons: [{ weaponId: 'laser', ammo: 0 }] });
    const result = salvageRoll(salvager, wreck, forcedRng(false));
    expect(result).toEqual({ ok: true, success: false, wreck: { ...wreck, searched: true } });
  });

  it('transfers matching-weapon ammo up to capacity, but the recovered gun body is still separate salvage cargo', () => {
    const vehicle = make10600Vehicle({
      weapons: [makeWeaponState('antitankgun', { ammo: 15, facing: 'FRONT' })],
    });
    const salvager: Salvager = { skill: 99, vehicle };
    const wreck = makeWreck({
      weapons: [{ weaponId: 'antitankgun', ammo: 10 }], // capacity 20, room is 20-15=5
    });
    const rng = forcedRng(true);

    const result = salvageRoll(salvager, wreck, rng);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.success) throw new Error('expected a successful roll');

    const antitank = result.vehicle.weapons.find((w) => w.weaponId === 'antitankgun');
    expect(antitank?.ammo).toBe(20); // 15 + min(5 room, 10 found) = 20, capped at capacity
    expect(result.cargo).toEqual([
      // The gun body (weightLb 615) is NOT installed and NOT discarded - it is
      // still a second, physical unit, plus the 5 rounds that didn't fit.
      { id: 'wreck-1-weapon-antitankgun', kind: 'salvage', weightLb: 615 + 5 * 10, spaces: 4, integrity: 100 },
    ]);
    expect(result.wreck.searched).toBe(true);
  });

  it('a matching weapon the mechanic has no room for still keeps the recovered gun as cargo (never evaporates)', () => {
    // Mounted laser has ammoCapacity 0, so room is always 0 - this used to
    // make the whole recovered $8,000 laser vanish on a successful roll.
    const vehicle = make10600Vehicle({ weapons: [makeWeaponState('laser', { ammo: 0, facing: 'FRONT' })] });
    const salvager: Salvager = { skill: 99, vehicle };
    const wreck = makeWreck({ weapons: [{ weaponId: 'laser', ammo: 0 }] });

    const result = salvageRoll(salvager, wreck, forcedRng(true));
    expect(result.ok).toBe(true);
    if (!result.ok || !result.success) throw new Error('expected a successful roll');
    expect(result.cargo).toEqual([{ id: 'wreck-1-weapon-laser', kind: 'salvage', weightLb: 500, spaces: 2, integrity: 100 }]);
  });

  it('a one-shot/removeAfterFire weapon is never auto-reloaded from salvage - the whole unit becomes cargo', () => {
    const vehicle = make10600Vehicle({ weapons: [makeWeaponState('heavyrocket', { ammo: 0, facing: 'FRONT' })] });
    const salvager: Salvager = { skill: 99, vehicle };
    const wreck = makeWreck({ weapons: [{ weaponId: 'heavyrocket', ammo: 1 }] });

    const result = salvageRoll(salvager, wreck, forcedRng(true));
    expect(result.ok).toBe(true);
    if (!result.ok || !result.success) throw new Error('expected a successful roll');

    const mountedRocket = result.vehicle.weapons.find((w) => w.weaponId === 'heavyrocket');
    expect(mountedRocket?.ammo).toBe(0); // never silently reloaded
    expect(result.cargo).toEqual([
      { id: 'wreck-1-weapon-heavyrocket', kind: 'salvage', weightLb: 100 + 1 * 0, spaces: 1, integrity: 100 },
    ]);
  });

  it('non-matching weapons and gear become abstract, non-installable salvage cargo', () => {
    const vehicle = make10600Vehicle({ weapons: [] }); // salvager has nothing mounted to match against
    const salvager: Salvager = { skill: 99, vehicle };
    const wreck = makeWreck({
      weapons: [{ weaponId: 'laser', ammo: 0 }],
      gear: [{ id: 'spare-parts', weightLb: 40, spaces: 2 }],
    });
    const rng = forcedRng(true);

    const result = salvageRoll(salvager, wreck, rng);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.success) throw new Error('expected a successful roll');
    expect(result.cargo).toEqual([
      { id: 'wreck-1-weapon-laser', kind: 'salvage', weightLb: 500, spaces: 2, integrity: 100 }, // laser weightLb(500) + 0 ammo
      { id: 'wreck-1-gear-spare-parts', kind: 'salvage', weightLb: 40, spaces: 2, integrity: 100 },
    ]);
  });
});
