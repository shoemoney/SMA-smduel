/**
 * Real-browser gate: an OPEN MENU is above the HUD, and the HUD cannot
 * swallow a click aimed at a menu row.
 *
 * Found by Codex `gpt-6.1-sol` driving the live road: "The radar draws over
 * the menu's header, all four option numbers, and the beginnings of the
 * labels. This also blocks interaction: hit-testing the centre of each option
 * number returned the radar face rather than the menu option."
 *
 * THE OVERLAP IS STRUCTURAL, NOT A TUNING OVERSIGHT. The radar is pinned
 * bottom-left in WINDOW coordinates; `menuHost` is sized to the GAME VIEW
 * (420-480px, `min-width(420px, 90vw)`) and bottom-anchored. At 1200x1010 the
 * radar occupied x 25-179 / y 783-937 and the first menu row x 65-391 at the
 * same y, so the lower menu rows land squarely in the radar's corner. Moving
 * the menu or the radar would fix one screen and leave the next collision
 * undiscovered; elevating the menu fixes every menu/HUD pair at once.
 *
 * WHY `elementFromPoint` AND NOT A BOUNDING-BOX COMPARISON. The failure that
 * matters is INTERCEPTION, not overlap: the panel and the radar can occupy the
 * same pixels harmlessly. `elementFromPoint` is the only check that asks the
 * question a player's click actually asks — "what receives this?" — and it is
 * the same measurement the reviewer made, so the guard and the report are
 * directly comparable.
 *
 * WHY A REAL BROWSER: happy-dom's `getBoundingClientRect()` returns 0/0 for
 * every element and has no `elementFromPoint` at all, so no unit or
 * integration test can see this class of defect.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';

const baseUrl = process.env.SMDUEL_TEST_BASE_URL;
if (baseUrl === undefined) {
  throw new Error('test:browser: SMDUEL_TEST_BASE_URL not set — run via `npm run test:browser`, not `vitest` directly');
}

const SEED = 'a11ceed5eed5eed5eed5eed5eed5eed5ee';

interface RowProbe {
  readonly label: string;
  readonly receiver: string;
  readonly reachesMenuRow: boolean;
}

describe('real-browser stacking: an open menu is above the HUD', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  // The reviewer's viewport. Not an arbitrary size: this is where the game
  // VIEW (480px) and the WINDOW-anchored radar (154px wide, bottom-left) put
  // the menu's lower rows inside the radar, so a test at some other width
  // would pass against the bug that shipped.
  it('delivers a click on every trip-menu option number to the menu row', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1010 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`${baseUrl}?screen=road&seed=${SEED}`, { waitUntil: 'load' });
    await page.waitForTimeout(6000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const probes: RowProbe[] = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.sm-menu__item')];
      return rows.map((row) => {
        const b = row.getBoundingClientRect();
        // The digit sits ~8px in from the row's left edge, which is the pixel
        // the radar covered.
        const hit = document.elementFromPoint(b.x + 8, b.y + b.height / 2) as Element | null;
        return {
          label: (row.textContent ?? '').trim(),
          receiver: hit ? `${hit.tagName}.${String(hit.className)}` : 'none',
          reachesMenuRow: Boolean(hit?.closest?.('.sm-menu__item')),
        };
      });
    });

    expect(probes.length, 'the trip menu should have mounted with four options').toBeGreaterThanOrEqual(4);
    const swallowed = probes.filter((p) => !p.reachesMenuRow).map((p) => `${p.label} -> ${p.receiver}`);
    expect(
      swallowed,
      `these menu rows are covered by HUD chrome and cannot be clicked: ${swallowed.join(' | ')}`,
    ).toEqual([]);
    expect(errors, 'page errors').toEqual([]);

    await context.close();
  });
});
