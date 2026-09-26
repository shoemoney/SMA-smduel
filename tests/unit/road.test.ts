/**
 * Mocks '@/data/rulesets' for the WHOLE file (vi.mock is hoisted above every
 * import, same as tests/unit/calendar.cadence-not-hardcoded.test.ts) so the
 * calendar-advancement tests below can prove `stepRoadTrip`'s day-cost comes
 * from economy.json's busToAdjacentCity service at call time, not a
 * hardcoded number. Every OTHER export of '@/data/rulesets' passes straight
 * through to the real implementation via `...actual`, so every other test in
 * this file (encounter generation, disposition, wrecks/hazards) still runs
 * against real ruleset data.
 *
 * `mockBusDays` is a mutable `let`, not a value derived from the real
 * ruleset (a previous version used `real + 2`, which a hardcoded
 * `return 3` in the implementation could satisfy by coincidence — proven by
 * mutation, see tests/unit/road.test.ts history). The economy() mock reads
 * this variable at CALL TIME, so a single test can drive the same route
 * under two unrelated mocked values and check the day-cost output moves
 * exactly with it; only a real `economy()` read at call time can track two
 * arbitrary, unrelated numbers.
 */
import { describe, expect, it, vi } from 'vitest';

let mockBusDays = 3;

vi.mock('@/data/rulesets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/rulesets')>();
  return {
    ...actual,
    economy: () => {
      const real = actual.economy();
      return {
        ...real,
        services: {
          ...real.services,
          busToAdjacentCity: { ...real.services.busToAdjacentCity, days: mockBusDays },
        },
      };
    },
  };
});

const { citiesConfig, drivingConfig, getBody, getPlant, getTire, getWeapon } = await import('@/data/rulesets');
const { initialClock } = await import('@/sim/calendar');
const { salvageRoll } = await import('@/sim/economy');
const {
  abandonVehicle,
  attackContact,
  beginRoadTrip,
  createWreck,
  crossDestinationGate,
  generateRouteContacts,
  getFaction,
  isHazardActive,
  isWreckPresent,
  milesIntoRoute,
  placeRoadHazard,
  resolveRoute,
  stepRoadTrip,
  stripExpiredHazards,
  stripWrecksOvernight,
  updateContactForProgress,
  willFire,
  UnknownDangerLevelError,
  UnknownRouteError,
} = await import('@/sim/road');
import { makeArmorRecord } from '@/sim/types';
import type { RouteDef, VehicleDesign, VehicleState } from '@/sim/types';
import type { DriveInput } from '@/sim/driving';
import type { RoadContact, ResolvedRoute, RoadTripState } from '@/sim/road';
import { createRng } from '@/util/rng';
import type { Rng } from '@/util/rng';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BODY = getBody('midsized');
const PLANT = getPlant('large'); // topSpeedMph 90
const TIRE = getTire('standard');
const CONFIG = drivingConfig();
const DT = 1 / CONFIG.tickRateHz;
const FULL_THROTTLE: DriveInput = { stick: { x: 1, y: 0 } };

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  const design: VehicleDesign = {
    name: 'Road Test Rig',
    bodyId: BODY.id,
    chassisId: 'standard',
    suspensionId: 'improved',
    plantId: PLANT.id,
    tireId: TIRE.id,
    armor: makeArmorRecord(2),
    weapons: [],
  };
  const base: VehicleState = {
    id: 'veh-road-1',
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
  return { ...base, ...overrides };
}

// A tiny synthetic route (a few seconds of driving at top speed) so a
// scripted full-throttle drive finishes in a handful of ticks instead of the
// tens of thousands a real 40-240 mile cities.json route would take.
const TEST_ROUTE: RouteDef = {
  id: 'test-route',
  a: 'origin',
  b: 'destination',
  lengthMiles: (PLANT.topSpeedMph * 5) / 3600,
  danger: 0,
};
const TEST_RESOLVED: ResolvedRoute = { route: TEST_ROUTE, originCityId: TEST_ROUTE.a, destinationCityId: TEST_ROUTE.b };

// Generous real-time cap for the tiny synthetic route above — a test-harness
// safety bound against an infinite loop, not a gameplay number.
const MAX_TEST_SECONDS = 120;
const MAX_TICKS = Math.ceil(MAX_TEST_SECONDS * CONFIG.tickRateHz);

function driveToArrival(rng: Rng): RoadTripState {
  let state = beginRoadTrip(TEST_RESOLVED, makeVehicle(), initialClock(), rng);
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    const result = stepRoadTrip(state, FULL_THROTTLE, DT, rng, 50, 'normal');
    state = result.state;
    if (result.arrived) return state;
  }
  throw new Error(`did not arrive within ${MAX_TICKS} ticks`);
}

// ---------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------

describe('road: route resolution', () => {
  it('resolves a real cities.json route in either travel direction', () => {
    const real = citiesConfig().routes[0];
    if (real === undefined) throw new Error('cities.json has no routes to test against');
    const forward = resolveRoute(real.a, real.b);
    const backward = resolveRoute(real.b, real.a);
    expect(forward.route.id).toBe(real.id);
    expect(backward.route.id).toBe(real.id);
    expect(forward.originCityId).toBe(real.a);
    expect(forward.destinationCityId).toBe(real.b);
    expect(backward.originCityId).toBe(real.b);
    expect(backward.destinationCityId).toBe(real.a);
  });

  it('throws UnknownRouteError for two cities with no direct route', () => {
    expect(() => resolveRoute('nowhere-a', 'nowhere-b')).toThrow(UnknownRouteError);
  });
});

// ---------------------------------------------------------------------------
// Scripted drive: odometer reaches the route's lengthMiles
// ---------------------------------------------------------------------------

describe('road: a scripted drive reaches the destination', () => {
  it('odometer matches the route lengthMiles within one tick of travel, and crosses the gate', () => {
    const rng = createRng('road-scripted-drive');
    const state = driveToArrival(rng);

    const progress = milesIntoRoute(state);
    const toleranceMiles = (PLANT.topSpeedMph * DT) / 3600; // farthest one tick could overshoot by, at top speed
    expect(progress).toBeGreaterThanOrEqual(TEST_ROUTE.lengthMiles);
    expect(progress - TEST_ROUTE.lengthMiles).toBeLessThanOrEqual(toleranceMiles);

    const gate = crossDestinationGate(state);
    expect(gate).not.toBeNull();
    expect(gate?.cityId).toBe(TEST_ROUTE.b);
  });
});

// ---------------------------------------------------------------------------
// Arrival is measured by route PROGRESS, not by the odometer, which is
// Math.abs(distance) — regression for the defect where holding full reverse
// (or otherwise racking up real distance without net forward motion) let
// the player "arrive" at the destination.
// ---------------------------------------------------------------------------

describe('road: arrival is measured by progress toward the destination, not total odometer distance', () => {
  const FULL_REVERSE: DriveInput = { stick: { x: -1, y: 0 } };

  it('holding full reverse the whole way never reaches the destination, even though the odometer keeps climbing', () => {
    const rng = createRng('road-reverse-seed');
    let state = beginRoadTrip(TEST_RESOLVED, makeVehicle(), initialClock(), rng);

    for (let tick = 0; tick < MAX_TICKS; tick++) {
      const result = stepRoadTrip(state, FULL_REVERSE, DT, rng, 50, 'normal');
      state = result.state;
      // Never arrives, on any single tick along the way.
      expect(result.arrived).toBe(false);
    }

    expect(crossDestinationGate(state)).toBeNull();
    expect(milesIntoRoute(state)).toBeLessThanOrEqual(0);
    // The car genuinely moved (this isn't just "it never moved") — the
    // odometer racked up real distance driving backward. That distance must
    // NOT count as progress toward the gate.
    expect(state.vehicle.odometerMiles).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Calendar: advances after a significant interval, not per tick, the
// day-cost is read from the (mocked) ruleset rather than hardcoded, and a
// route's total cost scales with its own lengthMiles instead of always
// costing exactly one flat "bus hop" regardless of distance.
// ---------------------------------------------------------------------------

/** Sum of `daysAdvanced` and the leftover fractional `dayDebt` — the exact continuous day-cost accrued so far, independent of tick-granularity flooring. */
function totalDayCost(state: RoadTripState, start: ReturnType<typeof initialClock>): number {
  return state.clock.dayIndex - start.dayIndex + state.dayDebt;
}

function driveRoute(route: RouteDef, seed: string): { state: RoadTripState; start: ReturnType<typeof initialClock> } {
  const rng = createRng(seed);
  const start = initialClock();
  const resolved: ResolvedRoute = { route, originCityId: route.a, destinationCityId: route.b };
  let state = beginRoadTrip(resolved, makeVehicle(), start, rng);
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    const result = stepRoadTrip(state, FULL_THROTTLE, DT, rng, 50, 'normal');
    state = result.state;
    if (result.arrived) break;
  }
  return { state, start };
}

describe('road: calendar advances from mileage, not per tick, not hardcoded, and scales with route length', () => {
  it('a single early tick advances a small ruleset-derived fractional day debt, not a whole day and not zero', () => {
    mockBusDays = 3;
    const rng = createRng('road-calendar-first-tick');
    const start = initialClock();
    const state = beginRoadTrip(TEST_RESOLVED, makeVehicle(), start, rng);
    const result = stepRoadTrip(state, FULL_THROTTLE, DT, rng, 50, 'normal');
    expect(result.daysAdvanced).toBe(0);
    expect(result.state.clock.dayIndex).toBe(start.dayIndex);
    // Real forward motion DID accrue some fractional debt (rules out an
    // implementation that never advances the calendar at all)...
    expect(result.state.dayDebt).toBeGreaterThan(0);
    // ...but nothing close to a whole day yet from one tick.
    expect(result.state.dayDebt).toBeLessThan(0.5);
  });

  it('the SAME implementation tracks two different mocked bus-day rates at call time (not a baked-in literal)', () => {
    const route: RouteDef = { id: 'rate-check', a: 'x', b: 'y', lengthMiles: TEST_ROUTE.lengthMiles, danger: 0 };

    mockBusDays = 11;
    const costEleven = totalDayCost(driveRoute(route, 'rate-check-seed').state, initialClock());

    mockBusDays = 41;
    const costFortyOne = totalDayCost(driveRoute(route, 'rate-check-seed').state, initialClock());

    // A hardcoded day-cost (or one derived from a single mock, like the old
    // `real + 2`) cannot track two unrelated numbers like 11 and 41 — only a
    // real `economy()` read at call time can.
    expect(costFortyOne).toBeGreaterThan(costEleven);
    expect(costFortyOne / costEleven).toBeCloseTo(41 / 11, 2);
  });

  it('a full route traversal costs days proportional to the route length — a route 4x longer costs 4x as many days', () => {
    mockBusDays = 3;
    const shortRoute: RouteDef = { id: 'scale-short', a: 'x', b: 'y', lengthMiles: TEST_ROUTE.lengthMiles, danger: 0 };
    const longRoute: RouteDef = { id: 'scale-long', a: 'x', b: 'y', lengthMiles: TEST_ROUTE.lengthMiles * 4, danger: 0 };

    const short = driveRoute(shortRoute, 'scale-seed');
    const long = driveRoute(longRoute, 'scale-seed');
    expect(milesIntoRoute(short.state)).toBeGreaterThanOrEqual(shortRoute.lengthMiles);
    expect(milesIntoRoute(long.state)).toBeGreaterThanOrEqual(longRoute.lengthMiles);

    const shortCost = totalDayCost(short.state, short.start);
    const longCost = totalDayCost(long.state, long.start);
    // The shipped bug scaled tripDays() by the FRACTION of the route
    // covered (milesMoved / route.lengthMiles), which always integrates to
    // exactly tripDays() at arrival no matter the route's length — this
    // ratio would come out ~1, not ~4, under that bug.
    expect(longCost / shortCost).toBeCloseTo(4, 1);

    // And it is priced against cities.json's OWN real average route length
    // (never a literal in the implementation), so the exact figure is
    // reconstructible from ruleset data alone.
    const routes = citiesConfig().routes;
    const avgRouteMiles = routes.reduce((sum, r) => sum + r.lengthMiles, 0) / routes.length;
    const expectedShortCost = (shortRoute.lengthMiles / avgRouteMiles) * mockBusDays;
    expect(shortCost).toBeCloseTo(expectedShortCost, 3);
  });
});

// ---------------------------------------------------------------------------
// Encounters: danger drives spawn budget and outlaw probability
// ---------------------------------------------------------------------------

describe('road: route danger drives the encounter spawn budget', () => {
  const LENGTH_MILES = 200;

  it('danger 0 and danger 4 produce measurably different spawn budgets from the same seed', () => {
    const routeD0: RouteDef = { id: 'synthetic-d0', a: 'x', b: 'y', lengthMiles: LENGTH_MILES, danger: 0 };
    const routeD4: RouteDef = { id: 'synthetic-d4', a: 'x', b: 'y', lengthMiles: LENGTH_MILES, danger: 4 };

    const contactsD0 = generateRouteContacts(routeD0, createRng('encounter-seed'));
    const contactsD4 = generateRouteContacts(routeD4, createRng('encounter-seed'));

    expect(contactsD4.length).toBeGreaterThan(contactsD0.length);

    // Packs only ever form around an outlaw spawn (SPEC "Road": "Outlaws may
    // run in packs").
    const packed = contactsD4.filter((c) => c.packId !== null);
    expect(packed.length).toBeGreaterThan(0);
    expect(packed.every((c) => c.faction === 'outlaw')).toBe(true);
  });

  it('throws UnknownDangerLevelError for a danger value the ruleset does not define', () => {
    const badRoute: RouteDef = { id: 'bad-danger', a: 'x', b: 'y', lengthMiles: 100, danger: 99 };
    expect(() => generateRouteContacts(badRoute, createRng('bad-danger-seed'))).toThrow(UnknownDangerLevelError);
  });

  // encounters.json's danger-0 factionWeights.outlaw is exactly 0 — the
  // weighted traffic-mix roll in generateRouteContacts can NEVER produce an
  // outlaw there on its own (weight 0 is never selected). So any outlaw
  // appearing at danger 0 at all can only come from `dangerLevels[0]`'s
  // OWN `outlawChance` (0.05) — previously validated by the schema and
  // never consulted anywhere (`grep -rn outlawChance src tests` matched
  // only its own type/schema declarations). This is a real, non-tautological
  // proof that the knob is wired up: not "the value equals X for one seed"
  // (which the old version of this suite did, and got flagged for it), but
  // "outlaws appear here at all, over many independent seeds, despite the
  // weighted mix making that impossible by itself".
  it('outlawChance alone accounts for every outlaw that spawns at danger 0, and danger 4 spawns outlaws far more often', () => {
    const trials = 200;
    let d0OutlawTrials = 0;
    let d4OutlawTrials = 0;
    for (let i = 0; i < trials; i++) {
      const routeD0: RouteDef = { id: `outlawchance-d0-${i}`, a: 'x', b: 'y', lengthMiles: LENGTH_MILES, danger: 0 };
      const routeD4: RouteDef = { id: `outlawchance-d4-${i}`, a: 'x', b: 'y', lengthMiles: LENGTH_MILES, danger: 4 };
      if (generateRouteContacts(routeD0, createRng(`outlawchance-d0-trial-${i}`)).some((c) => c.faction === 'outlaw')) {
        d0OutlawTrials++;
      }
      if (generateRouteContacts(routeD4, createRng(`outlawchance-d4-trial-${i}`)).some((c) => c.faction === 'outlaw')) {
        d4OutlawTrials++;
      }
    }
    expect(d0OutlawTrials).toBeGreaterThan(0);
    expect(d4OutlawTrials).toBeGreaterThan(d0OutlawTrials);
  });
});

// ---------------------------------------------------------------------------
// Contact disposition: unprovoked vs. attacked, and visual-range break-off
// ---------------------------------------------------------------------------

describe('road: contact faction and disposition', () => {
  // A large danger-4 route on this seed reliably spawns every faction,
  // including both a hostile-by-ruleset one (outlaw) and several
  // peaceful-by-ruleset ones — see the precondition assertions below, which
  // fail loudly (not silently pass) if that ever stops being true.
  const MIXED_ROUTE: RouteDef = { id: 'disposition-mix-route', a: 'x', b: 'y', lengthMiles: 500, danger: 4 };
  const mixedContacts = generateRouteContacts(MIXED_ROUTE, createRng('disposition-mix-seed'));

  it('fixture precondition: this seed actually spawned both a hostile and a peaceful faction', () => {
    const seenFactions = new Set(mixedContacts.map((c) => c.faction));
    expect([...seenFactions].some((id) => getFaction(id).hostile)).toBe(true);
    expect([...seenFactions].some((id) => !getFaction(id).hostile)).toBe(true);
  });

  it("every generated contact's initial disposition and willFire match its faction's REAL hostile flag from encounters.json", () => {
    // Grounded in getFaction(...).hostile (the real ruleset), not a
    // hand-typed 'peaceful'/'hostile' literal fixture — inverting
    // initialDisposition's mapping would fail this for every contact.
    for (const contact of mixedContacts) {
      const expectedDisposition = getFaction(contact.faction).hostile ? 'hostile' : 'peaceful';
      expect(contact.disposition).toBe(expectedDisposition);
      expect(willFire(contact)).toBe(getFaction(contact.faction).hostile);
    }
  });

  it('attacking a peaceful, retaliating contact makes it fire back', () => {
    const peaceful = mixedContacts.find((c) => !getFaction(c.faction).hostile);
    if (peaceful === undefined) throw new Error('fixture did not spawn a peaceful contact to attack');
    expect(getFaction(peaceful.faction).retaliates).toBe(true); // precondition on the ruleset itself
    const attacked = attackContact(peaceful);
    expect(attacked.attacked).toBe(true);
    expect(attacked.disposition).toBe('retaliating');
    expect(willFire(attacked)).toBe(true);
  });

  it('a hostile-by-ruleset faction (outlaw) fires without the PLAYER ever attacking it', () => {
    // Not asserting `attacked === false` here: a vigilante sharing this
    // route can legitimately mark an outlaw as already attacked (see the
    // hostileTo test below) before the player ever does anything — that's
    // correct behaviour, not a bug. The point of this test is that outlaws
    // fire regardless, with no `attackContact` call from the player.
    const outlaw = mixedContacts.find((c) => c.faction === 'outlaw');
    if (outlaw === undefined) throw new Error('fixture did not spawn an outlaw to check');
    expect(willFire(outlaw)).toBe(true);
  });

  it('an outlaw breaks off beyond radar visual range once it has actually been reached; a pursuer never does', () => {
    const visualRangeMiles = drivingConfig().radar.visualRangeM / drivingConfig().metersPerMile;
    const farMiles = visualRangeMiles + 1; // safely beyond range

    // routeMiles: 0 means the player's start coincides with this contact, so
    // by the time progress reaches farMiles the player has already been
    // right on top of it and moved away — a genuine "was close, now far".
    const outlaw: RoadContact = { id: 'o1', faction: 'outlaw', packId: null, routeMiles: 0, attacked: false, disposition: 'hostile' };
    const farOutlaw = updateContactForProgress(outlaw, farMiles);
    expect(farOutlaw.disposition).toBe('brokeOff');
    expect(willFire(farOutlaw)).toBe(false);

    const pursuer: RoadContact = { id: 'p1', faction: 'pursuer', packId: null, routeMiles: 0, attacked: false, disposition: 'hostile' };
    const farPursuer = updateContactForProgress(pursuer, farMiles);
    expect(farPursuer.disposition).toBe('hostile');
    expect(willFire(farPursuer)).toBe(true);
  });

  // Regression for the critical defect: brokeOff is TERMINAL, so applying
  // it to a contact the player hasn't reached YET (spawned far down the
  // route) permanently silences it before it was ever encountered — this is
  // what deleted the entire hostile-encounter half of the road on tick one
  // of a real trip.
  it('an outlaw spawned far down the route does NOT break off before the player ever gets close to it', () => {
    const visualRangeMiles = drivingConfig().radar.visualRangeM / drivingConfig().metersPerMile;
    const farAheadOutlaw: RoadContact = { id: 'o2', faction: 'outlaw', packId: null, routeMiles: 120, attacked: false, disposition: 'hostile' };

    // The player has barely moved — nowhere near this contact's spawn
    // point. It must stay engaged, not be marked brokeOff.
    const stillWaiting = updateContactForProgress(farAheadOutlaw, 0.001);
    expect(stillWaiting.disposition).toBe('hostile');
    expect(willFire(stillWaiting)).toBe(true);

    // Once the player's progress actually reaches it, still engaged...
    const nowClose = updateContactForProgress(farAheadOutlaw, 120);
    expect(nowClose.disposition).toBe('hostile');

    // ...and only breaks off once the player has passed it and pulled away
    // beyond visual range.
    const nowPassedIt = updateContactForProgress(farAheadOutlaw, 120 + visualRangeMiles + 1);
    expect(nowPassedIt.disposition).toBe('brokeOff');
  });

  // Full-pipeline regression using a real cities.json route (the exact
  // repro from the defect report): every hostile contact on a fresh trip
  // must survive the FIRST tick, not be silently zeroed out.
  it('a real route trip does not break off every distant outlaw on the very first tick', () => {
    const resolved = resolveRoute('albany', 'manchester');
    expect(resolved.route.lengthMiles).toBeGreaterThan(1); // precondition: a real, non-trivial route
    const rng = createRng('albany-manchester-first-tick-seed');
    const state = beginRoadTrip(resolved, makeVehicle(), initialClock(), rng);
    const hostileBefore = state.contacts.filter(willFire).length;
    expect(hostileBefore).toBeGreaterThan(0); // precondition: this seed spawned at least one hostile

    const result = stepRoadTrip(state, FULL_THROTTLE, DT, rng, 50, 'normal');
    const hostileAfter = result.state.contacts.filter(willFire).length;
    expect(hostileAfter).toBe(hostileBefore);
  });

  // encounters.json's vigilante faction declares hostileTo: ['outlaw']
  // ("attacks outlaws on sight") — previously typed and schema-validated
  // but never consulted by anything.
  it('a vigilante marks a co-spawned outlaw as already attacked (hostileTo is consulted, not dead)', () => {
    let found: { vigilante: RoadContact; outlaw: RoadContact } | undefined;
    for (let i = 0; i < 300 && found === undefined; i++) {
      const route: RouteDef = { id: `hostileto-seed-${i}`, a: 'x', b: 'y', lengthMiles: 500, danger: 4 };
      const contacts = generateRouteContacts(route, createRng(`hostileto-seed-${i}`));
      const vigilante = contacts.find((c) => c.faction === 'vigilante');
      const outlaw = contacts.find((c) => c.faction === 'outlaw');
      if (vigilante !== undefined && outlaw !== undefined) found = { vigilante, outlaw };
    }
    if (found === undefined) throw new Error('no seed within budget spawned both a vigilante and an outlaw together');
    expect(found.outlaw.attacked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wrecks and road hazards: same-day persistence, overnight strip
// ---------------------------------------------------------------------------

describe('road: wrecks persist same-day and vanish overnight', () => {
  it('a wreck survives a same-day return and is gone the next day', () => {
    const wreck = createWreck('w1', { x: 0, y: 0 }, 5, false);
    expect(isWreckPresent(wreck, 5)).toBe(true);
    expect(isWreckPresent(wreck, 6)).toBe(false);
    expect(stripWrecksOvernight([wreck], 5)).toHaveLength(1);
    expect(stripWrecksOvernight([wreck], 6)).toHaveLength(0);
  });

  it('mines and spikes vanish overnight, exactly at their own weapons.json lifetimeDays boundary', () => {
    // getWeapon('minedropper')/('spikedropper') are exercised as a real
    // side effect of placeRoadHazard below, so a separate "confirms they
    // exist" assertion (which touched neither isHazardActive nor
    // stripExpiredHazards) added nothing beyond what these already prove.
    const mine = placeRoadHazard('m1', 'minedropper', { x: 0, y: 0 }, 5);
    expect(getWeapon('minedropper').deployable?.kind).toBe('MINE');
    expect(mine.deployable.lifetimeDays).toBeGreaterThan(0);

    // The old version of this assertion was `isHazardActive(mine, 5 +
    // mine.deployable.lifetimeDays)`, which reduces to `lifetimeDays <
    // lifetimeDays` — false for EVERY possible lifetimeDays, so it could not
    // tell a 1-day mine from a 10-year one. Anchoring to a concrete day
    // number (the exact same "day 5 -> day 6" pair the wreck test above
    // uses) makes this test actually depend on the ruleset's current
    // lifetimeDays value (1 today).
    const lastActiveDay = mine.placedDayIndex + mine.deployable.lifetimeDays - 1;
    const firstGoneDay = mine.placedDayIndex + mine.deployable.lifetimeDays;
    expect(isHazardActive(mine, lastActiveDay)).toBe(true);
    expect(isHazardActive(mine, firstGoneDay)).toBe(false);
    expect(isHazardActive(mine, 5)).toBe(true);
    expect(isHazardActive(mine, 6)).toBe(false);
    expect(stripExpiredHazards([mine], 5)).toHaveLength(1);
    expect(stripExpiredHazards([mine], 6)).toHaveLength(0);

    const spikes = placeRoadHazard('s1', 'spikedropper', { x: 0, y: 0 }, 5);
    expect(getWeapon('spikedropper').deployable?.kind).toBe('SPIKES');
    expect(isHazardActive(spikes, 5)).toBe(true);
    expect(isHazardActive(spikes, 6)).toBe(false);
  });

  it('refuses to place a road hazard from a non mine/spikes weapon', () => {
    expect(() => placeRoadHazard('bad', 'smokescreen', { x: 0, y: 0 }, 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Road wrecks are structurally real economy.ts Wrecks (defect: RoadWreck
// used to duplicate a shape that couldn't be passed to salvageRoll at all).
// ---------------------------------------------------------------------------

describe('road: a road wreck can actually be salvaged', () => {
  it('salvageRoll accepts a RoadWreck directly, and its searched flag blocks a reroll', () => {
    const rng = createRng('salvage-road-wreck-seed');
    const vehicle = makeVehicle();
    const wreck = createWreck('rw1', { x: 0, y: 0 }, 5, false);

    const first = salvageRoll({ skill: 99, vehicle }, wreck, rng);
    expect(first.ok).toBe(true);
    const searchedWreck = first.ok ? first.wreck : wreck;
    expect(searchedWreck.searched).toBe(true);

    const reroll = salvageRoll({ skill: 99, vehicle }, searchedWreck, rng);
    expect(reroll).toEqual({ ok: false, reason: 'alreadySearched' });
  });

  it('a burned road wreck always yields nothing, and is still marked searched', () => {
    const rng = createRng('salvage-burned-wreck-seed');
    const vehicle = makeVehicle();
    const wreck = createWreck('rw2', { x: 0, y: 0 }, 5, true);
    const result = salvageRoll({ skill: 99, vehicle }, wreck, rng);
    expect(result).toEqual({ ok: true, success: false, wreck: { ...wreck, searched: true } });
  });
});

// ---------------------------------------------------------------------------
// updateContactFlight (fleesAtDamageFraction) is wired into stepRoadTrip's
// real per-tick pipeline via an explicit contactDamage map, instead of
// sitting exported, uncalled, and untested.
// ---------------------------------------------------------------------------

describe('road: contacts flee once combat damage crosses their own fleesAtDamageFraction', () => {
  it('stepRoadTrip moves a contact to fleeing when its supplied damage fraction reaches its faction threshold', () => {
    const rng = createRng('flight-wiring-seed');
    let state = beginRoadTrip(TEST_RESOLVED, makeVehicle(), initialClock(), rng);

    // A hand-placed contact so this test does not depend on what
    // generateRouteContacts happened to roll. routeMiles is far beyond the
    // tiny TEST_ROUTE so updateContactForProgress's break-off logic (a
    // separate mechanic) never touches it during this test.
    const outlawFleeFraction = getFaction('outlaw').fleesAtDamageFraction;
    const contact: RoadContact = { id: 'flee-check', faction: 'outlaw', packId: null, routeMiles: 1000, attacked: false, disposition: 'hostile' };
    state = { ...state, contacts: [contact] };

    const belowThreshold = new Map([[contact.id, outlawFleeFraction - 0.01]]);
    const stillFighting = stepRoadTrip(state, FULL_THROTTLE, DT, rng, 50, 'normal', belowThreshold);
    const notYetFleeing = stillFighting.state.contacts.find((c) => c.id === contact.id);
    if (notYetFleeing === undefined) throw new Error('contact missing after step');
    expect(notYetFleeing.disposition).toBe('hostile');

    const atThreshold = new Map([[contact.id, outlawFleeFraction]]);
    const result = stepRoadTrip(state, FULL_THROTTLE, DT, rng, 50, 'normal', atThreshold);
    const fled = result.state.contacts.find((c) => c.id === contact.id);
    if (fled === undefined) throw new Error('contact missing after step');
    expect(fled.disposition).toBe('fleeing');
    expect(willFire(fled)).toBe(false);
  });

  it('omitting contactDamage (the default) changes nothing, so every existing caller keeps working unmodified', () => {
    const rng = createRng('flight-wiring-default-seed');
    const state = beginRoadTrip(TEST_RESOLVED, makeVehicle(), initialClock(), rng);
    const result = stepRoadTrip(state, FULL_THROTTLE, DT, rng, 50, 'normal');
    expect(result.state.contacts.some((c) => c.disposition === 'fleeing')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Abandoning the car
// ---------------------------------------------------------------------------

describe('road: abandoning the car', () => {
  it('leaves the car on the route and puts the player on foot at the same spot', () => {
    const vehicle = makeVehicle({ position: { x: 5, y: 2 }, headingRad: 1.2 });
    const state = beginRoadTrip(TEST_RESOLVED, vehicle, initialClock(), createRng('abandon-seed'));
    const result = abandonVehicle(state, 'ped-1');

    expect(result.strandedVehicle).toBe(vehicle);
    expect(result.pedestrian.position).toEqual(vehicle.position);
    expect(result.pedestrian.headingRad).toBe(vehicle.headingRad);
    expect(result.pedestrian.alive).toBe(true);
  });
});
