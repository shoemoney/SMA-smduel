/**
 * Real-browser gate: leaving the Controls screen lands on a LIVE match, not an
 * already-paused one.
 *
 * Found by instrumenting iteration 111's round trip rather than by a reviewer:
 * the player pressed Escape ONCE to leave a settings menu and came back to a
 * match that was already frozen — pause menu up, frame loop short-circuiting on
 * `if (paused)`, HUD never painted, odometer dead. No error, no clue on screen.
 *
 * `showControls` calls its BACK synchronously inside the keydown it is handling,
 * `onExit` mounts the arena, and the arena attached its own window `keydown`
 * listener before that same Escape had finished propagating — so the Escape
 * landed on the screen it had just built. The fix is `ev.target`-based (a key
 * aimed inside a menu belongs to that menu).
 *
 * WHY THIS IS A BROWSER TEST AND NOT ONLY THE TWO INTEGRATION ONES. The defect
 * is entirely about real DOM event propagation — does an event dispatched at a
 * menu row still BUBBLE to `window`, and what is `event.target` by the time it
 * arrives. `tests/integration/arena-auto-end.test.ts` and
 * `tests/integration/road-trip-menu.test.ts` both cover the logic under
 * happy-dom and both bite when the guard is removed, and that is not nothing.
 * But happy-dom's synthetic `dispatchEvent` is not a browser's, the arena path
 * here additionally needs real WebGPU to paint the HUD that proves the frame
 * loop is live, and the shipping symptom is a picture a player sees. `practice`
 * is the event to use: zero opponents, already covered by a test proving it
 * never auto-ends, so the match cannot resolve underneath the probe — the exact
 * rig mistake that made iteration 111 misdiagnose this.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';

const baseUrl = process.env.SMDUEL_TEST_BASE_URL;
if (baseUrl === undefined) {
  throw new Error('test:browser: SMDUEL_TEST_BASE_URL not set — run via `npm run test:browser`, not `vitest` directly');
}

const SEED = 'a11ceed5eed5eed5eed5eed5eed5eed5ee';

describe('real-browser controls round trip: returning lands on a live match', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('Escape → Controls → Escape returns to an unpaused arena whose HUD is live', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1010 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`${baseUrl}?screen=arena-event&event=practice&seed=${SEED}`, { waitUntil: 'load' });
    await page.waitForSelector('.sm-screen--arena');
    await page.waitForTimeout(6000);

    // Pause, then take the Controls row. Clicked rather than keyed because the
    // row is a real pointer target here and this is what a player does.
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sm-screen--arena .sm-menu-root');
    await page.getByText('Controls', { exact: true }).click();
    await page.waitForSelector('.sm-screen--controls');

    // Back out of Controls with a single Escape — the whole defect is about
    // what that one keypress does to the screen it mounts.
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sm-screen--arena');
    await page.waitForTimeout(750);

    // THE BUG. The menu is mounted INSIDE the arena screen, so its presence here
    // is a direct read of "came back to a paused arena".
    const menusInsideArena = await page.locator('.sm-screen--arena .sm-menu-root').count();
    expect(
      menusInsideArena,
      'Controls round trip returned to a paused arena — the Escape that mounted it re-paused it',
    ).toBe(0);

    // The HUD only paints from inside frame(), so it is also the proof the loop
    // is running rather than short-circuiting.
    const dial = page.locator('.hud-speed-dial').first();
    await dial.waitFor({ state: 'attached', timeout: 5000 });

    const readDial = async (): Promise<number> => {
      const raw = await dial.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--hud-speed-frac'));
      const n = Number.parseFloat(raw);
      if (Number.isNaN(n)) throw new Error(`speed dial had no readable --hud-speed-frac (got "${raw}")`);
      return n;
    };

    // CONTROL: the signal must be able to MOVE, or "unpaused" proves nothing.
    const before = await readDial();
    await page.keyboard.down('w');
    await page.waitForTimeout(1500);
    await page.keyboard.up('w');
    await page.waitForTimeout(250);
    const after = await readDial();

    expect(
      after,
      `the car stayed at ${after.toFixed(3)} after returning from Controls; the match did not resume`,
    ).toBeGreaterThan(before + 0.01);
    expect(errors, 'page errors').toEqual([]);

    await context.close();
  });
});
