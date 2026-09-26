/**
 * CITY VIEW: turns a read-only city snapshot into instances for the
 * existing `@/render/sprite` pipeline (ground tiles, building doorways, the
 * gate, the player, and a parked/driven car), plus the structured "why is
 * this closed" notice a closed daytime facility owes the player instead of
 * a silent refusal.
 *
 * Render-only in the same sense `@/render/**` is: `buildCityInstances`
 * never mutates its snapshot and never touches `@/sim/**` state — it only
 * reads `@/sim/city`'s plain-data types and turns them into
 * `SpriteInstanceInput`s via an already-loaded `AtlasIndex`. No new art:
 * every frame name below is one `assets/atlas.json` already ships (tiles,
 * `prop-city-gate`, `cycle-topdown` for the on-foot player, `car-<bodyId>`
 * for a vehicle — the same naming `src/app.ts`'s arena renderer uses).
 *
 * Display text is sourced through `@/ui/strings`'s existing `facilityName`
 * (itself backed by `t()` over `rulesets/classic/strings.json`) — this
 * module introduces no new hardcoded copy.
 */
import { drivingConfig, UnknownRulesetIdError } from '@/data/rulesets';
import { formatDate, isFacilityOpen, type Clock } from '@/sim/calendar';
import {
  alwaysOpenFacilityIn,
  getCityDef,
  nextFacilityOpenDayIndex,
  requireAt,
  type CityLayout,
  type CityPlayerState,
  type Doorway,
  type Gate,
} from '@/sim/city';
import type { Vec2 } from '@/sim/types';
import { facilityName } from '@/ui/strings';
import type { AtlasIndex } from '@/render/atlas';
import type { SpriteInstanceInput, Tint } from '@/render/sprite';

// ---------------------------------------------------------------------------
// Frame names (all already in assets/atlas.json — see the file header)
// ---------------------------------------------------------------------------

const GROUND_FRAME = 'tile-asphalt-clean';
const GATE_FRAME = 'prop-city-gate';
const PLAYER_FRAME = 'cycle-topdown';
/** Cycled deterministically per facility kind (see `facilityFrameFor`) so a city's buildings aren't all one identical roof. */
const BUILDING_FRAMES = ['tile-roof-residential', 'tile-roof-commercial', 'tile-roof-industrial'] as const;

/** Matches `src/app.ts`'s own arena vehicle sprite footprint, for visual consistency between the two screens the same car appears on. */
const VEHICLE_SPRITE_SIZE_M: Vec2 = { x: 3.2, y: 5.2 };

const LAYER_GROUND = 0;
const LAYER_BUILDING = 1;
const LAYER_ACTOR = 2;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

const WHITE_TINT: Tint = { r: 1, g: 1, b: 1, a: 1 };

/** Stable, deterministic pick of one of `BUILDING_FRAMES` per facility kind — same kind always renders the same roof, no RNG involved (this is presentation, not layout). */
function facilityFrameFor(facilityKind: string): string {
  let hash = 0;
  for (let i = 0; i < facilityKind.length; i++) {
    hash = (hash * 31 + facilityKind.charCodeAt(i)) >>> 0;
  }
  return requireAt(BUILDING_FRAMES, hash % BUILDING_FRAMES.length);
}

// ---------------------------------------------------------------------------
// Instance builders
// ---------------------------------------------------------------------------

function groundInstances(layout: CityLayout, atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const frame = atlasIndex.frame(GROUND_FRAME);
  const tile = layout.tileSizeM;
  const half = layout.boundsRadiusM + tile;
  const instances: SpriteInstanceInput[] = [];
  for (let y = -half; y <= half; y += tile) {
    for (let x = -half; x <= half; x += tile) {
      instances.push({
        atlasId: String(frame.atlasIndex),
        position: { x, y },
        rotationRad: 0,
        sizeM: { x: tile, y: tile },
        uvRect: frame.uv,
        tint: WHITE_TINT,
        layer: LAYER_GROUND,
      });
    }
  }
  return instances;
}

function buildingInstance(doorway: Doorway, atlasIndex: AtlasIndex, tileSizeM: number): SpriteInstanceInput {
  const frame = atlasIndex.frame(facilityFrameFor(doorway.facilityKind));
  return {
    atlasId: String(frame.atlasIndex),
    position: { ...doorway.position },
    rotationRad: 0,
    sizeM: { x: tileSizeM, y: tileSizeM },
    uvRect: frame.uv,
    tint: WHITE_TINT,
    layer: LAYER_BUILDING,
  };
}

function gateInstance(gate: Gate, atlasIndex: AtlasIndex, tileSizeM: number): SpriteInstanceInput {
  const frame = atlasIndex.frame(GATE_FRAME);
  return {
    atlasId: String(frame.atlasIndex),
    position: { ...gate.position },
    rotationRad: 0,
    sizeM: { x: tileSizeM, y: tileSizeM },
    uvRect: frame.uv,
    tint: WHITE_TINT,
    layer: LAYER_BUILDING,
  };
}

function playerInstance(player: CityPlayerState, atlasIndex: AtlasIndex): SpriteInstanceInput {
  const frame = atlasIndex.frame(PLAYER_FRAME);
  // Sized to its own collider (driving.json's pedestrian.colliderRadiusM),
  // not an invented literal.
  const size = drivingConfig().pedestrian.colliderRadiusM * 2;
  return {
    atlasId: String(frame.atlasIndex),
    position: { ...player.position },
    rotationRad: player.headingRad + degToRad(frame.rotationOffsetDeg),
    sizeM: { x: size, y: size },
    uvRect: frame.uv,
    tint: WHITE_TINT,
    layer: LAYER_ACTOR,
  };
}

export interface CityVehicleView {
  readonly position: Vec2;
  readonly headingRad: number;
  readonly bodyId: string;
}

function vehicleInstance(vehicle: CityVehicleView, atlasIndex: AtlasIndex): SpriteInstanceInput {
  const frame = atlasIndex.frame(`car-${vehicle.bodyId}`);
  return {
    atlasId: String(frame.atlasIndex),
    position: { ...vehicle.position },
    rotationRad: vehicle.headingRad + degToRad(frame.rotationOffsetDeg),
    sizeM: VEHICLE_SPRITE_SIZE_M,
    uvRect: frame.uv,
    tint: WHITE_TINT,
    layer: LAYER_ACTOR,
  };
}

/** Read-only view of everything `buildCityInstances` needs for one frame. Never mutated by this module. */
export interface CityViewSnapshot {
  readonly layout: CityLayout;
  readonly player: CityPlayerState;
  /** The player's active owned car, if it's parked (or being driven) in this city; `null` if none is here. */
  readonly vehicle: CityVehicleView | null;
}

/**
 * Builds one frame's `SpriteInstanceInput`s for the existing sprite/tile
 * pipeline (`@/render/sprite`'s `buildFrameInstanceBuffers` /
 * `encodeTerrainPass` / `encodeSpritePass` consume this): ground tiles
 * (layer 0), every doorway plus the gate (layer 1), and the player — riding
 * the car when `player.inVehicle`, on foot otherwise — on top (layer 2).
 * Pure: reads `snapshot` and `atlasIndex`, never writes either.
 */
export function buildCityInstances(snapshot: CityViewSnapshot, atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const { layout, player, vehicle } = snapshot;

  const instances: SpriteInstanceInput[] = [...groundInstances(layout, atlasIndex), gateInstance(layout.gate, atlasIndex, layout.tileSizeM)];
  for (const doorway of layout.doorways) {
    instances.push(buildingInstance(doorway, atlasIndex, layout.tileSizeM));
  }

  if (vehicle !== null && !player.inVehicle) {
    instances.push(vehicleInstance(vehicle, atlasIndex));
  }
  if (player.inVehicle && vehicle !== null) {
    instances.push(vehicleInstance({ ...vehicle, position: player.position, headingRad: player.headingRad }, atlasIndex));
  } else {
    instances.push(playerInstance(player, atlasIndex));
  }

  return instances;
}

// ---------------------------------------------------------------------------
// Closed-facility notice
// ---------------------------------------------------------------------------

/**
 * What to tell the player about trying to enter `facilityKind` in
 * `cityId` right now, instead of a silent refusal: whether it's open, and
 * if not, when it reopens (`nextOpenDate`, via `@/sim/calendar`'s
 * `formatDate`) and which of this city's facilities is open around the
 * clock instead (`alternativeLabel`, `null` only if the city genuinely has
 * no always-open facility). Every label is sourced through
 * `@/ui/strings`'s `facilityName` — no hardcoded copy.
 *
 * Throws `UnknownRulesetIdError` (table `'cityFacility'`) when `cityId`
 * doesn't actually list `facilityKind` among `cities.json`'s
 * `facilities` — e.g. asking about a casino in a city that has none. This
 * mirrors `isFacilityOpen`'s own refusal to silently guess: a mismatched
 * (cityId, facilityKind) pair is a bug at the call site (a building menu
 * offering an entry the city doesn't have), not a fact this function
 * should paper over with a confident, fully-formed, wrong notice.
 */
export interface FacilityAccessNotice {
  readonly open: boolean;
  readonly facilityLabel: string;
  readonly nextOpenDate: string | null;
  readonly alternativeLabel: string | null;
}

export function describeFacilityAccess(cityId: string, facilityKind: string, clock: Clock): FacilityAccessNotice {
  const city = getCityDef(cityId);
  if (!city.facilities.includes(facilityKind)) {
    throw new UnknownRulesetIdError('cityFacility', `${cityId}:${facilityKind}`);
  }

  const facilityLabel = facilityName(facilityKind);

  if (isFacilityOpen(facilityKind, clock)) {
    return { open: true, facilityLabel, nextOpenDate: null, alternativeLabel: null };
  }

  const nextOpenDate = formatDate(nextFacilityOpenDayIndex(clock));
  const alternative = alwaysOpenFacilityIn(cityId);
  const alternativeLabel = alternative === null ? null : facilityName(alternative);

  return { open: false, facilityLabel, nextOpenDate, alternativeLabel };
}
