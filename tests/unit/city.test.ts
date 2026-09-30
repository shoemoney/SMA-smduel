import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { citiesConfig, drivingConfig, economy } from '@/data/rulesets';
import { UnknownRulesetIdError } from '@/data/rulesets';
import { groundQuad } from '@/render/ground';
import {
  FACILITY_FAMILIES,
  cityLayer1InstanceCount,
  facilityMarkerTint,
} from '@/ui/city-view';
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
/**
 * A minimal, self-contained atlas manifest covering every frame name
 * `@/ui/city-view` can ask for — never the live `assets/atlas.json`, which a
 * concurrent workflow owns and may edit mid-run.
 *
 * The frame list is GENERATED from the source rather than hand-listed, because a
 * hand-written list silently rots: the city view gained a wall ring, street
 * lights, barriers, doormarkers and a whole set of authored `building-*`
 * footprints, and the list below was never updated. `buildCityInstances` then
 * threw `unknown atlas frame "prop-citywall"` and five tests failed — not
 * because the city broke, but because the fixture was out of date. A stale
 * fixture reads exactly like a product bug, which is the worst possible failure
 * mode for a test double.
 *
 * So the names are scanned out of the module under test, and a name that is
 * genuinely absent from the atlas still fails loudly (see the assertion at the
 * bottom) rather than being silently invented here.
 */
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
  /**
   * The atlas `kind` for a frame name, derived from its prefix.
   *
   * The scan above now matches ANY `<prefix>-<name>` literal, so this has to
   * know every kind `src/render/atlas.ts`'s ASSET_KINDS declares — otherwise a
   * `decal-` frame silently lands in the 'tile' bucket and the fixture stops
   * representing the real manifest.
   */
  const kindOf = (name: string): string => {
    const prefix = name.slice(0, name.indexOf('-'));
    return (['tile', 'building', 'prop', 'car', 'wreck', 'cycle', 'fx', 'decal', 'ui'] as const).includes(
      prefix as never,
    )
      ? prefix
      : 'tile';
  };
  const sources = ['../../src/ui/city-view.ts', '../../src/render/ground.ts']
    .map((rel) => readFileSync(new URL(rel, import.meta.url), 'utf8'))
    .join('\n');
  const frames: Record<string, ReturnType<typeof frame>> = {};
  for (const match of sources.matchAll(/'([a-z]+-[a-z0-9-]+)'/g)) {
    const name = match[1]!;
    frames[name] = frame(kindOf(name));
  }
  // Vehicle sprites are requested through a template literal —
  // `car-${vehicle.design.bodyId}` — so a regex over the source cannot see
  // them. They are derived from the ruleset's own body list instead, which is
  // the same source of truth the runtime resolves them through.
  const bodies = JSON.parse(readFileSync(new URL('../../rulesets/classic/bodies.json', import.meta.url), 'utf8')) as {
    bodies?: { id: string }[];
  };
  for (const body of bodies.bodies ?? []) frames[`car-${body.id}`] = frame('car');
  // The facility markers are the same shape of request — `prop-doormarker-
  // ${family}` — for the same reason. Derived from the exported family list
  // rather than hardcoded, so adding a family without art fails here instead of
  // throwing UnknownAtlasFrameError in a test that never exercises the city.
  for (const family of FACILITY_FAMILIES) frames[`prop-doormarker-${family}`] = frame('prop');
  return loadAtlasIndex({
    atlases: [{ file: 'fixture.png', width: 64, height: 64 }],
    frames,
  });
}

/**
 * Every frame the fixture invents must really exist in the shipped atlas, and
 * vice versa for the kinds the city uses.
 *
 * The fixture is generated from source, so it can only ever be too GENEROUS
 * (a name in a comment or a string that is not actually requested), never too
 * small. This test catches the generous direction: a generated name that is not
 * in the real manifest means the city view is asking for art that does not
 * exist, which is a production crash at render time.
 */
it('every frame the city view asks for exists in the real manifest', () => {
  const real = JSON.parse(readFileSync(new URL('../../assets/atlas.json', import.meta.url), 'utf8')) as {
    frames: Record<string, unknown>;
  };
  const sources = ['../../src/ui/city-view.ts', '../../src/render/ground.ts']
    .map((rel) => readFileSync(new URL(rel, import.meta.url), 'utf8'))
    .join('\n');
  const asked = [...new Set([...sources.matchAll(/'([a-z]+-[a-z0-9-]+)'/g)].map((m) => m[1]!))];
  expect(asked.filter((name) => !(name in real.frames))).toEqual([]);
  // The regex above CANNOT see a frame requested through a template literal, so
  // the frames that are built that way are pinned explicitly. Without this the
  // test passes while the real manifest is missing exactly the frames that are
  // hardest to notice — a vehicle body or a facility marker art that was never
  // generated ships as a thrown UnknownAtlasFrameError on that screen only.
  const templated = [
    ...FACILITY_FAMILIES.map((family) => `prop-doormarker-${family}`),
  ];
  expect(templated.filter((name) => !(name in real.frames))).toEqual([]);
});

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

  it('emits ONE ground quad, a building plus its shadow per doorway and the gate, and one actor for the on-foot player', () => {
    const snapshot = makeSnapshot();
    const atlasIndex = fixtureAtlasIndex();
    const instances = buildCityInstances(snapshot, atlasIndex);

    const byLayer = new Map<number, number>();
    for (const inst of instances) {
      byLayer.set(inst.layer, (byLayer.get(inst.layer) ?? 0) + 1);
    }

    // The ground is a SINGLE quad now, not a grid of cells. This assertion was
    // previously a closed-form `axisCount * axisCount` grid derivation, and it
    // is worth being explicit that the grid is gone rather than just accepting
    // whatever count comes out: a per-cell grid is what made the ground read as
    // tiled wallpaper, because every cell boundary is a visible seam. The quad
    // has no interior boundary, and `uvRepeatMetres` carries the tiling into the
    // fragment shader instead.
    expect(byLayer.get(0)).toBe(1);
    const groundQuadInstance = instances.find((i) => i.layer === 0);
    expect(groundQuadInstance?.uvRepeatMetres).toBeGreaterThan(0);

    // Layer 1 is buildings, and it is a MIX: shadow+building pairs for the
    // facilities, the gate and the decorative infill, and shadow+marker pairs
    // for the doormarkers, which now carry a ground shadow of their own so they
    // sit ON the map instead of floating over it. So the count is not a simple
    // multiple and strict index pairing does not hold. The invariant that
    // actually matters is that every shadow is IMMEDIATELY followed by its own
    // caster — otherwise painter's-algorithm order puts the building on top of
    // its shadow and the contact shadow silently disappears, which is exactly
    // the bug the shadow work was for.
    const layer1 = instances.filter((i) => i.layer === 1);
    let shadows = 0;
    for (let i = 0; i < layer1.length; i++) {
      const inst = layer1[i]!;
      if ((inst.shadowSoftness ?? 0) <= 0) continue;
      shadows += 1;
      const caster = layer1[i + 1];
      expect(caster, `shadow at index ${i} has no caster after it`).toBeDefined();
      expect(caster!.shadowSoftness ?? 0).toBe(0);
      expect(caster!.atlasId).toBe(inst.atlasId);
      // The shadow is deliberately OFFSET from its caster (light from the
      // upper-left), so positions are not equal — the caster sits one shadow
      // offset up-and-left of the shadow. Asserting the relationship catches a
      // shadow that has drifted onto the wrong side of its building, which a
      // count check would pass.
      expect(inst.position.x - caster!.position.x).toBeCloseTo(1.0, 6);
      expect(inst.position.y - caster!.position.y).toBeCloseTo(-0.9, 6);
    }
    // Sanity: the city really does emit shadows, so the loop above is not
    // passing vacuously over an empty set.
    expect(shadows).toBeGreaterThanOrEqual(snapshot.layout.doorways.length + 1);

    // One walking player, no vehicle in this snapshot.
    expect(byLayer.get(2)).toBe(1);
  });

  it('emits exactly as many layer-1 instances as cityLayer1InstanceCount claims', () => {
    // THE GUARD FOR THE CLASS, not for the doormarker shadow.
    //
    // The layer-1 storage buffer is allocated from `cityLayer1InstanceCount`
    // and `writeInstanceBuffer` does not bounds-check, so an emitter that grows
    // without the count growing is not a partial render — it is a WebGPU
    // validation error that blanks the whole city screen. That failure has been
    // caught TWICE at runtime and never in a test: the exit beacon (iteration 8)
    // and the doormarker shadows (iteration 19).
    //
    // Iteration 19 is the one worth reading twice, because the bug was not
    // caught by fixing it — it was misdiagnosed. Ten extra marker shadows
    // overshot the buffer, and the conclusion drawn was that the shadows had to
    // go because "growing a GPU buffer budget to fit a nice-to-have shadow is
    // the wrong trade". There is no fixed budget to grow: the count is derived,
    // and the correct response to an overshoot is to move the count, which is
    // the entire purpose of the function. The shadows were removed to satisfy a
    // constraint that did not exist, and a real improvement was reverted on the
    // strength of a misreading. A test that compares emitted to claimed makes
    // that misdiagnosis impossible: it cannot tell you a shadow is unaffordable
    // when the price is one integer in the same file.
    for (const cityId of [PROVIDENCE, NEWYORK]) {
      const layout = generateCityLayout(cityId, SAVE_SEED_A);
      const instances = buildCityInstances(
        { layout, player: createCityPlayerState({ ...layout.gate.position }), vehicle: null },
        fixtureAtlasIndex(),
      );
      const emitted = instances.filter((i) => i.layer === 1).length;
      expect(emitted, `layer-1 count drifted for ${cityId}`).toBe(cityLayer1InstanceCount(layout));
    }
  });

  it('renders both a parked vehicle and the on-foot player when the vehicle is present but not occupied', () => {
    const snapshot: CityViewSnapshot = {
      ...makeSnapshot(),
      vehicle: { position: { x: 5, y: 5 }, headingRad: 0, bodyId: 'midsized' },
    };
    const instances = buildCityInstances(snapshot, fixtureAtlasIndex());
    const actorLayer = instances.filter((i) => i.layer === 2);
    // Parked vehicle = its contact shadow + its sprite, then the walking player.
    expect(actorLayer).toHaveLength(3);
    expect(actorLayer[0]!.shadowSoftness ?? 0).toBeGreaterThan(0);
    expect(actorLayer[1]!.shadowSoftness ?? 0).toBe(0);
    expect(actorLayer[2]!.shadowSoftness ?? 0).toBe(0);
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
    // Shadow + vehicle, and no separate walking sprite. The shadow is emitted
    // first so the painter's algorithm within the layer puts it underneath.
    expect(actorLayer).toHaveLength(2);
    expect(actorLayer[0]!.shadowSoftness ?? 0).toBeGreaterThan(0);
    expect(actorLayer[1]!.shadowSoftness ?? 0).toBe(0);
    expect(actorLayer[1]?.position).toEqual({ x: 7, y: -3 });
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

describe('groundQuad: strips, rotation, and the missing-extent guard', () => {
  const atlasIndex = {
    frame: (name: string) => ({ atlasIndex: 0, uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, name }),
  } as never;

  it('throws when given neither halfExtentM nor halfExtent', () => {
    // A quad sized from neither extent is 0x0 and draws nothing, which in a
    // screenshot is indistinguishable from a mistyped frame name. `halfExtentM`
    // had to become optional so a road strip can pass per-axis extents, so this
    // case became reachable and needs to be a loud failure of its own.
    expect(() =>
      groundQuad(atlasIndex, { pool: 'road', center: { x: 0, y: 0 }, layer: 0, tileMetres: 34 }),
    ).toThrow(/halfExtentM or halfExtent/);
  });

  it('builds a rotated strip whose world tiling is unaffected by the rotation', () => {
    // The road is a long narrow band, so it cannot be a square quad. The strip
    // is rotated to the route heading, which is only safe because the ground
    // branch of sprite.wgsl derives UVs from fract(worldPos) rather than from
    // the quad's own axes — so the tiling stays anchored to the world.
    const quad = groundQuad(atlasIndex, {
      pool: 'road',
      center: { x: 10, y: 20 },
      layer: 1,
      tileMetres: 34,
      detailScale: 8.5,
      rotationRad: 1.2,
      halfExtent: { x: 300, y: 6.6 },
      tint: { r: 0.55, g: 0.57, b: 0.61, a: 1 },
    });
    expect(quad.sizeM).toEqual({ x: 600, y: 13.2 });
    expect(quad.rotationRad).toBeCloseTo(1.2, 6);
    // The tiling scale is the detail scale, NOT the quad's size: a strip is
    // enormous along the route and the ground must not stretch with it.
    expect(quad.uvRepeatMetres).toBe(34);
    expect(quad.uvDetailScale).toBeCloseTo(8.5, 6);
  });

  it('still honours the scalar half-extent', () => {
    const quad = groundQuad(atlasIndex, { pool: 'road', center: { x: 0, y: 0 }, layer: 0, tileMetres: 34, halfExtentM: 12 });
    expect(quad.sizeM).toEqual({ x: 24, y: 24 });
    expect(quad.rotationRad).toBe(0);
  });
});

describe('facility entrance markers are colour-coded by FUNCTION, not by building', () => {
  it('gives each facility family its own tint, and leaves the buildings in one palette', () => {
    // The point of this is the distinction it is easy to collapse. Eight reviews
    // called the city an undifferentiated grey box field and most wanted
    // per-BUILDING colour - which iteration 16 spent a whole round REMOVING,
    // because it made the city read as a collage of unrelated source art, and
    // which iteration 34 was asked to reverse for the fifth time.
    //
    // A functional colour is the other thing: the same pixels carrying what the
    // building IS FOR rather than what it happens to look like. It lives on the
    // entrance marker, so the building sprites keep the single slate grade.
    //
    // And it costs no instances — the city actor buffer is exactly full at
    // 95/95, which is why iteration 19's marker shadows had to be reverted.
    const workshop = facilityMarkerTint('garage');
    const trade = facilityMarkerTint('truckstop');
    const care = facilityMarkerTint('medical');
    const combat = facilityMarkerTint('arena');

    const tints = [workshop, trade, care, combat].map((t) => `${t.r},${t.g},${t.b}`);
    expect(new Set(tints).size).toBe(4);

    // Each one has to read as ITS OWN hue, not merely as "a different number",
    // so check the dominant channel actually differs.
    const dominant = (t: { r: number; g: number; b: number }) =>
      (['r', 'g', 'b'] as const).reduce((a, b) => (t[b] > t[a] ? b : a));
    expect(dominant(combat)).toBe('r');
    expect(dominant(workshop)).toBe('r');
    expect(dominant(care)).toBe('g');
    expect(dominant(trade)).toBe('b');

    // The four workshop-ish facilities share one tint, and an unknown kind falls
    // back to trade rather than rendering white.
    expect(facilityMarkerTint('weaponshop')).toEqual(workshop);
    expect(facilityMarkerTint('salvage')).toEqual(workshop);
    expect(facilityMarkerTint('assembly')).toEqual(workshop);
    expect(facilityMarkerTint('bar')).toEqual(care);
    expect(facilityMarkerTint('something-new')).toEqual(trade);
  });
});
