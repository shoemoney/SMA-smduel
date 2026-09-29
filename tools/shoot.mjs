#!/usr/bin/env node
/**
 * Visual capture harness.
 *
 * A visual overhaul cannot be reviewed without repeatable screenshots of the
 * SAME screen twice — once before the change and once after. Reaching the arena
 * or the road otherwise means walking a procedurally-placed avatar into a
 * door in a seeded city, which is a fragile thing to ask a script to do twice
 * and get the same framing back. This drives the real game in real Chrome with
 * a real WebGPU adapter, using the app's own `?screen=` boot jump, so every
 * capture is a real screen and not a mock.
 *
 * usage:
 *   node tools/shoot.mjs --out .shots/before
 *   node tools/shoot.mjs --out .shots/after --only arena,city
 *   node tools/shoot.mjs --out .shots/x --headed
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

/** Fixed seed so the city layout, spawn positions and props are identical on every run. */
const SEED = 'a11ce5eed5eed5eed5eed5eed5eed5ee';

const SCREENS = [
  'title',
  'controls',
  'driver',
  'constructor',
  'city',
  'arena',
  'road',
  'fleet',
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
}

const outDir = resolve(String(arg('out', '.shots/latest')));
const only = String(arg('only', ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const headed = arg('headed', false) !== false;
const width = Number(arg('width', 1440));
const height = Number(arg('height', 900));

/**
 * How long to let a screen settle before capturing. The arena and road screens
 * boot an async WebGPU renderer that only starts its rAF loop after the atlas
 * PNG and the WGSL have both been fetched, so a fixed sleep would capture a
 * black canvas on a cold cache. Wait for real painted frames instead.
 */
async function waitForRenderedFrames(page, frames) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let seen = 0;
        const tick = () => {
          seen += 1;
          if (seen >= n) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

/**
 * Measures how much actually got painted, from the PNG Playwright wrote.
 *
 * This exists because the failure mode that hurt was INVISIBLE to every other
 * check in this harness: an invalid WGSL shader or a mismatched bind group
 * renders a pure-black canvas, throws no console error, and still produces a
 * perfectly valid 1440x900 PNG. Console-error counting said "ok" and I read a
 * black screenshot. A harness that cannot fail is worse than no harness, so
 * the check is deliberately blunt: decode the pixels, then compare luminance
 * spread and how much of the frame differs from the darkest region. A real
 * rendered game frame has hundreds of distinct tones; a black or single-colour
 * frame has one.
 *
 * Decodes only what Playwright's screenshot actually emits: 8-bit, non-
 * interlaced, and colour type 2 (RGB) or 6 (RGBA).
 */
function analysePng(buffer) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < SIG.length; i++) {
    if (buffer[i] !== SIG[i]) throw new Error('not a png');
  }
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (off < buffer.length) {
    const len = buffer.readUInt32BE(off);
    const type = buffer.toString('ascii', off + 4, off + 8);
    const data = buffer.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (depth !== 8) throw new Error(`unsupported png bit depth ${depth}`);
      if (interlace !== 0) throw new Error('interlaced png unsupported');
      if (colorType === 2) channels = 3;
      else if (colorType === 6) channels = 4;
      else throw new Error(`unsupported png colour type ${colorType}`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (width === 0 || height === 0 || channels === 0) throw new Error('png missing IHDR');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : out.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`bad png filter ${filter}`);
      }
      cur[x] = v & 0xff;
    }
  }

  // Sample on a stride so a 1440x900 frame costs ~13k reads, not 1.3M.
  const lums = [];
  const stepX = Math.max(1, Math.floor(width / 180));
  const stepY = Math.max(1, Math.floor(height / 120));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = y * stride + x * channels;
      lums.push(0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]);
    }
  }
  lums.sort((a, b) => a - b);
  const at = (q) => lums[Math.min(lums.length - 1, Math.floor(q * lums.length))];
  const mean = lums.reduce((s, v) => s + v, 0) / lums.length;
  // Spread between the 5th and 95th percentile: a rendered frame spans a wide
  // range, a blank one is a single value and returns ~0.
  const spread = at(0.95) - at(0.05);
  const dark = lums.filter((v) => v < 8).length / lums.length;
  return {
    meanLuma: Number(mean.toFixed(2)),
    p05: Number(at(0.05).toFixed(2)),
    p95: Number(at(0.95).toFixed(2)),
    spread: Number(spread.toFixed(2)),
    darkFraction: Number(dark.toFixed(4)),
    samples: lums.length,
  };
}

async function main() {
  const targets = only.length > 0 ? only : SCREENS;
  const unknown = targets.filter((t) => !SCREENS.includes(t));
  if (unknown.length > 0) throw new Error(`unknown screen(s): ${unknown.join(', ')} (known: ${SCREENS.join(', ')})`);

  await mkdir(outDir, { recursive: true });

  await build({ logLevel: 'warn' });
  const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'warn' });
  const baseUrl = server.resolvedUrls?.local[0];
  if (baseUrl === undefined) throw new Error('shoot: vite preview did not resolve a local URL');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !headed,
    // WebGPU on macOS needs a real adapter; the bare headless profile already
    // gets Apple/Metal (measured), these are belt-and-braces for older builds.
    args: ['--enable-unsafe-webgpu', '--hide-scrollbars'],
  });

  const report = [];
  try {
    for (const name of targets) {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
      // WebGPU validation failures surface on the GPUDevice's
      // `uncapturederror` event, NOT as a console error. Without this, an
      // invalid pipeline — a shader that failed to compile, a bind group that
      // does not match its layout — renders a completely black screen while
      // the harness reports "ok". That gap hid a total render failure for a
      // full iteration.
      //
      // The hook has to wrap the real request chain, because nothing about the
      // device is reachable until the page asks for it. The earlier version of
      // this file registered an `unhandledrejection` listener and read
      // `page.__gpuErrors` — a Playwright Page has no such property, so the
      // array it reported was always empty. That is what made a black frame
      // look clean.
      await page.addInitScript(() => {
        window.__gpuErrors = [];
        const gpu = navigator.gpu;
        if (!gpu) return;
        const realRequestAdapter = gpu.requestAdapter.bind(gpu);
        gpu.requestAdapter = async (...args) => {
          const adapter = await realRequestAdapter(...args);
          if (!adapter) {
            window.__gpuErrors.push('requestAdapter returned null (no adapter)');
            return adapter;
          }
          const realRequestDevice = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = async (...devArgs) => {
            const device = await realRequestDevice(...devArgs);
            device.addEventListener('uncapturederror', (event) => {
              const err = event.error;
              window.__gpuErrors.push(`${err?.constructor?.name ?? 'GPUError'}: ${err?.message ?? String(err)}`);
            });
            device.lost.then((info) => {
              if (info.reason !== 'destroyed') {
                window.__gpuErrors.push(`device.lost: ${info.reason} — ${info.message}`);
              }
            });
            window.__gpuErrors.__hooked = true;
            return device;
          };
          return adapter;
        };
      });

      const url = `${baseUrl}?screen=${name}&seed=${SEED}`;
      let status = 'ok';
      try {
        await page.goto(url, { waitUntil: 'load' });
        await waitForRenderedFrames(page, 45);
      } catch (err) {
        status = `FAILED: ${String(err).slice(0, 200)}`;
      }

      const file = resolve(outDir, `${name}.png`);
      let pixels = null;
      try {
        await page.screenshot({ path: file });
        pixels = analysePng(await readFile(file));
      } catch (err) {
        status = `${status} screenshot-failed: ${String(err).slice(0, 120)}`;
      }

      const gpuErrors = await page.evaluate(() => (window.__gpuErrors ?? []).slice());
      // A canvas that rendered nothing but reported no error is the failure
      // mode this harness exists to catch: flag it explicitly. Spreading near
      // zero means one flat colour, and a near-black frame means the scene
      // never drew. Both are failures, not "ok".
      let blank = null;
      if (pixels) {
        blank = pixels.spread < 6 || pixels.meanLuma < 4;
        if (blank) {
          status = `${status === 'ok' ? '' : `${status} `}BLANK-FRAME`;
        }
      }
      const painted = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c ? { w: c.width, h: c.height } : null;
      });
      report.push({
        screen: name,
        status,
        errors: consoleErrors.slice(0, 5),
        gpuErrors,
        canvas: painted,
        pixels,
      });
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.httpServer.close(() => r()));
  }

  await writeFile(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

  let bad = 0;
  for (const r of report) {
    const problems = r.status !== 'ok' || r.errors.length > 0 || (r.gpuErrors?.length ?? 0) > 0;
    if (problems) bad += 1;
    console.log(`${problems ? '!' : ' '} ${r.screen.padEnd(12)} ${r.status}${r.pixels ? `  luma ${r.pixels.meanLuma} spread ${r.pixels.spread} dark ${r.pixels.darkFraction}` : ''}`);
    for (const e of r.errors) console.log(`     ! ${e.slice(0, 180)}`);
    for (const e of r.gpuErrors ?? []) console.log(`     ! gpu: ${String(e).slice(0, 300)}`);
  }
  console.log(`\n${report.length} screen(s) -> ${outDir}   (${bad} with problems)`);
  if (bad > 0) process.exitCode = 1;
}

await main();
