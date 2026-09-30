#!/usr/bin/env node
/**
 * End-to-end capture: plays the WHOLE game and photographs every screen.
 *
 * ## Why this exists separately from `shoot.mjs`
 *
 * `shoot.mjs` boots `?screen=<name>` for eight screens. That is a still-frame
 * sampler, not a playthrough: it never creates a driver, never walks into a
 * building, never drives, and never fights. A reviewer shown those frames is
 * reviewing a set of screens, and the 150-round log is a record of what a
 * reviewer does with a set of screens — it reported the radar as "missing" and
 * the constructor schematic as "missing" dozens of times each, both present at
 * full resolution, because it was reasoning about isolated frames rather than
 * about a game.
 *
 * So this walks the real thing: title -> driver -> constructor -> city -> every
 * one of the ten facilities -> fleet -> journal -> controls -> the road -> an
 * actual arena match, in one continuous session, capturing as it goes. Every
 * frame is a state the game genuinely reached by playing.
 *
 * ## What it asserts
 *
 * Nothing about how the game *looks* — that is the reviewer's job, and a harness
 * with opinions about aesthetics is how a review turns into an echo. What it
 * asserts is that each expected screen was actually REACHED, so a review can
 * never be a review of a screen the game failed to show.
 *
 * usage:
 *   node tools/shoot-e2e.mjs --out .shots/e2e
 *   node tools/shoot-e2e.mjs --out .shots/e2e --headed
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { walkIntoFacility, walkThroughGateToRoad, cityWalkContext } from './lib/walk-city.mjs';

/** Fixed seed: the city layout, spawns and props must be identical every run. */
const SEED = 'a11ce5eed5eed5eed5eed5ee';

/**
 * 1280x800 at DPR 2 = 2560x1600 frames.
 *
 * The 150-round log raised capture width from 900px to 1280px specifically to
 * stop vision models reporting present elements as missing, and that change
 * reduced the false-finding class without removing it. 1280 is the measured
 * floor; going wider costs tokens on every frame and bought nothing further.
 */
const VIEW = { width: 1280, height: 800 };
const DPR = 2;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined) throw new Error(`shoot-e2e: --${name} needs a value`);
  return v;
}

/** Every facility kind the city actually has, read from the ruleset — not a hand-typed list. */
const ctx = cityWalkContext(SEED);
const FACILITIES = ctx.layout.doorways.map((d) => d.facilityKind);


/**
 * Builds a car that is ACTUALLY road-legal, and proves it before returning.
 *
 * ## Why this exists rather than a fixed click sequence
 *
 * The first version of this harness fitted five armour points on two facings,
 * pressed Enter on "Weapon 1", and labelled the screenshot "a weapon mounted".
 * Three things were wrong with that and only the last was visible:
 *
 * 1. **Enter does not mount a weapon.** The builder's row-click selects and the
 *    `.sm-builder__row-cycle--inc` control cycles the weapon choice; Enter on a
 *    row is not the mount path. The car came out with an empty slot 1.
 * 2. **The build was over budget.** 10 armour points plus a Machine Gun costs
 *    $2050 against a $2000 budget, so the legality panel refused it — and the
 *    harness never read that panel, because it had already decided what the
 *    screenshot showed.
 * 3. **The label was a claim, not a measurement.** Every later stage then
 *    failed at the gate with "not road-legal — a weapon", four steps downstream
 *    of the mistake and pointing at the wrong cause entirely.
 *
 * So the build is now DERIVED and then VERIFIED: mount a weapon, add armour one
 * point at a time while the legality panel reports no budget violation, and read
 * the panel back at the end. If anything is still wrong this throws, rather than
 * captioning a frame with a claim nobody checked.
 */
async function buildLegalCar(page, label = 'VANGUARD') {
  await page.fill('.sm-builder__row-input', label);

  const mountWeapon = () =>
    page.evaluate(() => {
      const li = [...document.querySelectorAll('.sm-builder__row')].find(
        (x) => x.querySelector('.sm-builder__row-label')?.textContent === 'Weapon 1',
      );
      const inc = li?.querySelector('.sm-builder__row-cycle--inc');
      if (inc === undefined || inc === null) return false;
      inc.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    });
  if (!(await mountWeapon())) throw new Error('e2e: no increment control on "Weapon 1"');

  const addArmour = (facing) =>
    page.evaluate((l) => {
      const li = [...document.querySelectorAll('.sm-builder__row')].find(
        (x) => x.querySelector('.sm-builder__row-label')?.textContent === l,
      );
      const inc = li?.querySelector('.sm-builder__row-cycle--inc');
      if (inc === undefined || inc === null) return false;
      inc.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    }, facing);

  const legality = () =>
    page.evaluate(() => (document.querySelector('.sm-builder__legality')?.textContent ?? '').replace(/\s+/g, ' ').trim());

  // ONE point at a time, checked after each, and ROLLED BACK if it tips the
  // build over budget. The previous version added a whole round of four points
  // and only looked at the panel on the next round, so it overshot by up to
  // four points and then reported "$2028, only $2000" — the assertion firing
  // correctly on a build the harness had been careless about.
  const facings = ['Armor: Front', 'Armor: Rear', 'Armor: Left', 'Armor: Right'];
  const adjust = (facing, dir) =>
    page.evaluate(
      ([l, d]) => {
        const li = [...document.querySelectorAll('.sm-builder__row')].find(
          (x) => x.querySelector('.sm-builder__row-label')?.textContent === l,
        );
        const btn = li?.querySelector(d === 1 ? '.sm-builder__row-cycle--inc' : '.sm-builder__row-cycle--dec');
        if (btn === undefined || btn === null) return false;
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      },
      [facing, dir],
    );

  const OVER_BUDGET = /only \$\d+ available|over budget/i;
  let added = 0;
  let lastGood = '';
  for (let n = 0; n < 20; n++) {
    const facing = facings[n % facings.length];
    if (!(await adjust(facing, 1))) break;
    const text = await legality();
    if (OVER_BUDGET.test(text)) {
      await adjust(facing, -1); // roll back the point that broke it
      break;
    }
    added += 1;
    lastGood = text;
  }
  void lastGood;

  const finalLegality = await legality();
  const mounted = await page.evaluate(() => {
    const li = [...document.querySelectorAll('.sm-builder__row')].find(
      (x) => x.querySelector('.sm-builder__row-label')?.textContent === 'Weapon 1',
    );
    return li?.querySelector('.sm-builder__row-value')?.textContent ?? '';
  });
  if (/only \$\d+ available/i.test(finalLegality)) {
    throw new Error(`e2e: the build is still over budget after ${added} armour point(s): ${finalLegality}`);
  }
  if (mounted.trim() === '(empty)') {
    throw new Error(`e2e: weapon slot 1 is still empty; legality says: ${finalLegality}`);
  }
  return { added, mounted, legality: finalLegality };
}

/** Reads the constructor's legality panel. Used to caption a frame with a FACT. */
function legalityOf(page) {
  return page.evaluate(() => (document.querySelector('.sm-builder__legality')?.textContent ?? '').replace(/\s+/g, ' ').trim());
}

/**
 * Turns the key and waits for the starter to finish.
 *
 * The ignition DISABLES itself for the length of the crank — that is the whole
 * point of it, and it is also why a naive `click` fails here: a click issued
 * while the previous crank is still running waits for a button that is
 * legitimately disabled, and when validation fails the screen re-renders and
 * DETACHES the node Playwright was holding mid-click.
 *
 * So this waits for a button that is actually free, and clicks that.
 */
async function ignite(page) {
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.sm-ignition');
      return b !== null && !b.disabled;
    },
    { timeout: 15_000, polling: 50 },
  );
  await page.click('.sm-ignition');
}

async function main() {
  const outDir = resolve(arg('out', '.shots/e2e'));
  await mkdir(outDir, { recursive: true });
  const headed = process.argv.includes('--headed');

  await build({ logLevel: 'warn' });
  const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'warn' });
  const baseUrl = server.resolvedUrls?.local?.[0];
  if (baseUrl === undefined) throw new Error('shoot-e2e: vite preview did not resolve a local URL');

  const browser = await chromium.launch({
    headless: !headed,
    args: ['--use-angle=metal', '--enable-unsafe-webgpu'],
  });

  /** name -> { file, note }. Insertion order is the order they were reached. */
  const shots = [];
  let failures = [];
  /** facilityKind -> its menu's rows, used below as a walk-identity check. */
  const facilityMenus = new Map();

  try {
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR });
    const page = await context.newPage();
    page.on('pageerror', (e) => failures.push(`pageerror: ${String(e).slice(0, 160)}`));

    const shoot = async (name, note) => {
      // Let the frame settle: a capture taken mid-transition is a capture of a
      // blur, and a reviewer handed a blur reports the blur.
      await page.waitForTimeout(320);
      const file = `${String(shots.length + 1).padStart(2, '0')}-${name}.png`;
      await page.screenshot({ path: resolve(outDir, file) });
      shots.push({ name, file, note, url: page.url() });
      console.log(`  ${String(shots.length).padStart(2)} ${name.padEnd(22)} ${note}`);
    };

    // --- 1. The boot tribute, mid-hold, before the splash hands over ---------
    await page.goto(`${baseUrl}?seed=${SEED}`, { waitUntil: 'commit' });
    await page.waitForSelector('.sm-boot__tribute', { timeout: 20_000 });
    await page.waitForTimeout(1300); // well inside the 2600ms hold
    await page.screenshot({ path: resolve(outDir, '01-boot-tribute.png') });
    shots.push({ name: 'boot-tribute', file: '01-boot-tribute.png', note: 'the Autoduel credit, alone on black', url: 'boot' });
    console.log('   1 boot-tribute          the Autoduel credit, alone on black');

    await page.waitForFunction(() => document.getElementById('sm-boot') === null, { timeout: 30_000, polling: 60 });
    await shoot('title', 'the title lockup and menu');

    // --- 2. Driver creation, at rest and mid-validation ----------------------
    await page.keyboard.press('1');
    await page.waitForSelector('.sm-screen--driver', { timeout: 15_000 });
    await shoot('driver-creation', 'the ignition switch and skill rows');

    // An empty name is a real reachable state and the error treatment is part of
    // the UI, so it gets photographed rather than assumed.
    await page.fill('.sm-screen--driver input[type="text"]', '');
    await ignite(page);
    await page.waitForTimeout(600); // let the crank finish so the error is settled
    await shoot('driver-error', 'validation state, error on the name field');

    await page.fill('.sm-screen--driver input[type="text"]', 'Vanguard');
    // The car starts: catch the crank, which is 420ms of real animation.
    await ignite(page);
    await page.waitForTimeout(220);
    await page.screenshot({ path: resolve(outDir, '03-ignition-crank.png') });
    shots.push({ name: 'ignition-crank', file: '03-ignition-crank.png', note: 'key turned, car running', url: 'driver' });
    console.log('   3 ignition-crank        key turned, car running');

    // --- 3. The constructor, pristine and built ------------------------------
    await page.waitForSelector('.sm-screen--constructor', { timeout: 15_000 });
    await shoot('constructor-empty', 'sections, zero armour, legality panel');

    // Fit armour on every facing and mount a weapon, through the real controls.
    const clickRow = (label) =>
      page.evaluate((l) => {
        const li = [...document.querySelectorAll('.sm-builder__row')].find(
          (x) => x.querySelector('.sm-builder__row-label')?.textContent === l,
        );
        if (li === undefined) return false;
        li.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }, label);
    const bump = (label, times) =>
      page.evaluate(
        ([l, n]) => {
          const li = [...document.querySelectorAll('.sm-builder__row')].find(
            (x) => x.querySelector('.sm-builder__row-label')?.textContent === l,
          );
          const inc = li?.querySelector('.sm-builder__row-cycle--inc');
          if (inc === undefined || inc === null) return 0;
          let done = 0;
          for (let i = 0; i < n; i++) {
            inc.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            done += 1;
          }
          return done;
        },
        [label, times],
      );

    const built = await buildLegalCar(page);
    // Captioned from the legality panel the game actually rendered, not from
    // what the harness intended — see `buildLegalCar`'s note on how the previous
    // caption came to be a lie.
    await shoot('constructor-built', `weapon: ${built.mounted}; ${built.added} armour points; legality: ${built.legality}`);

    // Confirm the build so the city is reachable with a real car.
    const confirmed = await page.evaluate(() => {
      const li = [...document.querySelectorAll('.sm-builder__row')].find(
        (x) => x.querySelector('.sm-builder__row-label')?.textContent === 'Confirm',
      );
      if (li === undefined) return false;
      li.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    });
    if (!confirmed) failures.push('no Confirm row on the constructor');
    await page.waitForSelector('.sm-screen--city', { timeout: 20_000 });
    await shoot('city', 'the city, on foot or in the car');

    // --- 4. Every facility in the city, by walking into it -------------------
    // A fresh page per facility: each visit is a genuine walk from the spawn, and
    // a facility menu is modal, so this is also the only order they can be seen in.
    for (const kind of FACILITIES) {
      const c2 = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR });
      const p2 = await c2.newPage();
      try {
        await p2.goto(`${baseUrl}?seed=${SEED}`, { waitUntil: 'load' });
        await p2.waitForFunction(() => document.getElementById('sm-boot') === null, { timeout: 30_000, polling: 60 });
        await p2.keyboard.press('1');
        await p2.waitForSelector('.sm-screen--driver', { timeout: 15_000 });
        await ignite(p2);
        await p2.waitForSelector('.sm-screen--constructor', { timeout: 15_000 });
        await buildLegalCar(p2);
        await p2.evaluate(() => {
          const li = [...document.querySelectorAll('.sm-builder__row')].find(
            (x) => x.querySelector('.sm-builder__row-label')?.textContent === 'Confirm',
          );
          li?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        await p2.waitForSelector('.sm-screen--city', { timeout: 20_000 });

        const rows = await walkIntoFacility(p2, kind, SEED);
        facilityMenus.set(kind, JSON.stringify(rows));
        // Identity: assert the menu we reached is plausibly the one we aimed at,
        // because a walk that lands next door produces a valid-looking frame of
        // the WRONG building, and that is exactly how a false finding gets made.
        await p2.waitForTimeout(280);
        const file = `${String(shots.length + 1).padStart(2, '0')}-facility-${kind}.png`;
        await p2.screenshot({ path: resolve(outDir, file) });
        shots.push({ name: `facility-${kind}`, file, note: `walked into ${kind}`, rows, url: p2.url() });
        console.log(`  ${String(shots.length).padStart(2)} facility-${kind.padEnd(14)} walked in; rows: ${JSON.stringify(rows).slice(0, 70)}`);
      } catch (err) {
        failures.push(`facility ${kind}: ${String(err).slice(0, 140)}`);
      } finally {
        await c2.close();
      }
    }

    // --- 5. The city overlays, from the live city session --------------------
    await page.keyboard.press('f'); // fleet
    await page.waitForSelector('.sm-screen--fleet .sm-menu', { timeout: 10_000 });
    await shoot('fleet', 'the fleet roster');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sm-screen--city', { timeout: 10_000 });

    // The journal is a building PANEL, not a screen: `openJournalScreen` calls
    // `openPanel()` + `mountBuildingPanel`, which mounts a `@/ui/menu` into the
    // overlay. There is no `.sm-screen--journal` — the first version of this
    // harness waited for one and timed out, having guessed a class name instead
    // of reading what `app.ts` actually builds.
    await page.keyboard.press('j'); // journal
    await page.waitForSelector('.sm-menu__item', { timeout: 10_000 });
    await shoot('journal', 'the quest journal');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sm-screen--city', { timeout: 10_000 });

    // --- 6. Controls, which is a screen of its own ---------------------------
    const c3 = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR });
    const p3 = await c3.newPage();
    await p3.goto(`${baseUrl}?seed=${SEED}`, { waitUntil: 'load' });
    await p3.waitForFunction(() => document.getElementById('sm-boot') === null, { timeout: 30_000, polling: 60 });
    await p3.keyboard.press('2'); // title row 1: Controls
    await p3.waitForSelector('.sm-screen--controls, .sm-menu', { timeout: 10_000 });
    await p3.waitForTimeout(280);
    await p3.screenshot({ path: resolve(outDir, `${String(shots.length + 1).padStart(2, '0')}-controls.png`) });
    shots.push({ name: 'controls', file: `${String(shots.length + 1).padStart(2, '0')}-controls.png`, note: 'the rebinding screen', url: p3.url() });
    console.log(`  ${String(shots.length).padStart(2)} controls              the rebinding screen`);
    await c3.close();

    // --- 7. The road, driven -----------------------------------------------
    const c4 = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR });
    const p4 = await c4.newPage();
    await p4.goto(`${baseUrl}?seed=${SEED}`, { waitUntil: 'load' });
    await p4.waitForFunction(() => document.getElementById('sm-boot') === null, { timeout: 30_000, polling: 60 });
    await p4.keyboard.press('1');
    await p4.waitForSelector('.sm-screen--driver', { timeout: 15_000 });
    await ignite(p4);
    await p4.waitForSelector('.sm-screen--constructor', { timeout: 15_000 });
    await buildLegalCar(p4);
    await p4.evaluate(() => {
      const li = [...document.querySelectorAll('.sm-builder__row')].find(
        (x) => x.querySelector('.sm-builder__row-label')?.textContent === 'Confirm',
      );
      li?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await p4.waitForSelector('.sm-screen--city', { timeout: 20_000 });
    await walkThroughGateToRoad(p4, SEED);
    await p4.waitForTimeout(300);
    await p4.screenshot({ path: resolve(outDir, `${String(shots.length + 1).padStart(2, '0')}-road.png`) });
    shots.push({ name: 'road', file: `${String(shots.length + 1).padStart(2, '0')}-road.png`, note: 'the road at the start of a trip', url: p4.url() });
    console.log(`  ${String(shots.length).padStart(2)} road                  the road at the start of a trip`);
    // Drive, so the HUD is showing motion rather than a parked odometer.
    await p4.keyboard.down('w');
    await p4.waitForTimeout(2600);
    await p4.screenshot({ path: resolve(outDir, `${String(shots.length + 1).padStart(2, '0')}-road-driving.png`) });
    shots.push({ name: 'road-driving', file: `${String(shots.length + 1).padStart(2, '0')}-road-driving.png`, note: 'driving, HUD live', url: p4.url() });
    console.log(`  ${String(shots.length).padStart(2)} road-driving          driving, HUD live`);
    await p4.keyboard.up('w');
    // The trip menu, which is a screen in its own right.
    await p4.keyboard.press('Escape');
    await p4.waitForTimeout(300);
    if (await p4.locator('.sm-menu').count()) {
      await p4.screenshot({ path: resolve(outDir, `${String(shots.length + 1).padStart(2, '0')}-road-trip-menu.png`) });
      shots.push({ name: 'road-trip-menu', file: `${String(shots.length + 1).padStart(2, '0')}-road-trip-menu.png`, note: 'the trip menu on Escape', url: p4.url() });
      console.log(`  ${String(shots.length).padStart(2)} road-trip-menu         the trip menu on Escape`);
    }
    await c4.close();

    // --- 8. A real arena match, in the city, driven and firing ---------------
    const c5 = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR });
    const p5 = await c5.newPage();
    p5.on('pageerror', (e) => failures.push(`arena pageerror: ${String(e).slice(0, 160)}`));
    await p5.goto(`${baseUrl}?seed=${SEED}`, { waitUntil: 'load' });
    await p5.waitForFunction(() => document.getElementById('sm-boot') === null, { timeout: 30_000, polling: 60 });
    await p5.keyboard.press('1');
    await p5.waitForSelector('.sm-screen--driver', { timeout: 15_000 });
    await ignite(p5);
    await p5.waitForSelector('.sm-screen--constructor', { timeout: 15_000 });
    await buildLegalCar(p5);
    await p5.evaluate(() => {
      const li = [...document.querySelectorAll('.sm-builder__row')].find(
        (x) => x.querySelector('.sm-builder__row-label')?.textContent === 'Confirm',
      );
      li?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await p5.waitForSelector('.sm-screen--city', { timeout: 20_000 });
    const arenaRows = await walkIntoFacility(p5, 'arena', SEED);
    // Division 5 is the reviewer's usual pick and is reachable on a fresh build.
    const entered = await p5.evaluate(() => {
      const node = [...document.querySelectorAll('.sm-menu__label')].find((n) => n.textContent === 'Enter Division 5');
      if (node === undefined) return false;
      node.closest('.sm-menu__item')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    });
    if (!entered) failures.push(`could not enter Division 5; arena rows were ${JSON.stringify(arenaRows)}`);
    await p5.waitForSelector('.sm-screen--arena', { timeout: 20_000 });
    await p5.waitForTimeout(700);
    await p5.screenshot({ path: resolve(outDir, `${String(shots.length + 1).padStart(2, '0')}-arena-entry.png`) });
    shots.push({ name: 'arena-entry', file: `${String(shots.length + 1).padStart(2, '0')}-arena-entry.png`, note: 'match entry, full HUD', url: p5.url() });
    console.log(`  ${String(shots.length).padStart(2)} arena-entry           match entry, full HUD`);
    // Actually fight for a moment, so the frame shows a live match.
    await p5.keyboard.down('w');
    await p5.keyboard.down('Space');
    await p5.waitForTimeout(1800);
    await p5.screenshot({ path: resolve(outDir, `${String(shots.length + 1).padStart(2, '0')}-arena-combat.png`) });
    shots.push({ name: 'arena-combat', file: `${String(shots.length + 1).padStart(2, '0')}-arena-combat.png`, note: 'driving and firing, opponents live', url: p5.url() });
    console.log(`  ${String(shots.length).padStart(2)} arena-combat          driving and firing, opponents live`);
    await p5.keyboard.up('Space');
    await p5.keyboard.up('w');
    await c5.close();

    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }

  // WALK IDENTITY, with no hardcoded expectations. Ten facilities must produce
  // ten DISTINCT menus: if two of them come back identical, at least one walk
  // landed next door, because no two facilities in this ruleset serve the same
  // rows. This is the check that would have caught the five mislabelled
  // facilities in the first e2e run — and it needs no per-facility table, which
  // is the part that would itself rot.
  const seen = new Map();
  for (const [kind, sig] of facilityMenus) {
    for (const [other, otherSig] of seen) {
      if (otherSig === sig) failures.push(`walk identity: "${kind}" and "${other}" produced the SAME menu — at least one walked into the wrong building`);
    }
    seen.set(kind, sig);
  }

  const manifest = { seed: SEED, viewport: VIEW, deviceScaleFactor: DPR, shots, facilityMenus: Object.fromEntries(facilityMenus), failures };
  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\n${shots.length} screens captured into ${outDir}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} problem(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('no problems: every expected screen was reached by playing');
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
