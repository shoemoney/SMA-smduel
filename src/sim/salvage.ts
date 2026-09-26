/**
 * WRECK SALVAGE: persistence + searching, glued into the single entry point
 * a caller actually drives.
 *
 * Persistence — whether a wreck is still worth stopping the car for — is
 * entirely `@/sim/road`'s `RoadWreck` + `isWreckPresent` (same-day return
 * finds it, overnight strip removes it from the world's wreck list). This
 * module folds that same check into `searchWreck` itself (not just the
 * advisory `canSearchWreck`), so a caller cannot mutate a wreck that the
 * world has already stripped just by skipping a separate guard call.
 *
 * IMPORTANT — what this module's `searched` flag does NOT protect against:
 * there is currently no slot in the shipped save format (`@/persist`'s
 * `saveGameSchema`) for a `RoadWreck` at all — `world.entities.wrecks` is a
 * DIFFERENT type (`@/sim/world`'s `WreckState`, an arena decay-timer wreck
 * with `headingRad`/`ticksRemaining`), structurally incompatible with a
 * `RoadWreck`'s `searched`/`createdDayIndex`/`weapons`/`gear`. In memory,
 * within a single running road trip, `searched` genuinely prevents a
 * reroll. Across an actual save/reload it currently cannot, because there
 * is nowhere for the flag to be written — that is a `@/persist` schema gap,
 * out of this module's scope to close, and this module makes no claim
 * otherwise.
 *
 * Searching — the one-roll-per-wreck probability, the burned/already-
 * searched/no-yield rules, and matching-weapon ammo transfer up to
 * magazine capacity — is entirely `@/sim/economy`'s `salvageRoll`, reused
 * whole here, never reimplemented (the mechanic-skill-derived chance in
 * particular is `salvageRoll`'s alone).
 *
 * What NEITHER module does: fold a successful roll's `vehicle` (ammo
 * transferred into a matching mount) and `cargo` (the abstract,
 * non-installable leftovers — SPEC.md "Road": "everything else becomes
 * abstract cargo that occupies weight and space and cannot be installed")
 * into a single updated `VehicleState`, ready to replace the searching
 * driver's vehicle in world state, PROVIDED it actually fits — `salvageRoll`
 * hands the two back separately by design (economy.ts's own
 * `SalvageResult`) and never checks capacity, so a caller has to be the one
 * to merge them and the one to gate the merge on room. That merge, the
 * capacity gate, plus the "accumulated salvage counts as one more cargo
 * category" accounting SPEC.md's "Courier" section ties to the same cargo
 * (`payloadSlotsUsed`, sharing its one counting rule with `@/sim/courier`'s
 * own `payloadsUsed` via the exported `payloadSlotsFor`, never a second
 * copy of the loop), is this module's whole job.
 */
import { getSkill } from '@/sim/driver';
import { salvageRoll, type Salvager, type SalvageResult } from '@/sim/economy';
import { isWreckPresent, type RoadWreck } from '@/sim/road';
import { capacityFor, cargoWeightAndSpaces, couriersConfig, payloadSlotsFor } from '@/sim/courier';
import type { CargoState, DriverState, VehicleState } from '@/sim/types';
import type { Rng } from '@/util/rng';

/**
 * True only when `wreck` is BOTH still on the route today (not yet stripped
 * overnight, per `isWreckPresent`) AND has not already had its one roll
 * spent. Purely advisory — e.g. for a UI deciding whether to offer a
 * "search" action at all — since `searchWreck` itself re-checks both halves
 * before touching anything, so skipping this call is never unsafe.
 */
export function canSearchWreck(wreck: RoadWreck, currentDayIndex: number): boolean {
  return isWreckPresent(wreck, currentDayIndex) && !wreck.searched;
}

export type SearchWreckResult =
  | { ok: false; reason: 'alreadySearched' | 'notPresent' }
  | { ok: true; success: false; wreck: RoadWreck; vehicle: VehicleState }
  | { ok: true; success: true; wreck: RoadWreck; vehicle: VehicleState; capacityExceeded: boolean };

/**
 * Spends `wreck`'s one roll (via `salvageRoll`, using the searching
 * driver's OWN mechanic skill — never a caller-supplied number) and, on a
 * successful search, folds the recovered ammo/cargo into `vehicle` — but
 * only the ammo unconditionally (it lands in mounts the vehicle already
 * has, not in cargo capacity); the abstract leftover cargo is added ONLY IF
 * `vehicle` has the weight/space/payload-slot room for it (checked against
 * `@/sim/courier`'s own capacity math, `capacityFor` + `payloadSlotsFor`,
 * never a second copy of that arithmetic). When it doesn't fit,
 * `capacityExceeded: true` comes back and the cargo is left behind at the
 * wreck rather than silently overloading the vehicle — the roll (and the
 * wreck's one shot) is still spent either way; there is no free reroll for
 * showing up full.
 *
 * `currentDayIndex` is required, not optional: `canSearchWreck`'s
 * same-day/overnight-stripped check is re-applied HERE, inside the one
 * function that actually mutates the wreck, rather than living only in a
 * separate advisory function a caller could forget to call. A wreck the
 * world has already stripped (`encounters.json`'s `strippedOvernight`)
 * refuses with `{ ok: false, reason: 'notPresent' }` before any roll is
 * drawn or any skill is read.
 *
 * A `RoadWreck` passed in comes back as a `RoadWreck` (its `position` and
 * `createdDayIndex` intact) even though `salvageRoll`'s own return type only
 * promises the narrower `Wreck` shape: `salvageRoll` never drops fields, it
 * only ever spreads `{ ...wreck, searched: true }` (economy.ts), so every
 * extra field the caller's wreck carried in survives the round trip
 * structurally — the cast below just restores the wider static type for it.
 */
export function searchWreck(
  vehicle: VehicleState,
  driver: DriverState,
  wreck: RoadWreck,
  currentDayIndex: number,
  rng: Rng,
): SearchWreckResult {
  if (!isWreckPresent(wreck, currentDayIndex)) return { ok: false, reason: 'notPresent' };

  const mechanic: Salvager = { skill: getSkill(driver, 'mechanic'), vehicle };
  const result: SalvageResult = salvageRoll(mechanic, wreck, rng);

  if (!result.ok) return result;

  const searchedWreck = result.wreck as RoadWreck;

  if (!result.success) {
    return { ok: true, success: false, wreck: searchedWreck, vehicle };
  }

  const found = cargoWeightAndSpaces(result.cargo);
  const remaining = capacityFor(result.vehicle, result.vehicle.cargo);
  const projectedSlots = payloadSlotsFor([...result.vehicle.cargo, ...result.cargo], couriersConfig().salvageOccupiesOneCategory);
  const fits =
    found.weightLb <= remaining.remainingLoadLb &&
    found.spaces <= remaining.remainingSpaces &&
    projectedSlots <= couriersConfig().maxPayloads;

  if (!fits) {
    return { ok: true, success: true, wreck: searchedWreck, vehicle: result.vehicle, capacityExceeded: true };
  }

  return {
    ok: true,
    success: true,
    wreck: searchedWreck,
    vehicle: { ...result.vehicle, cargo: [...result.vehicle.cargo, ...result.cargo] },
    capacityExceeded: false,
  };
}

/**
 * How many of the vehicle's payload slots `cargo` currently occupies, per
 * SPEC.md's "Courier": every `'payload'` item is its own slot, while
 * accumulated `'salvage'` items — a single wreck search can add several at
 * once (weapon body plus gear), and a later search can pile more on top —
 * together cost at most ONE more slot, never one each.
 *
 * The counting rule itself lives in exactly one place, `@/sim/courier`'s
 * exported `payloadSlotsFor` — this function is a thin wrapper that reads
 * `salvageOccupiesOneCategory` through this module's OWN `couriersConfig()`
 * call (so a ruleset swapped at call time, e.g. by a test mock, is honored
 * here too) and hands it to that shared implementation, rather than keeping
 * a second copy of the loop that could quietly drift from courier.ts's own.
 */
export function payloadSlotsUsed(cargo: readonly CargoState[]): number {
  return payloadSlotsFor(cargo, couriersConfig().salvageOccupiesOneCategory);
}
