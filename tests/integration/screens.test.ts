// @vitest-environment happy-dom
/**
 * DOM acceptance gate: every other test in this repo drives `@/app` at the
 * sim/exported-function level (`tests/integration/boot.test.ts`'s own header
 * says as much) — none of them mounts a screen and presses a key on it.
 * That gap is exactly what let both of these lines vanish from `showCity`/
 * `showRoad` with the suite still fully green:
 *
 *   if ((ev.key === 'f' || ev.key === 'F') && !paused) openFleetScreen();
 *   if (ev.key === 'x' || ev.key === 'X') trySearchWreck();
 *
 * This file boots the REAL app (`@/app`'s `boot()`) into a real
 * `happy-dom` document, drives it through Title -> Driver Creation ->
 * Constructor -> City purely via dispatched `KeyboardEvent`/click events
 * (never by calling an internal, unexported screen function directly),
 * walks the on-foot player through the city's real gate trigger to reach
 * the Road screen, and then dispatches the two fixed hotkeys at `window`
 * exactly as a player's browser would. The `@vitest-environment happy-dom`
 * docblock at the very top of this file is what gives ONLY this file a
 * DOM — every other suite keeps reading `vite.config.ts`'s own
 * `environment: 'node'`, unchanged.
 *
 * `window.requestAnimationFrame` is stubbed to CAPTURE each screen's frame
 * callback instead of auto-scheduling it (`stepFrame` below invokes it by
 * hand with a controlled `nowMs`) — every tick this file drives is
 * deterministic and instant, no real wall-clock waiting, no flakiness from
 * a throttled polyfill.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentSessionSeed, PLAYER_ID, persistArenaSession, showArcadeScoreSubmit, vehicleStateFromDesign } from '@/app';
import { initialClock } from '@/sim/calendar';
import { drivingConfig, economy, skillsConfig } from '@/data/rulesets';
import { createDriver } from '@/sim/driver';
import { generateCityLayout, type CityLayout } from '@/sim/city';
import type { DayPhase, DriverState, SkillName, Vec2, VehicleDesign, VehicleState } from '@/sim/types';
import { isVictoryQuest, questCargoId, questDefs } from '@/sim/victory';
import { openSaveDatabase, type QuestState } from '@/persist/save';
import { t } from '@/ui/strings';
import type { MenuHeaderInfo } from '@/ui/menu';
import type { ArcadeScorePayload } from '@/arcade/score';

// ---------------------------------------------------------------------------
// requestAnimationFrame stub: capture, never auto-run
// ---------------------------------------------------------------------------

type Raf = (nowMs: number) => void;
let rafCallback: Raf | null = null;
let rafHandleCounter = 0;

function installRafStub(): void {
  rafCallback = null;
  rafHandleCounter = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCallback = cb as Raf;
    return ++rafHandleCounter;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {
    rafCallback = null;
  }) as typeof window.cancelAnimationFrame;
}

/** Invokes whatever screen's frame callback is currently registered, advancing its internal clock by `deltaMs` (default 250ms — `frame()`'s own dt clamp in `@/app` is 0.25s, so this is the largest single step every screen already treats as one real tick). */
let simNowMs = 0;
function stepFrame(deltaMs = 250): void {
  simNowMs += deltaMs;
  const cb = rafCallback;
  if (cb === null) throw new Error('test: no frame callback registered — the screen has not started its render loop yet');
  cb(simNowMs);
}

/** Lets any pending microtasks (an in-flight `initRenderer()` promise chain, in particular) settle before the next synchronous step — real time, not `vi.useFakeTimers()`, since this is the one thing this file does NOT want to control down to the millisecond. */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function dispatchKey(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function dispatchKeyUp(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init }));
}

function requireOne(selector: string): Element {
  const found = document.querySelectorAll(selector);
  if (found.length !== 1) throw new Error(`test: expected exactly one "${selector}", found ${found.length}`);
  const el = found[0];
  if (el === undefined) throw new Error(`test: "${selector}" missing`);
  return el;
}

// ---------------------------------------------------------------------------
// Boot helper: real Title -> Driver Creation -> Constructor -> City, purely
// through dispatched DOM events (no internal screen function called
// directly — `showTitle`/`showDriverCreation`/`showConstructor`/`showCity`/
// `showRoad` are all module-private in `@/app`, by design; this is the only
// way in).
// ---------------------------------------------------------------------------

const TEST_SEED = 'screens-test-seed-1';

async function bootToCity(root: HTMLElement): Promise<void> {
  const { boot } = await import('@/app');

  installRafStub();
  simNowMs = 0;

  const bootPromise = boot(root, {
    search: '',
    randomSeed: () => TEST_SEED,
    openDb: () => Promise.reject(new Error('test: no save database — always start a fresh session')),
  });
  await bootPromise;

  // --- Title: digit '1' activates the first eligible action. With no save
  // to resume (openDb always rejects above), that's 'new-driver'. ---
  const titleMenu = requireOne('.sm-menu');
  dispatchKey(titleMenu, { key: '1' });

  // --- Driver creation: the form's own defaults (name "Driver", an even
  // skill split summing to exactly `startingSkillPool`) are already legal —
  // `tests/integration/boot.test.ts`'s own `confirmDefaultBuild`/driver
  // fixtures prove the same "shipped defaults are legal" invariant this
  // relies on. Just submit. ---
  const submit = requireOne('.sm-screen--driver button');
  submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  // --- Constructor: default builder state (first body/chassis/suspension/
  // plant/tire, no weapons, no armor) is legal EXCEPT its name, which
  // starts empty (`@/ui/builder`'s own `computeViolations`: `NAME_EMPTY`)
  // — type one onto the selected (default-selected, index 0) Name row,
  // same as a player typing character keys, then move down to the
  // 'confirm' row (`ArrowDown`, clamped at the last row so a generous,
  // deliberately-overshooting count of presses is safe regardless of
  // exactly how many rows this build has) and press Enter, exactly what a
  // player's Enter key does there. ---
  const constructorScreen = requireOne('.sm-screen--constructor');
  for (const ch of 'TestRig') dispatchKey(constructorScreen, { key: ch });
  for (let i = 0; i < 40; i++) dispatchKey(constructorScreen, { key: 'ArrowDown' });
  dispatchKey(constructorScreen, { key: 'Enter' });

  // showCity's own initRenderer() (WebGPU probe, always unavailable under
  // happy-dom -> falls back to text status) resolves on a microtask before
  // its `.finally()` registers the first requestAnimationFrame callback.
  await flushMicrotasks();
  await flushMicrotasks();

  requireOne('.sm-screen--city');
}

describe('DOM screens: the two fixed hotkeys a removed `if` cannot fake passing', () => {
  let root: HTMLElement;
  let originalRaf: typeof window.requestAnimationFrame;
  let originalCancelRaf: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 'F' opens the fleet screen
  // -------------------------------------------------------------------------

  it('pressing "f" on the city screen opens the fleet screen', async () => {
    await bootToCity(root);

    expect(document.querySelector('.sm-screen--fleet')).toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));

    expect(document.querySelector('.sm-screen--fleet')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // A key with no binding does nothing
  // -------------------------------------------------------------------------

  it('a key with no binding at all does nothing on the city screen', async () => {
    await bootToCity(root);

    // 'p'/KeyP is not `driveUp/Down/Left/Right`, not `fire`, not a weapon
    // digit, and not 'f'/'g' — no binding anywhere in `rulesets/classic/
    // controls.json` or `@/app`'s own fixed hotkeys reads it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }));

    expect(document.querySelector('.sm-screen--fleet')).toBeNull();
    expect(document.querySelector('.sm-screen--city')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // 'X' attempts a wreck search on the road screen
  // -------------------------------------------------------------------------

  it('pressing "x" on the road screen attempts a wreck search', async () => {
    await bootToCity(root);

    // --- Walk the on-foot player through the real gate trigger: the
    // player spawns exactly ON the gate (`showCity`'s own
    // `layout.gate.position`), so the FIRST step must walk away from it
    // (edge-triggered — starting inside the interaction radius never
    // fires) before walking back triggers it. "Away" is picked as the
    // real `@/app`'s own `cityDirectionFromVector` would classify the
    // vector pointing from the gate toward the map centre, so the walk
    // never runs into `stepWalk`'s `clampToCityWalls` (moving toward the
    // centre only ever shrinks the distance from it, never re-triggers a
    // wall clamp) — the return leg then retraces the exact same line back
    // outward, at the exact same speed, and is guaranteed to cross back
    // within the gate's interaction radius while heading toward it. ---
    const cityId = skillsConfig().startingLocation;
    const layout = generateCityLayout(cityId, TEST_SEED);
    const gate = layout.gate.position;

    const inwardKeys: KeyboardEventInit[] = [];
    if (-gate.x > 0) inwardKeys.push({ key: 'd', code: 'KeyD' });
    else if (-gate.x < 0) inwardKeys.push({ key: 'a', code: 'KeyA' });
    if (gate.y > 0) inwardKeys.push({ key: 'w', code: 'KeyW' });
    else if (gate.y < 0) inwardKeys.push({ key: 's', code: 'KeyS' });
    expect(inwardKeys.length).toBeGreaterThan(0);

    const outwardKeys: KeyboardEventInit[] = inwardKeys.map((k) => {
      if (k.code === 'KeyD') return { key: 'a', code: 'KeyA' };
      if (k.code === 'KeyA') return { key: 'd', code: 'KeyD' };
      if (k.code === 'KeyW') return { key: 's', code: 'KeyS' };
      return { key: 'w', code: 'KeyW' };
    });

    const STEPS_PER_LEG = 15;

    for (const k of inwardKeys) window.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
    for (let i = 0; i < STEPS_PER_LEG; i++) stepFrame();
    for (const k of inwardKeys) dispatchKeyUp(window, k);

    // Still walking (no gate/facility trigger from moving inward, away
    // from every trigger circle on the ring).
    expect(document.querySelector('.sm-menu')).toBeNull();

    for (const k of outwardKeys) window.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
    for (let i = 0; i < STEPS_PER_LEG; i++) stepFrame();
    for (const k of outwardKeys) dispatchKeyUp(window, k);

    // The gate trigger fired: `openGatePrompt()` paused the city loop and
    // mounted a real route-choice menu.
    const routeMenu = requireOne('.sm-menu');
    dispatchKey(routeMenu, { key: '1' });

    // showRoad's own initRenderer() microtask, same as showCity's.
    await flushMicrotasks();
    await flushMicrotasks();

    requireOne('.sm-screen--road');

    // `trySearchWreck()`'s `nearbySearchableWreck()` unconditionally calls
    // `wreckSearchRangeM()` (-> `drivingConfig()`) before it ever looks at
    // whether a wreck is actually in range — the one call on this path
    // that happens regardless of whether `trip.wrecks` is empty (a fresh
    // trip's always is; reaching an actual defeated-opponent wreck is a
    // full combat encounter, out of scope for "the key reaches the
    // handler"). No frame is stepped between the spy reset and the
    // dispatch below, so this is the ONLY thing that can produce a call:
    // remove the `if (ev.key === 'x' ...)` line and this spy count stays
    // at zero.
    const rulesets = await import('@/data/rulesets');
    const drivingConfigSpy = vi.spyOn(rulesets, 'drivingConfig');
    drivingConfigSpy.mockClear();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true }));

    expect(drivingConfigSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 'J' opens the journal screen — the one screen two previously-shipped
// features (rumours/clue investigation and the marked-driver banner) sat
// behind with no reachable way in: a unit test on `@/ui/journal` proves the
// pure core works, but only a real key reaching a real screen proves a
// player can ever SEE it.
// ---------------------------------------------------------------------------

describe('DOM screens: "j" opens the journal screen', () => {
  let root: HTMLElement;
  let originalRaf: typeof window.requestAnimationFrame;
  let originalCancelRaf: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    vi.restoreAllMocks();
  });

  it('pressing "j" on the city screen opens the journal, showing the empty-state rows, and Escape closes it back to the city', async () => {
    await bootToCity(root);

    expect(document.querySelector('.sm-menu')).toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true }));

    const menu = requireOne('.sm-menu');
    const labels = Array.from(menu.querySelectorAll('.sm-menu__label')).map((el) => el.textContent);

    // A fresh driver has no accepted courier work and no discovered
    // campaign leads yet — the journal's own real "nothing here" rows
    // (never a hand-built fixture; this is `boot()`'s real starting state).
    expect(labels).toContain(t('journal.courier.none'));
    expect(labels).toContain(t('journal.quest.none'));
    expect(labels).toContain(t('journal.leave'));
    // Nothing has marked this driver yet.
    expect(labels).not.toContain(t('journal.quest.marked'));

    // Escape is the menu's own back-out key (`mountBuildingPanel`'s
    // `onBack`) — same as every other panel this app mounts.
    dispatchKey(menu, { key: 'Escape' });

    expect(document.querySelector('.sm-menu')).toBeNull();
    requireOne('.sm-screen--city');
  });
});

// ---------------------------------------------------------------------------
// Victory -> Continue: the one thing `openFacility`'s victory branch
// (`@/app`) has to get right that nothing else checks afterward — the
// "Continue" callback it hands `showVictory` has to hand `runState` straight
// to `showCity` UNCHANGED. `@/sim/victory`'s own module doc is explicit that
// `deliverQuest` never touches anything but the driver's cash/prestige, the
// vehicle's cargo and the one delivered `QuestState` row — the fleet, the
// save, the rest of the quest ledger are the CALLER's to keep intact, and
// nothing re-verifies that after the fact. A `runState` swapped for a wiped
// one right there still type-checks and still passes every OTHER test in
// this suite, which is exactly how a `showTitle`-and-wipe replacement for
// `() => showCity(root, runState)` could ship.
//
// This used to be "NOT ADDED" here: reaching `the-boss-tape` (the campaign's
// one `onDeliver.victory: true` quest) from `boot()`'s only entry point
// meant grinding prestige to its gate and a real cross-city road trip to
// Watertown, for a question that doesn't depend on which quest triggered
// `showVictory` at all. That blocker is gone — `resumeSession` (`@/app`) now
// rebuilds a real, playable `CityRunState` (campaign `quests` included) from
// a save whose `world` is `null`, via `cityRunStateFromSaveGame`. So this
// writes a real `SaveGame` through `persistArenaSession` (`@/app`'s own real
// save writer, itself backed by `@/persist/save`'s real two-phase-commit
// `save()` — never a hand-stuffed IndexedDB record) that already has the
// victory quest fully clued (`stage: clueChain.length`, `completed: false`,
// its own cargo already loaded under `questCargoId`) and prestige at its
// gate, boots the REAL app against that save, presses "Continue" on the
// real Title screen, and walks the on-foot player into the victory quest's
// own real destination facility — no grind, no road trip.
// ---------------------------------------------------------------------------

describe('DOM screens: winning the campaign and pressing "Continue" keeps the sandbox intact', () => {
  let root: HTMLElement;
  let originalRaf: typeof window.requestAnimationFrame;
  let originalCancelRaf: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    vi.restoreAllMocks();
  });

  // --- Fixtures: same conventions tests/integration/campaign.test.ts uses
  // for its own (non-DOM) the-boss-tape lifecycle suite. ---

  function evenSkillSplit(): Record<SkillName, number> {
    const cfg = skillsConfig();
    const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
    const remainder = cfg.startingSkillPool - base * cfg.skills.length;
    const skills = {} as Record<SkillName, number>;
    cfg.skills.forEach((name, index) => {
      skills[name] = base + (index === cfg.skills.length - 1 ? remainder : 0);
    });
    return skills;
  }

  /** `"facility:cityId"` -> `{ facility, cityId }` — quests.json's own clueChain shape (mirrors `@/ui/journal`'s private `parseClueHop`/`campaign.test.ts`'s own `parseHop`), duplicated here only for test setup, never game logic. */
  function parseHop(raw: string): { readonly facility: string; readonly cityId: string } {
    const sep = raw.indexOf(':');
    return { facility: raw.slice(0, sep), cityId: raw.slice(sep + 1) };
  }

  const TEST_DESIGN: VehicleDesign = {
    name: 'Victory Continue Rig',
    bodyId: 'subcompact',
    chassisId: 'standard',
    suspensionId: 'light',
    plantId: 'small',
    tireId: 'standard',
    armor: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
    weapons: [],
  };

  // --- Homing walk: recomputes which WASD keys to hold every real
  // `stepFrame()` tick from a LOCAL position mirror (identical arithmetic to
  // `@/sim/city`'s own `stepWalk`: the same `drivingConfig().pedestrian.
  // speedMps`, the same 250ms-per-tick default, the same diagonal unit
  // vectors), rather than a single fixed compass direction held for a fixed
  // step count (this file's own gate-trigger test can get away with that
  // only because its target — the gate — sits exactly back where the walk
  // started). A seeded ring's doorway sits at an arbitrary angle, and a
  // fixed direction drifts wide of it over any real distance; recomputing
  // every tick keeps this converging on the real target regardless of that
  // angle. ---
  function keysTowards(dx: number, dy: number): KeyboardEventInit[] {
    const keys: KeyboardEventInit[] = [];
    if (dx > 0) keys.push({ key: 'd', code: 'KeyD' });
    else if (dx < 0) keys.push({ key: 'a', code: 'KeyA' });
    if (dy > 0) keys.push({ key: 's', code: 'KeyS' });
    else if (dy < 0) keys.push({ key: 'w', code: 'KeyW' });
    return keys;
  }

  function homeTowards(from: Vec2, to: Vec2, maxSteps: number, stopWhen: (pos: Vec2) => boolean): Vec2 {
    const stepDist = drivingConfig().pedestrian.speedMps * 0.25; // stepFrame()'s own default deltaMs
    let pos: Vec2 = { ...from };
    for (let i = 0; i < maxSteps; i++) {
      const keys = keysTowards(to.x - pos.x, to.y - pos.y);
      if (keys.length === 0) return pos; // exactly on target — nothing left to press
      for (const k of keys) window.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
      stepFrame();
      for (const k of keys) dispatchKeyUp(window, k);
      const ux = keys.some((k) => k.code === 'KeyD') ? 1 : keys.some((k) => k.code === 'KeyA') ? -1 : 0;
      const uy = keys.some((k) => k.code === 'KeyS') ? 1 : keys.some((k) => k.code === 'KeyW') ? -1 : 0;
      const norm = ux !== 0 && uy !== 0 ? Math.SQRT1_2 : 1;
      pos = { x: pos.x + ux * norm * stepDist, y: pos.y + uy * norm * stepDist };
      if (stopWhen(pos)) return pos;
    }
    throw new Error('test: homeTowards exceeded maxSteps without reaching its stop condition');
  }

  /**
   * Walks the on-foot player (always spawned at `layout.gate.position` —
   * `showCity`'s own contract) to `doorwayPosition`, via the plaza CENTRE
   * first rather than a direct line: `generateCityLayout`'s own doc comment
   * guarantees every doorway/gate sits at least `interactionRadiusM * 2`
   * apart from its ring neighbors, and every doorway sits the SAME distance
   * (the ring radius) from the centre at its own unique angle — so a
   * straight radius line from the centre to one doorway never comes within
   * `interactionRadiusM` of any OTHER doorway, while a direct gate-to-
   * doorway chord could. Stops leg 2 the instant a real `.sm-menu` mounts —
   * a facility panel, or, for the victory quest's own destination, the
   * victory screen itself (which never opens a facility panel first, see
   * `openFacility`).
   */
  function walkToFacility(layout: CityLayout, doorwayPosition: Vec2): void {
    const stepDist = drivingConfig().pedestrian.speedMps * 0.25;
    const maxSteps = Math.ceil((layout.boundsRadiusM * 2) / stepDist) + 100;

    const nearCentre = homeTowards(layout.gate.position, { x: 0, y: 0 }, maxSteps, (pos) => Math.hypot(pos.x, pos.y) <= 2);
    if (document.querySelector('.sm-menu') !== null) {
      throw new Error('test: an unexpected menu opened while walking toward the plaza centre — check the layout geometry assumptions');
    }
    homeTowards(nearCentre, doorwayPosition, maxSteps, () => document.querySelector('.sm-menu') !== null);
  }

  it('delivering the-boss-tape and pressing "Continue" preserves cash, prestige, the quest ledger and the fleet', async () => {
    const victoryQuest = questDefs().find(isVictoryQuest);
    if (victoryQuest === undefined) throw new Error('test fixture: quests.json defines no onDeliver.victory quest');

    // A second, unrelated quest sharing the victory quest's own destination
    // city, whose first clue hop sits at an always-open facility — reused
    // below as a prestige probe: `@/ui/journal`'s `questCluesAvailableHere`
    // gates its "investigate" row purely on `driver.prestige >= def.gate`,
    // completely independent of the victory quest's own save-state, so its
    // presence (or absence) after "Continue" proves prestige specifically
    // survived, not just conflates it with the quest-ledger check below.
    const alwaysOpen = economy().alwaysOpenFacilities;
    const prestigeProbeQuest = questDefs().find((q) => {
      if (q.id === victoryQuest.id) return false;
      const hop = parseHop(q.clueChain[0]!);
      return hop.cityId === victoryQuest.destination.cityId && alwaysOpen.includes(hop.facility);
    });
    if (prestigeProbeQuest === undefined) {
      throw new Error('test fixture: no other always-open-facility quest shares the victory quest\'s destination city to probe prestige with');
    }
    const probeHop = parseHop(prestigeProbeQuest.clueChain[0]!);

    const driverResult = createDriver('ContinueTest', evenSkillSplit());
    if (!driverResult.ok) throw new Error(`test fixture: expected a legal skill split, got "${driverResult.reason}"`);

    const TEST_CASH = 246_000;
    const TEST_PRESTIGE = victoryQuest.gate + 5;
    // The real `onAccept.setFlag` effect (`@/ui/journal`'s `revealNextHop`)
    // a genuine accept would already have folded into `flags` before this
    // save point — set generically off the quest's own data, never the
    // literal flag name, same as `campaign.test.ts`'s own hand-built
    // pre-delivery `QuestState` fixtures do for the identical reason.
    const acceptFlags: Record<string, boolean> =
      victoryQuest.onAccept?.setFlag !== undefined ? { [victoryQuest.onAccept.setFlag]: true } : {};

    const driver: DriverState = {
      ...driverResult.driver,
      cash: TEST_CASH,
      prestige: TEST_PRESTIGE,
      cityId: victoryQuest.destination.cityId,
    };

    const cargoId = questCargoId(victoryQuest.id);
    const vehicle: VehicleState = {
      ...vehicleStateFromDesign(TEST_DESIGN, 'veh-continue-test-1', PLAYER_ID),
      cargo: [
        {
          id: cargoId,
          kind: 'payload',
          weightLb: victoryQuest.cargo.weightLb,
          spaces: victoryQuest.cargo.spaces,
          integrity: economy()._reconstruction.cargoFullIntegrity,
        },
      ],
    };

    const quests: readonly QuestState[] = [
      { id: victoryQuest.id, stage: victoryQuest.clueChain.length, completed: false, flags: acceptFlags },
    ];

    const openDb = () => openSaveDatabase();
    await persistArenaSession({
      openDb,
      driver,
      vehicle,
      clock: initialClock(),
      location: victoryQuest.destination.cityId,
      quests,
      sessionSeed: 'screens-victory-continue-seed',
      world: null, // safely in a city — exactly `showArenaEvent`'s/`openFacility`'s own autosave shape
    });

    installRafStub();
    simNowMs = 0;
    const { boot } = await import('@/app');
    await boot(root, {
      search: '',
      randomSeed: () => 'unused-fresh-session-seed', // a real save exists — resumeSession never touches this
      openDb,
    });

    // --- Title: a real save exists, so "Continue" is offered. Enter
    // activates the menu's own default selection — the first ELIGIBLE
    // action — rather than a hardcoded digit: every Title row is eligible,
    // and "continue" is unshifted to the front whenever `onContinue` exists
    // (`@/app`'s own `showTitle`), so this is "continue" regardless of how
    // many rows precede/follow it. ---
    const titleMenu = requireOne('.sm-menu');
    dispatchKey(titleMenu, { key: 'Enter' });

    // showCity's own initRenderer() microtask, same as bootToCity's.
    await flushMicrotasks();
    await flushMicrotasks();
    requireOne('.sm-screen--city');

    const sessionSeed = currentSessionSeed();
    if (sessionSeed === null) throw new Error('test fixture: expected a resolved session seed after resuming');
    let layout = generateCityLayout(victoryQuest.destination.cityId, sessionSeed);
    const victoryDoorway = layout.doorways.find((d) => d.facilityKind === victoryQuest.destination.facility);
    if (victoryDoorway === undefined) {
      throw new Error(`test fixture: "${victoryQuest.destination.cityId}" has no "${victoryQuest.destination.facility}" doorway`);
    }

    walkToFacility(layout, victoryDoorway.position);

    // The walk landed on the real victory screen — real `attemptQuestDelivery`
    // (`@/app`), real `deliverQuest` (`@/sim/victory`), never called directly.
    requireOne('.sm-screen--victory');
    expect(document.querySelector('.sm-screen--city')).toBeNull();

    const victoryMenu = requireOne('.sm-menu');
    dispatchKey(victoryMenu, { key: 'Enter' }); // "Continue" — the menu's only eligible row

    // --- THE MUTATION-PROOF ASSERTIONS. Every one of these reads real,
    // rendered DOM off the real screen "Continue" landed on — never
    // `runState` (private to `@/app`'s closures) read back out by hand. ---

    requireOne('.sm-screen--city');
    expect(document.querySelector('.sm-screen--victory')).toBeNull();

    // showCity's own initRenderer() microtask fires again on every fresh call.
    await flushMicrotasks();
    await flushMicrotasks();

    // Cash: `deliverQuest`'s own real payout (never re-derived here) on top
    // of what this save started with — proves `driver.cash` is neither 0
    // nor merely unpaid, but the exact real post-delivery figure.
    const expectedCash = TEST_CASH + victoryQuest.pay;
    expect(requireOne('.sm-screen--city').textContent).toContain(`$${expectedCash}`);

    // Quest ledger: the completed victory quest (and, generically, its real
    // onAccept flag) still on file — `journal.quest.none` would be a false
    // negative here (it only reports the ACTIVE list, and a completed quest
    // was never active), so this checks the COMPLETED row by name instead.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true }));
    const journalMenu = requireOne('.sm-menu');
    const journalLabels = Array.from(journalMenu.querySelectorAll('.sm-menu__label')).map((el) => el.textContent);
    expect(journalLabels).toContain(t('journal.quest.completed', { title: victoryQuest.title }));
    if (victoryQuest.onAccept?.setFlag !== undefined) {
      expect(journalLabels).toContain(t('journal.quest.marked'));
    }
    dispatchKey(journalMenu, { key: 'Escape' });
    requireOne('.sm-screen--city');

    // Fleet: the active vehicle is still a real, listed fleet entry — not
    // an empty roster. Exiting Fleet always calls `showCity` fresh (see
    // `@/app`'s own `showFleet`/`openFleetScreen`), so the player is back
    // at the gate and needs its `initRenderer()` microtask flushed again.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
    const fleetMenu = requireOne('.sm-menu');
    const fleetLabels = Array.from(fleetMenu.querySelectorAll('.sm-menu__label')).map((el) => el.textContent);
    expect(fleetLabels).toContain(t('ui.fleet.rowActive', { name: TEST_DESIGN.name }));
    dispatchKey(fleetMenu, { key: 'Escape' });

    await flushMicrotasks();
    await flushMicrotasks();
    requireOne('.sm-screen--city');

    // Prestige: a real, unrelated quest's real "investigate" row, gated
    // purely on `driver.prestige >= def.gate` — reached the same way a
    // player would, by walking into its own real clue-chain facility, never
    // by reading `driver.prestige` back out of anything private.
    layout = generateCityLayout(victoryQuest.destination.cityId, sessionSeed);
    const probeDoorway = layout.doorways.find((d) => d.facilityKind === probeHop.facility);
    if (probeDoorway === undefined) {
      throw new Error(`test fixture: "${probeHop.cityId}" has no "${probeHop.facility}" doorway`);
    }
    walkToFacility(layout, probeDoorway.position);

    const probeMenu = requireOne('.sm-menu');
    const probeLabels = Array.from(probeMenu.querySelectorAll('.sm-menu__label')).map((el) => el.textContent);
    expect(probeLabels.some((label) => label !== null && label.includes(prestigeProbeQuest.title))).toBe(true);
    dispatchKey(probeMenu, { key: 'Escape' });
  });
});

// ---------------------------------------------------------------------------
// Arcade score submit screen
//
// Reaching this screen through a REAL qualifying victory means beating a
// real AI roster in real combat — exactly what `tests/integration/
// arena-victory.test.ts` drives headlessly, at the exported-system level,
// because there is no reasonable way to fight that fight through dispatched
// `KeyboardEvent`s (this file has never driven the arena at all, for the
// same reason). `@/app` exports `showArcadeScoreSubmit` as a narrow mount
// seam (the same convention as its existing `persistArenaSession`/
// `vehicleStateFromDesign`/`PLAYER_ID` test exports) so this suite can mount
// the REAL screen with a real `DriverState`-derived name and a real
// `ArcadeScorePayload`, and exercise its actual rendering and decline
// behavior. The gate that gets the player to this screen in the first place
// (`arcadeScoringEnabled(...) && shouldSubmitArcadeScore(...)`) is proven
// separately, at the unit level, in tests/unit/arcade-score.test.ts and
// tests/unit/arcade-client.test.ts — this test does not re-prove the
// wiring, only the screen those two predicates gate.
// ---------------------------------------------------------------------------

describe('DOM screens: the arcade score submit screen', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.unstubAllGlobals();
  });

  it("shows the run's real numbers and the driver's name, and declining continues with no score-API call ever issued", () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        calledUrls.push(String(input));
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );

    const payload: ArcadeScorePayload = { score: 1500, wave: 3, kills: 3, headshots: 1, duration: 60 };
    const header: MenuHeaderInfo = { cash: 5_000, dayIndex: 12, phase: 'MORNING' as DayPhase, cityName: 'Watertown' };
    let continued = false;

    showArcadeScoreSubmit(root, header, 'Test Driver', payload, () => {
      continued = true;
    });

    requireOne('.sm-screen--arcade-submit');
    const menu = requireOne('.sm-menu');
    const labels = Array.from(menu.querySelectorAll('.sm-menu__label')).map((el) => el.textContent);
    expect(labels).toContain(t('ui.arena.scoreSubmit.score', { score: payload.score }));
    expect(labels).toContain(t('ui.arena.scoreSubmit.wave', { wave: payload.wave }));
    expect(labels).toContain(t('ui.arena.scoreSubmit.kills', { kills: payload.kills }));
    expect(labels).toContain(t('ui.arena.scoreSubmit.headshots', { headshots: payload.headshots }));
    expect(labels).toContain(t('ui.arena.scoreSubmit.duration', { duration: payload.duration }));

    // Name field: a SIBLING of the menu (never inside it), defaulted to the
    // driver's name, and editable — proving it survives the menu's own
    // setActions()-triggered re-renders is what makes the sibling placement
    // matter, not just that it starts with the right value.
    const nameInput = requireOne('.sm-screen--arcade-submit input') as HTMLInputElement;
    expect(nameInput.value).toBe('Test Driver');
    expect(menu.contains(nameInput)).toBe(false);
    nameInput.value = 'Edited Name';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(nameInput.value).toBe('Edited Name');

    // Decline: same "Escape backs out" convention every other menu in this
    // file uses (`onBack`) — runs the SAME continuation a real accepted/
    // failed submit would, and never touches the score API.
    dispatchKey(menu, { key: 'Escape' });

    expect(continued).toBe(true);
    expect(calledUrls.some((url) => url.includes('/api/games/smduel/'))).toBe(false);
  });

  it('submitting sends the name the player actually typed, and the sibling input survives the menu re-render that submitting triggers', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown, init: unknown) => {
        const url = String(input);
        bodies.push(String((init as { body?: unknown } | undefined)?.body ?? ''));
        const payload = url.endsWith('/runs') ? { runToken: 'run-token-from-request-1' } : { accepted: true, rank: 7 };
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      }),
    );

    const payload: ArcadeScorePayload = { score: 7050, wave: 8, kills: 8, headshots: 3, duration: 200 };
    const header: MenuHeaderInfo = { cash: 9_500, dayIndex: 30, phase: 'MORNING' as DayPhase, cityName: 'Watertown' };

    showArcadeScoreSubmit(root, header, 'Default Name', payload, () => {});

    const nameInput = requireOne('.sm-screen--arcade-submit input') as HTMLInputElement;
    nameInput.value = 'Typed By Player';

    dispatchKey(requireOne('.sm-menu'), { key: 'Enter' });
    await flushMicrotasks();
    await flushMicrotasks();

    // The name that reached the scores request is the EDITED one. A screen
    // that read `driverName` instead of the live input would send
    // "Default Name" here and this is the only assertion that catches it.
    const scoresBody = JSON.parse(bodies[1] ?? '{}') as { name?: string; runToken?: string; score?: number };
    expect(scoresBody.name).toBe('Typed By Player');
    expect(scoresBody.runToken).toBe('run-token-from-request-1');
    expect(scoresBody.score).toBe(payload.score);

    // Submitting calls `setActions`, which makes `mountMenu` clear and rebuild
    // its container. The input is a sibling, so it is still in the document
    // with the typed value intact — nesting it inside `menuHost` would have
    // destroyed it at exactly this point.
    const afterRender = requireOne('.sm-screen--arcade-submit input') as HTMLInputElement;
    expect(afterRender.value).toBe('Typed By Player');

    const labels = Array.from(requireOne('.sm-menu').querySelectorAll('.sm-menu__label')).map((el) => el.textContent);
    expect(labels).toContain(t('ui.arena.scoreSubmit.statusAccepted', { rank: 7 }));
  });
});
