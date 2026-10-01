/**
 * Real-browser layout gate for `@/ui/menu`'s CSS: the canonical regression
 * `src/ui/menu.css`'s own header comment describes — a building menu clipped
 * because `.sm-menu` sized itself off the WINDOW (`calc(100vw - 32px)`)
 * instead of its actual parent, `.sm-menu-root`, which is only as wide as the
 * game view. happy-dom's `getBoundingClientRect()` returns 0/0 for every
 * element, so no assertion in `tests/integration/screens.test.ts` can see
 * this class of bug at all — hence a real Chrome (`channel: 'chrome'`, real
 * layout engine) instead of Playwright's bundled Chromium or another jsdom
 * variant.
 *
 * Uses the Fleet roster (`f` from the City screen) as the "real building
 * menu": it mounts the exact same `@/ui/menu` component at the exact same
 * `min(480px, 92vw)` "game view" width every actual building interior uses
 * (`src/app.ts`'s `openPanel`/`showFleet`), reached deterministically with no
 * real-time movement through a randomly generated city layout. See
 * `tests/browser/support/game.ts`'s `openFleetPanel` for the full reasoning.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { bootToCity, gotoTitle, openFleetPanel, readMenuLayout } from './support/game';

const baseUrl = process.env.SMDUEL_TEST_BASE_URL;
if (baseUrl === undefined) {
  throw new Error('test:browser: SMDUEL_TEST_BASE_URL not set — run via `npm run test:browser`, not `vitest` directly');
}

describe('real-browser layout: the Fleet building menu never overflows its container', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('the menu panel stays inside its game-view-width container at a 1200px viewport, with no row text clipped', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    try {
      await bootToCity(page, baseUrl, 'LayoutRig');
      await openFleetPanel(page);

      const layout = await readMenuLayout(page);

      // The regression: `.sm-menu` sized off `100vw` instead of its parent
      // overflowed `.sm-menu-root` on its right edge. `+1` absorbs
      // sub-pixel layout rounding, nothing more.
      expect(layout.menuRight).toBeLessThanOrEqual(layout.containerRight + 1);
      expect(layout.menuLeft).toBeGreaterThanOrEqual(layout.containerLeft - 1);
      // The same regression also produced a horizontal scrollbar on `.sm-menu`
      // itself and cut ineligibility reasons off mid-word.
      expect(layout.menuScrollWidth).toBeLessThanOrEqual(layout.menuClientWidth + 1);
      expect(layout.clippedItemCount).toBe(0);
    } finally {
      await context.close();
    }
  });
});

/**
 * A scrolling menu must be able to show its LAST row above the sticky footer.
 *
 * This exists because the obvious version of the check PASSED while the thing it
 * claimed to verify was broken. The first attempt measured the gap between the
 * last row and the footer and found 78px of clearance — on a Weapon Shop whose
 * "Leave" row was scrolled entirely out of view. A row that is not on screen
 * sits far below the footer, so "clearance" was trivially satisfied by the very
 * condition it was supposed to detect. It is the same failure as the two probes
 * that tried to measure a moving car: a value that cannot distinguish "correct"
 * from "absent" is not a measurement.
 *
 * So this scrolls the list to its END first, and then asserts the last row is
 * INSIDE the container and ABOVE the footer. Only a real browser computes
 * layout at all — happy-dom returns zeroes — which is why this lives here and
 * not in the unit suite.
 */
describe('real-browser layout: a long scrolling menu keeps its last row reachable', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('scrolls to the end and finds "Leave" fully visible above the pinned footer', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    try {
      // The Controls screen, not the Weapon Shop. It is the LONGEST menu in the
      // game (19 rows) and it is one keypress from the title, whereas the Weapon
      // Shop has to be REACHED BY WALKING and this suite boots a random seed —
      // so the city layout differs per run and no particular doorway is
      // deterministically reachable from here. The property under test is "a menu
      // long enough to scroll keeps its last row reachable", and Controls is a
      // stronger example of it than a 14-row shop.
      await gotoTitle(page, baseUrl);
      await page.keyboard.press('2'); // title row 1: Controls
      await page.waitForSelector('.sm-menu');

      const result = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.sm-menu-root');
        const footer = document.querySelector('.sm-menu__hint');
        if (panel === null || footer === null) throw new Error('test: menu or footer not found');
        panel.scrollTop = panel.scrollHeight; // the END, not the top
        const rows = [...document.querySelectorAll('.sm-menu__item')];
        const last = rows[rows.length - 1];
        if (last === undefined) throw new Error('test: no rows');
        const pr = panel.getBoundingClientRect();
        const lb = last.getBoundingClientRect();
        const fb = footer.getBoundingClientRect();
        return {
          rows: rows.length,
          lastText: (last.textContent ?? '').trim(),
          insideContainer: lb.top >= pr.top - 1 && lb.bottom <= pr.bottom + 1,
          // A REAL GAP, not `aboveFooter`. The first version of this test
          // tolerated 1px, and a mutation that deleted the list's bottom padding
          // PASSED it: without padding the last row's bottom merely TOUCHES the
          // footer's top, which satisfies "not overlapping" while looking like the
          // row is jammed against the bar. The clearance exists to leave visible
          // air, so the assertion has to be about air.
          gapAboveFooter: Math.round(fb.top - lb.bottom),
        };
      });
      // 1px absorbs sub-pixel rounding and nothing more.
      expect(result.rows).toBeGreaterThan(10);
      expect(result.lastText.length, 'the last row should have a label').toBeGreaterThan(0);
      expect(result.insideContainer, `last row "${result.lastText}" is outside the panel`).toBe(true);
      expect(result.gapAboveFooter, `last row "${result.lastText}" needs visible air above the footer`).toBeGreaterThanOrEqual(8);
    } finally {
      await context.close();
    }
  });
});
