#!/usr/bin/env node
/**
 * Asserts the constructor's vehicle schematic is CENTRED in its panel, measured
 * in screen space.
 *
 * ## Why this needed its own gate, three times over
 *
 * An advisory review reported "the schematic is shifted right and clipped" in
 * three consecutive rounds. It was disbelieved in all three, twice on the
 * strength of a measurement — and the measurement was wrong both times:
 *
 *   1. The SVG ELEMENT's bounding box against its parent's. That is symmetric
 *      (-9px / -9px) and true, and it says nothing whatever about where the car
 *      sits INSIDE the viewBox. The element is sized by CSS; the drawing inside
 *      it is sized by the viewBox.
 *   2. `getBBox()` against the viewBox. `getBBox()` ignores ancestor
 *      transforms, and the car is drawn portrait then rotated a quarter turn, so
 *      that compares a 118x294 portrait bbox against a 317x154 landscape
 *      viewBox and reports 57% empty and content "overflowing" both edges.
 *
 * The measurement that settles it puts BOTH sides in one coordinate system:
 * `getBoundingClientRect()` on the drawn children (which accounts for every
 * ancestor transform) against the same call on the `<svg>` itself. That gave
 * 161px of empty space on the left against 124px of OVERFLOW on the right, with
 * top and bottom symmetric at 29px — which located the fault to the x origin
 * alone and made the fix obvious.
 *
 * So the gate is deliberately written in screen space, and it asserts BALANCE
 * (left slack equals right slack) rather than any absolute pixel value, because
 * balance is the property that was broken and the only one that survives a
 * different viewport or a different vehicle.
 *
 * usage:
 *   npx vite-node tools/verify-schematic-centring.mjs
 */
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const SEED = 'a11ce5eed5eed5eed5eed5eed5ee';

await build({ logLevel: 'warn' });
const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'warn' });
const baseUrl = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu'] });

/**
 * Measures, in screen space:
 *   - slack around EVERY drawn shape (so nothing may stick out of the panel), and
 *   - balance around the HULL specifically.
 *
 * Those are two different properties and conflating them produces a gate that
 * cannot pass. The hull is the car body, and it is centred to within a pixel of
 * the padding. The NOSE MARKER is a direction indicator drawn deliberately
 * PROUD of the hull's front edge — it protrudes about 4% — so the composite
 * bounding box of every shape is legitimately a few px right-heavy. Asserting
 * balance on the composite would be asserting that the nose marker does not
 * exist; asserting it on the hull is asserting the car is centred, which is the
 * thing that was actually broken.
 */
async function measure(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.sm-builder__preview svg') ?? document.querySelector('svg.sm-builder__preview');
    if (svg === null) return null;
    const s = svg.getBoundingClientRect();
    const box = (nodes) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of nodes) {
        const r = c.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        minX = Math.min(minX, r.left); maxX = Math.max(maxX, r.right);
        minY = Math.min(minY, r.top); maxY = Math.max(maxY, r.bottom);
      }
      return { left: Math.round(minX - s.left), right: Math.round(s.right - maxX), top: Math.round(minY - s.top), bottom: Math.round(s.bottom - maxY) };
    };
    const all = [...svg.querySelectorAll('*')];
    const hull = all.filter((c) => (c.getAttribute('class') ?? '').includes('sm-builder__preview-hull'));
    return {
      all: box(all),
      hull: hull.length > 0 ? box(hull) : null,
      panelW: Math.round(s.width),
      shapes: all.length,
    };
  });
}

let bad = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${baseUrl}?seed=${SEED}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('sm-boot') === null, { timeout: 30_000, polling: 60 });
  await page.keyboard.press('1');
  await page.waitForSelector('.sm-screen--driver');
  await page.waitForFunction(() => { const b = document.querySelector('.sm-ignition'); return b !== null && !b.disabled; });
  await page.click('.sm-ignition');
  await page.waitForSelector('.sm-screen--constructor');

  for (const [label, fit] of [
    ['pristine build', null],
    [
      'with armour + a weapon',
      async () => {
        await page.evaluate(() => {
          const inc = (l, n) => {
            const li = [...document.querySelectorAll('.sm-builder__row')].find((x) => x.querySelector('.sm-builder__row-label')?.textContent === l);
            const b = li?.querySelector('.sm-builder__row-cycle--inc');
            for (let i = 0; i < n; i++) b?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          };
          inc('Armor: Front', 3); inc('Armor: Rear', 3);
          inc('Weapon 1', 1);
        });
        await page.waitForTimeout(250);
      },
    ],
  ]) {
    if (fit !== null) await fit();
    const m = await measure(page);
    if (m === null) throw new Error('verify: no schematic found');
    // Nothing may stick out of the panel — that was the reported defect.
    const overflows = m.all.left < -1 || m.all.right < -1 || m.all.top < -1 || m.all.bottom < -1;
    // The car body must be balanced. The nose marker legitimately protrudes.
    const hullImbalance = m.hull === null ? Infinity : Math.abs(m.hull.left - m.hull.right);
    const hullBalanced = hullImbalance <= Math.max(3, m.panelW * 0.02);
    const ok = !overflows && hullBalanced;
    if (!ok) bad += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${label}: ` +
        `all-shape slack L${m.all.left} R${m.all.right} T${m.all.top} B${m.all.bottom} (overflow ${overflows}); ` +
        `hull slack L${m.hull?.left} R${m.hull?.right} (imbalance ${hullImbalance}px of ${m.panelW}px)`,
    );
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(bad === 0 ? '\nOK: the schematic is centred and fully inside its panel' : `\n${bad} state(s) FAILED`);
if (bad > 0) process.exitCode = 1;