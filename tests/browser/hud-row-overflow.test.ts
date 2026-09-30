/**
 * Real-browser layout gate for the HUD's multi-column rows: no cell's CONTENT
 * may paint over its neighbour.
 *
 * Found by iteration 92's own change. The weapons row is a six-column grid —
 * index, facing, name, ammo, cooldown, durability — inside a 260px fixed
 * panel, and the facing cell rendered "↑ FRONT" with `white-space: nowrap` in a
 * 3.2em track with no overflow rule. Measured in real Chrome: 49px of content
 * in a 33px box, a 6px gap, so 10px of "NT" painted on top of the weapon name
 * and the row read "FRO**Mach…** 20/20".
 *
 * THE REASON EVERY CAPTURE MISSED IT is the part worth keeping. This project's
 * screenshot rig drove a car with no weapons, so the panel rendered its
 * "none fitted" line and this row was never photographed. An unrepresentative
 * fixture does not just document less — it HIDES defects, and it hid this one
 * through roughly ninety reviews. It only appeared once the rig's car was made
 * genuinely road-legal, which is the same change that let the city gate start
 * enforcing what the car strip advertised.
 *
 * WHY A REAL BROWSER: happy-dom's `getBoundingClientRect()` returns 0/0 for
 * every element, so no integration test can see overflow at all. The same
 * reason `menu-layout.test.ts` exists for `@/ui/menu`. And the check is on
 * `scrollWidth` vs `clientWidth` rather than on the rects, because a grid track
 * does not clip its own content — the LAYOUT boxes never overlapped, only the
 * painted glyphs did, so a test comparing bounding rects would have passed
 * against the bug that shipped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';

const baseUrl = process.env.SMDUEL_TEST_BASE_URL;
if (baseUrl === undefined) {
  throw new Error('test:browser: SMDUEL_TEST_BASE_URL not set — run via `npm run test:browser`, not `vitest` directly');
}

const SEED = 'a11ce5eed5eed5eed5eed5eed5eed5ee';

interface CellOverflow {
  readonly cell: string;
  readonly text: string;
  readonly clientW: number;
  readonly scrollW: number;
  readonly overflowX: string;
}

describe('real-browser layout: no HUD row cell paints over its neighbour', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('keeps every cell of a mounted weapons row inside its own track', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    try {
      await page.goto(`${baseUrl}?screen=arena&seed=${SEED}`, { waitUntil: 'load' });
      // A real weapon has to be mounted for this row to exist at all — the same
      // condition whose absence hid the defect from every capture.
      await page.waitForSelector('.hud-weapon-row', { timeout: 20_000 });

      const cells: CellOverflow[] = await page.evaluate(() => {
        const row = document.querySelector('.hud-weapon-row');
        if (row === null) throw new Error('test: no .hud-weapon-row');
        const CLASSES = [
          'hud-weapon-slot',
          'hud-weapon-facing',
          'hud-weapon-name',
          'hud-weapon-ammo',
          'hud-weapon-cooldown',
          'hud-weapon-dp',
        ];
        return CLASSES.map((cls) => {
          const el = row.querySelector(`.${cls}`);
          if (el === null) throw new Error(`test: .${cls} missing from the weapon row`);
          return {
            cell: cls,
            text: (el.textContent ?? '').trim(),
            clientW: el.clientWidth,
            scrollW: el.scrollWidth,
            overflowX: getComputedStyle(el).overflowX,
          };
        });
      });

      // The property is "no cell PAINTS OVER its neighbour", not "no cell
      // overflows" — because an ellipsised cell legitimately overflows its
      // content box and is supposed to. The weapon name has always carried
      // `overflow: hidden; text-overflow: ellipsis` for exactly that reason, so
      // asserting `scrollWidth <= clientWidth` on every cell would fail against
      // correct code. What must hold is that a cell whose content exceeds its
      // track CLIPS it, because a grid track does not clip for it.
      //
      // First version of this test asserted the strict version and failed on
      // the name at 81px of content in a 58px track — which is the name doing
      // its job, not the bug. The bug was an UNCELLIPTED 10px spill, and the
      // distinction between those two is the whole test.
      for (const c of cells) {
        const overflows = c.scrollW > c.clientW;
        const clips = c.overflowX === 'hidden' || c.overflowX === 'clip' || c.overflowX === 'auto' || c.overflowX === 'scroll';
        expect(
          !overflows || clips,
          `.${c.cell} renders "${c.text}" at ${c.scrollW}px inside a ${c.clientW}px track with overflow-x: ${c.overflowX} — it paints over the next column instead of truncating`,
        ).toBe(true);
      }
      // The name is the one value that identifies the row (its stylesheet says
      // so), so it is asserted separately: it is allowed to ellipsize, but it
      // must be wide enough to show a real weapon's name rather than three
      // letters of it. Without this the overflow fix could have been "solved"
      // by starving the name instead.
      const name = cells.find((c) => c.cell === 'hud-weapon-name');
      expect(name, 'the weapon name cell should be present').toBeDefined();
      expect(name?.clientW ?? 0).toBeGreaterThan(40);
      expect(errors, 'the arena should mount without console errors').toEqual([]);
    } finally {
      await context.close();
    }
  });
});
