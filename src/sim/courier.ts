/**
 * COURIER subsystem: job generation, acceptance, carriage, delivery, failure,
 * and illicit sale at the bar.
 *
 * Every tunable number here comes from `rulesets/classic/couriers.json`,
 * imported directly by this module (couriers.json is not yet wired into the
 * central `@/data/rulesets` loader/schema, which currently validates only
 * the ten files listed in that module's own `RAW_RULESETS` — adding an
 * eleventh file there is out of this module's file scope) — nothing
 * gameplay-relevant is a literal in this file. Route/city/facility facts
 * come from `@/data/rulesets`'s `citiesConfig()`; vehicle load/space math
 * comes from `@/sim/construct`'s `computeBuild` (the one place that formula
 * lives, same as `@/sim/economy` already relies on it); a fresh cargo item's
 * full integrity comes from `economy()._reconstruction.cargoFullIntegrity`
 * (the same value `@/sim/economy`'s salvage path already reads).
 *
 * couriers.json's own `_note`: "Job GENERATION parameters are Reconstruction
 * - the source never published the formula." Where this module has to make
 * a judgment call the source never documented (the exact shape of the pay
 * formula, the deadline formula, and what "vehicle survivability" means),
 * that choice is called out inline — every number those formulas read is
 * still sourced from the ruleset, never invented.
 */
import couriersJson from '@rulesets/classic/couriers.json';
import { citiesConfig, economy } from '@/data/rulesets';
import { advanceForTimeCost, daysLate, timeCostOf, type Clock } from '@/sim/calendar';
import { computeBuild, type BuildDesign } from '@/sim/construct';
import { addPrestige, losePrestige } from '@/sim/driver';
import { sumArmor } from '@/sim/types';
import type { CargoState, DriverState, VehicleState } from '@/sim/types';
import { createRng } from '@/util/rng';
import type { Rng } from '@/util/rng';

// ---------------------------------------------------------------------------
// Ruleset shape (couriers.json)
// ---------------------------------------------------------------------------

interface CourierPrestigeTier {
  minPrestige: number;
  maxDangerOffered: number;
  payMultiplier: number;
  prestigeReward: number;
  failurePenalty: number;
}

interface CourierGenerationParams {
  payWeightPerMile: number;
  payWeightPerDangerLevel: number;
  payWeightPerHundredPounds: number;
  payJitterFraction: number;
  deadlineDaysPerRoute: number;
  deadlineSlackDaysMin: number;
  deadlineSlackDaysMax: number;
  declaredValueMultiplier: number;
  weightLbMin: number;
  weightLbMax: number;
  spacesMin: number;
  spacesMax: number;
}

interface CouriersFile {
  offersPerVisit: number;
  maxPayloads: number;
  salvageOccupiesOneCategory: boolean;
  acceptanceCostDays: number;
  multipleAcceptsShareOneDay: boolean;
  generation: CourierGenerationParams;
  prestigeTiers: CourierPrestigeTier[];
  lateness: { payDecayPerDay: number; payFloorFraction: number };
  illicitSale: { valueFraction: number; prestigePenalty: number; lawConsequenceChance: number };
  refusalReasons: string[];
  cargoNames: string[];
}

// ---------------------------------------------------------------------------
// Shape validation
// ---------------------------------------------------------------------------
//
// couriers.json is NOT wired into `@/data/rulesets`'s central AJV loader (its
// own file header explains why - out of this module's file scope), so a
// blind `as CouriersFile` cast is the only thing standing between a
// malformed or edited-out field and a `number` that's silently `undefined`
// at runtime (TypeScript has no way to catch that at compile time - the cast
// says "trust me"). Every field this module actually reads is checked here,
// once, at import time, so a missing/mistyped field throws loudly on
// startup instead of turning a refusal check like `x > undefined` into an
// always-false comparison that never fires.

function requireFiniteNumber(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`courier.ts: couriers.json "${path}" must be a finite number, got ${JSON.stringify(value)}`);
  }
}

function requireBoolean(value: unknown, path: string): void {
  if (typeof value !== 'boolean') {
    throw new Error(`courier.ts: couriers.json "${path}" must be a boolean, got ${JSON.stringify(value)}`);
  }
}

function requireStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`courier.ts: couriers.json "${path}" must be an array of strings, got ${JSON.stringify(value)}`);
  }
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`courier.ts: couriers.json "${path}" must be an object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

const GENERATION_NUMBER_FIELDS = [
  'payWeightPerMile',
  'payWeightPerDangerLevel',
  'payWeightPerHundredPounds',
  'payJitterFraction',
  'deadlineDaysPerRoute',
  'deadlineSlackDaysMin',
  'deadlineSlackDaysMax',
  'declaredValueMultiplier',
  'weightLbMin',
  'weightLbMax',
  'spacesMin',
  'spacesMax',
] as const;

const PRESTIGE_TIER_NUMBER_FIELDS = [
  'minPrestige',
  'maxDangerOffered',
  'payMultiplier',
  'prestigeReward',
  'failurePenalty',
] as const;

function assertCouriersShape(raw: unknown): void {
  const root = requireObject(raw, '<root>');
  requireFiniteNumber(root.offersPerVisit, 'offersPerVisit');
  requireFiniteNumber(root.maxPayloads, 'maxPayloads');
  requireBoolean(root.salvageOccupiesOneCategory, 'salvageOccupiesOneCategory');
  requireBoolean(root.multipleAcceptsShareOneDay, 'multipleAcceptsShareOneDay');

  const generation = requireObject(root.generation, 'generation');
  for (const field of GENERATION_NUMBER_FIELDS) {
    requireFiniteNumber(generation[field], `generation.${field}`);
  }

  if (!Array.isArray(root.prestigeTiers) || root.prestigeTiers.length === 0) {
    throw new Error(
      `courier.ts: couriers.json "prestigeTiers" must be a non-empty array, got ${JSON.stringify(root.prestigeTiers)}`,
    );
  }
  root.prestigeTiers.forEach((tier: unknown, index: number) => {
    const tierObj = requireObject(tier, `prestigeTiers[${index}]`);
    for (const field of PRESTIGE_TIER_NUMBER_FIELDS) {
      requireFiniteNumber(tierObj[field], `prestigeTiers[${index}].${field}`);
    }
  });

  const lateness = requireObject(root.lateness, 'lateness');
  requireFiniteNumber(lateness.payDecayPerDay, 'lateness.payDecayPerDay');
  requireFiniteNumber(lateness.payFloorFraction, 'lateness.payFloorFraction');

  const illicitSale = requireObject(root.illicitSale, 'illicitSale');
  requireFiniteNumber(illicitSale.valueFraction, 'illicitSale.valueFraction');
  requireFiniteNumber(illicitSale.prestigePenalty, 'illicitSale.prestigePenalty');
  requireFiniteNumber(illicitSale.lawConsequenceChance, 'illicitSale.lawConsequenceChance');

  requireStringArray(root.refusalReasons, 'refusalReasons');
  requireStringArray(root.cargoNames, 'cargoNames');
}

assertCouriersShape(couriersJson);

const couriers = couriersJson as CouriersFile;

/** Read-only accessor, so a test can assert against the same object this module reads instead of re-importing the JSON itself. */
export function couriersConfig(): CouriersFile {
  return couriers;
}

// ---------------------------------------------------------------------------
// Refusal reasons
// ---------------------------------------------------------------------------

export type CourierRefusalReason =
  | 'INSUFFICIENT_PRESTIGE'
  | 'INSUFFICIENT_VEHICLE_THREAT'
  | 'INSUFFICIENT_SPACE'
  | 'INSUFFICIENT_LOAD_CAPACITY'
  | 'PAYLOAD_LIMIT_REACHED'
  | 'NO_ACTIVE_VEHICLE';

const REFUSAL_REASONS: readonly CourierRefusalReason[] = [
  'INSUFFICIENT_PRESTIGE',
  'INSUFFICIENT_VEHICLE_THREAT',
  'INSUFFICIENT_SPACE',
  'INSUFFICIENT_LOAD_CAPACITY',
  'PAYLOAD_LIMIT_REACHED',
  'NO_ACTIVE_VEHICLE',
];

// Fails fast at import time if couriers.json's refusalReasons list ever
// drifts from the reasons this module actually implements, instead of
// silently returning (or never returning) a reason the ruleset no longer
// documents.
function assertRefusalReasonsMatchRuleset(): void {
  const fromRuleset = new Set(couriers.refusalReasons);
  const fromCode = new Set<string>(REFUSAL_REASONS);
  const matches =
    fromRuleset.size === fromCode.size && [...fromRuleset].every((reason) => fromCode.has(reason));
  if (!matches) {
    throw new Error(
      `courier.ts: couriers.json refusalReasons ${JSON.stringify(couriers.refusalReasons)} does not match ` +
        `the reasons this module implements ${JSON.stringify(REFUSAL_REASONS)}`,
    );
  }
}
assertRefusalReasonsMatchRuleset();

// ---------------------------------------------------------------------------
// Prestige tiers
// ---------------------------------------------------------------------------

/** The highest tier whose `minPrestige` is at or below `prestige`. */
export function tierFor(prestige: number): CourierPrestigeTier {
  let selected: CourierPrestigeTier | undefined;
  for (const tier of couriers.prestigeTiers) {
    if (prestige >= tier.minPrestige && (selected === undefined || tier.minPrestige > selected.minPrestige)) {
      selected = tier;
    }
  }
  if (selected !== undefined) return selected;
  // Below every tier's floor - shouldn't happen given skills.json's
  // prestigeFloor is never below prestigeTiers[0].minPrestige, but fall back
  // to the lowest tier rather than throwing, the same defensive posture
  // `clampNum`-style helpers elsewhere in this codebase take.
  let lowest: CourierPrestigeTier | undefined;
  for (const tier of couriers.prestigeTiers) {
    if (lowest === undefined || tier.minPrestige < lowest.minPrestige) lowest = tier;
  }
  if (lowest === undefined) throw new Error('courier.ts: couriers.json prestigeTiers is empty');
  return lowest;
}

// ---------------------------------------------------------------------------
// Route/city lookups
// ---------------------------------------------------------------------------

interface RouteDefLike {
  id: string;
  a: string;
  b: string;
  lengthMiles: number;
  danger: number;
}

interface RouteNeighbor {
  route: RouteDefLike;
  neighborCityId: string;
}

/**
 * Every route touching `cityId`, resolved to the OTHER end as
 * `neighborCityId`, sorted by route id. Sorted so the candidate list a given
 * `cityId` presents to the seeded picker below is itself deterministic
 * regardless of `citiesConfig().routes`'s own array order.
 */
function routeNeighborsOf(cityId: string): RouteNeighbor[] {
  const neighbors: RouteNeighbor[] = [];
  for (const route of citiesConfig().routes) {
    if (route.a === cityId) neighbors.push({ route, neighborCityId: route.b });
    else if (route.b === cityId) neighbors.push({ route, neighborCityId: route.a });
  }
  return neighbors.sort((x, y) => (x.route.id < y.route.id ? -1 : x.route.id > y.route.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export interface CourierOffer {
  readonly id: string;
  readonly originCityId: string;
  readonly destinationCityId: string;
  /** A real facility kind belonging to `destinationCityId` per cities.json. */
  readonly destinationFacility: string;
  readonly routeId: string;
  readonly distanceMiles: number;
  readonly dangerLevel: number;
  readonly weightLb: number;
  readonly spaces: number;
  /** Absolute dayIndex the cargo must be delivered by. */
  readonly dueDay: number;
  readonly declaredValue: number;
  readonly pay: number;
  readonly cargoName: string;
}

/**
 * Exactly `offersPerVisit` jobs, deterministic from (seed, cityId, day) via
 * `createRng(seed).stream(...)` — a fresh Rng derived purely from those
 * three inputs, so calling this again for the same (seed, cityId, day) after
 * a save/reload reproduces the identical list bit-for-bit; nothing here
 * consumes draws from, or feeds state into, any other stream. `driver` is
 * NOT part of the determinism key: it only selects which prestige tier's
 * `payMultiplier` scales the pay of an otherwise-identical offer, so the
 * same (seed, cityId, day) reloaded with the same driver reproduces the same
 * list, exactly as the reload guarantee requires.
 *
 * Each destination is a real facility (picked from the destination city's
 * own `facilities[]`) in a real city reached by one of `cityId`'s routes in
 * cities.json — never an invented city or facility. A city with fewer than
 * `offersPerVisit` distinct route neighbors (cities.json has several with
 * only two) can still repeat a route across offers; nothing requires the
 * three destinations to be distinct.
 *
 * Route candidates are restricted to `driver`'s current prestige tier
 * (`tier.maxDangerOffered`) whenever at least one of `cityId`'s routes
 * qualifies: a tier-0 driver standing in a city with both a danger-1 and a
 * danger-3 route only ever gets offered the danger-1 one, instead of a job
 * `accept()` is guaranteed to refuse with INSUFFICIENT_PRESTIGE the moment
 * it's generated. When literally every route out of `cityId` exceeds the
 * tier's cap (cities.json has a couple, e.g. watertown's cheapest route is
 * danger 3 against tier 0's cap of 2), there is no in-budget destination to
 * steer toward, so every route stays a candidate rather than returning fewer
 * than `offersPerVisit` jobs.
 *
 * Pay and the delivery deadline are this module's own reconstruction
 * formula (couriers.json's generation block is documented Reconstruction —
 * "the source never published the formula"):
 *   basePay = distanceMiles*payWeightPerMile + danger*payWeightPerDangerLevel
 *             + (weightLb/100)*payWeightPerHundredPounds
 *   pay = round(basePay * tier.payMultiplier * jitterFactor)
 *   declaredValue = round(basePay * declaredValueMultiplier)   (tier/jitter-free —
 *     the cargo's objective worth, independent of who's carrying it)
 *   dueDay = day + ceil(deadlineDaysPerRoute) + slackDays (slackDays drawn
 *     uniformly from [deadlineSlackDaysMin, deadlineSlackDaysMax])
 */
export function generateOffers(cityId: string, day: number, seed: string | number, driver: DriverState): CourierOffer[] {
  const neighbors = routeNeighborsOf(cityId);
  if (neighbors.length === 0) {
    throw new Error(`generateOffers: city "${cityId}" has no routes in cities.json`);
  }

  const rng: Rng = createRng(seed).stream(`courier:${cityId}:${day}`);
  const gen = couriers.generation;
  const tier = tierFor(driver.prestige);
  const cityIndex = new Map(citiesConfig().cities.map((city) => [city.id, city] as const));

  const eligibleNeighbors = neighbors.filter((neighbor) => neighbor.route.danger <= tier.maxDangerOffered);
  const candidateNeighbors = eligibleNeighbors.length > 0 ? eligibleNeighbors : neighbors;

  const offers: CourierOffer[] = [];
  for (let i = 0; i < couriers.offersPerVisit; i++) {
    const { route, neighborCityId } = rng.pick(candidateNeighbors);
    const destinationCity = cityIndex.get(neighborCityId);
    if (destinationCity === undefined) {
      throw new Error(`generateOffers: route "${route.id}" points at unknown city "${neighborCityId}"`);
    }
    if (destinationCity.facilities.length === 0) {
      throw new Error(`generateOffers: city "${neighborCityId}" has no facilities in cities.json`);
    }
    const destinationFacility = rng.pick(destinationCity.facilities);
    const weightLb = rng.int(gen.weightLbMin, gen.weightLbMax);
    const spaces = rng.int(gen.spacesMin, gen.spacesMax);
    const cargoName = rng.pick(couriers.cargoNames);
    const slackDays = rng.int(gen.deadlineSlackDaysMin, gen.deadlineSlackDaysMax);
    const dueDay = day + Math.ceil(gen.deadlineDaysPerRoute) + slackDays;

    const basePay =
      route.lengthMiles * gen.payWeightPerMile +
      route.danger * gen.payWeightPerDangerLevel +
      (weightLb / 100) * gen.payWeightPerHundredPounds;

    // One draw per offer; u is [0,1), jitterFactor lands in
    // [1 - payJitterFraction, 1 + payJitterFraction).
    const u = rng.nextFloat();
    const jitterFactor = 1 + (u * 2 - 1) * gen.payJitterFraction;

    offers.push({
      id: `${cityId}-${day}-${i}`,
      originCityId: cityId,
      destinationCityId: neighborCityId,
      destinationFacility,
      routeId: route.id,
      distanceMiles: route.lengthMiles,
      dangerLevel: route.danger,
      weightLb,
      spaces,
      dueDay,
      declaredValue: Math.max(0, Math.round(basePay * gen.declaredValueMultiplier)),
      pay: Math.max(0, Math.round(basePay * tier.payMultiplier * jitterFactor)),
      cargoName,
    });
  }
  return offers;
}

// ---------------------------------------------------------------------------
// Capacity bookkeeping (shared by projection and acceptance)
// ---------------------------------------------------------------------------

function cargoWeightAndSpaces(cargo: readonly CargoState[]): { weightLb: number; spaces: number } {
  let weightLb = 0;
  let spaces = 0;
  for (const item of cargo) {
    weightLb += item.weightLb;
    spaces += item.spaces;
  }
  return { weightLb, spaces };
}

/**
 * How many of `maxPayloads` slots `cargo` currently occupies. Every
 * `'payload'` item is its own slot; `'salvage'` items collectively occupy at
 * most ONE slot together (couriers.json `salvageOccupiesOneCategory`) — ten
 * salvage items cost the same single slot as one.
 */
function payloadsUsed(cargo: readonly CargoState[]): number {
  let payloadCount = 0;
  let hasSalvage = false;
  let salvageCount = 0;
  for (const item of cargo) {
    if (item.kind === 'payload') payloadCount++;
    else {
      hasSalvage = true;
      salvageCount++;
    }
  }
  const salvageSlots = couriers.salvageOccupiesOneCategory ? (hasSalvage ? 1 : 0) : salvageCount;
  return payloadCount + salvageSlots;
}

interface CapacityMetrics {
  remainingLoadLb: number;
  remainingSpaces: number;
}

/**
 * `computeBuild`'s `maxLoadLb` is the vehicle's TOTAL weight cap (body +
 * plant + tires + weapons + armor + cargo, per its own `OVER_WEIGHT` check
 * and `@/ui/builder`'s "weightTotal / maxLoadLb" display) — NOT a
 * cargo-only budget. So remaining load capacity is `maxLoadLb -
 * weightTotal` (the vehicle's full current weight, cargo included), never
 * `maxLoadLb - cargoWeight` alone; the latter would let a heavily-armored
 * vehicle "fit" cargo that would actually put it over its GVWR.
 */
function capacityFor(vehicle: VehicleState, cargo: readonly CargoState[]): CapacityMetrics {
  const used = cargoWeightAndSpaces(cargo);
  const design: BuildDesign = { ...vehicle.design, cargoWeightLb: used.weightLb, cargoSpaces: used.spaces };
  const metrics = computeBuild(design);
  return {
    remainingLoadLb: metrics.maxLoadLb - metrics.weightTotal,
    remainingSpaces: metrics.spacesTotal - metrics.spacesUsed,
  };
}

/**
 * What the offer acceptance UI shows before the player commits: the offer's
 * own fields (route, destination facility, weight, spaces, due day, declared
 * value, pay) plus the PROJECTED remaining capacity if it were accepted on
 * top of `vehicle`'s current cargo.
 */
export interface OfferProjection {
  readonly offer: CourierOffer;
  readonly projectedRemainingLoadLb: number;
  readonly projectedRemainingSpaces: number;
  readonly projectedPayloadsUsed: number;
  readonly fits: boolean;
}

export function projectOffer(offer: CourierOffer, vehicle: VehicleState): OfferProjection {
  const capacity = capacityFor(vehicle, vehicle.cargo);
  const projectedRemainingLoadLb = capacity.remainingLoadLb - offer.weightLb;
  const projectedRemainingSpaces = capacity.remainingSpaces - offer.spaces;
  const projectedPayloadsUsed = payloadsUsed(vehicle.cargo) + 1;
  return {
    offer,
    projectedRemainingLoadLb,
    projectedRemainingSpaces,
    projectedPayloadsUsed,
    fits: projectedRemainingLoadLb >= 0 && projectedRemainingSpaces >= 0 && projectedPayloadsUsed <= couriers.maxPayloads,
  };
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

export type CourierJobStatus = 'ACTIVE' | 'DELIVERED' | 'FAILED';

export interface AcceptedJob {
  readonly offer: CourierOffer;
  /** The `CargoState.id` this job's cargo was given in `vehicle.cargo`. */
  readonly cargoId: string;
  readonly status: CourierJobStatus;
  readonly acceptedDay: number;
}

export interface AcceptAttempt {
  readonly offer: CourierOffer;
  readonly accepted: boolean;
  readonly reason: CourierRefusalReason | null;
}

export interface AcceptTransactionResult {
  readonly clock: Clock;
  readonly vehicle: VehicleState | null;
  readonly acceptedJobs: AcceptedJob[];
  readonly attempts: AcceptAttempt[];
}

/**
 * The single refusal reason for accepting `offer` right now, or null if it's
 * acceptable. Checked against `cargo` (the vehicle's cargo AS IT WOULD STAND
 * after every prior offer in this same `accept()` batch), not just
 * `vehicle.cargo` — so a batch of three offers against an empty 1-payload
 * vehicle correctly refuses the third one with PAYLOAD_LIMIT_REACHED instead
 * of only checking the vehicle's pre-transaction state.
 *
 * "Vehicle survivability" (INSUFFICIENT_VEHICLE_THREAT) has no dedicated
 * ruleset field — couriers.json documents job GENERATION as reconstruction
 * but is silent on this refusal's exact trigger. This module's judgment
 * call: a vehicle with zero armor DP left on every facing (`sumArmor(...) <=
 * 0`) cannot be sent on any route carrying real danger (`dangerLevel > 0`) —
 * a bare, unarmored hull sent into a nonzero-danger route has nothing left
 * to lose before the next hit reaches the driver or the cargo. A danger-0
 * route never triggers this regardless of armor.
 *
 * `capacityFor` can come back NaN (`construct.ts`'s documented "must show
 * ????? rather than a wrong number" for a vehicle with an unresolvable
 * component, e.g. an unknown `bodyId`). Every `<` comparison against NaN is
 * false, so without an explicit finiteness check a NaN capacity would fail
 * OPEN — an unbuildable vehicle would accept unlimited cargo instead of
 * being refused. Checked here explicitly so this fails CLOSED instead, the
 * same conclusion `projectOffer`'s `fits` already reaches for the identical
 * input (its `>= 0` comparisons are false against NaN too, but that's an
 * accident of the operator, not a guarantee - `INSUFFICIENT_LOAD_CAPACITY`
 * is the closest real refusal to "the vehicle's own capacity is unknown").
 */
function refusalReasonFor(
  offer: CourierOffer,
  tier: CourierPrestigeTier,
  vehicle: VehicleState,
  cargo: readonly CargoState[],
): CourierRefusalReason | null {
  if (offer.dangerLevel > tier.maxDangerOffered) return 'INSUFFICIENT_PRESTIGE';
  if (offer.dangerLevel > 0 && sumArmor(vehicle.armorDP) <= 0) return 'INSUFFICIENT_VEHICLE_THREAT';
  if (payloadsUsed(cargo) + 1 > couriers.maxPayloads) return 'PAYLOAD_LIMIT_REACHED';

  const capacity = capacityFor(vehicle, cargo);
  if (!Number.isFinite(capacity.remainingLoadLb) || !Number.isFinite(capacity.remainingSpaces)) {
    return 'INSUFFICIENT_LOAD_CAPACITY';
  }
  if (capacity.remainingSpaces < offer.spaces) return 'INSUFFICIENT_SPACE';
  if (capacity.remainingLoadLb < offer.weightLb) return 'INSUFFICIENT_LOAD_CAPACITY';

  return null;
}

/**
 * A `CargoState.id` for `offer.id` that is guaranteed not to collide with
 * anything already in `existingCargo` — including cargo this same `accept()`
 * batch already appended. `cargo-${offer.id}` alone collides whenever the
 * same offer (by id) is accepted twice in one batch, or across batches
 * before the first copy is delivered/sold/destroyed: `deliver`/`sellIllicit`
 * both remove cargo by `filter((item) => item.id !== job.cargoId)`, so two
 * jobs sharing an id would have the SECOND delivery silently wipe out the
 * FIRST job's still-active cargo. Deterministic (no randomness): walks
 * `-2`, `-3`, ... until it finds an id nothing in `existingCargo` already
 * holds.
 */
function allocateCargoId(offerId: string, existingCargo: readonly CargoState[]): string {
  const base = `cargo-${offerId}`;
  if (!existingCargo.some((item) => item.id === base)) return base;
  let suffix = 2;
  while (existingCargo.some((item) => item.id === `${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

/**
 * Attempts to accept every offer in `offers`, in order, against the SAME
 * transaction: capacity/payload checks for offer N see every offer before
 * it that this call already accepted. Acceptance costs
 * `economy.json`'s `timeCostDays.acceptCourierWork` (read through the
 * validated `@/sim/calendar` `timeCostOf`, the same single source of truth
 * every other time-costed action in this codebase reads — NOT
 * couriers.json's own `acceptanceCostDays`, a second, unvalidated copy of
 * the same number that nothing keeps in sync with the canonical one),
 * charged via `advanceForTimeCost` (closing out daytime businesses per
 * `@/sim/calendar`'s own rule for a >=1-day action), and ONLY if at least
 * one offer in the batch was actually accepted; a batch that refuses every
 * offer costs no time.
 *
 * Whether accepting several offers in one visit costs that time ONCE or
 * once PER accepted job follows couriers.json's own
 * `multipleAcceptsShareOneDay` flag — `true` (the current ruleset) charges
 * the whole batch once; `false` would charge `acceptCourierWork` days for
 * every job accepted in the batch.
 *
 * `vehicle: null` refuses every offer with NO_ACTIVE_VEHICLE and leaves the
 * clock untouched.
 */
export function accept(
  offers: readonly CourierOffer[],
  driver: DriverState,
  vehicle: VehicleState | null,
  clock: Clock,
): AcceptTransactionResult {
  if (vehicle === null) {
    const attempts: AcceptAttempt[] = offers.map((offer) => ({ offer, accepted: false, reason: 'NO_ACTIVE_VEHICLE' }));
    return { clock, vehicle: null, acceptedJobs: [], attempts };
  }

  const tier = tierFor(driver.prestige);
  const attempts: AcceptAttempt[] = [];
  const acceptedJobs: AcceptedJob[] = [];
  let cargo = vehicle.cargo.slice();

  for (const offer of offers) {
    const reason = refusalReasonFor(offer, tier, vehicle, cargo);
    if (reason !== null) {
      attempts.push({ offer, accepted: false, reason });
      continue;
    }
    const cargoItem: CargoState = {
      id: allocateCargoId(offer.id, cargo),
      kind: 'payload',
      weightLb: offer.weightLb,
      spaces: offer.spaces,
      integrity: economy()._reconstruction.cargoFullIntegrity,
    };
    cargo = [...cargo, cargoItem];
    acceptedJobs.push({ offer, cargoId: cargoItem.id, status: 'ACTIVE', acceptedDay: clock.dayIndex });
    attempts.push({ offer, accepted: true, reason: null });
  }

  const nextVehicle: VehicleState = { ...vehicle, cargo };
  const acceptDays = timeCostOf('acceptCourierWork');
  const totalDays = couriers.multipleAcceptsShareOneDay ? acceptDays : acceptDays * acceptedJobs.length;
  const nextClock = acceptedJobs.length > 0 ? advanceForTimeCost(clock, totalDays) : clock;

  return { clock: nextClock, vehicle: nextVehicle, acceptedJobs, attempts };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export type DeliverOutcome = 'ON_TIME' | 'LATE' | 'FAILED' | 'WRONG_LOCATION';

export interface DeliverResult {
  readonly outcome: DeliverOutcome;
  readonly job: AcceptedJob;
  readonly driver: DriverState;
  readonly vehicle: VehicleState;
  readonly paidAmount: number;
  readonly daysLate: number;
}

function payDriver(driver: DriverState, amount: number): DriverState {
  return { ...driver, cash: driver.cash + amount };
}

/**
 * Requires `currentCityId` to be exactly `job.offer.destinationCityId` AND
 * `currentFacility` to be exactly `job.offer.destinationFacility`
 * (WRONG_LOCATION otherwise, job left untouched either way) and the job's
 * cargo to still be aboard `vehicle` with positive integrity — destroyed,
 * stolen or sold cargo (the id is simply gone from `vehicle.cargo`, or its
 * integrity has hit 0 via `@/sim/damage`'s `applyCargoDamage`) marks the job
 * FAILED and applies `tier.failurePenalty` to prestige, no pay.
 *
 * docs/SPEC.md: "Delivery means entering the exact destination building with
 * intact cargo" — right city, wrong building (e.g. standing in the
 * destination city's bar instead of its courier guild) is still
 * WRONG_LOCATION, not a delivery.
 *
 * On time (`daysLate <= 0`): full `offer.pay`, plus the CURRENT prestige
 * tier's `prestigeReward` (the driver's standing at delivery time, which can
 * differ from whatever tier priced the job at acceptance if other jobs
 * shifted their prestige in between).
 *
 * Late: pay decays by `lateness.payDecayPerDay` per day late, floored at
 * `payFloorFraction` of the original pay, and applies the SAME
 * `tier.failurePenalty` a full failure would — couriers.json has no separate
 * "late but delivered" prestige number, so this reuses the one it does
 * have rather than inventing a second.
 */
export function deliver(
  job: AcceptedJob,
  driver: DriverState,
  vehicle: VehicleState,
  currentCityId: string,
  currentFacility: string,
  clock: Clock,
): DeliverResult {
  if (job.status !== 'ACTIVE') {
    throw new Error(`deliver: job "${job.offer.id}" is not ACTIVE (status: ${job.status})`);
  }

  if (currentCityId !== job.offer.destinationCityId || currentFacility !== job.offer.destinationFacility) {
    return { outcome: 'WRONG_LOCATION', job, driver, vehicle, paidAmount: 0, daysLate: 0 };
  }

  const tier = tierFor(driver.prestige);
  const cargoItem = vehicle.cargo.find((item) => item.id === job.cargoId);

  if (cargoItem === undefined || cargoItem.integrity <= 0) {
    const failedJob: AcceptedJob = { ...job, status: 'FAILED' };
    return {
      outcome: 'FAILED',
      job: failedJob,
      driver: losePrestige(driver, tier.failurePenalty),
      vehicle,
      paidAmount: 0,
      daysLate: 0,
    };
  }

  const late = daysLate(job.offer.dueDay, clock);
  const nextVehicle: VehicleState = { ...vehicle, cargo: vehicle.cargo.filter((item) => item.id !== job.cargoId) };
  const deliveredJob: AcceptedJob = { ...job, status: 'DELIVERED' };

  if (late <= 0) {
    return {
      outcome: 'ON_TIME',
      job: deliveredJob,
      driver: addPrestige(payDriver(driver, job.offer.pay), tier.prestigeReward),
      vehicle: nextVehicle,
      paidAmount: job.offer.pay,
      daysLate: 0,
    };
  }

  const { payDecayPerDay, payFloorFraction } = couriers.lateness;
  const decayFactor = Math.max(payFloorFraction, 1 - payDecayPerDay * late);
  const paidAmount = Math.max(0, Math.round(job.offer.pay * decayFactor));

  return {
    outcome: 'LATE',
    job: deliveredJob,
    driver: losePrestige(payDriver(driver, paidAmount), tier.failurePenalty),
    vehicle: nextVehicle,
    paidAmount,
    daysLate: late,
  };
}

// ---------------------------------------------------------------------------
// Illicit sale (bar)
// ---------------------------------------------------------------------------

export interface IllicitSaleResult {
  readonly job: AcceptedJob;
  readonly driver: DriverState;
  readonly vehicle: VehicleState;
  readonly payout: number;
  readonly lawConsequenceTriggered: boolean;
}

/**
 * Sells an ACTIVE job's cargo out from under the client at the bar: pays
 * `illicitSale.valueFraction` of the offer's `declaredValue`, costs
 * `illicitSale.prestigePenalty` prestige, removes the cargo from `vehicle`
 * and marks the job FAILED (it can never be legitimately delivered again),
 * and may trigger a law consequence at `illicitSale.lawConsequenceChance`
 * (converted to `Rng.chance`'s 0..100 integer-percent scale). Enacting that
 * consequence — pursuit, a bounty, whatever the world layer decides — is out
 * of this module's scope; `lawConsequenceTriggered` is the signal a caller
 * acts on.
 */
export function sellIllicit(job: AcceptedJob, driver: DriverState, vehicle: VehicleState, rng: Rng): IllicitSaleResult {
  if (job.status !== 'ACTIVE') {
    throw new Error(`sellIllicit: job "${job.offer.id}" is not ACTIVE (status: ${job.status})`);
  }

  const { valueFraction, prestigePenalty, lawConsequenceChance } = couriers.illicitSale;
  const payout = Math.max(0, Math.round(job.offer.declaredValue * valueFraction));
  const nextVehicle: VehicleState = { ...vehicle, cargo: vehicle.cargo.filter((item) => item.id !== job.cargoId) };
  const soldJob: AcceptedJob = { ...job, status: 'FAILED' };
  const lawConsequenceTriggered = rng.chance(Math.round(lawConsequenceChance * 100));

  return {
    job: soldJob,
    driver: losePrestige(payDriver(driver, payout), prestigePenalty),
    vehicle: nextVehicle,
    payout,
    lawConsequenceTriggered,
  };
}
