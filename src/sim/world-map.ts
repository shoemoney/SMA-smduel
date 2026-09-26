/**
 * WORLD-MAP subsystem: the inter-city travel layer over cities.json's fixed
 * 16-city, 26-route graph (docs/SPEC.md "Road": "A fixed graph of walled
 * cities. Each route carries a length, a danger rating, and an encounter
 * table."). Every lookup here reads `citiesConfig()` at call time — never a
 * baked-in copy of the graph — so a ruleset edit reshapes the graph without
 * touching this file.
 *
 * This module answers "where can I go from here, which way is quicker, and
 * which way is safer" — the questions `@/ui/buildings/courierguild` needs to
 * show a player the quick route versus the safe route to a job's destination
 * before they accept it (`shortestPathByMiles`/`shortestPathByDanger`, its
 * one production caller). It never drives a vehicle or advances the clock
 * itself; `@/sim/road` still owns the real-time trip (`resolveRoute`,
 * `beginRoadTrip`, `stepRoadTrip`), and `@/sim/city` still owns a city's
 * walkable layout and its single physical gate position. This file only
 * resolves the GRAPH: the two shortest-path rankings over it, and the
 * calendar-day/danger price of a single route feeding into them.
 *
 * `allCityIds`/`neighbours` are plain adjacency plumbing with no caller
 * beyond this file's own `dijkstra` (the courier/road UI already reaches the
 * same adjacency through `@/sim/world-map`'s own `routesFrom`/
 * `neighbourCityOf`, re-exported from `@/ui/buildings/shared`) — kept
 * module-private rather than exported a second, redundant way.
 *
 * `travelDaysFor` prices a route the IDENTICAL way `@/sim/road` already
 * does: it calls `@/sim/road`'s own exported `daysPerMile()` — the ruleset's
 * only existing "how long does city-to-city travel take" figure
 * (`economy().services.busToAdjacentCity.days`) scaled against cities.json's
 * average route length — rather than restating that formula a second time
 * and risking the two drifting apart. See tests/unit/world-map.test.ts,
 * which cross-checks this function's output against a REAL `beginRoadTrip`/
 * `stepRoadTrip` traversal of `@/sim/road` (not just a copy-pasted formula
 * asserting against itself).
 *
 * `shortestPathByDanger` prices an edge the same way `@/sim/road`'s own
 * `generateRouteContacts` prices a route's encounter load: `dangerLevels`'
 * `spawnsPerHundredMiles` (via `@/sim/road`'s exported `dangerLevel()`)
 * scaled by the route's own `lengthMiles`, never the raw per-route `danger`
 * rating alone — a long low-mileage-scaled road can carry fewer expected
 * encounters than several short high-rated ones, and the raw rating ignores
 * that entirely.
 */
import { citiesConfig } from '@/data/rulesets';
import { getCityDef } from '@/sim/city';
import { daysPerMile, dangerLevel } from '@/sim/road';
import type { RouteDef } from '@/sim/types';

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

/** Every cities.json city id, in cities.json's own listed order. Module-private: `dijkstra`'s own frontier sweep is the only caller. */
function allCityIds(): readonly string[] {
  return citiesConfig().cities.map((city) => city.id);
}

// ---------------------------------------------------------------------------
// Adjacency
// ---------------------------------------------------------------------------

/** cities.json's routes touching `cityId`, in cities.json's own listed order. Throws `UnknownRulesetIdError` (table `'city'`) for an id that isn't one of cities.json's authoritative entries. */
export function routesFrom(cityId: string): readonly RouteDef[] {
  getCityDef(cityId); // throws for an unknown city id
  return citiesConfig().routes.filter((route) => route.a === cityId || route.b === cityId);
}

/**
 * The city on the OTHER end of `route` from `fromCityId` (routes are
 * undirected — cities.json carries no separate reverse row per direction,
 * same assumption `@/sim/road`'s `resolveRoute` documents). Throws a
 * `RangeError` if `route` doesn't actually touch `fromCityId` at all — a
 * caller bug, not a data problem, so it isn't an `UnknownRulesetIdError`.
 */
export function neighbourCityOf(route: RouteDef, fromCityId: string): string {
  if (route.a === fromCityId) return route.b;
  if (route.b === fromCityId) return route.a;
  throw new RangeError(`world-map: route "${route.id}" does not touch city "${fromCityId}"`);
}

interface Neighbour {
  readonly cityId: string;
  readonly route: RouteDef;
}

/** `cityId`'s directly-connected neighbours, each resolved to the destination city id and the route leading there. Module-private: `dijkstra`'s own edge relaxation is the only caller — `@/ui/buildings/shared` already re-exports `routesFrom`/`neighbourCityOf` for a production caller that wants the same adjacency. Throws `UnknownRulesetIdError` (table `'city'`) for an unknown `cityId`. */
function neighbours(cityId: string): readonly Neighbour[] {
  return routesFrom(cityId).map((route) => ({ cityId: neighbourCityOf(route, cityId), route }));
}

// ---------------------------------------------------------------------------
// Travel-day pricing — delegates to @/sim/road's own exported day-cost rate
// rather than restating it (see the file header).
// ---------------------------------------------------------------------------

/**
 * The calendar-day cost of travelling `route` end to end, consistent with
 * how `@/sim/road`'s `stepRoadTrip` actually advances the clock: this is
 * `@/sim/road`'s own exported `daysPerMile()` times `route.lengthMiles`, so
 * a route four times longer costs four times as many days — never a
 * second, independently-invented mile-to-day constant.
 */
export function travelDaysFor(route: RouteDef): number {
  return route.lengthMiles * daysPerMile();
}

// ---------------------------------------------------------------------------
// Danger pricing — the encounter load an edge actually carries, not the raw
// per-route rating.
// ---------------------------------------------------------------------------

/**
 * The expected number of road encounters travelling `route` end to end,
 * priced the IDENTICAL way `@/sim/road`'s own `generateRouteContacts` prices
 * a real trip's encounter roll: `dangerLevels[route.danger].spawnsPerHundredMiles`
 * scaled by `route.lengthMiles / 100`. This — not the raw `danger` rating —
 * is what `shortestPathByDanger` minimizes, because a rating alone ignores
 * mileage: one long road rated high can carry FEWER expected encounters
 * than several short roads rated low.
 */
export function expectedSpawnsFor(route: RouteDef): number {
  return dangerLevel(route.danger).spawnsPerHundredMiles * (route.lengthMiles / 100);
}

// ---------------------------------------------------------------------------
// Shortest-path routing — quicker (by lengthMiles) vs safer (by accumulated
// danger). Both are the same weighted-graph Dijkstra over cities.json's
// undirected route list, differing only in which field of RouteDef prices
// an edge.
// ---------------------------------------------------------------------------

export interface RouteLeg {
  readonly route: RouteDef;
  readonly fromCityId: string;
  readonly toCityId: string;
}

export interface PathResult {
  /** Start city through destination city, inclusive, one entry per city visited. */
  readonly cityIds: readonly string[];
  /** One entry per route driven, in travel order. Empty when `fromCityId === toCityId`. */
  readonly legs: readonly RouteLeg[];
  readonly totalMiles: number;
  /** Sum of `expectedSpawnsFor` over every leg — the mileage-scaled expected encounter count `shortestPathByDanger` minimizes, NOT a sum of raw per-route `danger` ratings (see `expectedSpawnsFor`'s doc comment for why the rating alone is the wrong metric). */
  readonly totalDanger: number;
  readonly totalTravelDays: number;
}

export class NoPathError extends Error {
  override readonly name = 'NoPathError';
  constructor(
    readonly fromCityId: string,
    readonly toCityId: string,
  ) {
    super(`no path from "${fromCityId}" to "${toCityId}"`);
  }
}

type EdgeWeightFn = (route: RouteDef) => number;

interface DijkstraStep {
  readonly fromCityId: string;
  readonly route: RouteDef;
}

/**
 * Plain Dijkstra over cities.json's undirected route graph, weighted by
 * `weightFn`. Deterministic across runs: the frontier is always scanned in
 * a freshly-sorted, ascending-cityId array (never a `Map`'s or an object's
 * own enumeration order, which JS does not guarantee stays put across
 * engines/versions for arbitrary string keys), and only a STRICTLY smaller
 * tentative distance ever replaces the current best — so among several
 * cities tied for the smallest remaining distance, the lexicographically
 * first one is always the one settled next, and among several equal-cost
 * paths into the same city, whichever predecessor finalizes first (itself
 * decided by that same tie-break, all the way back to the start city) is
 * always the one kept. Same input always retraces the same tree.
 */
function dijkstra(fromCityId: string, weightFn: EdgeWeightFn): ReadonlyMap<string, DijkstraStep> {
  const cityIds = allCityIds().slice().sort();
  const dist = new Map<string, number>(cityIds.map((id) => [id, Infinity]));
  const prev = new Map<string, DijkstraStep>();
  dist.set(fromCityId, 0);
  const visited = new Set<string>();

  while (visited.size < cityIds.length) {
    let currentId: string | null = null;
    let currentDist = Infinity;
    for (const id of cityIds) {
      if (visited.has(id)) continue;
      const d = dist.get(id) ?? Infinity;
      if (d < currentDist) {
        currentDist = d;
        currentId = id;
      }
    }
    if (currentId === null || currentDist === Infinity) break; // remaining cities are unreachable from fromCityId
    visited.add(currentId);

    const edges = neighbours(currentId).slice().sort((a, b) => (a.cityId < b.cityId ? -1 : a.cityId > b.cityId ? 1 : 0));
    for (const edge of edges) {
      if (visited.has(edge.cityId)) continue;
      const candidate = currentDist + weightFn(edge.route);
      const existing = dist.get(edge.cityId) ?? Infinity;
      if (candidate < existing) {
        dist.set(edge.cityId, candidate);
        prev.set(edge.cityId, { fromCityId: currentId, route: edge.route });
      }
    }
  }

  return prev;
}

function reconstructPath(prev: ReadonlyMap<string, DijkstraStep>, fromCityId: string, toCityId: string): PathResult {
  if (fromCityId === toCityId) {
    return { cityIds: [fromCityId], legs: [], totalMiles: 0, totalDanger: 0, totalTravelDays: 0 };
  }

  const legs: RouteLeg[] = [];
  let cursor = toCityId;
  while (cursor !== fromCityId) {
    const step = prev.get(cursor);
    if (step === undefined) throw new NoPathError(fromCityId, toCityId);
    legs.push({ route: step.route, fromCityId: step.fromCityId, toCityId: cursor });
    cursor = step.fromCityId;
  }
  legs.reverse();

  const cityIds = [fromCityId, ...legs.map((leg) => leg.toCityId)];
  const totalMiles = legs.reduce((sum, leg) => sum + leg.route.lengthMiles, 0);
  const totalDanger = legs.reduce((sum, leg) => sum + expectedSpawnsFor(leg.route), 0);
  const totalTravelDays = legs.reduce((sum, leg) => sum + travelDaysFor(leg.route), 0);
  return { cityIds, legs, totalMiles, totalDanger, totalTravelDays };
}

/** Fewest total miles from `fromCityId` to `toCityId` — the "quicker" route the courier UI offers. Throws `UnknownRulesetIdError` (table `'city'`) for either unknown city id. */
export function shortestPathByMiles(fromCityId: string, toCityId: string): PathResult {
  getCityDef(fromCityId);
  getCityDef(toCityId);
  return reconstructPath(
    dijkstra(fromCityId, (route) => route.lengthMiles),
    fromCityId,
    toCityId,
  );
}

/**
 * Least total expected encounter load from `fromCityId` to `toCityId` — the
 * "safer" route the courier UI offers, which may well cover more miles than
 * `shortestPathByMiles`. Each edge is priced by `expectedSpawnsFor` (mileage-
 * scaled), never the raw per-route `danger` rating alone — see that
 * function's doc comment. Throws `UnknownRulesetIdError` (table `'city'`)
 * for either unknown city id.
 */
export function shortestPathByDanger(fromCityId: string, toCityId: string): PathResult {
  getCityDef(fromCityId);
  getCityDef(toCityId);
  return reconstructPath(dijkstra(fromCityId, expectedSpawnsFor), fromCityId, toCityId);
}
