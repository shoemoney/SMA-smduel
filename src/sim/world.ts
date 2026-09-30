/**
 * World state container: the single source of truth the fixed-tick loop
 * (`@/sim/loop`) mutates once per tick. Plain data only — arrays are the
 * canonical store for each entity kind, id maps are derived on demand for
 * O(1) lookup, and nothing here is a class with hidden state. Every other
 * sim module (driving, weapons, projectiles, deployables, damage, ai,
 * cleanup) reads and writes this shape through the systems registry
 * exported by `@/sim/loop`.
 *
 * `sim/types.ts` already holds the shared domain types (VehicleState,
 * GameClock, Vec2, ...). The runtime-only entity shapes below (projectiles,
 * deployables, clouds, wrecks, pedestrians) don't have a home there yet, so
 * they live here, next to the container that owns their arrays.
 */
import { hashState } from '@/util/hash';
import { initialClock } from '@/sim/calendar';
import { createRng } from '@/util/rng';
import type { GameClock, Vec2, VehicleState } from '@/sim/types';
import type { RngState } from '@/util/rng';
import type { DeployableState, ProjectileState } from '@/sim/combat';

/** Re-exported so callers can name the world's RNG state type without reaching into `@/util/rng` directly. */
export type { RngState } from '@/util/rng';

/**
 * Re-exported so callers can name the world's projectile/deployable entity
 * types without reaching into `@/sim/combat` directly. These are NOT defined
 * here: `@/sim/combat`'s `fire()` pipeline is what actually constructs and
 * advances them (spawnProjectile/advanceProjectile/spawnDeployable), so the
 * world's entity arrays hold exactly the shape that pipeline produces
 * instead of a second, incompatible placeholder shape.
 */
export type { DeployableState, ProjectileState } from '@/sim/combat';

// ---------------------------------------------------------------------------
// Runtime-only entity shapes
// ---------------------------------------------------------------------------

export interface CloudState {
  id: string;
  kind: string;
  position: Vec2;
  radiusM: number;
  ticksRemaining: number;
}

export interface WreckState {
  id: string;
  position: Vec2;
  headingRad: number;
  ticksRemaining: number;
}

export interface PedestrianState {
  id: string;
  position: Vec2;
  headingRad: number;
  alive: boolean;
}

// ---------------------------------------------------------------------------
// World shape
// ---------------------------------------------------------------------------

export type ArenaKind = 'arena' | 'route';

/** Which arena or inter-city route this world's tick loop is simulating. */
export interface ArenaContext {
  id: string;
  kind: ArenaKind;
}

export interface WorldEntities {
  vehicles: VehicleState[];
  projectiles: ProjectileState[];
  deployables: DeployableState[];
  clouds: CloudState[];
  wrecks: WreckState[];
  pedestrians: PedestrianState[];
  /**
   * The vehicle-id PAIRS that were overlapping at the END of the previous tick
   * (`resolveVehicleCollisions` writes it every tick, from the overlap set it
   * actually resolved). A collision's armor loss is an IMPACT, so it is charged
   * only on the first tick a pair is in contact — without this, two cars closing
   * faster than `collision.vehicleSeparationM` can nudge them apart re-overlap
   * every single tick and each one silently loses `armorLossPoints` per tick for
   * as long as the contact lasts. A plain array of `"idA|idB"` strings (ids
   * sorted, so the key is order-independent) rather than a `Set`, because every
   * `World` field must stay plain data that survives structuredClone/JSON.
   */
  contactPairs: string[];
}

export interface World {
  tick: number;
  clock: GameClock;
  rngState: RngState;
  entities: WorldEntities;
  arena: ArenaContext;
}

function emptyEntities(): WorldEntities {
  return {
    vehicles: [],
    projectiles: [],
    deployables: [],
    clouds: [],
    wrecks: [],
    pedestrians: [],
    contactPairs: [],
  };
}

export interface CreateWorldOptions {
  rngSeed: number;
  arena: ArenaContext;
  clock?: GameClock;
  entities?: Partial<WorldEntities>;
}

/**
 * Builds a fresh World. Every field is plain data — safe to structuredClone or JSON round-trip.
 *
 * `options.clock` defaults to a freshly-built `initialClock()` — never a shared module-level
 * constant. A shared literal would be handed out BY REFERENCE to every world built without an
 * explicit clock, so two independently-created worlds would alias the same mutable clock object
 * and any system that advances one world's clock would silently advance the other's too.
 */
export function createWorld(options: CreateWorldOptions): World {
  const base = emptyEntities();
  const overrides = options.entities;
  return {
    tick: 0,
    clock: options.clock ?? initialClock(),
    rngState: createRng(options.rngSeed).serialize(),
    entities: {
      vehicles: overrides?.vehicles ?? base.vehicles,
      projectiles: overrides?.projectiles ?? base.projectiles,
      deployables: overrides?.deployables ?? base.deployables,
      clouds: overrides?.clouds ?? base.clouds,
      wrecks: overrides?.wrecks ?? base.wrecks,
      pedestrians: overrides?.pedestrians ?? base.pedestrians,
      contactPairs: overrides?.contactPairs ?? base.contactPairs,
    },
    arena: options.arena,
  };
}

// ---------------------------------------------------------------------------
// Id maps — derived on demand, never stored. The array stays canonical and
// iteration order stays meaningful for determinism; this is just a cheap
// lookup view over it for the tick a system needs one.
// ---------------------------------------------------------------------------

export function buildEntityIndex<T extends { id: string }>(rows: readonly T[]): ReadonlyMap<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    index.set(row.id, row);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Determinism snapshot
// ---------------------------------------------------------------------------

/**
 * Structural fingerprint of the whole world. Two independent runs fed the
 * same input stream from the same seed must produce identical snapshot
 * sequences, tick for tick — that's what the loop tests assert.
 */
export function snapshot(world: World): string {
  return hashState(world);
}

// ---------------------------------------------------------------------------
// Render interpolation — render-only, never mutates the world and never
// runs from inside step(). src/render/** calls this; it must never compute
// damage, hits, movement, or RNG itself.
// ---------------------------------------------------------------------------

export interface RenderVehiclePose {
  id: string;
  position: Vec2;
  headingRad: number;
}

export interface RenderFrame {
  vehicles: RenderVehiclePose[];
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

const TAU = Math.PI * 2;

/** Shortest-path angle interpolation, so a heading never spins the long way round through the wrap point. */
function lerpAngle(a: number, b: number, alpha: number): number {
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return a + delta * alpha;
}

/**
 * Blends `prev` and `cur` vehicle poses by `alpha` (the loop's
 * accumulator/dt) for smooth rendering between fixed ticks. A vehicle
 * present in `cur` but not `prev` (just spawned) renders at its current
 * pose with no blending.
 */
export function interpolate(prev: World, cur: World, alpha: number): RenderFrame {
  const clampedAlpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  const prevIndex = buildEntityIndex(prev.entities.vehicles);
  const vehicles: RenderVehiclePose[] = cur.entities.vehicles.map((vehicle) => {
    const previous = prevIndex.get(vehicle.id);
    if (previous === undefined) {
      return { id: vehicle.id, position: { ...vehicle.position }, headingRad: vehicle.headingRad };
    }
    return {
      id: vehicle.id,
      position: {
        x: lerp(previous.position.x, vehicle.position.x, clampedAlpha),
        y: lerp(previous.position.y, vehicle.position.y, clampedAlpha),
      },
      headingRad: lerpAngle(previous.headingRad, vehicle.headingRad, clampedAlpha),
    };
  });
  return { vehicles };
}
