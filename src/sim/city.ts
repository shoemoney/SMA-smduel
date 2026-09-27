/**
 * CITY subsystem: the town map a driver explores between road trips, on foot
 * or at the wheel — doorways into every facility a city lists in cities.json,
 * plus a gate onto the road, arranged around an open plaza with no blocking
 * geometry.
 *
 * Layout generation is a pure function of (cityId, save seed): the same
 * pair always produces the identical set of doorway/gate positions, and a
 * different seed reshuffles which facility sits where. Every tunable number
 * (walking and city-driving speed, the doorway/vehicle interaction radius,
 * the walk-in-city time cost, which facility kinds never close) comes from the validated
 * ruleset loader (`@/data/rulesets`, `@/sim/calendar`) — nothing
 * gameplay-relevant is a literal here. No `Math.random()` / `Date.now()`:
 * layout randomness runs entirely through the seeded `Rng` from
 * `@/util/rng`.
 */
import { citiesConfig, drivingConfig, economy, UnknownRulesetIdError } from '@/data/rulesets';
import { advanceForTimeCost, timeCostOf, type Clock } from '@/sim/calendar';
import type { CityDef, Vec2 } from '@/sim/types';
import { createRng, type Rng } from '@/util/rng';

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Bounds-checked array read. `noUncheckedIndexedAccess` types every index read as `T | undefined`; this is the one place that turns "should never happen" into an actual thrown error instead of a silencing `!`. */
export function requireAt<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new RangeError(`city: index ${index} out of range (length ${arr.length})`);
  return value;
}

function distanceM(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Looks up a cities.json city by id. Throws `UnknownRulesetIdError` (table `'city'`) for an id that isn't one of cities.json's authoritative entries. */
export function getCityDef(cityId: string): CityDef {
  const city = citiesConfig().cities.find((c) => c.id === cityId);
  if (city === undefined) throw new UnknownRulesetIdError('city', cityId);
  return city;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface Doorway {
  readonly facilityKind: string;
  readonly position: Vec2;
}

export interface Gate {
  readonly position: Vec2;
}

export interface CityLayout {
  readonly cityId: string;
  /** One entry per `getCityDef(cityId).facilities`, same order, one doorway each. */
  readonly doorways: readonly Doorway[];
  readonly gate: Gate;
  /** Radius of the ring every doorway/gate sits on, in meters — convenient for a view's ground-tile bounds or camera framing. */
  readonly boundsRadiusM: number;
  /** Ground-tile edge length, in meters. Derived from `driving.json`'s pedestrian interaction radius rather than an invented literal. */
  readonly tileSizeM: number;
}

/** Fisher-Yates shuffle of `[0, n)`, drawn from `rng` — the one source of layout randomness. */
function shuffledIndices(rng: Rng, n: number): number[] {
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = requireAt(indices, i);
    const b = requireAt(indices, j);
    indices[i] = b;
    indices[j] = a;
  }
  return indices;
}

/**
 * Deterministically builds `cityId`'s walkable layout from `saveSeed`: one
 * doorway per `cities.json` facility plus a gate, evenly spaced around a
 * plaza ring wide enough that no two interaction circles (driving.json's
 * `pedestrian.interactionRadiusM`) overlap, in an order shuffled by a
 * seeded RNG substream keyed on `(saveSeed, cityId)` — the same pair always
 * reproduces the identical ring assignment; a different seed (or a
 * different city) reshuffles it. The plaza is open ground with no blocking
 * geometry, so every doorway placed anywhere on the ring is reachable by a
 * straight walk from the gate.
 *
 * The ring radius is the LARGER of two floors: the exact chord-length
 * solution that keeps ADJACENT points `minSpacingM` apart (so entry
 * circles never overlap — the only thing that matters once `slotCount`
 * is large), and `minSpacingM` itself (so a city with very few slots,
 * where the chord solution alone would place the ring barely past
 * `interactionRadiusM`, still leaves at least one full
 * `interactionRadiusM` of open, walkable ground between the plaza centre
 * and the nearest trigger circle). Without that second floor a
 * single-facility city (e.g. providence) puts the ring exactly at
 * `interactionRadiusM`, so the plaza centre sits ON the boundary of both
 * the gate's and the doorway's trigger circles.
 */
export function generateCityLayout(cityId: string, saveSeed: string): CityLayout {
  const city = getCityDef(cityId);
  const rng = createRng(saveSeed).stream(`city:${cityId}`);

  const facilityCount = city.facilities.length;
  const slotCount = facilityCount + 1; // + the gate
  const interactionRadiusM = drivingConfig().pedestrian.interactionRadiusM;
  // Twice the interaction radius, so two adjacent doorways' entry circles
  // (each `interactionRadiusM` wide) never overlap.
  const minSpacingM = interactionRadiusM * 2;
  // Exact chord-length solution for `slotCount` points evenly spaced on a
  // circle: picks the radius that makes ADJACENT points exactly
  // `minSpacingM` apart (every other pair is farther apart than that, since
  // chord length only grows with angular separation up to half a turn).
  const chordRadiusM = minSpacingM / (2 * Math.sin(Math.PI / slotCount));
  // Floored at `minSpacingM` (see the doc comment above) so small-slotCount
  // cities keep a real walkable margin around the plaza centre instead of
  // collapsing onto the trigger circles themselves.
  const radiusM = Math.max(chordRadiusM, minSpacingM);

  const ring = shuffledIndices(rng, slotCount);
  // slot id 0..facilityCount-1 -> that facility; slot id facilityCount -> the gate.
  const positionBySlotId = new Map<number, Vec2>();
  for (let ringPos = 0; ringPos < slotCount; ringPos++) {
    const slotId = requireAt(ring, ringPos);
    const angle = (2 * Math.PI * ringPos) / slotCount;
    positionBySlotId.set(slotId, { x: radiusM * Math.cos(angle), y: radiusM * Math.sin(angle) });
  }

  const doorways: Doorway[] = city.facilities.map((facilityKind, slotId) => {
    const position = positionBySlotId.get(slotId);
    if (position === undefined) throw new Error(`city: layout generation dropped slot ${slotId}`);
    return { facilityKind, position };
  });

  const gatePosition = positionBySlotId.get(facilityCount);
  if (gatePosition === undefined) throw new Error('city: layout generation dropped the gate slot');

  return {
    cityId,
    doorways,
    gate: { position: gatePosition },
    boundsRadiusM: radiusM,
    tileSizeM: interactionRadiusM,
  };
}

/** The city's `alwaysOpenFacilities` (economy.json) member, if it has one — the 24-hour alternative a closed facility should point at. `null` when the city happens to list none (defensive; every real cities.json city lists at least one). */
export function alwaysOpenFacilityIn(cityId: string): string | null {
  const city = getCityDef(cityId);
  const alwaysOpen = economy().alwaysOpenFacilities;
  const alternative = city.facilities.find((kind) => alwaysOpen.includes(kind));
  return alternative ?? null;
}

/** The next dayIndex a DAY-phase-only facility reopens: today if it's already DAY, tomorrow if it's NIGHT — mirrors `@/sim/calendar`'s own DAY-on-day-advance rule (`advanceDays` always opens back into DAY). */
export function nextFacilityOpenDayIndex(clock: Clock): number {
  return clock.phase === 'DAY' ? clock.dayIndex : clock.dayIndex + 1;
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

export type CityDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export const CITY_DIRECTIONS: readonly CityDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const DIRECTION_UNIT_VECTORS: Readonly<Record<CityDirection, Vec2>> = {
  N: { x: 0, y: -1 },
  NE: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  E: { x: 1, y: 0 },
  SE: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  S: { x: 0, y: 1 },
  SW: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  W: { x: -1, y: 0 },
  NW: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
};

export interface CityPlayerState {
  readonly position: Vec2;
  readonly headingRad: number;
  readonly inVehicle: boolean;
}

export function createCityPlayerState(position: Vec2): CityPlayerState {
  return { position, headingRad: 0, inVehicle: false };
}

export type CityTrigger =
  | { readonly kind: 'facility'; readonly facilityKind: string }
  | { readonly kind: 'gate' }
  | { readonly kind: 'none' };

/** True when the step from `prevPosition` to `nextPosition` has a positive component toward `targetPosition` — i.e. it is headed INTO the target, not just grazing past or backing away from it. Standing still (`prevPosition === nextPosition`) is never "moving inward". */
function movingToward(prevPosition: Vec2, nextPosition: Vec2, targetPosition: Vec2): boolean {
  const moveX = nextPosition.x - prevPosition.x;
  const moveY = nextPosition.y - prevPosition.y;
  if (moveX === 0 && moveY === 0) return false;
  const towardX = targetPosition.x - prevPosition.x;
  const towardY = targetPosition.y - prevPosition.y;
  return moveX * towardX + moveY * towardY > 0;
}

/**
 * "Entering a building = crossing INTO its doorway's radius while moving
 * inward": the step's endpoint must sit within driving.json's pedestrian
 * interaction radius of a doorway (or the gate), the step's START must have
 * been OUTSIDE that radius (edge-triggered — a step that starts already
 * inside the radius and stays inside it does not re-fire; only the tick
 * that crosses the boundary does), AND the step itself must be headed
 * toward that point (`movingToward`), not merely passing within range of
 * it. Without the "started outside" check, a consumer that opens a
 * building's menu on this trigger would reopen it every single tick spent
 * standing in the doorway while still holding the same direction — this is
 * what makes the trigger a one-shot edge, not a level-triggered "am I
 * inside" test. A doorway match always wins over the gate when
 * (implausibly) both trigger on the same step, since a real layout's
 * doorway/gate ring spacing (`generateCityLayout`) keeps them farther apart
 * than one interaction radius.
 */
export function checkCityTrigger(layout: CityLayout, prevPosition: Vec2, nextPosition: Vec2): CityTrigger {
  const interactionRadiusM = drivingConfig().pedestrian.interactionRadiusM;
  for (const doorway of layout.doorways) {
    const wasOutside = distanceM(prevPosition, doorway.position) > interactionRadiusM;
    if (
      wasOutside &&
      distanceM(nextPosition, doorway.position) <= interactionRadiusM &&
      movingToward(prevPosition, nextPosition, doorway.position)
    ) {
      return { kind: 'facility', facilityKind: doorway.facilityKind };
    }
  }
  const gateWasOutside = distanceM(prevPosition, layout.gate.position) > interactionRadiusM;
  if (
    gateWasOutside &&
    distanceM(nextPosition, layout.gate.position) <= interactionRadiusM &&
    movingToward(prevPosition, nextPosition, layout.gate.position)
  ) {
    return { kind: 'gate' };
  }
  return { kind: 'none' };
}

export interface WalkStepParams {
  readonly player: CityPlayerState;
  readonly layout: CityLayout;
  /** One of the eight compass directions, or `null` for no input (stick centered — the player doesn't move). */
  readonly direction: CityDirection | null;
  readonly dtSeconds: number;
  readonly clock: Clock;
}

export interface WalkStepResult {
  readonly player: CityPlayerState;
  readonly clock: Clock;
  readonly trigger: CityTrigger;
}

/** Clamps `position` to `layout.boundsRadiusM` from the plaza centre `(0,0)` — the city's wall. A position already inside (or exactly on) the wall passes through unchanged; one that would step outside it is pulled back along the same line to sit exactly on the boundary, so the gate (which itself sits exactly at `boundsRadiusM`) stays reachable. */
function clampToCityWalls(position: Vec2, boundsRadiusM: number): Vec2 {
  const distanceFromCentre = Math.hypot(position.x, position.y);
  if (distanceFromCentre <= boundsRadiusM || distanceFromCentre === 0) return position;
  const scale = boundsRadiusM / distanceFromCentre;
  return { x: position.x * scale, y: position.y * scale };
}

/**
 * One tick of movement around the plaza, on foot or at the wheel: no input
 * leaves position and the clock untouched and reports no trigger. Otherwise
 * moves `speedMps * dt` meters along one of the eight compass directions,
 * clamped to
 * `layout.boundsRadiusM` from the plaza centre so the player can never walk
 * off the ground `buildCityInstances` actually renders (SPEC's "fixed graph
 * of WALLED cities" — the wall sits at the ring the doorways and gate are
 * placed on), charges `economy.json`'s `timeCostDays.walkInCity` against
 * the clock through `@/sim/calendar`'s `advanceForTimeCost` (documented as
 * 0 — read from the ruleset rather than assumed free, so a ruleset change
 * is honored), and reports whether that step entered a doorway or the
 * gate.
 *
 * `player.inVehicle` (set by `toggleVehicle`) picks the SPEED and nothing
 * else: driving.json's `city.vehicleSpeedMps` at the wheel,
 * `pedestrian.speedMps` on foot. Everything else about the step is
 * deliberately identical. The eight compass directions (SPEC's "City: 8-way
 * walk"), the city wall, the clock cost and the doorway/gate triggers all
 * apply to a car exactly as they do to a pedestrian, so driving is a faster
 * way across the same plaza rather than a second movement model. This used to
 * no-op ALL movement while riding, which made 'G' a trap: it parked the
 * driver until they pressed it again, and nothing else in the codebase read
 * the flag.
 */
export function stepWalk(params: WalkStepParams): WalkStepResult {
  const { player, layout, direction, dtSeconds, clock } = params;

  if (direction === null) {
    return { player, clock, trigger: { kind: 'none' } };
  }

  const unit = DIRECTION_UNIT_VECTORS[direction];
  const cfg = drivingConfig();
  const speedMps = player.inVehicle ? cfg.city.vehicleSpeedMps : cfg.pedestrian.speedMps;
  const distance = speedMps * dtSeconds;
  const rawNextPosition: Vec2 = {
    x: player.position.x + unit.x * distance,
    y: player.position.y + unit.y * distance,
  };
  const nextPosition = clampToCityWalls(rawNextPosition, layout.boundsRadiusM);
  const headingRad = Math.atan2(unit.y, unit.x);
  const nextPlayer: CityPlayerState = { ...player, position: nextPosition, headingRad };
  const nextClock = advanceForTimeCost(clock, timeCostOf('walkInCity'));
  const trigger = checkCityTrigger(layout, player.position, nextPosition);

  return { player: nextPlayer, clock: nextClock, trigger };
}

// ---------------------------------------------------------------------------
// Vehicle enter/exit ('G' in range — see docs/SPEC.md "Controls")
// ---------------------------------------------------------------------------

/** True when `playerPosition` sits within driving.json's pedestrian interaction radius of `vehiclePosition`. */
export function isVehicleInRange(playerPosition: Vec2, vehiclePosition: Vec2): boolean {
  return distanceM(playerPosition, vehiclePosition) <= drivingConfig().pedestrian.interactionRadiusM;
}

export type ToggleVehicleResult =
  | { readonly ok: true; readonly player: CityPlayerState }
  | { readonly ok: false; readonly reason: 'outOfRange' };

/** Exiting is always allowed (getting out never fails); entering requires `isVehicleInRange`. */
export function toggleVehicle(player: CityPlayerState, vehiclePosition: Vec2): ToggleVehicleResult {
  if (player.inVehicle) {
    return { ok: true, player: { ...player, inVehicle: false } };
  }
  if (!isVehicleInRange(player.position, vehiclePosition)) {
    return { ok: false, reason: 'outOfRange' };
  }
  return { ok: true, player: { ...player, inVehicle: true } };
}
