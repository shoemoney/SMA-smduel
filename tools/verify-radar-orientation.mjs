#!/usr/bin/env node
/**
 * Asserts the radar orientation label occupies exactly ONE line box.
 *
 * The bug was found by an advisory review and CONFIRMED with
 * `Range.getClientRects()`, which returns one rect per line box — the only
 * reliable way to ask "does this text wrap?", since an element's own height
 * conflates wrapping with padding.
 *
 * This is a gate, not a screenshot comparison: it fails on the value.
 */
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { walkThroughGateToRoad } from './lib/walk-city.mjs';

const SEED = 'a11ce5eed5eed5eed5eed5ee';
await build({ logLevel: 'warn' });
const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'warn' });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu'] });
let bad = 0;
try {
  for (const [w, h] of [[900, 700], [1280, 800], [1600, 1000], [2560, 1400]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
    await page.goto(`${base}?seed=${SEED}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('sm-boot') === null, { timeout: 30_000, polling: 60 });
    await page.keyboard.press('1');
    await page.waitForSelector('.sm-screen--driver');
    await page.waitForFunction(() => { const b = document.querySelector('.sm-ignition'); return b && !b.disabled; });
    await page.click('.sm-ignition');
    await page.waitForSelector('.sm-screen--constructor');
    await page.fill('.sm-builder__row-input', 'VANGUARD');
    await page.evaluate(() => { const li = [...document.querySelectorAll('.sm-builder__row')].find((x) => x.querySelector('.sm-builder__row-label')?.textContent === 'Weapon 1'); li?.querySelector('.sm-builder__row-cycle--inc')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    await page.evaluate(() => { const li = [...document.querySelectorAll('.sm-builder__row')].find((x) => x.querySelector('.sm-builder__row-label')?.textContent === 'Armor: Front'); li?.querySelector('.sm-builder__row-cycle--inc')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    await page.waitForTimeout(150);
    await page.evaluate(() => [...document.querySelectorAll('.sm-builder__row')].find((x) => x.querySelector('.sm-builder__row-label')?.textContent === 'Confirm')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await page.waitForSelector('.sm-screen--city', { timeout: 20_000 });
    await walkThroughGateToRoad(page, SEED);
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const el = document.querySelector('.hud-radar-orientation-toggle');
      if (el === null) return { found: false };
      const range = document.createRange();
      range.selectNodeContents(el);
      const boxes = [...range.getClientRects()].filter((x) => x.width > 1 && x.height > 1);
      return {
        found: true,
        text: (el.textContent ?? '').trim(),
        ariaLabel: el.getAttribute('aria-label'),
        lines: boxes.length,
        lineWidths: boxes.map((x) => Math.round(x.width)),
        clientW: el.clientWidth, scrollW: el.scrollWidth,
        clipped: el.scrollWidth > el.clientWidth + 1,
      };
    });
    const ok = m.found && m.lines === 1 && !m.clipped;
    if (!ok) bad += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${w}x${h}: ${JSON.stringify(m)}`);
    await page.context().close();
  }
} finally { await browser.close(); await server.close(); }
console.log(bad === 0 ? '\nOK: the orientation label is one line and not clipped at every viewport' : `\n${bad} viewport(s) FAILED`);
if (bad > 0) process.exitCode = 1;
