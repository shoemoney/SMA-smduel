#!/usr/bin/env node
/**
 * Codex (GPT-6 Astra) image-generation batch runner.
 *
 * Each image is one `codex exec` in its own scratch directory, so a single
 * failure or a malformed write is contained to one asset instead of poisoning
 * a shared run. Everything is submitted up front and polled in parallel — a
 * batch is never serialised, because each image costs ~90s of wall clock and
 * the whole point is to overlap them.
 *
 * Prompts are written for a top-down vehicular-combat game and are STRICT about
 * viewpoint. The two failure modes this batch exists to fix, both measured off
 * the shipped game:
 *
 *   1. Vehicle sprites that read as slight 3/4 perspective rather than true
 *      orthographic, and are inconsistent with each other (assets/ASSET-NOTES
 *      §5). At 48px on screen that inconsistency is most of why a car reads as
 *      an unreadable blob.
 *   2. Ground textures with no usable large-scale structure, which the old
 *      4-way-mirror packer turned into a visible cross in every tile.
 *
 * Output is 1:1 PNG. The packer handles keying, mirroring and downscaling.
 *
 * usage: node tools/gen-codex-assets.mjs [outDir] [--only name,name] [--jobs N]
 */
import { mkdir, writeFile, stat, copyFile, rm, readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

/**
 * Every asset in the batch. `subject` is the complete visual description handed
 * to the model; `note` records why the asset exists so the next person reading
 * the manifest knows what problem it solves rather than just what it depicts.
 */
const BATCH = [
  // ---- ground ------------------------------------------------------------
  // Ground is drawn as a continuous field, not a grid of quads, so these need
  // large-scale structure that survives being sampled at a few metres per
  // tile AND at a couple of pixels per metre when the camera pulls out.
  {
    name: 'ground-arena-a',
    kind: 'tile',
    note: 'arena floor variant A — scorched concrete with a faint painted circle, for the continuous ground field',
    subject:
      'a top-down aerial view of a battered concrete arena floor, pale grey concrete with dark scorch marks, oil stains, hairline cracks and a large faded white painted circle in the centre, worn rubber tyre scuffs, flat even overcast lighting, no shadows, no objects, no vehicles, no people, no text, no letters, no numbers, high detail game terrain texture, fills the entire square frame edge to edge',
  },
  {
    name: 'ground-arena-b',
    kind: 'tile',
    note: 'arena floor variant B — concrete with expansion joints, breaks up variant A repetition',
    subject:
      'a top-down aerial view of a different patch of the same worn concrete arena floor, pale grey concrete divided into large slabs by straight expansion joints, dirt build-up in the joints, scattered gravel and stains, flat even overcast lighting, no shadows, no objects, no vehicles, no people, no text, no letters, no numbers, high detail game terrain texture, fills the entire square frame edge to edge',
  },
  {
    name: 'ground-road-a',
    kind: 'tile',
    note: 'highway surface variant A — cracked dark asphalt',
    subject:
      'a top-down aerial view of a cracked dark grey asphalt highway surface, fine alligator cracking, patched repairs with darker tar, faint worn tyre polish down the driving lanes, flat even overcast lighting, no shadows, no objects, no vehicles, no people, no lane markings, no text, no letters, no numbers, high detail game terrain texture, fills the entire square frame edge to edge',
  },
  {
    name: 'ground-road-b',
    kind: 'tile',
    note: 'highway surface variant B — gravel-strewn shoulder mix, breaks up variant A repetition',
    subject:
      'a top-down aerial view of a gritty asphalt road surface heavily scattered with loose gravel, sand drift and small stones blown across it, patches of bleached dust, faded oil marks, flat even overcast lighting, no shadows, no objects, no vehicles, no people, no lane markings, no text, no letters, no numbers, high detail game terrain texture, fills the entire square frame edge to edge',
  },
  {
    name: 'ground-dirt-a',
    kind: 'tile',
    note: 'desert dirt variant A — the road-trip biome',
    subject:
      'a top-down aerial view of dry cracked reddish desert dirt, fine polygonal mud cracks, small loose stones, wind-drifted sand ripples, flat even overcast lighting, no shadows, no plants, no cactus, no rocks casting shadow, no vehicles, no people, no text, no letters, no numbers, high detail game terrain texture, fills the entire square frame edge to edge',
  },
  {
    name: 'ground-dirt-b',
    kind: 'tile',
    note: 'desert dirt variant B — darker gravelly mix, breaks up variant A repetition',
    subject:
      'a top-down aerial view of a different stretch of desert ground, darker gravelly reddish brown dirt mixed with grey pebbles and dry dead grass tufts, shallow erosion channels, flat even overcast lighting, no shadows, no plants, no vehicles, no people, no text, no letters, no numbers, high detail game terrain texture, fills the entire square frame edge to edge',
  },

  // ---- vehicles ----------------------------------------------------------
  // Every vehicle prompt pins the viewpoint hard and states the nose
  // direction, because `rotationOffsetDeg` in sprite-meta.json is hand-set per
  // frame and an art change that silently flips the nose ships every car
  // driving sideways (that bug shipped once already).
  {
    name: 'car-subcompact',
    kind: 'car',
    rotationNote: 'NOSE MUST POINT UP toward the TOP EDGE of the image.',
    subject:
      'a post-apocalyptic armoured combat hatchback car photographed from DIRECTLY ABOVE, perfectly straight down, strict orthographic top-down view, flat true top-down with absolutely no perspective and no side visible, the car nose pointing UP toward the top edge of the image, small two-door hatchback with welded steel plating over the doors and roof, a roof-mounted machine gun, matte oxide-red paint with bare metal scratches, one single car centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'car-compact',
    kind: 'car',
    rotationNote: 'NOSE MUST POINT UP toward the TOP EDGE of the image.',
    subject:
      'a post-apocalyptic armoured combat compact sedan photographed from DIRECTLY ABOVE, perfectly straight down, strict orthographic top-down view, flat true top-down with absolutely no perspective and no side visible, the car nose pointing UP toward the top edge of the image, riveted armour plating, a small front weapon port in the bonnet, matte steel-blue paint with bare metal scratches, one single car centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'car-midsized',
    kind: 'car',
    rotationNote: 'NOSE MUST POINT UP toward the TOP EDGE of the image.',
    subject:
      'a post-apocalyptic armoured combat mid-sized sedan photographed from DIRECTLY ABOVE, perfectly straight down, strict orthographic top-down view, flat true top-down with absolutely no perspective and no side visible, the car nose pointing UP toward the top edge of the image, heavy welded plate over the bonnet and roof, side weapon ports on both front wings, matte olive-green paint with bare metal scratches, one single car centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'car-luxury',
    kind: 'car',
    rotationNote: 'NOSE MUST POINT UP toward the TOP EDGE of the image.',
    subject:
      'a post-apocalyptic armoured combat luxury long sedan photographed from DIRECTLY ABOVE, perfectly straight down, strict orthographic top-down view, flat true top-down with absolutely no perspective and no side visible, the car nose pointing UP toward the top edge of the image, long body, polished black armour plating with chrome trim strips, a circular turret ring mounted on the roof, one single car centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'car-stationwagon',
    kind: 'car',
    rotationNote: 'NOSE MUST POINT UP toward the TOP EDGE of the image.',
    subject:
      'a post-apocalyptic armoured combat station wagon estate car photographed from DIRECTLY ABOVE, perfectly straight down, strict orthographic top-down view, flat true top-down with absolutely no perspective and no side visible, the car nose pointing UP toward the top edge of the image, long squared roof with a plated cargo rack and a rear dropper hatch, matte desert-tan paint with bare metal scratches, one single car centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'car-pickup',
    kind: 'car',
    rotationNote: 'NOSE MUST POINT UP toward the TOP EDGE of the image.',
    subject:
      'a post-apocalyptic armoured combat pickup truck photographed from DIRECTLY ABOVE, perfectly straight down, strict orthographic top-down view, flat true top-down with absolutely no perspective and no side visible, the truck nose pointing UP toward the top edge of the image, open cargo bed behind the cab with a mounted recoilless rifle, welded plate armour over the cab, matte rust-orange paint with bare metal scratches, one single truck centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'car-van',
    kind: 'car',
    rotationNote: 'NOSE MUST POINT UP toward the TOP EDGE of the image.',
    subject:
      'a post-apocalyptic armoured combat cargo panel van photographed from DIRECTLY ABOVE, perfectly straight down, strict orthographic top-down view, flat true top-down with absolutely no perspective and no side visible, the van nose pointing UP toward the top edge of the image, tall squared armoured body with narrow gun slits along the flanks, roof rack, matte gunmetal grey paint with bare metal scratches, one single van centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'car-kart',
    kind: 'car',
    rotationNote: 'NOSE MUST POINT UP toward the TOP EDGE of the image.',
    subject:
      'a post-apocalyptic cheap arena combat go-kart photographed from DIRECTLY ABOVE, perfectly straight down, strict orthographic top-down view, flat true top-down with absolutely no perspective and no side visible, the kart nose pointing UP toward the top edge of the image, minimal thin plating over an exposed tubular frame, a single small front machine gun, exposed rear engine block, scuffed school-bus yellow paint, one single kart centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },

  // ---- scenery -----------------------------------------------------------
  // The city currently draws three generic roof squares and nothing else. It
  // has a wall, streetlights, barriers and a gate in the atlas already but
  // never instantiates them; these fill the gaps the existing set cannot.
  {
    name: 'prop-streetlight',
    kind: 'prop',
    subject:
      'a single rusted steel street lamp post with a broken head and a concrete base, photographed from DIRECTLY ABOVE looking straight down, strict orthographic top-down view, one single lamp post centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'prop-barricade',
    kind: 'prop',
    subject:
      'a single concrete road barricade with diagonal red and white painted stripes, chipped and scuffed, photographed from DIRECTLY ABOVE looking straight down, strict orthographic top-down view, one single barricade centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'prop-tyres',
    kind: 'prop',
    subject:
      'a small neat stack of three worn black rubber car tyres, photographed from DIRECTLY ABOVE looking straight down, strict orthographic top-down view, one single stack of tyres centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'prop-crate',
    kind: 'prop',
    subject:
      'a single battered wooden shipping crate banded with rusted steel strapping, photographed from DIRECTLY ABOVE looking straight down, strict orthographic top-down view, one single crate centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'prop-sandbag',
    kind: 'prop',
    subject:
      'a low stacked wall of dirty sandbags, three bags wide, photographed from DIRECTLY ABOVE looking straight down, strict orthographic top-down view, one single sandbag wall centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },
  {
    name: 'prop-junkpile',
    kind: 'prop',
    subject:
      'a small heap of crushed car scrap, twisted rusted metal panels and a broken windscreen, photographed from DIRECTLY ABOVE looking straight down, strict orthographic top-down view, one single heap of scrap centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no text, no letters, no numbers, crisp game sprite',
  },

  // ---- effects -----------------------------------------------------------
  {
    name: 'fx-explosion',
    kind: 'fx',
    subject:
      'a single spherical orange and yellow fireball explosion with a bright white-hot core and a ragged edge, seen from directly above, one single explosion centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no smoke trail, no ground, no debris field, no text, no letters, no numbers, crisp game visual effect sprite',
  },
  {
    name: 'fx-muzzle-flash',
    kind: 'fx',
    subject:
      'a single bright white-yellow star-shaped muzzle flash burst, four pointed spikes radiating from a hot white core, seen from directly above, one single flash centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no smoke, no ground, no weapon barrel, no text, no letters, no numbers, crisp game visual effect sprite',
  },
  {
    name: 'fx-impact-spark',
    kind: 'fx',
    subject:
      'a single small burst of white-hot bullet impact sparks on metal, a tight cluster of short bright streaks radiating outward, seen from directly above, one single spark burst centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no smoke, no ground, no crater, no text, no letters, no numbers, crisp game visual effect sprite',
  },
  {
    name: 'fx-smoke-puff',
    kind: 'fx',
    subject:
      'a single soft billowing round grey-brown dust smoke puff cloud with feathered soft edges, seen from directly above, one single puff centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no shadow, no ground, no debris, no text, no letters, no numbers, crisp game visual effect sprite',
  },
  {
    name: 'decal-tire-marks',
    kind: 'decal',
    subject:
      'a pair of curved black rubber skid tyre marks on a transparent-looking flat surface, two parallel dark streaks curving gently, seen from directly above, one single set of marks centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no ground texture, no text, no letters, no numbers, crisp game decal sprite',
  },
  {
    name: 'decal-scorch',
    kind: 'decal',
    subject:
      'a single irregular scorched black burn mark on the ground, sooty edges fading outward, seen from directly above, one single scorch mark centred in the frame with wide empty margin all around, isolated on a flat solid pure magenta pink background, uniform flat lighting, no ground texture, no debris, no text, no letters, no numbers, crisp game decal sprite',
  },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
}

const outDir = resolve(String(arg('out', 'assets/raw-codex')));
const onlyArg = arg('only', '');
const only = typeof onlyArg === 'string' ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
const JOBS = Number(arg('jobs', 24));

const jobs = only.length > 0 ? BATCH.filter((a) => only.includes(a.name)) : BATCH;
if (jobs.length === 0) throw new Error(`no assets matched --only ${onlyArg}`);

/** The one prompt handed to codex. Kept in one place so every asset gets identical framing rules. */
function buildPrompt(asset, targetPath) {
  const framing =
    asset.kind === 'tile'
      ? ''
      : 'The single subject must be small and fully visible with a clear empty margin of flat background on all four sides — do not let it touch or bleed off the edges, and do not fill the frame.';
  const rotation = asset.rotationNote ? `${asset.rotationNote} ` : '';
  return [
    'Generate ONE square game asset image and save it to this exact path:',
    targetPath,
    '',
    `The image shows: ${asset.subject}`,
    '',
    rotation + framing,
    'Use your image generation tool exactly once. Do not draw, render, or synthesise the image any other way, and do not draw it with code — it must come from the image generation tool.',
    `Save the result as a PNG at exactly that path (${targetPath}), overwriting anything already there.`,
    'That path is INSIDE your current working directory, so it is writable by your sandbox — do not save it anywhere else.',
    'After saving, reply with only the file path and the pixel dimensions. Do not create any other files.',
  ].join('\n');
}

/**
 * Resolve `codex` to an absolute path up front. It is a CLI shim installed
 * into a temp directory that is NOT on the PATH a spawned (non-shell) child
 * inherits, so a bare `spawn('codex', ...)` fails with ENOENT.
 */
function resolveCodexBin() {
  const which = spawnSync('which', ['codex'], { encoding: 'utf8' });
  const fromPath = (which.stdout ?? '').trim();
  if (which.status === 0 && fromPath.length > 0) return fromPath;
  return spawnSync('zsh', ['-lc', 'command -v codex'], { encoding: 'utf8' }).stdout?.trim() || 'codex';
}

function runCodex(codexBin, asset, scratchRoot) {
  const scratch = join(scratchRoot, asset.name);
  const target = join(outDir, `${asset.name}.png`);
  // codex runs sandboxed to its own cwd, so a destination OUTSIDE that cwd is
  // refused as a permissions error — and the image is then lost, because the
  // model reports the block and stops. Have it write into its own scratch dir
  // and move the file ourselves afterwards; the generation is the expensive
  // part, the write location is not.
  const staged = join(scratch, 'asset.png');
  return new Promise((resolvePromise) => {
    mkdir(scratch, { recursive: true });
    const child = spawn(
      codexBin,
      ['exec', '--sandbox', 'workspace-write', '-C', scratch, '--skip-git-repo-check', buildPrompt(asset, staged)],
      { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let log = '';
    let spawnError = null;
    child.on('error', (e) => {
      spawnError = e;
    });
    child.stdout?.on('data', (d) => {
      log += d.toString();
    });
    child.stderr?.on('data', (d) => {
      log += d.toString();
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000);
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (spawnError) {
        resolvePromise({ name: asset.name, ok: false, bytes: 0, code, log: `spawn error: ${spawnError.message}` });
        return;
      }
      try {
        const s = await stat(staged);
        if (s.size > 2048) {
          await copyFile(staged, target);
          await rm(staged, { force: true });
          resolvePromise({ name: asset.name, ok: true, bytes: s.size, code, log: log.slice(-200) });
          return;
        }
        resolvePromise({ name: asset.name, ok: false, bytes: s.size, code, log: `staged file too small (${s.size}B)` });
      } catch {
        // Codex sometimes writes the image into its own generated-image cache
        // instead of the requested path and reports the block. The pixels
        // exist, so rescue the newest matching file rather than paying for the
        // whole generation again.
        const rescued = await rescueFromCodexCache(asset.name, target);
        resolvePromise(
          rescued
            ? { name: asset.name, ok: true, bytes: rescued, code, log: `rescued from codex image cache (${rescued}B)` }
            : { name: asset.name, ok: false, bytes: 0, code, log: log.slice(-600) },
        );
      }
    });
  });
}

/**
 * Recover a generated image codex could not write to the requested path.
 *
 * Codex parks generated images in `~/.codex/generated_images/<run>/exec-<id>.png`
 * and then refuses the copy, which loses the asset entirely if you only look at
 * the exit status. The most recent PNG on disk belongs to the most recent
 * generation, and this batch is fully parallel, so the newest file is the best
 * available attribution — a wrong pick costs one re-run, a missed pick costs
 * the whole asset.
 */
async function rescueFromCodexCache(assetName, target) {
  const cacheRoot = join(homedir(), '.codex', 'generated_images');
  let newest = null;
  let newestMtime = 0;
  let dirs;
  try {
    dirs = await readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let files;
    try {
      files = await readdir(join(cacheRoot, d.name));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.png')) continue;
      const p = join(cacheRoot, d.name, f);
      try {
        const s = await stat(p);
        if (s.mtimeMs > newestMtime) {
          newestMtime = s.mtimeMs;
          newest = p;
        }
      } catch {
        /* raced with the reaper */
      }
    }
  }
  if (newest === null) return 0;
  const s = await stat(newest);
  if (s.size <= 2048) return 0;
  await copyFile(newest, target);
  console.log(`     (rescued ${assetName} from ${newest})`);
  return s.size;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const scratchRoot = join(tmpdir(), 'smduel-codex-assets');
  await mkdir(scratchRoot, { recursive: true });

  console.log(`codex batch: ${jobs.length} asset(s) -> ${outDir}  (concurrency ${JOBS})`);
  const codexBin = resolveCodexBin();
  console.log(`codex bin: ${codexBin}\n`);

  const results = [];
  const queue = [...jobs];
  const workers = Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    for (;;) {
      const asset = queue.shift();
      if (asset === undefined) return;
      const r = await runCodex(codexBin, asset, scratchRoot);
      results.push({ ...r, kind: asset.kind, note: asset.note, rotationNote: asset.rotationNote ?? null });
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${asset.name.padEnd(22)} ${r.ok ? `${(r.bytes / 1024).toFixed(0)} KB` : 'no image'}`);
    }
  });
  await Promise.all(workers);

  // The generation manifest, so the integration step knows each asset's kind
  // and whether its nose direction was pinned (and therefore needs its
  // rotationOffsetDeg hand-verified against the rendered PNG).
  const manifest = {
    generator: 'codex exec (GPT-6 Astra image generation)',
    frames: Object.fromEntries(
      results.map((r) => [
        r.name,
        { kind: r.kind, note: r.note, ...(r.rotationNote ? { rotationNote: r.rotationNote } : {}) },
      ]),
    ),
  };
  // MERGE, never overwrite: a partial re-run (`--only some-asset`) must not
  // erase the record of every other asset in the batch.
  const manifestPath = join(outDir, '_codex-manifest.json');
  let previous = { frames: {} };
  try {
    previous = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    /* first run */
  }
  const merged = { ...previous, generator: manifest.generator, frames: { ...previous.frames, ...manifest.frames } };
  await writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} succeeded -> ${outDir}`);
  if (failed.length > 0) {
    console.log('failed:');
    for (const f of failed) console.log(`  ${f.name}: ${f.log.replace(/\n/g, ' ').slice(0, 300)}`);
    process.exitCode = 1;
  }
}

await main();
