import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fleetHasRoom,
  fleetSize,
  rearm,
  recharge,
  repair,
  replaceTire,
  storeCar,
  retrieveCar,
  type Fleet,
  type FleetVehicle,
} from '@/sim/services';
import { drivingConfig, economy, getBody, getPlant, getTire, getWeapon, skillsConfig, wheelCount } from '@/data/rulesets';
import { initialClock } from '@/sim/calendar';
import type { DriverState, VehicleState, WeaponState } from '@/sim/types';

// ---------------------------------------------------------------------------
// Fixtures (same shape as tests/unit/economy.test.ts's, kept local here so
// this file has no cross-test-file dependency).
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
  const def = getWeapon(weaponId);
  return {
    weaponId,
    facing: 'FRONT',
    ammo: def.ammoCapacity,
    dp: def.maxDP,
    maxDP: def.maxDP,
    cooldownRemaining: 0,
    destroyed: false,
    ...overrides,
  };
}

/** van / standard chassis / light suspension / large plant / solid tires / one front antitankgun. */
function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
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
    weapons: [makeWeaponState('antitankgun', { ammo: 20 })],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// repair() - armor per-point
// ---------------------------------------------------------------------------

describe('repair: armor', () => {
  it('a partially-damaged armour facing repairs per point at the ruleset-derived cost', () => {
    const body = getBody('van');
    const factor = economy()._reconstruction.repairCostFactor;
    // FRONT is missing 10 of its 25 design points; buy back 6 of them.
    const vehicle = makeVehicle({ armorDP: { FRONT: 15, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 } });
    const expectedCost = Math.ceil(body.armorCostPerPoint * 6 * factor);
    const driver = makeDriver({ cash: expectedCost });

    const result = repair(driver, vehicle, initialClock(), [{ kind: 'armor', facing: 'FRONT', points: 6 }]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost).toBe(expectedCost);
    expect(result.driver.cash).toBe(0);
    expect(result.vehicle.armorDP.FRONT).toBe(21);
    // Untouched facings stay untouched.
    expect(result.vehicle.armorDP.REAR).toBe(20);
    expect(result.clock.dayIndex).toBe(economy().timeCostDays.repairCar);
  });

  it('cannot buy back more points than are actually missing', () => {
    const vehicle = makeVehicle({ armorDP: { FRONT: 23, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 } });
    const driver = makeDriver({ cash: 100_000 });

    const result = repair(driver, vehicle, initialClock(), [{ kind: 'armor', facing: 'FRONT', points: 10 }]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // Only 2 points were missing, so only 2 were bought and charged for.
    expect(result.vehicle.armorDP.FRONT).toBe(25);
    const body = getBody('van');
    const factor = economy()._reconstruction.repairCostFactor;
    expect(result.cost).toBe(Math.ceil(body.armorCostPerPoint * 2 * factor));
  });

  it('rejects a fractional points request instead of writing fractional armor DP', () => {
    const vehicle = makeVehicle({ armorDP: { FRONT: 20, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 } });
    const driver = makeDriver({ cash: 100_000 });

    const result = repair(driver, vehicle, initialClock(), [{ kind: 'armor', facing: 'FRONT', points: 2.5 }]);

    expect(result).toEqual({ ok: false, reason: 'invalidRequest' });
    // Nothing mutated.
    expect(vehicle.armorDP.FRONT).toBe(20);
    expect(driver.cash).toBe(100_000);
  });

  it('rejects a vanishingly small fractional points request too, not just an obviously fractional one', () => {
    const vehicle = makeVehicle({ armorDP: { FRONT: 20, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 } });
    const driver = makeDriver({ cash: 100_000 });

    const result = repair(driver, vehicle, initialClock(), [{ kind: 'armor', facing: 'FRONT', points: 0.0001 }]);

    expect(result).toEqual({ ok: false, reason: 'invalidRequest' });
  });

  it('a single-item batch that targets an already-full facing is a no-op and is refused, exactly like rearm on a full magazine', () => {
    const vehicle = makeVehicle({ armorDP: { FRONT: 25, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 } });
    const driver = makeDriver({ cash: 100_000 });

    const result = repair(driver, vehicle, initialClock(), [{ kind: 'armor', facing: 'FRONT', points: 5 }]);

    expect(result).toEqual({ ok: false, reason: 'invalidRequest' });
  });

  it('MULTI-ITEM BATCH, duplicate request: a facing named twice in one batch is priced against what is STILL missing at each step, not double-charged for the same points', () => {
    // Exact repro from the audit: FRONT missing 5 of design 25, two
    // identical 5-point requests in the same batch. Fair price is a SINGLE
    // repairCost(armor, 5 points) - the second request finds nothing left
    // to buy back and should cost $0, not another full 5-point charge.
    const body = getBody('van');
    const factor = economy()._reconstruction.repairCostFactor;
    const fairCost = Math.ceil(body.armorCostPerPoint * 5 * factor);
    const vehicle = makeVehicle({ armorDP: { FRONT: 20, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 } });
    const driver = makeDriver({ cash: 100_000 });

    const result = repair(driver, vehicle, initialClock(), [
      { kind: 'armor', facing: 'FRONT', points: 5 },
      { kind: 'armor', facing: 'FRONT', points: 5 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost).toBe(fairCost);
    expect(result.cost).not.toBe(fairCost * 2);
    expect(result.vehicle.armorDP.FRONT).toBe(25);
    expect(result.driver.cash).toBe(100_000 - fairCost);
  });

  it('MUTATION PROOF (charge-per-item-count regression guard): a batch of 10 identical armor requests still costs exactly one fair repair, not ten', () => {
    // A batch that multiplies cost by request-list length (the historical
    // bug) would charge 10x here; a correct implementation charges the same
    // as a single request because every duplicate after the first finds
    // nothing left missing.
    const body = getBody('van');
    const factor = economy()._reconstruction.repairCostFactor;
    const fairCost = Math.ceil(body.armorCostPerPoint * 5 * factor);
    const vehicle = makeVehicle({ armorDP: { FRONT: 20, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 } });
    const driver = makeDriver({ cash: 100_000 });

    const requests = Array.from({ length: 10 }, () => ({ kind: 'armor' as const, facing: 'FRONT' as const, points: 5 }));
    const result = repair(driver, vehicle, initialClock(), requests);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost).toBe(fairCost);
  });
});

// ---------------------------------------------------------------------------
// repair() - plant / weapon (fully or not at all)
// ---------------------------------------------------------------------------

describe('repair: plant and weapon components', () => {
  it('repairs the plant fully at repairCost(component) and never leaves it partially fixed', () => {
    const plant = getPlant('large');
    const vehicle = makeVehicle({ plantDP: 4 });
    // Derived independently from the documented formula (economy.ts's own
    // docstring: ceil(originalCost * missingDP/maxDP * factor)) rather than
    // by calling repairCost() with the same arguments services.ts builds -
    // that would only pin the argument tuple, never the price itself. See
    // the mutation proof below.
    const factor = economy()._reconstruction.repairCostFactor;
    const missingDP = plant.maxDP - 4;
    const expectedCost = Math.ceil(plant.price * (missingDP / plant.maxDP) * factor);
    const driver = makeDriver({ cash: expectedCost });

    const result = repair(driver, vehicle, initialClock(), [{ kind: 'plant' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.vehicle.plantDP).toBe(plant.maxDP);
    expect(result.cost).toBe(expectedCost);
  });

  it('repairs a damaged, destroyed weapon fully and clears `destroyed`', () => {
    const def = getWeapon('antitankgun');
    const vehicle = makeVehicle({ weapons: [makeWeaponState('antitankgun', { dp: 0, destroyed: true, ammo: 5 })] });
    // Same independent derivation as the plant test above - a fully-dead
    // weapon is missing its whole maxDP, so this reduces to ceil(price * factor).
    const factor = economy()._reconstruction.repairCostFactor;
    const expectedCost = Math.ceil(def.price * (def.maxDP / def.maxDP) * factor);
    const driver = makeDriver({ cash: expectedCost });

    const result = repair(driver, vehicle, initialClock(), [{ kind: 'weapon', weaponIndex: 0 }]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.vehicle.weapons[0]?.dp).toBe(def.maxDP);
    expect(result.vehicle.weapons[0]?.destroyed).toBe(false);
    // Ammo (rearm's job, not repair's) is untouched.
    expect(result.vehicle.weapons[0]?.ammo).toBe(5);
  });

  it('refuses (no charge, no mutation) a request naming a weapon slot that does not exist', () => {
    const vehicle = makeVehicle();
    const driver = makeDriver({ cash: 100_000 });
    const result = repair(driver, vehicle, initialClock(), [{ kind: 'weapon', weaponIndex: 9 }]);
    expect(result).toEqual({ ok: false, reason: 'weaponNotFound' });
  });

  it('a single-item batch that repairs an already-undamaged plant is a no-op and is refused, not a free day-consuming success', () => {
    const plant = getPlant('large');
    const vehicle = makeVehicle({ plantDP: plant.maxDP });
    const driver = makeDriver({ cash: 100_000 });
    const clockBefore = initialClock();

    const result = repair(driver, vehicle, clockBefore, [{ kind: 'plant' }]);

    expect(result).toEqual({ ok: false, reason: 'invalidRequest' });
    expect(driver.cash).toBe(100_000);
  });

  it('a single-item batch that repairs an already-undamaged weapon is a no-op and is refused', () => {
    const vehicle = makeVehicle({ weapons: [makeWeaponState('antitankgun')] }); // dp defaults to maxDP
    const driver = makeDriver({ cash: 100_000 });

    const result = repair(driver, vehicle, initialClock(), [{ kind: 'weapon', weaponIndex: 0 }]);

    expect(result).toEqual({ ok: false, reason: 'invalidRequest' });
  });

  it('MULTI-ITEM BATCH, duplicate plant request: the second copy finds nothing left to repair and is not double-charged', () => {
    const plant = getPlant('large');
    const factor = economy()._reconstruction.repairCostFactor;
    const missingDP = plant.maxDP - 1;
    const fairCost = Math.ceil(plant.price * (missingDP / plant.maxDP) * factor);
    const vehicle = makeVehicle({ plantDP: 1 });
    const driver = makeDriver({ cash: 100_000 });

    const result = repair(driver, vehicle, initialClock(), [{ kind: 'plant' }, { kind: 'plant' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost).toBe(fairCost);
    expect(result.cost).not.toBe(fairCost * 2);
    expect(result.vehicle.plantDP).toBe(plant.maxDP);
  });

  it('MULTI-ITEM BATCH, duplicate weapon request: the second copy finds the weapon already fully repaired by the first and is not double-charged', () => {
    const def = getWeapon('antitankgun');
    const factor = economy()._reconstruction.repairCostFactor;
    const fairCost = Math.ceil(def.price * (def.maxDP / def.maxDP) * factor);
    const vehicle = makeVehicle({ weapons: [makeWeaponState('antitankgun', { dp: 0, destroyed: true })] });
    const driver = makeDriver({ cash: 100_000 });

    const result = repair(driver, vehicle, initialClock(), [
      { kind: 'weapon', weaponIndex: 0 },
      { kind: 'weapon', weaponIndex: 0 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost).toBe(fairCost);
    expect(result.cost).not.toBe(fairCost * 2);
    expect(result.vehicle.weapons[0]?.dp).toBe(def.maxDP);
    expect(result.vehicle.weapons[0]?.destroyed).toBe(false);
  });

  it('a mixed multi-item batch (plant + weapon + armor together) charges the sum of each real repair, still one day, one atomic charge', () => {
    const plant = getPlant('large');
    const def = getWeapon('antitankgun');
    const body = getBody('van');
    const factor = economy()._reconstruction.repairCostFactor;
    const plantCost = Math.ceil(plant.price * ((plant.maxDP - 2) / plant.maxDP) * factor);
    const weaponCost = Math.ceil(def.price * (def.maxDP / def.maxDP) * factor);
    const armorCost = Math.ceil(body.armorCostPerPoint * 4 * factor);
    const vehicle = makeVehicle({
      plantDP: 2,
      weapons: [makeWeaponState('antitankgun', { dp: 0, destroyed: true })],
      armorDP: { FRONT: 21, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 },
    });
    const driver = makeDriver({ cash: 100_000 });

    const result = repair(driver, vehicle, initialClock(), [
      { kind: 'plant' },
      { kind: 'weapon', weaponIndex: 0 },
      { kind: 'armor', facing: 'FRONT', points: 4 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost).toBe(plantCost + weaponCost + armorCost);
    expect(result.vehicle.plantDP).toBe(plant.maxDP);
    expect(result.vehicle.weapons[0]?.dp).toBe(def.maxDP);
    expect(result.vehicle.armorDP.FRONT).toBe(25);
    expect(result.clock.dayIndex).toBe(economy().timeCostDays.repairCar); // still ONE day for the whole batch
  });
});

// ---------------------------------------------------------------------------
// Tires: REPLACED, never repaired
// ---------------------------------------------------------------------------

describe('replaceTire', () => {
  it('a destroyed tire is REPLACED (full price, not the repairCostFactor-scaled component formula) and restored to max DP', () => {
    const tire = getTire('solid');
    const vehicle = makeVehicle({ tireDP: [0, 12, 12, 12] });
    const driver = makeDriver({ cash: tire.price });

    const result = replaceTire(driver, vehicle, initialClock(), 0);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost).toBe(tire.price);
    expect(result.vehicle.tireDP).toEqual([tire.maxDP, 12, 12, 12]);
    expect(result.driver.cash).toBe(0);
    expect(result.clock.dayIndex).toBe(economy().timeCostDays.repairCar);
  });

  it('rejects an out-of-range wheel index without charging anything', () => {
    const vehicle = makeVehicle();
    const driver = makeDriver({ cash: 100_000 });
    expect(replaceTire(driver, vehicle, initialClock(), wheelCount()).ok).toBe(false);
    expect(replaceTire(driver, vehicle, initialClock(), -1).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rearm
// ---------------------------------------------------------------------------

describe('rearm', () => {
  it('refills to ammoCapacity and charges roundsNeeded * ammoCost, costing one weapon-transaction day', () => {
    const def = getWeapon('antitankgun');
    const vehicle = makeVehicle({ weapons: [makeWeaponState('antitankgun', { ammo: 5 })] });
    const roundsNeeded = def.ammoCapacity - 5;
    const expectedCost = roundsNeeded * def.ammoCost;
    const driver = makeDriver({ cash: expectedCost });

    const result = rearm(driver, vehicle, initialClock(), 0);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.vehicle.weapons[0]?.ammo).toBe(def.ammoCapacity);
    expect(result.cost).toBe(expectedCost);
    expect(result.driver.cash).toBe(0);
    expect(result.clock.dayIndex).toBe(economy().timeCostDays.weaponTransaction);
  });

  it('refuses to rearm the laser (battery-fed) and the spent one-shot heavy rocket (ammoCost 0)', () => {
    const driver = makeDriver({ cash: 100_000 });

    const laserVehicle = makeVehicle({ weapons: [makeWeaponState('laser', { ammo: 0 })] });
    expect(rearm(driver, laserVehicle, initialClock(), 0)).toEqual({ ok: false, reason: 'weaponCannotBeRearmed' });

    const rocketVehicle = makeVehicle({ weapons: [makeWeaponState('heavyrocket', { ammo: 0 })] });
    expect(rearm(driver, rocketVehicle, initialClock(), 0)).toEqual({ ok: false, reason: 'weaponCannotBeRearmed' });
  });

  it('refuses a no-op rearm on an already-full magazine instead of charging $0 and still burning a day', () => {
    const def = getWeapon('antitankgun');
    const vehicle = makeVehicle({ weapons: [makeWeaponState('antitankgun', { ammo: def.ammoCapacity })] });
    const driver = makeDriver({ cash: 100_000 });
    const clockBefore = initialClock();

    const result = rearm(driver, vehicle, clockBefore, 0);

    expect(result).toEqual({ ok: false, reason: 'invalidRequest' });
    expect(driver.cash).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// recharge
// ---------------------------------------------------------------------------

describe('recharge', () => {
  it('recharging from 98 and from 0 both cost the same flat price, both end at battery.full, and neither costs a day', () => {
    const svc = economy().services.batteryRecharge;

    for (const startingBattery of [0, 98]) {
      const vehicle = makeVehicle({ battery: startingBattery, batteryDebt: 0.7 });
      const driver = makeDriver({ cash: 1000 });

      const result = recharge(driver, vehicle, initialClock());

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.vehicle.battery).toBe(drivingConfig().battery.full);
      expect(result.driver.cash).toBe(1000 - svc.price);
      expect(result.clock.dayIndex).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Storage: charged on retrieval, per-city, counts against the fleet cap
// ---------------------------------------------------------------------------

function makeFleet(entries: readonly FleetVehicle[]): Fleet {
  return { vehicles: entries };
}

describe('storeCar / retrieveCar', () => {
  it('the storage fee lands on retrieval, not on storing', () => {
    const cityId = skillsConfig().startingLocation;
    const vehicle = makeVehicle();
    const driver = makeDriver({ cash: 1000, cityId });
    const fleet = makeFleet([{ vehicle, cityId, stored: false }]);

    const storeResult = storeCar(driver, fleet, initialClock(), vehicle.id);
    expect(storeResult.ok).toBe(true);
    if (!storeResult.ok) throw new Error('expected ok');
    expect(storeResult.driver.cash).toBe(1000); // storeCar's own price is 0
    expect(storeResult.fleet.vehicles[0]?.stored).toBe(true);
    expect(storeResult.fleet.vehicles[0]?.cityId).toBe(cityId);

    const retrieveResult = retrieveCar(storeResult.driver, storeResult.fleet, storeResult.clock, vehicle.id);
    expect(retrieveResult.ok).toBe(true);
    if (!retrieveResult.ok) throw new Error('expected ok');
    expect(retrieveResult.driver.cash).toBe(1000 - economy().services.retrieveCar.price);
    expect(retrieveResult.fleet.vehicles[0]?.stored).toBe(false);
  });

  it('a stored car is per-city: it cannot be retrieved from a different city', () => {
    const homeCity = skillsConfig().startingLocation;
    const vehicle = makeVehicle();
    const fleet = makeFleet([{ vehicle, cityId: homeCity, stored: true }]);
    const driverElsewhere = makeDriver({ cash: 1000, cityId: 'boston' });

    const result = retrieveCar(driverElsewhere, fleet, initialClock(), vehicle.id);
    expect(result).toEqual({ ok: false, reason: 'notStoredHere' });
  });

  it('fleetSize counts stored and active vehicles alike against the fleet cap of 8', () => {
    const cap = economy().maxFleetSize;

    const full: FleetVehicle[] = Array.from({ length: cap }, (_, i) => ({
      vehicle: makeVehicle({ id: `veh-${i}` }),
      cityId: skillsConfig().startingLocation,
      stored: i > 0,
    }));
    const fleet = makeFleet(full);

    expect(fleetSize(fleet)).toBe(cap);
    expect(fleetHasRoom(fleet)).toBe(false);
    expect(fleetHasRoom(makeFleet(full.slice(0, cap - 1)))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Every service: an unaffordable transaction leaves cash and vehicle untouched
// ---------------------------------------------------------------------------

describe('insufficient funds: nothing is charged, nothing is mutated', () => {
  it('repair refuses and leaves driver/vehicle exactly as they were', () => {
    const vehicle = makeVehicle({ armorDP: { FRONT: 0, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 } });
    const driver = makeDriver({ cash: 0 });

    const result = repair(driver, vehicle, initialClock(), [{ kind: 'armor', facing: 'FRONT', points: 25 }]);

    expect(result).toEqual({ ok: false, reason: 'insufficientFunds' });
    expect(driver.cash).toBe(0);
    expect(vehicle.armorDP.FRONT).toBe(0);
  });

  it('replaceTire refuses and leaves driver/vehicle exactly as they were', () => {
    const vehicle = makeVehicle({ tireDP: [0, 12, 12, 12] });
    const driver = makeDriver({ cash: 0 });

    const result = replaceTire(driver, vehicle, initialClock(), 0);

    expect(result).toEqual({ ok: false, reason: 'insufficientFunds' });
    expect(vehicle.tireDP).toEqual([0, 12, 12, 12]);
  });

  it('rearm refuses and leaves driver/vehicle exactly as they were', () => {
    const vehicle = makeVehicle({ weapons: [makeWeaponState('antitankgun', { ammo: 0 })] });
    const driver = makeDriver({ cash: 0 });

    const result = rearm(driver, vehicle, initialClock(), 0);

    expect(result).toEqual({ ok: false, reason: 'insufficientFunds' });
    expect(vehicle.weapons[0]?.ammo).toBe(0);
  });

  it('recharge refuses and leaves driver/vehicle exactly as they were', () => {
    const vehicle = makeVehicle({ battery: 3 });
    const driver = makeDriver({ cash: 0 });

    const result = recharge(driver, vehicle, initialClock());

    expect(result).toEqual({ ok: false, reason: 'insufficientFunds' });
    expect(vehicle.battery).toBe(3);
  });

  it('retrieveCar refuses and leaves driver/fleet exactly as they were', () => {
    const cityId = skillsConfig().startingLocation;
    const vehicle = makeVehicle();
    const fleet = makeFleet([{ vehicle, cityId, stored: true }]);
    const driver = makeDriver({ cash: 0, cityId });

    const result = retrieveCar(driver, fleet, initialClock(), vehicle.id);

    expect(result).toEqual({ ok: false, reason: 'insufficientFunds' });
    expect(fleet.vehicles[0]?.stored).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mocked-ruleset proof: prices/days genuinely come from economy.json /
// driving.json at call time, not a baked-in literal. Same technique as
// tests/unit/calendar.cadence-not-hardcoded.test.ts (swap in a DIFFERENT
// value and check the implementation's output moves with it), but done with
// `vi.doMock` + `vi.resetModules()` + a dynamic `import()` INSTEAD of a
// top-level `vi.mock`: `vi.mock` is hoisted above every import in the whole
// FILE, which would have silently rebased every earlier test in this file
// (e.g. "the storage fee lands on retrieval", which pays out of a $1000
// fixture) onto these same mocked prices. `vi.doMock` only takes effect for
// imports made after it runs, so it stays scoped to just these `it`s.
// ---------------------------------------------------------------------------

const MOCK_BATTERY_FULL = 42;
const MOCK_REPAIR_DAYS = 7;
const MOCK_WEAPON_TX_DAYS = 6;
const MOCK_RETRIEVE_PRICE = 4321;

async function importServicesWithMockedRulesets(): Promise<typeof import('@/sim/services')> {
  vi.resetModules();
  vi.doMock('@/data/rulesets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/data/rulesets')>();
    return {
      ...actual,
      economy: () => ({
        ...actual.economy(),
        timeCostDays: {
          ...actual.economy().timeCostDays,
          repairCar: MOCK_REPAIR_DAYS,
          weaponTransaction: MOCK_WEAPON_TX_DAYS,
        },
        services: {
          ...actual.economy().services,
          // economy.json's own `restoresTo` (99) is what `recharge()` actually
          // uses - `drivingConfig().battery.full` is only its fallback when
          // `restoresTo` is absent, so THIS is the field that has to move.
          batteryRecharge: { ...actual.economy().services.batteryRecharge, restoresTo: MOCK_BATTERY_FULL },
          retrieveCar: { ...actual.economy().services.retrieveCar, price: MOCK_RETRIEVE_PRICE },
        },
      }),
    };
  });
  return import('@/sim/services');
}

describe('rulesets are read live, not hardcoded', () => {
  afterEach(() => {
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });

  it('recharge fills to a mocked economy.json services.batteryRecharge.restoresTo instead of the real 99', async () => {
    const { recharge: mockedRecharge } = await importServicesWithMockedRulesets();
    const vehicle = makeVehicle({ battery: 1 });
    const driver = makeDriver({ cash: 1000 });
    const result = mockedRecharge(driver, vehicle, initialClock());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.vehicle.battery).toBe(MOCK_BATTERY_FULL);
    expect(result.vehicle.battery).not.toBe(99);
  });

  it('recharge falls back to a mocked driving.json battery.full when economy.json has no restoresTo', async () => {
    vi.resetModules();
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        drivingConfig: () => ({
          ...actual.drivingConfig(),
          battery: { ...actual.drivingConfig().battery, full: MOCK_BATTERY_FULL },
        }),
        economy: () => {
          const real = actual.economy();
          const { restoresTo: _restoresTo, ...batteryRechargeWithoutRestoresTo } = real.services.batteryRecharge;
          return { ...real, services: { ...real.services, batteryRecharge: batteryRechargeWithoutRestoresTo } };
        },
      };
    });
    const { recharge: mockedRecharge } = await import('@/sim/services');
    const vehicle = makeVehicle({ battery: 1 });
    const driver = makeDriver({ cash: 1000 });

    const result = mockedRecharge(driver, vehicle, initialClock());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.vehicle.battery).toBe(MOCK_BATTERY_FULL);
  });

  it('repair and rearm advance the clock by mocked economy.json day costs instead of the real ones', async () => {
    const { repair: mockedRepair, rearm: mockedRearm } = await importServicesWithMockedRulesets();
    // Damaged, so these are real repair/rearm work, not no-ops (which now
    // correctly refuse with invalidRequest instead of burning a mocked day).
    const vehicle = makeVehicle({
      plantDP: 1,
      weapons: [makeWeaponState('antitankgun', { ammo: 5 })],
    });
    const driver = makeDriver({ cash: 100_000 });

    const repairResult = mockedRepair(driver, vehicle, initialClock(), [{ kind: 'plant' }]);
    expect(repairResult.ok).toBe(true);
    if (!repairResult.ok) throw new Error('expected ok');
    expect(repairResult.clock.dayIndex).toBe(MOCK_REPAIR_DAYS);

    const rearmResult = mockedRearm(driver, vehicle, initialClock(), 0);
    expect(rearmResult.ok).toBe(true);
    if (!rearmResult.ok) throw new Error('expected ok');
    expect(rearmResult.clock.dayIndex).toBe(MOCK_WEAPON_TX_DAYS);
  });

  it('retrieveCar charges a mocked economy.json retrieveCar price instead of the real 50', async () => {
    const { retrieveCar: mockedRetrieveCar } = await importServicesWithMockedRulesets();
    const cityId = skillsConfig().startingLocation;
    const vehicle = makeVehicle();
    const fleet = makeFleet([{ vehicle, cityId, stored: true }]);
    const driver = makeDriver({ cash: MOCK_RETRIEVE_PRICE, cityId });

    const result = mockedRetrieveCar(driver, fleet, initialClock(), vehicle.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.driver.cash).toBe(0);
  });
});
