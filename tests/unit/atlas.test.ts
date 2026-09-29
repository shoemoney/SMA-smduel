import fs, { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ASSET_KINDS as RUNTIME_ASSET_KINDS,
  AtlasIndex,
  MalformedAtlasManifestError,
  parseAtlasManifest,
  UnknownAtlasFrameError,
} from '@/render/atlas';
import type { AtlasManifest } from '@/render/atlas';

// tools/pack-atlas.mjs is a plain Node ESM tool (no build step / .d.ts of its
// own). It has no ambient type declarations available to a relative-path
// `declare module` augmentation (TS refuses to augment an already-resolved
// untyped module), so instead we import it dynamically and cast the result
// to the exact shape of the pure functions this test exercises.
interface AtlasBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface PackFrameInput {
  name: string;
  w: number;
  h: number;
}
interface PackPlacement {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface PackedAtlas {
  width: number;
  height: number;
  placements: PackPlacement[];
}
interface PackError {
  name: string;
  reason: string;
}
interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}
interface BuiltFrame {
  name: string;
  kind: string;
  rgba: Uint8Array;
  w: number;
  h: number;
  trimX: number;
  trimY: number;
  srcW: number;
  srcH: number;
  rotationOffsetDeg: number;
}
interface SpriteMetaFrame {
  kind?: string;
  keyed?: boolean;
  keyColor?: string;
  keyColorDeviation?: number;
  rotationOffsetDeg?: number;
  skip?: boolean;
  note?: string;
}
interface AtlasSizeConfig {
  _comment?: string;
  tile: { quadrantPx: number };
  ui: { maxPx: number; keepNative: string[]; fullScreenMaxPx?: number };
  [kind: string]: unknown;
}
interface ContentGroup {
  id: string;
  kinds: readonly string[];
}
interface DecodedFrameForPack {
  name: string;
  kind: string;
  w: number;
  h: number;
  rgba: Uint8Array;
  trimX: number;
  trimY: number;
  srcW: number;
  srcH: number;
  rotationOffsetDeg: number;
}
interface ManifestFrameOut {
  atlas: number;
  x: number;
  y: number;
  w: number;
  h: number;
  trimX: number;
  trimY: number;
  srcW: number;
  srcH: number;
  kind: string;
  rotationOffsetDeg: number;
}
interface AtlasFileEntryOut {
  file: string;
  width: number;
  height: number;
}
interface CanvasOut {
  width: number;
  height: number;
  rgba: Uint8Array;
}
interface PackFramesByContentGroupResult {
  atlasFileEntries: AtlasFileEntryOut[];
  manifestFrames: Record<string, ManifestFrameOut>;
  canvases: CanvasOut[];
  errors: PackError[];
}
interface PackAtlasModule {
  MAGENTA: readonly [number, number, number];
  TILE_QUADRANT_PX: number;
  TILE_FINAL_PX: number;
  SPRITE_MAX_PX: number;
  MAX_CONFIGURABLE_PX: number;
  ASSET_KINDS: readonly string[];
  CONTENT_GROUPS: readonly ContentGroup[];
  contentGroupIdForKind(kind: string): string;
  packFramesByContentGroup(
    decodedFrames: readonly DecodedFrameForPack[],
    packOptions?: { padding?: number; maxSize?: number; minSize?: number },
    groups?: readonly ContentGroup[],
  ): PackFramesByContentGroupResult;
  loadSizeConfig(path?: string): AtlasSizeConfig;
  fingerprintSizeConfig(config?: AtlasSizeConfig): string;
  rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number };
  hueDistance(a: number, b: number): number;
  chromaKeyToAlpha(
    rgba: Uint8Array,
    width: number,
    height: number,
    opts?: {
      keyColor?: readonly [number, number, number];
      tolerance?: number;
      feather?: number;
      satFloor?: number;
      valFloor?: number;
    },
  ): Uint8Array;
  despillEdges(rgba: Uint8Array, width: number, height: number): Uint8Array;
  autoCropToAlphaBBox(rgba: Uint8Array, width: number, height: number, opts?: { alphaThreshold?: number }): AtlasBBox;
  cropRGBA(rgba: Uint8Array, width: number, bbox: AtlasBBox): Uint8Array;
  resizeRGBA(rgba: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number): Uint8Array;
  mirrorQuadrantToSeamlessTile(quadrant: Uint8Array, qSize: number): Uint8Array;
  resolveShouldKey(name: string, kind: string, meta: SpriteMetaFrame | undefined | null): boolean;
  resolveRotationOffsetDeg(name: string, meta: SpriteMetaFrame | undefined | null): number;
  buildFrame(name: string, kind: string, decoded: DecodedImage, meta: SpriteMetaFrame | undefined | null): BuiltFrame | null;
  resolveUiPreScaleMaxPx(name: string, kind: string): number | null;
  preScaleForBuild(name: string, kind: string, decoded: DecodedImage): DecodedImage;
  loadSpriteMeta(path: string): { frames: Record<string, SpriteMetaFrame> } | null;
  packAtlas(
    frames: readonly PackFrameInput[],
    opts?: { padding?: number; maxSize?: number; minSize?: number },
  ): { atlases: PackedAtlas[]; errors: PackError[] };
}

// A non-literal specifier keeps TS from trying (and failing) to resolve
// declaration types for this untyped .mjs tool; the cast above supplies them.
const packAtlasPath = '../../tools/pack-atlas.mjs';
const packAtlasModule = (await import(packAtlasPath)) as unknown as PackAtlasModule;
const {
  MAGENTA,
  TILE_QUADRANT_PX,
  TILE_FINAL_PX,
  SPRITE_MAX_PX,
  MAX_CONFIGURABLE_PX,
  ASSET_KINDS,
  loadSizeConfig,
  fingerprintSizeConfig,
  chromaKeyToAlpha,
  despillEdges,
  autoCropToAlphaBBox,
  cropRGBA,
  resizeRGBA,
  mirrorQuadrantToSeamlessTile,
  resolveShouldKey,
  resolveRotationOffsetDeg,
  buildFrame,
  resolveUiPreScaleMaxPx,
  preScaleForBuild,
  loadSpriteMeta,
  packAtlas,
  CONTENT_GROUPS,
  contentGroupIdForKind,
  packFramesByContentGroup,
} = packAtlasModule;

// ---------------------------------------------------------------------------
// Synthetic RGBA image helpers
// ---------------------------------------------------------------------------

function makeSolid(width: number, height: number, [r, g, b, a]: readonly [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

function setPixel(rgba: Uint8Array, width: number, x: number, y: number, [r, g, b, a]: readonly [number, number, number, number]): void {
  const idx = (y * width + x) * 4;
  rgba[idx] = r;
  rgba[idx + 1] = g;
  rgba[idx + 2] = b;
  rgba[idx + 3] = a;
}

function getPixel(rgba: Uint8Array, width: number, x: number, y: number): [number, number, number, number] {
  const idx = (y * width + x) * 4;
  return [rgba[idx] as number, rgba[idx + 1] as number, rgba[idx + 2] as number, rgba[idx + 3] as number];
}

// Independent (not imported from the module under test) HSV hue reference,
// used only to construct/verify synthetic pixel fixtures below against the
// documented rule (assets/ASSET-NOTES.md section 6: "key in HSV by hue
// band... with a saturation floor and a value floor"), not against
// pack-atlas.mjs's own implementation.
function independentHueDeg(r: number, g: number, b: number): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

describe('chromaKeyToAlpha', () => {
  it('keys a flat magenta background fully transparent', () => {
    const rgba = makeSolid(4, 4, [255, 0, 255, 255]);
    chromaKeyToAlpha(rgba, 4, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(getPixel(rgba, 4, x, y)[3]).toBe(0);
      }
    }
  });

  it('leaves a clearly foreground color fully opaque', () => {
    const rgba = makeSolid(2, 2, [30, 120, 200, 255]); // saturated blue, nowhere near magenta
    chromaKeyToAlpha(rgba, 2, 2);
    expect(getPixel(rgba, 2, 0, 0)[3]).toBe(255);
  });

  it('produces a soft ramp inside the tolerance+feather hue band', () => {
    // (255,0,140) independently computes to hue ~327.1deg; MAGENTA's hue is
    // 300deg, so the distance (~27.1deg) sits inside the default 18..36deg
    // tolerance+feather band around the key hue.
    const pixel: [number, number, number] = [255, 0, 140];
    const hueDist = Math.abs(independentHueDeg(...pixel) - independentHueDeg(...MAGENTA));
    expect(hueDist).toBeGreaterThan(18);
    expect(hueDist).toBeLessThan(36);

    const rgba = new Uint8Array(4);
    rgba.set([...pixel, 255]);
    chromaKeyToAlpha(rgba, 1, 1, { keyColor: [...MAGENTA] as [number, number, number] });
    expect(rgba[3]).toBeGreaterThan(0);
    expect(rgba[3]).toBeLessThan(255);
  });

  it('protects desaturated (grey/black) pixels via the saturation floor even if RGB-close to the key', () => {
    // Low-saturation grey, deliberately given a custom near key color so pure RGB distance
    // alone would key it — the saturation floor must override that.
    const rgba = new Uint8Array(4);
    rgba.set([120, 118, 121, 255]);
    chromaKeyToAlpha(rgba, 1, 1, { keyColor: [122, 118, 120], tolerance: 40, feather: 30 });
    expect(rgba[3]).toBe(255);
  });

  it('protects near-black pixels via the value floor even when noise gives them a high computed saturation', () => {
    // (2,1,2): max=2/255=0.0078 -> saturation computes to 0.5 (numerically
    // unstable this close to black) but value is ~0.008, far below any
    // reasonable valFloor, so it must stay opaque regardless of hue/saturation.
    const rgba = new Uint8Array(4);
    rgba.set([2, 1, 2, 255]);
    chromaKeyToAlpha(rgba, 1, 1, { keyColor: [...MAGENTA] as [number, number, number] });
    expect(rgba[3]).toBe(255);
  });

  it('regression (assets/ASSET-NOTES.md section 6): keys a DARK pink-tinted shadow that RGB-distance keying left opaque', () => {
    // (60,10,55): independently computes to hue ~305.8deg (close to magenta's
    // 300deg) at high saturation (~0.83) but low value (~0.24) — a dark
    // drop-shadow pixel. Its RGB distance from MAGENTA (255,0,255) is ~279.5,
    // far outside any RGB-distance tolerance a packer could use without also
    // eating black armour plating (that was the whole bug: such a shadow
    // shipped fully opaque). Hue distance is only ~5.8deg, correctly inside
    // the tolerance band, so the fixed hue-based key must remove it.
    const pixel: [number, number, number] = [60, 10, 55];
    const hueDist = Math.abs(independentHueDeg(...pixel) - independentHueDeg(...MAGENTA));
    expect(hueDist).toBeLessThan(18);
    const rgbDist = Math.sqrt((60 - 255) ** 2 + (10 - 0) ** 2 + (55 - 255) ** 2);
    expect(rgbDist).toBeGreaterThan(200); // far outside any sane RGB-distance tolerance

    const rgba = new Uint8Array(4);
    rgba.set([...pixel, 255]);
    chromaKeyToAlpha(rgba, 1, 1, { keyColor: [...MAGENTA] as [number, number, number] });
    expect(rgba[3]).toBe(0);
  });
});

describe('despillEdges', () => {
  it('reduces the magenta fringe (excess R/B over G) on partially-transparent edge pixels', () => {
    const rgba = new Uint8Array(4);
    // r=200, g=60, b=210, alpha=128 (a partially-keyed edge pixel with magenta spill)
    rgba.set([200, 60, 210, 128]);
    despillEdges(rgba, 1, 1);
    const [r, g, b, a] = [rgba[0] as number, rgba[1] as number, rgba[2] as number, rgba[3] as number];
    expect(r).toBeLessThan(200);
    expect(b).toBeLessThan(210);
    expect(r).toBe(g); // spill (140) exceeds r-g (140) exactly, so r is pulled all the way to g
    expect(b).toBeGreaterThanOrEqual(g); // pulled toward g but spill also affects b independently
    expect(a).toBe(128); // despill never touches alpha
  });

  it('leaves fully transparent pixels untouched', () => {
    const rgba = new Uint8Array(4);
    rgba.set([255, 0, 255, 0]);
    despillEdges(rgba, 1, 1);
    expect(Array.from(rgba)).toEqual([255, 0, 255, 0]);
  });

  it('despills a STRONGLY key-cast opaque pixel, and leaves a mild one alone', () => {
    // This used to assert that EVERY opaque pixel is untouched. That was the
    // wrong contract: `chromaKeyToAlpha` can leave a blend strong enough to
    // survive keying at FULL alpha, so skipping opaque pixels left a magenta
    // ring around every generated vehicle — a review of the real frame called it
    // "stray magenta mount tabs ... they look like debug hitboxes", and it was
    // the most visible defect in the game.
    //
    // Opaque pixels are now despilled too, but only when the key cast is strong
    // enough that it cannot plausibly be intended subject colour. A mild cast is
    // genuine colour and must survive, which is what the second half pins.
    const strong = new Uint8Array(4);
    strong.set([200, 60, 210, 255]);
    despillEdges(strong, 1, 1);
    expect(strong[0]).toBeLessThan(200);
    expect(strong[2]).toBeLessThan(210);

    const mild = new Uint8Array(4);
    mild.set([200, 190, 210, 255]); // spill = 20, under the threshold
    despillEdges(mild, 1, 1);
    expect(Array.from(mild)).toEqual([200, 190, 210, 255]);
  });
});

describe('autoCropToAlphaBBox + cropRGBA', () => {
  it('finds the exact bounding box of non-transparent pixels', () => {
    const width = 6;
    const height = 6;
    const rgba = makeSolid(width, height, [255, 0, 255, 0]); // all transparent
    // paint a known 3x2 opaque block at (x:1..3, y:2..3)
    for (let y = 2; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        setPixel(rgba, width, x, y, [10, 20, 30, 255]);
      }
    }
    const bbox = autoCropToAlphaBBox(rgba, width, height);
    expect(bbox).toEqual({ x: 1, y: 2, w: 3, h: 2 });

    const cropped = cropRGBA(rgba, width, bbox);
    expect(cropped.length).toBe(bbox.w * bbox.h * 4);
    for (let y = 0; y < bbox.h; y++) {
      for (let x = 0; x < bbox.w; x++) {
        expect(getPixel(cropped, bbox.w, x, y)).toEqual([10, 20, 30, 255]);
      }
    }
  });

  it('returns an empty bbox when nothing survived the key', () => {
    const rgba = makeSolid(3, 3, [255, 0, 255, 0]);
    const bbox = autoCropToAlphaBBox(rgba, 3, 3);
    expect(bbox).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('resizeRGBA', () => {
  it('is a no-op when src and dst dimensions match', () => {
    const rgba = makeSolid(3, 3, [10, 20, 30, 255]);
    expect(resizeRGBA(rgba, 3, 3, 3, 3)).toBe(rgba);
  });

  it('area-averages an exact-ratio downscale (4x4 -> 2x2, each 2x2 block averaged)', () => {
    // Four 2x2 blocks, each a flat color, so the area-weighted average of
    // each block is exactly that color — independently verifiable by hand.
    const rgba = makeSolid(4, 4, [0, 0, 0, 0]);
    const paintBlock = (bx: number, by: number, color: readonly [number, number, number, number]): void => {
      for (let y = by; y < by + 2; y++) {
        for (let x = bx; x < bx + 2; x++) setPixel(rgba, 4, x, y, color);
      }
    };
    paintBlock(0, 0, [10, 20, 30, 255]);
    paintBlock(2, 0, [110, 120, 130, 255]);
    paintBlock(0, 2, [210, 220, 230, 255]);
    paintBlock(2, 2, [255, 255, 255, 0]);

    const resized = resizeRGBA(rgba, 4, 4, 2, 2);
    expect(getPixel(resized, 2, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(getPixel(resized, 2, 1, 0)).toEqual([110, 120, 130, 255]);
    expect(getPixel(resized, 2, 0, 1)).toEqual([210, 220, 230, 255]);
    expect(getPixel(resized, 2, 1, 1)).toEqual([255, 255, 255, 0]);
  });

  it('never upscales beyond the source data it has (dst larger than src still only samples real pixels)', () => {
    const rgba = makeSolid(1, 1, [50, 60, 70, 255]);
    const resized = resizeRGBA(rgba, 1, 1, 2, 2);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) expect(getPixel(resized, 2, x, y)).toEqual([50, 60, 70, 255]);
    }
  });
});

describe('mirrorQuadrantToSeamlessTile', () => {
  it('produces a tile whose opposite edges are pixel-identical (assets/ASSET-NOTES.md section 3: tiles must repeat seamlessly)', () => {
    // An asymmetric, non-repeating quadrant (a diagonal gradient) — if the
    // mirrored output's opposite edges match for THIS input, it is the
    // mirroring geometry doing the work, not a coincidentally symmetric fixture.
    const q = 5;
    const quadrant = new Uint8Array(q * q * 4);
    for (let y = 0; y < q; y++) {
      for (let x = 0; x < q; x++) {
        setPixel(quadrant, q, x, y, [(x * 37 + y * 11) % 251, (x * 13 + 5) % 251, (y * 29 + 3) % 251, 255]);
      }
    }

    const tile = mirrorQuadrantToSeamlessTile(quadrant, q);
    const size = q * 2;
    expect(tile.length).toBe(size * size * 4);

    // Left column must equal right column (horizontal wrap seam).
    for (let y = 0; y < size; y++) {
      expect(getPixel(tile, size, 0, y)).toEqual(getPixel(tile, size, size - 1, y));
    }
    // Top row must equal bottom row (vertical wrap seam).
    for (let x = 0; x < size; x++) {
      expect(getPixel(tile, size, x, 0)).toEqual(getPixel(tile, size, x, size - 1));
    }
    // Sanity: the quadrant itself was NOT already seamless (proves the mirroring did something).
    expect(getPixel(quadrant, q, 0, 0)).not.toEqual(getPixel(quadrant, q, q - 1, 0));
  });
});

describe('resolveShouldKey', () => {
  it('falls back to "every kind but tile" when there is no sprite-meta entry', () => {
    expect(resolveShouldKey('car-foo', 'car', null)).toBe(true);
    expect(resolveShouldKey('tile-foo', 'tile', null)).toBe(false);
  });

  it('uses an explicit boolean "keyed" field when meta exists', () => {
    expect(resolveShouldKey('car-foo', 'car', { keyed: false })).toBe(false);
    expect(resolveShouldKey('ui-foo', 'ui', { keyed: true })).toBe(true);
  });

  it('throws rather than silently defaulting when meta exists but "keyed" is missing (regression: a new sprite-meta entry without "keyed" used to ship unkeyed)', () => {
    expect(() => resolveShouldKey('car-new', 'car', { keyColor: '#F4308E' })).toThrow(/keyed/);
  });
});

describe('resolveRotationOffsetDeg', () => {
  it('defaults to 0 when there is no meta or no rotationOffsetDeg field', () => {
    expect(resolveRotationOffsetDeg('tile-foo', null)).toBe(0);
    expect(resolveRotationOffsetDeg('car-foo', {})).toBe(0);
  });

  it('reads the declared value straight through', () => {
    expect(resolveRotationOffsetDeg('car-van', { rotationOffsetDeg: 180 })).toBe(180);
    expect(resolveRotationOffsetDeg('car-stationwagon', { rotationOffsetDeg: 90 })).toBe(90);
  });

  it('throws on a non-numeric rotationOffsetDeg rather than silently coercing to 0', () => {
    expect(() => resolveRotationOffsetDeg('car-bad', { rotationOffsetDeg: Number.NaN })).toThrow(/rotationOffsetDeg/);
  });
});

describe('buildFrame', () => {
  function makeDecoded(width: number, height: number, fill: readonly [number, number, number, number]): DecodedImage {
    return { width, height, rgba: makeSolid(width, height, fill) };
  }

  it('carries rotationOffsetDeg through for a keyed sprite (regression: the manifest used to drop it entirely)', () => {
    const decoded = makeDecoded(20, 20, [255, 0, 255, 255]);
    setPixel(decoded.rgba, 20, 10, 10, [10, 20, 30, 255]); // one foreground pixel so the crop isn't empty
    const frame = buildFrame('car-van', 'car', decoded, { keyed: true, keyColor: '#FF00FF', rotationOffsetDeg: 180 });
    expect(frame).not.toBeNull();
    expect(frame?.rotationOffsetDeg).toBe(180);
  });

  it('builds a seamless TILE_FINAL_PX x TILE_FINAL_PX tile for kind "tile", ignoring "keyed" entirely', () => {
    expect(TILE_FINAL_PX).toBe(TILE_QUADRANT_PX * 2); // final size = quadrant mirrored 2x2
    const decoded = makeDecoded(64, 64, [200, 30, 90, 255]);
    const frame = buildFrame('tile-asphalt-cracked', 'tile', decoded, { keyed: true, kind: 'tile' });
    expect(frame).not.toBeNull();
    expect(frame?.w).toBe(TILE_FINAL_PX);
    expect(frame?.h).toBe(TILE_FINAL_PX);
    expect(frame?.srcW).toBe(TILE_FINAL_PX);
    expect(frame?.srcH).toBe(TILE_FINAL_PX);
    expect(frame?.trimX).toBe(0);
    expect(frame?.trimY).toBe(0);
    // Seamless: left column equals right column of the built tile.
    const rgba = frame?.rgba as Uint8Array;
    for (let y = 0; y < TILE_FINAL_PX; y += 37) {
      expect(getPixel(rgba, TILE_FINAL_PX, 0, y)).toEqual(getPixel(rgba, TILE_FINAL_PX, TILE_FINAL_PX - 1, y));
    }
  });

  it('downscales a cropped sprite whose longest edge exceeds SPRITE_MAX_PX, keeping trim/src proportional (regression: 66MB atlases from never downscaling)', () => {
    const size = 600;
    const decoded = makeDecoded(size, size, [255, 0, 255, 255]);
    // A 300x200 foreground block, off-center, so trimX/trimY are non-zero pre-scale.
    for (let y = 200; y < 400; y++) {
      for (let x = 150; x < 450; x++) setPixel(decoded.rgba, size, x, y, [20, 30, 40, 255]);
    }
    const frame = buildFrame('prop-fuel-drum', 'prop', decoded, { keyed: true, keyColor: '#FF00FF' });
    expect(frame).not.toBeNull();
    expect(Math.max(frame!.w, frame!.h)).toBe(SPRITE_MAX_PX);
    // Original crop was 300x200 (2:3 ratio); scaled dims must preserve it.
    expect(frame!.w / frame!.h).toBeCloseTo(300 / 200, 1);
    // trimX/trimY/srcW/srcH scaled down by the same factor as w/h, not left at the pre-scale (1024-space) values.
    const scale = frame!.w / 300;
    expect(frame!.srcW).toBe(Math.round(size * scale));
    expect(frame!.trimX).toBe(Math.round(150 * scale));
  });

  it('leaves an unkeyed "ui" frame at native resolution ("UI keep larger")', () => {
    const decoded = makeDecoded(400, 300, [10, 20, 30, 255]); // no magenta at all: shouldKey=false path with explicit meta
    const frame = buildFrame('ui-title-art', 'ui', decoded, { keyed: false });
    expect(frame).not.toBeNull();
    expect(frame?.w).toBe(400);
    expect(frame?.h).toBe(300);
  });

  it('also leaves a KEYED "ui" frame at native resolution — "UI keep larger" applies regardless of keying', () => {
    const size = 600;
    const decoded = makeDecoded(size, size, [255, 0, 255, 255]);
    for (let y = 100; y < 500; y++) {
      for (let x = 100; x < 500; x++) setPixel(decoded.rgba, size, x, y, [0, 200, 0, 255]); // saturated green, far from magenta hue
    }
    const frame = buildFrame('ui-radar-bezel', 'ui', decoded, { keyed: true, keyColor: '#FF00FF' });
    expect(frame).not.toBeNull();
    expect(frame?.w).toBe(400);
    expect(frame?.h).toBe(400);
    expect(frame?.srcW).toBe(600); // unscaled — a downscaling ui frame would shrink this too
  });
});

describe('resolveUiPreScaleMaxPx / preScaleForBuild (assets/ASSET-NOTES.md section 9: only the two full-screen UI frames stay native)', () => {
  it('returns null (no pre-scale) for a non-ui kind', () => {
    expect(resolveUiPreScaleMaxPx('car-van', 'car')).toBeNull();
  });

  // These two USED to return null (stay fully native). They now return
  // ui.fullScreenMaxPx, a STOPGAP: measured at 27.1% of the packed sheet EACH —
  // 54.2% between them — and adding the 21 phase-4 frames pushed the atlas to
  // 102.7% of its byte budget. Capping them is a deliberate quality trade to keep
  // the gate green. The real fix is extracting them from the atlas entirely (they
  // are full-screen art that never batches with a sprite), which needs a loader
  // change; when that lands, delete ui.fullScreenMaxPx and this expectation
  // becomes toBeNull() again.
  

  

  it('returns a positive target for every other ui frame', () => {
    const maxPx = resolveUiPreScaleMaxPx('ui-radar-bezel', 'ui');
    expect(maxPx).not.toBeNull();
    expect(maxPx as number).toBeGreaterThan(0);
    expect(resolveUiPreScaleMaxPx('ui-speedo-dial', 'ui')).toBe(maxPx);
  });

  // Was: "leaves a full-screen ui frame's pixels untouched". It no longer does —
  // see the stopgap note above. It is still held FAR above the small-gauge target,
  // which is the property that actually matters: full-screen art must not be
  // shrunk to HUD-icon size just because it shares the 'ui' kind.
  

  

  it('preScaleForBuild downscales a small-HUD-gauge ui frame that exceeds the target, feeding buildFrame an already-small image', () => {
    const maxPx = resolveUiPreScaleMaxPx('ui-radar-bezel', 'ui') as number;
    const size = maxPx * 4; // comfortably above the target on every axis
    const decoded: DecodedImage = { width: size, height: size, rgba: makeSolid(size, size, [0, 200, 0, 255]) };
    const scaled = preScaleForBuild('ui-radar-bezel', 'ui', decoded);
    expect(Math.max(scaled.width, scaled.height)).toBe(maxPx);
    expect(scaled.rgba.length).toBe(scaled.width * scaled.height * 4);

    // Composed with buildFrame (which never resizes 'ui' itself — see the
    // "UI keep larger" tests above): the FINAL packed frame ends up small,
    // without buildFrame's own kind-wide native-passthrough behavior
    // changing at all.
    const frame = buildFrame('ui-radar-bezel', 'ui', scaled, { keyed: false });
    expect(frame).not.toBeNull();
    expect(Math.max(frame!.w, frame!.h)).toBeLessThanOrEqual(maxPx);
  });

  it('preScaleForBuild is a no-op when the source is already at or under the target', () => {
    const maxPx = resolveUiPreScaleMaxPx('ui-speedo-dial', 'ui') as number;
    const decoded: DecodedImage = { width: maxPx, height: maxPx, rgba: makeSolid(maxPx, maxPx, [1, 2, 3, 255]) };
    expect(preScaleForBuild('ui-speedo-dial', 'ui', decoded)).toBe(decoded);
  });
});

describe('loadSpriteMeta', () => {
  const fixturesDir = fileURLToPath(new URL('./fixtures-sprite-meta/', import.meta.url));

  function writeFixture(name: string, contents: string): string {
    mkdirSync(fixturesDir, { recursive: true });
    const path = resolve(fixturesDir, name);
    writeFileSync(path, contents, 'utf8');
    return path;
  }

  it('returns null when the file does not exist (legitimate: raw assets not yet audited)', () => {
    expect(loadSpriteMeta(resolve(fixturesDir, 'does-not-exist.json'))).toBeNull();
  });

  it('returns the parsed object for well-formed JSON', () => {
    const path = writeFixture('valid.json', JSON.stringify({ frames: { 'car-foo': { keyed: true } } }));
    expect(loadSpriteMeta(path)).toEqual({ frames: { 'car-foo': { keyed: true } } });
  });

  it('throws (does not silently return null) on malformed JSON (regression: a trailing comma used to discard every frame\'s ground truth)', () => {
    const path = writeFixture('malformed.json', '{ "frames": { "car-foo": { "keyed": true, } } }');
    expect(() => loadSpriteMeta(path)).toThrow();
  });

  it('throws on valid JSON missing the "frames" object', () => {
    const path = writeFixture('no-frames.json', JSON.stringify({ generatedBy: 'test' }));
    expect(() => loadSpriteMeta(path)).toThrow(/frames/);
  });
});

describe('packAtlas', () => {
  function rectsOverlap(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  it('places every frame exactly once, never overlapping, and within atlas bounds', () => {
    const frames = [
      { name: 'a', w: 40, h: 60 },
      { name: 'b', w: 30, h: 30 },
      { name: 'c', w: 50, h: 20 },
      { name: 'd', w: 10, h: 10 },
      { name: 'e', w: 22, h: 33 },
      { name: 'f', w: 60, h: 60 },
      { name: 'g', w: 15, h: 45 },
    ];

    const { atlases, errors } = packAtlas(frames, { padding: 2, maxSize: 128, minSize: 32 });
    expect(errors).toEqual([]);

    const seen = new Set<string>();
    for (const atlas of atlases) {
      const placements = atlas.placements;
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i]!;
        expect(seen.has(p.name)).toBe(false);
        seen.add(p.name);
        expect(p.x + p.w).toBeLessThanOrEqual(atlas.width);
        expect(p.y + p.h).toBeLessThanOrEqual(atlas.height);
        for (let j = i + 1; j < placements.length; j++) {
          expect(rectsOverlap(p, placements[j]!)).toBe(false);
        }
      }
    }
    expect(seen.size).toBe(frames.length);
  });

  it('reports an oversized frame as an error instead of silently dropping it', () => {
    const frames = [
      { name: 'huge', w: 500, h: 500 },
      { name: 'small', w: 10, h: 10 },
    ];
    const { atlases, errors } = packAtlas(frames, { padding: 2, maxSize: 128, minSize: 32 });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.name).toBe('huge');

    const placedNames = atlases.flatMap((a) => a.placements.map((p) => p.name));
    expect(placedNames).toEqual(['small']);
  });
});

describe('contentGroupIdForKind / CONTENT_GROUPS (tools/pack-atlas.mjs sheet split)', () => {
  it('covers every ASSET_KIND exactly once, so a newly-added kind cannot silently fall through packing ungrouped', () => {
    for (const kind of ASSET_KINDS) {
      expect(() => contentGroupIdForKind(kind)).not.toThrow();
    }
    const seen = new Map<string, string[]>();
    for (const kind of ASSET_KINDS) {
      const id = contentGroupIdForKind(kind);
      seen.set(id, [...(seen.get(id) ?? []), kind]);
    }
    const totalKindsAcrossGroups = [...seen.values()].reduce((n, kinds) => n + kinds.length, 0);
    expect(totalKindsAcrossGroups).toBe(ASSET_KINDS.length); // no kind double-counted across groups
  });

  // The live config was REVERTED to a single group on 2026-09-26 after the split
  // shipped a game that could render 16 of its 50 frames: src/app.ts fetches only
  // atlas-0.png and binds that one textureView to both bind groups, so the 34
  // frames on atlas-1.png had no loader — and tsc, vitest and vite build were all
  // green throughout. This test now pins the invariant that ACTUALLY holds, and
  // the split behaviour is exercised against an injected config below, so the
  // multi-sheet machinery keeps its coverage without the live config claiming a
  // capability the runtime does not have.
  it('currently emits a SINGLE sheet — every kind shares one group (see CONTENT_GROUPS for why)', () => {
    const ids = new Set(ASSET_KINDS.map((k) => contentGroupIdForKind(k)));
    expect(ids.size).toBe(1);
  });

  it('re-splitting requires a runtime change: nothing in src/ loads a second sheet yet', () => {
    // A guard against someone re-enabling the split without teaching the loader.
    // If you add per-sheet textures to src/app.ts, update this test deliberately.
    const appSrc = readFileSync(resolve(fileURLToPath(new URL('../../src/', import.meta.url)), 'app.ts'), 'utf8');
    const loadsMultipleSheets = /manifest\.atlases\s*\.\s*map|for\s*\(.*of\s+.*\.atlases/.test(appSrc);
    expect(CONTENT_GROUPS.length === 1 || loadsMultipleSheets).toBe(true);
  });

  it('throws rather than silently ignoring an unconfigured kind', () => {
    expect(() => contentGroupIdForKind('spaceship')).toThrow();
  });
});

// A two-group config INJECTED into the packer. The live CONTENT_GROUPS is a single
// group (the split was reverted — src/app.ts can only load one sheet), but the
// multi-sheet packing code is correct and still needed the moment the loader learns
// about sheet 2. Testing it against an injected config keeps that coverage without
// the live config advertising a capability the runtime does not have.
const SPLIT_GROUPS = [
  { id: 'terrain', kinds: ['tile'] },
  { id: 'sprites', kinds: ['car', 'wreck', 'cycle', 'prop', 'fx', 'decal', 'ui'] },
] as const;

describe('packFramesByContentGroup (multi-sheet packing, exercised via an injected config)', () => {
  function makeDecodedFrame(name: string, kind: string, w: number, h: number, rotationOffsetDeg = 0): DecodedFrameForPack {
    return {
      name,
      kind,
      w,
      h,
      rgba: makeSolid(w, h, [10, 20, 30, 255]),
      trimX: 1,
      trimY: 2,
      srcW: w + 3,
      srcH: h + 4,
      rotationOffsetDeg,
    };
  }

  it('routes tile frames onto one physical sheet and every other kind onto another, with placements staying inside their OWN sheet', () => {
    const frames = [
      makeDecodedFrame('tile-asphalt', 'tile', 40, 40),
      makeDecodedFrame('tile-arena-wall', 'tile', 40, 40),
      makeDecodedFrame('car-kart', 'car', 20, 16),
      makeDecodedFrame('ui-radar-bezel', 'ui', 12, 12, 90),
    ];
    const { atlasFileEntries, manifestFrames, canvases, errors } = packFramesByContentGroup(
      frames,
      { padding: 2, maxSize: 256, minSize: 16 },
      SPLIT_GROUPS,
    );
    expect(errors).toEqual([]);
    expect(canvases.length).toBe(atlasFileEntries.length);
    expect(atlasFileEntries.length).toBeGreaterThanOrEqual(2); // terrain + sprites, at minimum

    const tileAtlas = manifestFrames['tile-asphalt']?.atlas;
    expect(manifestFrames['tile-arena-wall']?.atlas).toBe(tileAtlas); // both tile frames share a sheet
    const carAtlas = manifestFrames['car-kart']?.atlas;
    const uiAtlas = manifestFrames['ui-radar-bezel']?.atlas;
    expect(carAtlas).toBe(uiAtlas); // non-tile kinds share the other sheet
    expect(carAtlas).not.toBe(tileAtlas); // and it is NOT the terrain sheet

    // Placement rect must stay inside the bounds of the sheet its OWN
    // manifest entry claims — the exact regression this split risks: a
    // frame's `atlas` index pointing at the wrong (globally-offset) sheet.
    for (const f of Object.values(manifestFrames)) {
      const sheet = atlasFileEntries[f.atlas];
      expect(sheet).toBeDefined();
      expect(f.x + f.w).toBeLessThanOrEqual(sheet!.width);
      expect(f.y + f.h).toBeLessThanOrEqual(sheet!.height);
    }

    expect(manifestFrames['ui-radar-bezel']?.rotationOffsetDeg).toBe(90); // survives the regroup
  });

  it(
    "resolves correct normalized UVs against EACH frame's OWN sheet dimensions end-to-end through AtlasIndex " +
      '(regression: a frame reading UVs against a differently-sized sibling sheet is the obvious failure mode of a multi-sheet packer)',
    () => {
      // A tiny terrain group (forces a small sheet) alongside a much larger
      // sprites group (forces a bigger one) — the two physical sheets come
      // out DIFFERENT sizes, the exact shape that exposes a frame computing
      // its UVs against the wrong sheet's width/height.
      const frames = [
        makeDecodedFrame('tile-only', 'tile', 30, 30),
        makeDecodedFrame('car-big-1', 'car', 100, 90),
        makeDecodedFrame('car-big-2', 'car', 100, 90),
        makeDecodedFrame('car-big-3', 'car', 100, 90),
      ];
      const { atlasFileEntries, manifestFrames } = packFramesByContentGroup(frames, { padding: 2, maxSize: 512, minSize: 32 }, SPLIT_GROUPS);

      const tileEntry = manifestFrames['tile-only']!;
      const carEntry = manifestFrames['car-big-1']!;
      const tileSheet = atlasFileEntries[tileEntry.atlas]!;
      const carSheet = atlasFileEntries[carEntry.atlas]!;
      expect(tileSheet.width).not.toBe(carSheet.width); // sanity: the two sheets actually differ in size

      const manifest: AtlasManifest = parseAtlasManifest({
        atlases: atlasFileEntries,
        frames: { 'tile-only': tileEntry, 'car-big-1': carEntry },
      });
      const index = new AtlasIndex(manifest);

      const tileInfo = index.frame('tile-only');
      expect(tileInfo.atlasFile).toBe(tileSheet.file);
      expect(tileInfo.uv.u0).toBeCloseTo(tileEntry.x / tileSheet.width, 6);
      expect(tileInfo.uv.u1).toBeCloseTo((tileEntry.x + tileEntry.w) / tileSheet.width, 6);
      expect(tileInfo.uv.v0).toBeCloseTo(tileEntry.y / tileSheet.height, 6);
      expect(tileInfo.uv.v1).toBeCloseTo((tileEntry.y + tileEntry.h) / tileSheet.height, 6);

      const carInfo = index.frame('car-big-1');
      expect(carInfo.atlasFile).toBe(carSheet.file);
      expect(carInfo.uv.u1).toBeCloseTo((carEntry.x + carEntry.w) / carSheet.width, 6);
      // The actual failure mode: computing against the WRONG (tile) sheet's
      // width would give a measurably different UV. Guard it explicitly.
      expect(carInfo.uv.u1).not.toBeCloseTo((carEntry.x + carEntry.w) / tileSheet.width, 3);
    },
  );

  it("propagates a group's packAtlas errors (e.g. an oversized frame) instead of silently dropping them", () => {
    const frames = [makeDecodedFrame('tile-huge', 'tile', 1000, 1000), makeDecodedFrame('tile-small', 'tile', 10, 10)];
    const { errors, manifestFrames } = packFramesByContentGroup(frames, { padding: 2, maxSize: 128, minSize: 16 }, SPLIT_GROUPS);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.name).toBe('tile-huge');
    expect(manifestFrames['tile-huge']).toBeUndefined();
    expect(manifestFrames['tile-small']).toBeDefined();
  });

  it('the groups argument is consulted (not hardcoded) — an empty group contributes zero sheets', () => {
    expect(SPLIT_GROUPS.length).toBeGreaterThanOrEqual(2);
    const frames = [makeDecodedFrame('car-only', 'car', 10, 10)]; // no tile frames at all
    const { atlasFileEntries, manifestFrames } = packFramesByContentGroup(frames, { padding: 2, maxSize: 64, minSize: 16 }, SPLIT_GROUPS);
    expect(atlasFileEntries).toHaveLength(1); // no empty terrain sheet emitted
    expect(manifestFrames['car-only']?.atlas).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// src/render/atlas.ts
// ---------------------------------------------------------------------------

function buildManifest(): AtlasManifest {
  return {
    atlases: [
      { file: 'atlas-0.png', width: 100, height: 50 },
      { file: 'atlas-1.png', width: 200, height: 200 },
    ],
    frames: {
      'car-compact': {
        atlas: 0,
        x: 10,
        y: 5,
        w: 20,
        h: 10,
        trimX: 3,
        trimY: 4,
        srcW: 26,
        srcH: 18,
        kind: 'car',
        rotationOffsetDeg: 0,
      },
      'tile-asphalt-clean': {
        atlas: 1,
        x: 0,
        y: 0,
        w: 200,
        h: 200,
        trimX: 0,
        trimY: 0,
        srcW: 200,
        srcH: 200,
        kind: 'tile',
        rotationOffsetDeg: 0,
      },
      'wreck-burning': {
        atlas: 0,
        x: 30,
        y: 0,
        w: 15,
        h: 15,
        trimX: 0,
        trimY: 0,
        srcW: 15,
        srcH: 15,
        kind: 'wreck',
        rotationOffsetDeg: 180,
      },
    },
  };
}

describe('AtlasIndex.frame', () => {
  it('returns correct normalized UVs and pixel/trim metadata', () => {
    const index = new AtlasIndex(buildManifest());
    const info = index.frame('car-compact');
    expect(info.atlasFile).toBe('atlas-0.png');
    expect(info.atlasIndex).toBe(0);
    expect(info.uv).toEqual({ u0: 0.1, v0: 0.1, u1: 0.3, v1: 0.3 });
    expect(info.pixelWidth).toBe(20);
    expect(info.pixelHeight).toBe(10);
    expect(info.trimX).toBe(3);
    expect(info.trimY).toBe(4);
    expect(info.srcWidth).toBe(26);
    expect(info.srcHeight).toBe(18);
    expect(info.rotationOffsetDeg).toBe(0);
  });

  it('a full-bleed tile frame covering its whole atlas gets UV 0..1', () => {
    const index = new AtlasIndex(buildManifest());
    expect(index.frame('tile-asphalt-clean').uv).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
  });

  it('carries rotationOffsetDeg through so the renderer can apply it per frame (assets/ASSET-NOTES.md section 2: the manifest used to drop it entirely)', () => {
    const index = new AtlasIndex(buildManifest());
    expect(index.frame('wreck-burning').rotationOffsetDeg).toBe(180);
  });

  it('throws UnknownAtlasFrameError for a name not in the manifest', () => {
    const index = new AtlasIndex(buildManifest());
    expect(() => index.frame('does-not-exist')).toThrow(UnknownAtlasFrameError);
    expect(index.hasFrame('does-not-exist')).toBe(false);
    expect(index.hasFrame('car-compact')).toBe(true);
  });

  it('framesOfKind lists only matching frames', () => {
    const index = new AtlasIndex(buildManifest());
    const cars = index.framesOfKind('car');
    expect(cars.map((f) => f.name)).toEqual(['car-compact']);
    const wrecks = index.framesOfKind('wreck');
    expect(wrecks.map((f) => f.name)).toEqual(['wreck-burning']);
    expect(index.framesOfKind('fx')).toEqual([]);
  });

  it('atlasFiles returns the atlas list', () => {
    const index = new AtlasIndex(buildManifest());
    expect(index.atlasFiles()).toHaveLength(2);
    expect(index.atlasFiles()[0]?.file).toBe('atlas-0.png');
  });
});

describe('parseAtlasManifest', () => {
  it('accepts a well-formed manifest', () => {
    const manifest = parseAtlasManifest(buildManifest());
    expect(manifest.atlases).toHaveLength(2);
    expect(Object.keys(manifest.frames)).toHaveLength(3);
  });

  it('rejects a non-object payload', () => {
    expect(() => parseAtlasManifest(null)).toThrow(MalformedAtlasManifestError);
    expect(() => parseAtlasManifest('atlas.json')).toThrow(MalformedAtlasManifestError);
  });

  it('rejects a frame missing rotationOffsetDeg (regression: the field used to not exist in the type at all)', () => {
    const bad = {
      atlases: [{ file: 'atlas-0.png', width: 10, height: 10 }],
      frames: {
        oops: { atlas: 0, x: 0, y: 0, w: 1, h: 1, trimX: 0, trimY: 0, srcW: 1, srcH: 1, kind: 'ui' },
      },
    };
    expect(() => parseAtlasManifest(bad)).toThrow(MalformedAtlasManifestError);
  });

  it('rejects a frame referencing an out-of-range atlas index', () => {
    const bad = {
      atlases: [{ file: 'atlas-0.png', width: 10, height: 10 }],
      frames: {
        oops: { atlas: 5, x: 0, y: 0, w: 1, h: 1, trimX: 0, trimY: 0, srcW: 1, srcH: 1, kind: 'ui' },
      },
    };
    expect(() => parseAtlasManifest(bad)).toThrow(MalformedAtlasManifestError);
  });

  it('rejects an unknown kind', () => {
    const bad = {
      atlases: [{ file: 'atlas-0.png', width: 10, height: 10 }],
      frames: {
        oops: { atlas: 0, x: 0, y: 0, w: 1, h: 1, trimX: 0, trimY: 0, srcW: 1, srcH: 1, kind: 'spaceship' },
      },
    };
    expect(() => parseAtlasManifest(bad)).toThrow(MalformedAtlasManifestError);
  });
});

// ---------------------------------------------------------------------------
// Real budget gate: measures bytes actually on disk, not values derived from
// tools/atlas-sizes.json. The buildFrame tests above (TILE_FINAL_PX /
// SPRITE_MAX_PX) are tautological against that config file: they'd pass for
// any value in it, because their expectations are sourced FROM it. This
// describe block is deliberately NOT like that — it statSyncs the committed
// PNG(s), so widening the config and repacking (or otherwise regressing the
// shipped atlas) fails this test even though it would leave every other
// atlas test green.
// ---------------------------------------------------------------------------
describe('atlas byte budget (measures real bytes on disk, not the config)', () => {
  const ASSETS_DIR = fileURLToPath(new URL('../../assets/', import.meta.url));
  /** Hard ceiling for the total size of every committed atlas sheet, matching the
   *  download budget in assets/ASSET-NOTES.md sections 4 and 8. */
  const ATLAS_BYTE_BUDGET = 6 * 1024 * 1024; // 6 MiB

  it('atlas.json lists at least one sheet', () => {
    const manifest = JSON.parse(readFileSync(resolve(ASSETS_DIR, 'atlas.json'), 'utf8')) as {
      atlases: Array<{ file: string }>;
    };
    expect(manifest.atlases.length).toBeGreaterThan(0);
  });

  it(`every sheet atlas.json lists (atlas-0.png and any siblings) totals under the ${ATLAS_BYTE_BUDGET}-byte (6 MiB) budget, measured as real file bytes on disk`, () => {
    const manifest = JSON.parse(readFileSync(resolve(ASSETS_DIR, 'atlas.json'), 'utf8')) as {
      atlases: Array<{ file: string }>;
    };
    let totalBytes = 0;
    for (const { file } of manifest.atlases) {
      totalBytes += statSync(resolve(ASSETS_DIR, file)).size;
    }
    // A budget gate that never sees real bytes is not a budget gate — guard
    // against a manifest pointing at a 0-byte or missing file passing by accident.
    expect(totalBytes).toBeGreaterThan(0);
    expect(totalBytes).toBeLessThan(ATLAS_BYTE_BUDGET);
  });

  // Closes the hole BETWEEN the two gates above, found by mutation (2026-09-26).
  //
  // Widening tools/atlas-sizes.json without repacking used to satisfy both:
  // the config-time ceiling passed because the new value was still legal, and
  // the byte gate passed because it measures the already-committed PNG, which
  // no longer corresponds to the config. A verifier repacked that config and
  // measured 13,610,797 bytes — 2.2x this budget — so a budget-blowing config
  // could be committed and ship green until someone unrelated ran a repack.
  //
  // Stamping the config's fingerprint into atlas.json ties artifact to config:
  // change tools/atlas-sizes.json and this fails until you repack.
  it('atlas.json was built from the CURRENT tools/atlas-sizes.json (stale-artifact guard)', () => {
    const manifest = JSON.parse(readFileSync(resolve(ASSETS_DIR, 'atlas.json'), 'utf8')) as {
      configFingerprint?: string;
    };
    expect(manifest.configFingerprint).toBeTruthy();
    expect(manifest.configFingerprint).toBe(fingerprintSizeConfig(loadSizeConfig()));
  });

  // The fingerprint is only worth anything if it actually moves with the
  // values it claims to track. A first draft of fingerprintSizeConfig used
  // JSON.stringify's replacer-array, which filters keys at EVERY level and so
  // silently dropped the nested maxPx/quadrantPx — producing a hash that never
  // changed. Pin both halves of the property.
  it('the fingerprint tracks nested size values and ignores key order', () => {
    const base = loadSizeConfig();
    const widened = JSON.parse(JSON.stringify(base)) as Record<string, { maxPx: number }>;
    const carMaxPx = widened.car?.maxPx;
    expect(typeof carMaxPx).toBe('number');
    widened.car = { maxPx: (carMaxPx as number) * 2 };
    expect(fingerprintSizeConfig(widened as unknown as AtlasSizeConfig)).not.toBe(
      fingerprintSizeConfig(base),
    );

    const reordered = Object.fromEntries(
      Object.keys(base).reverse().map((k) => [k, (base as unknown as Record<string, unknown>)[k]]),
    ) as unknown as AtlasSizeConfig;
    expect(fingerprintSizeConfig(reordered)).toBe(fingerprintSizeConfig(base));
  });
});

// ---------------------------------------------------------------------------
// Config-time bound: independent of the byte gate above, this catches an
// oversized tools/atlas-sizes.json the moment it's loaded — before anyone
// repacks anything. It's a coarser guard (MAX_CONFIGURABLE_PX is well above
// what the shipped atlas actually needs), so passing it is necessary but not
// sufficient for staying under the byte budget; see MAX_CONFIGURABLE_PX's
// doc comment in tools/pack-atlas.mjs for why both gates exist.
// ---------------------------------------------------------------------------
// The stopgap these replace capped ui-hud-frame and ui-title-art to 1024 to keep
// the byte gate green. The real cause turned out to be simpler and worse: grep
// showed NEITHER frame is referenced anywhere in src/ — the renderer never draws
// them. They were 54.2% of the packed sheet, shipping ~2.9MB of download for art
// the game does not use. They are now skipped outright, which took the atlas from
// 82.2% of budget to 50.2%.
// THE MISSING GUARD. On 2026-09-26 the city screen threw
// MalformedAtlasManifestError on load, in production, while 1248 tests passed:
// 'building' was added to tools/pack-atlas.mjs's ASSET_KINDS and the real
// atlas.json was packed with 16 building frames, but src/render/atlas.ts keeps
// its OWN kind list (src/render/** has zero imports by design) and rejected
// every one of them.
//
// Nothing caught it because NO test parsed the REAL shipped manifest through the
// REAL runtime parser — tests/unit/city.test.ts deliberately uses a synthetic
// fixture. A synthetic manifest can only ever prove the parser is
// self-consistent; it cannot notice that the artifact we actually ship is
// unloadable. This does.
describe('the REAL shipped manifest parses through the REAL runtime loader', () => {
  const ASSETS = fileURLToPath(new URL('../../assets/', import.meta.url));

  it('assets/atlas.json loads without throwing, with every frame the packer emitted', () => {
    const raw = JSON.parse(readFileSync(resolve(ASSETS, 'atlas.json'), 'utf8')) as unknown;
    // parseAtlasManifest is what src/app.ts calls at boot. If this throws, the
    // game does not start.
    const manifest = parseAtlasManifest(raw);
    const frameCount = Object.keys((raw as { frames: Record<string, unknown> }).frames).length;
    expect(Object.keys(manifest.frames).length).toBe(frameCount);
    expect(frameCount).toBeGreaterThan(0);
  });

  it('every kind the packer emits is a kind the runtime loader accepts', () => {
    // The two ASSET_KINDS lists cannot share a constant (zero-imports rule), so
    // assert the containment directly rather than trusting a comment.
    const raw = JSON.parse(readFileSync(resolve(ASSETS, 'atlas.json'), 'utf8')) as {
      frames: Record<string, { kind: string }>;
    };
    const packedKinds = [...new Set(Object.values(raw.frames).map((f) => f.kind))].sort();
    const unsupported = packedKinds.filter((k) => !(RUNTIME_ASSET_KINDS as readonly string[]).includes(k));
    expect({ packedKinds, unsupported }).toEqual({ packedKinds, unsupported: [] });
  });
});

describe('unused full-screen art is not packed at all', () => {
  const ASSETS = fileURLToPath(new URL('../../assets/', import.meta.url));

  it('ui-hud-frame stays marked skip and absent from the packed manifest and standalone list (still unreferenced in src/)', () => {
    const meta = JSON.parse(readFileSync(resolve(ASSETS, 'sprite-meta.json'), 'utf8')) as {
      frames: Record<string, { skip?: boolean }>;
    };
    const manifest = JSON.parse(readFileSync(resolve(ASSETS, 'atlas.json'), 'utf8')) as {
      frames: Record<string, unknown>;
      standalone: Record<string, unknown>;
    };
    expect(meta.frames['ui-hud-frame']?.skip).toBe(true);
    expect('ui-hud-frame' in manifest.frames).toBe(false);
    expect('ui-hud-frame' in manifest.standalone).toBe(false);
  });

  // ui-title-art is drawn on the title screen (showTitle, src/app.ts) as of
  // this suite, so it is no longer "unused" — it is extracted as its OWN
  // standalone file instead (see tools/atlas-sizes.json's extractStandalone),
  // never packed into atlas-0.png. tests/integration/screens.test.ts covers
  // the title screen actually drawing it.
  it('ui-title-art is no longer skipped, is extracted standalone, and never packed into the sheet', () => {
    const meta = JSON.parse(readFileSync(resolve(ASSETS, 'sprite-meta.json'), 'utf8')) as {
      frames: Record<string, { skip?: boolean }>;
    };
    const manifest = JSON.parse(readFileSync(resolve(ASSETS, 'atlas.json'), 'utf8')) as {
      frames: Record<string, unknown>;
      standalone: Record<string, { file: string; w: number; h: number }>;
    };
    expect(meta.frames['ui-title-art']?.skip).not.toBe(true);
    expect('ui-title-art' in manifest.frames).toBe(false);
    expect(manifest.standalone['ui-title-art']?.file).toBe('ui-title-art.png');
  });

  it('a frame the renderer never references must not be occupying the sheet', () => {
    // The rule, not the instance: anything marked skip stays out of the manifest.
    const meta = JSON.parse(readFileSync(resolve(ASSETS, 'sprite-meta.json'), 'utf8')) as {
      frames: Record<string, { skip?: boolean }>;
    };
    const manifest = JSON.parse(readFileSync(resolve(ASSETS, 'atlas.json'), 'utf8')) as {
      frames: Record<string, unknown>;
    };
    const skipped = Object.entries(meta.frames).filter(([, v]) => v.skip === true).map(([k]) => k);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.filter((n) => n in manifest.frames)).toEqual([]);
  });

  it('the stopgap cap is gone', () => {
    const cfg = loadSizeConfig() as unknown as { ui: { fullScreenMaxPx?: number } };
    expect(cfg.ui.fullScreenMaxPx).toBeUndefined();
  });
});

describe('loadSizeConfig', () => {
  const fixturesDir = fileURLToPath(new URL('./fixtures-atlas-sizes/', import.meta.url));

  function writeFixture(name: string, contents: string): string {
    mkdirSync(fixturesDir, { recursive: true });
    const path = resolve(fixturesDir, name);
    writeFileSync(path, contents, 'utf8');
    return path;
  }

  const validBase = {
    tile: { quadrantPx: 100 },
    building: { maxPx: 90 },
    car: { maxPx: 90 },
    wreck: { maxPx: 90 },
    cycle: { maxPx: 90 },
    prop: { maxPx: 90 },
    fx: { maxPx: 90 },
    decal: { maxPx: 90 },
    ui: { maxPx: 90, keepNative: ['ui-hud-frame'] },
  };

  it('loads the real committed tools/atlas-sizes.json without throwing', () => {
    expect(() => loadSizeConfig()).not.toThrow();
  });

  it('every kind in the real committed config is <= MAX_CONFIGURABLE_PX (regression: this is the config-time half of the atlas byte budget)', () => {
    const config = loadSizeConfig();
    expect(config.tile.quadrantPx).toBeLessThanOrEqual(MAX_CONFIGURABLE_PX);
    for (const kind of ASSET_KINDS) {
      if (kind === 'tile') continue;
      const entry = config[kind] as { maxPx: number };
      expect(entry.maxPx).toBeLessThanOrEqual(MAX_CONFIGURABLE_PX);
    }
  });

  it('round-trips a well-formed config unchanged', () => {
    const path = writeFixture('valid.json', JSON.stringify(validBase));
    expect(loadSizeConfig(path)).toEqual(validBase);
  });

  it('throws when the top-level value is not an object (array)', () => {
    const path = writeFixture('top-level-array.json', JSON.stringify([1, 2, 3]));
    expect(() => loadSizeConfig(path)).toThrow(/top-level object/);
  });

  it('throws when the top-level value is not an object (null / primitive)', () => {
    const nullPath = writeFixture('top-level-null.json', 'null');
    expect(() => loadSizeConfig(nullPath)).toThrow(/top-level object/);
    const stringPath = writeFixture('top-level-string.json', JSON.stringify('nope'));
    expect(() => loadSizeConfig(stringPath)).toThrow(/top-level object/);
  });

  it('throws when a kind entry is missing (regression: a dropped "fx" key used to fall through to SPRITE_MAX_PX silently)', () => {
    const { fx: _fx, ...withoutFx } = validBase;
    const path = writeFixture('missing-kind.json', JSON.stringify(withoutFx));
    expect(() => loadSizeConfig(path)).toThrow(/missing size entry for kind "fx"/);
  });

  it('throws when tile.quadrantPx is not an integer', () => {
    const path = writeFixture(
      'non-integer-quadrant.json',
      JSON.stringify({ ...validBase, tile: { quadrantPx: 100.5 } }),
    );
    expect(() => loadSizeConfig(path)).toThrow(/tile\.quadrantPx must be a positive integer/);
  });

  it('throws when a kind\'s maxPx is not an integer', () => {
    const path = writeFixture('non-integer-maxpx.json', JSON.stringify({ ...validBase, car: { maxPx: '90' } }));
    expect(() => loadSizeConfig(path)).toThrow(/car\.maxPx must be a positive integer/);
  });

  it('throws when ui.keepNative is not an array', () => {
    const path = writeFixture(
      'non-array-keepnative.json',
      JSON.stringify({ ...validBase, ui: { maxPx: 90, keepNative: 'ui-hud-frame' } }),
    );
    expect(() => loadSizeConfig(path)).toThrow(/ui\.keepNative must be an array/);
  });

  it('throws when tile.quadrantPx exceeds MAX_CONFIGURABLE_PX (the exact regression a verifier reintroduced: 512/1024, "roughly a 4x linear blowup")', () => {
    const path = writeFixture(
      'quadrant-too-big.json',
      JSON.stringify({ ...validBase, tile: { quadrantPx: 512 } }),
    );
    expect(() => loadSizeConfig(path)).toThrow(/tile\.quadrantPx \(512\) exceeds MAX_CONFIGURABLE_PX/);
  });

  it('throws when a kind\'s maxPx exceeds MAX_CONFIGURABLE_PX', () => {
    const path = writeFixture('maxpx-too-big.json', JSON.stringify({ ...validBase, car: { maxPx: 1024 } }));
    expect(() => loadSizeConfig(path)).toThrow(/car\.maxPx \(1024\) exceeds MAX_CONFIGURABLE_PX/);
  });
});

describe('CSS custom properties: every var() reference must resolve to a declared token', () => {
  // `--ui-surface-2` was referenced by the accent washes in menu.css and
  // builder.css for seventeen iterations and was never declared in tokens.css.
  // A `color-mix()` containing an unresolvable `var()` is an INVALID colour, so
  // the whole `background` declaration was invalid at computed-value time and
  // computed to `transparent` — the selected menu row's accent wash rendered
  // nothing at all, silently, with no error anywhere.
  //
  // It stayed invisible because selection was ALSO carried by a border, so the
  // row still looked highlighted and every screenshot looked correct. Six
  // reviews in a row reported that the selected item was "only a thin neon
  // outline" — which was literally true — and six times I measured a luma
  // average, saw a difference, and recorded the claim as false. The difference I
  // was measuring was the border. A green test suite, a clean build, a passing
  // capture gate and six contradicting expert reviews, all at once.
  //
  // This test is the fix for the CLASS, not the instance: an undeclared token is
  // now a build failure instead of a silently transparent declaration.
  it('has no undeclared, unfallbacked token references', () => {
    const cssDir = fileURLToPath(new URL('../../src/', import.meta.url));
    const cssFiles = fs
      .readdirSync(cssDir, { recursive: true, withFileTypes: true })
      .filter((e: fs.Dirent) => e.isFile() && e.name.endsWith('.css'))
      .map((e: fs.Dirent) => resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src', e.parentPath, e.name));

    const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
    const declared = new Set<string>();
    for (const file of cssFiles) {
      for (const m of readFileSync(file, 'utf8').matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(m[1]!);
    }
    // Custom properties set at RUNTIME count as declared. `--hud-radar-x/y` are
    // written into an element's inline style by hud.ts on every contact update, so
    // they exist in the document without ever appearing in a stylesheet — and a
    // test that demanded one would fail on correct code.
    const tsFiles = fs
      .readdirSync(srcDir, { recursive: true, withFileTypes: true })
      .filter((e: fs.Dirent) => e.isFile() && e.name.endsWith('.ts'))
      .map((e: fs.Dirent) => resolve(srcDir, e.parentPath, e.name));
    for (const file of tsFiles) {
      const text = readFileSync(file, 'utf8');
      // `style: \`--foo:1\`` and `setProperty('--foo', ...)` are both real.
      for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(m[1]!);
      for (const m of text.matchAll(/setProperty\(\s*['\`](--[a-zA-Z0-9-]+)/g)) declared.add(m[1]!);
    }
    expect(declared.size).toBeGreaterThan(20);

    const unresolved: string[] = [];
    for (const file of cssFiles) {
      for (const m of readFileSync(file, 'utf8').matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*[,)]/g)) {
        const name = m[1]!;
        if (declared.has(name)) continue;
        // A reference that supplies its own fallback is safe: `var(--x, red)`
        // resolves even when --x is undeclared. What is NOT safe is a bare
        // reference, because the whole declaration then computes to its initial
        // value — transparent, for a background — with no error anywhere.
        if (m[0]!.includes(',')) continue;
        unresolved.push(`${path.relative(cssDir, file)} -> ${name}`);
      }
    }
    expect([...new Set(unresolved)].sort()).toEqual([]);
  });
});
