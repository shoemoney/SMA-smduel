import { describe, expect, it, vi } from 'vitest';

import { citiesConfig, drivingConfig, economy } from '@/data/rulesets';
import { UnknownRulesetIdError } from '@/data/rulesets';
import { advanceDays, closeOutDay, formatDate, initialClock, type Clock } from '@/sim/calendar';
import {
  CITY_DIRECTIONS,
  alwaysOpenFacilityIn,
  checkCityTrigger,
  createCityPlayerState,
  generateCityLayout,
  isVehicleInRange,
  nextFacilityOpenDayIndex,
  requireAt,
  stepWalk,
  toggleVehicle,
  type CityDirection,
  type CityLayout,
  type CityPlayerState,
  type CityTrigger,
} from '@/sim/city';
import type { Vec2 } from '@/sim/types';
import { buildCityInstances, describeFacilityAccess, type CityViewSnapshot } from '@/ui/city-view';
import { loadAtlasIndex } from '@/render/atlas';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAVE_SEED_A = 'save-seed-alpha';
const SAVE_SEED_B = 'save-seed-bravo';
const NEWYORK = 'newyork'; // 10 facilities — plenty of ring slots to make a shuffle collision astronomically unlikely
const PROVIDENCE = 'providence'; // 1 facility — the ring-size edge case

/** A minimal, self-contained atlas manifest covering every frame name `@/ui/city-view` can ask for — never the live `assets/atlas.json`, which a concurrent workflow owns and may edit mid-run. */
function fixtureAtlasIndex() {
  const frame = (kind: string) => ({
    atlas: 0,
    x: 0,
    y: 0,
    w: 8,
    h: 8,
    trimX: 0,
    trimY: 0,
    srcW: 8,
    srcH: 8,
    kind,
    rotationOffsetDeg: 0,
  });
  return loadAtlasIndex({
    atlases: [{ file: 'fixture.png', width: 64, height: 64 }],
    frames: {
      'tile-asphalt-clean': frame('tile'),
      'tile-roof-residential': frame('tile'),
      'tile-roof-commercial': frame('tile'),
      'tile-roof-industrial': frame('tile'),
      'prop-city-gate': frame('prop'),
      'cycle-topdown': frame('cycle'),
      'car-midsized': frame('car'),
    },
  });
}

function clockAt(dayIndex: number, phase: 'DAY' | 'NIGHT'): Clock {
  const day = advanceDays(initialClock(), dayIndex);
  return phase === 'NIGHT' ? closeOutDay(day) : day;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// requireAt
// ---------------------------------------------------------------------------

describe('requireAt: bounds-checked array read', () => {
  it('returns the element at a valid index', () => {
    expect(requireAt(['a', 'b', 'c'], 1)).toBe('b');
  });

  it('throws RangeError for an out-of-bounds index instead of returning undefined', () => {
    expect(() => requireAt(['a'], 5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// generateCityLayout: determinism, seed variance, facility coverage
// ---------------------------------------------------------------------------

describe('generateCityLayout(cityId, saveSeed)', () => {
  it('throws UnknownRulesetIdError for a city id cities.json does not define', () => {
    expect(() => generateCityLayout('nonexistent-city', SAVE_SEED_A)).toThrow(UnknownRulesetIdError);
  });

  it('is bit-for-bit deterministic: same (cityId, saveSeed) -> identical layout, every time', () => {
    const first = generateCityLayout(NEWYORK, SAVE_SEED_A);
    const second = generateCityLayout(NEWYORK, SAVE_SEED_A);
    expect(second).toEqual(first);
    // Not just structurally equal - literally the same call, three times, for good measure.
    expect(generateCityLayout(NEWYORK, SAVE_SEED_A)).toEqual(first);
  });

  it('differs across seeds for the same city', () => {
    const a = generateCityLayout(NEWYORK, SAVE_SEED_A);
    const b = generateCityLayout(NEWYORK, SAVE_SEED_B);
    expect(b).not.toEqual(a);
  });

  it('differs across cities for the same seed', () => {
    const ny = generateCityLayout(NEWYORK, SAVE_SEED_A);
    const boston = generateCityLayout('boston', SAVE_SEED_A);
    expect(boston.doorways).not.toEqual(ny.doorways);
  });

  it('every city gets exactly one doorway per cities.json facility, in that city\'s own facility order, plus a gate', () => {
    for (const city of citiesConfig().cities) {
      const layout = generateCityLayout(city.id, SAVE_SEED_A);
      expect(layout.doorways).toHaveLength(city.facilities.length);
      expect(layout.doorways.map((d) => d.facilityKind)).toEqual(city.facilities);
      expect(layout.gate).toBeDefined();
    }
  });

  it('places every doorway and the gate at least driving.json\'s minimum entry-circle spacing (2x interactionRadiusM) apart, for every city - not just "not exactly on top of each other"', () => {
    const interactionRadiusM = drivingConfig().pedestrian.interactionRadiusM;
    const minSpacingM = interactionRadiusM * 2;
    for (const city of citiesConfig().cities) {
      const layout = generateCityLayout(city.id, SAVE_SEED_A);
      const points: Vec2[] = [...layout.doorways.map((d) => d.position), layout.gate.position];
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const a = requireAt(points, i);
          const b = requireAt(points, j);
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          // >= minSpacingM (with float slack), not just > 0: two entry
          // circles (each interactionRadiusM wide) must never overlap, or
          // checkCityTrigger's first-match-wins loop could open the wrong
          // building. A `radiusM = minSpacingM` regression (dropping the
          // chord-length formula) shrinks newyork's adjacent spacing to
          // ~3.385m against a required 6m, which this catches.
          expect(distance).toBeGreaterThanOrEqual(minSpacingM - 1e-9);
        }
      }
    }
  });

  it('handles the single-facility ring (providence) without collapsing the gate onto the facility, leaving real walkable ground at the plaza centre', () => {
    const interactionRadiusM = drivingConfig().pedestrian.interactionRadiusM;
    const minSpacingM = interactionRadiusM * 2;
    const layout = generateCityLayout(PROVIDENCE, SAVE_SEED_A);
    expect(layout.doorways).toHaveLength(1);
    const only = requireAt(layout.doorways, 0);
    const distance = Math.hypot(only.position.x - layout.gate.position.x, only.position.y - layout.gate.position.y);
    expect(distance).toBeGreaterThanOrEqual(minSpacingM - 1e-9);
    // The plaza centre itself must sit at least one full interactionRadiusM
    // of open ground outside every trigger circle - not merely off the
    // exact boundary. distance(centre, point) === boundsRadiusM for every
    // point on the ring, so this is the same "walkable clearance" claim
    // stated directly in terms of the ring radius.
    expect(layout.boundsRadiusM - interactionRadiusM).toBeGreaterThanOrEqual(interactionRadiusM - 1e-9);
  });

  it('end-to-end: a player standing at the plaza centre of a single-facility city can take a real first step, in any direction, without immediately triggering the gate or the facility', () => {
    // Integration-level sanity check of the fixed system's actual runtime
    // behaviour (real generateCityLayout + real stepWalk together). This is
    // the concrete symptom the reviewer reproduced against the old,
    // unfloored radius formula. It is NOT, on its own, a mutation-proof
    // regression test for the radius floor specifically: providence's
    // exact-boundary geometry (slotCount 2, so the unfloored radius equals
    // interactionRadiusM exactly) means the edge-triggered latch
    // (checkCityTrigger's `wasOutside`) independently blocks the trigger
    // here too, since the plaza centre sits exactly ON the boundary, not
    // strictly outside it. The radius-floor fix itself is proven by the
    // walkable-clearance assertion two tests above, which fails cleanly
    // under a `radiusM = chordRadiusM` mutation; this test documents the
    // combined, user-visible outcome of both fixes together.
    const layout = generateCityLayout(PROVIDENCE, SAVE_SEED_A);
    const player = createCityPlayerState({ x: 0, y: 0 });
    for (const direction of CITY_DIRECTIONS as readonly CityDirection[]) {
      const result = stepWalk({ player, layout, direction, dtSeconds: 1 / 60, clock: initialClock() });
      expect(result.trigger).toEqual({ kind: 'none' });
    }
  });

  it('tileSizeM and boundsRadiusM are sourced from driving.json\'s pedestrian.interactionRadiusM, not an invented literal', async () => {
    vi.resetModules();
    const MOCK_RADIUS = 12.5;
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        drivingConfig: () => ({
          ...actual.drivingConfig(),
          pedestrian: { ...actual.drivingConfig().pedestrian, interactionRadiusM: MOCK_RADIUS },
        }),
      };
    });
    const fresh = await import('@/sim/city');
    const layout = fresh.generateCityLayout(NEWYORK, SAVE_SEED_A);
    expect(layout.tileSizeM).toBe(MOCK_RADIUS);
    // boundsRadiusM must move with it too (it's derived from the same value), proving it isn't a second, independently-hardcoded number.
    const real = generateCityLayout(NEWYORK, SAVE_SEED_A);
    expect(layout.boundsRadiusM).not.toBe(real.boundsRadiusM);
    // And it must move via the ACTUAL chord-length formula, not just via
    // the `radiusM = minSpacingM` floor: newyork has 11 ring slots, so
    // under the real (unmocked) chord formula the adjacent spacing comes
    // out to exactly `2 * interactionRadiusM` by construction - reproduce
    // that same check against the mocked radius to prove the sin-based
    // formula (not just the floor) is still driving the result.
    const points: Vec2[] = [...layout.doorways.map((d) => d.position), layout.gate.position];
    let minPairwiseDistance = Infinity;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = requireAt(points, i);
        const b = requireAt(points, j);
        minPairwiseDistance = Math.min(minPairwiseDistance, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(minPairwiseDistance).toBeCloseTo(MOCK_RADIUS * 2, 6);
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// alwaysOpenFacilityIn / nextFacilityOpenDayIndex
// ---------------------------------------------------------------------------

describe('alwaysOpenFacilityIn(cityId)', () => {
  it('returns a real economy.json alwaysOpenFacilities member that the city actually lists', () => {
    for (const city of citiesConfig().cities) {
      const alternative = alwaysOpenFacilityIn(city.id);
      if (alternative !== null) {
        expect(economy().alwaysOpenFacilities).toContain(alternative);
        expect(city.facilities).toContain(alternative);
      }
    }
  });

  it('is sourced from economy.json\'s alwaysOpenFacilities at call time, not a hardcoded set', async () => {
    vi.resetModules();
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        economy: () => ({ ...actual.economy(), alwaysOpenFacilities: ['garage'] }),
      };
    });
    const fresh = await import('@/sim/city');
    // newyork lists 'garage' - now the only "always open" kind per the mock.
    expect(fresh.alwaysOpenFacilityIn('newyork')).toBe('garage');
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });

  it('returns null when the city lists none of economy.json\'s alwaysOpenFacilities - the null contract, not just the non-null one', async () => {
    // Every real cities.json city happens to list 'truckstop', so the null
    // branch is unreachable with the live ruleset; mock alwaysOpenFacilities
    // down to a kind newyork does NOT list to force it.
    vi.resetModules();
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        economy: () => ({ ...actual.economy(), alwaysOpenFacilities: ['casino'] }),
      };
    });
    const fresh = await import('@/sim/city');
    // newyork's facilities (per cities.json) do not include 'casino'.
    expect(fresh.alwaysOpenFacilityIn('newyork')).toBeNull();
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });
});

describe('nextFacilityOpenDayIndex(clock)', () => {
  it('returns today when already DAY', () => {
    expect(nextFacilityOpenDayIndex(clockAt(5, 'DAY'))).toBe(5);
  });

  it('returns tomorrow when currently NIGHT', () => {
    expect(nextFacilityOpenDayIndex(clockAt(5, 'NIGHT'))).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// stepWalk: eight-direction movement, zero time cost, trigger detection
// ---------------------------------------------------------------------------

describe('stepWalk', () => {
  it('CITY_DIRECTIONS lists exactly the eight compass directions, each mapped to its correct compass unit vector', () => {
    expect(CITY_DIRECTIONS).toHaveLength(8);
    expect(new Set(CITY_DIRECTIONS).size).toBe(8);

    // Independently-derived expected unit vector per direction (compass
    // geometry, not read from src/sim/city's own DIRECTION_UNIT_VECTORS):
    // +x is East, +y is South (screen-space "down"), matching stepWalk's
    // own behaviour under 'E' (x increases) elsewhere in this file.
    const SQRT1_2 = Math.SQRT1_2;
    const EXPECTED_UNIT_VECTOR: Readonly<Record<CityDirection, Vec2>> = {
      N: { x: 0, y: -1 },
      NE: { x: SQRT1_2, y: -SQRT1_2 },
      E: { x: 1, y: 0 },
      SE: { x: SQRT1_2, y: SQRT1_2 },
      S: { x: 0, y: 1 },
      SW: { x: -SQRT1_2, y: SQRT1_2 },
      W: { x: -1, y: 0 },
      NW: { x: -SQRT1_2, y: -SQRT1_2 },
    };

    const layout = generateCityLayout(PROVIDENCE, SAVE_SEED_A);
    for (const direction of CITY_DIRECTIONS as readonly CityDirection[]) {
      const player = createCityPlayerState({ x: 0, y: 0 });
      const result = stepWalk({ player, layout, direction, dtSeconds: 1, clock: initialClock() });
      const traveled = Math.hypot(result.player.position.x, result.player.position.y);
      // Normalize the observed step by its own magnitude, so this
      // comparison is decoupled from driving.json's actual speedMps value
      // (speed sourcing is covered separately) and purely checks direction.
      const observedUnit: Vec2 = { x: result.player.position.x / traveled, y: result.player.position.y / traveled };
      const expected = EXPECTED_UNIT_VECTOR[direction];
      expect(observedUnit.x).toBeCloseTo(expected.x, 10);
      expect(observedUnit.y).toBeCloseTo(expected.y, 10);
    }
  });

  it('null direction leaves position, heading, and the clock untouched, with no trigger', () => {
    const player = createCityPlayerState({ x: 3, y: 4 });
    const layout = generateCityLayout(NEWYORK, SAVE_SEED_A);
    const clock = clockAt(2, 'DAY');
    const result = stepWalk({ player, layout, direction: null, dtSeconds: 1, clock });
    expect(result.player).toEqual(player);
    expect(result.clock).toEqual(clock);
    expect(result.trigger).toEqual({ kind: 'none' });
  });

  it('moves at driving.json\'s pedestrian.speedMps (currently 2.2 m/s - an independently-derived literal, not read from drivingConfig() here) along the requested direction', () => {
    const player = createCityPlayerState({ x: 0, y: 0 });
    const layout = generateCityLayout(PROVIDENCE, SAVE_SEED_A);
    const dt = 2;
    const result = stepWalk({ player, layout, direction: 'E', dtSeconds: dt, clock: initialClock() });
    const KNOWN_SPEED_MPS = 2.2; // driving.json's pedestrian.speedMps, copied here so this test does not compare the implementation to its own source (see the dedicated mock test below for sourcing proof)
    expect(result.player.position.x).toBeCloseTo(KNOWN_SPEED_MPS * dt, 10);
    expect(result.player.position.y).toBeCloseTo(0, 10);
  });

  it("drives at driving.json's city.vehicleSpeedMps while riding, faster than the same driver on foot", () => {
    const onFoot = createCityPlayerState({ x: 0, y: 0 });
    const riding: CityPlayerState = { ...onFoot, inVehicle: true };
    const layout = generateCityLayout(PROVIDENCE, SAVE_SEED_A);
    // Half a second, not a full one: providence's plaza is the smallest a real
    // layout produces (boundsRadiusM ~6m), and a full second at the driving
    // speed would land outside it, so `clampToCityWalls` would answer 6.0 and
    // this test would be measuring the wall rather than the speed.
    const dt = 0.5;
    const KNOWN_CITY_DRIVE_SPEED_MPS = 6.6; // driving.json's city.vehicleSpeedMps, copied here so this test does not compare the implementation to its own source (see the dedicated mock test below for sourcing proof)

    const driven = stepWalk({ player: riding, layout, direction: 'E', dtSeconds: dt, clock: initialClock() });
    expect(driven.player.position.x).toBeCloseTo(KNOWN_CITY_DRIVE_SPEED_MPS * dt, 10);
    expect(driven.player.position.y).toBeCloseTo(0, 10);

    // The point of getting in the car: it is not the same as walking. Pressing
    // 'G' used to park the driver permanently instead, which made the control
    // a trap with no purpose.
    const walked = stepWalk({ player: onFoot, layout, direction: 'E', dtSeconds: dt, clock: initialClock() });
    expect(driven.player.position.x).toBeGreaterThan(walked.player.position.x);
  });

  it('a car standing still is still standing still — no direction held moves nothing, riding or not', () => {
    const riding: CityPlayerState = { ...createCityPlayerState({ x: 1, y: 1 }), inVehicle: true };
    const layout = generateCityLayout(PROVIDENCE, SAVE_SEED_A);
    const result = stepWalk({ player: riding, layout, direction: null, dtSeconds: 5, clock: initialClock() });
    expect(result.player.position).toEqual({ x: 1, y: 1 });
    expect(result.trigger).toEqual({ kind: 'none' });
  });

  it('driving triggers a doorway the same way walking does — the car is not a trigger-proof bubble', () => {
    const layout = generateCityLayout(PROVIDENCE, SAVE_SEED_A);
    const doorway = layout.doorways[0];
    if (doorway === undefined) throw new Error('test fixture: every city lists at least one facility');
    const interactionRadiusM = drivingConfig().pedestrian.interactionRadiusM;

    // Start well outside the doorway's radius, on the far side of it from the
    // plaza centre, driving straight in.
    const start = { x: doorway.position.x + interactionRadiusM * 3, y: doorway.position.y };
    const riding: CityPlayerState = { ...createCityPlayerState(start), inVehicle: true };
    const result = stepWalk({ player: riding, layout, direction: 'W', dtSeconds: 1, clock: initialClock() });

    expect(result.trigger).toEqual({ kind: 'facility', facilityKind: doorway.facilityKind });
  });

  it('walking advances no day (economy.json timeCostDays.walkInCity is 0), across many steps and even across a NIGHT clock', () => {
    const layout = generateCityLayout(NEWYORK, SAVE_SEED_A);
    // -500,-500 starts far outside the city wall - stepWalk's own wall
    // clamp pulls it back onto the plaza ring on the very first step, but
    // that (and any trigger it produces along the way) is irrelevant here:
    // advanceForTimeCost runs unconditionally every tick regardless of
    // position or trigger, which is the only thing this test asserts on.
    let player = createCityPlayerState({ x: -500, y: -500 });
    let clock = clockAt(9, 'NIGHT');
    for (let i = 0; i < 50; i++) {
      const result = stepWalk({ player, layout, direction: 'E', dtSeconds: 1, clock });
      player = result.player;
      clock = result.clock;
    }
    expect(clock).toEqual(clockAt(9, 'NIGHT'));
  });

  it('the walk-in-city time cost is read from economy.json at call time, not hardcoded to 0', async () => {
    vi.resetModules();
    const MOCK_WALK_DAYS = 2;
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        economy: () => ({
          ...actual.economy(),
          timeCostDays: { ...actual.economy().timeCostDays, walkInCity: MOCK_WALK_DAYS },
        }),
      };
    });
    const fresh = await import('@/sim/city');
    const layout = fresh.generateCityLayout(PROVIDENCE, SAVE_SEED_A);
    const player = fresh.createCityPlayerState({ x: 0, y: 0 });
    const result = fresh.stepWalk({ player, layout, direction: 'N', dtSeconds: 1, clock: clockAt(0, 'DAY') });
    // advanceForTimeCost(days=2) = closeOutDay(advanceDays(clock, 1)) = day 1, NIGHT - never 0 days passing, as the real (0-cost) ruleset would leave it.
    expect(result.clock).toEqual(clockAt(1, 'NIGHT'));
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });

  it('pedestrian walking speed is read from driving.json at call time, not hardcoded', async () => {
    vi.resetModules();
    // Small enough that, even mocked, the step stays well inside
    // providence's city wall (boundsRadiusM, itself derived from the SAME
    // mocked interactionRadiusM... except here only speedMps is mocked, so
    // boundsRadiusM stays at the real ~6m) - otherwise stepWalk's own wall
    // clamp (a separate, correct behaviour) would cap the observed
    // distance and this test would be measuring the wall, not the speed.
    const MOCK_SPEED_MPS = 4;
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        drivingConfig: () => ({
          ...actual.drivingConfig(),
          pedestrian: { ...actual.drivingConfig().pedestrian, speedMps: MOCK_SPEED_MPS },
        }),
      };
    });
    const fresh = await import('@/sim/city');
    const layout = fresh.generateCityLayout(PROVIDENCE, SAVE_SEED_A);
    const player = fresh.createCityPlayerState({ x: 0, y: 0 });
    const result = fresh.stepWalk({ player, layout, direction: 'E', dtSeconds: 1, clock: initialClock() });
    expect(result.player.position.x).toBeCloseTo(MOCK_SPEED_MPS, 10);
    expect(result.player.position.x).not.toBeCloseTo(drivingConfig().pedestrian.speedMps, 5);
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });

  it("city driving speed is read from driving.json's city block at call time, not hardcoded and not the pedestrian value", async () => {
    vi.resetModules();
    // Same reasoning as the walking mock above: small enough that even with
    // the mock in place the step stays inside providence's real ~6m wall, so
    // the assertion measures the speed rather than `clampToCityWalls`.
    const MOCK_CITY_DRIVE_SPEED_MPS = 5;
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        drivingConfig: () => ({
          ...actual.drivingConfig(),
          city: { ...actual.drivingConfig().city, vehicleSpeedMps: MOCK_CITY_DRIVE_SPEED_MPS },
        }),
      };
    });
    const fresh = await import('@/sim/city');
    const layout = fresh.generateCityLayout(PROVIDENCE, SAVE_SEED_A);
    const riding: CityPlayerState = { ...fresh.createCityPlayerState({ x: 0, y: 0 }), inVehicle: true };
    const result = fresh.stepWalk({ player: riding, layout, direction: 'E', dtSeconds: 1, clock: initialClock() });

    expect(result.player.position.x).toBeCloseTo(MOCK_CITY_DRIVE_SPEED_MPS, 10);
    expect(result.player.position.x).not.toBeCloseTo(drivingConfig().city.vehicleSpeedMps, 5);
    // The mock left `pedestrian.speedMps` real, so a driving step that fell
    // back to the walking value would land on it instead.
    expect(result.player.position.x).not.toBeCloseTo(drivingConfig().pedestrian.speedMps, 5);
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // Wall clamp (defect fix): the player can never walk past boundsRadiusM
  // -------------------------------------------------------------------------

  it('clamps movement at the city wall (boundsRadiusM) instead of letting the player walk off the rendered ground', () => {
    const layout = generateCityLayout(NEWYORK, SAVE_SEED_A);
    let player = createCityPlayerState({ x: 0, y: 0 });
    const clock = initialClock();
    for (let i = 0; i < 10_000; i++) {
      const result = stepWalk({ player, layout, direction: 'N', dtSeconds: 1, clock });
      player = result.player;
    }
    const distanceFromCentre = Math.hypot(player.position.x, player.position.y);
    // Without the clamp this walks ~22km north (10_000 * 2.2 m/s * 1s) from
    // a plaza whose whole radius is ~10.6m.
    expect(distanceFromCentre).toBeLessThanOrEqual(layout.boundsRadiusM + 1e-6);
    expect(distanceFromCentre).toBeGreaterThan(layout.boundsRadiusM - 1e-6);
  });

  it('the wall clamp still lets the player walk the full interior of the plaza - it only stops outward motion at the boundary', () => {
    const layout = generateCityLayout(NEWYORK, SAVE_SEED_A);
    const player = createCityPlayerState({ x: 0, y: 0 });
    // A single small step from the centre must land at its full, unclamped
    // distance - proving the clamp doesn't shrink ordinary movement, only
    // movement that would cross the wall.
    const result = stepWalk({ player, layout, direction: 'E', dtSeconds: 0.1, clock: initialClock() });
    const speedMps = drivingConfig().pedestrian.speedMps;
    expect(result.player.position.x).toBeCloseTo(speedMps * 0.1, 10);
  });
});

// ---------------------------------------------------------------------------
// checkCityTrigger: doorway/gate overlap + moving-inward
// ---------------------------------------------------------------------------

describe('checkCityTrigger', () => {
  const interactionRadiusM = drivingConfig().pedestrian.interactionRadiusM;

  function tinyLayout(): CityLayout {
    return {
      cityId: 'test-city',
      doorways: [{ facilityKind: 'garage', position: { x: 100, y: 0 } }],
      gate: { position: { x: -100, y: 0 } },
      boundsRadiusM: 100,
      tileSizeM: interactionRadiusM,
    };
  }

  it('fires for a doorway when the step both overlaps it and moves toward it', () => {
    const layout = tinyLayout();
    const edge = 100 - interactionRadiusM - 1;
    const prev: Vec2 = { x: edge, y: 0 };
    const next: Vec2 = { x: 100, y: 0 }; // lands exactly on the doorway, moving in +x toward it
    expect(checkCityTrigger(layout, prev, next)).toEqual({ kind: 'facility', facilityKind: 'garage' });
  });

  it('does not fire when overlapping the doorway but moving AWAY from it', () => {
    const layout = tinyLayout();
    const prev: Vec2 = { x: 100 - 0.1, y: 0 }; // just inside the doorway's radius
    const next: Vec2 = { x: 100 - interactionRadiusM / 2, y: 0 }; // steps back out, away from it, still within range
    expect(checkCityTrigger(layout, prev, next)).toEqual({ kind: 'none' });
  });

  it('does not fire when moving toward the doorway but staying out of range', () => {
    const layout = tinyLayout();
    const prev: Vec2 = { x: 0, y: 0 };
    const next: Vec2 = { x: 1, y: 0 }; // toward the doorway, nowhere close to it yet
    expect(checkCityTrigger(layout, prev, next)).toEqual({ kind: 'none' });
  });

  it('fires for the gate under the same overlap+inward rule', () => {
    const layout = tinyLayout();
    const prev: Vec2 = { x: -100 + interactionRadiusM + 1, y: 0 };
    const next: Vec2 = { x: -100, y: 0 };
    expect(checkCityTrigger(layout, prev, next)).toEqual({ kind: 'gate' });
  });

  it('standing still never triggers, even sitting exactly on a doorway', () => {
    const layout = tinyLayout();
    const here: Vec2 = { x: 100, y: 0 };
    expect(checkCityTrigger(layout, here, here)).toEqual({ kind: 'none' });
  });

  // Note on the dot-product sign (movingToward's `> 0`): once entry is
  // edge-triggered (see the re-entry tests below - `wasOutside` must hold
  // for the PREVIOUS position), any step satisfying `wasOutside && nextInside`
  // is provably moving toward the target (distance strictly decreases past
  // the boundary), so `movingToward` can no longer independently flip a
  // 'none' to a trigger for a real entry - `wasOutside` alone already
  // decides it. It stays as defense-in-depth. The moving-away test above is
  // gated the same way (prev is already inside), so both are now
  // over-determined by design rather than each isolating one condition.

  // -------------------------------------------------------------------------
  // Edge-triggered entry: fires once on the crossing tick, not on every
  // tick spent standing inside the radius (defect fix)
  // -------------------------------------------------------------------------

  it('fires exactly once when several consecutive steps close in on a doorway and then continue past it while still moving toward it - not once per tick spent inside the radius', () => {
    const layout = tinyLayout(); // doorway at (100, 0), interactionRadiusM = 3
    const start = 100 - interactionRadiusM - 2; // clearly outside (distance = radius + 2)
    const stepSize = 0.5;
    const stepCount = 9; // start .. start + 4.5, well past the doorway itself
    let prev: Vec2 = { x: start, y: 0 };
    const kinds: CityTrigger['kind'][] = [];
    for (let i = 0; i < stepCount; i++) {
      const next: Vec2 = { x: prev.x + stepSize, y: 0 };
      kinds.push(checkCityTrigger(layout, prev, next).kind);
      prev = next;
    }
    const facilityFireCount = kinds.filter((k) => k === 'facility').length;
    expect(facilityFireCount).toBe(1);
  });

  it('re-fires after the player leaves the radius and re-enters it - the edge latch resets on exit, it is not a one-time-ever flag', () => {
    const layout = tinyLayout(); // doorway at (100, 0), interactionRadiusM = 3
    // Walk in from outside, past the doorway and back out the far side,
    // then walk back in the way it came - two full entries.
    const path: Vec2[] = [
      { x: 96, y: 0 }, // outside (distance 4)
      { x: 98, y: 0 }, // inside (distance 2) - first entry, moving +x
      { x: 100, y: 0 }, // still inside, on the doorway
      { x: 104, y: 0 }, // outside again (distance 4), moving +x
      { x: 102, y: 0 }, // inside again (distance 2) - second entry, now moving -x
    ];
    const kinds: CityTrigger['kind'][] = [];
    for (let i = 1; i < path.length; i++) {
      const prev = requireAt(path, i - 1);
      const next = requireAt(path, i);
      kinds.push(checkCityTrigger(layout, prev, next).kind);
    }
    expect(kinds).toEqual(['facility', 'none', 'none', 'facility']);
  });

  it('the trigger radius is read from driving.json\'s pedestrian.interactionRadiusM, not hardcoded', async () => {
    vi.resetModules();
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        drivingConfig: () => ({
          ...actual.drivingConfig(),
          pedestrian: { ...actual.drivingConfig().pedestrian, interactionRadiusM: 0.001 },
        }),
      };
    });
    const fresh = await import('@/sim/city');
    const layout: CityLayout = {
      cityId: 'test-city',
      doorways: [{ facilityKind: 'garage', position: { x: 100, y: 0 } }],
      gate: { position: { x: -100, y: 0 } },
      boundsRadiusM: 100,
      tileSizeM: 1,
    };
    // Lands comfortably within the REAL interactionRadiusM (2.5m short of
    // the doorway, moving toward it) - see the first test above for proof
    // that distance alone triggers at the real radius. Once the mock
    // shrinks the radius to 0.001, that same step must NOT trigger.
    const prev: Vec2 = { x: 0, y: 0 };
    const next: Vec2 = { x: 100 - (interactionRadiusM - 0.5), y: 0 };
    expect(fresh.checkCityTrigger(layout, prev, next)).toEqual({ kind: 'none' });
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// Vehicle enter/exit ('G' in range)
// ---------------------------------------------------------------------------

describe('isVehicleInRange / toggleVehicle', () => {
  const interactionRadiusM = drivingConfig().pedestrian.interactionRadiusM;

  it('is in range at and under the interaction radius, out of range beyond it', () => {
    expect(isVehicleInRange({ x: 0, y: 0 }, { x: interactionRadiusM, y: 0 })).toBe(true);
    expect(isVehicleInRange({ x: 0, y: 0 }, { x: interactionRadiusM + 1, y: 0 })).toBe(false);
  });

  it('refuses to enter a vehicle out of range', () => {
    const player = createCityPlayerState({ x: 0, y: 0 });
    const result = toggleVehicle(player, { x: interactionRadiusM + 5, y: 0 });
    expect(result).toEqual({ ok: false, reason: 'outOfRange' });
  });

  it('enters a vehicle in range', () => {
    const player = createCityPlayerState({ x: 0, y: 0 });
    const result = toggleVehicle(player, { x: interactionRadiusM / 2, y: 0 });
    expect(result.ok).toBe(true);
    expect(result.ok && result.player.inVehicle).toBe(true);
  });

  it('always allows exiting, regardless of distance to the vehicle', () => {
    const player: CityPlayerState = { ...createCityPlayerState({ x: 0, y: 0 }), inVehicle: true };
    const result = toggleVehicle(player, { x: 99_999, y: 0 });
    expect(result).toEqual({ ok: true, player: { ...player, inVehicle: false } });
  });
});

// ---------------------------------------------------------------------------
// describeFacilityAccess: closed facility -> next opening + 24h alternative
// ---------------------------------------------------------------------------

describe('describeFacilityAccess', () => {
  it('reports an always-open facility as open, with no next-opening or alternative', () => {
    const notice = describeFacilityAccess('newyork', 'bar', clockAt(3, 'NIGHT'));
    expect(notice.open).toBe(true);
    expect(notice.nextOpenDate).toBeNull();
    expect(notice.alternativeLabel).toBeNull();
  });

  it('reports a daytime-only facility as open during DAY', () => {
    const notice = describeFacilityAccess('newyork', 'garage', clockAt(3, 'DAY'));
    expect(notice.open).toBe(true);
  });

  it('reports a daytime-only facility closed at NIGHT, with its next opening and a 24-hour alternative', () => {
    const clock = clockAt(3, 'NIGHT');
    const notice = describeFacilityAccess('newyork', 'garage', clock);
    expect(notice.open).toBe(false);
    expect(notice.alternativeLabel).toBe('Bar');
    // Independently derived: NIGHT on dayIndex 3 always reopens on dayIndex 4.
    expect(notice.nextOpenDate).toBe(formatDate(4));
  });

  it('the facility and alternative labels come from facilityName() (rulesets/classic/strings.json), not hardcoded copy', async () => {
    // A hardcoded-copy implementation (e.g. a literal { garage: 'Garage',
    // bar: 'Bar' } lookup) would produce these exact real strings too, so
    // asserting the real strings alone proves nothing about SOURCING. Mock
    // the '@/ui/strings' seam itself with a distinguishable value and
    // assert the notice moves with it - only possible if describeFacilityAccess
    // actually calls through facilityName() at call time.
    vi.resetModules();
    vi.doMock('@/ui/strings', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/ui/strings')>();
      return {
        ...actual,
        facilityName: (kind: string) => `MOCKED[${kind}]`,
      };
    });
    const fresh = await import('@/ui/city-view');
    const notice = fresh.describeFacilityAccess('newyork', 'garage', clockAt(0, 'NIGHT'));
    expect(notice.facilityLabel).toBe('MOCKED[garage]');
    expect(notice.alternativeLabel).toBe('MOCKED[bar]');
    vi.doUnmock('@/ui/strings');
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // City/facility pairing validation (defect fix): a facility kind that IS
  // real but that THIS city doesn't list must throw, not return a
  // confident, fully-formed, wrong notice.
  // -------------------------------------------------------------------------

  it('throws UnknownRulesetIdError for a real facility kind the given city does not list', () => {
    // providence's only facility (per cities.json) is 'truckstop' - it has
    // no casino, arena, garage, etc.
    expect(() => describeFacilityAccess('providence', 'casino', clockAt(3, 'NIGHT'))).toThrow(UnknownRulesetIdError);
    // dover lists weaponshop/salvage/truckstop - it has no arena.
    expect(() => describeFacilityAccess('dover', 'arena', clockAt(0, 'NIGHT'))).toThrow(UnknownRulesetIdError);
  });

  it('does not throw, and reports normally, for a facility kind the city DOES list - the pairing check is not overzealous', () => {
    expect(() => describeFacilityAccess('providence', 'truckstop', clockAt(3, 'NIGHT'))).not.toThrow();
    const notice = describeFacilityAccess('providence', 'truckstop', clockAt(3, 'NIGHT'));
    expect(notice.open).toBe(true); // truckstop is always-open (economy.json)
  });
});

// ---------------------------------------------------------------------------
// buildCityInstances: render-only, never mutates its snapshot
// ---------------------------------------------------------------------------

describe('buildCityInstances', () => {
  function makeSnapshot(): CityViewSnapshot {
    const layout = generateCityLayout('boston', SAVE_SEED_A);
    const player = createCityPlayerState({ x: 0, y: 0 });
    return { layout, player, vehicle: null };
  }

  it('emits one ground tile per grid cell, one building instance per doorway plus the gate, and one actor for the on-foot player', () => {
    const snapshot = makeSnapshot();
    const atlasIndex = fixtureAtlasIndex();
    const instances = buildCityInstances(snapshot, atlasIndex);

    const byLayer = new Map<number, number>();
    for (const inst of instances) {
      byLayer.set(inst.layer, (byLayer.get(inst.layer) ?? 0) + 1);
    }

    const tile = snapshot.layout.tileSizeM;
    const half = snapshot.layout.boundsRadiusM + tile;
    // Closed-form derivation of the grid's per-axis point count - how many
    // multiples of `tile`, starting exactly at -half, land at or before
    // +half - expressed as a formula rather than by re-running
    // buildCityInstances's own `for (v = -half; v <= half; v += tile)`
    // loop, so a bug in THAT loop (wrong bound, wrong step, off-by-one)
    // shows up as a mismatch instead of being silently reproduced.
    const axisCount = Math.floor((2 * half) / tile + 1e-9) + 1;
    const expectedGroundCount = axisCount * axisCount;

    expect(expectedGroundCount).toBeGreaterThan(1); // sanity: the formula itself must describe a real grid, not a degenerate one
    expect(byLayer.get(0)).toBe(expectedGroundCount);
    expect(byLayer.get(1)).toBe(snapshot.layout.doorways.length + 1); // + gate
    expect(byLayer.get(2)).toBe(1); // just the walking player, no vehicle in this snapshot

    // Every ground tile must also fall within [-half, half] on both axes -
    // catches a formula/implementation that agrees on COUNT but not on
    // actual coverage (e.g. tiles shifted off-centre).
    const groundTiles = instances.filter((i) => i.layer === 0);
    for (const t of groundTiles) {
      expect(t.position.x).toBeGreaterThanOrEqual(-half - 1e-9);
      expect(t.position.x).toBeLessThanOrEqual(half + 1e-9);
      expect(t.position.y).toBeGreaterThanOrEqual(-half - 1e-9);
      expect(t.position.y).toBeLessThanOrEqual(half + 1e-9);
    }
  });

  it('renders both a parked vehicle and the on-foot player when the vehicle is present but not occupied', () => {
    const snapshot: CityViewSnapshot = {
      ...makeSnapshot(),
      vehicle: { position: { x: 5, y: 5 }, headingRad: 0, bodyId: 'midsized' },
    };
    const instances = buildCityInstances(snapshot, fixtureAtlasIndex());
    const actorLayer = instances.filter((i) => i.layer === 2);
    expect(actorLayer).toHaveLength(2);
  });

  it('renders only the vehicle (at the player\'s position) when the player is riding it - no separate walking sprite', () => {
    const player: CityPlayerState = { ...createCityPlayerState({ x: 7, y: -3 }), inVehicle: true };
    const snapshot: CityViewSnapshot = {
      layout: generateCityLayout('boston', SAVE_SEED_A),
      player,
      vehicle: { position: { x: 999, y: 999 }, headingRad: 0, bodyId: 'midsized' },
    };
    const instances = buildCityInstances(snapshot, fixtureAtlasIndex());
    const actorLayer = instances.filter((i) => i.layer === 2);
    expect(actorLayer).toHaveLength(1);
    expect(actorLayer[0]?.position).toEqual({ x: 7, y: -3 });
  });

  it('never mutates its snapshot (deep-frozen input survives a call unharmed), and returns real instances derived from it - not an empty or garbage buffer', () => {
    const snapshot = deepFreeze({
      ...makeSnapshot(),
      vehicle: { position: { x: 1, y: 2 }, headingRad: 0.4, bodyId: 'midsized' },
    });
    // A frozen object throws TypeError the moment a mutating write is
    // attempted on it, so capturing its own JSON before/after and diffing
    // is redundant with the freeze itself; what deepFreeze does NOT catch
    // is a function that returns nothing useful, so pin down real output
    // instead of only "did not throw".
    const before = JSON.stringify(snapshot);
    const instances = buildCityInstances(snapshot, fixtureAtlasIndex());
    expect(JSON.stringify(snapshot)).toBe(before);

    expect(instances.length).toBeGreaterThan(0);
    const firstDoorway = requireAt(snapshot.layout.doorways, 0);
    const buildingInstances = instances.filter((i) => i.layer === 1);
    expect(buildingInstances.some((i) => i.position.x === firstDoorway.position.x && i.position.y === firstDoorway.position.y)).toBe(true);
    // The vehicle sprite is the only layer-2 instance sized
    // VEHICLE_SPRITE_SIZE_M (3.2 x 5.2) - distinct from the on-foot
    // player's collider-derived size - so this pins down that a real
    // vehicle instance was actually emitted, not just "something" on layer 2.
    const vehicleSizedInstances = instances.filter((i) => i.layer === 2 && i.sizeM.x === 3.2 && i.sizeM.y === 5.2);
    expect(vehicleSizedInstances).toHaveLength(1);
    expect(vehicleSizedInstances[0]?.position).toEqual({ x: 1, y: 2 });
  });

  it('sizes the on-foot player sprite from driving.json\'s pedestrian.colliderRadiusM, not an invented literal', async () => {
    vi.resetModules();
    const MOCK_RADIUS = 9;
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        drivingConfig: () => ({
          ...actual.drivingConfig(),
          pedestrian: { ...actual.drivingConfig().pedestrian, colliderRadiusM: MOCK_RADIUS },
        }),
      };
    });
    const fresh = await import('@/ui/city-view');
    const snapshot = makeSnapshot();
    const instances = fresh.buildCityInstances(snapshot, fixtureAtlasIndex());
    const player = instances.find((i) => i.layer === 2);
    expect(player?.sizeM).toEqual({ x: MOCK_RADIUS * 2, y: MOCK_RADIUS * 2 });
    vi.doUnmock('@/data/rulesets');
    vi.resetModules();
  });
});
