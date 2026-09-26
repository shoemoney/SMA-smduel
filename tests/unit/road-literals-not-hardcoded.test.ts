/**
 * Mutation-proof coverage for four gameplay numbers that used to be bare TS
 * literals in @/app.ts and were moved into the rulesets:
 *
 *   - cityDirectionFromVector's `0.35` deadzone -> controls.json's
 *     `cityDirectionDeadzone` (a distinct, higher-level deadzone from the
 *     existing `gamepadAxisThreshold` - see that key's fidelity-notes.yaml
 *     entry for why they don't share a value).
 *   - roadBounds' `* 2` -> driving.json's `radar.aiHazardBoxRangeMultiplier`.
 *   - the wreck-search reach's `* 4` -> driving.json's
 *     `collision.wreckSearchRangeMultiplier` (exposed as the exported
 *     `wreckSearchRangeM()`, since the real call site is a closure inside
 *     `showRoad` that isn't independently reachable from a test).
 *   - the peaceful-traffic-passed notice's `* 8` -> driving.json's
 *     `collision.trafficPassRangeMultiplier` (exposed the same way as
 *     `trafficPassRangeM()`).
 *
 * Each test below mocks the relevant ruleset value away from its real
 * default and asserts the observable output MOVES with the mock - the one
 * proof a hardcoded literal (which cannot react to a mock) could not pass.
 * Verified by temporarily re-hardcoding each of the four call sites back to
 * a literal: every test in this file that covers it failed (see PR notes).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as rulesetsModule from '@/data/rulesets';

const MOCK_CITY_DIRECTION_DEADZONE = 0.6;

vi.mock('@rulesets/classic/controls.json', async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return { default: { ...actual.default, cityDirectionDeadzone: MOCK_CITY_DIRECTION_DEADZONE } };
});

const { arenaBounds, cityDirectionFromVector, roadBounds, wreckSearchRangeM, trafficPassRangeM } = await import('@/app');

describe('cityDirectionFromVector: deadzone sourced from controls.json, not a hardcoded 0.35', () => {
  it('a vector that clears the real 0.35 default but not the mocked 0.6 resolves to null instead of a direction', () => {
    // abs(0.5) > 0.35 (the real default) would produce 'E' - only the
    // mocked 0.6 threshold explains a null here.
    expect(cityDirectionFromVector({ x: 0.5, y: 0 })).toBeNull();
    expect(cityDirectionFromVector({ x: 0, y: -0.5 })).toBeNull();
  });

  it('still resolves a direction once magnitude clears the mocked 0.6 threshold', () => {
    expect(cityDirectionFromVector({ x: 0.7, y: 0 })).toBe('E');
    // moveY is negated inside cityDirectionFromVector (see its own header
    // comment: driveUp/positive-Y maps to compass north), so a positive
    // input y resolves to 'N', not 'S'.
    expect(cityDirectionFromVector({ x: 0, y: 0.7 })).toBe('N');
  });
});

describe('roadBounds: hazard-box multiplier sourced from driving.json, not a hardcoded *2', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('box half-extent scales with a mocked aiHazardBoxRangeMultiplier instead of the real 2', () => {
    const real = rulesetsModule.drivingConfig();
    vi.spyOn(rulesetsModule, 'drivingConfig').mockReturnValue({
      ...real,
      radar: { ...real.radar, aiHazardBoxRangeMultiplier: 10 },
    });
    const bounds = roadBounds({ x: 0, y: 0 });
    const expectedHalf = real.radar.visualRangeM * 10;
    expect(bounds.maxX).toBe(expectedHalf);
    expect(bounds.minX).toBe(-expectedHalf);
    expect(bounds.maxY).toBe(expectedHalf);
    expect(bounds.minY).toBe(-expectedHalf);
  });
});

describe('wreckSearchRangeM: multiplier sourced from driving.json, not a hardcoded *4', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reach scales with a mocked wreckSearchRangeMultiplier instead of the real 4', () => {
    const real = rulesetsModule.drivingConfig();
    vi.spyOn(rulesetsModule, 'drivingConfig').mockReturnValue({
      ...real,
      collision: { ...real.collision, wreckSearchRangeMultiplier: 100 },
    });
    expect(wreckSearchRangeM()).toBe(real.collision.vehicleSeparationM * 100);
  });
});

describe('trafficPassRangeM: multiplier sourced from driving.json, not a hardcoded *8', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('range scales with a mocked trafficPassRangeMultiplier instead of the real 8', () => {
    const real = rulesetsModule.drivingConfig();
    vi.spyOn(rulesetsModule, 'drivingConfig').mockReturnValue({
      ...real,
      collision: { ...real.collision, trafficPassRangeMultiplier: 50 },
    });
    expect(trafficPassRangeM()).toBe(real.collision.vehicleSeparationM * 50);
  });
});

// ---------------------------------------------------------------------------
// roadBounds was reported by a release gate as DEAD CODE — zero production
// callers. It was worse than that: it is the unwired half of a bug fix.
//
// `showRoad` drives its opponents through the SAME makeArenaAISystem the arena
// uses, and that system bounded every AI with arenaBounds() — a fixed box
// centred on the world ORIGIN. An arena genuinely is a fixed floor; a road is
// not. Far enough from the origin, every road opponent believes it is out of
// bounds and steers back toward the origin instead of fighting the player.
//
// These pin the property that distinguishes the two, so reverting the road to
// arena bounds fails rather than silently restoring the bug.
// ---------------------------------------------------------------------------
// KNOWN COVERAGE LIMIT, stated rather than implied. These pin roadBounds' own
// BEHAVIOUR. They do NOT prove `showRoad` passes it to makeArenaAISystem —
// reverting that call site to the 3-arg form (the fixed arena floor) still
// leaves this file green. Catching that needs a DOM screen test that reaches the
// road with a spawned opponent far from the origin, which the happy-dom harness
// in tests/integration/screens.test.ts can reach but at real cost. Until that
// exists, the road wiring is grep-verified, not test-verified. Do not read these
// three passing tests as proof the bug cannot come back.
describe('road AI bounds follow the player, unlike the arena floor', () => {
  it('roadBounds is centred on the point it is given, not on the world origin', () => {
    const far = { x: 5_000, y: -3_200 };
    const b = roadBounds(far);
    const midX = (b.minX + b.maxX) / 2;
    const midY = (b.minY + b.maxY) / 2;
    expect({ midX, midY }).toEqual({ midX: far.x, midY: far.y });
  });

  it('a player far from the origin is INSIDE road bounds but OUTSIDE the fixed arena floor', () => {
    // This is the whole bug in one assertion: the same position the road must
    // treat as in-play, the arena floor treats as out of bounds.
    const far = { x: 5_000, y: 0 };
    const road = roadBounds(far);
    const arena = arenaBounds();

    const insideRoad = far.x >= road.minX && far.x <= road.maxX && far.y >= road.minY && far.y <= road.maxY;
    const insideArena = far.x >= arena.minX && far.x <= arena.maxX && far.y >= arena.minY && far.y <= arena.maxY;

    expect({ insideRoad, insideArena }).toEqual({ insideRoad: true, insideArena: false });
  });

  it('road bounds are sized from the ruleset, not a literal', () => {
    const real = rulesetsModule.drivingConfig();
    vi.spyOn(rulesetsModule, 'drivingConfig').mockReturnValue({
      ...real,
      radar: { ...real.radar, aiHazardBoxRangeMultiplier: 7 },
    });
    const b = roadBounds({ x: 0, y: 0 });
    expect(b.maxX).toBe(real.radar.visualRangeM * 7);
  });
});
