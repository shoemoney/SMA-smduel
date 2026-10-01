/**
 * Real-browser navigation helpers shared by the tests in this directory.
 * Everything here drives the booted game exactly the way a player would —
 * clicks, `page.fill`, real keydown events — never an internal `@/app`
 * function, mirroring `tests/integration/screens.test.ts`'s own rule for its
 * happy-dom harness.
 */
import type { Page } from 'playwright-core';

/** Navigates to the built app and waits for the Title screen's menu. */
export async function gotoTitle(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl);
  await page.waitForSelector('.sm-menu');
}

/**
 * Title -> Driver Creation (defaults are legal, same invariant
 * `screens.test.ts`'s `bootToCity` relies on) -> Constructor, naming the car
 * and confirming via Enter in the name field itself — the exact path
 * `src/ui/builder.ts`'s `onNameSubmit` exists for, so this also doubles as an
 * end-to-end check of that fix in a real browser. Leaves the caller on
 * `.sm-screen--city`.
 */
export async function bootToCity(page: Page, baseUrl: string, carName: string): Promise<void> {
  await gotoTitle(page, baseUrl);
  await page.keyboard.press('1'); // Title row 0: "New Driver"

  await page.waitForSelector('.sm-screen--driver');
  await page.click('.sm-screen--driver button');

  await page.waitForSelector('.sm-screen--constructor');
  const nameInput = page.locator('.sm-builder__row-input');
  await nameInput.fill(carName);
  await nameInput.press('Enter');

  await page.waitForSelector('.sm-screen--city', { timeout: 15_000 });
}

/** Opens the Fleet roster — a real numbered `@/ui/menu` instance mounted at the same `min(480px, 92vw)` "game view" width every building interior uses (see `src/ui/menu.css`'s own header comment). Stands in for "walk into a building" without real-time movement: same component, same CSS class, same clipping defect class, reached deterministically instead of timed key-holds through a randomly-generated city layout. */
export async function openFleetPanel(page: Page): Promise<void> {
  await page.keyboard.press('f');
  // The roster is an OVERLAY inside the shared panel host, not its own screen any
  // more — `.sm-screen--fleet` only exists on the standalone post-victory path.
  await page.waitForSelector('.sm-panel-host .sm-menu');
}

export interface MenuLayoutSummary {
  readonly menuRight: number;
  readonly menuLeft: number;
  readonly containerRight: number;
  readonly containerLeft: number;
  readonly menuScrollWidth: number;
  readonly menuClientWidth: number;
  readonly clippedItemCount: number;
}

/**
 * Reads back the real, browser-computed geometry `getBoundingClientRect()`
 * gives only in an actual layout engine — the exact thing happy-dom cannot
 * provide (it returns 0/0 for every element; see `src/ui/menu.css`'s own
 * header comment on why this suite exists at all).
 */
export async function readMenuLayout(page: Page): Promise<MenuLayoutSummary> {
  return page.evaluate(() => {
    const menu = document.querySelector('.sm-menu');
    const container = document.querySelector('.sm-menu-root');
    if (menu === null || container === null) throw new Error('test: .sm-menu or .sm-menu-root not found in the page');
    const menuRect = menu.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const items = Array.from(document.querySelectorAll('.sm-menu__item'));
    const clippedItemCount = items.filter((item) => item.scrollWidth > item.clientWidth + 1).length;
    return {
      menuRight: menuRect.right,
      menuLeft: menuRect.left,
      containerRight: containerRect.right,
      containerLeft: containerRect.left,
      menuScrollWidth: menu.scrollWidth,
      menuClientWidth: menu.clientWidth,
      clippedItemCount,
    };
  });
}
