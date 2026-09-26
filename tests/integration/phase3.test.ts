/**
 * Phase 3 acceptance gate: a HEADLESS scripted run through the whole
 * driver -> arena -> repair -> courier -> road -> delivery loop, driving
 * only the real exported sim APIs (`@/sim/arena`, `@/sim/services`,
 * `@/sim/courier`, `@/sim/road`, `@/sim/damage`, `@/sim/driving`,
 * `@/sim/calendar`) — the exact functions `@/app`'s screens and
 * `@/ui/buildings/*` call, never a developer/cheat shortcut. No DOM, no
 * renderer, no `@/ui/**` — this proves the SIMULATION layer's economic loop
 * end to end; `tests/integration/boot.test.ts` already proves the DOM-facing
 * `@/app` screens wire the same functions correctly.
 *
 * The script:
 *   1. Creates a driver and buys a legal, affordable car (division-5 cap).
 *   2. Enters and wins the division-5 arena event -> cash + prestige earned.
 *   3. Takes real combat damage (via `@/sim/damage`'s own penetration
 *      resolver, not a direct field mutation) and repairs it at the garage.
 *   4. Accepts a courier job that fits the car's real remaining capacity.
 *   5. Drives the real road-trip simulation (`@/sim/road`, driven through
 *      `@/sim/driving`'s `stepDriving` exactly as the arena/road screens do)
 *      to the destination city.
 *   6. Delivers the cargo on time and is paid.
 *
 * Cash, prestige, calendar day, and cargo state are asserted after every
 * step, not just at the end, so a regression anywhere in the chain fails at
 * the step it broke instead of a single end-of-test diff.
 */
import { describe, expect, it } from 'vitest';

import { PLAYER_ID, vehicleStateFromConfirmedBuild } from '@/app';
import {
  allOpponentsDefeated,
  beginArenaMatch,
  getArenaEvent,
  recordOpponentDefeated,
  resolveArenaExit,
  type ArenaMatchState,
} from '@/sim/arena';
import { advanceDays, initialClock, type Clock } from '@/sim/calendar';
import { computeBuild, type BuildDesign } from '@/sim/construct';
import { accept, deliver, generateOffers, projectOffer, type AcceptedJob, type CourierOffer } from '@/sim/courier';
import { applyPenetratingDamage } from '@/sim/damage';
import { createDriver, getSkill } from '@/sim/driver';
import type { DriveInput } from '@/sim/driving';
import {
  beginRoadTrip,
  crossDestinationGate,
  hasReachedDestination,
  resolveRoute,
  stepRoadTrip,
  type RoadTripState,
} from '@/sim/road';
import { repair } from '@/sim/services';
import { repairCost } from '@/sim/economy';
import { economy, getBody, skillsConfig } from '@/data/rulesets';
import { makeArmorRecord, type DriverState, type SkillName, type VehicleDesign } from '@/sim/types';
import { createRng } from '@/util/rng';

const SEED = 'phase3-integration';

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
  const result = createDriver('Phase3 Duelist', evenSkillSplit());
  if (!result.ok) throw new Error(`test fixture: expected a legal skill split, got "${result.reason}"`);
  return result.driver;
}

/**
 * A legal, affordable, division-5-eligible build with real armor and real
 * cargo headroom: `compact` body (cheap, 10 spaces) + `medium` plant (power
 * exceeds this weight, so it clears the 15 mph/s acceleration tier) + 5
 * points of armor on every facing (enough to survive a real hit AND to make
 * `INSUFFICIENT_VEHICLE_THREAT` a non-issue on a danger>0 route).
 */
function testDesign(): VehicleDesign {
  return {
    name: 'Phase3 Rig',
    bodyId: 'compact',
    chassisId: 'standard',
    suspensionId: 'light',
    plantId: 'medium',
    tireId: 'standard',
    armor: makeArmorRecord(5),
    weapons: [],
  };
}

describe('phase 3: arena win -> repair -> courier -> road -> delivery, headless end to end', () => {
  it('earns money in an arena, repairs, accepts a courier job, drives the route, delivers on time, and is paid', () => {
    // -------------------------------------------------------------------
    // Step 0: driver + car
    // -------------------------------------------------------------------
    const driver0 = makeTestDriver();
    expect(driver0.cash).toBe(economy().startingCash);
    expect(driver0.prestige).toBe(skillsConfig().driver.prestigeFloor);

    const design = testDesign();
    const buildDesign: BuildDesign = design;
    const metrics = computeBuild(buildDesign);
    expect(metrics.legal).toBe(true);
    expect(metrics.costTotal).toBeLessThanOrEqual(driver0.cash);

    const confirmed = { design, costTotal: metrics.costTotal, daysCost: economy().timeCostDays.buildCar };
    const driver1: DriverState = { ...driver0, cash: driver0.cash - confirmed.costTotal };
    const vehicle0 = vehicleStateFromConfirmedBuild(confirmed, PLAYER_ID);
    expect(vehicle0.design.bodyId).toBe('compact');
    expect(vehicle0.armorDP.FRONT).toBe(5);
    expect(vehicle0.cargo).toEqual([]);

    let clock: Clock = initialClock();
    expect(clock.dayIndex).toBe(0);

    // -------------------------------------------------------------------
    // Step 1: win the division-5 arena event - real money and prestige.
    // -------------------------------------------------------------------
    const eventId = 'division-5' as const;
    const matchResult = beginArenaMatch(driver1, { design: vehicle0.design, destroyed: false }, eventId);
    expect(matchResult.ok).toBe(true);
    if (!matchResult.ok) throw new Error('unreachable');
    // division-5 is a value-cap event, not a cost-gated one - no entry fee.
    expect(matchResult.driver.cash).toBe(driver1.cash);

    let matchState: ArenaMatchState = matchResult.state;
    expect(matchState.opponentsTotal).toBe(getArenaEvent(eventId).opponentCount);
    for (let i = 0; i < matchState.opponentsTotal; i++) {
      matchState = recordOpponentDefeated(matchState);
    }
    expect(allOpponentsDefeated(matchState)).toBe(true);

    const resolution = resolveArenaExit(matchState, matchResult.driver, 'UNDER_POWER');
    expect(resolution.outcome).toBe('VICTORY');
    expect(resolution.cashAwarded).toBe(getArenaEvent(eventId).cashReward);
    expect(resolution.cashAwarded).toBeGreaterThan(0);
    expect(resolution.prestigeDelta).toBeGreaterThan(0);

    const driver2 = resolution.driver;
    expect(driver2.cash).toBe(matchResult.driver.cash + resolution.cashAwarded);
    expect(driver2.prestige).toBe(matchResult.driver.prestige + resolution.prestigeDelta);
    expect(getSkill(driver2, 'driving')).toBeGreaterThanOrEqual(getSkill(driver1, 'driving'));

    clock = advanceDays(clock, resolution.daysConsumed);
    expect(clock.dayIndex).toBe(resolution.daysConsumed);

    // -------------------------------------------------------------------
    // Step 2: take a real hit (via the real penetration resolver, not a
    // hand-set field) and repair it at the garage.
    // -------------------------------------------------------------------
    const damageRng = createRng(SEED).stream('combat-damage');
    const hit = applyPenetratingDamage(vehicle0, driver2, 'FRONT', 3, damageRng);
    const damagedVehicle = hit.vehicle;
    expect(damagedVehicle.armorDP.FRONT).toBe(vehicle0.armorDP.FRONT - 3);
    expect(hit.report.armorAbsorbed).toBe(3);
    // The hit was fully absorbed by armor - the driver never took damage.
    expect(hit.driver.naturalHealth).toBe(driver2.naturalHealth);

    const missingArmor = design.armor.FRONT - damagedVehicle.armorDP.FRONT;
    const expectedRepairCost = repairCost({
      kind: 'armor',
      costPerPoint: getBody(design.bodyId).armorCostPerPoint,
      pointsToRepair: missingArmor,
    });
    const repairResult = repair(driver2, damagedVehicle, clock, [{ kind: 'armor', facing: 'FRONT', points: missingArmor }]);
    expect(repairResult.ok).toBe(true);
    if (!repairResult.ok) throw new Error('unreachable');
    expect(repairResult.cost).toBe(expectedRepairCost);
    expect(repairResult.driver.cash).toBe(driver2.cash - expectedRepairCost);
    expect(repairResult.vehicle.armorDP.FRONT).toBe(design.armor.FRONT);

    const driver3 = repairResult.driver;
    const vehicle1 = repairResult.vehicle;
    clock = repairResult.clock;
    expect(clock.dayIndex).toBe(resolution.daysConsumed + economy().timeCostDays.repairCar);

    // -------------------------------------------------------------------
    // Step 3: accept a courier job that actually fits the repaired car.
    // -------------------------------------------------------------------
    const offers = generateOffers(driver3.cityId, clock.dayIndex, SEED, driver3);
    expect(offers.length).toBe(3);
    const fittingOffer: CourierOffer | undefined = offers.find((offer) => projectOffer(offer, vehicle1).fits);
    expect(fittingOffer).toBeDefined();
    if (fittingOffer === undefined) throw new Error('unreachable');

    const acceptResult = accept([fittingOffer], driver3, vehicle1, clock);
    expect(acceptResult.attempts).toEqual([{ offer: fittingOffer, accepted: true, reason: null }]);
    expect(acceptResult.acceptedJobs.length).toBe(1);
    const job = acceptResult.acceptedJobs[0] as AcceptedJob;
    expect(job.status).toBe('ACTIVE');

    const vehicle2 = acceptResult.vehicle;
    if (vehicle2 === null) throw new Error('unreachable');
    expect(vehicle2.cargo.some((item) => item.id === job.cargoId)).toBe(true);
    const dayIndexBeforeAccept = clock.dayIndex;
    clock = acceptResult.clock;
    // acceptCourierWork is a single-day action, charged via
    // `advanceForTimeCost` (@/sim/calendar): it closes out the REST of the
    // current day (NIGHT, same dayIndex) rather than advancing to a new one
    // - only a *second* full day would actually bump dayIndex.
    expect(clock.dayIndex).toBe(dayIndexBeforeAccept);
    expect(clock.phase).toBe('NIGHT');

    // -------------------------------------------------------------------
    // Step 4: drive the real road-trip simulation to the destination.
    // -------------------------------------------------------------------
    const resolvedRoute = resolveRoute(fittingOffer.originCityId, fittingOffer.destinationCityId);
    expect(resolvedRoute.route.id).toBe(fittingOffer.routeId);

    const roadRng = createRng(SEED).stream('road-trip');
    let trip: RoadTripState = beginRoadTrip(resolvedRoute, vehicle2, clock, roadRng);

    // Full throttle straight ahead - the vehicle's initial heading (0 rad)
    // IS the route's frozen forward axis, so no steering is needed.
    const forwardInput: DriveInput = { stick: { x: 1, y: 0 } };
    const drivingSkill = getSkill(driver3, 'driving');
    const stepDtSeconds = 15;
    const maxSteps = 20_000;
    let arrived = false;
    for (let i = 0; i < maxSteps && !arrived; i++) {
      const result = stepRoadTrip(trip, forwardInput, stepDtSeconds, roadRng, drivingSkill, 'normal');
      trip = result.state;
      arrived = result.arrived;
    }
    expect(arrived).toBe(true);
    expect(hasReachedDestination(trip)).toBe(true);

    const crossing = crossDestinationGate(trip);
    expect(crossing).not.toBeNull();
    if (crossing === null) throw new Error('unreachable');
    expect(crossing.cityId).toBe(fittingOffer.destinationCityId);

    const driver4: DriverState = { ...driver3, cityId: crossing.cityId };
    clock = trip.clock;

    // -------------------------------------------------------------------
    // Step 5: deliver at the exact destination facility, on time, and get paid.
    // -------------------------------------------------------------------
    expect(job.offer.dueDay).toBeGreaterThanOrEqual(clock.dayIndex);
    const deliverResult = deliver(job, driver4, crossing.vehicle, crossing.cityId, fittingOffer.destinationFacility, clock);
    expect(deliverResult.outcome).toBe('ON_TIME');
    expect(deliverResult.daysLate).toBe(0);
    expect(deliverResult.paidAmount).toBe(fittingOffer.pay);
    expect(deliverResult.driver.cash).toBe(driver4.cash + fittingOffer.pay);
    expect(deliverResult.driver.prestige).toBeGreaterThan(driver4.prestige);
    expect(deliverResult.vehicle.cargo.some((item) => item.id === job.cargoId)).toBe(false);
    expect(deliverResult.job.status).toBe('DELIVERED');
  });
});
