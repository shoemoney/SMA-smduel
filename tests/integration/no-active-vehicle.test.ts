/**
 * "The driver owns no car right now" as a real, reachable game state.
 *
 * Found by playing the deployed build, not by reading code: selling the
 * active car at a salvage yard paid out, and then the identical
 * "Sell <name> — $<price>" row was on offer again at the same price the
 * moment the player walked back in. `@/ui/buildings/salvage`'s own
 * `sell-car` was correct all along — it credits the sale and hands back
 * `vehicle: null` — and `@/app`'s `applyBuildingContext` undid it on the way
 * out, because `??` reads a DELIBERATE null as "no value supplied" and fell
 * back to the pre-sale car.
 *
 * Three things fell out of that one `??`, and this suite pins all three:
 *
 *   1. A money printer. Sell, keep the cash, keep the car, sell again.
 *   2. A split roster. `sell-car` decrements `fleetSize` and
 *      `fleetAfterBuildingVisit` drops the car from `fleet`, while
 *      `state.vehicle` kept it — so the Fleet screen and the active car
 *      disagreed after every sale.
 *   3. An unreachable on-ramp. `amateur-night` is the only event with
 *      `vehicleSource: "house"`, and `@/sim/arena`'s `eligibilityFor` opens
 *      its `on-foot-under-threshold` branch with "is entered on foot" for
 *      any non-null vehicle. With the active car never null, the one event
 *      designed for a broke driver — a symmetric match in identical loaned
 *      Arena Karts, per arenas.json's own `houseVehicle.totalCount` note
 *      ("5 amateur-night opponents + the player's own loaner") — could not
 *      be entered by anybody, ever.
 *
 * Everything here runs through the REAL production seams (`buildingContextFrom`
 * -> `salvageEngine` -> `applyBuildingContext`, then `arenaActions` off the
 * resulting state), never a hand-written `vehicle: null` literal. That
 * matters most for the eligibility test: `tests/unit/arena.test.ts` already
 * proves `eligibilityFor(driver, null, 'amateur-night')` returns null, and
 * always did. The bug was never in `eligibilityFor`; it was that no state
 * the game could actually reach ever put a null in front of it. So the
 * carless driver here is one the sale produced.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  PLAYER_ID,
  applyBuildingContext,
  arenaExitVehicle,
  arenaPlayerVehicle,
  buildingContextFrom,
  gateRefusal,
  vehicleParkedAtGate,
  vehicleStateFromDesign,
  type CityRunState,
} from '@/app';
import { houseKartDesign, houseLoanerDesign, isHouseVehicleSalvageable, loanerVehicleDef } from '@/sim/arena';
import { computeBuild, roadLegalityMisses } from '@/sim/construct';
import { FACINGS, makeArmorRecord } from '@/sim/types';
import { economy, getWeapon, skillsConfig } from '@/data/rulesets';
import { initialClock } from '@/sim/calendar';
import { createDriver } from '@/sim/driver';
import type { DriverState, SkillName, VehicleDesign, VehicleState } from '@/sim/types';
import { createRng } from '@/util/rng';
import { arenaActions } from '@/ui/buildings/arena';
import { createSalvageState, salvageEngine, vehicleSaleValue } from '@/ui/buildings/salvage';
import type { MenuAction } from '@/ui/menu';
import { t } from '@/ui/strings';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOME = 'newyork';

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

/**
 * Deliberately BROKE and unknown, not a convenience: amateur-night's
 * `on-foot-under-threshold` eligibility gates on cash and prestige, and the
 * whole point of the event is that it is the one thing a driver with nothing
 * can enter. Cash 0 / prestige 0 is what a driver who just sold their last
 * asset and spent the proceeds looks like.
 */
function makeBrokeDriver(overrides: Partial<DriverState> = {}): DriverState {
  const result = createDriver('Broke', evenSkillSplit());
  if (!result.ok) throw new Error(`test fixture: expected a legal skill split, got "${result.reason}"`);
  return { ...result.driver, cash: 0, prestige: 0, cityId: HOME, ...overrides };
}

const TEST_DESIGN: VehicleDesign = {
  name: 'Only Car',
  bodyId: 'subcompact',
  chassisId: 'standard',
  suspensionId: 'light',
  plantId: 'small',
  tireId: 'standard',
  armor: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
  weapons: [],
};

function makeVehicle(id = 'veh-only'): VehicleState {
  return vehicleStateFromDesign(TEST_DESIGN, id, PLAYER_ID);
}

function makeCityRunState(overrides: Partial<CityRunState> = {}): CityRunState {
  const vehicle = makeVehicle();
  return {
    driver: makeBrokeDriver(),
    vehicle,
    vehicleStored: false,
    clock: initialClock(),
    cityId: HOME,
    sessionSeed: 'no-active-vehicle-seed',
    openDb: () => Promise.reject(new Error('test: no save database in a headless run')),
    rng: createRng('no-active-vehicle-seed').stream('driver'),
    search: '',
    rumorsHeardToday: new Map(),
    activeCourierJobs: [],
    fleet: { vehicles: [{ vehicle, stored: false, cityId: HOME }] },
    routeHistory: new Map(),
    quests: [],
    arenaRecord: { wins: 0, losses: 0 },
    ...overrides,
  };
}

/**
 * One whole salvage-yard visit, through the exact pair `showCity`'s
 * `openFacility` wires up: the context the panel is handed on entry, the
 * real `sell-car` action, and the context folded back onto the run state on
 * exit. The sale is only real if it survives THIS, which is precisely what
 * the shipped bug got wrong — `salvageEngine` alone has always been right.
 */
function sellTheCarAndWalkOut(state: CityRunState): CityRunState {
  const entered = buildingContextFrom(state);
  const sold = salvageEngine.activate(createSalvageState(entered), 'sell-car');
  return applyBuildingContext(state, sold.state.context);
}

function rowById(actions: readonly MenuAction[], id: string): MenuAction | undefined {
  return actions.find((action) => action.id === id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selling the only car leaves a driver with no active vehicle', () => {
  let start: CityRunState;
  let price: number;

  beforeEach(() => {
    start = makeCityRunState();
    if (start.vehicle === null) throw new Error('test fixture: the run state must start WITH a car');
    price = vehicleSaleValue(start.vehicle);
    expect(price).toBeGreaterThan(0); // a $0 car would make the double-payout assertion below vacuous
  });

  it('the sale survives the building exit, not just the panel — CityRunState.vehicle is null afterward', () => {
    const afterExit = sellTheCarAndWalkOut(start);
    expect(afterExit.vehicle).toBeNull();
    expect(afterExit.driver.cash).toBe(price);
  });

  it('selling the same car twice is impossible — walking back in offers no sell-car row at all', () => {
    const afterExit = sellTheCarAndWalkOut(start);

    // Walking back into the same salvage yard, the way the live site was
    // played: a fresh context off the POST-sale state.
    const reentered = buildingContextFrom(afterExit);
    const rows = salvageEngine.actions(createSalvageState(reentered));
    expect(rowById(rows, 'sell-car')).toBeUndefined();

    // Belt and braces on the payout itself: even activating the id by hand
    // cannot pay a second time.
    const again = applyBuildingContext(afterExit, salvageEngine.activate(createSalvageState(reentered), 'sell-car').state.context);
    expect(again.driver.cash).toBe(price);
    expect(again.vehicle).toBeNull();
  });

  it('the fleet roster and the active vehicle agree after a sale — neither keeps the sold car', () => {
    const afterExit = sellTheCarAndWalkOut(start);
    expect(afterExit.fleet.vehicles.map((entry) => entry.vehicle.id)).toEqual([]);
    expect(afterExit.vehicle).toBeNull();

    // `fleetSize` is what `@/ui/buildings/assembly`'s maxFleetSize gate
    // reads, so a roster that still carried the sold car would silently
    // spend a slot the driver no longer owns.
    expect(buildingContextFrom(afterExit).fleetSize).toBe(0);
    expect(buildingContextFrom(afterExit).fleetSize).toBeLessThan(economy().maxFleetSize);
  });

  it('a sale leaves a second, stored car as the only roster entry — the sold one goes, the spare stays', () => {
    const sold = makeVehicle('veh-sold');
    const spare = makeVehicle('veh-spare');
    const withSpare = makeCityRunState({
      vehicle: sold,
      fleet: {
        vehicles: [
          { vehicle: sold, stored: false, cityId: HOME },
          { vehicle: spare, stored: true, cityId: HOME },
        ],
      },
    });

    const afterExit = sellTheCarAndWalkOut(withSpare);
    expect(afterExit.vehicle).toBeNull();
    expect(afterExit.fleet.vehicles.map((entry) => entry.vehicle.id)).toEqual(['veh-spare']);
  });
});

describe("amateur-night, the broke driver's on-ramp, is reachable again", () => {
  it('eligibilityFor admits amateur-night for a carless, low-cash, low-prestige driver produced by a real sale', async () => {
    const { eligibilityFor } = await import('@/sim/arena');
    const afterExit = sellTheCarAndWalkOut(makeCityRunState({ driver: makeBrokeDriver({ cash: 0, prestige: 0 }) }));

    // Not a `null` literal handed to eligibilityFor — the state the sale
    // itself produced. That is the whole difference between this test and
    // tests/unit/arena.test.ts's own eligibility coverage, which passed
    // throughout the bug.
    expect(afterExit.vehicle).toBeNull();
    expect(eligibilityFor(afterExit.driver, afterExit.vehicle, 'amateur-night')).toBeNull();
  });

  it('the real arena panel offers amateur-night as an ELIGIBLE row to that same carless driver', () => {
    const afterExit = sellTheCarAndWalkOut(makeCityRunState({ driver: makeBrokeDriver({ cash: 0, prestige: 0 }) }));
    const rows = arenaActions(buildingContextFrom(afterExit));
    const amateurNight = rowById(rows, 'enter-amateur-night');

    // `@/ui/menu`'s handleMenuKey never dispatches ACTIVATE for an
    // ineligible row, so "eligible" is literally the difference between the
    // event being playable and being a dead line of text.
    expect(amateurNight?.eligible).toBe(true);
    expect(amateurNight?.reason).toBeUndefined();
  });

  it('that same driver is refused every own-vehicle event, so the on-ramp is the only door open', () => {
    const afterExit = sellTheCarAndWalkOut(makeCityRunState({ driver: makeBrokeDriver({ cash: 0, prestige: 0 }) }));
    const rows = arenaActions(buildingContextFrom(afterExit));

    expect(rowById(rows, 'enter-practice')?.eligible).toBe(false);
    expect(rowById(rows, 'enter-division-5')?.eligible).toBe(false);
    expect(rowById(rows, 'enter-unlimited')?.eligible).toBe(false);
  });

  it('the house lends a real House Loaner to a carless entrant, built from arenas.json rather than invented', () => {
    const loaner = arenaPlayerVehicle(null, 'amateur-night');
    const row = loanerVehicleDef();
    if (loaner === null) throw new Error('a house-sourced event must always produce a loaner');

    // Compared against the ruleset row, never a literal, so retuning the
    // loaner in arenas.json cannot silently leave the player in a car nobody
    // wrote down.
    expect(loaner.design).toEqual(houseLoanerDesign());
    expect(loaner.design.weapons.map((w) => ({ weaponId: w.weaponId, facing: w.facing, ammo: w.ammo }))).toEqual(
      row.weapons.map((w) => ({ weaponId: w.weaponId, facing: w.facing, ammo: w.ammo })),
    );
    expect(loaner.destroyed).toBe(false);
    expect(loaner.ownerId).toBe(PLAYER_ID);
  });

  // The fix for an unplayable amateur-night. The loaner used to BE the
  // opponents' row, which made a five-on-one in identical cars: the player
  // died around tick 152 on every seed and needed about 59 rounds to clear a
  // roster their 20-round magazine could never pay for. These assertions are
  // the ones that would have failed then.
  it('the loaner out-provisions the karts the house fields against it, in armor and in ammunition', () => {
    const loaner = houseLoanerDesign();
    const opponent = houseKartDesign();

    expect(loaner).not.toEqual(opponent);
    for (const facing of FACINGS) {
      expect({ facing, better: loaner.armor[facing] > opponent.armor[facing] }).toEqual({ facing, better: true });
    }

    const rounds = (design: typeof loaner): number => design.weapons.reduce((sum, w) => sum + w.ammo, 0);
    expect(rounds(loaner)).toBeGreaterThan(rounds(opponent));
    // Derived, never a literal: clearing the roster costs more rounds than any
    // ONE mount can legally hold, which is the whole reason the loaner carries
    // several. Whether the resulting allowance is enough is a balance question,
    // gated by the win-rate test in arena-victory.test.ts rather than guessed
    // at with a magic number here.
    const largestLegalMount = Math.max(...loaner.weapons.map((w) => getWeapon(w.weaponId).ammoCapacity));
    expect(rounds(loaner)).toBeGreaterThan(largestLegalMount);
  });

  it('the loaner is a legal build, so the house never lends a car the constructor would reject', () => {
    const build = computeBuild(houseLoanerDesign());
    expect({ legal: build.legal, violations: build.violations.map((v) => v.code) }).toEqual({ legal: true, violations: [] });
  });

  // Every mount sits AT the weapon's own capacity, never over it: @/sim/construct
  // rejects a mount above `ammoCapacity`, so a larger allowance has to come from
  // more mounts rather than a fatter magazine. Asserted so nobody "simplifies"
  // the four mounts into one oversized one and trips the build gate.
  it('no loaner mount exceeds its weapon capacity', () => {
    for (const mounted of houseLoanerDesign().weapons) {
      const capacity = getWeapon(mounted.weaponId).ammoCapacity;
      expect({ weaponId: mounted.weaponId, overCapacity: mounted.ammo > capacity }).toEqual({
        weaponId: mounted.weaponId,
        overCapacity: false,
      });
    }
  });

  it('an own-vehicle event fights in the driver\'s own car, and offers no loaner when they have none', () => {
    const own = makeVehicle('veh-own');
    expect(arenaPlayerVehicle(own, 'division-5')).toBe(own);
    expect(arenaPlayerVehicle(null, 'division-5')).toBeNull();
  });

  it('a non-salvageable loaner goes back to the house on the way out, win or lose — the driver leaves as carless as they arrived', () => {
    const loaner = arenaPlayerVehicle(null, 'amateur-night');
    if (loaner === null) throw new Error('a house-sourced event must always produce a loaner');

    // arenas.json: houseVehicle.salvageable is false ("House karts are never
    // salvageable, win or lose"). Asserted here so a ruleset flip is a test
    // change, not a silent gameplay change.
    expect(isHouseVehicleSalvageable()).toBe(false);
    expect(arenaExitVehicle(null, loaner, 'amateur-night')).toBeNull();
    expect(arenaExitVehicle(null, { ...loaner, destroyed: true }, 'amateur-night')).toBeNull();
  });

  it('an own-vehicle event hands the fought-in car back, wreck and all', () => {
    const own = makeVehicle('veh-own');
    expect(arenaExitVehicle(own, own, 'division-5')).toBe(own);

    const wreck = { ...own, destroyed: true };
    expect(arenaExitVehicle(own, wreck, 'division-5')).toBe(wreck);
  });
});

describe('crossing a city boundary parks the car at the gate', () => {
  const GATE = { x: -1.5, y: 10.5 };

  it('normalizes position and heading, and leaves everything else about the car alone', () => {
    // A car somewhere out on the plaza mid-drive, pointing wherever the driver
    // was last headed.
    const wandered: VehicleState = { ...makeVehicle('veh-wandered'), position: { x: 4, y: -7 }, headingRad: 2.5 };
    const parked = vehicleParkedAtGate(wandered, GATE);

    // City and road coordinates are different spaces, so the road's
    // `startPosition`/`routeHeadingRad` and the arena's initial player seat must
    // not depend on where in the plaza the driver stopped.
    expect(parked?.position).toEqual(GATE);
    expect(parked?.headingRad).toBe(0);
    expect(parked?.id).toBe('veh-wandered');
    expect(parked?.armorDP).toEqual(wandered.armorDP);
    expect(parked?.cargo).toEqual(wandered.cargo);
    expect(parked?.design).toEqual(wandered.design);
  });

  it('copies the gate rather than aliasing it, so a later move cannot write back through the car', () => {
    const gate = { x: 1, y: 2 };
    const parked = vehicleParkedAtGate(makeVehicle(), gate);
    expect(parked?.position).not.toBe(gate);
    expect(parked?.position).toEqual(gate);
  });

  it('has nothing to park for a carless driver', () => {
    expect(vehicleParkedAtGate(null, GATE)).toBeNull();
  });
});

/**
 * The city gate enforces what the strip promises.
 *
 * The strip said "Not road-legal" in amber and the constructor's LEGALITY panel
 * said the build was not ready, and then `openGatePrompt` waved the player onto
 * the highway anyway — its only eligibility check was "do you have a car". Codex
 * `gpt-6.1-sol` drove the deployed build, drove onto the route with a starter
 * car carrying 0 armour and 0 mounted, and named it exactly: "the warning
 * promises a restriction that the gate does not enforce."
 *
 * These run through the exported `gateRefusal` seam rather than a
 * reimplementation, so a test here can only pass if the real gate agrees. The
 * carless half of the same refusal had NO test at all before this — it was
 * decided inline in a closure nobody could reach.
 */
describe('gateRefusal — the gate enforces the promise the strip makes', () => {
  const gate = { x: 0, y: 0 };

  it('refuses when there is no car at all', () => {
    expect(gateRefusal(null)).toBe(t('ui.city.gateNoVehicle'));
  });

  it('refuses the starter car that could previously drive out unarmoured', () => {
    // `TEST_DESIGN` is this file's legal fixture, so strip the armour and the
    // weapon to reconstruct the exact state the reviewer drove with: named, but
    // carrying nothing. Driven through `vehicleParkedAtGate` first, because that
    // is the value the gate is handed.
    const stripped = makeVehicle('veh-starter');
    stripped.design = { ...stripped.design, armor: makeArmorRecord(0), weapons: [] };
    const parked = vehicleParkedAtGate(stripped, gate);
    expect(parked).not.toBeNull();

    const refusal = gateRefusal(parked);
    expect(refusal).not.toBeNull();
    // The refusal must NAME what is missing, or it is just a locked door.
    expect(refusal).toContain(t('ui.city.gateNotLegal'));
    expect(refusal).toContain(t('ui.city.gateNeedArmor'));
    expect(refusal).toContain(t('ui.city.gateNeedWeapon'));
  });

  it('refuses an unnamed car even when it is fully fitted', () => {
    // The inverse ordering check: a name is one of the three conditions, so a
    // fully-armoured, fully-armed, UNNAMED car must still be refused. Without
    // this, a rule written as "armour && weapon" would pass every other test here.
    const unnamed = legalVehicle('veh-unnamed');
    unnamed.design = { ...unnamed.design, name: '' };
    expect(gateRefusal(vehicleParkedAtGate(unnamed, gate))).toBe(
      `${t('ui.city.gateNotLegal')} ${t('ui.city.gateNeedName')}`,
    );
  });

  /**
   * `TEST_DESIGN` — this file's shared fixture — is named but carries ZERO
   * armour and ZERO weapons, deliberately: it is the bare car a broke driver
   * owns, which is the whole premise of the suite this block lives inside. So it
   * is exactly the state the gate must refuse, and useless as the "opens" case.
   * The legal variant is built here rather than borrowed, and the weapon id is
   * taken from the real `getWeapon` lookup instead of typed from memory — the
   * log has six fixtures that lied about the shape of the thing they stood for,
   * and `w-machine-gun` versus `machinegun` was one of them.
   */
  function legalVehicle(id = 'veh-legal'): VehicleState {
    const v = makeVehicle(id);
    const def = getWeapon('machinegun');
    v.design = {
      ...v.design,
      armor: makeArmorRecord(4),
      weapons: [{ weaponId: def.id, facing: 'FRONT', ammo: def.ammoCapacity }],
    };
    return v;
  }

  it('refuses the bare TEST_DESIGN, which is named but unfitted', () => {
    // Spelled out because it is the least obvious assertion here: `makeVehicle()`
    // is a legal-looking car as far as the rest of this file is concerned.
    const parked = vehicleParkedAtGate(makeVehicle('veh-bare'), gate);
    expect(roadLegalityMisses(parked!.design)).toEqual(['armor', 'weapon']);
    expect(gateRefusal(parked)).toBe(
      `${t('ui.city.gateNotLegal')} ${t('ui.city.gateNeedArmor')} · ${t('ui.city.gateNeedWeapon')}`,
    );
  });

  it('opens for a car that meets all three conditions', () => {
    expect(gateRefusal(vehicleParkedAtGate(legalVehicle(), gate))).toBeNull();
  });

  it('agrees with the constructor panel on every one of the three conditions', () => {
    // The anti-drift guard. The panel and the gate are two surfaces reading the
    // same rule, and the whole bug was that they were two surfaces reading two
    // copies of it. Asserted as `!gateRefusal <=> no misses` over a matrix, so a
    // future edit that reintroduces an independent check in either place fails.
    const conditions: ReadonlyArray<readonly [string, (d: VehicleDesign) => VehicleDesign]> = [
      ['fitted', (d) => d],
      ['fitted but unnamed', (d) => ({ ...d, name: '' })],
      ['fitted but unarmoured', (d) => ({ ...d, armor: makeArmorRecord(0) })],
      ['fitted but unarmed', (d) => ({ ...d, weapons: [] })],
    ];
    for (const [label, mutate] of conditions) {
      const vehicle = legalVehicle(`veh-${label}`);
      const design = mutate(vehicle.design);
      vehicle.design = design;
      const parked = vehicleParkedAtGate(vehicle, gate);
      const misses = roadLegalityMisses(design);
      expect(gateRefusal(parked) !== null, `${label}: gate should ${misses.length === 0 ? '' : 'not '}refuse`).toBe(
        misses.length > 0,
      );
    }
  });
});
