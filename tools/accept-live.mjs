#!/usr/bin/env node
/**
 * Live acceptance check: drives the DEPLOYED build in real Chrome and asserts
 * the product promises that documentation and unit tests cannot reach.
 *
 * ## Why this is not the same as the test suite
 *
 * `npm test` proves the code does what it claims. This proves the thing a player
 * actually receives does — the bundle the server is serving, not the checkout.
 * That distinction has bitten this repo before: a release shipped with every gate
 * green while the live hash pointed at the previous build, and a deploy was
 * reported as done because a route returned 200.
 *
 * ## The two probe bugs it taught me, both left in the code on purpose
 *
 * 1. The focus-ring check read `document.querySelector('.sm-field')`. The driver
 *    card has FOUR of those (three skill rows plus the name), so it read a skill
 *    field's resting border and reported the focus ring as broken. It now finds
 *    the field that owns `document.activeElement`.
 * 2. It then read that border in the same tick the card autofocuses, and the
 *    140ms `border-color` transition meant `getComputedStyle` returned the
 *    transition's START value. It now settles first, and accepts the accent at
 *    any alpha — a strict `rgb()` equality would be a race, not a check.
 *
 * Both were the probe being wrong, not the product. Neither is a "flaky test" —
 * each was a confidently wrong measurement, which is worse.
 *
 * usage:
 *   node tools/accept-live.mjs                                  # production
 *   node tools/accept-live.mjs --url http://localhost:5173/smduel/
 */
import { chromium } from 'playwright-core';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};
const URL = `${arg('url', 'https://arcade.shoemoney.com/smduel/').replace(/\/$/, '')}/`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu'] });
const results = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // --- Ask 1: the tribute card, on production.
  await page.addInitScript(() => {
    window.__t = [];
    const t0 = performance.now();
    const go = () => {
      const b = document.getElementById('sm-boot');
      if (b === null) { requestAnimationFrame(go); return; }
      const card = b.querySelector('.sm-boot__tribute');
      const bar = b.querySelector('.sm-boot__bar');
      const push = (w) => window.__t.push({ at: Math.round(performance.now() - t0), w,
        card: card && getComputedStyle(card).opacity, bar: bar && getComputedStyle(bar).visibility });
      push('first-paint');
      new MutationObserver(() => push('class')).observe(b, { attributes: true, attributeFilter: ['class'] });
      setInterval(() => push('poll'), 300);
    };
    go();
  });
  await page.goto(URL, { waitUntil: 'commit' });
  await page.waitForSelector('.sm-boot__tribute', { timeout: 15000 });
  await page.waitForTimeout(1400);
  const tribute = await page.evaluate(() => {
    const b = getComputedStyle(document.getElementById('sm-boot'));
    const bold = [...document.querySelectorAll('.sm-boot__tribute-line strong, .sm-boot__tribute-title')];
    const plain = [...document.querySelectorAll('.sm-boot__tribute-line')].filter((n) => !n.querySelector('strong'));
    return {
      bg: b.backgroundColor,
      bold: [...new Set(bold.map((n) => getComputedStyle(n).color))],
      plain: [...new Set(plain.map((n) => getComputedStyle(n).color))],
      face: getComputedStyle(document.querySelector('.sm-boot__tribute-title')).fontFamily.split(',')[0].replace(/"/g, ''),
      lines: document.querySelectorAll('.sm-boot__tribute-line').length,
      text: (document.querySelector('.sm-boot__tribute')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  });
  await page.screenshot({ path: '.shots/live-1-tribute.png' });
  await page.waitForFunction(() => document.getElementById('sm-boot') === null, { timeout: 30000, polling: 60 });
  const tl = await page.evaluate(() => window.__t);
  results.push(['1 tribute: pure black', tribute.bg === 'rgb(0, 0, 0)']);
  results.push(['1 tribute: all bold is #ffd23f', tribute.bold.length === 1 && tribute.bold[0] === 'rgb(255, 210, 63)']);
  results.push(['1 tribute: body is white', tribute.plain.length === 1 && tribute.plain[0] === 'rgb(242, 246, 250)']);
  results.push(['1 tribute: display face', /Narrow|Condensed/.test(tribute.face)]);
  results.push(['1 tribute: all four lines present', tribute.lines === 3 && /Autoduel \(1985\)/.test(tribute.text) && /Origin Systems/.test(tribute.text) && /Chuckles and Lord British/.test(tribute.text) && /Thank you for the memories/.test(tribute.text) && /Inspired by a Childhood Classic/.test(tribute.text)]);
  const held = tl.some((e) => e.card === '1' && e.bar === 'hidden');
  const handoverAt = tl.find((e) => e.w === 'class' && e.bar === 'visible')?.at ?? 0;
  results.push([`1 tribute: held alone then handed over at ${handoverAt}ms`, held && handoverAt >= 2400]);

  // --- Ask 2 & 3: the first screen's input and the ignition switch.
  await page.keyboard.press('1');
  await page.waitForSelector('.sm-screen--driver', { timeout: 15000 });
  const drv = await page.evaluate(() => {
    const name = document.querySelector('.sm-screen--driver input[type="text"]');
    const ign = document.querySelector('.sm-ignition');
    const icon = document.querySelector('.sm-screen--driver .sm-field__icon');
    const cs = name ? getComputedStyle(name) : null;
    return {
      nameHasIcon: icon !== null,
      nameFont: cs?.fontFamily ?? '',
      nameBorder: cs?.borderColor ?? '',
      ignition: ign !== null,
      ignitionLabel: document.querySelector('.sm-ignition__label')?.textContent ?? '',
      keyGlyph: document.querySelector('.sm-ignition__key') !== null,
      carGlyph: document.querySelector('.sm-ignition__car') !== null,
      skillRows: document.querySelectorAll('.sm-skill-row').length,
      skillIcons: document.querySelectorAll('.sm-skill-row__icon').length,
    };
  });
  await page.screenshot({ path: '.shots/live-2-driver.png' });
  results.push(['3 inputs: driver name is icon-led', drv.nameHasIcon]);
  results.push(['3 inputs: display face in the field', /Narrow|Condensed/.test(drv.nameFont)]);
  results.push(['2 ignition: switch present with a key', drv.ignition && drv.keyGlyph]);
  results.push(['2 ignition: labelled as a start control', drv.ignitionLabel.length > 0]);
  results.push(['3 inputs: 3 skill rows, all icon-led', drv.skillRows === 3 && drv.skillIcons === 3]);
  // Focus treatment, on the real page. The read is taken AFTER the 140ms
  // border-color transition: the card autofocuses the name field the instant it
  // mounts, and reading in that same tick returns the transition's START value
  // (the resting `--ui-line`) — which reads exactly like "the focus ring is
  // broken". Measured with a real click it is `rgba(101, 204, 191, 0.694)`, the
  // accent, part-way through the transition.
  await page.focus('.sm-screen--driver input[type="text"]');
  await page.waitForTimeout(320);
  const focused = await page.evaluate(() => {
    // Find the field that ACTUALLY contains the focused input. The driver card
    // has four `.sm-field` wrappers (three skill rows plus the name), so
    // `querySelector('.sm-field')` reads the first SKILL field's resting border
    // and reports the focus ring as missing. The first version of this check did
    // exactly that and the failure was in the probe, not the product.
    const active = document.activeElement;
    const f = active && active.closest ? active.closest('.sm-field') : null;
    return { colour: f ? getComputedStyle(f).borderColor : '', count: document.querySelectorAll('.sm-field').length };
  });
  console.log(`  (focus probe: ${focused.count} .field elements on the card, read the one owning document.activeElement)`);
  // Accept the accent at any alpha: the value is read mid-transition, so a
  // strict rgb() equality would be a race, not a check.
  const focusIsAccent = /rgba?\((\d+), (\d+), (\d+)/.test(focused.colour) &&
    Number(RegExp.$1) > 60 && Number(RegExp.$2) > 150 && Number(RegExp.$3) > 150;
  results.push([`3 inputs: focus ring on the wrapper (${focused.colour})`, focusIsAccent]);
  // The crank, on the real page.
  await page.click('.sm-ignition');
  await page.waitForTimeout(200);
  const crank = await page.evaluate(() => {
    const b = document.querySelector('.sm-ignition');
    const car = document.querySelector('.sm-ignition__car');
    return { cranking: b?.classList.contains('sm-ignition--cranking') ?? false, disabled: b?.disabled ?? false,
             carOpacity: car ? getComputedStyle(car).opacity : '0', key: document.querySelector('.sm-ignition__key') ? getComputedStyle(document.querySelector('.sm-ignition__key')).transform : 'none' };
  });
  results.push(['2 ignition: locks while cranking', crank.cranking && crank.disabled]);
  results.push(['2 ignition: key turned', crank.key !== 'none']);
  results.push(['2 ignition: the car runs', Number(crank.carOpacity) > 0.5]);
  await page.waitForSelector('.sm-screen--constructor', { timeout: 15000 });

  // --- Ask 4: the car-improvement screen.
  for (const target of ['Armor: Front', 'Armor: Rear', 'Armor: Left']) {
    for (let n = 0; n < 4; n++) {
      await page.evaluate((label) => {
        const li = [...document.querySelectorAll('.sm-builder__row')].find((x) => x.querySelector('.sm-builder__row-label')?.textContent === label);
        li?.querySelector('.sm-builder__row-cycle--inc')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }, target);
      await page.waitForTimeout(30);
    }
  }
  await page.waitForTimeout(300);
  const ctor = await page.evaluate(() => ({
    sections: [...document.querySelectorAll('.sm-builder__section')].map((s) => s.textContent?.trim() ?? ''),
    armourRows: document.querySelectorAll('.sm-builder__row--armor').length,
    armourGlyphs: [...document.querySelectorAll('.sm-builder__row--armor')].map((li) => li.querySelectorAll('svg').length),
    rotated: [...document.querySelectorAll('.sm-builder__row--armor .sm-icon--dir')].map((s) => getComputedStyle(s).transform),
    statRows: document.querySelectorAll('.sm-builder__stat').length,
    statGlyphs: [...document.querySelectorAll('.sm-builder__stat')].filter((r) => r.querySelector('svg')).length,
    previewZones: document.querySelectorAll('.sm-builder__preview-armor').length,
  }));
  await page.screenshot({ path: '.shots/live-3-builder.png' });
  results.push(['4 constructor: 5 sections', ctor.sections.length === 5]);
  // UNDERBODY is ONE glyph by design: it has no lateral direction, so a chevron
  // there would assert a direction that does not exist. The first version of this
  // check demanded 2 from every row and failed on the row that was correct.
  const expectedGlyphs = [2, 2, 2, 2, 1];
  results.push([`4 constructor: armour glyphs ${JSON.stringify(ctor.armourGlyphs)} = 2/2/2/2/1`,
    ctor.armourRows === 5 && JSON.stringify(ctor.armourGlyphs) === JSON.stringify(expectedGlyphs)]);
  results.push(['4 constructor: 4 facings carry a rotation', ctor.rotated.length === 4 && new Set(ctor.rotated).size === 4]);
  results.push(['4 constructor: every stat icon-led', ctor.statRows >= 8 && ctor.statGlyphs === ctor.statRows]);
  results.push(['4 constructor: armour drawn on the schematic', ctor.previewZones >= 3]);
} finally { await browser.close(); }
let bad = 0;
for (const [name, ok] of results) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) bad++; }
console.log(`\n${results.length - bad}/${results.length} live acceptance checks passed`);
if (bad) process.exitCode = 1;
