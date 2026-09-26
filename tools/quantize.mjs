#!/usr/bin/env node
// Lossless (or measured-below-threshold) palette quantization for the atlas
// packer (tools/pack-atlas.mjs).
//
// PNG's indexed color type (3) stores up to 256 RGBA colors once in a PLTE
// (+ optional tRNS for alpha) chunk and one palette-index byte per pixel,
// instead of 4 raw RGBA bytes per pixel — a strict, lossless re-encoding of
// the exact same pixels whenever an image (or, since this pipeline packs
// every frame into ONE shared sheet, an atlas SHEET) uses 256 or fewer
// distinct (r,g,b,a) tuples. It buys nothing and costs nothing when a sheet
// has more than 256 colors — you cannot index what does not fit the palette
// without discarding color information, which is exactly the "do not force
// the photographic tiles" instruction this tool is built around.
//
// This module is intentionally self-contained (no import from
// pack-atlas.mjs — see the CLI section at the bottom for why: pack-atlas.mjs
// imports the encode helpers below, so importing pack-atlas.mjs back at the
// top level would make the two files load each other, which is legal ESM
// but needless here). It duplicates the small CRC32/pngChunk/adaptive-filter
// helpers pack-atlas.mjs also has — the same "no image libraries installed,
// so PNG chunk-writing is hand-rolled" situation documented at the top of
// tools/pack-atlas.mjs, and the same duplication tools/sample-bg.mjs already
// has relative to pack-atlas.mjs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------
// Color / alpha analysis
// ---------------------------------------------------------------------------

/** Packs one RGBA pixel into a 32-bit key for Set/Map membership. */
function colorKey(r, g, b, a) {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

/**
 * Scans `rgba` (straight, 4 bytes/pixel) once and returns:
 *  - `uniqueCount`: exact number of distinct (r,g,b,a) tuples
 *  - `alphaBinary`: true iff every alpha byte is exactly 0 or 255 (no
 *    partial/antialiased alpha at all — a stronger, separate fact from the
 *    color count, since a frame can have <=256 colors yet still carry
 *    partial alpha, or >256 colors with perfectly binary alpha)
 *  - `distinctAlphaCount`: number of distinct alpha byte VALUES seen
 *    (1 = fully opaque or a single constant alpha, 2 with alphaBinary=true
 *    means a clean cutout mask)
 */
export function analyzeColors(rgba) {
  const colors = new Set();
  const alphas = new Set();
  let alphaBinary = true;
  const n = rgba.length / 4;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const a = rgba[o + 3];
    colors.add(colorKey(r, g, b, a));
    alphas.add(a);
    if (a !== 0 && a !== 255) alphaBinary = false;
  }
  return { uniqueCount: colors.size, alphaBinary, distinctAlphaCount: alphas.size };
}

// ---------------------------------------------------------------------------
// Indexed-palette build (exact — never called unless analyzeColors said <=256)
// ---------------------------------------------------------------------------

/**
 * Builds an EXACT (lossless) indexed palette for `rgba` (straight RGBA,
 * width*height*4 bytes). Returns `null` when the image has more than
 * `maxColors` (default 256, PNG's indexed-color ceiling) distinct (r,g,b,a)
 * tuples — the caller's signal to keep the truecolor encoding instead of
 * forcing a lossy quantization. Every returned `indices[i]` maps back to
 * `palette[indices[i]]` byte-for-byte identical to the source pixel; this is
 * a re-encoding, not an approximation.
 */
export function buildIndexedPalette(rgba, { maxColors = 256 } = {}) {
  const paletteIndex = new Map(); // colorKey -> palette slot
  const palette = []; // [r,g,b,a][]
  const n = rgba.length / 4;
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const a = rgba[o + 3];
    const key = colorKey(r, g, b, a);
    let slot = paletteIndex.get(key);
    if (slot === undefined) {
      if (palette.length >= maxColors) return null; // over budget — bail, no partial work kept
      slot = palette.length;
      palette.push([r, g, b, a]);
      paletteIndex.set(key, slot);
    }
    indices[i] = slot;
  }
  return { palette, indices };
}

// ---------------------------------------------------------------------------
// PNG chunk plumbing (CRC32 + adaptive scanline filter — same algorithm as
// pack-atlas.mjs's encodePNG, duplicated per this file's top-of-file note)
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

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Same "smallest sum of signed-magnitude bytes" adaptive filter heuristic as pack-atlas.mjs, generalized over `bpp` (1 byte/pixel for indexed, vs. 4 for RGBA). */
function chooseScanlineFilter(buf, rowStart, prevRowStart, stride, bpp) {
  let bestFilter = 0;
  let bestSum = Infinity;
  let bestBytes = null;
  const candidate = new Uint8Array(stride);
  for (let filterType = 0; filterType < 5; filterType++) {
    let sum = 0;
    for (let i = 0; i < stride; i++) {
      const x = buf[rowStart + i];
      const a = i >= bpp ? buf[rowStart + i - bpp] : 0;
      const b = prevRowStart >= 0 ? buf[prevRowStart + i] : 0;
      const c = prevRowStart >= 0 && i >= bpp ? buf[prevRowStart + i - bpp] : 0;
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

/**
 * Encodes `{ width, height, palette, indices }` (as returned by
 * `buildIndexedPalette`) into an 8-bit indexed-color (PNG color type 3) PNG
 * buffer: PLTE for RGB, tRNS for alpha (only emitted when at least one
 * palette entry is not fully opaque, and trimmed of trailing fully-opaque
 * entries per the PNG spec — a decoder treats any palette index past the end
 * of tRNS as alpha=255).
 */
export function encodeIndexedPNG({ width, height, palette, indices }) {
  if (palette.length === 0 || palette.length > 256) {
    throw new Error(`encodeIndexedPNG: palette must have 1-256 entries, got ${palette.length}`);
  }
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth (always 8 here — simplest correct choice; 1/2/4-bit packing is a further, separate optimization this tool does not attempt)
  ihdrData.writeUInt8(3, 9); // color type: indexed
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const plte = Buffer.alloc(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    plte[i * 3] = palette[i][0];
    plte[i * 3 + 1] = palette[i][1];
    plte[i * 3 + 2] = palette[i][2];
  }

  let trnsLen = 0;
  for (let i = 0; i < palette.length; i++) if (palette[i][3] !== 255) trnsLen = i + 1;
  const chunks = [pngChunk('IHDR', ihdrData), pngChunk('PLTE', plte)];
  if (trnsLen > 0) {
    const trns = Buffer.alloc(trnsLen);
    for (let i = 0; i < trnsLen; i++) trns[i] = palette[i][3];
    chunks.push(pngChunk('tRNS', trns));
  }

  const stride = width;
  const bpp = 1;
  const raw = Buffer.alloc((stride + 1) * height);
  let prevRowStart = -1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const { filterType, bytes } = chooseScanlineFilter(indices, rowStart, prevRowStart, stride, bpp);
    const destStart = y * (stride + 1);
    raw[destStart] = filterType;
    raw.set(bytes, destStart + 1);
    prevRowStart = rowStart;
  }
  const compressed = zlib.deflateSync(raw, { level: zlib.constants.Z_BEST_COMPRESSION });
  chunks.push(pngChunk('IDAT', compressed));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

/**
 * Convenience: builds the palette and encodes in one call. Returns `null`
 * (same as `buildIndexedPalette`) when `rgba` has more than `maxColors`
 * distinct colors — always a lossless re-encoding when non-null, never an
 * approximation.
 */
export function tryEncodeIndexedPNG({ width, height, rgba }, { maxColors = 256 } = {}) {
  const built = buildIndexedPalette(rgba, { maxColors });
  if (!built) return null;
  return encodeIndexedPNG({ width, height, palette: built.palette, indices: built.indices });
}

// ---------------------------------------------------------------------------
// CLI: per-frame analysis report ("node tools/quantize.mjs [--raw assets/raw]")
//
// Dynamically imports tools/pack-atlas.mjs so this file has no *static*
// import of it (pack-atlas.mjs statically imports the encode helpers above —
// a static import back here would make the two modules load each other).
// ---------------------------------------------------------------------------

async function runCli() {
  const argValue = (flag, fallback) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
  };
  const RAW_DIR = resolve(PROJECT_ROOT, argValue('--raw', 'assets/raw'));
  const packAtlasUrl = pathToFileURL(resolve(PROJECT_ROOT, 'tools/pack-atlas.mjs')).href;
  const packAtlas = await import(packAtlasUrl);
  const { decodePNG, encodePNG, preScaleForBuild, buildFrame, classifyKind, loadSpriteMeta } = packAtlas;

  const spriteMeta = loadSpriteMeta();
  const pngFiles = readdirSync(RAW_DIR)
    .filter((f) => extname(f).toLowerCase() === '.png')
    .sort();

  const rows = [];
  let sumTruecolor = 0;
  let sumIndexed = 0;
  let sumBestOfEach = 0;

  for (const file of pngFiles) {
    const name = basename(file, '.png');
    const meta = spriteMeta?.frames?.[name];
    if (meta?.skip === true) {
      rows.push({ name, verdict: `SKIP (${meta.note ?? 'sprite-meta.json skip'})` });
      continue;
    }
    const kind = meta?.kind ?? classifyKind(name);
    if (kind === null) {
      rows.push({ name, verdict: 'SKIP (unrecognized filename prefix)' });
      continue;
    }
    const rawBuf = readFileSync(resolve(RAW_DIR, file));
    let decoded;
    try {
      decoded = decodePNG(rawBuf);
    } catch (e) {
      rows.push({ name, verdict: `SKIP (decode failed: ${e.message})` });
      continue;
    }
    decoded = preScaleForBuild(name, kind, decoded);
    const frame = buildFrame(name, kind, decoded, meta);
    if (frame === null) {
      rows.push({ name, verdict: 'SKIP (fully keyed away)' });
      continue;
    }

    const { uniqueCount, alphaBinary, distinctAlphaCount } = analyzeColors(frame.rgba);
    // "Contribution to atlas bytes": each frame's own standalone PNG
    // encoding, at the SAME pixel dimensions it lands in the shared atlas
    // canvas at (post chroma-key/crop/downscale, via buildFrame — the exact
    // pixels pack-atlas.mjs blits in). This is a measured proxy, not the
    // literal marginal byte cost inside the shared sheet's single deflate
    // stream (neighbouring frames and zlib's cross-scanline back-references
    // make a truly additive number impossible to define for one shared
    // stream) — stated plainly rather than implied exact.
    const truecolorBuf = encodePNG({ width: frame.w, height: frame.h, rgba: frame.rgba });
    let indexedBuf = null;
    let verdict;
    if (uniqueCount <= 256) {
      const built = buildIndexedPalette(frame.rgba, { maxColors: 256 });
      indexedBuf = encodeIndexedPNG({ width: frame.w, height: frame.h, palette: built.palette, indices: built.indices });
      verdict = indexedBuf.length < truecolorBuf.length ? 'INDEXABLE (lossless, smaller)' : 'INDEXABLE (lossless, NOT smaller — kept truecolor)';
    } else {
      verdict = 'NOT INDEXABLE (>256 colors)';
    }

    sumTruecolor += truecolorBuf.length;
    sumIndexed += indexedBuf ? indexedBuf.length : truecolorBuf.length;
    sumBestOfEach += Math.min(truecolorBuf.length, indexedBuf ? indexedBuf.length : Infinity);

    rows.push({
      name,
      kind,
      w: frame.w,
      h: frame.h,
      uniqueCount,
      alphaBinary,
      distinctAlphaCount,
      truecolorBytes: truecolorBuf.length,
      indexedBytes: indexedBuf ? indexedBuf.length : null,
      verdict,
    });
  }

  console.log(
    'name'.padEnd(28),
    'kind'.padEnd(6),
    'size'.padEnd(10),
    'colors'.padEnd(8),
    'alpha'.padEnd(14),
    'standalone PNG (truecolor -> indexed)',
  );
  for (const r of rows) {
    if (r.verdict?.startsWith('SKIP')) {
      console.log(r.name.padEnd(28), r.verdict);
      continue;
    }
    const alphaLabel = r.alphaBinary ? `binary(${r.distinctAlphaCount})` : `partial(${r.distinctAlphaCount})`;
    const bytesLabel = r.indexedBytes !== null ? `${r.truecolorBytes} -> ${r.indexedBytes} (${(100 * (1 - r.indexedBytes / r.truecolorBytes)).toFixed(1)}%)` : `${r.truecolorBytes} (no indexed encode)`;
    console.log(
      r.name.padEnd(28),
      String(r.kind).padEnd(6),
      `${r.w}x${r.h}`.padEnd(10),
      String(r.uniqueCount).padEnd(8),
      alphaLabel.padEnd(14),
      `${bytesLabel}  [${r.verdict}]`,
    );
  }
  console.log('');
  console.log(`sum of per-frame standalone truecolor PNGs: ${sumTruecolor} bytes`);
  console.log(`sum of per-frame standalone best-of (indexed where smaller): ${sumBestOfEach} bytes (saves ${sumTruecolor - sumBestOfEach} bytes, ${(100 * (1 - sumBestOfEach / sumTruecolor)).toFixed(1)}%, PER-FRAME — NOT how the shared atlas sheet is actually encoded)`);
  console.log('this per-frame sum is a diagnostic only: the real atlas-0.png is one shared canvas encoded as ONE PNG, so indexing only applies if the WHOLE SHEET has <=256 distinct colors. See the whole-sheet check pack-atlas.mjs prints when run.');
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
