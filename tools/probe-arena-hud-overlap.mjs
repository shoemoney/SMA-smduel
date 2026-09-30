#!/usr/bin/env node
/**
 * Measures the arena HUD's top strip for OVERLAPPING elements, in a real
 * browser, from live `getBoundingClientRect()` values.
 *
 * WHY A SCRIPT AND NOT A SCREENSHOT. A Codex review (iteration 151) reported
 * that the arena's message panel overlaps the "Esc — pause" hint, quoting
 * y-ranges. Screenshots cannot settle that question on their own: a downscaled
 * frame merges two elements into one smudge, and the log has three separate
 * entries about vision models reporting a present element as "missing" because
 * the still was the wrong instrument. This reads the geometry instead.
 *
 * It reports EVERY pair of visible, absolutely-positioned elements in the
 * arena's overlay that overlap, and it does that at the moment the match-entry
 * message is on screen (the tallest state the status line takes) as well as
 * after combat messages. A fix that only moves the hint is not enough if the
 * status line can still grow into it.
 *
 * usage:
 *   npx vite-node tools/probe-arena-hud-overlap.mjs -- --url https://arcade.shoemoney.com/smduel/
 */
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
const SEED = 'a11ce5eed5eed5eed5eed5eed5ee';

import { walkIntoFacility, walkThroughGateToRoad } from './lib/walk-city.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined) throw new Error(`probe: --${name} needs a value`);
  return v;
}

/**
 * Runs IN THE PAGE and returns plain data only.
 *
 * Two things forced this shape. First, `page.evaluate` cannot return DOM nodes
 * — the first version of this probe handed back the element list for a
 * containment check on the Node side and hung until the harness timed out.
 * Second, the first version compared an element against its own descendants and
 * reported 82 "overlaps", nearly all of them a HUD panel against the text
 * inside that same panel, which is a tautology. Two SIBLING overlays colliding
 * is the thing worth failing a build over, so containment is resolved here,
 * where the nodes still exist.
 */
const READ_OVERLAY = (selector) => {
  const screen = document.querySelector(selector);
  if (screen === null) return { error: `no ${selector} mounted` };
  const boxes = [...screen.querySelectorAll('*')]
    .map((node) => ({ node, style: getComputedStyle(node), r: node.getBoundingClientRect() }))
    .filter(({ style, r }) => style.position === 'absolute' && style.display !== 'none' && style.visibility !== 'hidden')
    .filter(({ r }) => r.width > 0 && r.height > 0 && r.bottom < 200)
    .map(({ node, r }) => ({
      node,
      tag: node.tagName.toLowerCase(),
      cls: typeof node.className === 'string' ? node.className : '',
      text: (node.textContent ?? '').trim().slice(0, 60),
      fullText: (node.textContent ?? '').trim(),
      top: +r.top.toFixed(1),
      bottom: +r.bottom.toFixed(1),
      left: +r.left.toFixed(1),
      right: +r.right.toFixed(1),
    }));

  const pairs = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.node.contains(b.node) || b.node.contains(a.node)) continue;
      // Same reasoning, one level up: two elements inside ONE widget are that
      // widget. The road's progress track, its fill and its car marker are a
      // single component whose fill is SUPPOSED to sit under the car — the
      // first version of this probe called that a 4px "overlap" between two
      // empty divs, which is a true reading of the boxes and a false reading of
      // the screen. Only a collision between INDEPENDENT components is a defect.
      let anc = a.node.parentElement;
      while (anc !== null && anc !== screen && !anc.contains(b.node)) anc = anc.parentElement;
      if (anc !== null && anc !== screen) continue;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x <= 0 || y <= 0) continue;
      pairs.push({ a, b, xPx: +x.toFixed(1), yPx: +y.toFixed(1) });
    }
  }
  return {
    elements: boxes.map(({ node: _n, ...rest }) => rest),
    pairs: pairs.map(({ a, b, xPx, yPx }) => ({ a, b, xPx, yPx })),
    // The FULL text of every top-strip element, untruncated, so the caller can
    // assert the pause hint is still VISIBLE somewhere.
    texts: boxes.map(({ fullText }) => fullText),
  };
};

function reportOverlaps(label, result) {
  const { elements, pairs } = result;
  console.log(`\n  [${label}] ${elements.length} sibling overlay(s) in the top strip, ${pairs.length} overlapping pair(s)`);
  for (const e of elements) {
    console.log(`      y ${String(e.top).padStart(6)}\u2013${String(e.bottom).padStart(6)}  <${e.tag}> ${e.cls || '(no class)'} ${JSON.stringify(e.text)}`);
  }
  for (const p of pairs) {
    console.log(`      OVERLAP ${p.yPx}px tall x ${p.xPx}px wide: ${JSON.stringify(p.a.text)} <-> ${JSON.stringify(p.b.text)}`);
  }
  return pairs;
}

async function main() {
  const liveUrl = arg('url', null);
  const server =
    liveUrl === null
      ? await (async () => {
          await build({ logLevel: 'warn' });
          return preview({ preview: { port: 0, strictPort: false }, logLevel: 'warn' });
        })()
      : null;
  const baseUrl = liveUrl ?? server?.resolvedUrls?.local[0];
  if (baseUrl === undefined) throw new Error('probe: no base url');

  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu'] });
  try {
    await run(browser, baseUrl);
  } finally {
    // A throw anywhere below used to leave the browser AND the preview server
    // open, so the probe HUNG until the harness timed out instead of printing
    // its error. Two rounds lost to this.
    await browser.close();
    if (server !== null) await server.close();
  }
  const total = entryPairs.length + combatPairs.length;
  if (total === 0) {
    console.log('\nOK: no two sibling overlays in the arena top strip overlap');
    return;
  }
  console.error(`\nFAIL: ${total} overlapping pair(s) in the arena top strip`);
  process.exitCode = 1;
}

let entryPairs = [];
let combatPairs = [];

async function run(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1011 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const url = `${baseUrl.replace(/\/$/, '')}/?screen=city&seed=${SEED}`;
  console.log(`  (measuring ${baseUrl})`);
  console.log('  booting the city...');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('sm-boot') === null, { timeout: 20_000, polling: 50 });

  // The reviewer's screen is an IN-CITY arena match (Division 5), not the
  // standalone `?screen=arena` route. Those are two different functions with
  // two different overlays, and only the in-city one carries the "Esc — pause"
  // hint at top:88px that the finding is about. Measuring `?screen=arena`
  // measures a screen the finding does not describe.
  const screen = arg('screen', 'arena');
  const isRoad = screen === 'road';
  const screenSelector = isRoad ? '.sm-screen--road' : '.sm-screen--arena';
  console.log(`  target screen: ${screen} (${screenSelector})`);
  if (isRoad) {
    console.log('  walking off the spawn and back out through the gate...');
    await walkThroughGateToRoad(page, SEED, (m) => console.log(`  ${m}`));
    console.log('  on the road');
  } else {
  console.log('  walking to the arena facility...');
  const facilityRows = await walkIntoFacility(page, 'arena', SEED, (m) => console.log(`  ${m}`));
  if (!facilityRows.some((l) => l.includes('Championship'))) {
    throw new Error(`probe: walked into the wrong facility; rows were ${JSON.stringify(facilityRows)}`);
  }
  const division5 = facilityRows.find((l) => l === 'Enter Division 5');
  if (division5 === undefined) throw new Error(`probe: no "Enter Division 5" row in ${JSON.stringify(facilityRows)}`);
  await page.evaluate((label) => {
    const node = [...document.querySelectorAll('.sm-menu__label')].find((n) => n.textContent === label);
    node?.closest('.sm-menu__item')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, division5);
  await page.waitForFunction(() => document.querySelector('.sm-screen--arena') !== null, { timeout: 10_000, polling: 60 });
  console.log('  entered Division 5 from the city facility');
  }

  // The match-entry message is the tallest state the status line takes, so it
  // is the state most likely to collide. Sample it, then fire to produce a
  // combat message and sample again.
  await page.waitForTimeout(600);
  const entry = await page.evaluate(READ_OVERLAY, screenSelector);
  if (entry.error !== undefined) throw new Error(`probe: ${entry.error}`);
  entryPairs = reportOverlaps('match entry', entry);

  // Put a MESSAGE on screen before measuring. On the road the messages panel
  // is `display: none` while empty, so measuring the road cold reported zero
  // overlaps — a flat signal from an absent element, not a sound layout, and
  // exactly the "a value that cannot move cannot be tested" trap. 'x' is the
  // road's wreck search, which always answers with a message.
  if (isRoad) {
    // Road notices come from CONTACT events (`logNotice`'s five callers are all
    // traffic/hostile/contact-defeated), so the only way to populate the feed is
    // to drive until traffic appears. Pressing 'x' does not: a wreck search with
    // nothing in range answers on the `notice` line, not the feed.
    await page.keyboard.down('w');
    await page.waitForTimeout(9000);
    await page.keyboard.up('w');
    const feed = await page.evaluate(() => {
      const p = document.querySelector('.hud-panel--messages');
      if (p === null) return { present: false, visible: false, text: '' };
      const s = getComputedStyle(p);
      return { present: true, visible: s.display !== 'none' && s.visibility !== 'hidden', text: (p.textContent ?? '').trim().slice(0, 80) };
    });
    console.log(`  road message feed: ${JSON.stringify(feed)}`);
    if (!feed.visible) {
      // NOT a pass and NOT a failure: the element that would collide is absent,
      // so this screen is unmeasured. Saying "0 overlaps" here would be the
      // flat-signal error — an absent element cannot overlap anything.
      console.log('\n  UNVERIFIED: the road message feed never rendered, so the road hint was not measured against a real panel');
    }
  } else {
    await page.keyboard.down('Space');
    await page.waitForTimeout(1200);
    await page.keyboard.up('Space');
  }
  await page.waitForTimeout(600);
  const combat = await page.evaluate(READ_OVERLAY, screenSelector);
  combatPairs = combat.error !== undefined ? [] : reportOverlaps('after firing', combat);

  // "No overlaps" is ALSO what you get from simply DELETING the pause hint, so
  // the hint's own presence is asserted separately. A fix that threw away the
  // teaching text and called it a layout fix would pass the overlap check and
  // fail this one. This is the whole difference between "the two elements no
  // longer collide" and "the player can still find the pause key".
  const visible = [...(entry.texts ?? []), ...(combat.texts ?? [])];
  const hint = visible.find((t) => t.includes('Esc'));
  if (hint === undefined) {
    console.error('\nFAIL: no top-strip element mentions the pause key — it looks deleted, not moved');
    process.exitCode = 1;
    return;
  }
  console.log(`\n  pause key still on screen, in: ${JSON.stringify(hint.slice(0, 130))}`);

  await page.screenshot({ path: '.shots/arena-hud-overlap.png' }).catch(() => {});
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
