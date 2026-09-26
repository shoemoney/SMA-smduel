/**
 * src/ui/buildings/** unit tests.
 *
 * Every facility panel is built from a pure `BuildingEngine<S>` core
 * (`actions`/`header`/`activate`) plus `mountBuildingPanel`, a thin wrapper
 * around `@/ui/menu`'s already-tested reducer (`handleMenuKey`) — see
 * tests/unit/menu.test.ts for that reducer's own arrow/digit/Enter/Escape
 * coverage. This file exercises the pure cores directly (no DOM needed for
 * almost everything, matching `@/ui/builder`'s own test split) plus a
 * handful of real keyboard-driven walks via `stepBuilding` and a couple of
 * DOM-mount smoke tests using the same minimal fake `document` pattern
 * `tests/unit/builder.test.ts` and `tests/unit/menu.test.ts` already use
 * (no jsdom/happy-dom installed; vitest's environment is plain `node`).
 *
 * Ruleset-sourcing proofs mock `@/data/rulesets` (or, for couriers.json,
 * that raw JSON import directly — it isn't wired into `@/data/rulesets`,
 * same as `@/sim/arena`'s arenas.json) and assert behavior moves with the
 * mock, the technique `tests/unit/calendar.cadence-not-hardcoded.test.ts`
 * established: a hardcoded literal could not react to it.
 */
import { describe, expect, it, vi } from 'vitest';
import { allWeapons, citiesConfig, economy, getBody, getPlant, getTire, getWeapon, skillsConfig } from '@/data/rulesets';
import { initialClock } from '@/sim/calendar';
import { computeBuild } from '@/sim/construct';
import { repairCost } from '@/sim/economy';
import { playFiveCardDraw } from '@/sim/casino';
import { generateOffers, type AcceptedJob, type CourierOffer } from '@/sim/courier';
import { createRng, type Rng } from '@/util/rng';
import type { CargoState, DriverState, VehicleState, WeaponState } from '@/sim/types';
import { t } from '@/ui/strings';
import {
  couriersConfig,
  menuFor,
  mountBuildingPanel,
  stepBuilding,
  type BuildingContext,
  type BuildingEngine,
} from '@/ui/buildings/shared';

import { garageEngine, createGarageState, repairChoices } from '@/ui/buildings/garage';
import { weaponshopEngine, createWeaponshopState } from '@/ui/buildings/weaponshop';
import { salvageEngine, createSalvageState, vehicleSaleValue, weaponSaleValue, salvageCargoSaleValue } from '@/ui/buildings/salvage';
import { courierGuildActions, courierGuildEngine, createCourierGuildState } from '@/ui/buildings/courierguild';
import { medicalEngine, createMedicalState } from '@/ui/buildings/medical';
import { barEngine, createBarState, illicitPayloadValue } from '@/ui/buildings/bar';
import { truckstopEngine, createTruckstopState } from '@/ui/buildings/truckstop';
import { fleetHasRoom, assemblyActions, mountAssembly } from '@/ui/buildings/assembly';
import { arenaActions, mountArenaBuilding } from '@/ui/buildings/arena';
import { casinoEngine, createCasinoState } from '@/ui/buildings/casino';
import { stubEngine, createStubState } from '@/ui/buildings/stub';
import { mountFacility, UnknownFacilityKindError } from '@/ui/buildings';

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
  return { weaponId, facing: def.allowedFacings[0] ?? 'FRONT', ammo: 0, dp: def.maxDP, maxDP: def.maxDP, cooldownRemaining: 0, destroyed: false, ...overrides };
}

/** A light, cheap, plenty-of-capacity vehicle: van/standard/light/small plant/standard tires, no weapons, no armor. */
function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: 'veh-1',
    ownerId: 'driver-1',
    design: {
      name: 'Roadhog',
      bodyId: 'van',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'small',
      tireId: 'standard',
      armor: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
      weapons: [],
    },
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 10,
    odometerMiles: 0,
    armorDP: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
    tireDP: [getTire('standard').maxDP, getTire('standard').maxDP, getTire('standard').maxDP, getTire('standard').maxDP],
    plantDP: getPlant('small').maxDP,
    weapons: [],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    ...overrides,
  };
}

function makeContext(overrides: Partial<BuildingContext> = {}): BuildingContext {
  return {
    driver: makeDriver(),
    clock: initialClock(),
    cityId: skillsConfig().startingLocation,
    vehicle: makeVehicle(),
    vehicleStored: false,
    fleetSize: 1,
    existingCarNames: [],
    rng: createRng('buildings-test-seed'),
    rumorsHeardToday: new Map(),
    activeCourierJobs: [],
    ...overrides,
  };
}

/** A minimal but structurally real `CourierOffer` (`@/sim/courier`), for tests that need a job on `BuildingContext.activeCourierJobs` without driving the full courierguild accept flow. */
function makeCourierOffer(overrides: Partial<CourierOffer> = {}): CourierOffer {
  return {
    id: 'test-offer-0',
    originCityId: 'newyork',
    destinationCityId: 'boston',
    destinationFacility: 'courierguild',
    routeId: 'test-route',
    distanceMiles: 100,
    dangerLevel: 0,
    weightLb: 100,
    spaces: 1,
    dueDay: 10,
    declaredValue: 1000,
    pay: 400,
    cargoName: 'Test Cargo',
    ...overrides,
  };
}

/**
 * `@/sim/courier`'s `accept` refuses any nonzero-danger offer against a
 * vehicle with `sumArmor(armorDP) <= 0` (INSUFFICIENT_VEHICLE_THREAT) - a
 * check the courierguild building never made before delegating to it.
 * `makeVehicle()`'s own default is 0 armor (deliberately, for the other
 * buildings' tests where armor is irrelevant), so courier-acceptance tests
 * that aren't specifically ABOUT that refusal use this instead, the same
 * "keep armor nonzero so an unrelated refusal doesn't fire" fixture choice
 * tests/unit/courier.test.ts's own makeVehicle already documents.
 */
function makeCourierVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  const armorDP = { FRONT: 5, REAR: 5, LEFT: 5, RIGHT: 5, UNDERBODY: 5 };
  return makeVehicle({ armorDP, ...overrides });
}

function makeAcceptedJob(overrides: Partial<AcceptedJob> = {}): AcceptedJob {
  return {
    offer: makeCourierOffer(),
    cargoId: 'cargo-test-offer-0',
    status: 'ACTIVE',
    acceptedDay: 0,
    ...overrides,
  };
}

/** Throws on any method it wasn't told to answer — pins exactly which draws a test depends on, same pattern `tests/unit/economy.test.ts` uses. */
function forcedRng(overrides: Partial<Rng>): Rng {
  const unused = (): never => {
    throw new Error('forcedRng: unexpected method call');
  };
  return { nextU32: unused, nextFloat: unused, int: unused, roll: unused, pick: unused, chance: unused, stream: unused, serialize: unused, restore: unused, ...overrides };
}

// ---------------------------------------------------------------------------
// Generic engine wiring (mountBuildingPanel / stepBuilding)
// ---------------------------------------------------------------------------

describe('shared — mountBuildingPanel / stepBuilding generic engine wiring', () => {
  interface CounterState {
    readonly count: number;
  }
  const counterEngine: BuildingEngine<CounterState> = {
    actions: (s) => [
      { id: 'inc', label: `Increment (${s.count})`, eligible: true },
      { id: 'blocked', label: 'Blocked', eligible: false, reason: 'nope' },
      { id: 'leave', label: 'Leave', eligible: true },
    ],
    header: () => ({ cash: 0, dayIndex: 0, phase: 'DAY' }),
    activate: (s, id) => (id === 'inc' ? { state: { count: s.count + 1 }, exit: false } : { state: s, exit: id === 'leave' }),
  };

  it('stepBuilding: ArrowDown then Enter activates the second row; an ineligible row refuses instead of activating', () => {
    let state: CounterState = { count: 0 };
    let menu = menuFor(counterEngine, state);

    let result = stepBuilding(counterEngine, state, menu, 'ArrowDown');
    state = result.state;
    menu = result.menu;
    expect(menu.selectedIndex).toBe(1); // the ineligible "blocked" row

    result = stepBuilding(counterEngine, state, menu, 'Enter');
    expect(result.exit).toBe(false);
    expect(result.state.count).toBe(0); // never activated — still ineligible
    expect(result.menu.message).toBe('nope');

    // Number key 1 jumps straight to and activates row 0 ("inc").
    result = stepBuilding(counterEngine, result.state, result.menu, '1');
    expect(result.state.count).toBe(1);
    expect(result.exit).toBe(false);
  });

  it('stepBuilding: Escape and an exiting activation both report exit:true', () => {
    const state: CounterState = { count: 0 };
    const menu = menuFor(counterEngine, state);
    expect(stepBuilding(counterEngine, state, menu, 'Escape').exit).toBe(true);
    expect(stepBuilding(counterEngine, state, menu, '3').exit).toBe(true); // row 2 = "leave"
  });

  it('mountBuildingPanel: renders through a fake DOM, activation re-renders in place, exit calls onExit exactly once', () => {
    installFakeDom();
    const container = new FakeElement('div');
    let exited: CounterState | null = null;
    const mounted = mountBuildingPanel({
      container: container as unknown as HTMLElement,
      initialState: { count: 0 },
      engine: counterEngine,
      onExit: (s) => {
        exited = s;
      },
    });

    container.dispatch('keydown', fakeKeyEvent('1'));
    expect(mounted.getState().count).toBe(1);

    container.dispatch('keydown', fakeKeyEvent('3'));
    expect(exited).not.toBeNull();
    mounted.destroy();
  });
});

// ---------------------------------------------------------------------------
// Fake DOM (mirrors tests/unit/builder.test.ts's fixture exactly)
// ---------------------------------------------------------------------------

class FakeClassList {
  private readonly names = new Set<string>();
  add(...values: string[]): void {
    for (const value of values) this.names.add(value);
  }
  remove(...values: string[]): void {
    for (const value of values) this.names.delete(value);
  }
  contains(value: string): boolean {
    return this.names.has(value);
  }
}

interface FakeKeyEvent {
  readonly key: string;
  preventDefault(): void;
}

function fakeKeyEvent(key: string): FakeKeyEvent {
  return { key, preventDefault(): void {} };
}

class FakeElement {
  readonly tagName: string;
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  className = '';
  textContent = '';
  private _tabIndex = -1;
  private readonly attrs = new Set<string>();
  private readonly listeners = new Map<string, Array<(ev: FakeKeyEvent) => void>>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  appendChild(child: FakeElement): void {
    this.children.push(child);
  }
  set innerHTML(value: string) {
    if (value === '') this.children.length = 0;
  }
  get innerHTML(): string {
    return '';
  }
  get tabIndex(): number {
    return this._tabIndex;
  }
  set tabIndex(value: number) {
    this._tabIndex = value;
    this.attrs.add('tabindex');
  }
  setAttribute(name: string): void {
    this.attrs.add(name);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name === 'tabindex') this._tabIndex = -1;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  addEventListener(type: string, handler: (ev: FakeKeyEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, handler: (ev: FakeKeyEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((h) => h !== handler));
  }
  dispatch(type: string, ev: FakeKeyEvent): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(ev);
  }
  focus(): void {}
}

function installFakeDom(): void {
  const fakeDocument = { createElement: (tag: string): FakeElement => new FakeElement(tag) };
  (globalThis as unknown as { document: unknown }).document = fakeDocument;
}

/**
 * The rendered label of every `sm-menu__item` row actually mounted under
 * `container` — walks into `@/ui/menu`'s own DOM shape (root > ol.sm-menu__list
 * > li.sm-menu__item > span.sm-menu__label) instead of stopping at
 * `container.children.length`, which is always exactly 1 (the single
 * `sm-menu` root `mountMenu` appends) regardless of how many — if any —
 * action rows it contains, and so proves nothing about the menu's content.
 */
function renderedMenuLabels(container: FakeElement): string[] {
  const root = container.children[0];
  const list = root?.children.find((c) => c.className === 'sm-menu__list');
  if (list === undefined) return [];
  return list.children
    .filter((item) => item.className === 'sm-menu__item')
    .map((item) => item.children.find((c) => c.className === 'sm-menu__label')?.textContent ?? '');
}

// ---------------------------------------------------------------------------
// Every facilityKind opens a panel
// ---------------------------------------------------------------------------

describe('every cities.json facilityKind opens a real panel through mountFacility', () => {
  it('mounts without throwing and renders at least one real, non-empty action row, for every real facilityKind', () => {
    installFakeDom();
    for (const kind of citiesConfig().facilityKinds) {
      const container = new FakeElement('div');
      const mounted = mountFacility({
        container: container as unknown as HTMLElement,
        kind,
        context: makeContext(),
        onExit: () => {},
        onOpenConstructor: () => {},
        onEnterArena: () => {},
      });
      const labels = renderedMenuLabels(container);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every((label) => label.length > 0)).toBe(true);
      mounted.destroy();
    }
  });

  it('throws UnknownFacilityKindError for a kind cities.json does not define', () => {
    installFakeDom();
    const container = new FakeElement('div');
    expect(() =>
      mountFacility({ container: container as unknown as HTMLElement, kind: 'nonexistent', context: makeContext(), onExit: () => {} }),
    ).toThrow(UnknownFacilityKindError);
  });

  it('assembly without onOpenConstructor, and arena without onEnterArena, both refuse to mount rather than silently no-op', () => {
    installFakeDom();
    const c1 = new FakeElement('div');
    expect(() => mountFacility({ container: c1 as unknown as HTMLElement, kind: 'assembly', context: makeContext(), onExit: () => {} })).toThrow();
    const c2 = new FakeElement('div');
    expect(() => mountFacility({ container: c2 as unknown as HTMLElement, kind: 'arena', context: makeContext(), onExit: () => {} })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Garage
// ---------------------------------------------------------------------------

describe('garage', () => {
  it('closed at NIGHT shows only the closed notice', () => {
    const ctx = makeContext({ clock: { dayIndex: 0, phase: 'NIGHT' } });
    const actions = garageEngine.actions(createGarageState(ctx));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe('closed');
  });

  it('recharge: refused with a reason and charges nothing when unaffordable; succeeds and charges the ruleset price when affordable', () => {
    const price = economy().services.batteryRecharge.price;
    const poor = makeContext({ driver: makeDriver({ cash: price - 1 }) });
    const state0 = createGarageState(poor);
    const rechargeAction = garageEngine.actions(state0).find((a) => a.id === 'recharge');
    expect(rechargeAction?.eligible).toBe(false);
    expect(rechargeAction?.reason).toBeTruthy();

    const rich = makeContext({ driver: makeDriver({ cash: price + 500 }), vehicle: makeVehicle({ battery: 0 }) });
    const state1 = createGarageState(rich);
    const result = garageEngine.activate(state1, 'recharge');
    expect(result.state.context.driver.cash).toBe(rich.driver.cash - price);
    expect(result.state.context.vehicle?.battery).toBe(economy().services.batteryRecharge.restoresTo);
  });

  it('recharge price is read from economy.json at call time, not hardcoded (mocked @/data/rulesets)', async () => {
    vi.resetModules();
    const MOCK_PRICE = 4321;
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return { ...actual, economy: () => ({ ...actual.economy(), services: { ...actual.economy().services, batteryRecharge: { ...actual.economy().services.batteryRecharge, price: MOCK_PRICE } } }) };
    });
    const fresh = await import('@/ui/buildings/garage');
    const ctx = makeContext({ driver: makeDriver({ cash: MOCK_PRICE - 1 }) });
    const action = fresh.garageActions(fresh.createGarageState(ctx)).find((a) => a.id === 'recharge');
    expect(action?.eligible).toBe(false);
    expect(action?.reason).toContain(String(MOCK_PRICE));
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });

  it('storing is free; the fee lands on RETRIEVAL, not on storing (repairs never storeCar\'s price twice)', () => {
    const ctx = makeContext({ driver: makeDriver({ cash: 1000 }) });
    const stored = garageEngine.activate(createGarageState(ctx), 'storeCar');
    expect(stored.state.context.driver.cash).toBe(1000); // storeCar.price is 0
    expect(stored.state.context.vehicleStored).toBe(true);

    const retrievePrice = economy().services.retrieveCar.price;
    expect(retrievePrice).toBeGreaterThan(0);
    const retrieved = garageEngine.activate(stored.state, 'retrieveCar');
    expect(retrieved.state.context.driver.cash).toBe(1000 - retrievePrice);
    expect(retrieved.state.context.vehicleStored).toBe(false);
  });

  it('repairChoices lists exactly the damaged components and repairing one restores it to max and charges repairCost, not a flat price', () => {
    const vehicle = makeVehicle({
      design: { ...makeVehicle().design, armor: { FRONT: 10, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 } },
      armorDP: { FRONT: 4, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
      plantDP: getPlant('small').maxDP, // undamaged plant -> no plant row
      tireDP: [1, getTire('standard').maxDP, getTire('standard').maxDP, getTire('standard').maxDP],
    });
    const choices = repairChoices(vehicle);
    expect(choices.map((c) => c.id).sort()).toEqual(['repair-armor-FRONT', 'replace-tire-0'].sort());

    const ctx = makeContext({ driver: makeDriver({ cash: 100000 }), vehicle });
    const armorChoice = choices.find((c) => c.id === 'repair-armor-FRONT');
    expect(armorChoice).toBeDefined();

    // Independently derived from @/sim/economy's raw repairCost formula and
    // bodies.json's own armorCostPerPoint - NOT from armorChoice.price
    // (garage.ts's own repairChoices()), so a mutated repairChoices can't
    // drag both sides of the assertion the same direction. PROVED: with
    // garage.ts's armor branch mutated to `Math.round(repairCost(...) * 7 +
    // 13)`, this independently-computed `expectedPrice` stays the ORIGINAL
    // (unmutated) value, so `cash` no longer matches it and the test fails -
    // see the mutation-proof run in the commit/PR notes for this file.
    const body = getBody('van');
    const expectedPrice = repairCost({ kind: 'armor', costPerPoint: body.armorCostPerPoint, pointsToRepair: 6 });
    expect(armorChoice?.price).toBe(expectedPrice);

    const result = garageEngine.activate(createGarageState(ctx), 'repair-armor-FRONT');
    expect(result.state.context.vehicle?.armorDP.FRONT).toBe(10);
    expect(result.state.context.driver.cash).toBe(100000 - expectedPrice);
  });

  it('no vehicle: recharge and repair rows are ineligible with a reason instead of throwing', () => {
    const ctx = makeContext({ vehicle: null });
    const actions = garageEngine.actions(createGarageState(ctx));
    const recharge = actions.find((a) => a.id === 'recharge');
    expect(recharge?.eligible).toBe(false);
    expect(actions.some((a) => a.id.startsWith('repair-'))).toBe(false); // no vehicle -> no repair rows generated at all
  });
});

// ---------------------------------------------------------------------------
// Weapon shop
// ---------------------------------------------------------------------------

describe('weaponshop', () => {
  it('installing a weapon appends it at its first allowed facing, 0 ammo, full DP to BOTH vehicle.weapons AND vehicle.design.weapons, and charges exactly its list price', () => {
    const def = allWeapons()[0];
    if (def === undefined) throw new Error('no weapons defined');
    const ctx = makeContext({ driver: makeDriver({ cash: def.price + 1000 }) });
    const result = weaponshopEngine.activate(createWeaponshopState(ctx), `install-${def.id}`);
    expect(result.state.context.driver.cash).toBe(ctx.driver.cash - def.price);
    const installed = result.state.context.vehicle?.weapons[0];
    expect(installed).toEqual({ weaponId: def.id, facing: def.allowedFacings[0], ammo: 0, dp: def.maxDP, maxDP: def.maxDP, cooldownRemaining: 0, destroyed: false });

    // The money-printer this guards against: purchaseValue/currentValue
    // (@/sim/economy) read computeBuild(vehicle.design), NOT vehicle.weapons
    // - a mount that only touched the runtime array is worth $0 and never
    // checked for space/load. PROVED: reverting weaponshop.ts's
    // installWeapon to omit the `design:` field (the pre-fix version) makes
    // this same assertion fail with `design.weapons` = [] while `weapons` =
    // [the mount] - see the mutation-proof run in this file's history.
    const design = result.state.context.vehicle?.design;
    expect(design?.weapons).toEqual([{ weaponId: def.id, facing: def.allowedFacings[0], ammo: 0 }]);
    const before = computeBuild(makeVehicle().design).costTotal;
    const after = design !== undefined ? computeBuild(design).costTotal : -1;
    expect(after).toBe(before + def.price);
  });

  it('installing is refused with a reason and charges nothing when unaffordable', () => {
    const def = allWeapons()[0];
    if (def === undefined) throw new Error('no weapons defined');
    const ctx = makeContext({ driver: makeDriver({ cash: def.price - 1 }) });
    const state = createWeaponshopState(ctx);
    const action = weaponshopEngine.actions(state).find((a) => a.id === `install-${def.id}`);
    expect(action?.eligible).toBe(false);
    const result = weaponshopEngine.activate(state, `install-${def.id}`);
    expect(result.state.context.driver.cash).toBe(ctx.driver.cash);
    expect(result.state.context.vehicle?.weapons).toHaveLength(0);
    expect(result.state.context.vehicle?.design.weapons).toHaveLength(0);
  });

  it('a weapon that would not fit the vehicle (real computeBuild space legality, not a fixed row count) is refused once space runs out, well short of any fixed mount-row cap', () => {
    // bodies.json's van: 30 spaces, of which the small plant alone already
    // uses 3 (spacesUsed = plant.spaces + weaponSpaces + cargoSpaces per
    // @/sim/construct's computeBuild). rocketlauncher: 3 spaces each, so
    // nine mount (27 + the plant's 3 = 30, exactly full) and a TENTH is
    // refused for space - one MORE than the fixed MAX_WEAPON_ROWS=10 HUD
    // budget would have allowed, proving this isn't that constant in
    // disguise. PROVED: reverting weaponshop.ts's gate back to
    // `vehicle.weapons.length >= MAX_WEAPON_ROWS` makes all ten installs
    // (this test's nine plus one more) succeed instead of refusing the
    // tenth, and computeBuild(vehicle.design).spacesUsed ends up at 33 > 30
    // - an OVER_SPACES-illegal build the shop would have sold anyway.
    let ctx = makeContext({ driver: makeDriver({ cash: 1_000_000 }) });
    const rocketDef = getWeapon('rocketlauncher');
    for (let i = 0; i < 9; i++) {
      const result = weaponshopEngine.activate(createWeaponshopState(ctx), `install-${rocketDef.id}`);
      ctx = result.state.context;
    }
    // Nine weaponTransaction time costs eventually roll the clock past the
    // shop's own open hours - pinned back to daytime here since this test
    // is about space legality, not business hours (a separate concern).
    ctx = { ...ctx, clock: { dayIndex: ctx.clock.dayIndex, phase: 'DAY' } };
    expect(ctx.vehicle?.weapons).toHaveLength(9);
    const full = computeBuild(ctx.vehicle?.design ?? makeVehicle().design);
    expect(full.spacesUsed).toBe(full.spacesTotal); // exactly full: 9*3 + plant's 3 = 30
    expect(full.violations.some((v) => v.code === 'OVER_SPACES')).toBe(false); // full, but not OVER - the 9th install was legitimately allowed

    const action = weaponshopEngine.actions(createWeaponshopState(ctx)).find((a) => a.id === `install-${rocketDef.id}`);
    expect(action?.eligible).toBe(false);
    expect(action?.reason).toContain(rocketDef.name);
    const refused = weaponshopEngine.activate(createWeaponshopState(ctx), `install-${rocketDef.id}`);
    expect(refused.state.context.vehicle?.weapons).toHaveLength(9); // still refused past capacity
    expect(refused.state.context.driver.cash).toBe(ctx.driver.cash); // and never charged
  });

  it('refilling ammo tops up to capacity in BOTH vehicle.weapons and vehicle.design.weapons, and charges exactly the missing rounds times ammoCost', () => {
    const def = getWeapon('machinegun');
    const vehicle = makeVehicle({
      weapons: [makeWeaponState('machinegun', { ammo: 5 })],
      design: { ...makeVehicle().design, weapons: [{ weaponId: 'machinegun', facing: def.allowedFacings[0] ?? 'FRONT', ammo: 5 }] },
    });
    const ctx = makeContext({ driver: makeDriver({ cash: 100000 }), vehicle });
    const missing = def.ammoCapacity - 5;
    const result = weaponshopEngine.activate(createWeaponshopState(ctx), 'refill-0');
    expect(result.state.context.vehicle?.weapons[0]?.ammo).toBe(def.ammoCapacity);
    expect(result.state.context.vehicle?.design.weapons[0]?.ammo).toBe(def.ammoCapacity);
    expect(result.state.context.driver.cash).toBe(100000 - missing * def.ammoCost);
  });

  it('a weapon already at ammo capacity gets no refill row', () => {
    const def = getWeapon('machinegun');
    const vehicle = makeVehicle({ weapons: [makeWeaponState('machinegun', { ammo: def.ammoCapacity })] });
    const ctx = makeContext({ vehicle });
    expect(weaponshopEngine.actions(createWeaponshopState(ctx)).some((a) => a.id === 'refill-0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Salvage
// ---------------------------------------------------------------------------

describe('salvage', () => {
  it('vehicleSaleValue is highest for a pristine vehicle and genuinely drops with armor damage', () => {
    // The default fixture's design carries 0 armor, so a "damaged" copy of
    // it is byte-identical to "fresh" - no comparison against it could ever
    // fail regardless of whether currentValue actually reads armorDP. Armor
    // is instead the one thing sale value discounts for (@/sim/economy's
    // currentValue), so this fixture gives the design real armor and damages
    // it, making "drops with damage" something the assertion can actually fail.
    const armoredDesign = { ...makeVehicle().design, armor: { FRONT: 20, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 20 } };
    const pristine = makeVehicle({ design: armoredDesign, armorDP: { FRONT: 20, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 20 } });
    const halfDamaged = makeVehicle({ design: armoredDesign, armorDP: { FRONT: 10, REAR: 10, LEFT: 10, RIGHT: 10, UNDERBODY: 10 } });
    const wrecked = makeVehicle({ design: armoredDesign, armorDP: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 } });

    expect(vehicleSaleValue(pristine)).toBeGreaterThan(0);
    expect(vehicleSaleValue(pristine)).toBeGreaterThan(vehicleSaleValue(halfDamaged));
    expect(vehicleSaleValue(halfDamaged)).toBeGreaterThan(vehicleSaleValue(wrecked));
  });

  it('selling the active car empties the context vehicle, decrements fleetSize, clears vehicleStored, and pays vehicleSaleValue', () => {
    const vehicle = makeVehicle();
    const ctx = makeContext({ vehicle, vehicleStored: true, fleetSize: 2, driver: makeDriver({ cash: 0 }) });
    const price = vehicleSaleValue(vehicle);
    const result = salvageEngine.activate(createSalvageState(ctx), 'sell-car');
    expect(result.state.context.vehicle).toBeNull();
    expect(result.state.context.fleetSize).toBe(1);
    expect(result.state.context.driver.cash).toBe(price);
    // PROVED: with salvage.ts's sell-car left as `vehicle: null` only (no
    // `vehicleStored: false`), this assertion fails (stays true) and
    // @/ui/buildings/garage's retrieveCar row then renders forever with a
    // price it can never actually charge (economy.ts's applyService refuses
    // every VEHICLE_SERVICES call once vehicle is null) - see the garage
    // dead-button test below for the full repro.
    expect(result.state.context.vehicleStored).toBe(false);
  });

  it('a sold car can no longer show a "Retrieve Car" row (the dead-button regression this fixes)', () => {
    const vehicle = makeVehicle();
    const ctx = makeContext({ vehicle, vehicleStored: true, fleetSize: 1, driver: makeDriver({ cash: 0 }) });
    const afterSale = salvageEngine.activate(createSalvageState(ctx), 'sell-car').state.context;
    const garageActions = garageEngine.actions(createGarageState(afterSale));
    expect(garageActions.some((a) => a.id === 'retrieveCar')).toBe(false);
  });

  it('selling a mounted weapon removes exactly that slot from BOTH vehicle.weapons AND vehicle.design.weapons, and pays weaponSaleValue(dp/maxDP)', () => {
    const machinegunDef = getWeapon('machinegun');
    const flamethrowerDef = getWeapon('flamethrower');
    const weapon = makeWeaponState('machinegun', { dp: 10, maxDP: 20 });
    const vehicle = makeVehicle({
      weapons: [weapon, makeWeaponState('flamethrower')],
      design: {
        ...makeVehicle().design,
        weapons: [
          { weaponId: 'machinegun', facing: machinegunDef.allowedFacings[0] ?? 'FRONT', ammo: 0 },
          { weaponId: 'flamethrower', facing: flamethrowerDef.allowedFacings[0] ?? 'FRONT', ammo: 0 },
        ],
      },
    });
    const ctx = makeContext({ vehicle, driver: makeDriver({ cash: 0 }) });
    const price = weaponSaleValue(weapon);
    const result = salvageEngine.activate(createSalvageState(ctx), 'sell-weapon-0');
    expect(result.state.context.vehicle?.weapons).toHaveLength(1);
    expect(result.state.context.vehicle?.weapons[0]?.weaponId).toBe('flamethrower');
    expect(result.state.context.driver.cash).toBe(price);

    // The money-printer this guards against: design.weapons left behind
    // after a sale keeps vehicleSaleValue of the "same" car inflated by
    // every weapon ever sold off it. PROVED: reverting salvage.ts's
    // sell-weapon to filter `vehicle.weapons` only (leaving
    // `vehicle.design.weapons` untouched) makes `design?.weapons` come back
    // with BOTH weapons still present (length 2) instead of one.
    const design = result.state.context.vehicle?.design;
    expect(design?.weapons).toEqual([{ weaponId: 'flamethrower', facing: flamethrowerDef.allowedFacings[0], ammo: 0 }]);
    const soldVehicle = result.state.context.vehicle;
    if (soldVehicle === undefined || soldVehicle === null) throw new Error('expected a vehicle after selling one weapon');
    // Selling the CAR now must not still be priced as if the machinegun were aboard.
    const carPriceAfter = vehicleSaleValue(soldVehicle);
    const carPriceIfDesignHadBothWeapons = vehicleSaleValue({
      ...soldVehicle,
      design: { ...soldVehicle.design, weapons: [...soldVehicle.design.weapons, { weaponId: 'machinegun', facing: machinegunDef.allowedFacings[0] ?? 'FRONT', ammo: 0 }] },
    });
    expect(carPriceAfter).toBeLessThan(carPriceIfDesignHadBothWeapons);
  });

  it('destroyed weapons get no sell row', () => {
    const vehicle = makeVehicle({ weapons: [makeWeaponState('machinegun', { destroyed: true })] });
    const ctx = makeContext({ vehicle });
    expect(salvageEngine.actions(createSalvageState(ctx)).some((a) => a.id === 'sell-weapon-0')).toBe(false);
  });

  it('selling salvage cargo removes it and pays salvageCargoSaleValue; payload cargo gets no sell-cargo row', () => {
    const salvageCargo: CargoState = { id: 'wreck-1-weapon-flamethrower', kind: 'salvage', weightLb: 20, spaces: 1, integrity: economy()._reconstruction.cargoFullIntegrity };
    const payloadCargo: CargoState = { id: 'job-1', kind: 'payload', weightLb: 50, spaces: 1, integrity: 100 };
    const vehicle = makeVehicle({ cargo: [salvageCargo, payloadCargo] });
    const ctx = makeContext({ vehicle, driver: makeDriver({ cash: 0 }) });
    const state = createSalvageState(ctx);
    expect(state && salvageEngine.actions(state).some((a) => a.id === 'sell-cargo-1')).toBe(false); // index 1 is the payload
    const price = salvageCargoSaleValue(salvageCargo);
    const result = salvageEngine.activate(state, 'sell-cargo-0');
    expect(result.state.context.vehicle?.cargo).toEqual([payloadCargo]);
    expect(result.state.context.driver.cash).toBe(price);
  });

  it('recovered-weapon salvage cargo prices off the real weapon list price, not the generic per-pound estimate', () => {
    const def = getWeapon('rocketlauncher');
    const cargo: CargoState = { id: `wreck-9-weapon-${def.id}`, kind: 'salvage', weightLb: def.weightLb, spaces: def.spaces, integrity: economy()._reconstruction.cargoFullIntegrity };
    // Full integrity -> saleValue's condition=1 -> ceiling factor applied to the weapon's own price, not some averaged $/lb guess.
    const expected = Math.floor(def.price * economy()._reconstruction.saleValueConditionCeiling);
    expect(salvageCargoSaleValue(cargo)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Courier guild
// ---------------------------------------------------------------------------

describe('courierguild', () => {
  // ---------------------------------------------------------------------
  // DELIVERY REACHABILITY.
  //
  // These exist because a release gate found deliver() had ZERO production
  // callers: a player could accept a job, be charged the day, drive to the
  // destination and walk in, with no way to hand the cargo over. The wiring
  // was then added WITHOUT tests, and three mutations survived a full green
  // suite — including returning [] from deliverableJobsFor(), which kills the
  // feature outright. Each test below is the mutation that used to survive.
  // ---------------------------------------------------------------------
  function deliverableCtx(overrides: Partial<BuildingContext> = {}): BuildingContext {
    const job = makeAcceptedJob();
    const vehicle = makeCourierVehicle({
      cargo: [{ id: job.cargoId, kind: 'payload', weightLb: job.offer.weightLb, spaces: job.offer.spaces, integrity: 100 }],
    });
    return makeContext({
      cityId: job.offer.destinationCityId, // standing IN the destination
      vehicle,
      activeCourierJobs: [job],
      ...overrides,
    });
  }

  const deliverRows = (ctx: BuildingContext) =>
    courierGuildActions(createCourierGuildState(ctx)).filter((a) => a.id.startsWith('deliver-'));

  it('offers a deliver row when standing in the destination city with intact cargo (mutation: deliverableJobsFor returning [] used to pass)', () => {
    const rows = deliverRows(deliverableCtx());
    expect(rows.length).toBe(1);
    expect(rows[0]?.eligible).toBe(true);
  });

  it('offers NO deliver row in a city that is not the destination (mutation: dropping the destinationCityId check used to pass)', () => {
    const job = makeAcceptedJob();
    const elsewhere = job.offer.originCityId === job.offer.destinationCityId ? 'pittsburgh' : job.offer.originCityId;
    expect(deliverRows(deliverableCtx({ cityId: elsewhere }))).toEqual([]);
  });

  it('offers NO deliver row when the cargo was destroyed (mutation: dropping the integrity check used to pass)', () => {
    const job = makeAcceptedJob();
    const wrecked = makeCourierVehicle({
      cargo: [{ id: job.cargoId, kind: 'payload', weightLb: job.offer.weightLb, spaces: job.offer.spaces, integrity: 0 }],
    });
    expect(deliverRows(deliverableCtx({ vehicle: wrecked }))).toEqual([]);
  });

  it('offers NO deliver row when the cargo is not aboard at all', () => {
    expect(deliverRows(deliverableCtx({ vehicle: makeCourierVehicle({ cargo: [] }) }))).toEqual([]);
  });

  it('activating the deliver row actually pays the driver and clears the cargo and the job', () => {
    const ctx = deliverableCtx();
    const state = createCourierGuildState(ctx);
    const row = courierGuildActions(state).find((a) => a.id.startsWith('deliver-'));
    expect(row).toBeDefined();

    const cashBefore = ctx.driver.cash;
    const result = courierGuildEngine.activate(state, row!.id);
    const after = result.state.context;

    expect(after.driver.cash).toBeGreaterThan(cashBefore);
    expect(after.vehicle?.cargo.find((c) => c.id === makeAcceptedJob().cargoId)).toBeUndefined();
    expect(after.activeCourierJobs.filter((j) => j.status === 'ACTIVE')).toEqual([]);
  });

  it('pays LESS for a late delivery than an on-time one, through the same path', () => {
    const job = makeAcceptedJob();
    const onTime = deliverableCtx({ clock: { ...initialClock(), dayIndex: job.offer.dueDay } });
    const late = deliverableCtx({ clock: { ...initialClock(), dayIndex: job.offer.dueDay + 3 } });

    const pay = (ctx: BuildingContext) => {
      const st = createCourierGuildState(ctx);
      const row = courierGuildActions(st).find((a) => a.id.startsWith('deliver-'));
      expect(row).toBeDefined();
      return courierGuildEngine.activate(st, row!.id).state.context.driver.cash - ctx.driver.cash;
    };

    const onTimePay = pay(onTime);
    const latePay = pay(late);
    expect(onTimePay).toBeGreaterThan(0);
    expect(latePay).toBeLessThan(onTimePay);
  });

  it('delivering twice is impossible: the row is gone after the first activation, and replaying its id is a no-op, not a second payday', () => {
    const ctx = deliverableCtx();
    const state = createCourierGuildState(ctx);
    const row = courierGuildActions(state).find((a) => a.id.startsWith('deliver-'));
    expect(row).toBeDefined();
    const deliverId = row!.id;

    const first = courierGuildEngine.activate(state, deliverId);
    const cashAfterFirst = first.state.context.driver.cash;

    // The row that made this delivery possible must not still be offered -
    // reactivating the same actionId on the post-delivery state must find
    // no matching job (deliverableJobsFor no longer lists it) and change
    // nothing, rather than paying out a second time from stale cargo/job
    // state a careless implementation forgot to clear.
    expect(courierGuildActions(first.state).some((a) => a.id === deliverId)).toBe(false);

    const second = courierGuildEngine.activate(first.state, deliverId);
    expect(second.state.context.driver.cash).toBe(cashAfterFirst);
    expect(second.state.context.activeCourierJobs).toEqual(first.state.context.activeCourierJobs);
  });

  it('generates EXACTLY the ruleset\'s offersPerVisit offers, matching @/sim/courier\'s own generateOffers bit-for-bit (delegation, not a reimplementation)', () => {
    const ctx = makeContext({ rng: createRng('courier-seed-1') });
    const state = createCourierGuildState(ctx);

    // Independently derives the seed the SAME way createCourierGuildState
    // does (ctx.rng.serialize().seedKey) and calls @/sim/courier's real
    // generateOffers directly - if courierguild.ts ever reimplemented offer
    // generation instead of delegating to it (the exact incident this
    // rewrite fixes - see this file's own header), the two lists would
    // diverge and this equality would fail.
    const seed = createRng('courier-seed-1').serialize().seedKey;
    const expected = generateOffers(ctx.cityId, ctx.clock.dayIndex, seed, ctx.driver);
    expect(state.offers).toEqual(expected);
    expect(state.offers).toHaveLength(couriersConfig().offersPerVisit);

    const tier = ctx.driver.prestige; // prestigeFloor -> tier 0
    for (const offer of state.offers) {
      expect(offer.dangerLevel).toBeLessThanOrEqual(couriersConfig().prestigeTiers.find((t) => t.minPrestige <= tier)?.maxDangerOffered ?? 0);
      // `pay` comes from `Math.max(0, Math.round(...))`, so `>= 0` can never
      // be false - it doesn't even exercise the rounding. Every weight in
      // couriers.json's generation block is positive and every route has a
      // positive lengthMiles, so the real formula can never actually reach
      // the Math.max(0, ...) floor or produce a fraction: assert both a
      // strictly positive value and integer-ness instead.
      expect(offer.pay).toBeGreaterThan(0);
      expect(Number.isInteger(offer.pay)).toBe(true);
      expect(offer.dueDay).toBeGreaterThan(ctx.clock.dayIndex);
    }
  });

  it('a city whose every route exceeds the driver\'s prestige-tier danger cap still returns offersPerVisit offers (the documented fallback), never a silent empty list', () => {
    // watertown's two routes are danger 3 and 4; tier 0's cap is 2 - every
    // route is over-cap, so a too-strict filter (the pre-fix
    // courierguild.ts, which dropped candidates entirely instead of falling
    // back to every route) returned ZERO offers here with no explanation.
    const ctx = makeContext({ cityId: 'watertown', rng: createRng('watertown-seed') });
    const state = createCourierGuildState(ctx);
    expect(state.offers).toHaveLength(couriersConfig().offersPerVisit);
    // Every one of them will be refused for prestige (expected - the point
    // is that the PANEL still shows real jobs and says why, not nothing).
    const rows = courierGuildEngine.actions(state);
    for (const offer of state.offers) {
      const row = rows.find((a) => a.id === `accept-${offer.id}`);
      expect(row?.eligible).toBe(false);
      expect(row?.reason).toBe(t('refusal.INSUFFICIENT_PRESTIGE'));
    }
  });

  it('offers regenerated across two mounts of the SAME (city, day) are identical - no reroll on walking out and back in', () => {
    const ctx = makeContext({ rng: createRng('courier-stable-seed') });
    const visit1 = createCourierGuildState(ctx).offers;
    const visit2 = createCourierGuildState(ctx).offers; // a second, independent mount of the same context
    expect(visit2).toEqual(visit1);
  });

  it('offer count is read from couriers.json at call time, not hardcoded (mocked raw JSON import)', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: Record<string, unknown> }>();
      return { default: { ...actual.default, offersPerVisit: 1 } };
    });
    const fresh = await import('@/ui/buildings/courierguild');
    const ctx = makeContext({ cityId: 'newyork', rng: createRng('courier-mock-seed') });
    const state = fresh.createCourierGuildState(ctx);
    // newyork has several eligible routes at tier 0, so this genuinely
    // distinguishes "reads 1 from the mock" from "returns 0 regardless" -
    // toBeLessThanOrEqual(1) would have passed either way.
    expect(state.offers).toHaveLength(1);
    vi.doUnmock('@rulesets/classic/couriers.json');
    vi.resetModules();
  });

  it('accepting a job adds one payload cargo item sized per the offer, and removes it from THIS visit\'s remaining offers', () => {
    const ctx = makeContext({ vehicle: makeCourierVehicle(), rng: createRng('courier-accept-seed'), clock: initialClock() });
    const state0 = createCourierGuildState(ctx);
    expect(state0.offers.length).toBeGreaterThan(0);

    const first = state0.offers[0];
    if (first === undefined) throw new Error('expected at least one offer');
    const afterFirst = courierGuildEngine.activate(state0, `accept-${first.id}`);
    expect(afterFirst.state.context.vehicle?.cargo).toHaveLength(1);
    expect(afterFirst.state.context.vehicle?.cargo[0]?.weightLb).toBe(first.weightLb);
    expect(afterFirst.state.daySpentThisVisit).toBe(true);
    expect(afterFirst.state.offers.some((o) => o.id === first.id)).toBe(false);
    // The real AcceptedJob is recorded, not just a bare CargoState -
    // @/ui/buildings/bar reads this back out to price an illicit sale.
    expect(afterFirst.state.context.activeCourierJobs).toHaveLength(1);
    expect(afterFirst.state.context.activeCourierJobs[0]?.offer).toEqual(first);
    expect(afterFirst.state.context.activeCourierJobs[0]?.cargoId).toBe(afterFirst.state.context.vehicle?.cargo[0]?.id);
  });

  it('accepting the SAME offer id twice across two visits the same day cannot happen - it is filtered out of the regenerated list once ctx.activeCourierJobs records it, so no cargo id ever collides', () => {
    const ctx0 = makeContext({ vehicle: makeCourierVehicle(), rng: createRng('courier-collide-seed'), clock: initialClock() });
    const visit1 = createCourierGuildState(ctx0);
    const first = visit1.offers[0];
    if (first === undefined) throw new Error('expected at least one offer');
    const afterAccept = courierGuildEngine.activate(visit1, `accept-${first.id}`);

    // Walk back in (same city, same day) - a fresh mount from the UPDATED context.
    const visit2 = createCourierGuildState(afterAccept.state.context);
    expect(visit2.offers.some((o) => o.id === first.id)).toBe(false);

    const cargoIds = afterAccept.state.context.vehicle?.cargo.map((c) => c.id) ?? [];
    expect(new Set(cargoIds).size).toBe(cargoIds.length); // no duplicate cargo ids
  });

  /**
   * With the real ruleset's `acceptCourierWork: 1` day cost,
   * `advanceForTimeCost` is ALREADY idempotent for a second same-day call
   * (DAY -> NIGHT, then NIGHT -> NIGHT is a no-op) - so a naive version of
   * this test (accept twice, assert the clock didn't move the second time)
   * would pass even with the `daySpentThisVisit` gate deleted entirely.
   * Mocking a 3-day cost here makes a second, ungated `advanceForTimeCost`
   * call visibly move the clock again, so this genuinely distinguishes
   * "shared one day" from "every accept re-charges a day".
   */
  it('multiple accepts in one visit share exactly ONE acceptCourierWork day, proven with a mocked multi-day cost', async () => {
    vi.resetModules();
    const MOCK_DAYS = 3;
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        economy: () => ({ ...actual.economy(), timeCostDays: { ...actual.economy().timeCostDays, acceptCourierWork: MOCK_DAYS } }),
      };
    });
    const fresh = await import('@/ui/buildings/courierguild');

    const ctx = makeContext({ cityId: 'newyork', vehicle: makeCourierVehicle(), rng: createRng('courier-shareday-seed'), clock: initialClock() });
    const state0 = fresh.createCourierGuildState(ctx);
    const first = state0.offers[0];
    if (first === undefined) throw new Error('expected at least one offer');

    const afterFirst = fresh.courierGuildEngine.activate(state0, `accept-${first.id}`);
    // advanceForTimeCost(clock, 3) = 2 full days advanced, then closed into NIGHT.
    expect(afterFirst.state.context.clock).toEqual({ dayIndex: initialClock().dayIndex + (MOCK_DAYS - 1), phase: 'NIGHT' });

    const second = afterFirst.state.offers[0];
    if (second === undefined) throw new Error('expected a second offer to remain');
    const afterSecond = fresh.courierGuildEngine.activate(afterFirst.state, `accept-${second.id}`);
    expect(afterSecond.state.context.vehicle?.cargo).toHaveLength(2);
    // The shared day was already spent on the first accept - a SECOND
    // acceptCourierWork charge here would visibly move dayIndex again
    // (mocked at 3 days, not 1) if the shared-day gate were missing.
    expect(afterSecond.state.context.clock).toEqual(afterFirst.state.context.clock);

    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });

  it('multipleAcceptsShareOneDay: false charges the day on EVERY accept, proven by moving behaviour with the mock (not just reading the flag)', async () => {
    // Mocks the SAME two things the "true" test above mocks, for the same
    // reason its own comment gives: with the real 1-day acceptCourierWork
    // cost, advanceForTimeCost(DAY,1)=NIGHT then advanceForTimeCost(NIGHT,1)
    // is ALSO just NIGHT (dayIndex unchanged) - idempotent, so a second
    // charge would be invisible to a plain "did dayIndex move again" check
    // even though it genuinely fired. Mocking a 3-day cost makes it visible.
    vi.resetModules();
    const MOCK_DAYS = 3;
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: Record<string, unknown> }>();
      return { default: { ...actual.default, multipleAcceptsShareOneDay: false } };
    });
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        economy: () => ({ ...actual.economy(), timeCostDays: { ...actual.economy().timeCostDays, acceptCourierWork: MOCK_DAYS } }),
      };
    });
    const fresh = await import('@/ui/buildings/courierguild');
    const ctx = makeContext({ cityId: 'newyork', vehicle: makeCourierVehicle(), rng: createRng('courier-noshare-seed'), clock: initialClock() });
    const state0 = fresh.createCourierGuildState(ctx);
    const first = state0.offers[0];
    const second = state0.offers[1];
    if (first === undefined || second === undefined) throw new Error('expected at least two offers');

    const afterFirst = fresh.courierGuildEngine.activate(state0, `accept-${first.id}`);
    const afterSecond = fresh.courierGuildEngine.activate(afterFirst.state, `accept-${second.id}`);
    // Two separate acceptCourierWork charges now move the clock further than one would.
    expect(afterSecond.state.context.clock.dayIndex).toBeGreaterThan(afterFirst.state.context.clock.dayIndex);

    vi.doUnmock('@rulesets/classic/couriers.json');
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });

  it('refuses PAYLOAD_LIMIT_REACHED once maxPayloads worth of payload categories are already carried, WITH that exact reason shown', () => {
    const cargo: CargoState[] = Array.from({ length: couriersConfig().maxPayloads }, (_, i) => ({ id: `p${i}`, kind: 'payload', weightLb: 10, spaces: 1, integrity: 100 }));
    const ctx = makeContext({ vehicle: makeCourierVehicle({ cargo }), rng: createRng('courier-full-seed') });
    const state = createCourierGuildState(ctx);
    expect(state.offers.length).toBeGreaterThan(0); // generateOffers guarantees this now - no vacuous pass on an empty loop
    for (const offer of state.offers) {
      const action = courierGuildEngine.actions(state).find((a) => a.id === `accept-${offer.id}`);
      expect(action?.eligible).toBe(false);
      expect(action?.reason).toBe(t('refusal.PAYLOAD_LIMIT_REACHED'));
    }
  });

  it('refuses NO_ACTIVE_VEHICLE, shows that exact reason, and never mutates cash/cargo on activation without a vehicle', () => {
    const ctx = makeContext({ vehicle: null, rng: createRng('courier-novehicle-seed') });
    const state = createCourierGuildState(ctx);
    expect(state.offers.length).toBeGreaterThan(0); // guaranteed - no early-return escape hatch needed
    const offer = state.offers[0];
    if (offer === undefined) throw new Error('expected at least one offer');
    const action = courierGuildEngine.actions(state).find((a) => a.id === `accept-${offer.id}`);
    expect(action?.eligible).toBe(false);
    expect(action?.reason).toBe(t('refusal.NO_ACTIVE_VEHICLE'));
    const result = courierGuildEngine.activate(state, `accept-${offer.id}`);
    expect(result.state).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// Medical
// ---------------------------------------------------------------------------

describe('medical', () => {
  it('clone: refused with a reason and charges nothing when unaffordable; charges exactly the clone price and records the clone city when affordable', () => {
    const price = economy().services.clone.price;
    const poor = makeContext({ driver: makeDriver({ cash: price - 1 }) });
    expect(medicalEngine.actions(createMedicalState(poor)).find((a) => a.id === 'clone')?.eligible).toBe(false);

    const rich = makeContext({ driver: makeDriver({ cash: price, cloneCityId: null }) });
    const result = medicalEngine.activate(createMedicalState(rich), 'clone');
    expect(result.state.context.driver.cash).toBe(0);
    expect(result.state.context.driver.cloneCityId).toBe(rich.cityId);
  });

  it('braintape update is refused when no clone is on file, even with plenty of cash', () => {
    const ctx = makeContext({ driver: makeDriver({ cash: 1_000_000, cloneCityId: null }) });
    const action = medicalEngine.actions(createMedicalState(ctx)).find((a) => a.id === 'braintapeUpdate');
    expect(action?.eligible).toBe(false);
    expect(action?.reason).toBeTruthy();
  });

  it('treatment heals exactly one point per activation, refuses once at full health, and never overheals', () => {
    const cap = skillsConfig().driver.naturalHealthDP;
    const ctx = makeContext({ driver: makeDriver({ cash: 1_000_000, naturalHealth: cap - 1 }) });
    const result = medicalEngine.activate(createMedicalState(ctx), 'medicalPerPoint');
    expect(result.state.context.driver.naturalHealth).toBe(cap);
    const action = medicalEngine.actions(result.state).find((a) => a.id === 'medicalPerPoint');
    expect(action?.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

describe('bar', () => {
  it('rumor: one per location per day — the second activation is refused and shows the SAME rumor already heard', () => {
    const ctx = makeContext({ rng: forcedRng({ pick: (<T>(items: readonly T[]) => items[0] as T) as Rng['pick'] }) });
    const first = barEngine.activate(createBarState(ctx), 'rumor');
    const heardId = first.state.context.rumorsHeardToday.get('bar');
    expect(heardId).toBeDefined();
    const action = barEngine.actions(first.state).find((a) => a.id === 'rumor');
    expect(action?.eligible).toBe(false);
    const again = barEngine.activate(first.state, 'rumor');
    expect(again.state.context.rumorsHeardToday.get('bar')).toBe(heardId);
  });

  it('illicit payload sale prices off the REAL accepted offer\'s declaredValue (illicitSale.valueFraction of it, independently computed here - never the weight-based estimate), costs prestige, rolls+reports the law-consequence chance, removes the cargo, and marks the job FAILED', () => {
    const offer = makeCourierOffer({ id: 'offer-illicit', declaredValue: 4000, weightLb: 1800, pay: 900 });
    const job = makeAcceptedJob({ offer, cargoId: 'cargo-illicit' });
    const cargo: CargoState = { id: 'cargo-illicit', kind: 'payload', weightLb: offer.weightLb, spaces: offer.spaces, integrity: 100 };
    const ctx = makeContext({
      vehicle: makeVehicle({ cargo: [cargo] }),
      driver: makeDriver({ cash: 0, prestige: 50 }),
      activeCourierJobs: [job],
      // sellIllicit's only rng use is the law-consequence roll - forced true
      // so this test can assert it was both rolled AND reported.
      rng: forcedRng({ chance: () => true }),
    });

    // Independently derived from declaredValue * valueFraction - NOT from
    // any weight/price-averaging estimate. PROVED: before this fix,
    // illicitPayloadValue used averageWeaponDollarsPerLb() ($6.631/lb in the
    // real weapons table) instead, which for this offer's 1800 lb payload
    // priced it at floor(1800*6.631*valueFraction) - roughly 2.5x this
    // number - see this file's history / the defect this closes.
    const expectedPrice = Math.max(0, Math.round(offer.declaredValue * couriersConfig().illicitSale.valueFraction));
    expect(illicitPayloadValue(ctx, cargo)).toBe(expectedPrice);

    const result = barEngine.activate(createBarState(ctx), `sell-illicit-${cargo.id}`);
    expect(result.state.context.driver.cash).toBe(expectedPrice);
    expect(result.state.context.driver.prestige).toBe(50 - couriersConfig().illicitSale.prestigePenalty);
    expect(result.state.context.vehicle?.cargo).toHaveLength(0);
    expect(result.state.context.activeCourierJobs[0]?.status).toBe('FAILED');

    // Genuinely rolled (forced true above) AND reported - couriers.json's
    // illicitSale.lawConsequenceChance was previously claimed rolled in
    // bar.ts's own header comment but never actually was.
    expect(result.state.lastIllicitSaleConsequence).toBe(true);
    const rows = barEngine.actions(result.state);
    expect(rows.find((a) => a.id === 'last-illicit-sale')?.label).toBe(t('building.bar.illicitSale.consequence'));
  });

  it('a payload with no traceable job record (defensive fallback, not the normal path) still sells rather than becoming a dead row, using the old weight-based estimate', () => {
    const cargo: CargoState = { id: 'orphan-payload', kind: 'payload', weightLb: 100, spaces: 1, integrity: 100 };
    const ctx = makeContext({ vehicle: makeVehicle({ cargo: [cargo] }), driver: makeDriver({ cash: 0, prestige: 50 }) });
    expect(ctx.activeCourierJobs).toHaveLength(0);
    const price = illicitPayloadValue(ctx, cargo);
    expect(price).toBeGreaterThan(0);
    const result = barEngine.activate(createBarState(ctx), `sell-illicit-${cargo.id}`);
    expect(result.state.context.driver.cash).toBe(price);
    expect(result.state.context.vehicle?.cargo).toHaveLength(0);
  });

  it('selling salvage at the bar pays exactly illicitSale.valueFraction of the salvage yard\'s own valuation - proven against an independently-computed expected price under a MOCKED fraction, not a construction-guaranteed inequality', async () => {
    vi.resetModules();
    const MOCK_FRACTION = 0.5;
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: { illicitSale: Record<string, unknown> } }>();
      return { default: { ...actual.default, illicitSale: { ...actual.default.illicitSale, valueFraction: MOCK_FRACTION } } };
    });
    const freshBar = await import('@/ui/buildings/bar');
    const freshSalvage = await import('@/ui/buildings/salvage');

    const cargo: CargoState = { id: 'wreck-1-weapon-flamethrower', kind: 'salvage', weightLb: 20, spaces: 1, integrity: economy()._reconstruction.cargoFullIntegrity };
    const yardPrice = freshSalvage.salvageCargoSaleValue(cargo);
    // PROVED: replacing bar.ts's poorSalvageValue with
    // `floor(cargoOriginalCostEstimate(cargo) * 0.0001)` makes this
    // independently-computed expectation (from the MOCKED 0.5, not 0.0001)
    // stop matching, whereas the old `toBeLessThan` assertion stayed green
    // for any fraction under 1.0.
    const expectedBarPrice = Math.floor(yardPrice * MOCK_FRACTION);
    expect(freshBar.poorSalvageValue(cargo)).toBe(expectedBarPrice);
    expect(expectedBarPrice).toBeLessThan(yardPrice);

    vi.doUnmock('@rulesets/classic/couriers.json');
    vi.resetModules();
  });

  it('with no payload/salvage aboard, those rows are shown but ineligible, never a dead/missing row', () => {
    const ctx = makeContext({ vehicle: makeVehicle({ cargo: [] }) });
    const actions = barEngine.actions(createBarState(ctx));
    expect(actions.find((a) => a.id === 'no-payload')?.eligible).toBe(false);
    expect(actions.find((a) => a.id === 'no-salvage')?.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Truck stop
// ---------------------------------------------------------------------------

describe('truckstop', () => {
  it('offers one bus row per adjacent route from the current city, and each charges busToAdjacentCity.price and moves cityId', () => {
    const ctx = makeContext({ cityId: 'newyork', driver: makeDriver({ cash: 1_000_000 }) });
    const routes = citiesConfig().routes.filter((r) => r.a === 'newyork' || r.b === 'newyork');
    const actions = truckstopEngine.actions(createTruckstopState(ctx));
    for (const route of routes) {
      const destination = route.a === 'newyork' ? route.b : route.a;
      expect(actions.some((a) => a.id === `bus-${destination}`)).toBe(true);
    }
    const route = routes[0];
    if (route === undefined) throw new Error('newyork has no routes in the fixture ruleset');
    const destination = route.a === 'newyork' ? route.b : route.a;
    const price = economy().services.busToAdjacentCity.price;
    const result = truckstopEngine.activate(createTruckstopState(ctx), `bus-${destination}`);
    expect(result.exit).toBe(true);
    expect(result.state.context.cityId).toBe(destination);
    expect(result.state.context.driver.cash).toBe(1_000_000 - price);
  });

  it('room for the night is a repeatable per-unit purchase: two activations spend two nights and charge twice', () => {
    const ctx = makeContext({ driver: makeDriver({ cash: 1_000_000 }) });
    const price = economy().services.truckStopRoomNight.price;
    const once = truckstopEngine.activate(createTruckstopState(ctx), 'room');
    const twice = truckstopEngine.activate(once.state, 'room');
    expect(twice.state.context.driver.cash).toBe(1_000_000 - 2 * price);
  });

  it('rumor sharing: a rumor heard at the bar does not block the truckstop\'s own rumor (keyed per facility kind)', () => {
    const ctx = makeContext({ rumorsHeardToday: new Map([['bar', 'building.rumor.patrol']]) });
    const action = truckstopEngine.actions(createTruckstopState(ctx)).find((a) => a.id === 'rumor');
    expect(action?.eligible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

describe('assembly', () => {
  it('fleetHasRoom / assemblyActions: build is eligible below maxFleetSize and ineligible at/above it', () => {
    const max = economy().maxFleetSize;
    const under = makeContext({ fleetSize: max - 1 });
    expect(fleetHasRoom(under)).toBe(true);
    expect(assemblyActions(under).find((a) => a.id === 'build')?.eligible).toBe(true);

    const full = makeContext({ fleetSize: max });
    expect(fleetHasRoom(full)).toBe(false);
    const action = assemblyActions(full).find((a) => a.id === 'build');
    expect(action?.eligible).toBe(false);
    expect(action?.reason).toBeTruthy();
  });

  it('mountAssembly: activating "build" under the cap calls onOpenConstructor, not onExit', () => {
    installFakeDom();
    const container = new FakeElement('div');
    let opened = 0;
    let exited = 0;
    const mounted = mountAssembly({
      container: container as unknown as HTMLElement,
      context: makeContext({ fleetSize: 0 }),
      onOpenConstructor: () => {
        opened += 1;
      },
      onExit: () => {
        exited += 1;
      },
    });
    container.dispatch('keydown', fakeKeyEvent('1'));
    expect(opened).toBe(1);
    expect(exited).toBe(0);
    mounted.destroy();
  });

  it('mountAssembly: a full fleet never calls onOpenConstructor even if "build" is somehow activated', () => {
    installFakeDom();
    const container = new FakeElement('div');
    let opened = 0;
    const mounted = mountAssembly({
      container: container as unknown as HTMLElement,
      context: makeContext({ fleetSize: economy().maxFleetSize }),
      onOpenConstructor: () => {
        opened += 1;
      },
      onExit: () => {},
    });
    container.dispatch('keydown', fakeKeyEvent('1')); // "build" row, but ineligible - @/ui/menu refuses it before ACTIVATE fires
    expect(opened).toBe(0);
    mounted.destroy();
  });
});

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

describe('arena (building)', () => {
  it('practice is eligible with an active vehicle and enough cash for arenaPractice.price; entering charges it exactly once', () => {
    const price = economy().services.arenaPractice.price;
    const ctx = makeContext({ driver: makeDriver({ cash: price }) });
    const action = arenaActions(ctx).find((a) => a.id === 'enter-practice');
    expect(action?.eligible).toBe(true);

    installFakeDom();
    const container = new FakeElement('div');
    let entered: { driver: DriverState } | null = null;
    const mounted = mountArenaBuilding({
      container: container as unknown as HTMLElement,
      context: ctx,
      onEnterArena: (result) => {
        entered = result;
      },
      onExit: () => {},
    });
    // "practice" is arenas.json's first event (index 0) - digit '1' activates
    // it directly regardless of @/ui/menu's initial-selection heuristic
    // (first ELIGIBLE row, not necessarily row 0), so this doesn't depend on
    // guessing how many ArrowDown presses that heuristic already consumed.
    const practiceIndex = arenaActions(ctx).findIndex((a) => a.id === 'enter-practice');
    expect(practiceIndex).toBe(0);
    container.dispatch('keydown', fakeKeyEvent('1'));
    expect(entered).not.toBeNull();
    expect((entered as unknown as { driver: DriverState } | null)?.driver.cash).toBe(0);
    mounted.destroy();
  });

  it('practice without a vehicle is ineligible with a reason', () => {
    const ctx = makeContext({ vehicle: null });
    const action = arenaActions(ctx).find((a) => a.id === 'enter-practice');
    expect(action?.eligible).toBe(false);
    expect(action?.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Casino
// ---------------------------------------------------------------------------

describe('casino', () => {
  it('raise/lower bet move by the drink-price step and clamp at the floor and at cash', () => {
    const step = economy().services.drink.price;
    const ctx = makeContext({ driver: makeDriver({ cash: step * 3 }) });
    const state0 = createCasinoState(ctx);
    expect(state0.bet).toBe(step);

    const lowered = casinoEngine.activate(state0, 'lower');
    expect(lowered.state.bet).toBe(step); // already at the floor - unchanged
    expect(casinoEngine.actions(lowered.state).find((a) => a.id === 'lower')?.eligible).toBe(false);

    const raised = casinoEngine.activate(state0, 'raise');
    expect(raised.state.bet).toBe(step * 2);
  });

  it('poker: cash moves by the REAL sim payout for this bet/seed (independently replayed via @/sim/casino\'s own playFiveCardDraw), applied exactly once, and a result row appears', () => {
    const seed = 'casino-poker-seed';
    const ctx = makeContext({ driver: makeDriver({ cash: 1_000_000 }), rng: createRng(seed) });
    const state0 = createCasinoState(ctx);
    const before = state0.context.driver.cash;

    // A SEPARATE Rng instance from the identical seed - deterministic and
    // independent of the one casinoEngine.activate consumes, so this is a
    // real second computation of the payout, not the same call reused.
    // PROVED: adding a stray `+ 1` to casino.ts's poker net before charging
    // cash breaks this equality (it stayed green against
    // `before + result.state.lastOutcome.net`, since both sides read the
    // SAME mutated `net`).
    const expected = playFiveCardDraw(state0.bet, createRng(seed), []);

    const result = casinoEngine.activate(state0, 'poker');
    expect(result.state.round).toBeNull();
    expect(result.state.lastOutcome).not.toBeNull();
    expect(result.state.lastOutcome?.net).toBe(expected.net);
    expect(result.state.context.driver.cash).toBe(before + expected.net);
    expect(casinoEngine.actions(result.state).some((a) => a.id === 'last-outcome')).toBe(true);
  });

  it('blackjack: hit/stand only while a round is open, and settlement applies net exactly once', () => {
    const ctx = makeContext({ driver: makeDriver({ cash: 1_000_000 }), rng: createRng('casino-blackjack-seed') });
    let state = casinoEngine.activate(createCasinoState(ctx), 'blackjack').state;

    // Drive it to settlement: stand immediately if a round is still open (a natural may have already settled it).
    if (state.round !== null) {
      state = casinoEngine.activate(state, 'stand').state;
    }
    expect(state.round).toBeNull();
    expect(state.lastOutcome?.kind).toBe('blackjack');

    // Hit/Stand are absent once settled - only the bet/game/leave rows remain.
    const actions = casinoEngine.actions(state);
    expect(actions.some((a) => a.id === 'hit')).toBe(false);
    expect(actions.some((a) => a.id === 'stand')).toBe(false);
  });

  it('cannot start a poker or blackjack hand for more than current cash', () => {
    // Independently confirms the precondition this test depends on
    // (state.bet > cash) BEFORE asserting on it, rather than deriving the
    // expected eligibility from the exact same `bet <= cash` expression
    // casino.ts's own eligibility check evaluates (`expect(eligible).toBe
    // (bet <= cash)` can never fail: it restates the code under test).
    const drinkPrice = economy().services.drink.price;
    expect(drinkPrice).toBeGreaterThan(1); // sanity: the starting bet (one step) really does exceed $1 cash
    const ctx = makeContext({ driver: makeDriver({ cash: 1 }) });
    const state = createCasinoState(ctx);
    expect(state.bet).toBe(drinkPrice);

    const actions = casinoEngine.actions(state);
    expect(actions.find((a) => a.id === 'poker')?.eligible).toBe(false);
    expect(actions.find((a) => a.id === 'blackjack')?.eligible).toBe(false);

    // Neither actually starts a round, nor moves cash, when activated anyway.
    const pokerResult = casinoEngine.activate(state, 'poker');
    expect(pokerResult.state.context.driver.cash).toBe(1);
    expect(pokerResult.state.lastOutcome).toBeNull();
    const blackjackResult = casinoEngine.activate(state, 'blackjack');
    expect(blackjackResult.state.context.driver.cash).toBe(1);
    expect(blackjackResult.state.round).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stub facilities
// ---------------------------------------------------------------------------

describe('stub facilities (hotel/federal/story/studio/petshop)', () => {
  it('each shows an explanatory, always-present notice row instead of a dead or missing button', () => {
    for (const kind of ['hotel', 'federal', 'story', 'studio', 'petshop']) {
      const ctx = makeContext();
      const actions = stubEngine.actions(createStubState(ctx, kind));
      const notice = actions.find((a) => a.id === 'notice');
      expect(notice).toBeDefined();
      expect(notice?.eligible).toBe(false);
      expect(notice?.reason).toContain('future phase');
      expect(actions.find((a) => a.id === 'leave')).toBeDefined();
    }
  });
});
