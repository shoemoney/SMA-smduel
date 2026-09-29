/**
 * CITY VIEW: turns a read-only city snapshot into instances for the
 * existing `@/render/sprite` pipeline (the ground field, every facility's own
 * hand-painted footprint, a perimeter wall, street furniture, the gate, the
 * player, and a parked/driven car), plus the structured "why is this closed"
 * notice a closed daytime facility owes the player instead of a silent
 * refusal.
 *
 * Render-only in the same sense `@/render/**` is: `buildCityInstances` never
 * mutates its snapshot and never touches `@/sim/**` state — it only reads
 * `@/sim/city`'s plain-data types and turns them into `SpriteInstanceInput`s
 * via an already-loaded `AtlasIndex`. It adds no art: every frame name below
 * is one `assets/atlas.json` already ships.
 *
 * THE FACILITY -> FOOTPRINT MAP IS THE WHOLE POINT. The atlas packs 16
 * individually-authored `building-*` facility footprints (one per
 * `cities.json` `facilityKinds` entry, plus a spare `building-arena-small`),
 * and this module used to ignore every one of them — it hashed the facility
 * kind string down to 1 of 3 generic `tile-roof-*` squares, so a bar rendered
 * as a generic brown roof. Sixteen paid-for, correct-per-facility drawings
 * were sitting in the atlas with zero draw calls. `FACILITY_BUILDING_FRAMES`
 * is now the explicit kind -> frame table, and the hash is gone.
 *
 * DETERMINISM. No `Math.random()`, no `Date.now()` — the sim is seeded and has
 * to replay identically. Every piece of dressing is placed on a concentric
 * ring around the doorway ring and its *presence* and *kind* are decided by
 * `placementHash`, an integer mix of the ring's index and the slot's index:
 * the same (ring, slot) always yields the same prop, forever. This mirrors
 * `@/render/ground`'s own `cellHash2`, duplicated rather than shared because
 * `src/render/**`'s ZERO-IMPORTS invariant means it cannot reach `@/util`, and
 * this file is outside `src/render/**` so it cannot be imported from there
 * without that invariant breaking.
 *
 * NOTHING SITS IN A TRIGGER CIRCLE. `clearsTriggers` is the gate, and every
 * ring radius below is chosen so the wall, the streetlights and the dressing
 * all clear `pedestrian.interactionRadiusM` by construction — the rings are
 * pushed `>= DRESSING_MIN_SETBACK_M` metres OUTWARD past the doorway ring,
 * and the closest a point on an outward ring can be to a doorway is the
 * setback itself, so the clearance is an identity rather than a hope. The one
 * deliberate exception is `prop-doormarker`, whose entire job is to mark the
 * door it sits under.
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
import { groundQuad, GROUND_TILE_METRES } from '@/render/ground';
import type { SpriteInstanceInput, Tint } from '@/render/sprite';

// ---------------------------------------------------------------------------
// Frame names (all already in assets/atlas.json — see the file header)
// ---------------------------------------------------------------------------

const GATE_FRAME = 'prop-city-gate';
const PLAYER_FRAME = 'cycle-topdown';
const WALL_FRAME = 'prop-citywall';

/**
 * Every `cities.json` `facilityKinds` entry, and the hand-painted footprint
 * authored FOR IT. Keys are the 15 kinds in `rulesets/classic/cities.json`'s
 * `facilityKinds` array, which is the authoritative list (`@/data/rulesets`'s
 * `hasFacilityKind` tests membership against that same array); values are
 * verified to exist in `assets/atlas.json` as `kind: "building"` frames.
 *
 * All 15 have a natural frame, so `FALLBACK_BUILDING_FRAME` is not reached by
 * any shipped ruleset. It exists only so a future `facilityKinds` addition
 * degrades to one obviously-wrong-but-valid building instead of throwing
 * `UnknownAtlasFrameError` and taking the whole city screen down.
 */
const FACILITY_BUILDING_FRAMES: Readonly<Record<string, string>> = {
  garage: 'building-garage',
  weaponshop: 'building-weaponshop',
  arena: 'building-arena',
  salvage: 'building-salvage',
  bar: 'building-bar',
  medical: 'building-medical',
  assembly: 'building-assembly',
  courierguild: 'building-courierguild',
  truckstop: 'building-truckstop',
  casino: 'building-casino',
  hotel: 'building-hotel',
  federal: 'building-federal',
  story: 'building-story',
  studio: 'building-studio',
  petshop: 'building-petshop',
};
const FALLBACK_BUILDING_FRAME = 'building-assembly';

/**
 * Footprints for decorative infill buildings, in metres.
 *
 * These are deliberately LARGER than a facility's `layout.tileSizeM` (~4.5m),
 * which is the whole point: a 4.5m building next to a 5.2m car means the car is
 * longer than the building is wide, and a top-down city reads as nonsense when
 * that is true. A real building footprint is several car-widths across.
 *
 * The range is kept modest (5.5m..9.5m) so a filler still fits the gaps between
 * the facility ring and the wall without swallowing the perimeter road, and
 * varied enough that a block of them does not look stamped.
 */
const FILLER_SIZES_M: readonly Vec2[] = [
  { x: 7.5, y: 6.5 },
  { x: 6.0, y: 8.5 },
  { x: 9.5, y: 7.0 },
  { x: 5.5, y: 7.5 },
];

/**
 * Frames the infill may reuse — every name verified present in `assets/atlas.json`.
 *
 * These are the authored facility footprints, drawn square. `building-assembly`
 * is in the list as a catch-all so an unmapped kind still renders, matching
 * FALLBACK_BUILDING_FRAME's role for real facilities.
 *
 * Do not add a name here without checking the atlas. A frame name that is not in
 * the manifest makes `atlasIndex.frame()` throw on the first city render, which
 * is a confusing way to discover a typo — and it throws for EVERY city, so it
 * reads as "the city screen is broken" rather than "this array has a bad entry".
 */
const FILLER_FRAMES: readonly string[] = [
  'building-garage',
  'building-truckstop',
  'building-assembly',
  'building-salvage',
  'building-story',
  'building-studio',
  'building-arena',
  'building-petshop',
];

/** Matches `src/app.ts`'s own arena vehicle sprite footprint, for visual consistency between the two screens the same car appears on. */
const VEHICLE_SPRITE_SIZE_M: Vec2 = { x: 3.2, y: 5.2 };

const LAYER_GROUND = 0;
const LAYER_BUILDING = 1;
const LAYER_ACTOR = 2;

// ---------------------------------------------------------------------------
// Ground field
// ---------------------------------------------------------------------------

/** The `@/render/ground` pool: paving + asphalt, with parking and oil as punctuation. */
export const CITY_GROUND_POOL = 'city';
/** The plaza is centred on the world origin (`@/sim/city` lays every doorway out as `radius * (cos, sin)` and never offsets the centre). */
export const CITY_GROUND_CENTER_M: Vec2 = { x: 0, y: 0 };
/**
 * Ground cell edge, in metres. Deliberately NOT `layout.tileSizeM` (3m): at
 * `app.ts`'s 14 CSS px/m a 3m cell is 42 screen px showing a 256px tile, and
 * the city sampler is `nearest`, so 3m cells minify ~6x into speckle. 5m
 * lands at 70px — 3.7x — and still gives ~4 cells across the widest plaza.
 */
export const CITY_GROUND_CELL_SIZE_M = 8;
/**
 * Half-extent of the ground field, in metres. The old grid covered only
 * `boundsRadiusM + tileSizeM` (~13.6m for New York) while the camera at
 * 14 px/m sees ~69m of half-width on a 1920px viewport — that mismatch is the
 * black screen the city used to sit on. 96m covers a ~2688px-wide viewport at
 * full zoom; the field is world-aligned, so it never crawls as the camera pans.
 */
export const CITY_GROUND_HALF_EXTENT_M = 60;
/** Per-cell brightness jitter; breaks up the flat value a 5-frame/4-rotation/2-flip pool otherwise has. */
export const CITY_GROUND_VALUE_JITTER = 0.06;
/** Distinct from `@/render/ground`'s own default salt so the city field is not a clone of the road/arena one. */
export const CITY_GROUND_SALT = 0x0c17b1a5;

// ---------------------------------------------------------------------------
// Contact shadows
// ---------------------------------------------------------------------------

/**
 * The scene has no lighting, so `sprite.wgsl` IS the lighting model: an
 * instance with `shadowSoftness > 0` replaces its own colour with a radial
 * falloff computed from the quad's local position (see the shader's `fs_main`),
 * which means a shadow costs no atlas frame and no new draw call — it is just
 * another instance carrying the same `uvRect`, tinted black, emitted
 * IMMEDIATELY BEFORE the thing it shadows so painter's-algorithm order within
 * the layer puts it underneath.
 *
 * It also means the sampled texture is ignored entirely, so the shadow is a
 * soft ellipse, not the sprite's silhouette. It therefore has to be grown
 * past the object's own footprint and pushed away from the light, or the
 * object paints straight back over all of it.
 */
/**
 * How much bigger a shadow is than its caster.
 *
 * This was 1.16, which is the same mistake `src/app.ts` had: at 1.16 the soft
 * disc barely clears the opaque sprite painting over it, so a vehicle's shadow
 * was a sub-pixel rim and a building's was a thin outline. It needs enough
 * growth that a clear band of shadow survives past the caster on the shadow
 * side, which for the 3.2 x 5.2 m car means roughly 1.9.
 */
const SHADOW_GROWTH = 1.9;
/**
 * Light from the upper-left, so shadows fall down-right (+x, -y in the Y-up
 * world). Sized to actually clear the caster: at the old 0.55/-0.5 the offset
 * was smaller than the shadow's own margin, so almost none of it was visible.
 */
const SHADOW_OFFSET_M: Vec2 = { x: 1.0, y: -0.9 };
const BUILDING_SHADOW_SOFTNESS = 0.8;
const BUILDING_SHADOW_OPACITY = 0.42;
const VEHICLE_SHADOW_SOFTNESS = 0.7;
const VEHICLE_SHADOW_OPACITY = 0.5;

// ---------------------------------------------------------------------------
// Ring geometry
//
// `layout.boundsRadiusM` is the doorway ring's radius AND the wall `@/sim/city`
// clamps the player to. Everything below is expressed as a SETBACK outward
// from that ring, so the whole composition scales correctly from Providence
// (R = 6m) to New York (R = 10.65m) with no per-city tuning.
// ---------------------------------------------------------------------------

/**
 * Every ring below carries the invariant `setbackM >= interactionRadiusM +
 * boundingRadiusM(sizeM)`, so a point on the ring can never be closer to a
 * doorway than its own footprint's radius — i.e. `clearsTriggers` can never
 * reject a slot, and the wall/dressing are non-negotiable rather than
 * best-effort. The point is checked at runtime anyway; making it an
 * invariant is what keeps the buffer count exact instead of approximately so.
 *
 * The bands (innermost first) are: streetlights 3.24-4.76m, barricades
 * 4.12-5.68m, barriers 5.21-6.59m, fence posts 6.55-7.25m, wall 7.6-8.4m —
 * a 6.1m perimeter road between the building ring and the wall, which is what
 * makes the wall read as a city's edge rather than a fence around a table.
 */
/**
 * Metres from the facility ring outward to the wall.
 *
 * Exported because the camera framing has to know the city's true outer
 * radius, and it cannot derive it from `boundsRadiusM` alone — see
 * `cityZoomPxPerM` in src/app.ts.
 */
export const WALL_SETBACK_M = 8;
const WALL_THICKNESS_M = 0.8;
/** `prop-citywall` is 25x96 px, so thickness fixes length at `WALL_THICKNESS_M * 96/25`. */
const WALL_ASPECT = 96 / 25;
const WALL_MIN_SEGMENTS = 16;

const STREETLIGHT_FRAME = 'prop-streetlight';
const STREETLIGHT_SETBACK_M = 4;
const STREETLIGHT_SPACING_M = 7;
/** 18x96 px art. Long axis is local Y, which `rotationRad = angle` maps onto the ring's tangent. */
const STREETLIGHT_SIZE_M: Vec2 = { x: 0.28, y: 1.5 };

/** Sparse perimeter dressing. One prop every `period` slots, chosen by hash. */
interface DressingRing {
  readonly frame: string;
  readonly sizeM: Vec2;
  /** Added to the slot's own angle, to turn the art's long axis tangential to the ring. */
  readonly rotationOffsetRad: number;
  readonly setbackM: number;
  /** Arc per slot in metres, and how many slots must pass between two props. */
  readonly spacingM: number;
  readonly period: number;
}

const DRESSING_RINGS: readonly DressingRing[] = [
  { frame: 'prop-barricade', sizeM: { x: 1.5, y: 0.44 }, rotationOffsetRad: Math.PI / 2, setbackM: 4.9, spacingM: 4.5, period: 7 },
  { frame: 'prop-concrete-barrier', sizeM: { x: 1.3, y: 0.64 }, rotationOffsetRad: Math.PI / 2, setbackM: 5.9, spacingM: 5.5, period: 9 },
  { frame: 'prop-fence-post', sizeM: { x: 0.5, y: 0.5 }, rotationOffsetRad: 0, setbackM: 6.9, spacingM: 3, period: 5 },
];

/** `prop-doormarker` (96x90 px) as a doorstep mat on each building's inner face. */
const DOORMARKER_FRAME = 'prop-doormarker';
const DOORMARKER_SIZE_M: Vec2 = { x: 1.4, y: 1.31 };

const WHITE_TINT: Tint = { r: 1, g: 1, b: 1, a: 1 };
const BLACK_TINT: Tint = { r: 0, g: 0, b: 0, a: 1 };

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function distanceM(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polar(radiusM: number, angleRad: number): Vec2 {
  return { x: radiusM * Math.cos(angleRad), y: radiusM * Math.sin(angleRad) };
}

function angleOf(point: Vec2): number {
  return Math.atan2(point.y, point.x);
}

/**
 * A stable integer-mix hash in [0,1), keyed on discrete slot coordinates.
 *
 * Integer maths rather than the `fract(sin(...))` family on purpose: that one
 * is precision-hostile and drifts between GPUs/backends, and this hash has to
 * be bit-identical on every replay. Same shape as `@/render/ground`'s
 * `cellHash2`, which cannot be imported (see the file header).
 */
function placementHash(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) >>> 0;
  h = (h ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (c | 0), 0x2545f491) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h >>> 0) / 4294967296;
}

/** The real `building-*` frame for `facilityKind`, or `building-assembly` for a kind cities.json has no drawing for. */
function facilityFrameFor(facilityKind: string): string {
  return FACILITY_BUILDING_FRAMES[facilityKind] ?? FALLBACK_BUILDING_FRAME;
}

// ---------------------------------------------------------------------------
// Trigger-clearance gate
// ---------------------------------------------------------------------------

/** Every point the sim will fire a doorway/gate trigger from. */
function triggerCenters(layout: CityLayout): readonly Vec2[] {
  return [...layout.doorways.map((doorway) => doorway.position), layout.gate.position];
}

/**
 * True when a prop of bounding radius `radiusM` at `position` leaves every
 * doorway's and the gate's `pedestrian.interactionRadiusM` circle intact.
 *
 * The prop's own bounding radius is added to the trigger radius, so this is
 * the conservative "no part of the prop is inside the circle" test rather
 * than a centre-only one — a 1.6m-radius wall segment and a 0.76m streetlight
 * are judged by the same rule, so a big prop cannot quietly poke into a
 * radius that a small one respects.
 */
function clearsTriggers(layout: CityLayout, position: Vec2, radiusM: number): boolean {
  const interactionRadiusM = drivingConfig().pedestrian.interactionRadiusM;
  for (const center of triggerCenters(layout)) {
    if (distanceM(position, center) < interactionRadiusM + radiusM) return false;
  }
  return true;
}

function boundingRadiusM(sizeM: Vec2): number {
  return Math.hypot(sizeM.x, sizeM.y) / 2;
}

// ---------------------------------------------------------------------------
// Instance builders
// ---------------------------------------------------------------------------

/**
 * Darkening applied to the city's ground sample.
 *
 * The city pool had to change texture — `tile-asphalt-clean` carries a painted
 * dashed highway centre line, and tiling that across a walled compound drew a
 * motorway straight through the perimeter wall (see the pool's own note in
 * @/render/ground). `tile-asphalt-cracked` has no markings, but it is a much
 * paler grey: swapping it lifted the city's mean luma from 78 to 130 and cost
 * the buildings their contrast against the ground they sit on.
 *
 * This restores the value without touching the texture. It only has any effect
 * because the ground branch of sprite.wgsl was fixed to read `tint.rgb`; before
 * that it silently discarded the tint, which is why this constant is worth a
 * comment rather than being a bare number.
 */
const CITY_GROUND_TINT = { r: 0.6, g: 0.63, b: 0.68, a: 1 } as const;

function groundInstances(atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const scale = GROUND_TILE_METRES[CITY_GROUND_POOL] ?? { tileMetres: 30, detailScale: 11.3 };
  return [
    groundQuad(atlasIndex, {
      pool: CITY_GROUND_POOL,
      center: CITY_GROUND_CENTER_M,
      halfExtentM: CITY_GROUND_HALF_EXTENT_M,
      tileMetres: scale.tileMetres,
      detailScale: scale.detailScale,
      layer: LAYER_GROUND,
      tint: CITY_GROUND_TINT,
    }),
  ];
}

/**
 * A contact shadow for `sizeM` at `position`/`rotationRad`, reusing that
 * thing's `uvRect`. Emitted immediately before the object it shadows.
 */
function shadowInstance(
  frame: { readonly atlasIndex: number; readonly uv: SpriteInstanceInput['uvRect'] },
  position: Vec2,
  rotationRad: number,
  sizeM: Vec2,
  softness: number,
  opacity: number,
  layer: number,
): SpriteInstanceInput {
  return {
    atlasId: String(frame.atlasIndex),
    position: { x: position.x + SHADOW_OFFSET_M.x, y: position.y + SHADOW_OFFSET_M.y },
    rotationRad,
    sizeM: { x: sizeM.x * SHADOW_GROWTH, y: sizeM.y * SHADOW_GROWTH },
    uvRect: frame.uv,
    tint: BLACK_TINT,
    layer,
    shadowSoftness: softness,
    shadowOpacity: opacity,
  };
}

function spriteInstance(
  frame: { readonly atlasIndex: number; readonly uv: SpriteInstanceInput['uvRect'] },
  position: Vec2,
  rotationRad: number,
  sizeM: Vec2,
  layer: number,
): SpriteInstanceInput {
  return {
    atlasId: String(frame.atlasIndex),
    position: { x: position.x, y: position.y },
    rotationRad,
    sizeM,
    uvRect: frame.uv,
    tint: WHITE_TINT,
    layer,
  };
}

/** One resolved slot of street furniture, before it is turned into an instance. */
interface PropPlacement {
  readonly frame: string;
  readonly position: Vec2;
  readonly rotationRad: number;
  readonly sizeM: Vec2;
}

/**
 * The wall, the streetlights and the sparse dressing, in draw order, from a
 * SINGLE enumeration of slots.
 *
 * `cityLayer1InstanceCount` walks this same function rather than
 * re-deriving the counts, so the number `src/app.ts` sizes its buffer from
 * cannot drift from what is actually emitted — a fixed GPU buffer under-filled
 * is a WebGPU validation error, and a count that had to be kept in sync with
 * three separate loops is exactly how that happens.
 *
 * Determinism comes from the slot geometry, not an RNG: each ring's radius and
 * slot count are pure functions of `boundsRadiusM`, and whether a dressing slot
 * carries anything (and which frame) is `placementHash(ringIndex, slot, salt)`.
 */
function furniturePlacements(layout: CityLayout): PropPlacement[] {
  const out: PropPlacement[] = [];

  // The perimeter wall: a closed ring of `prop-citywall` segments. Segment
  // COUNT comes from the circumference and LENGTH is re-derived from that
  // count, so the ring closes with no seam at Providence's radius and no
  // overlap of the art at New York's. `prop-citywall`'s long axis is local Y,
  // and rotating by the slot's own angle maps local Y onto the circle's
  // tangent, which is what puts the wall's face outward.
  const wallRadiusM = layout.boundsRadiusM + WALL_SETBACK_M;
  const wallCount = Math.max(WALL_MIN_SEGMENTS, Math.round((2 * Math.PI * wallRadiusM) / (WALL_THICKNESS_M * WALL_ASPECT)));
  const wallSizeM: Vec2 = { x: WALL_THICKNESS_M, y: (2 * Math.PI * wallRadiusM) / wallCount };
  for (let slot = 0; slot < wallCount; slot++) {
    const angle = (2 * Math.PI * slot) / wallCount;
    const position = polar(wallRadiusM, angle);
    if (!clearsTriggers(layout, position, boundingRadiusM(wallSizeM))) continue;
    out.push({ frame: WALL_FRAME, position, rotationRad: angle, sizeM: wallSizeM });
  }

  // Streetlights ring the inside of the wall.
  const streetlightRadiusM = layout.boundsRadiusM + STREETLIGHT_SETBACK_M;
  const streetlightCount = Math.max(8, Math.round((2 * Math.PI * streetlightRadiusM) / STREETLIGHT_SPACING_M));
  for (let slot = 0; slot < streetlightCount; slot++) {
    const angle = (2 * Math.PI * slot) / streetlightCount;
    const position = polar(streetlightRadiusM, angle);
    if (!clearsTriggers(layout, position, boundingRadiusM(STREETLIGHT_SIZE_M))) continue;
    out.push({ frame: STREETLIGHT_FRAME, position, rotationRad: angle, sizeM: STREETLIGHT_SIZE_M });
  }

  // Sparse dressing. The hash is salted per ring so two rings sharing a slot
  // count do not end up with a hole at the same index.
  for (let ringIndex = 0; ringIndex < DRESSING_RINGS.length; ringIndex++) {
    const ring = requireAt(DRESSING_RINGS, ringIndex);
    const radiusM = layout.boundsRadiusM + ring.setbackM;
    const count = Math.max(8, Math.round((2 * Math.PI * radiusM) / ring.spacingM));
    for (let slot = 0; slot < count; slot++) {
      // One prop every `ring.period` slots.
      if (Math.floor(placementHash(ringIndex, slot, 0x51ed) * ring.period) !== 0) continue;
      const angle = (2 * Math.PI * slot) / count;
      const position = polar(radiusM, angle);
      if (!clearsTriggers(layout, position, boundingRadiusM(ring.sizeM))) continue;
      out.push({ frame: ring.frame, position, rotationRad: angle + ring.rotationOffsetRad, sizeM: ring.sizeM });
    }
  }

  return out;
}

/**
 * Filler buildings, each with its own contact shadow.
 *
 * Split out from `furnitureInstances` because a filler is a BUILDING and needs a
 * shadow, while the wall, streetlights and dressing are flat dressing whose
 * shadow would be a smudge at this camera height. The shadow instance is
 * emitted immediately before its building so the painter's algorithm within
 * LAYER_BUILDING puts it underneath.
 */
function fillerInstances(layout: CityLayout, atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const out: SpriteInstanceInput[] = [];
  for (const p of fillerPlacements(layout)) {
    const frame = atlasIndex.frame(p.frame);
    out.push(shadowInstance(frame, p.position, p.rotationRad, p.sizeM, BUILDING_SHADOW_SOFTNESS, BUILDING_SHADOW_OPACITY, LAYER_BUILDING));
    out.push(spriteInstance(frame, p.position, p.rotationRad, p.sizeM, LAYER_BUILDING));
  }
  return out;
}

/**
 * Non-interactive buildings that fill the space the facility ring leaves empty.
 *
 * ## Why a city of 15 sheds read as a diorama on a table
 *
 * `layout.doorways` puts every facility on ONE ring of radius `boundsRadiusM`,
 * so the entire interior of that ring is bare ground, and the whole city is
 * exactly `WALL_SETBACK_M` wider than the facilities. The screenshot showed the
 * result: fifteen identical tiles around a large empty circle, which reads as
 * objects arranged for a test rather than a city.
 *
 * ## Why the facilities themselves were NOT made bigger
 *
 * That is the obvious fix and it is blocked. A facility is drawn at
 * `layout.tileSizeM` because that is half the `minSpacingM` on which
 * `generateCityLayout` spaces adjacent doorways, so the footprints tile
 * edge-to-edge by construction; growing one means neighbouring buildings
 * overlap. There is also a hard invariant on every dressing ring —
 * `setbackM >= interactionRadiusM + boundingRadiusM(sizeM)` — so a larger
 * footprint pushes the wall, the streetlights and the barriers outward in
 * lockstep, which grows the city instead of filling it.
 *
 * Infill sidesteps all of that. These buildings are decoration: no doorway, no
 * trigger, no collision (`@/sim/city` collides against nothing). So they can
 * be any size, in any gap, as long as they do not cover a facility's trigger
 * circle — which is exactly what the `clearsTriggers` guard below enforces, so
 * a filler can never make a facility unreachable. They are also drawn at
 * LAYER_BUILDING, under the actors, and never tested for trigger clearance
 * against *each other*, so overlap between two fillers is harmless and the
 * deterministic hash decides the layout.
 *
 * Two bands, because the empty space is on both sides of the facility ring:
 * the interior plaza and the perimeter strip between the facilities and the
 * wall. Interior buildings are held back from the exact centre so the player's
 * spawn and the gate approach stay open.
 */
function fillerPlacements(layout: CityLayout): PropPlacement[] {
  const out: PropPlacement[] = [];
  const interiorMaxM = Math.max(0, layout.boundsRadiusM - layout.tileSizeM * 0.9);

  // --- interior plaza -------------------------------------------------------
  // A polar lattice rather than a square one, so the infill follows the ring
  // geometry the rest of the city already uses and needs no per-city tuning.
  const interiorRings = 2;
  for (let ring = 1; ring <= interiorRings; ring++) {
    const radiusM = (interiorMaxM * ring) / (interiorRings + 0.35);
    const slots = Math.max(3, Math.round((2 * Math.PI * radiusM) / 9));
    for (let slot = 0; slot < slots; slot++) {
      const pick = placementHash(0x11a7, ring * 31 + slot, 0x9e37);
      // Leave gaps so it reads as blocks with streets between them, not a raft.
      if (pick < 0.34) continue;
      const angle = (2 * Math.PI * slot) / slots + placementHash(0x2b1d, ring, slot) * 0.5;
      const jitterM = (placementHash(0x77c3, ring, slot) - 0.5) * 2.4;
      const position = polar(radiusM + jitterM, angle);
      const sizeM = FILLER_SIZES_M[Math.floor(placementHash(0x51d9, ring, slot) * FILLER_SIZES_M.length)]!;
      if (!clearsTriggers(layout, position, boundingRadiusM(sizeM))) continue;
      out.push({
        frame: FILLER_FRAMES[Math.floor(placementHash(0x6a13, ring, slot) * FILLER_FRAMES.length)]!,
        position,
        rotationRad: Math.floor(placementHash(0x3f5b, ring, slot) * 4) * (Math.PI / 2),
        sizeM,
      });
    }
  }

  // --- perimeter strip, between the facilities and the wall -----------------
  const stripInnerM = layout.boundsRadiusM + layout.tileSizeM * 0.75;
  const stripOuterM = layout.boundsRadiusM + WALL_SETBACK_M - 1.4;
  if (stripOuterM > stripInnerM) {
    const slots = Math.max(10, Math.round((2 * Math.PI * stripInnerM) / 7.5));
    for (let slot = 0; slot < slots; slot++) {
      const pick = placementHash(0x4c2e, slot, 0x1d7b);
      if (pick < 0.45) continue;
      const angle = (2 * Math.PI * slot) / slots + 0.2;
      const radiusM = (stripInnerM + stripOuterM) / 2 + (placementHash(0x8f31, slot, 5) - 0.5) * 1.2;
      const position = polar(radiusM, angle);
      const sizeM = FILLER_SIZES_M[Math.floor(placementHash(0xa17c, slot, 9) * FILLER_SIZES_M.length)]!;
      if (!clearsTriggers(layout, position, boundingRadiusM(sizeM))) continue;
      out.push({
        frame: FILLER_FRAMES[Math.floor(placementHash(0xc3d5, slot, 11) * FILLER_FRAMES.length)]!,
        position,
        rotationRad: angle + Math.PI / 2,
        sizeM,
      });
    }
  }

  return out;
}

function furnitureInstances(layout: CityLayout, atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  return furniturePlacements(layout).map((p) => spriteInstance(atlasIndex.frame(p.frame), p.position, p.rotationRad, p.sizeM, LAYER_BUILDING));
}

/**
 * One facility and its contact shadow, in shadow-then-building order.
 *
 * Size is `layout.tileSizeM` (= `pedestrian.interactionRadiusM`, i.e. half the
 * `minSpacingM` that `generateCityLayout` spaces adjacent doorways apart), so
 * the building ring tiles exactly edge-to-edge instead of overlapping. The art
 * is a top-down footprint and its `rotationOffsetDeg` is 0, so rotation is 0.
 */
function buildingInstances(layout: CityLayout, doorway: Doorway, atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const frame = atlasIndex.frame(facilityFrameFor(doorway.facilityKind));
  const sizeM: Vec2 = { x: layout.tileSizeM, y: layout.tileSizeM };
  return [
    shadowInstance(frame, doorway.position, 0, sizeM, BUILDING_SHADOW_SOFTNESS, BUILDING_SHADOW_OPACITY, LAYER_BUILDING),
    spriteInstance(frame, doorway.position, 0, sizeM, LAYER_BUILDING),
  ];
}

/**
 * The city exit beacon, floating above the gate.
 *
 * ## Why this exists
 *
 * A vision review found the city has "no visual markers ... to indicate route to
 * Albany; only a vague circle", and that "navigation is unclear, making it
 * difficult for players to understand their objective". That is accurate: the
 * gate is drawn, but it is drawn at exactly the same size, on the same layer,
 * in the same ring as the fifteen facilities, so nothing distinguishes "this
 * one is the way out" from "this one is a bar you can visit".
 *
 * The city screen's whole job is choosing a building, and the exit is the one
 * building a player MUST find, so it is the one that gets a marker.
 *
 * Drawn on its OWN layer above the buildings (not on LAYER_BUILDING) so it is
 * never painted over by an infill block, and so the painter's-algorithm order
 * is explicit rather than dependent on emission order.
 *
 * The frame itself is neutral white: the atlas chroma keyer removes a
 * warm-tinted transparent decal entirely, so the accent colour is a tint here
 * rather than baked into the art.
 */
const WAYPOINT_FRAME = 'decal-waypoint';
const WAYPOINT_TINT = { r: 0.42, g: 0.92, b: 0.86, a: 0.82 } as const;
/** Metres the beacon floats above the gate's footprint. */
/**
 * How far the beacon floats above the gate.
 *
 * A review of the real frame said the marker read as "an oversized, disconnected
 * cyan arrow floating above the car" whose "scale is jarring compared to the
 * pixel-art top-down vehicle", making the objective feel like a UI overlay
 * rather than a world object. That is fair, and it is a critique of this very
 * marker: it was sized and lifted like a HUD element sitting in a 3D-ish world.
 * It now sits low and small, close to the gate it marks, so it reads as a sign
 * AT the building rather than a badge floating over the map.
 */
const WAYPOINT_LIFT_M = 1.5;
/**
 * The beacon rides on LAYER_BUILDING, not on a layer of its own.
 *
 * It was first given `LAYER_WAYPOINT = 3` "so it is never painted over by an
 * infill block" — and was therefore silently invisible. The city renderer packs
 * exactly three layer buckets into three separate instance buffers (ground,
 * buildings, actors) and draws those three bind groups; a layer 3 instance is
 * packed into nothing and never drawn, with no error, because the layer number
 * is just an integer and there is no buffer to overrun.
 *
 * Within a bucket the painter's algorithm preserves emission order, and the
 * beacon is emitted after every facility and filler, so it does still paint
 * over them. That is the ordering guarantee actually wanted, obtained without
 * inventing a bucket the renderer does not have.
 */
const LAYER_WAYPOINT = LAYER_BUILDING;

function waypointInstance(gate: Gate, atlasIndex: AtlasIndex): SpriteInstanceInput {
  const frame = atlasIndex.frame(WAYPOINT_FRAME);
  return {
    atlasId: String(frame.atlasIndex),
    position: { x: gate.position.x, y: gate.position.y + WAYPOINT_LIFT_M },
    rotationRad: 0,
    sizeM: { x: 2.1, y: 2.6 },
    uvRect: frame.uv,
    tint: WAYPOINT_TINT,
    layer: LAYER_WAYPOINT,
  };
}

function gateInstances(layout: CityLayout, gate: Gate, atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const frame = atlasIndex.frame(GATE_FRAME);
  const sizeM: Vec2 = { x: layout.tileSizeM, y: layout.tileSizeM };
  return [
    shadowInstance(frame, gate.position, 0, sizeM, BUILDING_SHADOW_SOFTNESS, BUILDING_SHADOW_OPACITY, LAYER_BUILDING),
    spriteInstance(frame, gate.position, 0, sizeM, LAYER_BUILDING),
  ];
}

/**
 * A doorstep marker on each building's inner face — the one prop DELIBERATELY
 * inside its own trigger circle, because a doormarker's whole purpose is to
 * mark the door whose radius it sits in. It is a flat mat with no collision
 * (nothing in `@/sim/city` collides against props at all), so it cannot block
 * the walk-up that fires the trigger.
 */
function doormarkerInstances(layout: CityLayout, atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const frame = atlasIndex.frame(DOORMARKER_FRAME);
  const radiusM = layout.boundsRadiusM - (layout.tileSizeM / 2 + DOORMARKER_SIZE_M.y / 2);
  const out: SpriteInstanceInput[] = [];
  for (const doorway of layout.doorways) {
    out.push(spriteInstance(frame, polar(radiusM, angleOf(doorway.position)), 0, DOORMARKER_SIZE_M, LAYER_BUILDING));
  }
  return out;
}

function playerInstance(player: CityPlayerState, atlasIndex: AtlasIndex): SpriteInstanceInput {
  const frame = atlasIndex.frame(PLAYER_FRAME);
  // Sized to its own collider (driving.json's pedestrian.colliderRadiusM),
  // not an invented literal.
  const size = drivingConfig().pedestrian.colliderRadiusM * 2;
  return spriteInstance(frame, player.position, player.headingRad + degToRad(frame.rotationOffsetDeg), { x: size, y: size }, LAYER_ACTOR);
}

export interface CityVehicleView {
  readonly position: Vec2;
  readonly headingRad: number;
  readonly bodyId: string;
}

/** The car and its contact shadow, shadow first so the car paints over it. */
function vehicleInstances(vehicle: CityVehicleView, atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const frame = atlasIndex.frame(`car-${vehicle.bodyId}`);
  const rotationRad = vehicle.headingRad + degToRad(frame.rotationOffsetDeg);
  return [
    shadowInstance(frame, vehicle.position, rotationRad, VEHICLE_SPRITE_SIZE_M, VEHICLE_SHADOW_SOFTNESS, VEHICLE_SHADOW_OPACITY, LAYER_ACTOR),
    spriteInstance(frame, vehicle.position, rotationRad, VEHICLE_SPRITE_SIZE_M, LAYER_ACTOR),
  ];
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
 * `encodeTerrainPass` / `encodeSpritePass` consume this) across the three-layer
 * contract: the `@/render/ground` field (layer 0), the perimeter wall, street
 * furniture, every facility's real `building-*` footprint plus the gate, and
 * their contact shadows (layer 1), then the player — riding the car when
 * `player.inVehicle`, on foot otherwise — and any parked car, over the top
 * (layer 2). Pure: reads `snapshot` and `atlasIndex`, never writes either.
 *
 * COUNT CONTRACT (`src/app.ts` sizes three fixed instance buffers from this):
 *  - layer 0: `groundFieldCellCount(CITY_GROUND_CENTER_M, CITY_GROUND_HALF_EXTENT_M, CITY_GROUND_CELL_SIZE_M)` cells
 *  - layer 1: `cityLayer1InstanceCount(layout)` — see that export
 *  - layer 2: at most 3 (on-foot player + a parked car + that car's shadow)
 */
/**
 * The city's STATIC layers (ground + everything on layer 1), memoised per
 * layout.
 *
 * ## Why this exists
 *
 * `showCity` calls `buildCityInstances` once per rendered frame and then filters
 * the result into three per-layer arrays. But everything on layer 0 and layer 1
 * — the ground quad, the wall ring, streetlights, barriers, the decorative
 * infill, every facility, the gate and every doormarker — is derived purely from
 * `layout`, which is built ONCE at screen entry from a fixed
 * `(cityId, sessionSeed)` pair and never changes. Only the actor layer (the
 * player and at most one vehicle) moves.
 *
 * So the old path re-derived ~90% of the instance list and re-allocated four
 * arrays per frame, 60 times a second, to produce a byte-identical result. The
 * budget it was defending (`cityLayer1InstanceCount` sizes the storage buffer)
 * is a function of the layout alone, so caching the result cannot desync it.
 *
 * Keyed by layout identity in a `WeakMap`, so a discarded layout is collectable
 * rather than pinned for the life of the page. `buildCityInstances` still exists
 * and still recomputes from scratch — the tests call it directly, and that is
 * the honest un-memoised path worth testing. The cached pair is the render
 * path's optimisation, layered on top of the same logic, not a second
 * implementation that can drift from it.
 */
const staticCityLayerCache = new WeakMap<CityLayout, { readonly ground: SpriteInstanceInput[]; readonly buildings: SpriteInstanceInput[] }>();

/** The static layer-0 and layer-1 instances for a layout, computed once. */
export function cityStaticLayers(
  layout: CityLayout,
  atlasIndex: AtlasIndex,
): { readonly ground: SpriteInstanceInput[]; readonly buildings: SpriteInstanceInput[] } {
  const hit = staticCityLayerCache.get(layout);
  if (hit !== undefined) return hit;

  const staticInstances: SpriteInstanceInput[] = [...groundInstances(atlasIndex)];
  staticInstances.push(...furnitureInstances(layout, atlasIndex));
  // Fillers are emitted BEFORE the facilities so a facility's footprint and its
  // doormarker always paint over the infill, never the other way round.
  staticInstances.push(...fillerInstances(layout, atlasIndex));
  for (const doorway of layout.doorways) staticInstances.push(...buildingInstances(layout, doorway, atlasIndex));
  staticInstances.push(...gateInstances(layout, layout.gate, atlasIndex));
  staticInstances.push(waypointInstance(layout.gate, atlasIndex));
  staticInstances.push(...doormarkerInstances(layout, atlasIndex));

  const layers = {
    ground: staticInstances.filter((i) => i.layer === 0),
    buildings: staticInstances.filter((i) => i.layer === 1),
  };
  staticCityLayerCache.set(layout, layers);
  return layers;
}

/**
 * The city's ACTOR layer: the player, and at most one vehicle (its contact
 * shadow plus its sprite). This is the only part that changes between frames.
 */
export function buildCityActorInstances(snapshot: CityViewSnapshot, atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const { player, vehicle } = snapshot;
  const out: SpriteInstanceInput[] = [];
  if (vehicle !== null && !player.inVehicle) out.push(...vehicleInstances(vehicle, atlasIndex));
  if (player.inVehicle && vehicle !== null) {
    out.push(...vehicleInstances({ ...vehicle, position: player.position, headingRad: player.headingRad }, atlasIndex));
  } else {
    out.push(playerInstance(player, atlasIndex));
  }
  return out;
}

export function buildCityInstances(snapshot: CityViewSnapshot, atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const staticLayers = cityStaticLayers(snapshot.layout, atlasIndex);
  return [...staticLayers.ground, ...staticLayers.buildings, ...buildCityActorInstances(snapshot, atlasIndex)];
}

/**
 * How many layer-1 instances `buildCityInstances` emits for `layout` — the
 * single number `src/app.ts` must size its building/prop instance buffer to.
 *
 * The buffer is fixed at build time and `app.ts` never culls the city frame
 * (it packs every instance the view hands back), so an under-sized buffer is a
 * WebGPU validation error rather than a silent drop. It is derived from the
 * SAME `furniturePlacements` walk the builder uses, plus 3 per doorway
 * (shadow + building + doormarker) and 2 for the gate (shadow + gate), so the
 * two cannot disagree.
 */
export function cityLayer1InstanceCount(layout: CityLayout): number {
  // furniture: 1 instance each. fillers: 2 each (shadow + building).
  // doorways: 2 each (shadow + building) + 1 doormarker. gate: 2 (shadow + building).
  // The `+ 2` is the gate pair; the `+ 1` is the exit beacon, which rides on
  // this layer.
  //
  // This exact-count function is load-bearing in the way the correctness pass
  // made load-bearing: the city actor buffer was sized to the live count with
  // zero headroom, and adding the beacon without counting it here produced
  // "95 instances exceeds capacity 94" — the bounds check added to
  // `writeInstanceBuffer` doing exactly the job it was written for. Without
  // that check this would have been a silently dropped write and an invisible
  // beacon, which is how the beacon was invisible on its FIRST attempt.
  return (
    furniturePlacements(layout).length +
    fillerPlacements(layout).length * 2 +
    layout.doorways.length * 3 +
    2 + // gate shadow + gate
    1 // exit beacon
  );
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
