/**
 * FLEET management: up to economy.json's `maxFleetSize` owned vehicles per
 * driver, each either the one ACTIVE car currently on the road or STORED in
 * a named city. `@/sim/services`'s `storeCar`/`retrieveCar` already move a
 * single vehicle between those two states for a given `Fleet`; this module
 * adds/removes whole vehicles from the roster and composes a full
 * active-vehicle SWITCH — garage the outgoing car, then retrieve the
 * incoming one — as one operation built on top of `retrieveCar`, plus the
 * fleet-side half of a clone revival and a salvage-yard sale (both of which
 * simply drop a vehicle out of the roster for good).
 */
import { economy } from '@/data/rulesets';
import { advanceDays, type Clock } from '@/sim/calendar';
import { retrieveCar, type Fleet, type FleetVehicle, type ServiceFailureReason } from '@/sim/services';
import type { DriverState } from '@/sim/types';

export type { Fleet, FleetVehicle } from '@/sim/services';
export { fleetHasRoom, fleetSize } from '@/sim/services';

export type FleetFailureReason = ServiceFailureReason | 'fleetFull' | 'duplicateVehicle';

export interface FleetMutationSuccess {
  ok: true;
  fleet: Fleet;
}

export type FleetMutationResult = FleetMutationSuccess | { ok: false; reason: FleetFailureReason };

export interface FleetServiceSuccess {
  ok: true;
  driver: DriverState;
  fleet: Fleet;
  clock: Clock;
  /**
   * Dollars actually charged for this switch — always `retrieveCar`'s price
   * alone. Garaging the outgoing car (below) is never priced through
   * `storeCar()` in a switch: economy.json's `storeCar` service carries a
   * `paidOnRetrieval` field documenting that the whole storage-cycle fee
   * already lives in `retrieveCar`'s price, so summing `storeCar`'s own
   * price in on top here — whatever it happens to be configured as — would
   * double-charge the fee the moment anyone sets it to a nonzero value.
   */
  cost: number;
}

export type FleetServiceResult = FleetServiceSuccess | { ok: false; reason: FleetFailureReason };

/** The one vehicle currently on the road, if any — `undefined` means the driver is between cars (just cloned, or sold/lost the active one and hasn't retrieved a replacement yet). */
export function activeVehicle(fleet: Fleet): FleetVehicle | undefined {
  return fleet.vehicles.find((entry) => !entry.stored);
}

/**
 * Adds a brand-new owned vehicle to the fleet — refuses a vehicle id
 * already present (a fleet is a SET, never a silent duplicate), refuses
 * beyond economy.json's `maxFleetSize`, and refuses making `entry` the
 * active car when one is already active (only one vehicle is ever active —
 * store or sell the current one first).
 */
export function addVehicle(fleet: Fleet, entry: FleetVehicle): FleetMutationResult {
  if (fleet.vehicles.some((existing) => existing.vehicle.id === entry.vehicle.id)) {
    return { ok: false, reason: 'duplicateVehicle' };
  }
  if (fleet.vehicles.length >= economy().maxFleetSize) {
    return { ok: false, reason: 'fleetFull' };
  }
  if (!entry.stored && activeVehicle(fleet) !== undefined) {
    return { ok: false, reason: 'invalidRequest' };
  }
  return { ok: true, fleet: { vehicles: [...fleet.vehicles, entry] } };
}

/**
 * Drops `vehicleId` out of the fleet entirely, wherever it is (active or
 * stored). Used for the two ways a vehicle leaves the roster for good:
 * `@/app`'s `reconcileFleetWithVehicle` calls this instead of reconciling a
 * vehicle back in whose own `destroyed` flag is true (the active car lost
 * for good in an arena/road forfeiture), and its `fleetAfterBuildingVisit`
 * calls this when a building panel hands back a null `ctx.vehicle`
 * (currently only `@/ui/buildings/salvage`'s 'sell-car'). Every OTHER
 * vehicle in the fleet — stored ones above all — is untouched, which is
 * what makes owning a spare (or a garage full of them) meaningful even
 * after the car you were driving is gone.
 */
export function removeVehicle(fleet: Fleet, vehicleId: string): FleetMutationResult {
  if (!fleet.vehicles.some((entry) => entry.vehicle.id === vehicleId)) {
    return { ok: false, reason: 'vehicleNotFound' };
  }
  return { ok: true, fleet: { vehicles: fleet.vehicles.filter((entry) => entry.vehicle.id !== vehicleId) } };
}

/**
 * Switches which vehicle is active: garages whatever is currently active (if
 * anything) at the driver's current city, then retrieves `targetVehicleId`
 * via `retrieveCar`, which only succeeds when that car is stored in the
 * driver's CURRENT city, so a target parked in a different city — or, just
 * as importantly, a target that isn't stored at all, such as the vehicle
 * already active — refuses with `notStoredHere` and nothing is charged or
 * mutated (a failure here never touches the `fleet`/`driver` the caller
 * already has: `retrieveCar` only ever returns new objects, and this
 * function returns before creating any of its own on the garaging leg
 * below).
 *
 * The pre-check above matters on its own, independent of `retrieveCar`'s
 * identical city guard: without it, garaging the outgoing car would run
 * BEFORE the target is validated, so switching to the vehicle you are
 * already driving (`target.stored` false) would garage it and then
 * immediately retrieve that same vehicle — a no-op switch that still
 * charges a real retrieval fee for nothing.
 *
 * Garaging the outgoing car is deliberately NOT a `storeCar()` call: that
 * would price it at `economy().services.storeCar.price`, and summing that
 * on top of `retrieveCar`'s price would double the documented storage-cycle
 * fee the moment `storeCar.price` is ever set to something other than 0 (see
 * `cost`'s own doc comment). `storeCar()`'s only OTHER behavior —
 * `vehicleNotFound` — can never fire here anyway, since `current` was just
 * derived from `activeVehicle(fleet)` and is therefore already known to be
 * the fleet's sole active entry, so the mutation below reproduces exactly
 * what `storeCar()` would otherwise do, minus its price.
 */
export function switchActiveVehicle(driver: DriverState, fleet: Fleet, clock: Clock, targetVehicleId: string): FleetServiceResult {
  const target = fleet.vehicles.find((entry) => entry.vehicle.id === targetVehicleId);
  if (target === undefined || !target.stored || target.cityId !== driver.cityId) {
    return { ok: false, reason: 'notStoredHere' };
  }

  const current = activeVehicle(fleet);

  let workingFleet = fleet;
  let workingClock = clock;

  if (current !== undefined) {
    const index = workingFleet.vehicles.findIndex((entry) => entry.vehicle.id === current.vehicle.id);
    const vehicles = workingFleet.vehicles.slice();
    vehicles[index] = { ...current, stored: true, cityId: driver.cityId };
    workingFleet = { vehicles };
    workingClock = advanceDays(workingClock, economy().services.storeCar.days);
  }

  const retrieved = retrieveCar(driver, workingFleet, workingClock, targetVehicleId);
  if (!retrieved.ok) return { ok: false, reason: retrieved.reason };

  return {
    ok: true,
    driver: retrieved.driver,
    fleet: retrieved.fleet,
    clock: retrieved.clock,
    cost: retrieved.cost,
  };
}
