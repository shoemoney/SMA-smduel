#!/usr/bin/env node
/**
 * Integrates codex-generated assets (`assets/raw-codex/`) into the game's
 * sprite pipeline: copies the PNGs into `assets/raw/`, writes the
 * `assets/sprite-meta.json` entries the packer requires, and repacks.
 *
 * Why a script and not a hand edit: `sprite-meta.json` is load-bearing in three
 * non-obvious ways, and getting any of them wrong ships a broken game behind a
 * green build rather than an error.
 *
 *  1. `keyed` must be an explicit boolean or the packer THROWS. Omit the entry
 *     entirely and it silently falls back to "key everything except tile",
 *     which is right for a sprite on magenta and wrong for full-bleed art.
 *  2. `keyColor` is sampled per image, never `#FF00FF`. Codex renders a
 *     different flat background in every image; the packer widens tolerance
 *     from `keyColorDeviation`, and both are measured from the actual corners.
 *  3. `rotationOffsetDeg` is hand-authored per frame. It is never computed —
 *     there is no CV anywhere in this pipeline. A vehicle sprite whose nose
 *     points the wrong way renders sideways, which shipped once already.
 *
 * This script measures (1) and (2) from the real pixels and refuses to invent
 * (3): for vehicles it emits a loud warning naming the frame, because only a
 * human looking at the art can set that value.
 *
 * usage: node tools/integrate-codex-assets.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const CODEX_DIR = resolve(ROOT, 'assets/raw-codex');
const RAW_DIR = resolve(ROOT, 'assets/raw');
const META_PATH = resolve(ROOT, 'assets/sprite-meta.json');
const ATLAS_JSON = resolve(ROOT, 'assets/atlas.json');

const dryRun = process.argv.includes('--dry-run');

/** Only kinds that get chroma-keyed. `tile` is full-bleed and must be keyed:false. */
const KEYED_KINDS = new Set(['car', 'prop', 'fx', 'decal', 'wreck', 'cycle', 'building']);

// ---------------------------------------------------------------------------
// Minimal PNG reader — enough to sample corner pixels and count unique colours.
// The packer has a full decoder, but it is not exported, and pulling a
// dependency in for four numbers would be a worse trade than 60 lines here.
// ---------------------------------------------------------------------------
import { inflateSync } from 'node:zlib';

function decodePngHeader(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('not a PNG');
  }
  let offset = 8;
  let ihdr = null;
  const idat = [];
  let palette = null;
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      ihdr = {
        width: dataStart + 0 <= buffer.length ? buffer.readUInt32BE(dataStart) : 0,
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        interlace: buffer[dataStart + 12],
      };
    } else if (type === 'PLTE') {
      palette = buffer.subarray(dataStart, dataStart + len);
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(dataStart, dataStart + len));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + len + 4;
  }
  if (ihdr === null) throw new Error('PNG has no IHDR');
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG not supported');
  return { ...ihdr, idat: Buffer.concat(idat), palette };
}

/** Un-filter one PNG scanline set into straight RGB rows. Handles colour types 2 (RGB) and 6 (RGBA). */
function unfilter(raw, { width, height, channels }) {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      switch (filter) {
        case 0: cur[x] = v; break;
        case 1: cur[x] = (v + a) & 0xff; break;
        case 2: cur[x] = (v + b) & 0xff; break;
        case 3: cur[x] = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          cur[x] = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
    }
  }
  return { pixels: out, channels, width };
}

/** Median RGB of the four 24x24 corner patches — the same sampling the packer falls back to. */
function sampleCornerKeyColor(file) {
  const buf = readFileSync(file);
  const meta = decodePngHeader(buf);
  const channels = meta.colorType === 6 ? 4 : meta.colorType === 2 ? 3 : meta.colorType === 0 ? 1 : 0;
  if (channels === 0) return null;
  const { pixels, width, height } = unfilter(inflateSync(meta.idat), { width: meta.width, height: meta.height, channels });
  const patch = 24;
  const rs = [], gs = [], bs = [];
  for (const [ox, oy] of [[0, 0], [width - patch, 0], [0, height - patch], [width - patch, height - patch]]) {
    for (let y = oy; y < oy + patch; y++) {
      for (let x = ox; x < ox + patch; x++) {
        const i = (y * width + x) * channels;
        rs.push(pixels[i]); gs.push(pixels[i + 1]); bs.push(pixels[i + 2]);
      }
    }
  }
  const med = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
  return `#${[med(rs), med(gs), med(bs)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Corner hue spread, in degrees — how far the four corners are from each other. */
function cornerKeyDeviation(file) {
  const buf = readFileSync(file);
  const meta = decodePngHeader(buf);
  const channels = meta.colorType === 6 ? 4 : meta.colorType === 2 ? 3 : 0;
  if (channels === 0) return 0;
  const { pixels, width, height } = unfilter(inflateSync(meta.idat), { width: meta.width, height: meta.height, channels });
  const patch = 24;
  const hues = [];
  for (const [ox, oy] of [[0, 0], [width - patch, 0], [0, height - patch], [width - patch, height - patch]]) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = oy; y < oy + patch; y++) {
      for (let x = ox; x < ox + patch; x++) {
        const i = (y * width + x) * channels;
        r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
      }
    }
    const [h, s, v] = rgbToHsv(r / n, g / n, b / n);
    if (s > 0.2 && v > 0.15) hues.push(h);
  }
  if (hues.length === 0) return 0;
  const mean = hues.reduce((a, b) => a + b, 0) / hues.length;
  const maxDelta = hues.reduce((m, h) => Math.max(m, Math.abs(h - mean)), 0);
  return Math.min(180, Math.round(maxDelta));
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

// ---------------------------------------------------------------------------

const atlas = JSON.parse(readFileSync(ATLAS_JSON, 'utf8'));
const meta = JSON.parse(readFileSync(META_PATH, 'utf8'));
const codexManifest = JSON.parse(readFileSync(join(CODEX_DIR, '_codex-manifest.json'), 'utf8'));

const atlasFrames = new Set(Object.keys(atlas.frames));
const report = { added: [], replaced: [], skipped: [], needsRotationReview: [] };

for (const [name, info] of Object.entries(codexManifest.frames)) {
  const src = join(CODEX_DIR, `${name}.png`);
  if (!existsSync(src)) { report.skipped.push({ name, reason: 'no generated png' }); continue; }

  const kind = info.kind;
  const keyed = KEYED_KINDS.has(kind);
  const existing = meta.frames[name];

  // An existing frame keeps its hand-set rotationOffsetDeg; a new one has none
  // yet, which for a vehicle means it will render sideways until a human sets
  // it. Both cases are reported rather than guessed.
  const entry = {
    kind,
    keyed,
    keyColor: keyed ? sampleCornerKeyColor(src) : null,
    keyColorDeviation: keyed ? cornerKeyDeviation(src) : null,
    view: 'orthographic',
    note: `codex (GPT-6 Astra) generated${existing ? ' — replacing previous art' : ''}. ${info.note ?? ''}`.trim(),
  };
  if (existing?.rotationOffsetDeg !== undefined) {
    entry.rotationOffsetDeg = existing.rotationOffsetDeg;
  } else {
    entry.rotationOffsetDeg = 0;
    if (kind === 'car' || kind === 'cycle') report.needsRotationReview.push(name);
  }

  meta.frames[name] = entry;
  if (atlasFrames.has(name)) report.replaced.push(name); else report.added.push(name);
  if (!dryRun) copyFileSync(src, join(RAW_DIR, `${name}.png`));
}

if (!dryRun) {
  writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
  console.log('integrate: sprite-meta.json updated');
  console.log('integrate: repacking atlas...');
  execFileSync('node', [resolve(ROOT, 'tools/pack-atlas.mjs')], { stdio: 'inherit', cwd: ROOT });
}

console.log(`\nintegrate: ${report.added.length} new, ${report.replaced.length} replaced, ${report.skipped.length} skipped`);
if (report.needsRotationReview.length > 0) {
  console.log('\n!! ROTATION NEEDS A HUMAN EYE — these are vehicles with no prior hand-set offset,');
  console.log('   so they are currently at 0 and will render sideways until verified:');
  for (const n of report.needsRotationReview) console.log(`   - ${n}  (open assets/raw/${n}.png, find the nose, set rotationOffsetDeg in assets/sprite-meta.json)`);
  console.log('   Convention: nose art at top of frame => 270, bottom => 90, left => 180, right => 0.');
}
