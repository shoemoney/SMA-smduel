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
import { bootToCity, openFleetPanel, readMenuLayout } from './support/game';

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
