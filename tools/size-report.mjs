#!/usr/bin/env node
// Per-frame atlas size report: which packed frames are actually paying for
// assets/atlas-0.png's bytes, and how that compares to what the frame is
// worth on screen. Answers "what is genuinely oversized" with measurements,
// not the flat-128px config's implicit assumption that every kind needs the
// same ceiling.
//
// Reuses tools/pack-atlas.mjs's own decode -> preScale -> buildFrame pipeline
// verbatim (same imports, same call sequence as its main()) so every number
// here describes exactly what the packer would actually produce from the
// CURRENT tools/atlas-sizes.json and assets/raw/*.png + assets/sprite-meta.json
// — not a re-derivation that could drift from the real packer.
//
// Usage: node tools/size-report.mjs [--raw assets/raw] [--sizes tools/atlas-sizes.json] [--json]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFrame,
  classifyKind,
  decodePNG,
  encodePNG,
  loadSizeConfig,
  loadSpriteMeta,
  preScaleForBuild,
} from './pack-atlas.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const RAW_DIR = resolve(PROJECT_ROOT, argValue('--raw', 'assets/raw'));
const SIZES_PATH = resolve(PROJECT_ROOT, argValue('--sizes', 'tools/atlas-sizes.json'));
const ASSETS_DIR = resolve(PROJECT_ROOT, 'assets');
const AS_JSON = process.argv.includes('--json');

// ---------------------------------------------------------------------------
// PNG container overhead: PNG_SIGNATURE(8) + IHDR chunk(8+13+4=25) +
// IDAT chunk header/crc(8+4=12) + IEND chunk(8+0+4=12) = 57 fixed bytes that
// never depend on pixel content. encodePNG() always emits exactly one IDAT,
// so `encodePNG(frame).length - 57` is precisely that frame's compressed
// IDAT payload — i.e. what its own pixels cost to deflate, with the fixed
// per-file container stripped out. See tools/pack-atlas.mjs's encodePNG.
const PNG_CONTAINER_OVERHEAD_BYTES = 57;

/**
 * Estimates a frame's byte contribution to the shared atlas sheet by
 * compressing ITS PIXELS ALONE with the exact same encoder (adaptive
 * per-scanline filter choice, Z_BEST_COMPRESSION) pack-atlas.mjs uses for
 * the real sheet, then subtracting the fixed PNG container bytes.
 *
 * This is an ESTIMATE, not a byte-exact decomposition of the real
 * atlas-0.png: the real sheet is one deflate stream over the WHOLE 4096x4096
 * canvas, so (a) large shared transparent runs between frames compress
 * extremely cheaply and are NOT charged to any frame here, and (b) zlib's
 * LZ77 window can backreference across frame boundaries in the real sheet in
 * ways an isolated frame can never do. In practice this makes the isolated
 * estimate a slight OVER-count of opaque/detailed frames' true marginal
 * cost and doesn't move the ranking — see the calibration line this script
 * prints (sum of estimates vs. the real committed file size).
 */
function estimateFrameBytes(frame) {
  const encoded = encodePNG({ width: frame.w, height: frame.h, rgba: frame.rgba });
  return encoded.length - PNG_CONTAINER_OVERHEAD_BYTES;
}

// ---------------------------------------------------------------------------
// Display size assumptions — what a frame is actually worth on screen.
//
// Sourced from (measured, not guessed):
//   - src/app.ts: PIXELS_PER_METER_CSS = 14, FLOOR_TILE_SIZE_M = 10
//   - assets/ASSET-NOTES.md section 5: "Acceptable at 48px game scale"
//     (vehicle sprites)
//   - the workflow task's own stated design intent: "vehicles render roughly
//     48-96px, props and decals similar ... ui-hud-frame / ui-title-art are
//     full-screen art deliberately kept native"
//   - grep of src/**/*.ts: only 'tile-concrete-arena' and 'car-<bodyId>' are
//     looked up by frame NAME anywhere in the live renderer (src/app.ts);
//     framesOfKind() exists on AtlasIndex but has no call site outside
//     tests/unit/atlas.test.ts. wreck/cycle/prop/fx/decal and the two small
//     'ui' gauge frames (ui-radar-bezel, ui-speedo-dial — the HUD radar face
//     in src/ui/hud.ts is plain CSS/DOM, not an atlas draw) are packed but
//     currently UNWIRED. That's a real, separate finding (flagged per-frame
//     below as `wiredInSrc: false`) but this script does not use it to zero
//     out their display size — Phase 4 is explicitly about to wire more
//     content, so "unused today" and "genuinely oversized" are kept as two
//     different columns rather than conflated into one verdict.
//
// DISPLAY_MAX_PX is the longest-edge pixel size a frame is worth shipping at:
// the largest size the game would ever actually draw it, so anything packed
// above this is pure waste regardless of zoom/DPI headroom.
const VEHICLE_PROP_DISPLAY_MAX_PX = 96; // task-stated upper bound for car/wreck/cycle/prop/decal
const FX_DISPLAY_MAX_PX = 96; // ASSUMED equal to the vehicle/prop bucket — fx has no sim/render wiring yet (grep: no explosion/blast radius constant anywhere in src/), so there is no measured number to use instead. Flagged explicitly below.
const UI_GAUGE_DISPLAY_MAX_PX = 128; // ASSUMED: typical corner HUD dial/bezel size; ui-radar-bezel/ui-speedo-dial have zero draw call today (see wiredInSrc above), so their true future size is unknown.

/** Longest-edge display px this script assumes for `kind`/`name`, or `null` when the kind isn't judged by the simple "packed vs. display" ratio (tile, and the two keepNative UI full-screen frames). */
function displayMaxPxFor(kind, name, sizeConfig) {
  if (kind === 'tile') return null; // judged separately below — seam quality, not a waste ratio
  if (kind === 'ui') {
    if (sizeConfig.ui.keepNative.includes(name)) return null; // intentionally native full-screen art
    return UI_GAUGE_DISPLAY_MAX_PX;
  }
  if (kind === 'fx') return FX_DISPLAY_MAX_PX;
  return VEHICLE_PROP_DISPLAY_MAX_PX; // car, wreck, cycle, prop, decal
}

// Frame names actually looked up by name in the live renderer (src/app.ts),
// via grep — see the comment above. Kept as a literal list, not derived at
// runtime, since this script must not touch src/**.
const WIRED_FRAME_PREFIXES = ['tile-concrete-arena', 'car-'];
function isWiredInSrc(name) {
  return WIRED_FRAME_PREFIXES.some((p) => (p.endsWith('-') ? name.startsWith(p) : name === p));
}

// ---------------------------------------------------------------------------
// Reproduce pack-atlas.mjs's main() decode/build loop exactly, without
// writing any files.
// ---------------------------------------------------------------------------

function buildAllFrames(sizeConfig) {
  if (!existsSync(RAW_DIR)) {
    throw new Error(`${RAW_DIR} does not exist — run this from a checkout with assets/raw/ present`);
  }
  const pngFiles = readdirSync(RAW_DIR).filter((f) => extname(f).toLowerCase() === '.png');
  const spriteMeta = loadSpriteMeta();
  const skipped = [];
  const frames = [];

  for (const file of pngFiles) {
    const name = basename(file, '.png');
    const meta = spriteMeta?.frames?.[name];

    if (meta?.skip === true) {
      skipped.push({ name, reason: meta.note ? `skipped: ${meta.note}` : 'marked skip in sprite-meta.json' });
      continue;
    }

    const kind = meta?.kind ?? classifyKind(name);
    if (kind === null) {
      skipped.push({ name, reason: 'unrecognized filename prefix' });
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
    frames.push(frame);
  }

  return { frames, skipped };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function formatBytes(n) {
  return `${n.toLocaleString('en-US')} B (${(n / 1024).toFixed(1)} KiB)`;
}

function main() {
  const sizeConfig = loadSizeConfig(SIZES_PATH);
  const { frames, skipped } = buildAllFrames(sizeConfig);

  const rows = frames.map((f) => {
    const packedArea = f.w * f.h;
    const estBytes = estimateFrameBytes(f);
    const displayMaxPx = displayMaxPxFor(f.kind, f.name, sizeConfig);
    const packedLongEdge = Math.max(f.w, f.h);
    let edgeRatio = null;
    let displayArea = null;
    let wastedBytes = 0;
    if (displayMaxPx !== null) {
      edgeRatio = packedLongEdge / displayMaxPx;
      displayArea = displayMaxPx * displayMaxPx * (packedArea / (packedLongEdge * packedLongEdge)); // scale packed aspect ratio down to the display cap
      if (packedArea > displayArea) {
        wastedBytes = Math.round(estBytes * (1 - displayArea / packedArea));
      }
    }
    return {
      name: f.name,
      kind: f.kind,
      packedW: f.w,
      packedH: f.h,
      packedArea,
      estBytes,
      displayMaxPx,
      edgeRatio,
      wastedBytes,
      wiredInSrc: isWiredInSrc(f.name),
    };
  });

  const totalEstBytes = rows.reduce((s, r) => s + r.estBytes, 0);
  const totalWastedBytes = rows.reduce((s, r) => s + r.wastedBytes, 0);

  const atlasPath = resolve(ASSETS_DIR, 'atlas-0.png');
  const realAtlasBytes = existsSync(atlasPath) ? statSync(atlasPath).size : null;

  const byKind = {};
  for (const r of rows) {
    (byKind[r.kind] ??= { count: 0, packedArea: 0, estBytes: 0, wastedBytes: 0 });
    byKind[r.kind].count++;
    byKind[r.kind].packedArea += r.packedArea;
    byKind[r.kind].estBytes += r.estBytes;
    byKind[r.kind].wastedBytes += r.wastedBytes;
  }

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        { rows, byKind, totalEstBytes, totalWastedBytes, realAtlasBytes, skipped },
        null,
        2,
      ),
    );
    return;
  }

  const ranked = [...rows].sort((a, b) => b.wastedBytes - a.wastedBytes);

  console.log('=== size-report: per-frame packed vs. display, ranked by wasted bytes ===\n');
  console.log(
    'name'.padEnd(24),
    'kind'.padEnd(7),
    'packedPx'.padEnd(11),
    'area'.padEnd(9),
    'estBytes'.padEnd(11),
    'dispPx'.padEnd(7),
    'edgeRatio'.padEnd(10),
    'wastedBytes'.padEnd(12),
    'wired',
  );
  for (const r of ranked) {
    console.log(
      r.name.padEnd(24),
      r.kind.padEnd(7),
      `${r.packedW}x${r.packedH}`.padEnd(11),
      String(r.packedArea).padEnd(9),
      String(r.estBytes).padEnd(11),
      String(r.displayMaxPx ?? '-').padEnd(7),
      (r.edgeRatio !== null ? r.edgeRatio.toFixed(2) + 'x' : '-').padEnd(10),
      String(r.wastedBytes).padEnd(12),
      r.wiredInSrc ? 'yes' : 'no',
    );
  }

  console.log('\n=== per-kind rollup ===\n');
  console.log('kind'.padEnd(7), 'count'.padEnd(7), 'packedArea'.padEnd(12), 'estBytes'.padEnd(14), 'wastedBytes'.padEnd(12), '% of sheet est.');
  for (const [kind, agg] of Object.entries(byKind).sort((a, b) => b[1].estBytes - a[1].estBytes)) {
    console.log(
      kind.padEnd(7),
      String(agg.count).padEnd(7),
      String(agg.packedArea).padEnd(12),
      String(agg.estBytes).padEnd(14),
      String(agg.wastedBytes).padEnd(12),
      `${((agg.estBytes / totalEstBytes) * 100).toFixed(1)}%`,
    );
  }

  console.log(`\nsum of per-frame isolated-compression estimates: ${formatBytes(totalEstBytes)}`);
  if (realAtlasBytes !== null) {
    console.log(`real committed assets/atlas-0.png:               ${formatBytes(realAtlasBytes)}`);
    console.log(
      `calibration (estimate / real):                    ${((totalEstBytes / realAtlasBytes) * 100).toFixed(1)}% — isolated per-frame compression overstates the real shared-stream sheet (expected; see estimateFrameBytes doc comment)`,
    );
  }
  console.log(`estimated recoverable bytes if every frame were capped at its assumed display size: ${formatBytes(totalWastedBytes)}`);
  if (skipped.length > 0) {
    console.log(`\n(${skipped.length} raw file(s) skipped, same as pack-atlas.mjs: ${skipped.map((s) => s.name).join(', ')})`);
  }
}

main();
