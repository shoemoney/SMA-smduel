import { describe, expect, it } from 'vitest';
import {
  allOpponentsDefeated,
  beginArenaMatch,
  eligibilityFor,
  getArenaEvent,
  houseKartDesign,
  houseVehicleDef,
  isHouseVehicleSalvageable,
  recordOpponentDefeated,
  resolveArenaExit,
  rosterFor,
  vehicleValue,
  type ArenaMatchState,
  type ArenaVehicleStatus,
} from '@/sim/arena';
import { computeBuild } from '@/sim/construct';
import { createDriver } from '@/sim/driver';
import { economy } from '@/data/rulesets';
import type { DriverState, VehicleDesign } from '@/sim/types';

function driverWith(cash: number, prestige: number): DriverState {
  const result = createDriver('Tester', {
    driving: 17,
    marksmanship: 17,
    mechanic: 16,
  });
  if (!result.ok) throw new Error(result.reason);
  return { ...result.driver, cash, prestige };
}

function vehicleFrom(design: VehicleDesign, destroyed = false): ArenaVehicleStatus {
  return { design, destroyed };
}

const OWN_KART = houseKartDesign();

describe('arena: house kart', () => {
  it('is a legal build through @/sim/construct with exactly one FRONT machine gun', () => {
    const metrics = computeBuild(houseKartDesign());
    expect(metrics.legal).toBe(true);
    expect(metrics.violations).toEqual([]);

    const design = houseKartDesign();
    expect(design.weapons).toHaveLength(1);
    expect(design.weapons[0]).toMatchObject({ weaponId: 'machinegun', facing: 'FRONT' });
  });

  it('is never salvageable', () => {
    expect(isHouseVehicleSalvageable()).toBe(false);
  });

  it('amateur-night rosters 5 house-kart opponents, 6 karts total counting the player', () => {
    const roster = rosterFor('amateur-night');
    expect(roster.opponentCount).toBe(5);
    expect(roster.vehicleSource).toBe('house');
    expect(roster.houseOpponentDesign).not.toBeNull();
    // Cross-checked against arenas.json's own houseVehicle.totalCount, not a
    // hardcoded 6 — this fails if the two numbers ever drift apart.
    expect(getArenaEvent('amateur-night').opponentCount + 1).toBe(houseVehicleDef().totalCount);
  });
});

describe('arena: eligibility', () => {
  it('an on-foot driver under the cash bar is eligible for amateur-night', () => {
    const driver = driverWith(4999, 99);
    expect(eligibilityFor(driver, null, 'amateur-night')).toBeNull();
  });

  it('an on-foot driver under the prestige bar is eligible for amateur-night', () => {
    const driver = driverWith(999_999, 5);
    expect(eligibilityFor(driver, null, 'amateur-night')).toBeNull();
  });

  it('an on-foot driver at both bars is NOT eligible for amateur-night', () => {
    const driver = driverWith(5000, 6);
    expect(eligibilityFor(driver, null, 'amateur-night')).not.toBeNull();
  });

  it('amateur-night refuses a driver who still has a vehicle', () => {
    const driver = driverWith(0, 0);
    expect(eligibilityFor(driver, vehicleFrom(OWN_KART), 'amateur-night')).not.toBeNull();
  });

  it('practice refuses a driver who cannot afford the entry fee', () => {
    const driver = driverWith(0, 0);
    expect(eligibilityFor(driver, vehicleFrom(OWN_KART), 'practice')).not.toBeNull();
  });

  it('practice accepts a driver with an active car and enough cash', () => {
    const driver = driverWith(2000, 0);
    expect(eligibilityFor(driver, vehicleFrom(OWN_KART), 'practice')).toBeNull();
  });

  it('a 9600-value car is refused from division-5 and accepted from division-10', () => {
    const design: VehicleDesign = {
      name: 'Test Rig',
      bodyId: 'subcompact',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'small',
      tireId: 'standard',
      armor: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
      weapons: [
        { weaponId: 'laser', facing: 'FRONT', ammo: 0 },
        { weaponId: 'paintsprayer', facing: 'REAR', ammo: 20 },
      ],
    };
    expect(vehicleValue(vehicleFrom(design))).toBe(9600);

    const driver = driverWith(0, 0);
    expect(eligibilityFor(driver, vehicleFrom(design), 'division-5')).not.toBeNull();
    expect(eligibilityFor(driver, vehicleFrom(design), 'division-10')).toBeNull();
  });

  it('value-capped events refuse a destroyed vehicle', () => {
    const driver = driverWith(0, 0);
    expect(eligibilityFor(driver, vehicleFrom(OWN_KART, true), 'division-10')).not.toBeNull();
  });
});

describe('arena: division value cap boundary', () => {
  // Both rigs share every component except the anti-tank gun's ammo count.
  // Costs, straight from the ruleset tables (construct.ts's costTotal =
  // bodyPrice*(1+chassisMod+suspMod) + plant.price + 4*tire.price +
  // sum(weapon.price + ammo*weapon.ammoCost) + armorCost):
  //   compact body 400 * (1 + 0 + 0)        = 400   (chassis: standard, suspension: light)
  //   large plant                            = 2000
  //   4 * heavy-duty tire (100 each)          = 400
  //   anti-tank gun                           = 2050
  //   armor (all zero)                        = 0
  //   subtotal before ammo                    = 4850
  // 3 rounds of ammo (50/round) = 150 -> 4850 + 150 = 5000, exactly
  // division-5's $5000 cap. One more round (200) -> 5050, over the cap.
  function rigWithAmmo(ammo: number): VehicleDesign {
    return {
      name: 'Cap Boundary Rig',
      bodyId: 'compact',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'large',
      tireId: 'heavyduty',
      armor: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
      weapons: [{ weaponId: 'antitankgun', facing: 'FRONT', ammo }],
    };
  }

  it('a vehicle valued at EXACTLY the cap is accepted', () => {
    const atCap = rigWithAmmo(3);
    expect(vehicleValue(vehicleFrom(atCap))).toBe(5000);
    const driver = driverWith(0, 0);
    expect(eligibilityFor(driver, vehicleFrom(atCap), 'division-5')).toBeNull();
  });

  it('a vehicle valued one increment OVER the cap is refused', () => {
    const overCap = rigWithAmmo(4);
    expect(vehicleValue(vehicleFrom(overCap))).toBe(5050);
    const driver = driverWith(0, 0);
    expect(eligibilityFor(driver, vehicleFrom(overCap), 'division-5')).not.toBeNull();
  });
});

describe('arena: victory, escape, and forfeiture', () => {
  function started(): ArenaMatchState {
    const driver = driverWith(1000, 10);
    const result = beginArenaMatch(driver, vehicleFrom(OWN_KART), 'division-15');
    if (!result.ok) throw new Error(result.reason);
    return result.state;
  }

  it('refuses to start when ineligible (destroyed vehicle, regardless of value)', () => {
    const driver = driverWith(0, 0);
    const destroyedKart: VehicleDesign = { ...OWN_KART, name: 'Destroyed Kart' };
    const result = beginArenaMatch(driver, vehicleFrom(destroyedKart, true), 'division-15');
    expect(result.ok).toBe(false);
  });

  it('pays out only after every opponent is defeated AND an under-power exit', () => {
    const driver = driverWith(1000, 10);
    let state = started();
    expect(state.opponentsTotal).toBe(5);

    // Escaping under power with 4/5 defeated: no payout, prestige drops.
    for (let i = 0; i < 4; i++) state = recordOpponentDefeated(state);
    expect(allOpponentsDefeated(state)).toBe(false);
    const earlyExit = resolveArenaExit(state, driver, 'UNDER_POWER');
    expect(earlyExit.outcome).toBe('ESCAPE');
    expect(earlyExit.cashAwarded).toBe(0);
    expect(earlyExit.prestigeDelta).toBeLessThan(0);
    expect(earlyExit.vehicleForfeited).toBe(false);

    // Defeat the 5th and exit under power: victory pays out.
    state = recordOpponentDefeated(state);
    expect(allOpponentsDefeated(state)).toBe(true);
    const victory = resolveArenaExit(state, driver, 'UNDER_POWER');
    expect(victory.outcome).toBe('VICTORY');
    expect(victory.cashAwarded).toBe(4500);
    expect(victory.prestigeDelta).toBe(2);
    expect(victory.vehicleForfeited).toBe(false);
    expect(victory.driver.cash).toBe(driver.cash + 4500);
    expect(victory.driver.skills.driving).toBeGreaterThan(driver.skills.driving);
    expect(victory.driver.skills.marksmanship).toBeGreaterThan(driver.skills.marksmanship);
    expect(victory.daysConsumed).toBe(1);
  });

  it('clearing the roster but exiting ON_FOOT still forfeits — no payout', () => {
    const driver = driverWith(1000, 10);
    let state = started();
    for (let i = 0; i < 5; i++) state = recordOpponentDefeated(state);
    expect(allOpponentsDefeated(state)).toBe(true);

    const resolution = resolveArenaExit(state, driver, 'ON_FOOT');
    expect(resolution.outcome).toBe('FORFEIT');
    expect(resolution.cashAwarded).toBe(0);
    expect(resolution.vehicleForfeited).toBe(true);
    expect(resolution.prestigeDelta).toBeLessThan(0);
  });

  it('an on-foot escape forfeits the car even with zero defeats', () => {
    const driver = driverWith(1000, 10);
    const state = started();
    const resolution = resolveArenaExit(state, driver, 'ON_FOOT');
    expect(resolution.outcome).toBe('FORFEIT');
    expect(resolution.vehicleForfeited).toBe(true);
    expect(resolution.cashAwarded).toBe(0);
  });

  it('an event always consumes exactly one day, win or escape', () => {
    const driver = driverWith(1000, 10);
    const state = started();
    expect(resolveArenaExit(state, driver, 'ON_FOOT').daysConsumed).toBe(1);
    expect(resolveArenaExit(state, driver, 'UNDER_POWER').daysConsumed).toBe(1);
  });
});

describe('arena: practice is not a free skill farm', () => {
  it('charges the arenaPractice entry fee when the match begins, not just gating on it', () => {
    const driver = driverWith(2000, 0);
    const fee = economy().services.arenaPractice.price;
    expect(fee).toBeGreaterThan(0);

    const begin = beginArenaMatch(driver, vehicleFrom(OWN_KART), 'practice');
    if (!begin.ok) throw new Error(begin.reason);
    expect(begin.driver.cash).toBe(driver.cash - fee);
  });

  it("consumes arenaPractice's own day cost (0), not the generic per-event day cost (1)", () => {
    const arenaPracticeDays = economy().services.arenaPractice.days;
    const genericArenaEventDays = economy().timeCostDays.arenaEvent;
    expect(arenaPracticeDays).not.toBe(genericArenaEventDays);

    const begin = beginArenaMatch(driverWith(2000, 0), vehicleFrom(OWN_KART), 'practice');
    if (!begin.ok) throw new Error(begin.reason);
    const resolution = resolveArenaExit(begin.state, begin.driver, 'UNDER_POWER');
    expect(resolution.daysConsumed).toBe(arenaPracticeDays);
  });

  it('repeated practice runs actually drain cash across five trips (was: cash never moved)', () => {
    const fee = economy().services.arenaPractice.price;
    let driver = driverWith(2000, 0);

    for (let i = 0; i < 5; i++) {
      const begin = beginArenaMatch(driver, vehicleFrom(OWN_KART), 'practice');
      if (!begin.ok) throw new Error(begin.reason);
      const resolution = resolveArenaExit(begin.state, begin.driver, 'UNDER_POWER');
      expect(resolution.outcome).toBe('VICTORY');
      driver = resolution.driver;
    }

    expect(driver.cash).toBe(2000 - fee * 5);
  });

  it('refuses to start once cash drops below the fee', () => {
    const fee = economy().services.arenaPractice.price;
    const driver = driverWith(fee - 1, 0);
    const begin = beginArenaMatch(driver, vehicleFrom(OWN_KART), 'practice');
    expect(begin.ok).toBe(false);
  });
});

describe('arena: house-sourced events never put a player vehicle at risk', () => {
  it('an on-foot exit from a house-sourced event (amateur-night) forfeits nothing — the player brought no vehicle', () => {
    const driver = driverWith(0, 0);
    const begin = beginArenaMatch(driver, null, 'amateur-night');
    if (!begin.ok) throw new Error(begin.reason);

    const resolution = resolveArenaExit(begin.state, begin.driver, 'ON_FOOT');
    expect(resolution.vehicleForfeited).toBe(false);
    // House stock is never salvageable, win or lose (arenas.json houseVehicle.salvageable).
    expect(resolution.houseVehicleSalvageable).toBe(isHouseVehicleSalvageable());
    expect(resolution.houseVehicleSalvageable).toBe(false);
  });

  it('the victory path on a house-sourced event also reports the salvage rule, not just false by omission', () => {
    const driver = driverWith(0, 0);
    const begin = beginArenaMatch(driver, null, 'amateur-night');
    if (!begin.ok) throw new Error(begin.reason);
    let state = begin.state;
    for (let i = 0; i < state.opponentsTotal; i++) state = recordOpponentDefeated(state);

    const resolution = resolveArenaExit(state, begin.driver, 'UNDER_POWER');
    expect(resolution.outcome).toBe('VICTORY');
    expect(resolution.vehicleForfeited).toBe(false);
    expect(resolution.houseVehicleSalvageable).toBe(false);
  });

  it('an own-vehicle event still forfeits on foot, and reports the salvage question as not-applicable', () => {
    const driver = driverWith(1000, 10);
    const begin = beginArenaMatch(driver, vehicleFrom(OWN_KART), 'division-15');
    if (!begin.ok) throw new Error(begin.reason);

    const resolution = resolveArenaExit(begin.state, begin.driver, 'ON_FOOT');
    expect(resolution.vehicleForfeited).toBe(true);
    expect(resolution.houseVehicleSalvageable).toBeNull();
  });
});
