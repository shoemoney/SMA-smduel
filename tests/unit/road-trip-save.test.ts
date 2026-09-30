// @vitest-environment happy-dom
/**
 * A road trip must survive save -> load, or the field is decoration.
 *
 * WHY THIS FILE EXISTS. `SaveGame` had no road-trip slot at all, which made a
 * ~107-minute leg an ATOMIC commitment: a player could not stop at mile 40 and
 * come back. `SaveGame.roadTrip` fixes that, and this file is the proof it does.
 *
 * The load-bearing assertion is the ROUND TRIP against a trip built by the REAL
 * sim — `beginRoadTrip` rolls real contacts, and real wrecks/hazards are made
 * with the real `createWreck`/`placeRoadHazard`. A hand-written fixture would
 * pass against a converter that drops fields, because the fixture would only
 * contain the fields it happened to think of. Iteration 92's save-schema bug
 * (`batteryDebt` missing from `vehicleStateSchema`) is the class this avoids:
 * the sim grew a field, the schema did not, and the suite stayed green.
 */
import { describe, expect, it } from 'vitest';

import { createRng } from '@/util/rng';
import { initialClock } from '@/sim/calendar';
import {
  beginRoadTrip,
  createWreck,
  placeRoadHazard,
  resolveRoute,
  stepRoadTrip,
  type RoadTripState,
} from '@/sim/road';
import { migrateSave, CURRENT_SCHEMA_VERSION } from '@/persist/migrate';
import type { DriverState, VehicleState } from '@/sim/types';
import { isSaveGame, describeShapeErrors } from '@/persist/schema';
import type { SaveGame } from '@/persist/save';

import { rehydrateRoadTrip, roadTripToSave } from '@/app';

const SEED = 'road-trip-save-test';

/**
 * The vehicle/driver shapes are COPIED from `tests/unit/save.test.ts`'s
 * known-good `makeVehicle`/`makeDriver` rather than written from memory — the
 * thirteenth instance of this log's fixture trap, and the first one written
 * from a TYPE rather than a test. A hand-built `VehicleState` omitted
 * `ownerId`, `speedMps`, `battery`, the three DP records, `controlStress`,
 * `controlLossTicks`, `statusEffects` and `destroyed`, and invented ruleset ids
 * (`suspension-standard`, `plant-small`) that do not exist; every save-shaped
 * assertion then failed on the FIXTURE while saying nothing about persistence.
 * The lesson keeps being the same one: read the neighbouring test file.
 */
function makeArmorRecord(v: number): Record<string, number> {
  return { FRONT: v, REAR: v, LEFT: v, RIGHT: v, UNDERBODY: v };
}

function makeVehicle(): VehicleState {
  return {
    id: 'v1',
    ownerId: 'driver-1',
    design: {
      name: 'Duster',
      bodyId: 'subcompact',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'small',
      tireId: 'standard',
      armor: makeArmorRecord(10),
      weapons: [{ weaponId: 'machinegun', facing: 'FRONT', ammo: 200 }],
    },
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 99,
    odometerMiles: 0,
    armorDP: makeArmorRecord(10),
    tireDP: [10, 10, 10, 10],
    plantDP: 10,
    weapons: [],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    // the fields `@/sim/driving` adds on the first tick (iteration 93) — present
    // so this fixture would also catch a regression that dropped them again
    batteryDebt: 0.25,
    controlLossSpinSign: 1,
  } as VehicleState;
}

function makeDriver(cityId: string): DriverState {
  return {
    name: 'Sable',
    skills: { driving: 12, marksmanship: 8, mechanic: 6 },
    naturalHealth: 5,
    bodyArmor: 3,
    prestige: 2,
    cash: 1500,
    cityId,
    cloneCityId: null,
    cloneSkills: null,
  } as DriverState;
}

function makeTrip(): RoadTripState {
  const resolved = resolveRoute('newyork', 'albany');
  return beginRoadTrip(resolved, makeVehicle(), initialClock(), createRng(SEED));
}

function makeGame(trip: RoadTripState): SaveGame {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rulesetVersion: 'classic-1',
    seed: 12345,
    currentDay: trip.clock.dayIndex,
    phase: trip.clock.phase,
    // mid-trip, so `location` is the ORIGIN city — the save is a fallback, not
    // the resume path, exactly as an interrupted run would leave it.
    location: trip.resolved.originCityId,
    driver: makeDriver(trip.resolved.originCityId),
    activeVehicleId: 'v1',
    vehicles: { 'v1': trip.vehicle },
    jobs: [],
    quests: [],
    world: null,
    rngState: createRng(SEED).stream('driver').serialize(),
    roadTrip: roadTripToSave(trip),
    lastSafeCitySnapshot: {
      day: trip.clock.dayIndex,
      phase: trip.clock.phase,
      location: trip.resolved.originCityId,
      driver: makeDriver(trip.resolved.originCityId),
      vehicles: { 'v1': trip.vehicle },
      activeVehicleId: 'v1',
    },
  };
}

describe('road trip persistence', () => {
  it('a trip built by the real sim round-trips through the real schema unchanged', () => {
    const trip = makeTrip();
    // drive it so progress, odometer and day-debt are all non-trivial
    const driven = stepRoadTrip(trip, { stick: { x: 0, y: 1 } }, 1 / 60, createRng(SEED), 0, 'normal').state;
    expect(driven.progressMiles).toBeGreaterThan(0);

    const game = makeGame(driven);

    // the schema must ACCEPT it — the iteration-93 failure mode
    const migrated = migrateSave(JSON.parse(JSON.stringify(game)));
    if (!isSaveGame(migrated)) {
      throw new Error(`save rejected: ${describeShapeErrors().join('; ')}`);
    }

    const back = rehydrateRoadTrip(
      (migrated as SaveGame).roadTrip!,
      (migrated as SaveGame).vehicles['v1']!,
      { dayIndex: (migrated as SaveGame).currentDay, phase: (migrated as SaveGame).phase },
    );

    // the route is RE-DERIVED, so compare identity of the resolved values rather
    // than object reference
    expect(back.resolved.route.id).toBe(driven.resolved.route.id);
    expect(back.resolved.originCityId).toBe(driven.resolved.originCityId);
    expect(back.resolved.destinationCityId).toBe(driven.resolved.destinationCityId);

    expect(back.progressMiles).toBeCloseTo(driven.progressMiles, 9);
    expect(back.dayDebt).toBeCloseTo(driven.dayDebt, 9);
    expect(back.routeHeadingRad).toBe(driven.routeHeadingRad);
    expect(back.startPosition).toEqual(driven.startPosition);
    expect(back.contacts).toEqual(driven.contacts);
  });

  it('carries wrecks and hazards with their payloads, and re-derives the deployable', () => {
    const base = makeTrip();
    // real wrecks/hazards from the real constructors, with real payloads
    const wreck = createWreck('wreck-1', { x: 12, y: -3 }, 0, false, [
      { weaponId: 'machinegun', ammo: 40 },
    ], [{ id: 'gear-1', weightLb: 6, spaces: 2 }]);
    const hazard = placeRoadHazard('hz-1', 'minedropper', { x: 30, y: 5 }, 0);
    const trip: RoadTripState = { ...base, wrecks: [wreck], hazards: [hazard] };

    const blob = roadTripToSave(trip);
    // the deployable is NOT stored — it is re-derived from the weapon id
    expect(JSON.stringify(blob.hazards[0])).not.toContain('MINE');
    expect(blob.hazards[0]!.weaponId).toBe('minedropper');

    const back = rehydrateRoadTrip(blob, trip.vehicle, trip.clock);
    expect(back.wrecks).toHaveLength(1);
    expect(back.wrecks[0]!.weapons).toEqual([{ weaponId: 'machinegun', ammo: 40 }]);
    expect(back.wrecks[0]!.gear).toEqual([{ id: 'gear-1', weightLb: 6, spaces: 2 }]);
    expect(back.wrecks[0]!.position).toEqual({ x: 12, y: -3 });
    expect(back.wrecks[0]!.createdDayIndex).toBe(0);
    expect(back.hazards).toHaveLength(1);
    // and the re-derived deployable is a REAL one, not a stub
    expect(back.hazards[0]!.deployable.kind).toBe('MINE');
  });

  it('a city save with no roadTrip is unaffected (the field is optional)', () => {
    const trip = makeTrip();
    const game = makeGame(trip);
    delete (game as { roadTrip?: unknown }).roadTrip;
    const migrated = migrateSave(JSON.parse(JSON.stringify(game)));
    expect(isSaveGame(migrated)).toBe(true);
  });

  it('a half-written trip blob is REJECTED rather than resumed into a broken axis', () => {
    const trip = makeTrip();
    const game = makeGame(trip);
    // drop the route axis the progress is measured along
    delete (game.roadTrip as { routeHeadingRad?: unknown }).routeHeadingRad;
    // `migrateSave` THROWS on a shape it cannot accept, which is stronger than
    // returning an invalid object for the caller to notice. The first draft of
    // this test asserted `isSaveGame(...) === false` and failed, because
    // `migrateSave` never returned — another reminder that asserting on the
    // wrong layer's contract fails for a reason unrelated to the feature.
    expect(() => migrateSave(JSON.parse(JSON.stringify(game)))).toThrow(/routeHeadingRad/);
  });

  it('rejects a hazard naming a weapon with no mine/spikes deployable', () => {
    const trip = makeTrip();
    const blob = roadTripToSave(trip);
    const tampered = { ...blob, hazards: [{ id: 'h', weaponId: 'machinegun', positionX: 0, positionY: 0, placedDayIndex: 0 }] };
    // the schema cannot know ruleset deployables, so the failure is at rehydrate
    // — which is the point: it throws at LOAD rather than making a hazard that
    // behaves differently from a freshly-placed one.
    expect(() => rehydrateRoadTrip(tampered, trip.vehicle, trip.clock)).toThrow();
  });

});
