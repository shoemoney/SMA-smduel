import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accept,
  couriersConfig,
  deliver,
  generateOffers,
  projectOffer,
  sellIllicit,
  type AcceptedJob,
  type CourierOffer,
} from '@/sim/courier';
import { citiesConfig, economy, skillsConfig } from '@/data/rulesets';
import economyJsonRaw from '@rulesets/classic/economy.json';
import { advanceForTimeCost, initialClock, timeCostOf, type Clock } from '@/sim/calendar';
import { computeBuild } from '@/sim/construct';
import { createRng, type Rng } from '@/util/rng';
import type { CargoState, DriverState, VehicleState } from '@/sim/types';

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

/** van/standard/light/small/standard, no weapons, moderate armor (kept nonzero so
 * INSUFFICIENT_VEHICLE_THREAT doesn't accidentally fire in tests that aren't about it). */
function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: 'veh-1',
    ownerId: 'driver-1',
    design: {
      name: 'Courier Van',
      bodyId: 'van',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'small',
      tireId: 'standard',
      armor: { FRONT: 5, REAR: 5, LEFT: 5, RIGHT: 5, UNDERBODY: 5 },
      weapons: [],
    },
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 99,
    odometerMiles: 0,
    armorDP: { FRONT: 5, REAR: 5, LEFT: 5, RIGHT: 5, UNDERBODY: 5 },
    tireDP: [4, 4, 4, 4],
    plantDP: 5,
    weapons: [],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    ...overrides,
  };
}

function makeOffer(overrides: Partial<CourierOffer> = {}): CourierOffer {
  return {
    id: 'offer-1',
    originCityId: 'newyork',
    destinationCityId: 'philadelphia',
    destinationFacility: 'bar',
    routeId: 'ny-philadelphia',
    distanceMiles: 95,
    dangerLevel: 1,
    weightLb: 100,
    spaces: 2,
    dueDay: 10,
    declaredValue: 2000,
    pay: 1000,
    cargoName: 'sealed medical crate',
    ...overrides,
  };
}

function makeAcceptedJob(offer: CourierOffer, overrides: Partial<AcceptedJob> = {}): AcceptedJob {
  return { offer, cargoId: `cargo-${offer.id}`, status: 'ACTIVE', acceptedDay: 0, ...overrides };
}

function makeCargo(overrides: Partial<CargoState> = {}): CargoState {
  return {
    id: 'cargo-x',
    kind: 'payload',
    weightLb: 100,
    spaces: 2,
    integrity: economy()._reconstruction.cargoFullIntegrity,
    ...overrides,
  };
}

/**
 * Independently-derived expected remaining capacity: calls `computeBuild`
 * directly (a DIFFERENT, separately-tested function - see construct.test.ts)
 * rather than re-deriving courier.ts's own formula, so this is a real check
 * against `@/sim/construct`'s own accounting, not a comparison of
 * courier.ts to itself.
 */
function expectedCapacity(vehicle: VehicleState, cargo: readonly CargoState[]): { remainingLoadLb: number; remainingSpaces: number } {
  const weightLb = cargo.reduce((sum, item) => sum + item.weightLb, 0);
  const spaces = cargo.reduce((sum, item) => sum + item.spaces, 0);
  const metrics = computeBuild({ ...vehicle.design, cargoWeightLb: weightLb, cargoSpaces: spaces });
  return { remainingLoadLb: metrics.maxLoadLb - metrics.weightTotal, remainingSpaces: metrics.spacesTotal - metrics.spacesUsed };
}

function forcedChanceRng(result: boolean): Rng {
  const unused = (): never => {
    throw new Error('forcedChanceRng: unexpected method call');
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

const DAY: Clock['phase'] = 'DAY';

// ---------------------------------------------------------------------------
// generateOffers
// ---------------------------------------------------------------------------

describe('generateOffers', () => {
  // "returns exactly offersPerVisit jobs" is deliberately not tested here
  // against the live ruleset: comparing `offers.length` to
  // `couriersConfig().offersPerVisit` (the SAME live config object
  // generateOffers itself reads) passes even if offersPerVisit were
  // hardcoded to 3 in the implementation. The real proof is the mocked
  // "generateOffers returns a mocked offersPerVisit count instead of the
  // real 3" test below, which pins a DIFFERENT value and checks behaviour
  // tracks it.

  it('is deterministic from (seed, cityId, day) - a reload (a fresh call with the same inputs) reproduces the identical list', () => {
    const driver = makeDriver();
    const first = generateOffers('newyork', 10, 'seed-a', driver);
    const reload = generateOffers('newyork', 10, 'seed-a', driver);
    expect(reload).toEqual(first);
  });

  it('is not rerollable across many repeated "reloads"', () => {
    const driver = makeDriver();
    const baseline = generateOffers('boston', 42, 12345, driver);
    for (let i = 0; i < 5; i++) {
      expect(generateOffers('boston', 42, 12345, driver)).toEqual(baseline);
    }
  });

  it('varies with day and with seed (sanity: not a frozen constant list)', () => {
    const driver = makeDriver();
    expect(generateOffers('newyork', 2, 'seed-a', driver)).not.toEqual(generateOffers('newyork', 1, 'seed-a', driver));
    expect(generateOffers('newyork', 1, 'seed-b', driver)).not.toEqual(generateOffers('newyork', 1, 'seed-a', driver));
  });

  it('every offer targets a real facility, in a real city, reached by a real route from the origin, with matching distance/danger', () => {
    const driver = makeDriver();
    const cityIds = new Set(citiesConfig().cities.map((c) => c.id));
    for (const originCityId of ['newyork', 'providence', 'watertown', 'manchester']) {
      for (const offer of generateOffers(originCityId, 5, 'topology-seed', driver)) {
        expect(cityIds.has(offer.destinationCityId)).toBe(true);
        const destCity = citiesConfig().cities.find((c) => c.id === offer.destinationCityId);
        expect(destCity).toBeDefined();
        expect(destCity!.facilities).toContain(offer.destinationFacility);

        const route = citiesConfig().routes.find((r) => r.id === offer.routeId);
        expect(route).toBeDefined();
        expect([route!.a, route!.b]).toContain(originCityId);
        expect([route!.a, route!.b]).toContain(offer.destinationCityId);
        expect(offer.distanceMiles).toBe(route!.lengthMiles);
        expect(offer.dangerLevel).toBe(route!.danger);
      }
    }
  });

  it('offer count holds for low-connectivity cities too (providence/watertown/manchester/washington have only 2 route neighbors)', () => {
    const driver = makeDriver();
    for (const cityId of ['providence', 'watertown', 'manchester', 'washington']) {
      expect(generateOffers(cityId, 3, 'low-degree-seed', driver)).toHaveLength(couriersConfig().offersPerVisit);
    }
  });

  it('weight/spaces are drawn within couriers.json generation bounds, and the deadline never exceeds day + ceil(deadlineDaysPerRoute) + deadlineSlackDaysMax', () => {
    const driver = makeDriver();
    const gen = couriersConfig().generation;
    const maxSpan = Math.ceil(gen.deadlineDaysPerRoute) + gen.deadlineSlackDaysMax;
    const minSpan = Math.ceil(gen.deadlineDaysPerRoute) + gen.deadlineSlackDaysMin;
    for (let day = 0; day < 15; day++) {
      for (const offer of generateOffers('philadelphia', day, 'bounds-seed', driver)) {
        expect(offer.weightLb).toBeGreaterThanOrEqual(gen.weightLbMin);
        expect(offer.weightLb).toBeLessThanOrEqual(gen.weightLbMax);
        expect(offer.spaces).toBeGreaterThanOrEqual(gen.spacesMin);
        expect(offer.spaces).toBeLessThanOrEqual(gen.spacesMax);
        // Bounded on BOTH sides by the actual ruleset formula, not just
        // "> day" (which any positive offset satisfies).
        expect(offer.dueDay).toBeGreaterThanOrEqual(day + minSpan);
        expect(offer.dueDay).toBeLessThanOrEqual(day + maxSpan);
        expect(couriersConfig().cargoNames).toContain(offer.cargoName);
      }
    }
  });

  it("mocked generation bounds (spacesMin===spacesMax and a pinned deadline window) pin every offer's spaces and dueDay exactly - proves the deadline/spaces formulas read couriers.json live, not a hardcoded literal", async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return {
        default: {
          ...actual,
          generation: {
            ...actual.generation,
            spacesMin: 5,
            spacesMax: 5,
            deadlineDaysPerRoute: 20,
            deadlineSlackDaysMin: 7,
            deadlineSlackDaysMax: 7,
          },
        },
      };
    });
    try {
      const { generateOffers: mockedGenerateOffers } = await import('@/sim/courier');
      const day = 3;
      // A hardcoded `rng.int(1, 6)` for spaces would sometimes land outside
      // {5}; a hardcoded `day + 5` deadline (the exact mutation the reviewer
      // demonstrated) would land on 8, not 30.
      for (const offer of mockedGenerateOffers('philadelphia', day, 'pinned-seed', makeDriver())) {
        expect(offer.spaces).toBe(5);
        expect(offer.dueDay).toBe(day + 20 + 7);
      }
    } finally {
      vi.doUnmock('@rulesets/classic/couriers.json');
      vi.resetModules();
    }
  });

  it("pay scales up with the driver's prestige tier payMultiplier while every other field stays identical", () => {
    const lowDriver = makeDriver({ prestige: 0 });
    const highDriver = makeDriver({ prestige: 80 });
    const lowTier = couriersConfig().prestigeTiers.find((t) => t.minPrestige === 0)!;
    const highTier = couriersConfig().prestigeTiers.find((t) => t.minPrestige === 80)!;
    expect(highTier.payMultiplier).toBeGreaterThan(lowTier.payMultiplier);

    const lowOffers = generateOffers('newyork', 3, 'tier-seed', lowDriver);
    const highOffers = generateOffers('newyork', 3, 'tier-seed', highDriver);
    for (let i = 0; i < lowOffers.length; i++) {
      const lowOffer = lowOffers[i]!;
      const highOffer = highOffers[i]!;
      expect(highOffer.destinationCityId).toBe(lowOffer.destinationCityId);
      expect(highOffer.weightLb).toBe(lowOffer.weightLb);
      expect(highOffer.spaces).toBe(lowOffer.spaces);
      expect(highOffer.dueDay).toBe(lowOffer.dueDay);
      expect(highOffer.declaredValue).toBe(lowOffer.declaredValue); // declaredValue is tier-independent
      expect(highOffer.pay).toBeGreaterThan(lowOffer.pay);
    }
  });
});

// ---------------------------------------------------------------------------
// projectOffer
// ---------------------------------------------------------------------------

describe('projectOffer', () => {
  it('reports correct projected remaining load/spaces/payload count for an empty-cargo vehicle, fits=true within budget', () => {
    const vehicle = makeVehicle();
    const capacity = expectedCapacity(vehicle, []);
    const offer = makeOffer({ weightLb: 500, spaces: 3 });
    const projection = projectOffer(offer, vehicle);
    expect(projection.projectedRemainingLoadLb).toBe(capacity.remainingLoadLb - 500);
    expect(projection.projectedRemainingSpaces).toBe(capacity.remainingSpaces - 3);
    expect(projection.projectedPayloadsUsed).toBe(1);
    expect(projection.fits).toBe(true);
  });

  it('fits=false when the offer would exceed the remaining load budget', () => {
    const vehicle = makeVehicle();
    const capacity = expectedCapacity(vehicle, []);
    const offer = makeOffer({ weightLb: capacity.remainingLoadLb + 1, spaces: 1 });
    const projection = projectOffer(offer, vehicle);
    expect(projection.fits).toBe(false);
    expect(projection.projectedRemainingLoadLb).toBeLessThan(0);
  });

  it('accounts for cargo already aboard', () => {
    const vehicle = makeVehicle({ cargo: [makeCargo({ id: 'existing', weightLb: 1000, spaces: 4 })] });
    const capacity = expectedCapacity(vehicle, vehicle.cargo);
    const offer = makeOffer({ weightLb: 200, spaces: 2 });
    const projection = projectOffer(offer, vehicle);
    expect(projection.projectedRemainingLoadLb).toBe(capacity.remainingLoadLb - 200);
    expect(projection.projectedRemainingSpaces).toBe(capacity.remainingSpaces - 2);
    expect(projection.projectedPayloadsUsed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// accept
// ---------------------------------------------------------------------------

describe('accept', () => {
  it('NO_ACTIVE_VEHICLE refuses every offer and leaves the clock untouched when there is no vehicle', () => {
    const driver = makeDriver();
    const offers = [makeOffer({ id: 'a' }), makeOffer({ id: 'b' })];
    const clock = initialClock();
    const result = accept(offers, driver, null, clock);
    expect(result.vehicle).toBeNull();
    expect(result.acceptedJobs).toEqual([]);
    expect(result.attempts).toEqual([
      { offer: offers[0], accepted: false, reason: 'NO_ACTIVE_VEHICLE' },
      { offer: offers[1], accepted: false, reason: 'NO_ACTIVE_VEHICLE' },
    ]);
    expect(result.clock).toEqual(clock);
  });

  it("INSUFFICIENT_PRESTIGE refuses a route above the driver's tier and accepts one right at the tier's own cap", () => {
    const driver = makeDriver({ prestige: 0 });
    const tier0 = couriersConfig().prestigeTiers.find((t) => t.minPrestige === 0)!;
    const vehicle = makeVehicle();
    const tooRisky = makeOffer({ id: 'risky', dangerLevel: tier0.maxDangerOffered + 1 });
    const okOffer = makeOffer({ id: 'ok', dangerLevel: tier0.maxDangerOffered });
    const result = accept([tooRisky, okOffer], driver, vehicle, initialClock());
    expect(result.attempts[0]).toEqual({ offer: tooRisky, accepted: false, reason: 'INSUFFICIENT_PRESTIGE' });
    expect(result.attempts[1]).toEqual({ offer: okOffer, accepted: true, reason: null });
  });

  it('INSUFFICIENT_VEHICLE_THREAT refuses a nonzero-danger job for a zero-armor vehicle, but not a danger-0 job', () => {
    const driver = makeDriver();
    const strippedVehicle = makeVehicle({ armorDP: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 } });
    const dangerousOffer = makeOffer({ id: 'dangerous', dangerLevel: 1 });
    const safeOffer = makeOffer({ id: 'safe', dangerLevel: 0 });
    const result = accept([dangerousOffer, safeOffer], driver, strippedVehicle, initialClock());
    expect(result.attempts[0]).toEqual({ offer: dangerousOffer, accepted: false, reason: 'INSUFFICIENT_VEHICLE_THREAT' });
    expect(result.attempts[1]).toEqual({ offer: safeOffer, accepted: true, reason: null });
  });

  it('a vehicle that still has SOME armor left is never refused for INSUFFICIENT_VEHICLE_THREAT', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle({ armorDP: { FRONT: 1, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 } });
    const offer = makeOffer({ dangerLevel: 1 });
    const result = accept([offer], driver, vehicle, initialClock());
    expect(result.attempts[0]).toEqual({ offer, accepted: true, reason: null });
  });

  it('INSUFFICIENT_SPACE refuses exactly when the offer needs more space than the vehicle has left', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle();
    const capacity = expectedCapacity(vehicle, []);
    const tooBig = makeOffer({ id: 'big', spaces: capacity.remainingSpaces + 1, weightLb: 50 });
    const result = accept([tooBig], driver, vehicle, initialClock());
    expect(result.attempts[0]).toEqual({ offer: tooBig, accepted: false, reason: 'INSUFFICIENT_SPACE' });
  });

  it('INSUFFICIENT_LOAD_CAPACITY refuses exactly when the offer needs more weight than the vehicle has left, independent of space', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle();
    const capacity = expectedCapacity(vehicle, []);
    const tooHeavy = makeOffer({ id: 'heavy', weightLb: capacity.remainingLoadLb + 1, spaces: 1 });
    const result = accept([tooHeavy], driver, vehicle, initialClock());
    expect(result.attempts[0]).toEqual({ offer: tooHeavy, accepted: false, reason: 'INSUFFICIENT_LOAD_CAPACITY' });
  });

  it('an (N+1)th payload is refused with PAYLOAD_LIMIT_REACHED even though load/space would still fit', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle();
    const maxPayloads = couriersConfig().maxPayloads;
    const offers = Array.from({ length: maxPayloads + 1 }, (_, i) => makeOffer({ id: `p${i}`, weightLb: 50, spaces: 1 }));
    const result = accept(offers, driver, vehicle, initialClock());
    expect(result.acceptedJobs).toHaveLength(maxPayloads);
    for (let i = 0; i < maxPayloads; i++) expect(result.attempts[i]!.accepted).toBe(true);
    expect(result.attempts[maxPayloads]).toEqual({ offer: offers[maxPayloads], accepted: false, reason: 'PAYLOAD_LIMIT_REACHED' });
  });

  it("mocked maxPayloads=2 refuses the 3rd payload - proves the cap tracks the mock, not a hardcoded 3 (real ruleset's own maxPayloads is 3, so a hardcoded '3' would still let a 3rd through here)", async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return { default: { ...actual, maxPayloads: 2 } };
    });
    try {
      const { accept: mockedAccept } = await import('@/sim/courier');
      const vehicle = makeVehicle();
      const offers = [
        makeOffer({ id: 'm0', weightLb: 50, spaces: 1 }),
        makeOffer({ id: 'm1', weightLb: 50, spaces: 1 }),
        makeOffer({ id: 'm2', weightLb: 50, spaces: 1 }),
      ];
      const result = mockedAccept(offers, makeDriver(), vehicle, initialClock());
      expect(result.acceptedJobs).toHaveLength(2);
      expect(result.attempts[2]).toMatchObject({ accepted: false, reason: 'PAYLOAD_LIMIT_REACHED' });
    } finally {
      vi.doUnmock('@rulesets/classic/couriers.json');
      vi.resetModules();
    }
  });

  it('accumulated salvage occupies exactly ONE payload slot no matter how many salvage items are aboard', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle({
      cargo: [
        makeCargo({ id: 'salvage-1', kind: 'salvage', weightLb: 10, spaces: 1 }),
        makeCargo({ id: 'salvage-2', kind: 'salvage', weightLb: 10, spaces: 1 }),
      ],
    });
    const maxPayloads = couriersConfig().maxPayloads;
    // Two salvage items count as ONE slot, so maxPayloads-1 fresh payload
    // slots should still be free.
    const offers = Array.from({ length: maxPayloads }, (_, i) => makeOffer({ id: `s${i}`, weightLb: 20, spaces: 1 }));
    const result = accept(offers, driver, vehicle, initialClock());
    expect(result.acceptedJobs).toHaveLength(maxPayloads - 1);
    expect(result.attempts[maxPayloads - 1]).toMatchObject({ accepted: false, reason: 'PAYLOAD_LIMIT_REACHED' });
  });

  it("mocked salvageOccupiesOneCategory=false makes each salvage item its OWN slot - proves the flag is actually read, not dead (deleting the read keeps the real-ruleset test above green, since the real ruleset's flag is true)", async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return { default: { ...actual, salvageOccupiesOneCategory: false } };
    });
    try {
      const { accept: mockedAccept } = await import('@/sim/courier');
      const maxPayloads = couriersConfig().maxPayloads; // shape unaffected by this mock
      const vehicle = makeVehicle({
        cargo: [
          makeCargo({ id: 'salvage-1', kind: 'salvage', weightLb: 10, spaces: 1 }),
          makeCargo({ id: 'salvage-2', kind: 'salvage', weightLb: 10, spaces: 1 }),
        ],
      });
      // Two salvage items already occupy 2 of maxPayloads slots now, so only
      // maxPayloads-2 fresh payload slots are free (one fewer than the
      // salvageOccupiesOneCategory=true case above).
      const offers = Array.from({ length: maxPayloads }, (_, i) => makeOffer({ id: `f${i}`, weightLb: 20, spaces: 1 }));
      const result = mockedAccept(offers, makeDriver(), vehicle, initialClock());
      expect(result.acceptedJobs).toHaveLength(maxPayloads - 2);
      expect(result.attempts[maxPayloads - 2]).toMatchObject({ accepted: false, reason: 'PAYLOAD_LIMIT_REACHED' });
    } finally {
      vi.doUnmock('@rulesets/classic/couriers.json');
      vi.resetModules();
    }
  });

  it("checks capacity cumulatively within one batch, not just against the vehicle's pre-transaction cargo", () => {
    const driver = makeDriver();
    const vehicle = makeVehicle();
    const capacity = expectedCapacity(vehicle, []);
    const half = Math.floor(capacity.remainingSpaces / 2) + 1; // each fits alone; together they don't
    const first = makeOffer({ id: 'first', spaces: half, weightLb: 10 });
    const second = makeOffer({ id: 'second', spaces: half, weightLb: 10 });
    const result = accept([first, second], driver, vehicle, initialClock());
    expect(result.attempts[0]).toEqual({ offer: first, accepted: true, reason: null });
    expect(result.attempts[1]).toEqual({ offer: second, accepted: false, reason: 'INSUFFICIENT_SPACE' });
  });

  it('multiple accepts in one transaction share a single day, never one day per job', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle();
    const offers = [makeOffer({ id: 'x1', weightLb: 50, spaces: 1 }), makeOffer({ id: 'x2', weightLb: 50, spaces: 1 })];
    const start = initialClock();
    const result = accept(offers, driver, vehicle, start);
    expect(result.acceptedJobs).toHaveLength(2);
    // Independently-sourced expectation: economy.json's timeCostDays.acceptCourierWork
    // via calendar.ts's timeCostOf, a DIFFERENT, separately-tested function -
    // not a re-derivation of accept()'s own arithmetic.
    const acceptDays = timeCostOf('acceptCourierWork');
    expect(result.clock).toEqual(advanceForTimeCost(start, acceptDays));
    expect(result.clock.dayIndex).not.toBe(start.dayIndex + acceptDays * 2);
  });

  it('a batch that refuses every offer costs no time at all', () => {
    const driver = makeDriver({ prestige: 0 });
    const vehicle = makeVehicle();
    const tier0 = couriersConfig().prestigeTiers.find((t) => t.minPrestige === 0)!;
    const start = initialClock();
    const result = accept([makeOffer({ dangerLevel: tier0.maxDangerOffered + 1 })], driver, vehicle, start);
    expect(result.acceptedJobs).toHaveLength(0);
    expect(result.clock).toEqual(start);
  });

  it('an accepted job gets a real cargo entry aboard the vehicle at full integrity', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle();
    const offer = makeOffer({ id: 'z', weightLb: 300, spaces: 2 });
    const result = accept([offer], driver, vehicle, initialClock());
    const job = result.acceptedJobs[0]!;
    expect(job.status).toBe('ACTIVE');
    expect(job.offer).toEqual(offer);
    const cargoItem = result.vehicle!.cargo.find((c) => c.id === job.cargoId);
    expect(cargoItem).toEqual({
      id: job.cargoId,
      kind: 'payload',
      weightLb: 300,
      spaces: 2,
      integrity: economy()._reconstruction.cargoFullIntegrity,
    });
  });
});

// ---------------------------------------------------------------------------
// accept()'s time cost: sourced from economy.json (via calendar.timeCostOf),
// not couriers.json's own unvalidated acceptanceCostDays. Isolated in its
// own describe with an unconditional afterEach so a failing assertion can
// never leave a mock active for the rest of the file (a bare inline unmock
// at the end of a test body is skipped when the test throws first).
// ---------------------------------------------------------------------------

describe("accept() sources its time cost from economy.json's acceptCourierWork", () => {
  afterEach(() => {
    vi.doUnmock('@rulesets/classic/economy.json');
    vi.doUnmock('@rulesets/classic/couriers.json');
    vi.resetModules();
  });

  it("mocked economy.json timeCostDays.acceptCourierWork changes the acceptance time cost - proves accept() reads it live from economy.json, NOT couriers.json's own (unvalidated, duplicate) acceptanceCostDays field", async () => {
    vi.resetModules();
    // Base off the plain top-level static import (`economyJsonRaw`), never
    // `importOriginal()`'s namespace object: Vitest's namespace object for a
    // JSON module carries a hidden runtime-only `default` property (present
    // at runtime but absent from its TS type), so spreading `...actual`
    // silently re-nests a stray `default` key one level deep and trips
    // economy.json's strict `additionalProperties: false` AJV schema.
    vi.doMock('@rulesets/classic/economy.json', () => {
      return { default: { ...economyJsonRaw, timeCostDays: { ...economyJsonRaw.timeCostDays, acceptCourierWork: 3 } } };
    });
    const { accept: mockedAccept } = await import('@/sim/courier');
    const vehicle = makeVehicle();
    const start = initialClock();
    const result = mockedAccept([makeOffer({ id: 'eco1', weightLb: 50, spaces: 1 })], makeDriver(), vehicle, start);
    expect(result.acceptedJobs).toHaveLength(1);
    // couriers.json's own acceptanceCostDays (1) is untouched by this mock -
    // if accept() still read that field, the clock would advance by 1 day,
    // not 3.
    expect(result.clock).toEqual(advanceForTimeCost(start, 3));
  });

  it("mocked couriers.json acceptanceCostDays has NO effect on the clock any more - the field is now dead in this module, superseded by economy.json's acceptCourierWork", async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return { default: { ...actual, acceptanceCostDays: 99 } };
    });
    const { accept: mockedAccept } = await import('@/sim/courier');
    const vehicle = makeVehicle();
    const start = initialClock();
    const result = mockedAccept([makeOffer({ id: 'dead1', weightLb: 50, spaces: 1 })], makeDriver(), vehicle, start);
    // Real economy.json's acceptCourierWork (1) still governs, NOT the
    // mocked 99.
    expect(result.clock).toEqual(advanceForTimeCost(start, timeCostOf('acceptCourierWork')));
  });

  it('multipleAcceptsShareOneDay=false (mocked) charges acceptCourierWork days for EVERY accepted job, not once per batch', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return { default: { ...actual, multipleAcceptsShareOneDay: false } };
    });
    const { accept: mockedAccept } = await import('@/sim/courier');
    const vehicle = makeVehicle();
    const offers = [
      makeOffer({ id: 'y1', weightLb: 50, spaces: 1 }),
      makeOffer({ id: 'y2', weightLb: 50, spaces: 1 }),
      makeOffer({ id: 'y3', weightLb: 50, spaces: 1 }),
    ];
    const start = initialClock();
    const result = mockedAccept(offers, makeDriver(), vehicle, start);
    expect(result.acceptedJobs).toHaveLength(3);
    const acceptDays = timeCostOf('acceptCourierWork');
    expect(result.clock).toEqual(advanceForTimeCost(start, acceptDays * 3));
  });
});

// ---------------------------------------------------------------------------
// deliver
// ---------------------------------------------------------------------------

describe('deliver', () => {
  function setupActiveJob(offerOverrides: Partial<CourierOffer> = {}, cargoOverrides: Partial<CargoState> = {}) {
    const offer = makeOffer({
      id: 'd1',
      destinationCityId: 'philadelphia',
      destinationFacility: 'courierguild',
      dueDay: 10,
      pay: 1000,
      ...offerOverrides,
    });
    const cargoId = `cargo-${offer.id}`;
    const cargoItem = makeCargo({ id: cargoId, weightLb: offer.weightLb, spaces: offer.spaces, ...cargoOverrides });
    const vehicle = makeVehicle({ cargo: [cargoItem] });
    const job = makeAcceptedJob(offer, { cargoId });
    return { offer, job, vehicle };
  }

  it('WRONG_LOCATION when not at the destination city, and leaves the job ACTIVE with no pay', () => {
    const driver = makeDriver();
    const { job, offer, vehicle } = setupActiveJob();
    const clock: Clock = { dayIndex: 5, phase: DAY };
    const result = deliver(job, driver, vehicle, 'newyork', offer.destinationFacility, clock);
    expect(result.outcome).toBe('WRONG_LOCATION');
    expect(result.job.status).toBe('ACTIVE');
    expect(result.paidAmount).toBe(0);
    expect(result.driver).toEqual(driver);
    expect(result.vehicle).toEqual(vehicle);
  });

  it('WRONG_LOCATION at the right city but the wrong facility, and leaves the job ACTIVE with no pay', () => {
    const driver = makeDriver();
    const { job, offer, vehicle } = setupActiveJob({ destinationCityId: 'philadelphia', destinationFacility: 'courierguild' });
    const clock: Clock = { dayIndex: 5, phase: DAY };
    // Right city, but standing in a DIFFERENT facility than the offer's destinationFacility.
    const result = deliver(job, driver, vehicle, offer.destinationCityId, 'bar', clock);
    expect(result.outcome).toBe('WRONG_LOCATION');
    expect(result.job.status).toBe('ACTIVE');
    expect(result.paidAmount).toBe(0);
    expect(result.vehicle).toEqual(vehicle);
  });

  it('ON_TIME at the right city AND the exact destination facility', () => {
    const driver = makeDriver({ prestige: 0 });
    const { job, offer, vehicle } = setupActiveJob({ destinationCityId: 'philadelphia', destinationFacility: 'courierguild', dueDay: 10, pay: 1000 });
    const clock: Clock = { dayIndex: 10, phase: DAY };
    const result = deliver(job, driver, vehicle, offer.destinationCityId, offer.destinationFacility, clock);
    expect(result.outcome).toBe('ON_TIME');
    expect(result.paidAmount).toBe(1000);
  });

  it('FAILED when the cargo has been removed from the vehicle (destroyed/stolen/sold)', () => {
    const driver = makeDriver({ prestige: 0 });
    const tier0 = couriersConfig().prestigeTiers.find((t) => t.minPrestige === 0)!;
    const { job, offer } = setupActiveJob();
    const emptyVehicle = makeVehicle({ cargo: [] });
    const clock: Clock = { dayIndex: 5, phase: DAY };
    const result = deliver(job, driver, emptyVehicle, offer.destinationCityId, offer.destinationFacility, clock);
    expect(result.outcome).toBe('FAILED');
    expect(result.job.status).toBe('FAILED');
    expect(result.paidAmount).toBe(0);
    expect(result.driver.prestige).toBe(Math.max(skillsConfig().driver.prestigeFloor, driver.prestige - tier0.failurePenalty));
  });

  it('FAILED when the cargo is present aboard but destroyed (integrity 0)', () => {
    const driver = makeDriver();
    const { job, offer, vehicle } = setupActiveJob({}, { integrity: 0 });
    const clock: Clock = { dayIndex: 5, phase: DAY };
    const result = deliver(job, driver, vehicle, offer.destinationCityId, offer.destinationFacility, clock);
    expect(result.outcome).toBe('FAILED');
    expect(result.job.status).toBe('FAILED');
    expect(result.paidAmount).toBe(0);
  });

  it('lateness = 0 days: pays full and awards the current tier prestigeReward', () => {
    const driver = makeDriver({ prestige: 0 });
    const tier0 = couriersConfig().prestigeTiers.find((t) => t.minPrestige === 0)!;
    const { job, offer, vehicle } = setupActiveJob({ dueDay: 10, pay: 1000 });
    const clock: Clock = { dayIndex: 10, phase: DAY }; // exactly on the due day - not late
    const result = deliver(job, driver, vehicle, offer.destinationCityId, offer.destinationFacility, clock);
    expect(result.outcome).toBe('ON_TIME');
    expect(result.daysLate).toBe(0);
    expect(result.paidAmount).toBe(1000);
    expect(result.driver.cash).toBe(driver.cash + 1000);
    expect(result.driver.prestige).toBe(driver.prestige + tier0.prestigeReward);
    expect(result.job.status).toBe('DELIVERED');
    expect(result.vehicle.cargo.find((c) => c.id === job.cargoId)).toBeUndefined();
  });

  it('lateness = 1 day: pay decays by payDecayPerDay and prestige takes the tier failurePenalty', () => {
    const driver = makeDriver({ prestige: 0 });
    const tier0 = couriersConfig().prestigeTiers.find((t) => t.minPrestige === 0)!;
    const { payDecayPerDay, payFloorFraction } = couriersConfig().lateness;
    const { job, offer, vehicle } = setupActiveJob({ dueDay: 10, pay: 1000 });
    const clock: Clock = { dayIndex: 11, phase: DAY };
    const result = deliver(job, driver, vehicle, offer.destinationCityId, offer.destinationFacility, clock);
    expect(result.outcome).toBe('LATE');
    expect(result.daysLate).toBe(1);
    const expectedFactor = Math.max(payFloorFraction, 1 - payDecayPerDay * 1);
    expect(result.paidAmount).toBe(Math.round(1000 * expectedFactor));
    expect(result.driver.cash).toBe(driver.cash + result.paidAmount);
    expect(result.driver.prestige).toBe(Math.max(skillsConfig().driver.prestigeFloor, driver.prestige - tier0.failurePenalty));
    expect(result.job.status).toBe('DELIVERED');
  });

  it('lateness = 5 days: pay decays further than at 1 day (this ruleset floors it at 0) and prestige takes the same flat failurePenalty', () => {
    const driver = makeDriver({ prestige: 0 });
    const tier0 = couriersConfig().prestigeTiers.find((t) => t.minPrestige === 0)!;
    const { payDecayPerDay, payFloorFraction } = couriersConfig().lateness;
    const { job, offer, vehicle } = setupActiveJob({ dueDay: 10, pay: 1000 });
    const clock: Clock = { dayIndex: 15, phase: DAY };
    const result = deliver(job, driver, vehicle, offer.destinationCityId, offer.destinationFacility, clock);
    expect(result.outcome).toBe('LATE');
    expect(result.daysLate).toBe(5);
    const expectedFactor = Math.max(payFloorFraction, 1 - payDecayPerDay * 5);
    expect(result.paidAmount).toBe(Math.round(1000 * expectedFactor));
    expect(result.driver.prestige).toBe(Math.max(skillsConfig().driver.prestigeFloor, driver.prestige - tier0.failurePenalty));
  });

  it("mocked lateness.payDecayPerDay/payFloorFraction change deliver()'s late payout - proves it's read live, not a baked-in 0.2/0 pair", async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return { default: { ...actual, lateness: { payDecayPerDay: 0.5, payFloorFraction: 0.1 } } };
    });
    try {
      const { deliver: mockedDeliver } = await import('@/sim/courier');
      const driver = makeDriver({ prestige: 0 });
      const offer = makeOffer({ id: 'mock-late', destinationCityId: 'philadelphia', destinationFacility: 'courierguild', dueDay: 10, pay: 1000 });
      const cargoId = `cargo-${offer.id}`;
      const vehicle = makeVehicle({ cargo: [makeCargo({ id: cargoId, weightLb: offer.weightLb, spaces: offer.spaces })] });
      const job = makeAcceptedJob(offer, { cargoId });
      // 3 days late: real ruleset would give max(0, 1 - 0.2*3) = 0.4 -> 400.
      // Mocked ruleset gives max(0.1, 1 - 0.5*3) = 0.1 -> 100. A hardcoded
      // 0.2/0.0 pair in the implementation would still produce 400 here.
      const result = mockedDeliver(job, driver, vehicle, offer.destinationCityId, offer.destinationFacility, { dayIndex: 13, phase: DAY });
      expect(result.paidAmount).toBe(100);
    } finally {
      vi.doUnmock('@rulesets/classic/couriers.json');
      vi.resetModules();
    }
  });

  it('throws when the job is not ACTIVE', () => {
    const driver = makeDriver();
    const { job, offer, vehicle } = setupActiveJob();
    const deliveredJob: AcceptedJob = { ...job, status: 'DELIVERED' };
    const clock: Clock = { dayIndex: 5, phase: DAY };
    expect(() => deliver(deliveredJob, driver, vehicle, offer.destinationCityId, offer.destinationFacility, clock)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// sellIllicit
// ---------------------------------------------------------------------------

describe('sellIllicit', () => {
  it('pays valueFraction of declaredValue, costs prestigePenalty, removes the cargo and marks the job FAILED', () => {
    const driver = makeDriver({ prestige: 10 });
    const { valueFraction, prestigePenalty } = couriersConfig().illicitSale;
    const offer = makeOffer({ id: 'sell1', declaredValue: 2000 });
    const cargoId = `cargo-${offer.id}`;
    const vehicle = makeVehicle({ cargo: [makeCargo({ id: cargoId, weightLb: offer.weightLb, spaces: offer.spaces })] });
    const job = makeAcceptedJob(offer, { cargoId });

    const result = sellIllicit(job, driver, vehicle, forcedChanceRng(false));

    expect(result.payout).toBe(Math.round(2000 * valueFraction));
    expect(result.driver.cash).toBe(driver.cash + result.payout);
    expect(result.driver.prestige).toBe(Math.max(skillsConfig().driver.prestigeFloor, driver.prestige - prestigePenalty));
    expect(result.job.status).toBe('FAILED');
    expect(result.vehicle.cargo.find((c) => c.id === cargoId)).toBeUndefined();
  });

  it("rolls the law consequence at exactly the ruleset's lawConsequenceChance, converted to a 0..100 percent", () => {
    const driver = makeDriver();
    const { lawConsequenceChance } = couriersConfig().illicitSale;
    const offer = makeOffer({ id: 'sell2' });
    const cargoId = `cargo-${offer.id}`;
    const vehicle = makeVehicle({ cargo: [makeCargo({ id: cargoId, weightLb: offer.weightLb, spaces: offer.spaces })] });
    const job = makeAcceptedJob(offer, { cargoId });

    let seenPercent: number | null = null;
    const recordingRng: Rng = {
      ...forcedChanceRng(true),
      chance: (percent) => {
        seenPercent = percent;
        return true;
      },
    };

    const result = sellIllicit(job, driver, vehicle, recordingRng);
    expect(seenPercent).toBe(Math.round(lawConsequenceChance * 100));
    expect(result.lawConsequenceTriggered).toBe(true);
  });

  it('reflects chance()=false as lawConsequenceTriggered=false', () => {
    const driver = makeDriver();
    const offer = makeOffer({ id: 'sell3' });
    const cargoId = `cargo-${offer.id}`;
    const vehicle = makeVehicle({ cargo: [makeCargo({ id: cargoId, weightLb: offer.weightLb, spaces: offer.spaces })] });
    const job = makeAcceptedJob(offer, { cargoId });
    const result = sellIllicit(job, driver, vehicle, forcedChanceRng(false));
    expect(result.lawConsequenceTriggered).toBe(false);
  });

  it('throws when the job is not ACTIVE', () => {
    const driver = makeDriver();
    const offer = makeOffer({ id: 'sell4' });
    const vehicle = makeVehicle();
    const job = makeAcceptedJob(offer, { status: 'DELIVERED' });
    expect(() => sellIllicit(job, driver, vehicle, createRng('x'))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Mocked-ruleset proof: every number above genuinely comes from couriers.json
// at call time, not a baked-in literal. Same technique as
// tests/unit/services.test.ts (`vi.doMock` + `vi.resetModules()` + a dynamic
// `import()` INSTEAD OF a top-level `vi.mock`, which would rebase every
// earlier test in this file onto the mocked ruleset since `vi.mock` is
// hoisted above every import in the whole file).
// ---------------------------------------------------------------------------

describe('courier.ts reads couriers.json live, not a baked-in literal', () => {
  afterEach(() => {
    vi.doUnmock('@rulesets/classic/couriers.json');
    vi.resetModules();
  });

  it('generateOffers returns a mocked offersPerVisit count instead of the real 3', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return { default: { ...actual, offersPerVisit: 5 } };
    });
    const { generateOffers: mockedGenerateOffers } = await import('@/sim/courier');
    const offers = mockedGenerateOffers('newyork', 1, 'mock-seed', makeDriver());
    expect(offers).toHaveLength(5);
  });

  it('generateOffers computes pay/declaredValue from mocked generation weights, not the real ones', async () => {
    vi.resetModules();
    const MOCK_WEIGHT_LB = 400;
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return {
        default: {
          ...actual,
          generation: {
            ...actual.generation,
            payWeightPerMile: 10,
            payWeightPerDangerLevel: 100,
            payWeightPerHundredPounds: 5,
            payJitterFraction: 0,
            declaredValueMultiplier: 2,
            weightLbMin: MOCK_WEIGHT_LB,
            weightLbMax: MOCK_WEIGHT_LB,
          },
        },
      };
    });
    const { generateOffers: mockedGenerateOffers } = await import('@/sim/courier');
    const [offer] = mockedGenerateOffers('newyork', 1, 'formula-seed', makeDriver({ prestige: 0 }));
    expect(offer).toBeDefined();
    const route = citiesConfig().routes.find((r) => r.id === offer!.routeId)!;
    const expectedBasePay = route.lengthMiles * 10 + route.danger * 100 + (MOCK_WEIGHT_LB / 100) * 5;
    expect(offer!.weightLb).toBe(MOCK_WEIGHT_LB);
    // Real prestigeTiers untouched by this mock: tier0.payMultiplier is 1.00, jitter is 0.
    expect(offer!.pay).toBe(Math.round(expectedBasePay));
    expect(offer!.declaredValue).toBe(Math.round(expectedBasePay * 2));
  });

  it("accept's INSUFFICIENT_PRESTIGE threshold follows a mocked prestigeTiers.maxDangerOffered", async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return {
        default: {
          ...actual,
          prestigeTiers: actual.prestigeTiers.map((tier: (typeof actual)["prestigeTiers"][number], i: number) => (i === 0 ? { ...tier, maxDangerOffered: 0 } : tier)),
        },
      };
    });
    const { accept: mockedAccept } = await import('@/sim/courier');
    const vehicle = makeVehicle();
    // dangerLevel 1 would be fine against the REAL tier0 (maxDangerOffered 2)
    // but not against the mocked 0.
    const offer = makeOffer({ dangerLevel: 1 });
    const result = mockedAccept([offer], makeDriver({ prestige: 0 }), vehicle, initialClock());
    expect(result.attempts[0]).toMatchObject({ accepted: false, reason: 'INSUFFICIENT_PRESTIGE' });
  });

  it('sellIllicit follows a mocked illicitSale block instead of the real valueFraction/prestigePenalty', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return { default: { ...actual, illicitSale: { valueFraction: 0.5, prestigePenalty: 40, lawConsequenceChance: 1 } } };
    });
    const { sellIllicit: mockedSellIllicit } = await import('@/sim/courier');
    const driver = makeDriver({ prestige: 50 });
    const offer = makeOffer({ id: 'mocksell', declaredValue: 1000 });
    const cargoId = `cargo-${offer.id}`;
    const vehicle = makeVehicle({ cargo: [makeCargo({ id: cargoId, weightLb: offer.weightLb, spaces: offer.spaces })] });
    const job = makeAcceptedJob(offer, { cargoId });
    const result = mockedSellIllicit(job, driver, vehicle, createRng('any'));
    expect(result.payout).toBe(500);
    expect(result.driver.prestige).toBe(10);
    expect(result.lawConsequenceTriggered).toBe(true);
  });

  it('throws at import time if couriers.json refusalReasons drifts from what this module implements', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return { default: { ...actual, refusalReasons: ['SOMETHING_ELSE'] } };
    });
    await expect(import('@/sim/courier')).rejects.toThrow(/refusalReasons/);
  });
});

// "couriers.json lists exactly the six reasons this module implements" is
// deliberately not re-tested here: it would just assert couriers.json's
// contents against a hardcoded Set, testing the JSON file rather than the
// module, and assertRefusalReasonsMatchRuleset() already throws AT IMPORT
// TIME on any drift (see the "throws at import time if couriers.json
// refusalReasons drifts..." test above, which actually exercises that
// throw).

// ---------------------------------------------------------------------------
// couriers.json shape validation (import-time)
// ---------------------------------------------------------------------------

describe('couriers.json shape validation at import time', () => {
  afterEach(() => {
    vi.doUnmock('@rulesets/classic/couriers.json');
    vi.resetModules();
  });

  it('throws when a required numeric field (maxPayloads) is missing, instead of silently becoming undefined', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      const { maxPayloads: _drop, ...rest } = actual as unknown as Record<string, unknown>;
      return { default: rest };
    });
    await expect(import('@/sim/courier')).rejects.toThrow(/maxPayloads/);
  });

  it('throws when a required nested field (generation.deadlineDaysPerRoute) is missing', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      const { deadlineDaysPerRoute: _drop, ...restGen } = actual.generation as unknown as Record<string, unknown>;
      return { default: { ...actual, generation: restGen } };
    });
    await expect(import('@/sim/courier')).rejects.toThrow(/generation\.deadlineDaysPerRoute/);
  });

  it('throws when a required field has the wrong type (salvageOccupiesOneCategory as a string)', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return { default: { ...actual, salvageOccupiesOneCategory: 'true' } };
    });
    await expect(import('@/sim/courier')).rejects.toThrow(/salvageOccupiesOneCategory/);
  });

  it('does NOT throw for the real, unmodified couriers.json (sanity: the validator accepts valid data)', async () => {
    vi.resetModules();
    await expect(import('@/sim/courier')).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Unresolvable vehicle (NaN capacity) fails CLOSED, not open
// ---------------------------------------------------------------------------

describe('capacity with an unresolvable vehicle build (NaN maxLoadLb/spacesTotal)', () => {
  function makeUnbuildableVehicle(): VehicleState {
    return makeVehicle({ design: { ...makeVehicle().design, bodyId: 'no-such-body' } });
  }

  it("projectOffer reports fits=false for an unresolvable vehicle (NaN comparisons are false, so this already worked)", () => {
    const vehicle = makeUnbuildableVehicle();
    const offer = makeOffer({ weightLb: 999999, spaces: 999 });
    expect(projectOffer(offer, vehicle).fits).toBe(false);
  });

  it('accept() REFUSES cargo for the same unresolvable vehicle instead of accepting it unconditionally - the bug: NaN < x is always false, so a naive "<" check on remaining capacity fails OPEN', () => {
    const vehicle = makeUnbuildableVehicle();
    const offer = makeOffer({ id: 'huge', weightLb: 999999, spaces: 999 });
    const result = accept([offer], makeDriver(), vehicle, initialClock());
    expect(result.acceptedJobs).toHaveLength(0);
    expect(result.attempts[0]!.accepted).toBe(false);
    expect(result.attempts[0]!.reason).toBe('INSUFFICIENT_LOAD_CAPACITY');
  });

  it('accept() still refuses an unresolvable vehicle even for a tiny, normally-trivial offer - it is the vehicle, not the offer size, that is refused', () => {
    const vehicle = makeUnbuildableVehicle();
    const offer = makeOffer({ id: 'tiny', weightLb: 1, spaces: 1 });
    const result = accept([offer], makeDriver(), vehicle, initialClock());
    expect(result.attempts[0]!.accepted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cargo id collisions (accept() must never hand out the same CargoState.id twice)
// ---------------------------------------------------------------------------

describe('accept() never hands out a duplicate CargoState.id', () => {
  it('accepting the SAME offer twice in one batch gives each accepted copy a distinct cargoId', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle();
    const offer = makeOffer({ id: 'dup-offer', weightLb: 50, spaces: 1 });
    const result = accept([offer, offer], driver, vehicle, initialClock());
    expect(result.acceptedJobs).toHaveLength(2);
    const [job1, job2] = result.acceptedJobs as [AcceptedJob, AcceptedJob];
    expect(job1.cargoId).not.toBe(job2.cargoId);
    const cargoIds = result.vehicle!.cargo.map((c) => c.id);
    expect(new Set(cargoIds).size).toBe(cargoIds.length);
    expect(result.vehicle!.cargo).toHaveLength(2);
  });

  it('delivering the first duplicate does NOT silently destroy the second (the reviewer-demonstrated failure mode)', () => {
    const driver = makeDriver({ prestige: 0 });
    const vehicle = makeVehicle();
    const offer = makeOffer({ id: 'dup-offer-2', destinationCityId: 'philadelphia', destinationFacility: 'courierguild', dueDay: 50, weightLb: 50, spaces: 1, pay: 1000 });
    const acceptResult = accept([offer, offer], driver, vehicle, initialClock());
    const [job1, job2] = acceptResult.acceptedJobs as [AcceptedJob, AcceptedJob];
    const clock: Clock = { dayIndex: 5, phase: DAY };

    const afterFirst = deliver(job1, driver, acceptResult.vehicle!, offer.destinationCityId, offer.destinationFacility, clock);
    expect(afterFirst.outcome).toBe('ON_TIME');
    // The SECOND job's cargo must still be aboard after the first delivery removed only the first job's cargo.
    expect(afterFirst.vehicle.cargo.find((c) => c.id === job2.cargoId)).toBeDefined();

    const afterSecond = deliver(job2, driver, afterFirst.vehicle, offer.destinationCityId, offer.destinationFacility, clock);
    expect(afterSecond.outcome).toBe('ON_TIME');
    expect(afterSecond.paidAmount).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Tier-aware route selection (generateOffers consults tier.maxDangerOffered)
// ---------------------------------------------------------------------------

describe('generateOffers steers within the driver tier maxDangerOffered', () => {
  it("buffalo has exactly one route within tier0's budget (danger<=2): every offer generated there for a tier0 driver uses it, never the danger-3/4 routes", () => {
    const driver = makeDriver({ prestige: 0 });
    const tier0 = couriersConfig().prestigeTiers.find((t) => t.minPrestige === 0)!;
    for (let day = 0; day < 30; day++) {
      for (const offer of generateOffers('buffalo', day, 'tier-guard-seed', driver)) {
        expect(offer.dangerLevel).toBeLessThanOrEqual(tier0.maxDangerOffered);
      }
    }
  });

  it('watertown has NO route within tier0\'s budget (danger 3 and 4 only): generateOffers still returns offersPerVisit jobs (fallback to the full route set) rather than fewer', () => {
    const driver = makeDriver({ prestige: 0 });
    for (let day = 0; day < 10; day++) {
      expect(generateOffers('watertown', day, 'watertown-seed', driver)).toHaveLength(couriersConfig().offersPerVisit);
    }
  });

  it("a mocked tier0.maxDangerOffered=4 (instead of the real 2) lets buffalo's danger-3/4 routes through too - proves tier-aware filtering reads the mocked tier, not a hardcoded 2", async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/couriers.json', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@rulesets/classic/couriers.json')>();
      return {
        default: {
          ...actual,
          prestigeTiers: actual.prestigeTiers.map((tier: (typeof actual)['prestigeTiers'][number], i: number) =>
            i === 0 ? { ...tier, maxDangerOffered: 4 } : tier,
          ),
        },
      };
    });
    try {
      const { generateOffers: mockedGenerateOffers } = await import('@/sim/courier');
      const driver = makeDriver({ prestige: 0 });
      let sawHigherDanger = false;
      for (let day = 0; day < 30; day++) {
        for (const offer of mockedGenerateOffers('buffalo', day, 'tier-mock-seed', driver)) {
          if (offer.dangerLevel > 2) sawHigherDanger = true;
        }
      }
      expect(sawHigherDanger).toBe(true);
    } finally {
      vi.doUnmock('@rulesets/classic/couriers.json');
      vi.resetModules();
    }
  });
});
