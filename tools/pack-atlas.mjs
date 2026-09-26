#!/usr/bin/env node
// Asset atlas packer: chroma-key + despill + auto-crop the generated PNGs in
// assets/raw/, pack the results into power-of-two atlas(es), and emit a
// typed manifest (assets/atlas-N.png + assets/atlas.json).
//
// No image libraries are installed in this project, so PNG decode/encode is
// hand-rolled with zlib (see decodePNG/encodePNG below) — same approach as
// tools/sample-bg.mjs, extended to also encode and to always return RGBA.
//
// Usage: node tools/pack-atlas.mjs [--raw assets/raw] [--out assets]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { analyzeColors, buildIndexedPalette, encodeIndexedPNG } from './quantize.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const RAW_DIR = resolve(PROJECT_ROOT, argValue('--raw', 'assets/raw'));
const OUT_DIR = resolve(PROJECT_ROOT, argValue('--out', 'assets'));
const SIZE_CONFIG_PATH = resolve(PROJECT_ROOT, argValue('--sizes', 'tools/atlas-sizes.json'));

// ---------------------------------------------------------------------------
// Asset kinds
// ---------------------------------------------------------------------------

/** Kinds this pipeline understands, in filename-prefix form. Kept in sync by hand with AssetKind in src/render/atlas.ts. */
export const ASSET_KINDS = ['tile', 'prop', 'car', 'wreck', 'cycle', 'fx', 'decal', 'ui'];

/** Classifies a bare frame name (no extension) by its `<kind>-...` filename prefix. Returns null when unrecognized. */
export function classifyKind(name) {
  for (const kind of ASSET_KINDS) {
    if (name === kind || name.startsWith(`${kind}-`)) return kind;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-kind target pixel sizes (assets/ASSET-NOTES.md section 9: the initial
// download budget, not just the original 25MB "size budget" of section 4,
// forces every non-full-screen kind well below a flat 256px).
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on any per-kind pixel target in tools/atlas-sizes.json (see
 * assets/ASSET-NOTES.md section 4/8 and the "loadSizeConfig" describe block
 * in tests/unit/atlas.test.ts). This is the coarse, config-time half of the
 * atlas size budget: it catches a widened quadrantPx/maxPx the moment the
 * config is loaded, before a single pixel is repacked. It is deliberately
 * NOT a promise that any config passing this bound fits the 6 MiB atlas
 * byte budget on its own — the committed assets/atlas-0.png byte count
 * (measured in tests/unit/atlas.test.ts's "atlas byte budget" block) is what
 * proves that for the shipped artifact.
 *
 * MEASURED, not guessed (2026-09-26). An earlier revision set this to 256 and
 * reasoned that the byte gate would catch anything larger. A mutation test
 * disproved that: widening every kind to 256 WITHOUT repacking leaves the
 * whole suite green, because the byte gate stats the already-committed PNG
 * rather than anything derived from the config. The verifier then repacked at
 * 256 and measured 13,610,797 bytes — 2.2x the 6 MiB budget — so a
 * budget-blowing config could be committed and ship green until someone
 * unrelated happened to repack.
 *
 * So the ceiling is now the value that ACTUALLY implies the budget: 128, every
 * kind's shipped value, which packs to 5,896,699 bytes. The companion fix is
 * `configFingerprint` in the emitted atlas.json, which ties the committed
 * atlas to the config that produced it so a stale artifact cannot hide a
 * widened config.
 */
export const MAX_CONFIGURABLE_PX = 128;

/**
 * Loads and validates the per-kind target-size table (default
 * tools/atlas-sizes.json). Every number the downscale steps below use comes
 * from this file, never a literal in this tool — a missing or malformed
 * copy throws rather than silently falling back to some hardcoded default,
 * the same "don't silently discard ground truth" posture as loadSpriteMeta.
 */
export function loadSizeConfig(path = SIZE_CONFIG_PATH) {
  const raw = readFileSync(path, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path}: not valid JSON (${e.message})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a top-level object`);
  }
  for (const kind of ASSET_KINDS) {
    if (!parsed[kind] || typeof parsed[kind] !== 'object' || Array.isArray(parsed[kind])) {
      throw new Error(`${path}: missing size entry for kind "${kind}"`);
    }
  }
  const quadrantPx = parsed.tile.quadrantPx;
  if (!Number.isInteger(quadrantPx) || quadrantPx <= 0) {
    throw new Error(`${path}: tile.quadrantPx must be a positive integer`);
  }
  if (quadrantPx > MAX_CONFIGURABLE_PX) {
    throw new Error(`${path}: tile.quadrantPx (${quadrantPx}) exceeds MAX_CONFIGURABLE_PX (${MAX_CONFIGURABLE_PX})`);
  }
  for (const kind of ASSET_KINDS) {
    if (kind === 'tile') continue;
    const maxPx = parsed[kind].maxPx;
    if (!Number.isInteger(maxPx) || maxPx <= 0) {
      throw new Error(`${path}: ${kind}.maxPx must be a positive integer`);
    }
    if (maxPx > MAX_CONFIGURABLE_PX) {
      throw new Error(`${path}: ${kind}.maxPx (${maxPx}) exceeds MAX_CONFIGURABLE_PX (${MAX_CONFIGURABLE_PX})`);
    }
  }
  if (!Array.isArray(parsed.ui.keepNative) || !parsed.ui.keepNative.every((n) => typeof n === 'string')) {
    throw new Error(`${path}: ui.keepNative must be an array of frame names`);
  }
  return parsed;
}

/**
 * Stable hash of the size config, stamped into atlas.json as
 * `configFingerprint` and asserted by tests/unit/atlas.test.ts.
 *
 * This exists because the two size gates had a hole between them: the
 * config-time ceiling passes any legal value, and the byte gate measures the
 * ALREADY-COMMITTED png, so widening tools/atlas-sizes.json without repacking
 * satisfied both while the config on disk would actually have produced a
 * budget-blowing atlas. Recording which config built the committed artifact
 * makes that divergence visible: change the config, and the fingerprint test
 * fails until you repack.
 *
 * Keys are sorted recursively so the hash tracks VALUES, not formatting or key
 * order. Note this canonicalises by hand rather than via JSON.stringify's
 * replacer-array: that array filters keys at EVERY level, so passing the
 * top-level key list would silently drop the nested quadrantPx/maxPx values
 * this hash exists to watch, and the fingerprint would never change.
 */
function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalise(value[key]);
    return out;
  }
  return value;
}

export function fingerprintSizeConfig(config = loadSizeConfig()) {
  const canonical = JSON.stringify(canonicalise(config));
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

const SIZE_CONFIG = loadSizeConfig();

/** Pre-mirror tile quadrant size — the final tile is 2x this (see mirrorQuadrantToSeamlessTile). Sourced from tools/atlas-sizes.json, not a literal. */
export const TILE_QUADRANT_PX = SIZE_CONFIG.tile.quadrantPx;
export const TILE_FINAL_PX = TILE_QUADRANT_PX * 2;
/** Default longest-edge cap for a non-tile, non-ui sprite. Sourced from tools/atlas-sizes.json (car.maxPx); see resolveMaxPxForKind for the actual per-kind lookup buildFrame uses. */
export const SPRITE_MAX_PX = SIZE_CONFIG.car.maxPx;

/** The per-kind longest-edge cap buildFrame actually applies for `kind` (car/wreck/cycle/prop/fx/decal) — falls back to SPRITE_MAX_PX only if a kind is somehow absent from a caller-supplied config. */
function resolveMaxPxForKind(kind) {
  const entry = SIZE_CONFIG[kind];
  return entry && Number.isInteger(entry.maxPx) ? entry.maxPx : SPRITE_MAX_PX;
}

const UI_KEEP_NATIVE = new Set(SIZE_CONFIG.ui.keepNative);

/**
 * Resolves the target max-dimension to pre-scale a 'ui' kind RAW SOURCE
 * image to before it ever reaches buildFrame, or `null` when it should stay
 * native. This is deliberately a layer ABOVE buildFrame: buildFrame's own
 * "ui keeps native resolution" behavior stays kind-wide and name-agnostic
 * (tests/unit/atlas.test.ts asserts this for 'ui-radar-bezel' by name —
 * "'UI keep larger' applies regardless of keying"), so the real distinction
 * between full-screen art (ui-hud-frame, ui-title-art — sprite-meta calls
 * these "keep larger... they are full-screen art") and small HUD gauge art
 * (ui-radar-bezel, ui-speedo-dial, never full-screen) happens here, by
 * shrinking the pixels those smaller frames ever see, not by changing what
 * buildFrame does with whatever size it's handed.
 */
export function resolveUiPreScaleMaxPx(name, kind) {
  if (kind !== 'ui') return null;
  if (UI_KEEP_NATIVE.has(name)) return null;
  return SIZE_CONFIG.ui.maxPx;
}

/**
 * Applies `resolveUiPreScaleMaxPx` to a decoded `{width,height,rgba}` image:
 * area-averages it down to fit that target on its longest edge (never
 * upscaling). Returns `decoded` unchanged when no target applies, or the
 * target is already met. This is the only place a 'ui' frame's pixels get
 * smaller before packing — buildFrame itself never resizes 'ui' frames.
 */
export function preScaleForBuild(name, kind, decoded) {
  const maxPx = resolveUiPreScaleMaxPx(name, kind);
  if (maxPx === null) return decoded;
  const { width, height, rgba } = decoded;
  const maxDim = Math.max(width, height);
  if (maxDim <= maxPx) return decoded;
  const scale = maxPx / maxDim;
  const dstW = Math.max(1, Math.round(width * scale));
  const dstH = Math.max(1, Math.round(height * scale));
  return { width: dstW, height: dstH, rgba: resizeRGBA(rgba, width, height, dstW, dstH) };
}

// ---------------------------------------------------------------------------
// PNG decode (8-bit, non-interlaced, color types 0/2/4/6 -> always RGBA out)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG (bad signature)');
  let offset = 8;
  const chunks = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 8 + length + 4; // skip the trailing CRC, we don't validate it
  }
  return chunks;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterScanlines(raw, height, bpp, stride) {
  const out = Buffer.alloc(height * stride);
  let rawOffset = 0;
  let prevRowStart = -1;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[rawOffset + i];
      const a = i >= bpp ? out[rowStart + i - bpp] : 0;
      const b = prevRowStart >= 0 ? out[prevRowStart + i] : 0;
      const c = prevRowStart >= 0 && i >= bpp ? out[prevRowStart + i - bpp] : 0;
      let val;
      switch (filterType) {
        case 0:
          val = x;
          break;
        case 1:
          val = (x + a) & 0xff;
          break;
        case 2:
          val = (x + b) & 0xff;
          break;
        case 3:
          val = (x + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          val = (x + paethPredictor(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`unsupported scanline filter type ${filterType} at row ${y}`);
      }
      out[rowStart + i] = val;
    }
    rawOffset += stride;
    prevRowStart = rowStart;
  }
  return out;
}

/** Decodes a PNG buffer into `{ width, height, rgba }` (rgba is always a straight RGBA Uint8Array, alpha=255 added when the source had none). */
export function decodePNG(buf) {
  const chunks = readChunks(buf);
  const ihdrChunk = chunks.find((c) => c.type === 'IHDR');
  if (!ihdrChunk) throw new Error('missing IHDR chunk');
  const ihdr = ihdrChunk.data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr.readUInt8(8);
  const colorType = ihdr.readUInt8(9);
  const compression = ihdr.readUInt8(10);
  const filterMethod = ihdr.readUInt8(11);
  const interlace = ihdr.readUInt8(12);

  if (interlace !== 0) throw new Error('interlaced (Adam7) PNGs are not supported');
  if (compression !== 0 || filterMethod !== 0) throw new Error('unsupported compression/filter method');
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth} (only 8-bit supported)`);

  const channelsByColorType = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  if (channels === undefined) throw new Error(`unsupported color type ${colorType} (palette PNGs are not supported)`);

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const inflated = zlib.inflateSync(idat);

  const bpp = channels; // 8-bit depth => exactly one byte per channel
  const stride = width * channels;
  const expectedLen = (stride + 1) * height;
  if (inflated.length < expectedLen) {
    throw new Error(`truncated pixel data: got ${inflated.length} bytes, expected ${expectedLen}`);
  }

  const pixels = unfilterScanlines(inflated, height, bpp, stride);

  const rgba = new Uint8Array(width * height * 4);
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    const s = i * channels;
    const d = i * 4;
    if (channels === 4) {
      rgba[d] = pixels[s];
      rgba[d + 1] = pixels[s + 1];
      rgba[d + 2] = pixels[s + 2];
      rgba[d + 3] = pixels[s + 3];
    } else if (channels === 3) {
      rgba[d] = pixels[s];
      rgba[d + 1] = pixels[s + 1];
      rgba[d + 2] = pixels[s + 2];
      rgba[d + 3] = 255;
    } else if (channels === 2) {
      const g = pixels[s];
      rgba[d] = g;
      rgba[d + 1] = g;
      rgba[d + 2] = g;
      rgba[d + 3] = pixels[s + 1];
    } else {
      const g = pixels[s];
      rgba[d] = g;
      rgba[d + 1] = g;
      rgba[d + 2] = g;
      rgba[d + 3] = 255;
    }
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------
// PNG encode (8-bit RGBA, filter type 0, single IDAT)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Picks, for one scanline, whichever of PNG's 5 filter types (none/sub/up/
 * average/Paeth) leaves the smallest sum of signed-magnitude byte values —
 * the standard "minimum sum of absolute differences" heuristic (libpng's
 * default adaptive strategy). Every row got filter type 0 (none)
 * unconditionally before; per-row adaptive filtering is a lossless, "free"
 * (same pixels out) win for zlib's compression ratio on gradient/photographic
 * content, which is what actually shrinks these atlases well past what
 * resolution alone can do — see assets/ASSET-NOTES.md section 9's "prefer
 * resolution reduction plus maximum zlib compression level over palette
 * quantization."
 */
function chooseScanlineFilter(rgbaBuf, rowStart, prevRowStart, stride, bpp) {
  let bestFilter = 0;
  let bestSum = Infinity;
  let bestBytes = null;
  const candidate = new Uint8Array(stride);
  for (let filterType = 0; filterType < 5; filterType++) {
    let sum = 0;
    for (let i = 0; i < stride; i++) {
      const x = rgbaBuf[rowStart + i];
      const a = i >= bpp ? rgbaBuf[rowStart + i - bpp] : 0;
      const b = prevRowStart >= 0 ? rgbaBuf[prevRowStart + i] : 0;
      const c = prevRowStart >= 0 && i >= bpp ? rgbaBuf[prevRowStart + i - bpp] : 0;
      let val;
      switch (filterType) {
        case 0:
          val = x;
          break;
        case 1:
          val = (x - a) & 0xff;
          break;
        case 2:
          val = (x - b) & 0xff;
          break;
        case 3:
          val = (x - ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          val = (x - paethPredictor(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`unreachable filter type ${filterType}`);
      }
      candidate[i] = val;
      sum += val < 128 ? val : 256 - val;
    }
    if (sum < bestSum) {
      bestSum = sum;
      bestFilter = filterType;
      bestBytes = candidate.slice();
    }
  }
  return { filterType: bestFilter, bytes: bestBytes };
}

/** Encodes `{ width, height, rgba }` (straight RGBA) into an 8-bit RGBA PNG buffer, using per-scanline adaptive filtering (chooseScanlineFilter) and the maximum zlib compression level. */
export function encodePNG({ width, height, rgba }) {
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // color type: RGBA
  ihdrData.writeUInt8(0, 10); // compression method
  ihdrData.writeUInt8(0, 11); // filter method
  ihdrData.writeUInt8(0, 12); // interlace method

  const stride = width * 4;
  const bpp = 4; // 8-bit RGBA => exactly one byte per channel
  const rgbaBuf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const raw = Buffer.alloc((stride + 1) * height);
  let prevRowStart = -1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const { filterType, bytes } = chooseScanlineFilter(rgbaBuf, rowStart, prevRowStart, stride, bpp);
    const destStart = y * (stride + 1);
    raw[destStart] = filterType;
    raw.set(bytes, destStart + 1);
    prevRowStart = rowStart;
  }
  const compressed = zlib.deflateSync(raw, { level: zlib.constants.Z_BEST_COMPRESSION });

  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdrData), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Chroma key -> alpha, despill, auto-crop
// ---------------------------------------------------------------------------

export const MAGENTA = [255, 0, 255];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function regionMedianColor(rgba, width, x0, y0, w, h) {
  const rs = [];
  const gs = [];
  const bs = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const idx = (y * width + x) * 4;
      rs.push(rgba[idx]);
      gs.push(rgba[idx + 1]);
      bs.push(rgba[idx + 2]);
    }
  }
  return [median(rs), median(gs), median(bs)];
}

/** Samples the background color from the four corners (median per corner, then median across corners), for images with no known key color. */
export function sampleCornerKeyColor(rgba, width, height, { patch = 24 } = {}) {
  const p = Math.max(1, Math.min(patch, Math.floor(Math.min(width, height) / 2)));
  const corners = [
    regionMedianColor(rgba, width, 0, 0, p, p),
    regionMedianColor(rgba, width, width - p, 0, p, p),
    regionMedianColor(rgba, width, 0, height - p, p, p),
    regionMedianColor(rgba, width, width - p, height - p, p, p),
  ];
  return [median(corners.map((c) => c[0])), median(corners.map((c) => c[1])), median(corners.map((c) => c[2]))];
}

/** Converts 8-bit RGB to HSV: hue in degrees `[0,360)`, saturation/value in `[0,1]`. */
export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

/** Shortest angular distance between two hues in degrees, always in `[0,180]`. */
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Chroma-keys `rgba` in place by HUE BAND, not RGB distance (see
 * assets/ASSET-NOTES.md section 6): pixels within `tolerance` degrees of
 * `keyColor`'s hue (ramping to fully opaque over the next `feather` degrees)
 * become transparent. Background pink/magenta is high-saturation at any
 * lightness, so hue + a saturation floor separates it from desaturated
 * foreground detail (dark armour plating) even when a soft drop-shadow or
 * gradient makes the background itself go dark — an RGB-distance key cannot
 * do this without either leaving the shadow in or eating the armour. A
 * value floor additionally protects near-black pixels, where HSV hue/
 * saturation become numerically unstable (tiny RGB noise near 0,0,0 can
 * read as high "saturation" at an arbitrary hue).
 */
export function chromaKeyToAlpha(rgba, width, height, { keyColor = MAGENTA, tolerance = 18, feather = 18, satFloor = 0.15, valFloor = 0.08 } = {}) {
  const [kr, kg, kb] = keyColor;
  const keyHue = rgbToHsv(kr, kg, kb).h;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const { h, s, v } = rgbToHsv(r, g, b);

    if (s < satFloor || v < valFloor) {
      rgba[idx + 3] = 255;
      continue;
    }

    const dist = hueDistance(h, keyHue);

    let alpha;
    if (dist <= tolerance) alpha = 0;
    else if (dist >= tolerance + feather) alpha = 255;
    else alpha = Math.round(((dist - tolerance) / feather) * 255);
    rgba[idx + 3] = alpha;
  }
  return rgba;
}

/**
 * Reduces the magenta/pink fringe on partially-keyed edge pixels (0 < alpha
 * < 255) in place: magenta spill shows up as red/blue channels running
 * higher than green, so we pull the excess back down toward green. Fully
 * transparent and fully opaque pixels are left untouched.
 */
export function despillEdges(rgba, width, height) {
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const a = rgba[idx + 3];
    if (a === 0 || a === 255) continue;

    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const spill = Math.min(r, b) - g;
    if (spill <= 0) continue;

    if (r > g) rgba[idx] = Math.max(g, r - spill);
    if (b > g) rgba[idx + 2] = Math.max(g, b - spill);
  }
  return rgba;
}

/** Bounding box (in source pixel space) of every pixel with alpha > `alphaThreshold`. `{x:0,y:0,w:0,h:0}` when nothing passes. */
export function autoCropToAlphaBBox(rgba, width, height, { alphaThreshold = 0 } = {}) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = rgba[(y * width + x) * 4 + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Copies the `bbox` region of `rgba` (source `width` wide) into a new tightly-packed RGBA buffer. */
export function cropRGBA(rgba, width, bbox) {
  const { x, y, w, h } = bbox;
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * width + x) * 4;
    out.set(rgba.subarray(srcStart, srcStart + w * 4), row * w * 4);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Downscale (box/area filter) + seamless tile mirroring
// ---------------------------------------------------------------------------

/**
 * Area-weighted (box filter) resize: each destination pixel is the average
 * of the source rectangle it covers. Correct for arbitrary (non-integer)
 * scale ratios and, unlike point sampling, doesn't alias on a 4x+ downscale
 * (the raw sprites are 1024px, packed at 256/512 — see assets/ASSET-NOTES.md
 * section 4). Only ever called to shrink in this pipeline; returns `rgba`
 * unchanged if the requested size already matches.
 */
export function resizeRGBA(rgba, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return rgba;
  const out = new Uint8Array(dstW * dstH * 4);
  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor((dy * srcH) / dstH);
    const sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * srcH) / dstH));
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor((dx * srcW) / dstW);
      const sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * srcW) / dstW));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1 && sy < srcH; sy++) {
        for (let sx = sx0; sx < sx1 && sx < srcW; sx++) {
          const idx = (sy * srcW + sx) * 4;
          r += rgba[idx];
          g += rgba[idx + 1];
          b += rgba[idx + 2];
          a += rgba[idx + 3];
          count++;
        }
      }
      const outIdx = (dy * dstW + dx) * 4;
      if (count === 0) continue; // stays 0,0,0,0 — cannot happen for dstW/dstH <= srcW/srcH
      out[outIdx] = Math.round(r / count);
      out[outIdx + 1] = Math.round(g / count);
      out[outIdx + 2] = Math.round(b / count);
      out[outIdx + 3] = Math.round(a / count);
    }
  }
  return out;
}

function flipHorizontal(rgba, w, h) {
  const out = new Uint8Array(rgba.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * 4;
      const dstIdx = (y * w + (w - 1 - x)) * 4;
      out[dstIdx] = rgba[srcIdx];
      out[dstIdx + 1] = rgba[srcIdx + 1];
      out[dstIdx + 2] = rgba[srcIdx + 2];
      out[dstIdx + 3] = rgba[srcIdx + 3];
    }
  }
  return out;
}

function flipVertical(rgba, w, h) {
  const out = new Uint8Array(rgba.length);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const srcStart = y * rowBytes;
    const dstStart = (h - 1 - y) * rowBytes;
    out.set(rgba.subarray(srcStart, srcStart + rowBytes), dstStart);
  }
  return out;
}

/**
 * Turns a `qSize`x`qSize` tile into a `2*qSize`x`2*qSize` SEAMLESS tile by
 * 4-way mirroring it into quadrants (original / h-flip / v-flip / both) —
 * the fix chosen for assets/ASSET-NOTES.md section 3 ("tile-* textures are
 * NOT seamless"), over the "offset 50% + heal the seam cross" alternative,
 * because it's deterministic and needs no per-tile manual retouching.
 *
 * This also means a ground shader never needs hardware GL_REPEAT / an
 * unshared standalone texture (section 3's other complaint, about tiles
 * sharing a packed atlas at non-zero offsets): repeating THIS image via
 * manual `fract()` addressing inside its own atlas sub-rect is seamless on
 * its own, because opposite edges of a 4-way mirror are pixel-identical by
 * construction (verified in tests/unit/atlas.test.ts).
 */
export function mirrorQuadrantToSeamlessTile(quadrant, qSize) {
  const size = qSize * 2;
  const out = new Uint8Array(size * size * 4);
  const h = flipHorizontal(quadrant, qSize, qSize);
  const v = flipVertical(quadrant, qSize, qSize);
  const hv = flipVertical(h, qSize, qSize);
  blit(out, size, quadrant, qSize, qSize, 0, 0);
  blit(out, size, h, qSize, qSize, qSize, 0);
  blit(out, size, v, qSize, qSize, 0, qSize);
  blit(out, size, hv, qSize, qSize, qSize, qSize);
  return out;
}

// ---------------------------------------------------------------------------
// Shelf/skyline atlas packer
// ---------------------------------------------------------------------------

function shelfPack(frames, atlasW, atlasH, padding) {
  const placements = [];
  const leftover = [];
  let shelfY = 0;
  let shelfH = 0;
  let cursorX = 0;
  for (const f of frames) {
    const pw = f.w + padding;
    const ph = f.h + padding;
    if (pw > atlasW || ph > atlasH) {
      leftover.push(f);
      continue;
    }
    if (cursorX + pw > atlasW) {
      shelfY += shelfH;
      cursorX = 0;
      shelfH = 0;
    }
    if (shelfY + ph > atlasH) {
      leftover.push(f);
      continue;
    }
    placements.push({ name: f.name, x: cursorX, y: shelfY, w: f.w, h: f.h });
    cursorX += pw;
    shelfH = Math.max(shelfH, ph);
  }
  return { placements, leftover };
}

/**
 * Packs `frames` ({name,w,h}) into one or more square power-of-two atlases
 * (smallest size that fits first, growing up to `maxSize`, spilling into a
 * new atlas rather than ever overlapping two frames). Returns `{ atlases,
 * errors }`; `errors` lists any frame that could not be placed at all (e.g.
 * bigger than `maxSize` even alone) by name and reason — nothing is ever
 * silently dropped.
 */
export function packAtlas(frames, { padding = 2, maxSize = 4096, minSize = 64 } = {}) {
  const sorted = [...frames].sort((a, b) => b.h - a.h || b.w - a.w || a.name.localeCompare(b.name));
  const atlases = [];
  const errors = [];
  let remaining = sorted;

  while (remaining.length > 0) {
    const oversized = remaining.filter((f) => f.w + padding > maxSize || f.h + padding > maxSize);
    if (oversized.length > 0) {
      for (const f of oversized) {
        errors.push({ name: f.name, reason: `frame ${f.w}x${f.h} (+${padding}px padding) exceeds max atlas size ${maxSize}` });
      }
      const oversizedSet = new Set(oversized.map((f) => f.name));
      remaining = remaining.filter((f) => !oversizedSet.has(f.name));
      if (remaining.length === 0) break;
    }

    let fitAll = null;
    for (let size = minSize; size <= maxSize; size *= 2) {
      const result = shelfPack(remaining, size, size, padding);
      if (result.leftover.length === 0) {
        fitAll = { size, placements: result.placements };
        break;
      }
    }

    if (fitAll) {
      atlases.push({ width: fitAll.size, height: fitAll.size, placements: fitAll.placements });
      remaining = [];
      continue;
    }

    // Doesn't all fit in one atlas even at maxSize: take as much as fits, spill the rest into another atlas.
    const partial = shelfPack(remaining, maxSize, maxSize, padding);
    if (partial.placements.length === 0) {
      // Safety valve against an infinite loop; every practical case is handled above.
      for (const f of remaining) errors.push({ name: f.name, reason: 'could not be placed in any atlas' });
      break;
    }
    atlases.push({ width: maxSize, height: maxSize, placements: partial.placements });
    const placedNames = new Set(partial.placements.map((p) => p.name));
    remaining = remaining.filter((f) => !placedNames.has(f.name));
  }

  return { atlases, errors };
}

// ---------------------------------------------------------------------------
// Content-based sheet grouping (assets/ASSET-NOTES.md section 9 addendum,
// 2026-09-26): a single shared shelf-packed sheet mixes photographic tile-*
// terrain (16 frames, each a fixed TILE_FINAL_PX square) with flat-shaded
// sprites/fx/decals/ui (variable, mostly small, mostly-transparent after
// chroma-keying). Shelf packing sorts strictly by height then width, so the
// tile frames' uniform height forces tall shelves that strand the small
// sprite frames' rows half-empty around them; splitting the two into their
// own packAtlas() calls removes that cross-contamination and lets EACH
// group's shelf packer converge on the smallest power-of-two canvas its own
// content needs, rather than one shared canvas sized by the mix of both
// (measured: the two groups below each independently fit a 2048x2048 canvas
// against a single mixed 4096x4096 for the same 50 frames — a 4x reduction in
// total canvas pixels). This is a PACKER change, not a manifest-format change:
// atlas.json's `atlases[]` + per-frame `atlas` index already support any
// number of sheets (src/render/atlas.ts resolves every frame's UVs against
// its OWN sheet's width/height), so adding a second sheet here needs no
// changes to the manifest shape or to how a frame is resolved.
// ---------------------------------------------------------------------------

/**
 * Ordered physical sheets. Every kind in ASSET_KINDS must appear in exactly
 * one group — `contentGroupIdForKind` throws otherwise, so a newly-added
 * AssetKind can't silently fall through packing ungrouped. `tile` gets its
 * own sheet (photographic, always full-bleed, fixed-size squares); every
 * other kind (car/wreck/cycle/prop/fx/decal/ui — flat-shaded, chroma-keyed,
 * mostly-transparent) shares a second sheet.
 */
/**
 * Content groups decide how many sheets the packer emits. One group = one sheet.
 *
 * REVERTED TO A SINGLE GROUP 2026-09-26, deliberately, after verification caught
 * a shipping regression. Splitting terrain from sprites saved 151,218 bytes, but
 * src/app.ts fetches only `assets/atlas-0.png` and binds that ONE textureView to
 * both the tile and sprite bind groups. 34 of 50 frames moved to atlas-1.png,
 * which is never fetched and which `vite build` did not even emit — so the sprite
 * pass would have sampled the terrain sheet. tsc, vitest and the build were all
 * green while the game rendered 16 of its 50 frames.
 *
 * The multi-sheet path in this file is correct and tested; what is missing is the
 * runtime half. Re-splitting requires src/app.ts to create a texture and bind
 * group PER manifest.atlases entry, plus a test asserting every listed sheet is
 * actually fetched. Until that exists, one sheet is the only honest setting.
 */
export const CONTENT_GROUPS = [
  { id: 'all', kinds: ['tile', 'car', 'wreck', 'cycle', 'prop', 'fx', 'decal', 'ui'] },
];

export function contentGroupIdForKind(kind) {
  const group = CONTENT_GROUPS.find((g) => g.kinds.includes(kind));
  if (!group) throw new Error(`contentGroupIdForKind: no CONTENT_GROUPS entry covers kind "${kind}"`);
  return group.id;
}

/**
 * Packs `decodedFrames` ({name,kind,w,h,rgba,trimX,trimY,srcW,srcH,
 * rotationOffsetDeg}) into one or more physical sheets PER content group (in
 * `CONTENT_GROUPS` order), each group packed independently via `packAtlas` so
 * it converges on its own smallest-fitting power-of-two canvas. Sheet/atlas
 * indices are assigned globally, in the order sheets are produced (every
 * `terrain` sheet before every `sprites` sheet), so a frame's `atlas` index
 * in the returned `manifestFrames` always points at the correct entry in
 * `atlasFileEntries` regardless of which group it came from.
 *
 * Returns `atlasFileEntries` ({file,width,height}, ready for atlas.json),
 * `manifestFrames` (ready for atlas.json's `frames`), `canvases` (index-
 * aligned with `atlasFileEntries` — the blitted RGBA pixels for each sheet,
 * ready for `encodePNG`), and `errors` (every group's packAtlas errors,
 * concatenated — nothing is ever silently dropped).
 */
/**
 * `groups` is injectable so the multi-sheet machinery stays under test even while
 * the LIVE config is a single group. The split is reverted at runtime (see
 * CONTENT_GROUPS above) because src/app.ts can only load one sheet — but the
 * packer half is correct, and deleting its tests to match a temporary config
 * would throw away the code we need the moment the loader learns about sheet 2.
 */
export function packFramesByContentGroup(decodedFrames, packOptions = {}, groups = CONTENT_GROUPS) {
  const frameByName = new Map(decodedFrames.map((f) => [f.name, f]));
  const atlasFileEntries = [];
  const manifestFrames = {};
  const canvases = [];
  const errors = [];

  for (const group of groups) {
    const groupFrames = decodedFrames.filter((f) => group.kinds.includes(f.kind));
    if (groupFrames.length === 0) continue;

    const { atlases, errors: groupErrors } = packAtlas(
      groupFrames.map((f) => ({ name: f.name, w: f.w, h: f.h })),
      packOptions,
    );
    errors.push(...groupErrors);

    for (const atlas of atlases) {
      const atlasIndex = atlasFileEntries.length;
      const canvas = new Uint8Array(atlas.width * atlas.height * 4);
      for (const p of atlas.placements) {
        const f = frameByName.get(p.name);
        blit(canvas, atlas.width, f.rgba, f.w, f.h, p.x, p.y);
        manifestFrames[p.name] = {
          atlas: atlasIndex,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          trimX: f.trimX,
          trimY: f.trimY,
          srcW: f.srcW,
          srcH: f.srcH,
          kind: f.kind,
          rotationOffsetDeg: f.rotationOffsetDeg,
        };
      }
      atlasFileEntries.push({ file: `atlas-${atlasIndex}.png`, width: atlas.width, height: atlas.height });
      canvases.push({ width: atlas.width, height: atlas.height, rgba: canvas });
    }
  }

  return { atlasFileEntries, manifestFrames, canvases, errors };
}

// ---------------------------------------------------------------------------
// CLI pipeline
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) throw new Error(`invalid hex color "${hex}"`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Loads and validates `sprite-meta.json`. A MISSING file is a legitimate,
 * silent `null` (raw assets not yet audited — main() falls back to
 * filename-prefix classification). Anything else wrong with an EXISTING
 * file — bad JSON, or valid JSON that isn't the expected `{frames:{...}}`
 * shape — throws instead of returning `null`, so one bad byte can't
 * silently discard every frame's ground truth (keyColor, kind, keyed,
 * rotationOffsetDeg) and fall back to chroma-keying full-bleed UI art with
 * a hardcoded #FF00FF, per assets/ASSET-NOTES.md section 1.
 */
export function loadSpriteMeta(path = resolve(OUT_DIR, 'sprite-meta.json')) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path}: not valid JSON (${e.message})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.frames || typeof parsed.frames !== 'object') {
    throw new Error(`${path}: expected a top-level object with a "frames" object`);
  }
  return parsed;
}

function blit(dst, dstWidth, src, srcW, srcH, dx, dy) {
  for (let row = 0; row < srcH; row++) {
    const srcStart = row * srcW * 4;
    const dstStart = ((dy + row) * dstWidth + dx) * 4;
    dst.set(src.subarray(srcStart, srcStart + srcW * 4), dstStart);
  }
}

/**
 * Resolves whether a frame should be chroma-keyed. When there is no
 * sprite-meta entry at all, falls back to "every kind but tile" (tiles are
 * always full-bleed art). When a meta entry EXISTS, `keyed` must be an
 * explicit boolean — a frame added to sprite-meta.json without it is
 * refused rather than silently packed unkeyed with its background baked in
 * opaque (assets/ASSET-NOTES.md section 1 / the "keyed" field is the only
 * thing standing between a sprite and its raw magenta background).
 */
export function resolveShouldKey(name, kind, meta) {
  if (!meta) return kind !== 'tile';
  if (typeof meta.keyed !== 'boolean') {
    throw new Error(`sprite-meta.json: frame "${name}" has no boolean "keyed" field`);
  }
  return meta.keyed;
}

/**
 * Resolves a frame's `rotationOffsetDeg` (degrees to rotate the sprite so
 * its nose points up at world rotation 0 — assets/ASSET-NOTES.md section 2).
 * Absent is a genuine "no offset" (0), which is what sprite-meta.json
 * itself declares for tile/ui frames; anything present but not a finite
 * number is a data error and throws rather than silently becoming 0.
 */
export function resolveRotationOffsetDeg(name, meta) {
  if (!meta || meta.rotationOffsetDeg === undefined) return 0;
  const deg = meta.rotationOffsetDeg;
  if (typeof deg !== 'number' || !Number.isFinite(deg)) {
    throw new Error(`sprite-meta.json: frame "${name}" has a non-numeric rotationOffsetDeg`);
  }
  return deg;
}

export function buildFrame(name, kind, decoded, meta) {
  const { width, height, rgba } = decoded;
  const rotationOffsetDeg = resolveRotationOffsetDeg(name, meta);

  if (kind === 'tile') {
    // tile-* is always full-bleed, never chroma-keyed (assets/ASSET-NOTES.md
    // section 1/3); downscale to a quadrant and 4-way mirror it seamless.
    const quadrant = resizeRGBA(rgba, width, height, TILE_QUADRANT_PX, TILE_QUADRANT_PX);
    const seamless = mirrorQuadrantToSeamlessTile(quadrant, TILE_QUADRANT_PX);
    return {
      name,
      kind,
      rgba: seamless,
      w: TILE_FINAL_PX,
      h: TILE_FINAL_PX,
      trimX: 0,
      trimY: 0,
      srcW: TILE_FINAL_PX,
      srcH: TILE_FINAL_PX,
      rotationOffsetDeg,
    };
  }

  const shouldKey = resolveShouldKey(name, kind, meta);

  if (!shouldKey) {
    return { name, kind, rgba, w: width, h: height, trimX: 0, trimY: 0, srcW: width, srcH: height, rotationOffsetDeg };
  }

  const keyColor = meta && meta.keyColor ? hexToRgb(meta.keyColor) : sampleCornerKeyColor(rgba, width, height);
  // `keyColorDeviation` (measured across the 4 corner PATCHES) is only a lower
  // bound on real background variance: several frames carry a soft radial
  // vignette/drop-shadow that shifts a single corner pixel much further from
  // the reported key than the patch-to-patch deviation alone suggests. Widen
  // the HUE tolerance (degrees, not RGB units — assets/ASSET-NOTES.md section
  // 6) for those frames; the saturation/value floors in chromaKeyToAlpha are
  // what keep this from eating real (desaturated) foreground detail.
  const tolerance = meta && typeof meta.keyColorDeviation === 'number' ? clamp(meta.keyColorDeviation * 0.4 + 14, 14, 45) : 18;

  chromaKeyToAlpha(rgba, width, height, { keyColor, tolerance, feather: 18 });
  despillEdges(rgba, width, height);
  // A handful of edge pixels always land just past the feather ramp (alpha
  // ~1-15) rather than hitting exactly 0, so crop against a small threshold
  // instead of pure >0 — otherwise a single near-invisible corner pixel
  // pins the bbox to the full canvas and nothing ever trims.
  const bbox = autoCropToAlphaBBox(rgba, width, height, { alphaThreshold: 12 });
  if (bbox.w === 0 || bbox.h === 0) return null;

  let cropped = cropRGBA(rgba, width, bbox);
  let w = bbox.w;
  let h = bbox.h;
  let trimX = bbox.x;
  let trimY = bbox.y;
  let srcW = width;
  let srcH = height;

  // "UI keep larger" — every other kind downscales to fit its per-kind
  // target (tools/atlas-sizes.json). trimX/trimY/srcW/srcH describe
  // position/size in a conceptual full-canvas space that w/h must stay
  // proportional to, so they scale down with the pixel data rather than
  // staying pinned to the pre-downscale (1024) source.
  if (kind !== 'ui') {
    const maxPx = resolveMaxPxForKind(kind);
    const maxDim = Math.max(w, h);
    if (maxDim > maxPx) {
      const scale = maxPx / maxDim;
      const dstW = Math.max(1, Math.round(w * scale));
      const dstH = Math.max(1, Math.round(h * scale));
      cropped = resizeRGBA(cropped, w, h, dstW, dstH);
      trimX = Math.round(trimX * scale);
      trimY = Math.round(trimY * scale);
      srcW = Math.round(srcW * scale);
      srcH = Math.round(srcH * scale);
      w = dstW;
      h = dstH;
    }
  }

  return { name, kind, rgba: cropped, w, h, trimX, trimY, srcW, srcH, rotationOffsetDeg };
}

/**
 * Encodes one fully-blitted atlas sheet canvas ({width,height,rgba}),
 * choosing PNG's indexed color type (3) over truecolor RGBA (6) ONLY when
 * that is a lossless re-encoding of the exact same pixels AND it comes out
 * smaller (see tools/quantize.mjs). A shared atlas sheet is one PNG file, so
 * this is necessarily a WHOLE-SHEET decision — indexed color type applies to
 * every pixel in the file, not per packed frame, so quantization here can
 * only help when every frame sharing that sheet, TOGETHER, stays within
 * PNG's 256-color palette ceiling (see CONTENT_GROUPS above for the
 * tile-vs-sprite sheet split that keeps photographic tile content off the
 * same sheet as flat-shaded sprites in the first place).
 *
 * Never mutates pixels: `buildIndexedPalette` returns `null` rather than
 * quantizing when the sheet has more than 256 distinct (r,g,b,a) tuples, and
 * this function falls back to the existing truecolor `encodePNG` whenever
 * that happens, or whenever the indexed encoding is not actually smaller.
 */
export function encodeAtlasSheet(canvas, fileName) {
  const truecolorBuf = encodePNG(canvas);
  const { uniqueCount } = analyzeColors(canvas.rgba);
  if (uniqueCount > 256) {
    return {
      buffer: truecolorBuf,
      note: `pack-atlas: ${fileName} kept truecolor RGBA (${uniqueCount} distinct colors across the sheet, over PNG's 256-color indexed ceiling — lossless palette quantization does not apply; see tools/quantize.mjs's per-frame report for which individual frames would qualify on their own).`,
    };
  }
  const built = buildIndexedPalette(canvas.rgba, { maxColors: 256 });
  const indexedBuf = encodeIndexedPNG({ width: canvas.width, height: canvas.height, palette: built.palette, indices: built.indices });
  if (indexedBuf.length < truecolorBuf.length) {
    const savedPct = (100 * (1 - indexedBuf.length / truecolorBuf.length)).toFixed(1);
    return {
      buffer: indexedBuf,
      note: `pack-atlas: ${fileName} losslessly re-encoded as indexed PNG (${uniqueCount} colors): ${truecolorBuf.length} -> ${indexedBuf.length} bytes (-${savedPct}%).`,
    };
  }
  return {
    buffer: truecolorBuf,
    note: `pack-atlas: ${fileName} qualifies for indexed color (${uniqueCount} colors) but truecolor was not larger (${truecolorBuf.length} bytes either way) — kept truecolor.`,
  };
}

async function main() {
  if (!existsSync(RAW_DIR)) {
    console.log(`pack-atlas: ${RAW_DIR} does not exist yet — nothing to pack.`);
    return;
  }
  const pngFiles = readdirSync(RAW_DIR).filter((f) => extname(f).toLowerCase() === '.png');
  if (pngFiles.length === 0) {
    console.log(`pack-atlas: ${RAW_DIR} has no PNGs yet (still filling?) — nothing to pack.`);
    return;
  }

  const spriteMeta = loadSpriteMeta();
  const skipped = [];
  const decodedFrames = [];

  for (const file of pngFiles) {
    const name = basename(file, '.png');
    const meta = spriteMeta?.frames?.[name];

    if (meta?.skip === true) {
      skipped.push({ name, reason: meta.note ? `skipped: ${meta.note}` : 'marked skip in sprite-meta.json' });
      continue;
    }

    const kind = meta?.kind ?? classifyKind(name);
    if (kind === null) {
      skipped.push({ name, reason: 'unrecognized filename prefix (expected tile-/prop-/car-/wreck-/cycle-/fx-/decal-/ui-)' });
      continue;
    }

    let decoded;
    try {
      decoded = decodePNG(readFileSync(resolve(RAW_DIR, file)));
    } catch (e) {
      skipped.push({ name, reason: `PNG decode failed: ${e.message}` });
      continue;
    }

    decoded = preScaleForBuild(name, kind, decoded);

    const frame = buildFrame(name, kind, decoded, meta);
    if (frame === null) {
      skipped.push({ name, reason: 'fully keyed away — no non-background pixels found' });
      continue;
    }
    decodedFrames.push(frame);
  }

  if (decodedFrames.length === 0) {
    console.log(`pack-atlas: no packable frames found. skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  - ${s.name}: ${s.reason}`);
    return;
  }

  const { atlasFileEntries, manifestFrames, canvases, errors } = packFramesByContentGroup(decodedFrames);
  for (const err of errors) skipped.push(err);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  canvases.forEach((canvas, atlasIndex) => {
    const fileName = atlasFileEntries[atlasIndex].file;
    const { buffer, note } = encodeAtlasSheet(canvas, fileName);
    console.log(note);
    writeFileSync(resolve(OUT_DIR, fileName), buffer);
  });

  writeFileSync(
    resolve(OUT_DIR, 'atlas.json'),
    JSON.stringify(
      { atlases: atlasFileEntries, configFingerprint: fingerprintSizeConfig(), frames: manifestFrames },
      null,
      2,
    ),
  );

  console.log(`pack-atlas: packed ${decodedFrames.length} frame(s) into ${atlasFileEntries.length} atlas(es):`);
  for (const a of atlasFileEntries) console.log(`  - ${a.file}: ${a.width}x${a.height}`);
  console.log(skipped.length > 0 ? `pack-atlas: skipped ${skipped.length}:` : 'pack-atlas: skipped none');
  for (const s of skipped) console.log(`  - ${s.name}: ${s.reason}`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
