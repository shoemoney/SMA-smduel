#!/usr/bin/env node
/**
 * Captures the loading splash itself.
 *
 * The regular `tools/shoot.mjs` harness boots straight into a screen, which
 * dismisses the splash — so it structurally CANNOT photograph the splash, and
 * the splash is exactly the thing most likely to be broken (a bar pinned at 0%,
 * a logo that never loads, a label that says nothing). This throttles the
 * network so boot is caught mid-flight, and shoots the document directly
 * instead of a screen.
 *
 * ## Why it waits on ARIA VALUES, not on a stopwatch
 *
 * The first version of this shot at fixed delays and every frame came back
 * identical: `aria-valuenow=0`, bar at 0, logo not loaded. That was not a bug
 * in the splash — under a 450kbps throttle the JS module graph itself had not
 * finished executing, so `main.ts` had not run and no progress had been
 * reported. The splash showing an honest 0% is the correct behaviour there.
 *
 * A fixed timer therefore measures the throttle, not the thing under test. This
 * version waits for the progress bar to actually reach thresholds and shoots on
 * each one, so a frame is captured because the bar said something, and the run
 * fails loudly if the bar never moves at all.
 *
 * usage: node tools/shoot-loading.mjs [--out .shots/loading]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

/** Progress percentages worth photographing, in the order they are reached. */
const THRESHOLDS = [1, 30, 45, 100];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
}

const outDir = resolve(String(arg('out', '.shots/loading')));
/** Hard ceiling on the whole run, so a bar that never moves fails instead of hanging. */
const budgetMs = Number(arg('budget', 45000));

await mkdir(outDir, { recursive: true });
await build({ logLevel: 'warn' });
const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'warn' });
const baseUrl = server.resolvedUrls?.local[0];
if (baseUrl === undefined) throw new Error('shoot-loading: no local URL');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const report = [];
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 120,
    downloadThroughput: (450 * 1024) / 8,
    uploadThroughput: (450 * 1024) / 8,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(baseUrl, { waitUntil: 'commit' });

  const readState = () =>
    page.evaluate(() => {
      const bar = document.getElementById('sm-boot-bar');
      const fill = document.getElementById('sm-boot-fill');
      const logo = document.querySelector('.sm-boot__logo');
      const raw = bar?.getAttribute('aria-valuenow');
      return {
        present: document.getElementById('sm-boot') !== null,
        pct: raw === null || raw === undefined ? null : Number(raw),
        transform: fill instanceof HTMLElement ? fill.style.transform : null,
        status: document.getElementById('sm-boot-status')?.textContent ?? null,
        brand: document.querySelector('.sm-boot__brand')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
        logoLoaded: logo instanceof HTMLImageElement ? logo.complete && logo.naturalWidth > 0 : null,
        logoNatural: logo instanceof HTMLImageElement ? logo.naturalWidth : null,
        titleUp: (document.getElementById('app')?.querySelector('.sm-screen--title') ?? null) !== null,
      };
    });

  const started = Date.now();
  let last = 0;
  for (const target of THRESHOLDS) {
    // A threshold of 100 is the bar completing, which happens a moment BEFORE
    // the splash fades out; the title screen check below covers the end state.
    const ok = await page
      .waitForFunction(
        (t) => {
          const bar = document.getElementById('sm-boot-bar');
          if (bar === null) return document.querySelector('.sm-screen--title') !== null;
          const n = Number(bar.getAttribute('aria-valuenow') ?? '0');
          return n >= t;
        },
        target,
        { timeout: Math.max(1000, budgetMs - (Date.now() - started)), polling: 60 },
      )
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      console.log(`  ! never reached ${target}% within the budget`);
      failed = true;
      break;
    }
    const state = await readState();
    state.atMs = Date.now() - started;
    state.target = target;
    state.reached = state.pct !== null && state.pct >= target;
    report.push({ ...state });
    await page.screenshot({ path: resolve(outDir, `pct-${String(target).padStart(3, '0')}.png`) });
    if (state.pct !== null) last = state.pct;
  }

  // Let the fade finish and confirm the splash actually leaves the DOM.
  await page.waitForTimeout(900);
  const end = await readState();
  end.atMs = Date.now() - started;
  end.target = 'end';
  end.reached = !end.present && end.titleUp;
  report.push(end);
  await page.screenshot({ path: resolve(outDir, 'after-dismiss.png') });
  if (!end.reached) {
    console.log(`  ! splash never left the document (present=${end.present}, titleUp=${end.titleUp})`);
    failed = true;
  }
  if (errors.length > 0) failed = true;
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(() => r()));
}

await writeFile(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const r of report) {
  console.log(
    `${String(r.target).padStart(3)}  @${String(r.atMs).padStart(6)}ms  reached=${r.reached}  pct=${r.pct}  fill="${r.transform}"  status="${r.status}"  logo=${r.logoLoaded}(${r.logoNatural}px)  present=${r.present}  title=${r.titleUp}`,
  );
}
console.log(`\n${report.length} capture(s) -> ${outDir}${failed ? '   (WITH PROBLEMS)' : '   (0 with problems)'}`);
if (failed) process.exitCode = 1;
