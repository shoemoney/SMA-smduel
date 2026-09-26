/**
 * `@/sim/world-map` mocks '@/data/rulesets' for the WHOLE file (vi.mock is
 * hoisted above every import, same pattern as
 * tests/unit/calendar.cadence-not-hardcoded.test.ts and
 * tests/unit/road.test.ts) so two things can be proven against DIFFERENT
 * data than the real ruleset, not just against itself:
 *
 *  - `travelDaysFor` actually reads `economy().services.busToAdjacentCity`
 *    at call time (`mockBusDaysOverride`) rather than a baked-in ratio.
 *  - `shortestPathByMiles`/`shortestPathByDanger` throw `NoPathError` on a
 *    genuinely disconnected graph (`citiesOverride`), a branch the REAL
 *    cities.json (validated fully connected) never actually exercises.
 *
 * Both overrides default to "pass through untouched" (`null`), so every
 * other test below runs against the real `rulesets/classic/cities.json` /
 * `economy.json` and its exact real numbers, cross-checked by reading them
 * directly here rather than duplicating hardcoded expectations.
 */
import { describe, expect, it, vi } from 'vitest';

let mockBusDaysOverride: number | null = null;
let citiesOverride: import('@/sim/types').CitiesFile | null = null;

vi.mock('@/data/rulesets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/rulesets')>();
  return {
    ...actual,
    citiesConfig: () => citiesOverride ?? actual.citiesConfig(),
    economy: () => {
      const real = actual.economy();
      if (mockBusDaysOverride === null) return real;
      return {
        ...real,
        services: {
          ...real.services,
          busToAdjacentCity: { ...real.services.busToAdjacentCity, days: mockBusDaysOverride },
        },
      };
    },
  };
});

const { citiesConfig, drivingConfig, economy, getBody, getPlant, getTire, UnknownRulesetIdError } = await import(
  '@/data/rulesets'
);
const { initialClock } = await import('@/sim/calendar');
const { beginRoadTrip, stepRoadTrip } = await import('@/sim/road');
const { expectedSpawnsFor, neighbourCityOf, NoPathError, routesFrom, shortestPathByDanger, shortestPathByMiles, travelDaysFor } =
  await import('@/sim/world-map');

/**
 * `allCityIds`/`neighbours`/`routeBetween` are module-private in
 * `@/sim/world-map` now (dijkstra-only plumbing with no caller outside that
 * file — see its own header) — these test-local equivalents read
 * `citiesConfig()` directly, the same independent oracle several tests
 * below already cross-check the real exports against.
 */
function allCityIds(): readonly string[] {
  return citiesConfig().cities.map((city) => city.id);
}

function routeBetween(fromCityId: string, toCityId: string): RouteDef {
  const route = citiesConfig().routes.find(
    (candidate) => (candidate.a === fromCityId && candidate.b === toCityId) || (candidate.a === toCityId && candidate.b === fromCityId),
  );
  if (route === undefined) throw new Error(`fixture: no route between "${fromCityId}" and "${toCityId}"`);
  return route;
}

import { makeArmorRecord } from '@/sim/types';
import type { CitiesFile, RouteDef, VehicleDesign, VehicleState } from '@/sim/types';
import type { ResolvedRoute, RoadTripState } from '@/sim/road';
import { createRng } from '@/util/rng';
import type { Rng } from '@/util/rng';

// ---------------------------------------------------------------------------
// Adjacency — reads cities.json at call time, cross-checked against a
// direct citiesConfig() read rather than a hardcoded duplicate.
// ---------------------------------------------------------------------------

describe('world-map: adjacency reads cities.json at call time', () => {
  it('routesFrom(newyork) matches every real cities.json route whose a or b is newyork', () => {
    const expected = citiesConfig()
      .routes.filter((r) => r.a === 'newyork' || r.b === 'newyork')
      .map((r) => r.id)
      .sort();
    expect(routesFrom('newyork').map((r) => r.id).sort()).toEqual(expected);
  });

  it('neighbourCityOf throws RangeError when the route does not actually touch fromCityId', () => {
    const route = routeBetween('newyork', 'albany');
    expect(() => neighbourCityOf(route, 'boston')).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Unknown ids throw
// ---------------------------------------------------------------------------

describe('world-map: unknown city ids throw', () => {
  it('routesFrom throws UnknownRulesetIdError for an unknown city id', () => {
    expect(() => routesFrom('nowhereville')).toThrow(UnknownRulesetIdError);
  });

  it('shortestPathByMiles and shortestPathByDanger throw UnknownRulesetIdError for an unknown city id', () => {
    expect(() => shortestPathByMiles('nowhereville', 'newyork')).toThrow(UnknownRulesetIdError);
    expect(() => shortestPathByMiles('newyork', 'nowhereville')).toThrow(UnknownRulesetIdError);
    expect(() => shortestPathByDanger('nowhereville', 'newyork')).toThrow(UnknownRulesetIdError);
    expect(() => shortestPathByDanger('newyork', 'nowhereville')).toThrow(UnknownRulesetIdError);
  });
});

// ---------------------------------------------------------------------------
// Every city reachable from the start city
// ---------------------------------------------------------------------------

describe('world-map: every city is reachable from the start city', () => {
  it('newyork shortest-paths (by miles) to every other real city without throwing, arriving exactly there', () => {
    for (const cityId of allCityIds()) {
      if (cityId === 'newyork') continue;
      const result = shortestPathByMiles('newyork', cityId);
      expect(result.cityIds[0]).toBe('newyork');
      expect(result.cityIds[result.cityIds.length - 1]).toBe(cityId);
      expect(result.legs.length).toBeGreaterThan(0);
      expect(result.totalMiles).toBeGreaterThan(0);
      // The path is contiguous: each leg's toCityId feeds the next leg's fromCityId.
      for (let i = 1; i < result.legs.length; i++) {
        expect(result.legs[i]?.fromCityId).toBe(result.legs[i - 1]?.toCityId);
      }
    }
  });

  it('every REAL city shortest-paths (by danger) to every other city, arriving exactly there with a genuine positive-cost route', () => {
    const ids = allCityIds();
    // Guards against a truncated/empty allCityIds turning the sweep below
    // vacuous: cross-check its count against citiesConfig() directly, an
    // oracle independent of allCityIds itself, rather than reusing
    // allCityIds() as both the subject under test and its own proof.
    expect(ids.length).toBe(citiesConfig().cities.length);
    expect(ids.length).toBeGreaterThan(1);
    for (const from of ids) {
      for (const to of ids) {
        if (from === to) continue;
        const result = shortestPathByDanger(from, to);
        expect(result.cityIds[0]).toBe(from);
        expect(result.cityIds[result.cityIds.length - 1]).toBe(to);
        expect(result.legs.length).toBeGreaterThan(0);
        expect(result.totalMiles).toBeGreaterThan(0);
        expect(result.totalDanger).toBeGreaterThan(0);
      }
    }
  });

  it('a same-city path is the empty trip: one city, no legs, zero cost', () => {
    const result = shortestPathByMiles('newyork', 'newyork');
    expect(result.cityIds).toEqual(['newyork']);
    expect(result.legs).toEqual([]);
    expect(result.totalMiles).toBe(0);
    expect(result.totalDanger).toBe(0);
    expect(result.totalTravelDays).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The two path-finders genuinely differ: a shorter route that is MORE
// dangerous. Exact numbers below are derived straight from
// rulesets/classic/cities.json's real route table (see the comment on each
// figure), not invented — a wrong Dijkstra (e.g. one that silently uses
// lengthMiles for both rankings) would produce IDENTICAL legs for both
// calls and fail every assertion here.
// ---------------------------------------------------------------------------

describe('world-map: shortestPathByMiles and shortestPathByDanger genuinely diverge', () => {
  it('albany -> harrisburg: the quicker route is shorter but strictly more dangerous than the safer route', () => {
    const quicker = shortestPathByMiles('albany', 'harrisburg');
    const safer = shortestPathByDanger('albany', 'harrisburg');

    // quicker: albany-scranton (160mi, danger 2) + harrisburg-scranton (120mi, danger 2) = 280mi.
    // totalDanger is the mileage-scaled expected encounter count (see
    // expectedSpawnsFor), NOT a sum of raw danger ratings: danger 2's
    // spawnsPerHundredMiles is 2.3, so 2.3*1.60 + 2.3*1.20 = 6.44.
    expect(quicker.legs.map((l) => l.route.id)).toEqual(['albany-scranton', 'harrisburg-scranton']);
    expect(quicker.totalMiles).toBe(280);
    expect(quicker.totalDanger).toBeCloseTo(6.44, 9);
    expect(quicker.totalDanger).toBeCloseTo(
      quicker.legs.reduce((sum, leg) => sum + expectedSpawnsFor(leg.route), 0),
      9,
    );

    // safer: ny-albany (150mi, d1) + ny-philadelphia (95mi, d1) + harrisburg-philadelphia (105mi, d1) = 350mi.
    // danger 1's spawnsPerHundredMiles is 1.6, so 1.6*(1.50+0.95+1.05) = 5.6 —
    // genuinely lower expected encounter load than the quicker route's 6.44,
    // even though it covers 70 more miles.
    expect(safer.legs.map((l) => l.route.id)).toEqual(['ny-albany', 'ny-philadelphia', 'harrisburg-philadelphia']);
    expect(safer.totalMiles).toBe(350);
    expect(safer.totalDanger).toBeCloseTo(5.6, 9);
    expect(safer.totalDanger).toBeCloseTo(
      safer.legs.reduce((sum, leg) => sum + expectedSpawnsFor(leg.route), 0),
      9,
    );

    expect(quicker.totalMiles).toBeLessThan(safer.totalMiles);
    expect(quicker.totalDanger).toBeGreaterThan(safer.totalDanger);

    // Each ranking is genuinely optimal for its OWN metric, not just different from the other.
    expect(quicker.totalMiles).toBeLessThanOrEqual(safer.totalMiles);
    expect(safer.totalDanger).toBeLessThanOrEqual(quicker.totalDanger);
  });

  it('shortestPathByMiles never returns a higher-mileage path than shortestPathByDanger for the same pair, across every diverging pair in the real graph', () => {
    const ids = allCityIds();
    let divergedAtLeastOnce = false;
    for (const from of ids) {
      for (const to of ids) {
        if (from === to) continue;
        const byMiles = shortestPathByMiles(from, to);
        const byDanger = shortestPathByDanger(from, to);
        expect(byMiles.totalMiles).toBeLessThanOrEqual(byDanger.totalMiles);
        expect(byDanger.totalDanger).toBeLessThanOrEqual(byMiles.totalDanger);
        if (byMiles.legs.map((l) => l.route.id).join('>') !== byDanger.legs.map((l) => l.route.id).join('>')) {
          divergedAtLeastOnce = true;
        }
      }
    }
    // Guards against a no-op "path-finder" that always returns the same
    // single path for both rankings and would otherwise pass the <= checks
    // above vacuously.
    expect(divergedAtLeastOnce).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deterministic tie-breaking
// ---------------------------------------------------------------------------

describe('world-map: tie-breaks are deterministic — the lexicographically-first predecessor wins a genuine cost tie', () => {
  /**
   * hub connects to BOTH 'zzz' and 'aaa' by an identical 5mi/danger-0
   * route, and both of those connect onward to 'dest' by another identical
   * 5mi/danger-0 route — a genuine tie between routing through 'aaa' vs
   * through 'zzz', for BOTH the miles metric and the (identically-priced,
   * since every route here shares one danger tier) danger metric.
   *
   * Cities and routes are deliberately listed with 'zzz' BEFORE 'aaa' in
   * cities.json's own enumeration order (the array order `allCityIds`/
   * `neighbours` would return without the ascending sort `dijkstra`
   * applies), so a correct result can only come from that documented sort
   * — never from coincidentally matching raw array order. See the mutation
   * evidence below each assertion.
   */
  function makeTieGraph(): CitiesFile {
    const real = citiesConfig();
    return {
      $schemaVersion: real.$schemaVersion,
      facilityKinds: real.facilityKinds,
      cities: [
        { id: 'hub', name: 'Hub', x: 0, y: 0, facilities: [] },
        { id: 'zzz', name: 'Zzz', x: 1, y: 1, facilities: [] },
        { id: 'aaa', name: 'Aaa', x: 1, y: -1, facilities: [] },
        { id: 'dest', name: 'Dest', x: 2, y: 0, facilities: [] },
      ],
      routes: [
        { id: 'hub-zzz', a: 'hub', b: 'zzz', lengthMiles: 5, danger: 0 },
        { id: 'hub-aaa', a: 'hub', b: 'aaa', lengthMiles: 5, danger: 0 },
        { id: 'zzz-dest', a: 'zzz', b: 'dest', lengthMiles: 5, danger: 0 },
        { id: 'aaa-dest', a: 'aaa', b: 'dest', lengthMiles: 5, danger: 0 },
      ],
      championships: real.championships,
    };
  }

  it('shortestPathByMiles breaks a genuine tie by keeping the lexicographically-first predecessor ("aaa" over "zzz")', () => {
    citiesOverride = makeTieGraph();
    try {
      const result = shortestPathByMiles('hub', 'dest');
      // Mutation-proven: reversing BOTH sorts in dijkstra() (the frontier
      // scan order and the per-city edge order), or deleting them entirely
      // (falling back to this graph's raw 'zzz'-before-'aaa' array order),
      // both settle 'zzz' first instead and produce
      // ['hub-zzz', 'zzz-dest'] here — a different, checkable answer, not
      // just "some path exists".
      expect(result.legs.map((l) => l.route.id)).toEqual(['hub-aaa', 'aaa-dest']);
      expect(result.cityIds).toEqual(['hub', 'aaa', 'dest']);
      expect(result.totalMiles).toBe(10);
    } finally {
      citiesOverride = null;
    }
  });

  it('shortestPathByDanger breaks the identical tie the identical way ("aaa" over "zzz"), since every route here shares one danger tier', () => {
    citiesOverride = makeTieGraph();
    try {
      const result = shortestPathByDanger('hub', 'dest');
      expect(result.legs.map((l) => l.route.id)).toEqual(['hub-aaa', 'aaa-dest']);
      expect(result.cityIds).toEqual(['hub', 'aaa', 'dest']);
    } finally {
      citiesOverride = null;
    }
  });
});

// ---------------------------------------------------------------------------
// travelDaysFor: consistent with @/sim/road's own rule, proven against a
// REAL live traversal (not a second formula asserting against itself).
// ---------------------------------------------------------------------------

describe('world-map: travelDaysFor matches a real @/sim/road traversal', () => {
  const BODY = getBody('midsized');
  const PLANT = getPlant('large');
  const TIRE = getTire('standard');
  const CONFIG = drivingConfig();
  const DT = 1 / CONFIG.tickRateHz;
  const FULL_THROTTLE = { stick: { x: 1, y: 0 } };
  const MAX_TEST_SECONDS = 120;
  const MAX_TICKS = Math.ceil(MAX_TEST_SECONDS * CONFIG.tickRateHz);

  function makeVehicle(): VehicleState {
    const design: VehicleDesign = {
      name: 'World Map Test Rig',
      bodyId: BODY.id,
      chassisId: 'standard',
      suspensionId: 'improved',
      plantId: PLANT.id,
      tireId: TIRE.id,
      armor: makeArmorRecord(2),
      weapons: [],
    };
    return {
      id: 'veh-worldmap-1',
      ownerId: 'driver-1',
      design,
      position: { x: 0, y: 0 },
      headingRad: 0,
      speedMps: 0,
      battery: 99,
      odometerMiles: 0,
      armorDP: makeArmorRecord(2),
      tireDP: [TIRE.maxDP, TIRE.maxDP, TIRE.maxDP, TIRE.maxDP],
      plantDP: PLANT.maxDP,
      weapons: [],
      cargo: [],
      controlStress: 0,
      controlLossTicks: 0,
      statusEffects: [],
      destroyed: false,
      batteryDebt: 0,
    };
  }

  /** Full continuous day-cost (whole days advanced plus leftover fractional debt) of driving `route` to arrival, full throttle, exactly as tests/unit/road.test.ts's own `totalDayCost` helper measures it. */
  function driveFullRouteDayCost(route: RouteDef, seed: string): number {
    const rng: Rng = createRng(seed);
    const start = initialClock();
    const resolved: ResolvedRoute = { route, originCityId: route.a, destinationCityId: route.b };
    let state: RoadTripState = beginRoadTrip(resolved, makeVehicle(), start, rng);
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      const result = stepRoadTrip(state, FULL_THROTTLE, DT, rng, 50, 'normal');
      state = result.state;
      if (result.arrived) break;
    }
    return state.clock.dayIndex - start.dayIndex + state.dayDebt;
  }

  /**
   * A RELATIVE bound, not `toBeCloseTo(x, 3)`: on this route's tiny
   * (~0.003 day) true cost, an absolute tolerance of 0.0005 is a ~15% band
   * — wide enough that the shipped `* 1.1` (10% too high) mile-to-day bug
   * survived it. Measured against the real, correct implementation this
   * live traversal actually lands within ~0.06% of `travelDaysFor` (far
   * inside this bound), so 2% has real headroom for legitimate float/tick
   * noise while still catching a 10% formula error outright.
   */
  const MAX_RELATIVE_DAY_COST_ERROR = 0.02;

  function expectDayCostMatches(actualDays: number, route: RouteDef): void {
    const expectedDays = travelDaysFor(route);
    const relativeError = Math.abs(actualDays - expectedDays) / expectedDays;
    expect(relativeError).toBeLessThan(MAX_RELATIVE_DAY_COST_ERROR);
  }

  it('a synthetic route driven to arrival costs travelDaysFor(route) worth of calendar days, within a tight RELATIVE tolerance', () => {
    const testRouteMiles = (PLANT.topSpeedMph * 5) / 3600;
    const route: RouteDef = { id: 'world-map-cross-check', a: 'origin', b: 'destination', lengthMiles: testRouteMiles * 3, danger: 0 };
    const actualDays = driveFullRouteDayCost(route, 'world-map-cross-check-seed');
    expectDayCostMatches(actualDays, route);
  });

  it('travelDaysFor scales with route length exactly the way a live traversal does — 4x the miles costs 4x the days', () => {
    const testRouteMiles = (PLANT.topSpeedMph * 5) / 3600;
    const shortRoute: RouteDef = { id: 'world-map-scale-short', a: 'x', b: 'y', lengthMiles: testRouteMiles, danger: 0 };
    const longRoute: RouteDef = { id: 'world-map-scale-long', a: 'x', b: 'y', lengthMiles: testRouteMiles * 4, danger: 0 };
    expect(travelDaysFor(longRoute) / travelDaysFor(shortRoute)).toBeCloseTo(4, 6);

    const shortActual = driveFullRouteDayCost(shortRoute, 'world-map-scale-seed');
    const longActual = driveFullRouteDayCost(longRoute, 'world-map-scale-seed');

    // A multiplicative mile-to-day error (e.g. the shipped `* 1.1`) cancels
    // out of this short/long RATIO — both sides get the same wrong factor —
    // so it alone can't catch that bug. Checking each side against
    // travelDaysFor's own absolute prediction, at the same tight relative
    // bound as the test above, closes that gap.
    expectDayCostMatches(shortActual, shortRoute);
    expectDayCostMatches(longActual, longRoute);
    expect(longActual / shortActual).toBeCloseTo(4, 1);
  });

  it('travelDaysFor(route) matches (route.lengthMiles / cities.json average) * economy busToAdjacentCity.days for every real route', () => {
    const routes = citiesConfig().routes;
    const avgRouteMiles = routes.reduce((sum, r) => sum + r.lengthMiles, 0) / routes.length;
    const tripDays = economy().services.busToAdjacentCity.days;
    for (const route of routes) {
      expect(travelDaysFor(route)).toBeCloseTo((route.lengthMiles / avgRouteMiles) * tripDays, 9);
    }
  });

  it('moves when busToAdjacentCity.days is mocked to an unrelated value, proving a call-time read, not a hardcoded ratio', () => {
    const route = citiesConfig().routes[0];
    if (route === undefined) throw new Error('fixture: cities.json has no routes to test against');
    const unmocked = travelDaysFor(route);
    mockBusDaysOverride = 999; // arbitrary and unrelated to the real ruleset value (1)
    try {
      const mocked = travelDaysFor(route);
      expect(mocked).not.toBeCloseTo(unmocked, 3);
      const routes = citiesConfig().routes;
      const avgRouteMiles = routes.reduce((sum, r) => sum + r.lengthMiles, 0) / routes.length;
      expect(mocked).toBeCloseTo((route.lengthMiles / avgRouteMiles) * 999, 6);
    } finally {
      mockBusDaysOverride = null;
    }
  });
});

// ---------------------------------------------------------------------------
// NoPathError — a branch the real, fully-connected cities.json never
// exercises, so it's proven here against a deliberately disconnected mock.
// ---------------------------------------------------------------------------

describe('world-map: NoPathError on a genuinely disconnected graph (mocked)', () => {
  it('shortestPathByMiles throws NoPathError for a real-but-unreachable city', () => {
    const real = citiesConfig();
    const disconnected: CitiesFile = {
      $schemaVersion: real.$schemaVersion,
      facilityKinds: real.facilityKinds,
      cities: [
        { id: 'alpha', name: 'Alpha', x: 0, y: 0, facilities: [] },
        { id: 'beta', name: 'Beta', x: 1, y: 0, facilities: [] },
        { id: 'gamma', name: 'Gamma', x: 2, y: 0, facilities: [] },
      ],
      routes: [{ id: 'alpha-beta', a: 'alpha', b: 'beta', lengthMiles: 10, danger: 0 }],
      championships: real.championships,
    };
    citiesOverride = disconnected;
    try {
      // gamma is a REAL, known city in this mocked graph — just unreachable — so this must be NoPathError, not UnknownRulesetIdError.
      expect(() => shortestPathByMiles('alpha', 'gamma')).toThrow(NoPathError);
      expect(() => shortestPathByDanger('beta', 'gamma')).toThrow(NoPathError);
      // The reachable pair still resolves normally under the same mock.
      expect(shortestPathByMiles('alpha', 'beta').legs.map((l) => l.route.id)).toEqual(['alpha-beta']);
    } finally {
      citiesOverride = null;
    }
  });
});
