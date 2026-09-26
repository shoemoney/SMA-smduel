/**
 * Fleet management tests. Fixtures mirror tests/unit/services.test.ts's
 * shape but are kept local here (no cross-test-file dependency).
 *
 * Two things this file is careful NOT to do (see the calendar
 * cadence-not-hardcoded suite's own warning about tautological fixtures):
 *  - assert a cap/price number that could equally be satisfied by a
 *    hardcoded literal that happens to match the current ruleset content.
 *    The maxFleetSize test mocks `@/data/rulesets` to a DIFFERENT cap (3,
 *    not 8) and proves `addVehicle` moves with it.
 *  - let an "armor check pass by collision damage" style false-positive
 *    sneak in here as "a switch fee pass by store-price coincidence": the
 *    fee test also mocks storeCar's price to a nonzero value and checks the
 *    total charged reflects BOTH legs, not just retrieveCar's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialClock } from '@/sim/calendar';
import { economy, skillsConfig, getPlant, getWeapon } from '@/data/rulesets';
import type { DriverState, VehicleState, WeaponState } from '@/sim/types';
import type { Fleet } from '@/sim/services';
import type { BuildingContext } from '@/ui/buildings/shared';

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

function makeVehicle(id: string, overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id,
    ownerId: 'driver-1',
    design: {
      name: `Rig ${id}`,
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

const HOME = skillsConfig().startingLocation;
const AWAY = HOME === 'boston' ? 'newyork' : 'boston';

// Every mocked-ruleset test below unmocks in a `finally`, but a thrown
// assertion inside a `finally` (or a process kill) could in principle still
// skip it — this belt-and-suspenders `afterEach` guarantees no later test in
// this file (or any other, since Vitest module state is otherwise per-file)
// ever runs against a leaked `@/data/rulesets` mock.
afterEach(() => {
  vi.doUnmock('@/data/rulesets');
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// addVehicle: cap, duplicates, at-most-one-active
// ---------------------------------------------------------------------------

describe('addVehicle', () => {
  it('refuses the 9th car by name once the real fleet cap (8) is reached', async () => {
    const { addVehicle } = await import('@/sim/fleet');
    let fleet: Fleet = { vehicles: [] };
    const cap = economy().maxFleetSize;

    for (let i = 0; i < cap; i++) {
      const result = addVehicle(fleet, { vehicle: makeVehicle(`veh-${i}`), cityId: HOME, stored: true });
      expect(result.ok).toBe(true);
      if (result.ok) fleet = result.fleet;
    }
    expect(fleet.vehicles.length).toBe(cap);

    const ninth = addVehicle(fleet, { vehicle: makeVehicle('veh-ninth'), cityId: HOME, stored: true });
    expect(ninth).toEqual({ ok: false, reason: 'fleetFull' });
  });

  it('reads the cap from the ruleset rather than a hardcoded 8 — moves with a mocked cap of 3', async () => {
    const MOCK_CAP = 3;
    vi.resetModules();
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return { ...actual, economy: () => ({ ...actual.economy(), maxFleetSize: MOCK_CAP }) };
    });
    const { addVehicle } = await import('@/sim/fleet');

    let fleet: Fleet = { vehicles: [] };
    for (let i = 0; i < MOCK_CAP; i++) {
      const result = addVehicle(fleet, { vehicle: makeVehicle(`m-${i}`), cityId: HOME, stored: true });
      expect(result.ok).toBe(true);
      if (result.ok) fleet = result.fleet;
    }
    // The real cap (8) has three room to spare at MOCK_CAP=3; only a
    // ruleset-sourced check refuses here.
    const blocked = addVehicle(fleet, { vehicle: makeVehicle('m-blocked'), cityId: HOME, stored: true });
    expect(blocked).toEqual({ ok: false, reason: 'fleetFull' });
  });

  it('refuses a duplicate vehicle id', async () => {
    const { addVehicle } = await import('@/sim/fleet');
    const fleet = { vehicles: [{ vehicle: makeVehicle('dup'), cityId: HOME, stored: true }] };
    const result = addVehicle(fleet, { vehicle: makeVehicle('dup'), cityId: HOME, stored: false });
    expect(result).toEqual({ ok: false, reason: 'duplicateVehicle' });
  });

  it('refuses adding a second active vehicle by name — only one vehicle is ever active', async () => {
    const { addVehicle } = await import('@/sim/fleet');
    const fleet = { vehicles: [{ vehicle: makeVehicle('active-1'), cityId: HOME, stored: false }] };
    const result = addVehicle(fleet, { vehicle: makeVehicle('active-2'), cityId: HOME, stored: false });
    // The specific reason code — not just result.ok — is what proves this is
    // the at-most-one-active guard refusing rather than some other check;
    // `fleet` (the caller's own object, never mutated on a refusal) is what
    // actually still has exactly one active entry, not the discarded input
    // fixture the old assertion checked.
    expect(result).toEqual({ ok: false, reason: 'invalidRequest' });
    expect(fleet.vehicles.length).toBe(1);
    expect(fleet.vehicles.filter((entry) => !entry.stored)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// switchActiveVehicle: per-city retrieval, fee lands on retrieval, exactly
// one vehicle active before and after.
// ---------------------------------------------------------------------------

describe('switchActiveVehicle', () => {
  // NOT "refuses retrieving a car stored in a different city" — that
  // scenario is satisfied by `retrieveCar`'s OWN city guard regardless of
  // whether fleet.ts's pre-check (the `target === undefined || !target.stored
  // || target.cityId !== driver.cityId` line) exists at all, already proven
  // by deleting those lines and seeing all 12 tests stay green, and already
  // asserted identically in tests/unit/services.test.ts. The scenario below
  // is the one the pre-check actually earns its keep on: "switch" to the
  // vehicle that's already active. `target.stored` is false there, which
  // only fleet.ts's own pre-check catches — without it, the outgoing-car
  // garaging step below would run first (garaging the very vehicle being
  // "switched to"), then `retrieveCar` would find it freshly stored in the
  // driver's own city and happily retrieve it, turning a nonsense self-switch
  // into a real, charged, ok:true result instead of a refusal.
  it('refuses "switching" to the vehicle that is already active, without ever garaging or charging for it', async () => {
    const { switchActiveVehicle } = await import('@/sim/fleet');
    const fleet = {
      vehicles: [
        { vehicle: makeVehicle('already-active'), cityId: HOME, stored: false },
        { vehicle: makeVehicle('spare'), cityId: HOME, stored: true },
      ],
    };
    const driver = makeDriver({ cityId: HOME, cash: 1000 });

    const result = switchActiveVehicle(driver, fleet, initialClock(), 'already-active');
    expect(result).toEqual({ ok: false, reason: 'notStoredHere' });
  });

  it('charges only the retrieval fee (real ruleset data: storing is free) and swaps which car is active', async () => {
    const { switchActiveVehicle, activeVehicle } = await import('@/sim/fleet');
    const fleet = {
      vehicles: [
        { vehicle: makeVehicle('outgoing'), cityId: HOME, stored: false },
        { vehicle: makeVehicle('incoming'), cityId: HOME, stored: true },
      ],
    };
    const driver = makeDriver({ cityId: HOME, cash: 1000 });

    const result = switchActiveVehicle(driver, fleet, initialClock(), 'incoming');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.driver.cash).toBe(1000 - economy().services.retrieveCar.price);
    expect(result.cost).toBe(economy().services.retrieveCar.price);
    expect(activeVehicle(result.fleet)?.vehicle.id).toBe('incoming');
    expect(result.fleet.vehicles.filter((entry) => !entry.stored)).toHaveLength(1);

    const outgoingEntry = result.fleet.vehicles.find((e) => e.vehicle.id === 'outgoing');
    expect(outgoingEntry?.stored).toBe(true);
    expect(outgoingEntry?.cityId).toBe(HOME);
  });

  it('never charges storeCar.price for the switch, even when it is mocked nonzero — the whole storage-cycle fee lives in retrieveCar.price alone', async () => {
    const MOCK_STORE_PRICE = 77;
    const MOCK_RETRIEVE_PRICE = 133;
    vi.resetModules();
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        economy: () => ({
          ...actual.economy(),
          services: {
            ...actual.economy().services,
            storeCar: { ...actual.economy().services.storeCar, price: MOCK_STORE_PRICE },
            retrieveCar: { ...actual.economy().services.retrieveCar, price: MOCK_RETRIEVE_PRICE },
          },
        }),
      };
    });
    const { switchActiveVehicle } = await import('@/sim/fleet');

    const fleet = {
      vehicles: [
        { vehicle: makeVehicle('outgoing'), cityId: HOME, stored: false },
        { vehicle: makeVehicle('incoming'), cityId: HOME, stored: true },
      ],
    };
    const driver = makeDriver({ cityId: HOME, cash: 1000 });

    const result = switchActiveVehicle(driver, fleet, initialClock(), 'incoming');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // NOT MOCK_STORE_PRICE + MOCK_RETRIEVE_PRICE (210) — that was the bug.
    expect(result.cost).toBe(MOCK_RETRIEVE_PRICE);
    expect(result.driver.cash).toBe(1000 - MOCK_RETRIEVE_PRICE);
  });

  it('an unaffordable retrieval refuses the whole switch — the caller never sees the outgoing car parked without its replacement', async () => {
    const { switchActiveVehicle } = await import('@/sim/fleet');
    const fleet = {
      vehicles: [
        { vehicle: makeVehicle('outgoing'), cityId: HOME, stored: false },
        { vehicle: makeVehicle('incoming'), cityId: HOME, stored: true },
      ],
    };
    const driver = makeDriver({ cityId: HOME, cash: 0 });
    // Deep snapshots taken BEFORE the call — the real assertion this test
    // needs. `switchActiveVehicle` only ever returns new objects on ok:true,
    // so a failure that instead mutated the caller's own `fleet`/`driver` in
    // place (e.g. a future rewrite of the garaging step that pushes into
    // `fleet.vehicles` instead of copying it) would otherwise slip through
    // silently — the caller would go on using an `outgoing` car that looks
    // garaged with no active replacement to show for it, exactly the failure
    // mode this test's name warns about.
    const fleetBefore = structuredClone(fleet);
    const driverBefore = structuredClone(driver);

    const result = switchActiveVehicle(driver, fleet, initialClock(), 'incoming');
    expect(result).toEqual({ ok: false, reason: 'insufficientFunds' });
    expect(fleet).toEqual(fleetBefore);
    expect(driver).toEqual(driverBefore);
  });

  it('switching from having no active car at all charges only the retrieval leg', async () => {
    const { switchActiveVehicle, activeVehicle } = await import('@/sim/fleet');
    const fleet = { vehicles: [{ vehicle: makeVehicle('incoming'), cityId: HOME, stored: true }] };
    const driver = makeDriver({ cityId: HOME, cash: 1000 });

    const result = switchActiveVehicle(driver, fleet, initialClock(), 'incoming');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost).toBe(economy().services.retrieveCar.price);
    expect(activeVehicle(result.fleet)?.vehicle.id).toBe('incoming');
  });
});

// ---------------------------------------------------------------------------
// removeVehicle: destroyed active car leaves the fleet, stored cars survive.
// ---------------------------------------------------------------------------

describe('removeVehicle', () => {
  it('a destroyed active car is removed while stored cars remain', async () => {
    const { removeVehicle, activeVehicle } = await import('@/sim/fleet');
    const fleet = {
      vehicles: [
        { vehicle: makeVehicle('destroyed-active'), cityId: HOME, stored: false },
        { vehicle: makeVehicle('spare-1'), cityId: HOME, stored: true },
        { vehicle: makeVehicle('spare-2'), cityId: AWAY, stored: true },
      ],
    };

    const result = removeVehicle(fleet, 'destroyed-active');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.fleet.vehicles.map((e) => e.vehicle.id).sort()).toEqual(['spare-1', 'spare-2']);
    expect(activeVehicle(result.fleet)).toBeUndefined();
  });

  it('removing an id not in the fleet is refused by name, nothing mutated', async () => {
    const { removeVehicle } = await import('@/sim/fleet');
    const fleet = { vehicles: [{ vehicle: makeVehicle('spare'), cityId: HOME, stored: true }] };
    const result = removeVehicle(fleet, 'nope');
    expect(result).toEqual({ ok: false, reason: 'vehicleNotFound' });
  });
});

// ---------------------------------------------------------------------------
// Wiring: `removeVehicle` had zero production callers before this suite —
// `@/sim/fleet` exporting it proved nothing about whether a destroyed or
// sold car actually left the ROSTER (`fleet.vehicles`, the thing
// `addVehicle`'s `maxFleetSize` cap and `@/ui/buildings/assembly`'s own
// gate both read). These two tests drive the REAL production wiring —
// `@/app`'s `reconcileFleetWithVehicle` (destroyed path) and
// `fleetAfterBuildingVisit` composed with the REAL `@/ui/buildings/salvage`
// `salvageEngine` (sold path) — not `removeVehicle` directly, so a
// regression that un-wires either call site fails HERE, not just in
// fleet.ts's own (still-passing) unit tests above.
//
// MUTATION PROOF performed by hand while writing this suite (not committed
// as a second copy of these tests): stubbing `@/app`'s `reconcileFleetWithVehicle`
// to skip its `vehicle.destroyed` branch (falling straight through to the
// ordinary reconcile-in-as-active code) fails "a destroyed active car never
// makes it back into the fleet" below with the wrecked id still present in
// `fleet.vehicles`; stubbing `fleetAfterBuildingVisit` to ignore a null
// `ctx.vehicle` and always call `reconcileFleetWithVehicle` with the
// PRE-sale vehicle instead fails "a sold active car never makes it back into
// the fleet" the same way. Restoring both real implementations turns both
// back to green.
// ---------------------------------------------------------------------------

describe('destroyed/sold active car wired into the fleet roster', () => {
  it('a destroyed active car never makes it back into the fleet — reconcileFleetWithVehicle drops it instead of reconciling it in as still-active', async () => {
    const { reconcileFleetWithVehicle } = await import('@/app');
    const spare = makeVehicle('spare');
    const fleet = {
      vehicles: [
        { vehicle: makeVehicle('lost-in-combat'), cityId: HOME, stored: false },
        { vehicle: spare, cityId: HOME, stored: true },
      ],
    };
    // Exactly the shape `showArenaEvent`'s own exitBtn handler produces on a
    // forfeited exit: the player's own vehicle, `destroyed: true`, handed
    // back through the same seam every OTHER screen (road arrival, the Fleet
    // roster, the constructor) also folds its live vehicle through.
    const wreck = { ...makeVehicle('lost-in-combat'), destroyed: true };

    const nextFleet = reconcileFleetWithVehicle(fleet, wreck, false, HOME);
    expect(nextFleet.vehicles.map((e) => e.vehicle.id).sort()).toEqual(['spare']);

    // The cap this ghost used to lock forever: a destroyed car reconciled
    // back in as active still counts toward maxFleetSize (it's a real
    // `fleet.vehicles` entry either way) — proving it is truly gone, not
    // just relabeled, is what protects the cap.
    const { addVehicle } = await import('@/sim/fleet');
    const refilled = addVehicle(nextFleet, { vehicle: makeVehicle('new-build'), cityId: HOME, stored: false });
    expect(refilled.ok).toBe(true);
  });

  it('a sold active car never makes it back into the fleet — fleetAfterBuildingVisit drops it, driven through the real salvage-yard sell-car action', async () => {
    const { fleetAfterBuildingVisit } = await import('@/app');
    const { salvageEngine, createSalvageState } = await import('@/ui/buildings/salvage');
    const { createRng } = await import('@/util/rng');

    const soldVehicle = makeVehicle('for-sale');
    const spare = makeVehicle('spare');
    const ctx: BuildingContext = {
      driver: makeDriver({ cash: 0 }),
      clock: initialClock(),
      cityId: HOME,
      vehicle: soldVehicle,
      vehicleStored: false,
      fleetSize: 2,
      existingCarNames: [soldVehicle.design.name, spare.design.name],
      rng: createRng('fleet-test-salvage-seed'),
      rumorsHeardToday: new Map(),
      activeCourierJobs: [],
      routeHistory: new Map(),
    };

    // The REAL salvage-yard 'sell-car' action (@/ui/buildings/salvage.ts) —
    // not a hand-rolled `{ vehicle: null }` stand-in — is what actually
    // nulls `ctx.vehicle` out and pays the sale price.
    const activated = salvageEngine.activate(createSalvageState(ctx), 'sell-car');
    expect(activated.state.context.vehicle).toBeNull();
    expect(activated.state.context.driver.cash).toBeGreaterThan(0);

    const fleet = {
      vehicles: [
        { vehicle: soldVehicle, cityId: HOME, stored: false },
        { vehicle: spare, cityId: HOME, stored: true },
      ],
    };
    const nextFleet = fleetAfterBuildingVisit(fleet, soldVehicle.id, activated.state.context);
    expect(nextFleet.vehicles.map((e) => e.vehicle.id).sort()).toEqual(['spare']);
  });
});
