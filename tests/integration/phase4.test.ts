/**
 * Phase 4 acceptance gate: a HEADLESS scripted run across MULTIPLE cities
 * that hits a real road encounter, fights it with the real combat pipeline,
 * searches the wreck it leaves behind, and stores/retrieves a second car
 * from a real multi-vehicle `@/sim/fleet` roster — driving only the real
 * exported APIs `@/app`'s own screens call (`@/app`'s road-combat systems,
 * `@/sim/road`, `@/sim/encounters`, `@/sim/salvage`, `@/sim/fleet`), never a
 * developer shortcut into the sim. No DOM, no renderer, no `@/ui/**` — this
 * proves the SIMULATION layer of the integrated city/road/fleet loop end to
 * end, the same relationship `tests/integration/phase3.test.ts` has to the
 * arena/courier loop and `arena-victory.test.ts` has to a single arena match.
 *
 * The script:
 *   1. Creates a driver and two legal, affordable cars (A active, B spare).
 *   2. Drives A from New York to Philadelphia (`ny-philadelphia`, danger 1) -
 *      a real `@/sim/encounters` roll for THIS (seed, route, day) fields a
 *      combat-capable hostile outlaw contact. The scripted player fights it
 *      with the exact same `makeArenaAISystem`/`makeArenaDrivingSystem`/
 *      `makeArenaWeaponsSystem`/`makeRoadDamageSystem` pipeline `@/app`'s own
 *      `showRoad` runs, wins, and the defeated contact leaves a real
 *      `@/sim/road` `RoadWreck` - searched via `@/sim/salvage`'s
 *      `searchWreck` before the trip ends.
 *   3. Stores car B at Philadelphia (`@/sim/fleet`'s `addVehicle`, stored).
 *   4. Drives A on to Harrisburg (`harrisburg-philadelphia`, danger 1) - a
 *      THIRD distinct city - then back to Philadelphia.
 *   5. Switches the active car back to B at Philadelphia
 *      (`@/sim/fleet`'s `switchActiveVehicle`) - a real fee charged, A
 *      garaged, B retrieved.
 *
 * Cash, day, and fleet state are asserted after every step, not just at the
 * end, so a regression anywhere in the chain fails at the step it broke
 * instead of a single end-of-test diff.
 */
import { describe, expect, it } from 'vitest';

import {
  armorDamageFraction,
  asEncounterUnit,
  cleanupSystem,
  contactIsCombatCapable,
  createRoadWreckFromDefeat,
  makeArenaAISystem,
  makeArenaDrivingSystem,
  makeArenaWeaponsSystem,
  makeRoadDamageSystem,
  opponentDriverState,
  projectilesSystem,
  reconcileFleetWithVehicle,
  roadOpponentAIPersonality,
  roadContactPlacement,
  roadOpponentVehicleId,
  deterministicJitter,
  vehicleStateFromConfirmedBuild,
  vehicleStateFromDesign,
  beginRoadTripWithEncounters,
  PLAYER_ID,
  type ArenaOpponentState,
} from '@/app';
import { drivingConfig, economy, getWeapon, skillsConfig } from '@/data/rulesets';
import { computeAlignmentInput } from '@/sim/ai';
import { initialClock, type Clock } from '@/sim/calendar';
import { computeBuild, type BuildDesign } from '@/sim/construct';
import { createDriver, getSkill } from '@/sim/driver';
import { dtSecondsFromTickRate, type InputFrame } from '@/sim/loop';
import {
  crossDestinationGate,
  resolveRoute,
  stepRoadTrip,
  willFire,
  type ResolvedRoute,
  type RoadTripState,
  type RoadWreck,
} from '@/sim/road';
import { FRESH_ROUTE_HISTORY, generateEncounters, type EncounterUnit } from '@/sim/encounters';
import { canSearchWreck, searchWreck } from '@/sim/salvage';
import { activeVehicle, addVehicle, fleetSize, switchActiveVehicle, type Fleet } from '@/sim/fleet';
import { createWorld, type World } from '@/sim/world';
import { createRng } from '@/util/rng';
import { makeArmorRecord, type DriverState, type SkillName, type VehicleDesign, type VehicleState } from '@/sim/types';

function evenSkillSplit(): Record<SkillName, number> {
  const cfg = skillsConfig();
  const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
  const remainder = cfg.startingSkillPool - base * cfg.skills.length;
  const skills = {} as Record<SkillName, number>;
  cfg.skills.forEach((name, index) => {
    skills[name] = base + (index === cfg.skills.length - 1 ? remainder : 0);
  });
  return skills;
}

function makeTestDriver(): DriverState {
  const result = createDriver('Phase4 Duelist', evenSkillSplit());
  if (!result.ok) throw new Error(`test fixture: expected a legal skill split, got "${result.reason}"`);
  return result.driver;
}

/** A cheap, legal, armed build: subcompact body + small plant + a machinegun + light armor - affordable twice over out of a padded test cash balance (see `richDriver` below), same fixture-building convention `phase3.test.ts`'s own `testDesign()` uses. */
function armedTestDesign(name: string): VehicleDesign {
  return {
    name,
    bodyId: 'compact',
    chassisId: 'standard',
    suspensionId: 'light',
    plantId: 'super',
    tireId: 'standard',
    armor: makeArmorRecord(2),
    weapons: [{ weaponId: 'rocketlauncher', facing: 'FRONT', ammo: 20 }],
  };
}

const ROAD_DT = dtSecondsFromTickRate(drivingConfig().tickRateHz);

/**
 * One combat-overlay tick, mirroring `@/app`'s own `showRoad` orchestration
 * exactly (spawn/despawn engaged contacts, run the real systems, merge
 * damage back onto the authoritative vehicle, wreck a defeated opponent) -
 * duplicated here rather than exported wholesale because `showRoad` closes
 * over live DOM/canvas state; every FUNCTION this calls is the identical
 * production one.
 */
interface CombatOverlay {
  readonly world: World;
  readonly opponentVehicles: Map<string, VehicleState>;
  readonly opponents: Map<string, ArenaOpponentState>;
  readonly contactByVehicleId: Map<string, EncounterUnit>;
  readonly aiInputs: Map<string, InputFrame>;
  readonly projectileTargets: Map<string, string>;
  readonly spawnCounter: { current: number };
  readonly resolvedContactIds: Set<string>;
}

function newCombatOverlay(trip: RoadTripState, sessionSeed: string): CombatOverlay {
  const world = createWorld({ rngSeed: 0, arena: { id: trip.resolved.route.id, kind: 'route' }, entities: { vehicles: [trip.vehicle] } });
  world.rngState = createRng(sessionSeed).stream(`road-combat|${trip.resolved.route.id}`).serialize();
  return {
    world,
    opponentVehicles: new Map(),
    opponents: new Map(),
    contactByVehicleId: new Map(),
    aiInputs: new Map(),
    projectileTargets: new Map(),
    spawnCounter: { current: 0 },
    resolvedContactIds: new Set(),
  };
}

/**
 * Engages and disengages the trip's contacts against `trip.progressMiles`.
 *
 * WHERE a contact goes and which way it faces is NOT decided here — that is
 * `roadContactPlacement`'s job, the same function `showRoad`'s own
 * `updateEngagement` calls. This file used to restate the placement
 * arithmetic, and its copy had drifted from production in two independent
 * ways: a lateral span of `6` where production uses 12, and an offset applied
 * along `perp.y` alone where production applies it along the whole
 * perpendicular. So the only test covering road encounters was measuring a
 * geometry the game does not run — it reported contacts sitting "6.0m off the
 * line" while production places them up to 12m off, and it could not have
 * noticed. Reading the owner instead means `findWinnableEncounter` now asks
 * the real question of the real geometry.
 */
function updateEngagement(overlay: CombatOverlay, trip: RoadTripState): void {
  const metersPerMile = drivingConfig().metersPerMile;
  const range = drivingConfig().radar.visualRangeM;

  for (const contact of trip.contacts) {
    const unit = asEncounterUnit(contact);
    if (unit === undefined || overlay.resolvedContactIds.has(unit.id)) continue;
    const distanceM = Math.abs(unit.routeMiles - trip.progressMiles) * metersPerMile;
    const vehicleId = roadOpponentVehicleId(unit.id);
    const engaged = willFire(unit) && contactIsCombatCapable(unit) && distanceM <= range;

    if (engaged && !overlay.opponentVehicles.has(vehicleId)) {
      const { position, headingRad } = roadContactPlacement(unit, trip);
      const vehicle = vehicleStateFromDesign(unit.design, vehicleId, vehicleId, position, headingRad);
      overlay.opponentVehicles.set(vehicleId, vehicle);
      overlay.opponents.set(vehicleId, {
        archetypeId: unit.archetypeId,
        personality: roadOpponentAIPersonality(unit),
        driver: opponentDriverState(unit.skill),
        seed: deterministicJitter(`${unit.id}:seed`, 2 ** 30),
      });
      overlay.contactByVehicleId.set(vehicleId, unit);
    } else if (!engaged && overlay.opponentVehicles.has(vehicleId)) {
      overlay.opponentVehicles.delete(vehicleId);
      overlay.opponents.delete(vehicleId);
      overlay.contactByVehicleId.delete(vehicleId);
    }
  }
}

interface CombatStepResult {
  readonly trip: RoadTripState;
  readonly driver: DriverState;
  readonly newWrecks: readonly RoadWreck[];
}

function stepCombat(overlay: CombatOverlay, trip: RoadTripState, driver: DriverState, playerInput: InputFrame): CombatStepResult {
  overlay.world.tick += 1;
  overlay.world.entities.vehicles = [trip.vehicle, ...overlay.opponentVehicles.values()];
  const driverRef = { current: driver };

  makeArenaAISystem(trip.vehicle.id, overlay.opponents, overlay.aiInputs)(overlay.world, playerInput, ROAD_DT);
  makeArenaDrivingSystem(driverRef, trip.vehicle.id, overlay.opponents, overlay.aiInputs)(overlay.world, playerInput, ROAD_DT);
  makeArenaWeaponsSystem(driverRef, trip.vehicle.id, overlay.opponents, overlay.aiInputs, overlay.projectileTargets, overlay.spawnCounter, () => {})(
    overlay.world,
    playerInput,
    ROAD_DT,
  );
  projectilesSystem(overlay.world, playerInput, ROAD_DT);
  makeRoadDamageSystem(trip.vehicle.id, driverRef, overlay.opponents, overlay.projectileTargets)(overlay.world, playerInput, ROAD_DT);
  cleanupSystem(overlay.world, playerInput, ROAD_DT);

  const playerAfter = overlay.world.entities.vehicles.find((v) => v.id === trip.vehicle.id);
  let nextTrip = trip;
  if (playerAfter !== undefined) {
    nextTrip = {
      ...trip,
      vehicle: {
        ...trip.vehicle,
        armorDP: playerAfter.armorDP,
        tireDP: playerAfter.tireDP,
        plantDP: playerAfter.plantDP,
        weapons: playerAfter.weapons,
        destroyed: playerAfter.destroyed,
      },
    };
  }

  const newWrecks: RoadWreck[] = [];
  for (const [vehicleId, unit] of [...overlay.contactByVehicleId.entries()]) {
    if (overlay.opponents.has(vehicleId)) {
      const updated = overlay.world.entities.vehicles.find((v) => v.id === vehicleId);
      if (updated !== undefined) overlay.opponentVehicles.set(vehicleId, updated);
      continue;
    }
    const deadVehicle = overlay.world.entities.vehicles.find((v) => v.id === vehicleId) ?? overlay.opponentVehicles.get(vehicleId);
    overlay.opponentVehicles.delete(vehicleId);
    overlay.contactByVehicleId.delete(vehicleId);
    overlay.resolvedContactIds.add(unit.id);
    if (deadVehicle !== undefined) newWrecks.push(createRoadWreckFromDefeat(unit, deadVehicle.position, trip.clock.dayIndex));
  }

  return { trip: nextTrip, driver: driverRef.current, newWrecks };
}

/**
 * Steers at + fires on the nearest live opponent (same `computeAlignmentInput`
 * `arena-victory.test.ts`'s own scripted policy uses); drives straight down
 * the route's own heading axis (`{1,0}` - every fixture vehicle here starts
 * at `headingRad: 0`, so `@/sim/road`'s `routeHeadingRad` IS `+X`, per
 * `@/sim/driving`'s own `forward = {cos(h), sin(h)}` convention) when
 * nothing is engaged.
 */
function scriptedRoadInput(trip: RoadTripState, overlay: CombatOverlay): InputFrame {
  const live = [...overlay.opponentVehicles.values()].filter((v) => !v.destroyed);
  if (live.length === 0) return { moveX: 1, moveY: 0, fire: false, weaponSlot: 0 };
  const nearest = live.reduce((best, v) => {
    const d = Math.hypot(v.position.x - trip.vehicle.position.x, v.position.y - trip.vehicle.position.y);
    const bestD = Math.hypot(best.position.x - trip.vehicle.position.x, best.position.y - trip.vehicle.position.y);
    return d < bestD ? v : best;
  });
  const distanceM = Math.hypot(nearest.position.x - trip.vehicle.position.x, nearest.position.y - trip.vehicle.position.y);
  const bearingRad = Math.atan2(nearest.position.y - trip.vehicle.position.y, nearest.position.x - trip.vehicle.position.x);
  const ownWeapon = trip.vehicle.weapons[0];
  const ownRangeM = ownWeapon !== undefined ? getWeapon(ownWeapon.weaponId).rangeM : 0;
  // Outside its own weapon's range, `@/sim/ai`'s own `engageWeaponNode` (the
  // node the OPPONENT itself runs) steers to bring a FRONT mount to bear
  // relative to the CURRENT bearing, which orbits broadside rather than
  // closing distance - fine for arena's already-close spawn ring, not for a
  // road contact spawned near `radar.visualRangeM`. `pursueNode`'s own
  // "close the distance" heading (`{cos(bearing), sin(bearing)}` - the
  // vehicle's OWN forward axis, not the FRONT-mount-relative align) is the
  // real node this codebase already uses for exactly that situation, reused
  // here for the player's own scripted approach.
  if (distanceM > ownRangeM) {
    return { moveX: Math.cos(bearingRad), moveY: Math.sin(bearingRad), fire: false, weaponSlot: 0 };
  }
  const { moveX, moveY } = computeAlignmentInput(bearingRad, 'FRONT');
  return { moveX, moveY, fire: true, weaponSlot: 0 };
}

interface DriveResult {
  trip: RoadTripState;
  driver: DriverState;
  arrived: boolean;
  wrecks: RoadWreck[];
  opponentsDefeated: number;
}

/** Drives `trip` to completion (or `maxTicks`, whichever first) through the real road + combat pipeline. */
/**
 * Real real-time driving at `driving.json`'s own 60 Hz tick rate would take
 * many tens of thousands of ticks to cover a 95-mile route (exactly what a
 * human player's browser tab does over real wall-clock minutes) - far too
 * slow to run as a test. Cruising ticks use this much coarser `dtSeconds`
 * instead (`stepRoadTrip`/`stepDriving` take whatever `dtSeconds` a caller
 * hands them; nothing in either function assumes a fixed tick rate), and
 * every tick where a real opponent is actually engaged still runs at the
 * genuine `ROAD_DT` so combat itself is exactly as fine-grained as
 * production.
 */
const CRUISE_DT = 2;

function driveToArrival(trip0: RoadTripState, driver0: DriverState, rng: ReturnType<typeof createRng>, sessionSeed: string, maxTicks: number): DriveResult {
  const overlay = newCombatOverlay(trip0, sessionSeed);
  let trip = trip0;
  let driver = driver0;
  let wrecks: RoadWreck[] = [];
  const drivingSkill = getSkill(driver, 'driving');

  for (let tick = 0; tick < maxTicks; tick++) {
    // Engagement is checked against THIS tick's (pre-movement) progress, so
    // a contact within `driving.json`'s own `radar.visualRangeM` spawns and
    // switches this very tick's movement onto the fine-grained combat dt,
    // rather than a coarse cruise step sailing straight past it.
    updateEngagement(overlay, trip);
    const engaged = overlay.opponentVehicles.size > 0;
    const moveDt = engaged ? ROAD_DT : CRUISE_DT;

    const input = scriptedRoadInput(trip, overlay);
    const contactDamage = new Map<string, number>();
    for (const [vehicleId, unit] of overlay.contactByVehicleId) {
      const vehicle = overlay.opponentVehicles.get(vehicleId);
      if (vehicle !== undefined) contactDamage.set(unit.id, armorDamageFraction(vehicle));
    }
    const stepped = stepRoadTrip(trip, { stick: { x: input.moveX, y: input.moveY } }, moveDt, rng, drivingSkill, 'normal', contactDamage);
    trip = stepped.state;
    const combatResult = stepCombat(overlay, trip, driver, input);
    trip = combatResult.trip;
    driver = combatResult.driver;
    if (combatResult.newWrecks.length > 0) wrecks = [...wrecks, ...combatResult.newWrecks];

    if (trip.vehicle.destroyed) return { trip, driver, arrived: false, wrecks, opponentsDefeated: wrecks.length };
    if (stepped.arrived) return { trip, driver, arrived: true, wrecks, opponentsDefeated: wrecks.length };
  }
  return { trip, driver, arrived: false, wrecks, opponentsDefeated: wrecks.length };
}

/**
 * Deterministically finds a (seed) for which `ny-philadelphia` on day 0
 * fields EXACTLY one combat-capable hostile contact, AND the scripted
 * player policy defeats it (through the real, unmodified pipeline) within
 * a bounded tick budget — the same "search the real pipeline for a seed
 * that lets the player win" approach `arena-victory.test.ts`'s own header
 * comment documents, run inline (and so reproducibly re-derivable) instead
 * of a magic constant.
 */
function findWinnableEncounter(
  route: ReturnType<typeof resolveRoute>['route'],
  vehicleDesign: VehicleDesign,
): { seed: string; contactCount: number } {
  for (let i = 0; i < 400; i++) {
    const seed = `phase4-encounter-${i}`;
    const units = generateEncounters(route, 0, seed, FRESH_ROUTE_HISTORY);
    const hostiles = units.filter((u) => willFire(u) && contactIsCombatCapable(u));
    if (hostiles.length !== 1) continue;

    const driver = makeTestDriver();
    const vehicle = vehicleStateFromConfirmedBuild(
      { design: vehicleDesign, costTotal: 0, daysCost: 0 },
      PLAYER_ID,
      'veh-search',
    );
    const resolved: ResolvedRoute = { route, originCityId: 'newyork', destinationCityId: 'philadelphia' };
    const trip = beginRoadTripWithEncounters(resolved, vehicle, initialClock(), seed, FRESH_ROUTE_HISTORY);
    const rng = createRng(seed).stream('driver');
    const result = driveToArrival(trip, driver, rng, seed, 6000);
    if (result.arrived && result.opponentsDefeated === 1 && !result.trip.vehicle.destroyed) {
      return { seed, contactCount: hostiles.length };
    }
  }
  throw new Error('test fixture: no seed in the search space produced a single, winnable road encounter on ny-philadelphia day 0');
}

/**
 * A seed for which `route` on `day` fields NO combat-capable hostile
 * contact at all — used for the two Harrisburg legs, which exist to prove
 * multi-hop travel and a fleet roster survive the trip, not to fight a
 * second encounter (leg 1 already proves the combat pipeline works; a
 * SECOND uncontrolled fight per leg would just make this test slower and
 * flakier without covering anything new).
 */
function findQuietSeed(route: ReturnType<typeof resolveRoute>['route'], day: number, prefix: string): string {
  for (let i = 0; i < 400; i++) {
    const seed = `${prefix}-${i}`;
    const units = generateEncounters(route, day, seed, FRESH_ROUTE_HISTORY);
    if (units.every((u) => !willFire(u) || !contactIsCombatCapable(u))) return seed;
  }
  throw new Error(`test fixture: no quiet seed found for route "${route.id}" on day ${day}`);
}

describe('phase 4: multi-city travel, a real road encounter fought and searched, fleet store/switch', () => {
  it('travels newyork -> philadelphia -> harrisburg -> philadelphia, fights and salvages a real encounter, and stores/switches a second car', () => {
    const routeNyPhl = resolveRoute('newyork', 'philadelphia');
    const routePhlHbg = resolveRoute('philadelphia', 'harrisburg');
    const routeHbgPhl = resolveRoute('harrisburg', 'philadelphia');

    const designA = armedTestDesign('Phase4 Rig A');
    const designB = armedTestDesign('Phase4 Rig B');
    const { seed } = findWinnableEncounter(routeNyPhl.route, designA);

    // -----------------------------------------------------------------
    // Step 0: driver + two owned cars (A active at New York, B not yet built)
    // -----------------------------------------------------------------
    const driver0 = makeTestDriver();
    const metricsA = computeBuild(designA as BuildDesign);
    expect(metricsA.legal).toBe(true);
    const richDriver: DriverState = { ...driver0, cash: driver0.cash + 20000 };
    const driver1: DriverState = { ...richDriver, cash: richDriver.cash - metricsA.costTotal };
    const vehicleA = vehicleStateFromConfirmedBuild({ design: designA, costTotal: metricsA.costTotal, daysCost: 0 }, PLAYER_ID, 'veh-a');

    let fleet: Fleet = { vehicles: [{ vehicle: vehicleA, stored: false, cityId: 'newyork' }] };
    expect(fleetSize(fleet)).toBe(1);

    let clock: Clock = initialClock();
    let driver = driver1;
    let cityId = 'newyork';

    // -----------------------------------------------------------------
    // Step 1: New York -> Philadelphia, real encounter, real fight, real wreck.
    // -----------------------------------------------------------------
    const trip1 = beginRoadTripWithEncounters(routeNyPhl, vehicleA, clock, seed, FRESH_ROUTE_HISTORY);
    const rng1 = createRng(seed).stream('driver');
    const leg1 = driveToArrival(trip1, driver, rng1, seed, 6000);
    expect(leg1.arrived).toBe(true);
    expect(leg1.trip.vehicle.destroyed).toBe(false);
    expect(leg1.opponentsDefeated).toBe(1);
    expect(leg1.wrecks.length).toBe(1);

    const crossing1 = crossDestinationGate(leg1.trip);
    expect(crossing1).not.toBeNull();
    if (crossing1 === null) throw new Error('unreachable');
    cityId = crossing1.cityId;
    clock = leg1.trip.clock;
    driver = leg1.driver;
    expect(cityId).toBe('philadelphia');
    fleet = reconcileFleetWithVehicle(fleet, crossing1.vehicle, false, cityId);

    // Search the wreck the fight left behind - real @/sim/salvage roll,
    // never a hand-set cargo/ammo grant.
    const wreck = leg1.wrecks[0];
    if (wreck === undefined) throw new Error('unreachable');
    expect(canSearchWreck(wreck, clock.dayIndex)).toBe(true);
    const searchRng = createRng(seed).stream('salvage');
    const searchResult = searchWreck(crossing1.vehicle, driver, wreck, clock.dayIndex, searchRng);
    expect(searchResult.ok).toBe(true);
    if (!searchResult.ok) throw new Error('unreachable');
    expect(searchResult.wreck.searched).toBe(true);
    // The one roll is spent - re-searching the same (already-searched) wreck refuses.
    const rerollResult = searchWreck(searchResult.vehicle, driver, searchResult.wreck, clock.dayIndex, searchRng);
    expect(rerollResult).toEqual({ ok: false, reason: 'alreadySearched' });
    fleet = reconcileFleetWithVehicle(fleet, searchResult.vehicle, false, cityId);

    // -----------------------------------------------------------------
    // Step 2: build and store a second car (B) at Philadelphia.
    // -----------------------------------------------------------------
    const metricsB = computeBuild(designB as BuildDesign);
    expect(metricsB.legal).toBe(true);
    const cashBeforeB = driver.cash;
    driver = { ...driver, cash: driver.cash - metricsB.costTotal };
    expect(driver.cash).toBe(cashBeforeB - metricsB.costTotal);
    const vehicleB = vehicleStateFromConfirmedBuild({ design: designB, costTotal: metricsB.costTotal, daysCost: 0 }, PLAYER_ID, 'veh-b');
    const addResult = addVehicle(fleet, { vehicle: vehicleB, stored: true, cityId: 'philadelphia' });
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) throw new Error('unreachable');
    fleet = addResult.fleet;
    expect(fleetSize(fleet)).toBe(2);
    const activeAfterStore = activeVehicle(fleet);
    expect(activeAfterStore?.vehicle.id).toBe('veh-a');

    // -----------------------------------------------------------------
    // Step 3: Philadelphia -> Harrisburg (a THIRD distinct city), no
    // encounter required here - just proving multi-hop travel keeps working
    // with a live fleet roster carried along.
    // -----------------------------------------------------------------
    const activeEntry1 = activeVehicle(fleet);
    if (activeEntry1 === undefined) throw new Error('unreachable');
    const dayBeforeLeg2 = clock.dayIndex;
    const seedLeg2 = findQuietSeed(routePhlHbg.route, dayBeforeLeg2, 'phase4-quiet-leg2');
    const trip2 = beginRoadTripWithEncounters(routePhlHbg, { ...activeEntry1.vehicle, position: { x: 0, y: 0 }, headingRad: 0 }, clock, seedLeg2, FRESH_ROUTE_HISTORY);
    const rng2 = createRng(seedLeg2).stream('driver');
    const leg2 = driveToArrival(trip2, driver, rng2, seedLeg2, 6000);
    expect(leg2.arrived).toBe(true);
    clock = leg2.trip.clock;
    const crossing2 = crossDestinationGate(leg2.trip);
    if (crossing2 === null) throw new Error('unreachable');
    driver = { ...leg2.driver, cityId: crossing2.cityId };
    expect(clock.dayIndex).toBeGreaterThanOrEqual(dayBeforeLeg2);
    cityId = crossing2.cityId;
    expect(cityId).toBe('harrisburg');
    fleet = reconcileFleetWithVehicle(fleet, crossing2.vehicle, false, cityId);

    // -----------------------------------------------------------------
    // Step 4: Harrisburg -> Philadelphia (back), then switch active cars.
    // -----------------------------------------------------------------
    const activeEntry2 = activeVehicle(fleet);
    if (activeEntry2 === undefined) throw new Error('unreachable');
    const seedLeg3 = findQuietSeed(routeHbgPhl.route, clock.dayIndex, 'phase4-quiet-leg3');
    const trip3 = beginRoadTripWithEncounters(routeHbgPhl, { ...activeEntry2.vehicle, position: { x: 0, y: 0 }, headingRad: 0 }, clock, seedLeg3, FRESH_ROUTE_HISTORY);
    const rng3 = createRng(seedLeg3).stream('driver');
    const leg3 = driveToArrival(trip3, driver, rng3, seedLeg3, 6000);
    expect(leg3.arrived).toBe(true);
    clock = leg3.trip.clock;
    const crossing3 = crossDestinationGate(leg3.trip);
    if (crossing3 === null) throw new Error('unreachable');
    driver = { ...leg3.driver, cityId: crossing3.cityId };
    cityId = crossing3.cityId;
    expect(cityId).toBe('philadelphia');
    fleet = reconcileFleetWithVehicle(fleet, crossing3.vehicle, false, cityId);

    const cashBeforeSwitch = driver.cash;
    const dayBeforeSwitch = clock.dayIndex;
    const switchResult = switchActiveVehicle(driver, fleet, clock, 'veh-b');
    expect(switchResult.ok).toBe(true);
    if (!switchResult.ok) throw new Error('unreachable');
    driver = switchResult.driver;
    clock = switchResult.clock;
    fleet = switchResult.fleet;

    expect(switchResult.cost).toBe(economy().services.retrieveCar.price);
    expect(driver.cash).toBe(cashBeforeSwitch - economy().services.retrieveCar.price);
    expect(clock.dayIndex).toBe(dayBeforeSwitch + economy().services.storeCar.days + economy().services.retrieveCar.days);

    const finalActive = activeVehicle(fleet);
    expect(finalActive?.vehicle.id).toBe('veh-b');
    const garagedA = fleet.vehicles.find((entry) => entry.vehicle.id === 'veh-a');
    expect(garagedA?.stored).toBe(true);
    expect(garagedA?.cityId).toBe('philadelphia');
    expect(fleetSize(fleet)).toBe(2);
  });
});
