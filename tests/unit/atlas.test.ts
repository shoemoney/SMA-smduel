import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
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
interface PackAtlasModule {
  MAGENTA: readonly [number, number, number];
  TILE_QUADRANT_PX: number;
  TILE_FINAL_PX: number;
  SPRITE_MAX_PX: number;
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

  it('leaves fully opaque pixels untouched', () => {
    const rgba = new Uint8Array(4);
    rgba.set([200, 60, 210, 255]);
    despillEdges(rgba, 1, 1);
    expect(Array.from(rgba)).toEqual([200, 60, 210, 255]);
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

  it('returns null for the two full-screen ui frames', () => {
    expect(resolveUiPreScaleMaxPx('ui-hud-frame', 'ui')).toBeNull();
    expect(resolveUiPreScaleMaxPx('ui-title-art', 'ui')).toBeNull();
  });

  it('returns a positive target for every other ui frame', () => {
    const maxPx = resolveUiPreScaleMaxPx('ui-radar-bezel', 'ui');
    expect(maxPx).not.toBeNull();
    expect(maxPx as number).toBeGreaterThan(0);
    expect(resolveUiPreScaleMaxPx('ui-speedo-dial', 'ui')).toBe(maxPx);
  });

  it('preScaleForBuild leaves a full-screen ui frame\'s pixels untouched, even above the general target', () => {
    const decoded: DecodedImage = { width: 1344, height: 768, rgba: makeSolid(1344, 768, [10, 20, 30, 255]) };
    const result = preScaleForBuild('ui-hud-frame', 'ui', decoded);
    expect(result).toBe(decoded); // same object — not even a copy
  });

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
