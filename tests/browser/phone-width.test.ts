/**
 * Real-browser check of two properties `src/ui/menu.css` claims but no test
 * ever verified (its own header/`@media (pointer: coarse)` comments say so
 * explicitly): on a touch device, every menu row is at least a 44px tap
 * target, and nothing in the Title screen overflows horizontally at a phone
 * viewport. happy-dom evaluates no media queries at all and computes no
 * layout, so `(pointer: coarse)` never matched and no width was ever real in
 * that harness — this is a real Chrome (`channel: 'chrome'`) with a real
 * touch-capable context instead.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { gotoTitle } from './support/game';

const baseUrl = process.env.SMDUEL_TEST_BASE_URL;
if (baseUrl === undefined) {
  throw new Error('test:browser: SMDUEL_TEST_BASE_URL not set — run via `npm run test:browser`, not `vitest` directly');
}

describe('real-browser layout: the Title menu at phone width', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('every row is at least a 44px tap target and nothing overflows the viewport horizontally, at 390x664 with touch', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    try {
      await gotoTitle(page, baseUrl);

      const rowHeights = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.sm-menu__item')).map((item) => item.getBoundingClientRect().height),
      );
      expect(rowHeights.length).toBeGreaterThan(0);
      for (const height of rowHeights) expect(height).toBeGreaterThanOrEqual(44);

      const overflowsHorizontally = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflowsHorizontally).toBe(false);
    } finally {
      await context.close();
    }
  });
});
