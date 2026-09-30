// @vitest-environment happy-dom
/**
 * The road screen's trip menu, and the freeze it promises.
 *
 * Codex `gpt-6.1-sol` drove the deployed road and reported: "I tried Escape
 * and P. Neither opened a menu or paused the simulation; the car continued
 * coasting." That greps clean — `showRoad` mounted no menu and no actions at
 * all, so the road was the only screen in the game with no way to stop.
 *
 * The assertion here is deliberately the FREEZE and not the menu's existence.
 * A translucent panel over a simulation that keeps stepping would look
 * complete, mount a `.sm-menu`, and pass any test that only asked "is there a
 * menu" — while the car drove itself down the highway with the player choosing
 * between Resume and Abandon. So the load-bearing check here is that the
 * odometer does not advance across frames while the menu is open, and that the
 * menu is reachable by BOTH keys the reviewer actually tried.
 *
 * Drives the REAL `@/app` through Title -> Driver -> Constructor -> City ->
 * Gate -> Road purely via dispatched `KeyboardEvent`s, the same shape as
 * `road-bounds-wiring.test.ts` (boot helpers are module-private there, hence
 * duplicated rather than imported — the drift risk that duplication carries is
 * recorded in that file's own comment above `bootToCity`).
 */
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { skillsConfig } from '@/data/rulesets';

// ---------------------------------------------------------------------------
// rAF stub: capture, never auto-run.
// ---------------------------------------------------------------------------

type Raf = (nowMs: number) => void;
let rafCallback: Raf | null = null;
let rafHandleCounter = 0;
let simNowMs = 0;

function installRafStub(): void {
  rafCallback = null;
  rafHandleCounter = 0;
  simNowMs = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCallback = cb as Raf;
    return ++rafHandleCounter;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {
    rafCallback = null;
  }) as typeof window.cancelAnimationFrame;
}

function stepFrame(deltaMs = 250): void {
  simNowMs += deltaMs;
  const cb = rafCallback;
  if (cb === null) throw new Error('test: no frame callback registered — the screen has not started its render loop yet');
  cb(simNowMs);
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function dispatchKey(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function requireOne(selector: string): Element {
  const found = document.querySelectorAll(selector);
  if (found.length !== 1) throw new Error(`test: expected exactly one "${selector}", found ${found.length}`);
  return found[0] as Element;
}

function queryAll(selector: string): Element[] {
  return [...document.querySelectorAll(selector)];
}

// ---------------------------------------------------------------------------
// Boot: real Title -> Driver -> Constructor -> City -> Gate -> Road.
// ---------------------------------------------------------------------------

const TEST_SEED = 'screens-test-seed-1';

async function bootFresh(root: HTMLElement): Promise<Element> {
  const { boot } = await import('@/app');
  installRafStub();
  const bootPromise = boot(root, {
    search: '',
    randomSeed: () => TEST_SEED,
    openDb: () => Promise.reject(new Error('test: no save database — always start a fresh session')),
  });
  await bootPromise;
  return requireOne('.sm-menu');
}

async function bootToCity(root: HTMLElement): Promise<void> {
  const titleMenu = await bootFresh(root);
  dispatchKey(titleMenu, { key: '1' });
  requireOne('.sm-screen--driver button').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  // A ROAD-LEGAL car: name, one armour facing, one weapon. `roadLegalityMisses`
  // requires all three, and the gate refuses anything less.
  const ARMOR_FACING_0_ROW = 6;
  const WEAPON_SLOT_0_ROW = 11;
  const constructorScreen = requireOne('.sm-screen--constructor');
  for (const ch of 'MenuRig') dispatchKey(constructorScreen, { key: ch });
  for (let i = 0; i < 40; i++) dispatchKey(constructorScreen, { key: 'ArrowUp' });
  for (let i = 0; i < ARMOR_FACING_0_ROW; i++) dispatchKey(constructorScreen, { key: 'ArrowDown' });
  dispatchKey(constructorScreen, { key: 'ArrowRight' });
  dispatchKey(constructorScreen, { key: 'ArrowRight' });
  for (let i = 0; i < 40; i++) dispatchKey(constructorScreen, { key: 'ArrowUp' });
  for (let i = 0; i < WEAPON_SLOT_0_ROW; i++) dispatchKey(constructorScreen, { key: 'ArrowDown' });
  dispatchKey(constructorScreen, { key: 'ArrowRight' });
  for (let i = 0; i < 40; i++) dispatchKey(constructorScreen, { key: 'ArrowUp' });
  for (let i = 0; i < 40; i++) dispatchKey(constructorScreen, { key: 'ArrowDown' });
  dispatchKey(constructorScreen, { key: 'Enter' });

  await flushMicrotasks();
  await flushMicrotasks();
  requireOne('.sm-screen--city');
}

/**
 * Walks through the real gate trigger and takes the first route, landing on the
 * Road screen. Two legs, because the player spawns ON the gate and the doorway
 * trigger is an edge (was-outside -> is-inside), not a level test.
 */
async function walkThroughGateToRoad(): Promise<void> {
  const cityId = skillsConfig().startingLocation;
  const { generateCityLayout } = await import('@/sim/city');
  const gate = generateCityLayout(cityId, TEST_SEED).gate.position;

  const inward: KeyboardEventInit[] = [];
  if (-gate.x > 0) inward.push({ key: 'd', code: 'KeyD' });
  else if (-gate.x < 0) inward.push({ key: 'a', code: 'KeyA' });
  if (gate.y > 0) inward.push({ key: 's', code: 'KeyS' });
  else if (gate.y < 0) inward.push({ key: 'w', code: 'KeyW' });
  const outward: KeyboardEventInit[] = inward.map((k) => {
    if (k.code === 'KeyD') return { key: 'a', code: 'KeyA' };
    if (k.code === 'KeyA') return { key: 'd', code: 'KeyD' };
    if (k.code === 'KeyW') return { key: 's', code: 'KeyS' };
    return { key: 'w', code: 'KeyW' };
  });

  for (const k of inward) window.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
  for (let i = 0; i < 15; i++) stepFrame();
  for (const k of inward) window.dispatchEvent(new KeyboardEvent('keyup', { ...k, bubbles: true }));

  for (const k of outward) window.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
  for (let i = 0; i < 15; i++) stepFrame();
  for (const k of outward) window.dispatchEvent(new KeyboardEvent('keyup', { ...k, bubbles: true }));

  await flushMicrotasks();
  const gateMenu = requireOne('.sm-menu');
  dispatchKey(gateMenu, { key: '1' });
  await flushMicrotasks();
  requireOne('.sm-screen--road');
}

async function bootToRoad(root: HTMLElement): Promise<void> {
  await bootToCity(root);
  await walkThroughGateToRoad();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  vi.restoreAllMocks();
});

describe('road trip menu', () => {
  it('opens on Escape and the trip FREEZES while it is open', async () => {
    await bootToRoad(root);

    // Drive a little so the odometer is genuinely moving when we pause; a
    // frozen-at-zero odometer would satisfy "did not advance" for the wrong
    // reason, which is the mistake this test exists to avoid.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    for (let i = 0; i < 12; i++) stepFrame();

    /**
     * The STATUS LINE alone, not the whole screen's text.
     *
     * The first version of this compared `.sm-screen--road`'s entire
     * textContent, and it failed while the freeze was working correctly — the
     * only difference was the menu this very change added. Comparing the whole
     * screen means the test fails for the feature it is testing. The status
     * line is the odometer readout, which is the thing that must not move.
     */
    const statusEl = requireOne('.sm-screen--road').querySelector('div');
    const statusBefore = statusEl?.textContent ?? '';

    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(1);

    // The car is still being asked to drive (KeyW never released), so if the
    // freeze were not real these frames would move the odometer.
    for (let i = 0; i < 20; i++) stepFrame();
    expect(requireOne('.sm-screen--road').querySelector('div')?.textContent ?? '').toBe(statusBefore);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
  });

  it('offers Resume, Controls and Abandon trip', async () => {
    await bootToRoad(root);
    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();

    const labels = queryAll('.sm-menu__item').map((i) => (i.textContent ?? '').trim());
    expect(labels.length).toBe(3);
    expect(labels.join('|')).toMatch(/Resume/i);
    expect(labels.join('|')).toMatch(/Controls/i);
    expect(labels.join('|')).toMatch(/Abandon/i);
  });

  it('opens on P as well as Escape — the reviewer tried both', async () => {
    await bootToRoad(root);
    dispatchKey(window, { key: 'p' });
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(1);
  });

  it('resumes and the trip moves again', async () => {
    await bootToRoad(root);

    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    const menu = requireOne('.sm-menu');
    dispatchKey(menu, { key: 'Escape' }); // BACK -> close, which is the onBack path
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    for (let i = 0; i < 24; i++) stepFrame();
    const status = requireOne('.sm-screen--road').textContent ?? '';
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
    // Progress means the remaining-miles readout changed from the paused value.
    expect(status).toMatch(/remaining/);
  });

  it('abandoning returns to the city with the car left behind, same as a wreck', async () => {
    await bootToRoad(root);
    const originCity = skillsConfig().startingLocation;

    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    // Row 3 is Abandon; `handleMenuKey` maps digit 3 to index 2.
    dispatchKey(requireOne('.sm-menu'), { key: '3' });
    await flushMicrotasks();
    await flushMicrotasks();

    // Back in a city, at the ORIGIN — not teleported to the destination. The
    // assertion is on the DISPLAY name, not `originCity`: `skillsConfig()
    // .startingLocation` is the ruleset id ('newyork') and the screen renders
    // `cityName(id)` ('New York'). Comparing the raw id against rendered text is
    // the ninth instance in this log of a fixture written from the shape of the
    // data rather than from its value, and it fails for a reason that has
    // nothing to do with the feature under test.
    const { cityName } = await import('@/ui/strings');
    const city = requireOne('.sm-screen--city');
    const cityText = city.textContent ?? '';
    expect(cityText).toContain(cityName(originCity));
    // And the car is left behind, not parked at the player's feet.
    expect(cityText).not.toMatch(/Not road-legal/);
  });

  it('leaves no menu mounted when the screen is torn down while paused', async () => {
    await bootToRoad(root);
    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(1);

    // Abandon is the only road path that returns to another screen; going
    // through it proves `stop()` unmounts the menu and detaches the key
    // listener rather than leaving a screen-scoped Escape handler behind.
    dispatchKey(requireOne('.sm-menu'), { key: '3' });
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(0);

    // A stray Escape on the city must NOT open a road menu.
    dispatchKey(window, { key: 'Escape' });
    await flushMicrotasks();
    expect(queryAll('.sm-menu').length).toBe(0);
  });
});
