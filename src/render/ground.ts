// Ground field construction — the fix for the single worst thing the game
// looked like.
//
// The scene used to be built by stamping ONE atlas frame across a fixed grid
// (`buildFloorInstances` in src/app.ts picked `tile-concrete-arena` and emitted
// 81 identical quads; `groundInstances` in src/ui/city-view.ts did the same
// with `tile-asphalt-clean`). Every cell was byte-identical, which reads as
// tiled wallpaper rather than ground, and because the 4-way-mirror packer
// stamps a visible cross through the middle of every tile, all 81 of them wore
// the same cross too.
//
// This module replaces that with a field: every cell picks its own frame from a
// weighted pool, its own 90-degree rotation, and its own flip, all derived
// deterministically from its integer grid coordinates. Same world position
// always yields the same cell, so the field never crawls or shimmers as the
// camera moves, and it needs no extra state or RNG stream to stay stable.
//
// ZERO IMPORTS is not optional here — this file lives under src/render/** and
// that directory's documented invariant is that a render module depends on
// nothing outside itself (see src/render/sprite.ts's header). Even `import
// type` counts: it is an edge another module can add a real import behind, and
// the whole point of the rule is that this layer stays independently loadable.
//
// So the two types this file needs are declared as STRUCTURAL copies below
// rather than imported. TypeScript resolves them structurally, so a real
// AtlasIndex / SpriteInstanceInput / Vec2M passed in still type-checks against
// them with no cast and no `any` — this is the same technique the ASSET_KINDS
// comment in src/render/atlas.ts uses to justify its own duplicate list.

/** Structural copy of the slice of `src/render/atlas.ts`'s AtlasIndex used here. */
export interface GroundAtlasLike {
  frame(name: string): { readonly atlasIndex: number; readonly uv: { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number } };
}

/** Structural copy of `src/render/sprite.ts`'s Vec2M. */
export interface GroundVec2M {
  readonly x: number;
  readonly y: number;
}

/** Structural copy of the fields `groundQuad` populates on a SpriteInstanceInput. */
export interface GroundInstanceLike {
  readonly atlasId: string;
  readonly position: GroundVec2M;
  readonly rotationRad: number;
  readonly sizeM: GroundVec2M;
  readonly uvRect: { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number };
  readonly tint: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
  readonly layer: number;
  readonly uvRepeatMetres: number;
  readonly uvDetailScale: number;
}

/**
 * One entry in a ground pool: an atlas frame name and how often it is drawn
 * relative to its siblings. Weight is an integer, not a probability, so a pool
 * reads as "mostly asphalt, a little gravel" without float bookkeeping.
 */
export interface GroundEntry {
  readonly frame: string;
  readonly weight: number;
}

/**
 * Named ground pools.
 *
 * ## One base frame per pool, and that is deliberate
 *
 * The obvious way to kill a tiled look is to give every cell a different
 * texture, a different rotation, and a flip. Do that and the ground gets
 * WORSE, not better: adjacent cells then hold different images meeting at a
 * hard edge, and you get a visible grid of seams — measurably worse than the
 * repetition it was meant to fix. (That is exactly what a first pass of this
 * work did, and the screenshot said so immediately.)
 *
 * A single base frame repeated is *seamless by construction* — neighbouring
 * cells show the same continuous texture, so there is no edge to see. The
 * repetition is broken up instead by things that do not create a seam:
 *
 *   - `valueJitter`, a per-cell brightness offset (see `groundField`)
 *   - the post pass's grain and split-tone
 *   - the 4-way-mirror cross, which is now gone (see the packer)
 *
 * So a pool names exactly one base frame. `GroundEntry.weight` is retained only
 * so a future variant that genuinely CAN be blended (a shader-side two-layer
 * mix, which needs no per-cell quad boundary) can be expressed here without a
 * second data structure.
 */
export const GROUND_POOLS: Readonly<Record<string, readonly GroundEntry[]>> = {
  /**
   * Arena floor: the expansion-slab concrete.
   *
   * Deliberately NOT `ground-arena-a`, which is the better-looking texture —
   * it has a big painted circle. That is exactly why it is wrong here: a
   * painted circle is a FEATURE, not a texture, so tiling it stamps the same
   * circle across the whole floor in a visible lattice (25 of them across one
   * screen). A tileable ground texture has to be built from features that make
   * sense repeated — slab joints, cracks, gravel.
   */
  arena: [{ frame: 'ground-arena-b', weight: 1 }],
  /** Highway surface: cracked asphalt, no lane paint. */
  road: [{ frame: 'ground-road-a', weight: 1 }],
  /** Open country alongside the highway. */
  dirt: [{ frame: 'ground-dirt-a', weight: 1 }],
  /**
   * City streets: plain asphalt.
   *
   * Deliberately NOT `tile-citypave`, which reads as paving but carries a dark
   * circular feature. A strong feature in a tile that repeats every few metres
   * stamps that feature across the whole city in a visible regular grid — 30
   * identical dark dots read far worse than plain asphalt. The city looks like
   * a city because of its buildings, wall and street furniture, not its paving.
   */
  city: [{ frame: 'tile-asphalt-clean', weight: 1 }],
};

export interface GroundQuadOptions {
  /** Atlas frame pool; see {@link GROUND_POOLS}. */
  readonly pool: string;
  /** World-space centre of the quad. */
  readonly center: GroundVec2M;
  /** Half-extent of the quad in metres. Must cover the whole visible area. */
  readonly halfExtentM: number;
  readonly layer: number;
  /**
   * World size, in metres, that one tile of the frame should cover.
   *
   * This is the ground's real detail scale, and it is independent of the quad
   * size. The quad is sized to the view; the tile is sized to look right.
   */
  readonly tileMetres: number;
  /**
   * Second sampling scale, as a multiple of {@link tileMetres}. 0 disables the
   * detail blend. A non-integer value is the point — two scales sharing a
   * period reinforce each other and the repeat comes straight back.
   */
  readonly detailScale?: number;
}

/**
 * Builds the ground as ONE quad covering a world-space rectangle.
 *
 * ## Why one quad and not a grid
 *
 * The first version of this emitted a grid of cells, each picking its own
 * frame, rotation, flip and brightness from a hash of its coordinates. It made
 * the ground worse, and measurably so: with a grid, every cell boundary is a
 * seam. Adjacent cells holding different textures produce a hard edge, and
 * even a small per-cell brightness offset produces a visible line — so the
 * grid reappeared as a grid, just arriving by a different route than the
 * original wallpaper defect. Screenshots of the arena's painted circle and the
 * city's lane markings, both stamped on a regular lattice, are the evidence.
 *
 * One quad has no interior boundary at all, so nothing to see. The repetition
 * that a single tiled texture does have is broken in the fragment shader
 * instead, by cross-fading two non-commensurate sampling scales — which
 * introduces no boundary either, because both are world-space `fract()`s.
 *
 * The quad is deliberately larger than the visible area: the world has no
 * depth buffer and the camera is hard-locked to the player, so an exact fit
 * would show the clear colour at the very edge of the frame on rounding.
 */
export function groundQuad(atlasIndex: GroundAtlasLike, options: GroundQuadOptions): GroundInstanceLike {
  const pool = GROUND_POOLS[options.pool];
  if (pool === undefined) throw new RangeError(`groundQuad: unknown pool "${options.pool}"`);
  const frame = atlasIndex.frame(pool[0]!.frame);
  return {
    atlasId: String(frame.atlasIndex),
    position: { x: options.center.x, y: options.center.y },
    rotationRad: 0,
    sizeM: { x: options.halfExtentM * 2, y: options.halfExtentM * 2 },
    uvRect: frame.uv,
    tint: { r: 1, g: 1, b: 1, a: 1 },
    layer: options.layer,
    uvRepeatMetres: options.tileMetres,
    uvDetailScale: options.detailScale ?? 0,
  };
}

/** Ground detail scale, in metres per tile, for a pool. See {@link GROUND_POOLS}. */
export const GROUND_TILE_METRES: Readonly<Record<string, { tileMetres: number; detailScale: number }>> = {
  arena: { tileMetres: 30, detailScale: 12.1 },
  road: { tileMetres: 34, detailScale: 13.7 },
  dirt: { tileMetres: 24, detailScale: 8.7 },
  city: { tileMetres: 34, detailScale: 13.1 },
};
