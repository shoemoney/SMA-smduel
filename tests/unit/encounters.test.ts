/**
 * `@/sim/encounters` builds ROAD ENCOUNTERS on top of `@/sim/road`'s own
 * `generateRouteContacts` (faction weighting, packs, disposition, hostility
 * are all `@/sim/road`'s and reused unchanged here) by adding: a
 * (seed, route, day)-deterministic draw stream, archetype assignment per
 * contact, and repopulation-adjusted effective danger. This suite proves
 * the ADDED layer, not the reused one (`@/sim/road`'s own suite already
 * proves faction weighting/packs/disposition).
 */
import { describe, expect, it, vi } from 'vitest';

import { attackContact, dangerLevel, willFire } from '@/sim/road';
import type { RouteDef } from '@/sim/types';

import { economy, skillsConfig } from '@/data/rulesets';
import { initialClock } from '@/sim/calendar';
import { COURIERGUILD_KIND, courierGuildEngine, type CourierGuildState } from '@/ui/buildings/courierguild';
import type { BuildingContext } from '@/ui/buildings/shared';
import type { AcceptedJob, CourierOffer } from '@/sim/courier';
import type { CargoState, DriverState, VehicleState } from '@/sim/types';
import { createRng } from '@/util/rng';

const {
  allEncounterArchetypes,
  effectiveDangerForRoute,
  FRESH_ROUTE_HISTORY,
  generateEncounters,
  isCombatCapableArchetype,
  recordDelivery,
  recordRouteCleared,
  selectArchetypeForEncounter,
} = await import('@/sim/encounters');
import type { RouteEncounterHistory } from '@/sim/encounters';

function route(overrides: Partial<RouteDef> = {}): RouteDef {
  return { id: 'test-route', a: 'city-a', b: 'city-b', lengthMiles: 300, danger: 2, ...overrides };
}

// ---------------------------------------------------------------------------
// Determinism: reloading a save must not reroll the road.
// ---------------------------------------------------------------------------

describe('generateEncounters: deterministic from (seed, route, day)', () => {
  it('the identical (route, day, seed, history) call produces an identical encounter list', () => {
    const r = route({ danger: 3, lengthMiles: 400 });
    const first = generateEncounters(r, 12, 'save-seed-1', FRESH_ROUTE_HISTORY);
    const second = generateEncounters(r, 12, 'save-seed-1', FRESH_ROUTE_HISTORY);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('a different seed on the same route/day produces a different encounter list (the stream actually depends on seed)', () => {
    const r = route({ danger: 4, lengthMiles: 400 });
    const a = generateEncounters(r, 5, 'seed-A', FRESH_ROUTE_HISTORY);
    const b = generateEncounters(r, 5, 'seed-B', FRESH_ROUTE_HISTORY);
    expect(a).not.toEqual(b);
  });

  it('a different route.id on the same seed/day produces a different encounter list (route identity is part of the key, not just its shape)', () => {
    const a = generateEncounters(route({ id: 'route-a', danger: 4 }), 5, 'shared-seed', FRESH_ROUTE_HISTORY);
    const b = generateEncounters(route({ id: 'route-b', danger: 4 }), 5, 'shared-seed', FRESH_ROUTE_HISTORY);
    expect(a).not.toEqual(b);
  });

  it('a different day on the same route/seed produces a different encounter list (day is part of the key, not just a repopulation input)', () => {
    const r = route({ danger: 4 });
    const a = generateEncounters(r, 1, 'shared-seed-2', FRESH_ROUTE_HISTORY);
    const b = generateEncounters(r, 2, 'shared-seed-2', FRESH_ROUTE_HISTORY);
    expect(a).not.toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Spawn count scales with route length and is capped by spawnBudget.
// ---------------------------------------------------------------------------

/**
 * `rollCount` (the number of independently-rolled traffic "slots", capped at
 * `spawnBudget`) is the thing `spawnBudget` bounds — NOT the final contact
 * count, since any slot that rolls `outlaw` expands into a whole pack of up
 * to `packSizeMax` members, and the independent ambush roll can add one more
 * full pack on top. So the real ceiling on total contacts is
 * `(spawnBudget + 1) * packSizeMax` (every slot AND the ambush roll happening
 * to be a max-size outlaw pack) — loose, but a genuine upper bound, unlike
 * `spawnBudget` alone which the assertion below shows is not.
 */
function maxPossibleContacts(danger: number): number {
  const tier = dangerLevel(danger);
  return (tier.spawnBudget + 1) * tier.packSizeMax;
}

describe('generateEncounters: spawn count', () => {
  it('a longer route spawns more contacts than a short one at the same danger (spawnsPerHundredMiles scaling)', () => {
    const short = generateEncounters(route({ id: 'short', lengthMiles: 50, danger: 3 }), 1, 'scale-seed');
    const long = generateEncounters(route({ id: 'long', lengthMiles: 1000, danger: 3 }), 1, 'scale-seed');
    expect(long.length).toBeLessThanOrEqual(maxPossibleContacts(3));
    expect(long.length).toBeGreaterThan(short.length);
  });

  // A "capped by spawnBudget" assertion belongs to `@/sim/road`'s own suite,
  // not here: the cap is entirely `@/sim/road`'s `Math.min`, encounters.ts
  // never touches spawn count, and the old version of this test computed
  // its own bound (`(spawnBudget + 1) * packSizeMax`) from the SAME
  // `dangerLevel()` row `@/sim/road` reads — so it was arithmetically
  // guaranteed to pass regardless of anything this file's own code did (no
  // mutation of encounters.ts can fail it). Removed rather than kept as
  // dead weight; this file's docstring already says its job is to prove
  // the ADDED layer, not re-prove `@/sim/road`'s own reused behaviour.
});

// ---------------------------------------------------------------------------
// Faction weighting + outlaw packs (delegated to @/sim/road, exercised here
// through the public generateEncounters surface).
// ---------------------------------------------------------------------------

describe('generateEncounters: faction mix and packs', () => {
  it('danger 0 and danger 4 produce measurably different outlaw counts from the same seed', () => {
    const lowDanger = generateEncounters(route({ id: 'danger-0-route', danger: 0, lengthMiles: 300 }), 10, 'danger-compare-seed');
    const highDanger = generateEncounters(route({ id: 'danger-4-route', danger: 4, lengthMiles: 300 }), 10, 'danger-compare-seed');

    const lowOutlaws = lowDanger.filter((u) => u.faction === 'outlaw').length;
    const highOutlaws = highDanger.filter((u) => u.faction === 'outlaw').length;

    expect(highOutlaws).toBeGreaterThan(lowOutlaws);
    expect(lowOutlaws).toBe(0); // danger 0's factionWeights.outlaw is 0 and this seed doesn't trip the ambush roll
    expect(highOutlaws).toBeGreaterThan(0);
  });

  it('outlaw pack sizes stay within the configured danger tier bounds', () => {
    const tier4 = dangerLevel(4);
    for (let i = 0; i < 25; i++) {
      const units = generateEncounters(route({ id: `pack-route-${i}`, danger: 4, lengthMiles: 500 }), 7, `pack-seed-${i}`);
      const packSizes = new Map<string, number>();
      for (const unit of units) {
        if (unit.faction === 'outlaw' && unit.packId !== null) {
          packSizes.set(unit.packId, (packSizes.get(unit.packId) ?? 0) + 1);
        }
      }
      for (const size of packSizes.values()) {
        expect(size).toBeGreaterThanOrEqual(tier4.packSizeMin);
        expect(size).toBeLessThanOrEqual(tier4.packSizeMax);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// NOT ALL TRAFFIC IS HOSTILE.
// ---------------------------------------------------------------------------

/** Rolls `route` across days under `seedPrefix` until one call's contact list includes `faction`, and returns that contact — same hunt technique as the vigilante/outlaw test below. */
function findContactOfFaction(
  routeDef: RouteDef,
  seedPrefix: string,
  faction: string,
): ReturnType<typeof generateEncounters>[number] {
  for (let day = 0; day < 200; day++) {
    const units = generateEncounters(routeDef, day, seedPrefix);
    const found = units.find((u) => u.faction === faction);
    if (found !== undefined) return found;
  }
  throw new Error(`could not find a "${faction}" contact in 200 days of rolls under seed "${seedPrefix}"`);
}

describe('generateEncounters: disposition (not all traffic is hostile)', () => {
  it('a civilian contact never initiates fire', () => {
    const civilian = findContactOfFaction(route({ id: 'civilian-route', danger: 1 }), 'civilian-seed', 'civilian');
    expect(willFire(civilian)).toBe(false);
  });

  it('attacking a civilian makes it retaliate', () => {
    const civilian = findContactOfFaction(route({ id: 'civilian-route-2', danger: 1 }), 'civilian-seed-2', 'civilian');
    const attacked = attackContact(civilian);
    expect(attacked.disposition).toBe('retaliating');
    expect(willFire(attacked)).toBe(true);
  });

  it('a courier contact never initiates fire either', () => {
    const courier = findContactOfFaction(route({ id: 'courier-route', danger: 1 }), 'courier-seed', 'courier');
    expect(willFire(courier)).toBe(false);
  });

  // A vigilante-engages-outlaw-but-never-the-player assertion was removed
  // from here: both halves are `@/sim/road`'s own faction-table/disposition
  // logic (vigilante's `hostile: false` and nothing listing
  // `hostileTo: ['vigilante']` in encounters.json), reused unchanged by
  // this module and already provable without any archetype assignment or
  // repopulation math this file adds — no mutation of encounters.ts's own
  // code could ever fail it. This file's docstring already says its job is
  // to prove the ADDED layer, not re-prove `@/sim/road`'s own reused
  // disposition behaviour.
});

// ---------------------------------------------------------------------------
// Archetype choice respects faction AND danger level.
// ---------------------------------------------------------------------------

describe('archetype selection: respects faction and danger level', () => {
  it('an outlaw encounter never fields the civilian (or any non-outlaw) archetype', () => {
    for (let day = 0; day < 15; day++) {
      const units = generateEncounters(route({ id: 'no-civ-outlaw-route', danger: 4, lengthMiles: 500 }), day, 'faction-purity-seed');
      for (const unit of units) {
        if (unit.faction === 'outlaw') {
          expect(['roadthug', 'raider', 'warwagon']).toContain(unit.archetypeId);
        }
        if (unit.faction === 'civilian') {
          expect(unit.archetypeId).toBe('beater');
        }
      }
    }
  });

  it('the outlaw archetype at the lowest danger id is strictly less capable (lower value band) than at the highest', () => {
    const low = selectArchetypeForEncounter('outlaw', 0);
    const high = selectArchetypeForEncounter('outlaw', 4);
    expect(low.id).not.toBe(high.id);
    expect(low.valueBand[1]).toBeLessThan(high.valueBand[0]);
  });

  /**
   * The endpoint-only test above passes for BOTH `Math.round` (the shipped
   * bug) and `Math.floor` of the same `fraction * (pool.length - 1)`
   * formula, because danger 0 and danger 4 land on the same bucket under
   * either rounding rule — only the three tiers in between move. Asserting
   * the full 5-tier sequence (encounters.json's real outlaw roster has
   * exactly 3 archetypes: roadthug, raider, warwagon, ascending value) is
   * what actually distinguishes a correct ramp from `Math.round`'s bug,
   * which put danger 1 AND danger 2 on 'raider' and danger 0 alone on
   * 'roadthug' — the one danger tier encounters.json's own
   * `factionWeights.outlaw` sets to 0, so 'roadthug' could never actually
   * spawn in play. See the reachability test below for that property
   * proven directly off the ruleset rather than as a hardcoded sequence.
   */
  it('the outlaw archetype ramps across all five danger tiers, not just the two endpoints', () => {
    const byDanger = [0, 1, 2, 3, 4].map((danger) => selectArchetypeForEncounter('outlaw', danger).id);
    expect(byDanger).toEqual(['roadthug', 'roadthug', 'raider', 'warwagon', 'warwagon']);
  });

  it('every outlaw archetype is reachable at a danger tier where outlaws can actually spawn (nonzero factionWeights.outlaw)', () => {
    const spawnableTiers = [0, 1, 2, 3, 4].filter((danger) => dangerLevel(danger).factionWeights.outlaw > 0);
    const reachableIds = new Set(spawnableTiers.map((danger) => selectArchetypeForEncounter('outlaw', danger).id));
    const allOutlawIds = new Set(
      allEncounterArchetypes()
        .filter((a) => a.factions.includes('outlaw'))
        .map((a) => a.id),
    );
    expect(reachableIds).toEqual(allOutlawIds);
  });

  it('a faction with only one archetype resolves to it at every danger level', () => {
    const at0 = selectArchetypeForEncounter('vigilante', 0);
    const at4 = selectArchetypeForEncounter('vigilante', 4);
    expect(at0.id).toBe(at4.id);
  });

  it('every selected archetype is combat-capable when the faction is hostile-capable (outlaw)', () => {
    for (const danger of [0, 1, 2, 3, 4]) {
      const archetype = selectArchetypeForEncounter('outlaw', danger);
      expect(isCombatCapableArchetype(archetype)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Repopulation.
// ---------------------------------------------------------------------------

describe('effectiveDangerForRoute: repopulation over time', () => {
  it('stays fully suppressed (minEffectiveDanger) through the whole quiet window after clearing', () => {
    const r = route({ danger: 4 });
    const cleared = recordRouteCleared(FRESH_ROUTE_HISTORY, 10);
    expect(effectiveDangerForRoute(r, 10, cleared)).toBe(0);
    expect(effectiveDangerForRoute(r, 12, cleared)).toBe(0);
    expect(effectiveDangerForRoute(r, 13, cleared)).toBe(0); // day 13 = clear day + clearedRouteQuietDays (3): still within the quiet window
  });

  it('measurably repopulates day by day once the quiet window ends, and fully recovers after it', () => {
    const r = route({ danger: 4 });
    const cleared = recordRouteCleared(FRESH_ROUTE_HISTORY, 0);
    const day4 = effectiveDangerForRoute(r, 4, cleared);
    const day5 = effectiveDangerForRoute(r, 5, cleared);
    const day6 = effectiveDangerForRoute(r, 6, cleared);
    const day7 = effectiveDangerForRoute(r, 7, cleared);

    expect(day4).toBeGreaterThan(0); // repopulation has started
    expect(day5).toBeGreaterThan(day4); // and it keeps climbing day over day
    expect(day6).toBeGreaterThan(day5);
    expect(day7).toBe(r.danger); // fully repopulated back to base danger
    expect(effectiveDangerForRoute(r, 30, cleared)).toBe(r.danger); // never overshoots
  });

  it('a cleared route measurably spawns fewer outlaws right after clearing than once it has fully repopulated', () => {
    const r = route({ id: 'repop-route', danger: 4, lengthMiles: 600 });
    const cleared = recordRouteCleared(FRESH_ROUTE_HISTORY, 0);
    const rightAfter = generateEncounters(r, 0, 'repop-seed', cleared);
    const fullyRepopulated = generateEncounters(r, 7, 'repop-seed', cleared);

    const outlawsRightAfter = rightAfter.filter((u) => u.faction === 'outlaw').length;
    const outlawsRepopulated = fullyRepopulated.filter((u) => u.faction === 'outlaw').length;
    expect(outlawsRightAfter).toBe(0);
    expect(outlawsRepopulated).toBeGreaterThan(0);
  });

  /**
   * The real ruleset's `minEffectiveDanger` is 0, so `toBeGreaterThanOrEqual(0)`
   * against it is structurally guaranteed by `Math.max(0, ...)` regardless of
   * whether the floor is wired to the ruleset value at all — it would pass
   * even against a version that clamped to a hardcoded 0. Mocking a
   * NON-ZERO floor is what actually proves "never below minEffectiveDanger"
   * as opposed to "never below zero".
   */
  it('never returns below minEffectiveDanger, proven with a non-zero mocked floor', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/encounters.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: Record<string, unknown> }>();
      return {
        default: {
          ...actual.default,
          repopulation: {
            clearedRouteQuietDays: 3,
            repopulationPerDay: 0.25,
            wellTravelledDangerReductionPerDelivery: 0.02,
            minEffectiveDanger: 2,
          },
        },
      };
    });

    const mocked = await import('@/sim/encounters');
    const r: RouteDef = { id: 'floor-route', a: 'a', b: 'b', lengthMiles: 300, danger: 4 };

    // Still inside the quiet window right after clearing: fully suppressed
    // down to the mocked floor of 2, not to 0.
    const cleared = mocked.recordRouteCleared(mocked.FRESH_ROUTE_HISTORY, 0);
    expect(mocked.effectiveDangerForRoute(r, 1, cleared)).toBe(2);

    // 200+ deliveries at 0.02/delivery would drive danger 4 well past 0 and
    // into negative territory without a floor; confirm it clamps at the
    // mocked 2, not 0 and not negative.
    let history = mocked.FRESH_ROUTE_HISTORY;
    for (let i = 0; i < 250; i++) history = mocked.recordDelivery(history);
    expect(mocked.effectiveDangerForRoute(r, 0, history)).toBe(2);

    vi.doUnmock('@rulesets/classic/encounters.json');
    vi.resetModules();
  });

  it('a route that has never been cleared ignores the repopulation clock entirely', () => {
    const r = route({ danger: 4 });
    expect(effectiveDangerForRoute(r, 0, FRESH_ROUTE_HISTORY)).toBe(4);
    expect(effectiveDangerForRoute(r, 1000, FRESH_ROUTE_HISTORY)).toBe(4);
  });
});

describe('effectiveDangerForRoute: well-travelled deliveries', () => {
  /**
   * The real ruleset's `wellTravelledDangerReductionPerDelivery` is 0.02, so
   * 60 deliveries only shaves 1.2 off a danger-4 route (down to 2.8) — nowhere
   * near the floor of 0, which needs 200 deliveries (`4 / 0.02`). The old
   * version of this test asserted the floor with only 60 deliveries taken,
   * so `expect(last).toBeGreaterThanOrEqual(0)` passed whether or not the
   * floor clamp (`Math.max(minEffectiveDanger, ...)`) existed at all —
   * deleting it entirely still left `last` comfortably above 0. Driving
   * enough deliveries to actually REACH the floor, and asserting the exact
   * value, is what makes this test fail if the clamp is removed (it would
   * read a negative number instead).
   */
  it('each delivery lowers effective danger, and enough deliveries genuinely reach minEffectiveDanger', () => {
    const r = route({ danger: 4 });
    let history: RouteEncounterHistory = FRESH_ROUTE_HISTORY;
    const readings: number[] = [effectiveDangerForRoute(r, 0, history)];
    for (let i = 0; i < 250; i++) {
      history = recordDelivery(history);
      readings.push(effectiveDangerForRoute(r, 0, history));
    }
    // Monotonically non-increasing as deliveries pile up...
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeLessThanOrEqual(readings[i - 1] as number);
    }
    // ...and it did actually move (not a no-op knob)...
    const first = readings[0] as number;
    const last = readings[readings.length - 1] as number;
    expect(last).toBeLessThan(first);
    // ...genuinely reaching the floor (250 deliveries * 0.02 = 5, more than
    // danger 4's whole base) rather than merely staying non-negative.
    expect(last).toBe(0);
  });

  /**
   * At day 0 with no deliveries, "cleared only" is ALREADY fully suppressed
   * to minEffectiveDanger (the quiet window suppresses to the floor
   * outright), so the old test's `dClearedOnly` was 0 regardless of
   * anything deliveries do — `dBoth <= dClearedOnly` degenerated to `0 <= 0`,
   * true for every possible implementation. Using a day PAST the quiet
   * window (partial, not full, repopulation) and a delivery count that does
   * NOT alone reach the floor makes both individual readings genuinely sit
   * above the floor, so stacking them has to do real work to still come out
   * lower — and strictly lower, not merely "no worse".
   */
  it('deliveries and clearing genuinely stack: a partly-recovered, well-travelled route is strictly more suppressed than either effect alone', () => {
    const r = route({ danger: 4 });
    const day = 5; // 2 days past the real ruleset's 3-day quiet window: partial, not full, repopulation.

    let deliveriesOnly: RouteEncounterHistory = FRESH_ROUTE_HISTORY;
    for (let i = 0; i < 50; i++) deliveriesOnly = recordDelivery(deliveriesOnly);
    const clearedOnly = recordRouteCleared(FRESH_ROUTE_HISTORY, 0);
    let both: RouteEncounterHistory = recordRouteCleared(FRESH_ROUTE_HISTORY, 0);
    for (let i = 0; i < 50; i++) both = recordDelivery(both);

    const dDeliveriesOnly = effectiveDangerForRoute(r, day, deliveriesOnly);
    const dClearedOnly = effectiveDangerForRoute(r, day, clearedOnly);
    const dBoth = effectiveDangerForRoute(r, day, both);

    // Neither effect alone is degenerate (already at the floor) at this
    // day/delivery-count combination...
    expect(dDeliveriesOnly).toBeGreaterThan(0);
    expect(dClearedOnly).toBeGreaterThan(0);
    // ...so a STRICT improvement from stacking them is a real assertion,
    // not `0 <= 0`.
    expect(dBoth).toBeLessThan(dDeliveriesOnly);
    expect(dBoth).toBeLessThan(dClearedOnly);
  });
});

// ---------------------------------------------------------------------------
// Tautology guard: every repopulation number above must come from
// encounters.json's `repopulation` block, not a hardcoded literal that
// happens to match it. Same technique as
// tests/unit/road.outlawchance-one.test.ts (mocking the JSON module
// directly, since `repopulation` isn't part of `@/data/rulesets`).
// ---------------------------------------------------------------------------

describe('effectiveDangerForRoute: repopulation numbers are ruleset-sourced, not hardcoded', () => {
  it('moves with a mocked clearedRouteQuietDays/repopulationPerDay/minEffectiveDanger instead of the real ones', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/encounters.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: Record<string, unknown> }>();
      return {
        default: {
          ...actual.default,
          repopulation: {
            clearedRouteQuietDays: 1,
            repopulationPerDay: 1,
            wellTravelledDangerReductionPerDelivery: 10,
            minEffectiveDanger: 1,
          },
        },
      };
    });

    const mocked = await import('@/sim/encounters');
    const r: RouteDef = { id: 'mock-route', a: 'a', b: 'b', lengthMiles: 300, danger: 4 };
    const cleared = mocked.recordRouteCleared(mocked.FRESH_ROUTE_HISTORY, 0);

    // Real ruleset: day 1 is still fully suppressed to 0 (quiet window is 3
    // days, floor is 0). Mocked ruleset: quiet window is 1 day and the floor
    // is 1, so day 1 is already past quiet and floored at 1, not 0.
    expect(mocked.effectiveDangerForRoute(r, 1, cleared)).toBe(1);

    // Mocked wellTravelledDangerReductionPerDelivery of 1 (vs the real 0.02)
    // means a single delivery already floors danger at the mocked minimum.
    const oneDelivery = mocked.recordDelivery(mocked.FRESH_ROUTE_HISTORY);
    expect(mocked.effectiveDangerForRoute(r, 0, oneDelivery)).toBe(1);

    vi.doUnmock('@rulesets/classic/encounters.json');
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// Wiring: a REAL delivery through the courier guild's deliver action must
// actually call recordDelivery and feed the result back into what
// generateEncounters spawns. `recordDelivery`/`effectiveDangerForRoute`
// having correct standalone math (proven above) says nothing about whether
// anything in the game ever CALLS them on a real delivery - this drives the
// actual `@/ui/buildings/courierguild` reducer, the one production caller
// the task wires up, rather than asserting `recordDelivery` returns a
// number.
// ---------------------------------------------------------------------------

const DELIVERY_ROUTE_ID = 'delivery-wiring-route';
const DELIVERY_ORIGIN_CITY = 'origin-city';
const DELIVERY_DEST_CITY = 'dest-city';

function makeDeliveryDriver(): DriverState {
  return {
    name: 'Wiring Duelist',
    skills: { driving: 20, marksmanship: 20, mechanic: 10 },
    naturalHealth: skillsConfig().driver.naturalHealthDP,
    bodyArmor: 0,
    prestige: skillsConfig().driver.prestigeFloor,
    cash: economy().startingCash,
    cityId: DELIVERY_DEST_CITY,
    cloneCityId: null,
    cloneSkills: null,
  };
}

/** van/standard/light/small/standard, unarmed - identical shape to `tests/unit/courier.test.ts`'s own `makeVehicle`, just inlined so this file doesn't reach into another test file's fixtures. */
function makeDeliveryVehicle(cargo: readonly CargoState[]): VehicleState {
  return {
    id: 'wiring-veh-1',
    ownerId: 'wiring-driver-1',
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
    cargo: [...cargo],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
  };
}

function makeDeliveryOffer(id: string): CourierOffer {
  return {
    id: `offer-${id}`,
    originCityId: DELIVERY_ORIGIN_CITY,
    destinationCityId: DELIVERY_DEST_CITY,
    destinationFacility: COURIERGUILD_KIND,
    routeId: DELIVERY_ROUTE_ID,
    distanceMiles: 100,
    dangerLevel: 4,
    weightLb: 50,
    spaces: 1,
    dueDay: 1000, // never late - lateness/prestige decay is not what this test proves
    declaredValue: 1000,
    pay: 500,
    cargoName: 'wiring test crate',
  };
}

function makeDeliveryContext(routeHistory: BuildingContext['routeHistory']): BuildingContext {
  return {
    driver: makeDeliveryDriver(),
    clock: initialClock(),
    cityId: DELIVERY_DEST_CITY,
    vehicle: makeDeliveryVehicle([]),
    vehicleStored: false,
    fleetSize: 1,
    existingCarNames: [],
    rng: createRng('delivery-wiring-seed'),
    rumorsHeardToday: new Map(),
    activeCourierJobs: [],
    routeHistory,
  };
}

/**
 * Drives ONE real delivery through `courierGuildEngine.activate`'s
 * `deliver-*` branch: a fresh ACTIVE job with its cargo genuinely aboard the
 * vehicle, standing in the right city at the right facility - the exact
 * preconditions `deliverableJobsFor` requires, so `deliver()` really does
 * resolve ON_TIME (never WRONG_LOCATION/FAILED). Returns the `routeHistory`
 * the engine handed back, carrying forward whatever `recordDelivery` did
 * (or didn't) do to it.
 */
function deliverOnce(routeHistory: BuildingContext['routeHistory'], cargoId: string): BuildingContext['routeHistory'] {
  const offer = makeDeliveryOffer(cargoId);
  const job: AcceptedJob = { offer, cargoId, status: 'ACTIVE', acceptedDay: 0 };
  const cargo: CargoState = {
    id: cargoId,
    kind: 'payload',
    weightLb: offer.weightLb,
    spaces: offer.spaces,
    integrity: economy()._reconstruction.cargoFullIntegrity,
  };

  const context = makeDeliveryContext(routeHistory);
  const state: CourierGuildState = {
    context: { ...context, vehicle: makeDeliveryVehicle([cargo]), activeCourierJobs: [job] },
    offers: [],
    daySpentThisVisit: false,
  };

  const result = courierGuildEngine.activate(state, `deliver-${cargoId}`);
  return result.state.context.routeHistory;
}

describe('recordDelivery wiring: a real courier-guild delivery, not just the standalone function', () => {
  it('one delivery through the deliver action records exactly one delivery on that route (and no other route)', () => {
    const before = new Map<string, RouteEncounterHistory>();
    const after = deliverOnce(before, 'wiring-cargo-1');

    expect(after.get(DELIVERY_ROUTE_ID)?.deliveriesCompleted).toBe(1);
    expect(after.size).toBe(1); // no phantom entry for some other route id
  });

  it('repeated real deliveries accumulate on the same route (2nd delivery = 2 completed, not a reset to 1)', () => {
    let history: ReadonlyMap<string, RouteEncounterHistory> = new Map();
    history = deliverOnce(history, 'wiring-cargo-a');
    history = deliverOnce(history, 'wiring-cargo-b');
    expect(history.get(DELIVERY_ROUTE_ID)?.deliveriesCompleted).toBe(2);
  });

  /**
   * The end-to-end proof: drive enough REAL deliveries through the actual
   * `courierGuildEngine` reducer (not a direct `recordDelivery()` call) to
   * cross a whole danger tier on `wellTravelledDangerReductionPerDelivery`'s
   * real ruleset value, then feed the resulting history into the real
   * `generateEncounters` and show it fields measurably fewer outlaws than
   * the identical route with no delivery history - across enough
   * (day, seed) samples that one lucky roll can't carry it.
   *
   * This is what actually breaks if either half of the wiring is missing:
   *   - if the deliver action never calls `recordDelivery`, `history` stays
   *     empty/FRESH after the loop and `travelledOutlaws` ends up equal to
   *     `freshOutlaws` (see the "recordDelivery is a no-op" mutation below);
   *   - if `generateEncounters` reads `route.danger` instead of
   *     `effectiveDangerForRoute`, a non-empty history changes NOTHING it
   *     spawns and `travelledOutlaws` again ends up equal to `freshOutlaws`
   *     (see the "raw danger" mutation below).
   */
  it('a route worn down by many real courier-guild deliveries spawns measurably fewer outlaws than the same route with no delivery history', () => {
    const testRoute: RouteDef = { id: DELIVERY_ROUTE_ID, a: DELIVERY_ORIGIN_CITY, b: DELIVERY_DEST_CITY, lengthMiles: 600, danger: 4 };

    let history: ReadonlyMap<string, RouteEncounterHistory> = new Map();
    const DELIVERIES = 100; // 100 * 0.02/delivery (real ruleset) = 2.0 off a danger-4 route: a full, decisive tier drop
    for (let i = 0; i < DELIVERIES; i++) {
      history = deliverOnce(history, `wear-in-cargo-${i}`);
    }

    const wornIn = history.get(DELIVERY_ROUTE_ID);
    expect(wornIn?.deliveriesCompleted).toBe(DELIVERIES);

    let freshOutlaws = 0;
    let travelledOutlaws = 0;
    const SAMPLE_DAYS = 25;
    for (let day = 0; day < SAMPLE_DAYS; day++) {
      const seed = `wear-in-sample-seed-${day}`;
      freshOutlaws += generateEncounters(testRoute, day, seed, FRESH_ROUTE_HISTORY).filter((u) => u.faction === 'outlaw').length;
      travelledOutlaws += generateEncounters(testRoute, day, seed, wornIn as RouteEncounterHistory).filter((u) => u.faction === 'outlaw').length;
    }

    expect(travelledOutlaws).toBeLessThan(freshOutlaws);
  });
});
