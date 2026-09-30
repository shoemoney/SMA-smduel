/**
 * Real-browser regression test for the name field in `@/ui/builder`.
 *
 * THE BUG. Clicking the car-name input, then typing, did nothing. The row
 * owning the input has a `click` listener that calls `onRowActivate`, which
 * re-renders the constructor — so a click inside the input bubbled up to that
 * listener, the re-render replaced the input element, and the browser dropped
 * focus to `<body>`. Every keystroke then went to the document instead of the
 * field. Found by Codex `gpt-6.1-sol` driving the live deployment with computer
 * use, and reproduced independently here against a real browser:
 *
 *     await input.click();            // activeElement becomes BODY
 *     await keyboard.type('TESTCAR'); // value stays ""
 *
 * The field is MANDATORY — the constructor will not build without a name — so
 * the obvious interaction failed at exactly the point a new player is required
 * to act. A player would reasonably conclude the game was broken.
 *
 * WHY THIS IS A BROWSER TEST AND NOT A UNIT TEST, which is the part worth
 * recording. `tests/unit/builder.test.ts` drives a hand-written DOM double, and
 * that double stores listeners per element and fires them on the element
 * itself — it does NOT model event BUBBLING. A test written there would pass
 * with the bug present and fail to fail without it: the input's click would
 * never reach the row's handler in the double, so the assertion would be
 * decorative. `tests/browser/menu-layout.test.ts` already exists for the same
 * class of reason (happy-dom returns 0/0 for every `getBoundingClientRect`);
 * this is the bubbling equivalent, and no double can substitute for it.
 *
 * The fix is one line — `ev.stopPropagation()` on the input's click — and the
 * test below is what makes it a fix rather than a change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';

const baseUrl = process.env.SMDUEL_TEST_BASE_URL;
if (baseUrl === undefined) {
  throw new Error('test:browser: SMDUEL_TEST_BASE_URL not set — run via `npm run test:browser`, not `vitest` directly');
}

/** The constructor screen, opened directly rather than played to. */
async function openConstructor(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/?screen=constructor&seed=a11ce5ee`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sm-builder__row--name input', { timeout: 15_000 });
}

describe('real-browser behaviour: the mandatory car-name field accepts a click then a keystroke', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('keeps focus in the field after clicking it, so typing lands', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await openConstructor(page);

    const input = page.locator('.sm-builder__row--name input').first();
    await input.click();
    await page.keyboard.type('TESTCAR', { delay: 20 });

    // The whole bug in two assertions: focus must SURVIVE the click, and the
    // keystrokes must reach the field.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
    // `toHaveValue` is a Playwright-Expect matcher and is NOT available in
    // plain vitest/chai — the first run of this file failed with "Invalid Chai
    // property: toHaveValue" after the focus assertion had already passed.
    expect(await input.inputValue()).toBe('TESTCAR');

    await context.close();
  });

  it('does not let a click inside the field re-select the row and rebuild the constructor', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await openConstructor(page);

    const input = page.locator('.sm-builder__row--name input').first();
    // Tag the element so a re-render (which replaces it) is detectable.
    await input.evaluate((el) => el.setAttribute('data-sentinel', 'original'));
    await input.click();

    const sentinel = await page.evaluate(() =>
      document.querySelector('.sm-builder__row--name input')?.getAttribute('data-sentinel') ?? 'REPLACED',
    );
    expect(sentinel).toBe('original');

    await context.close();
  });
});
