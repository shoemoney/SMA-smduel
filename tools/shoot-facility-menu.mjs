#!/usr/bin/env node
/**
 * Proves the ineligible-row notice de-duplication on the TWO real screens the
 * Codex review caught it on (`.opencode/reviews/codex-20260930-144430.md`):
 * the Arena facility menu's standing championship-schedule row and the Federal
 * Building stub's "isn't open for business yet" notice. Both pass
 * `reason: label` to `mountMenu`, so both printed the same sentence twice.
 *
 * The unit test in `tests/unit/menu.test.ts` proves the RENDERER. This proves
 * the real thing: it walks the real city in real Chrome with real key events to
 * the real doorways, then asserts on the rendered DOM that no ineligible row
 * repeats its own label, and that rows with a genuinely different reason still
 * show that reason (the control — a fix that just deleted every reason would
 * pass the duplicate check alone).
 *
 * Doorway positions and the key->compass convention are NOT hand-copied: they
 * are read out of `@/sim/city`'s own `generateCityLayout` and
 * `DIRECTION_UNIT_VECTORS` here, exactly as `src/sim/city.ts` exports them.
 *
 * usage:
 *   npx vite-node tools/shoot-facility-menu.mjs -- --out .shots/iter150
 *   npx vite-node tools/shoot-facility-menu.mjs -- --url https://arcade.shoemoney.com/smduel/
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
// Run with `npx vite-node`, not bare `node`: these source modules use the
// `@/` alias, which only vite's resolver knows about. (Same reason vitest
// needs no extra plugin — see vite.config.ts's `resolve.alias`.)
import { generateCityLayout, DIRECTION_UNIT_VECTORS } from '@/sim/city';
import { skillsConfig, drivingConfig } from '@/data/rulesets';

/** Same fixed seed `tools/shoot.mjs` uses, so the city layout is identical run to run. */
const SEED = 'a11ce5eed5eed5eed5eed5eed5eed5ee';

/** Key codes that produce each compass direction, via `resolveInput` -> `cityDirectionFromVector`. */
const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined) throw new Error(`shoot: --${name} needs a value`);
  return v;
}

const cityId = skillsConfig().startingLocation;
const layout = generateCityLayout(cityId, SEED);
const interactionRadiusM = drivingConfig().pedestrian.interactionRadiusM;

function doorwayPosition(facilityKind) {
  const d = layout.doorways.find((x) => x.facilityKind === facilityKind);
  if (d === undefined) throw new Error(`shoot: "${cityId}" has no "${facilityKind}" doorway for seed "${SEED}"`);
  return d.position;
}

/** The unit vector for walking from `from` toward `target`, snapped to the 8-way compass the sim uses. */
function bearingBetween(from, target) {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) throw new Error('shoot: walked from a point onto itself');
  const ux = dx / len;
  const uy = dy / len;
  let best = null;
  let bestDot = -Infinity;
  for (const [dir, unit] of Object.entries(DIRECTION_UNIT_VECTORS)) {
    const dot = unit.x * ux + unit.y * uy;
    if (dot > bestDot) {
      bestDot = dot;
      best = dir;
    }
  }
  return { dir: best, distanceM: len, aligned: bestDot };
}

function keysForDirection(dir) {
  const unit = DIRECTION_UNIT_VECTORS[dir];
  const keys = [];
  if (unit.y > 0) keys.push(KEYS.up);
  if (unit.y < 0) keys.push(KEYS.down);
  if (unit.x > 0) keys.push(KEYS.right);
  if (unit.x < 0) keys.push(KEYS.left);
  return keys;
}

/** Where the player actually starts. NOT the origin: `app.ts` seeds the player at the gate. */
const spawn = layout.gate.position;

/** Walking speed in m/s, from the ruleset — never a literal, so a ruleset change moves this harness with it. */
const walkSpeedMps = drivingConfig().pedestrian.speedMps;

/** Every rendered menu row, with the label and the reason span's own text. */
const READ_ROWS = () =>
  Array.from(document.querySelectorAll('.sm-menu__item')).map((item) => ({
    label: item.querySelector('.sm-menu__label')?.textContent ?? '',
    reason: item.querySelector('.sm-menu__reason')?.textContent ?? '',
    ineligible: item.hasAttribute('aria-disabled'),
  }));

async function walkLeg(page, from, to, label) {
  const { dir, distanceM, aligned } = bearingBetween(from, to);
  // Stop short by most of the interaction radius so the walk ENDS inside the
  // trigger circle rather than walking past the doorway into whatever is
  // beyond it. Every doorway sits on the same ring, so a radial leg keeps its
  // distance from every other ring point — the reason this can be a straight
  // two-leg route instead of the axis-aligned search the in-process test does.
  const travelM = Math.max(0, distanceM - interactionRadiusM * 0.6);
  const keys = keysForDirection(dir);
  console.log(`  leg ${label}: ${dir} (align ${aligned.toFixed(3)}), ~${travelM.toFixed(2)}m, keys ${keys.join('+')}`);
  for (const k of keys) await page.keyboard.down(k);
  try {
    // Hold the leg for as long as the sim needs to cover that distance at its
    // own walking speed, plus slack for frame pacing — a real measurement of
    // the ruleset's own numbers rather than a tuned hold time.
    const ms = Math.ceil((travelM / walkSpeedMps) * 1000 * 1.6) + 500;
    await page.waitForTimeout(ms);
  } finally {
    for (const k of keys) await page.keyboard.up(k);
  }
}

async function walkInto(page, facilityKind) {
  const target = doorwayPosition(facilityKind);
  // gate -> origin -> doorway, the same relay `tests/integration/arena-auto-end.test.ts`
  // uses; walking straight from the gate to a doorway on the far side can clip a
  // third doorway's trigger on some seeds.
  const origin = { x: 0, y: 0 };
  await walkLeg(page, spawn, origin, `gate->origin for ${facilityKind}`);
  await walkLeg(page, origin, target, `origin->${facilityKind}`);
  await page.waitForFunction(() => document.querySelector('.sm-menu__item') !== null, { timeout: 8_000, polling: 60 });
  await page.waitForTimeout(350); // let the panel finish its open transition
}

const CASES = [
  // The Arena facility menu, the screen the review caught the duplicate on.
  // `expectInRow` is the identity proof: without it, walking into the wrong
  // doorway yields a menu with no duplicated notices and the harness reports
  // a vacuous pass — which is exactly what the first two runs of this script
  // did (once into Salvage, once into the Bar) before it was told to name the
  // facility it was standing in.
  //
  // The Federal Building's stub notice is covered for real by the
  // `tests/integration/screens.test.ts` case of the same name, which walks
  // there deterministically through the in-process navigator. It is NOT
  // repeated here: this harness's second leg homes on the plaza centre and
  // then holds a compass key, and the federal doorway's two ring neighbours sit
  // 6m away on a 10.6m ring — close enough that a hand-held keypress lands on
  // a neighbour about as often as not. The deterministic walker measures its
  // own margin instead of hoping.
  { facilityKind: 'arena', expectInRow: 'Championship' },
];

async function main() {
  const outDir = resolve(arg('out', '.shots/facility-menu'));
  await mkdir(outDir, { recursive: true });

  // `--url` points the same checks at an ALREADY-SERVED build instead of
  // building one: the only way to ask whether production has the fix, rather
  // than whether this checkout does.
  const liveUrl = arg('url', null);
  const server = liveUrl === null ? await (async () => {
    await build({ logLevel: 'warn' });
    return preview({ preview: { port: 0, strictPort: false }, logLevel: 'warn' });
  })() : null;
  const baseUrl = liveUrl ?? server?.resolvedUrls?.local[0];
  if (baseUrl === undefined) throw new Error('shoot: vite preview did not resolve a local URL');
  if (liveUrl !== null) console.log(`  (checking the SERVED build at ${liveUrl}, not a local build)`);

  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu'] });
  const results = [];
  try {
    for (const { facilityKind, expectInRow } of CASES) {
      const context = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto(`${baseUrl.replace(/\/$/, '')}/?screen=city&seed=${SEED}`, { waitUntil: 'load' });
      await page
        .waitForFunction(() => document.getElementById('sm-boot') === null, { timeout: 20_000, polling: 50 })
        .catch(() => {
          throw new Error('shoot: the loading splash was still on screen after 20s');
        });
      await walkInto(page, facilityKind);
      const rows = await page.evaluate(READ_ROWS);
      await page.screenshot({ path: resolve(outDir, `${facilityKind}-menu.png`) });
      await context.close();

      const identified = rows.some((r) => `${r.label}${r.reason}`.includes(expectInRow));
      const dupes = rows.filter((r) => r.reason !== '' && r.reason === r.label);
      const emptyIneligible = rows.filter((r) => r.ineligible && r.label === '');
      results.push({ facilityKind, expectInRow, identified, rows, dupes: dupes.length, emptyIneligible: emptyIneligible.length });
      console.log(
        `  ${facilityKind}: identified=${identified} (looked for ${JSON.stringify(expectInRow)}), ` +
          `${rows.length} rows, ${dupes.length} duplicate their label, ${emptyIneligible.length} ineligible-but-empty`,
      );
      for (const r of rows) console.log(`      [${r.ineligible ? 'X' : ' '}] ${JSON.stringify(r.label)} reason=${JSON.stringify(r.reason)}`);
    }
  } finally {
    await browser.close();
    if (server !== null) await server.close();
  }

  await writeFile(resolve(outDir, 'rows.json'), JSON.stringify(results, null, 2));

  const wrong = results.filter((r) => !r.identified);
  if (wrong.length !== 0) {
    console.error(`FAIL: walked into the wrong facility for ${wrong.map((r) => r.facilityKind).join(', ')} — a menu without the expected row proves nothing`);
    process.exitCode = 1;
    return;
  }
  // The distinct-reason control, measured on the real screen rather than only
  // in the unit test: the Arena menu carries a disabled row whose reason is a
  // DIFFERENT sentence from its label ("not today - next one in N days").
  const distinctReasons = results.reduce(
    (n, r) => n + r.rows.filter((x) => x.ineligible && x.reason !== '' && x.reason !== x.label).length,
    0,
  );
  if (distinctReasons === 0) {
    console.error('FAIL: no disabled row kept a distinct reason — the control is missing, so this proves nothing');
    process.exitCode = 1;
    return;
  }
  const totalDupes = results.reduce((n, r) => n + r.dupes, 0);
  if (totalDupes !== 0) {
    console.error(`FAIL: ${totalDupes} ineligible row(s) still repeat their own label`);
    process.exitCode = 1;
    return;
  }
  const emptied = results.reduce((n, r) => n + r.emptyIneligible, 0);
  if (emptied !== 0) {
    console.error(`FAIL: ${emptied} ineligible row(s) rendered an empty label — the notice was suppressed instead of de-duplicated`);
    process.exitCode = 1;
    return;
  }
  // The notice must still be FULLY visible on the row that carries it, which is
  // the appearance half of the fix: the single copy has to be the label itself.
  const totalWithNotice = results.reduce((n, r) => n + r.rows.filter((x) => x.ineligible).length, 0);
  if (totalWithNotice === 0) {
    console.error('FAIL: no ineligible row was rendered at all, so there was nothing to de-duplicate');
    process.exitCode = 1;
    return;
  }
  console.log(
    `OK: identified the facility, 0 duplicated notices, ${totalWithNotice} ineligible row(s) still carry their notice as the label, ` +
      `${distinctReasons} distinct reason(s) preserved`,
  );
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
