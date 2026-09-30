/**
 * Walking the on-foot driver to a city doorway in a real browser.
 *
 * ONE owner, because two harnesses needed this and each grew its own copy.
 * Both copies were wrong, in ways that only showed up as "the probe walked
 * into the Federal Building when it meant to walk into the Arena."
 *
 * WHY THE OBVIOUS VERSION CANNOT WORK. The city accepts only 8 compass
 * directions, and a doorway can sit at any angle between them. On seed
 * `a11ce5ee` the arena is at 196.4° — 16° past due west — so the best available
 * heading is due west, and a due-west path from the plaza centre passes
 * **3.18 m** from the arena's centre: just OUTSIDE the 3 m interaction radius.
 * The Federal Building is the arena's ring neighbour 6.0 m away at 164°, and a
 * due-west path passes 3.00 m from it. So the heading that "points at" the
 * arena triggers the Federal Building instead, and a fixed-duration leg cannot
 * recover, because the target is not on the path at all.
 *
 * So this does not compute a route and follow it. It SERVOS: take one short
 * step in whichever of the 8 directions most reduces the distance to the
 * target, re-read the compass, repeat. A heading the compass cannot express is
 * then approximated by interleaving its two neighbours (west, then south-west,
 * then west), which converges on any angle.
 *
 * The step distance is threaded through the position rather than recomputed
 * from the origin, because each leg also stops short of its nominal end and
 * that error otherwise compounds into the next heading.
 *
 * The caller must still VERIFY which facility it arrived at. This module gets
 * the driver to a doorway; only an assertion on the resulting rows can prove
 * which doorway that was. Two earlier versions of the probe passed while
 * standing in the wrong building, for exactly that reason.
 */
import { DIRECTION_UNIT_VECTORS, generateCityLayout } from '@/sim/city';
import { drivingConfig, skillsConfig } from '@/data/rulesets';

const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };

/** Slack over the pure distance/speed time, for frame pacing. */
const HOLD_SLACK = 1.6;
/** How far to aim for per servo step. Short enough that a re-aim is cheap. */
const STEP_M = 0.5;

export function cityWalkContext(seed) {
  const layout = generateCityLayout(skillsConfig().startingLocation, seed);
  return {
    layout,
    interactionRadiusM: drivingConfig().pedestrian.interactionRadiusM,
    walkSpeedMps: drivingConfig().pedestrian.speedMps,
    /** The player spawns at the gate (app.ts seeds it there), not the centre. */
    spawn: { x: layout.gate.position.x, y: layout.gate.position.y },
  };
}

/** The 8-way direction whose heading most reduces the distance to `to`. */
function bestDir(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const ux = dx / len;
  const uy = dy / len;
  let best = null;
  let bestDot = -Infinity;
  for (const [dir, unit] of Object.entries(DIRECTION_UNIT_VECTORS)) {
    const dot = unit.x * ux + unit.y * uy;
    if (dot > bestDot) {
      bestDot = dot;
      best = dir;
    }
  }
  return best;
}

/**
 * A single fixed-length leg: which compass keys to hold, and for how long.
 * `stopShortM` is subtracted from the distance so a leg aimed AT a trigger
 * circle stops inside it rather than past it.
 */
export function legFor(from, to, stopShortM = 0) {
  const dir = bestDir(from, to);
  if (dir === null) throw new Error('walk-city: zero-length leg');
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  return { dir, keys: keysForDir(dir), travelM: Math.max(0, dist - stopShortM), unit: DIRECTION_UNIT_VECTORS[dir] };
}

export async function walkLeg(page, ctx, leg, log) {
  if (leg.travelM === 0) return;
  log?.(`  leg ${leg.dir}, ~${leg.travelM.toFixed(2)}m, keys ${leg.keys.join('+')}`);
  for (const k of leg.keys) await page.keyboard.down(k);
  try {
    await page.waitForTimeout(holdMs(ctx, leg.travelM));
  } finally {
    for (const k of leg.keys) await page.keyboard.up(k);
  }
}

function holdMs(ctx, metres) {
  return Math.ceil((metres / ctx.walkSpeedMps) * 1000 * HOLD_SLACK) + 120;
}

async function stepOnce(page, ctx, dir, metres) {
  const keys = keysForDir(dir);
  for (const k of keys) await page.keyboard.down(k);
  try {
    await page.waitForTimeout(holdMs(ctx, metres));
  } finally {
    for (const k of keys) await page.keyboard.up(k);
  }
}

export function doorwayPosition(ctx, facilityKind) {
  const d = ctx.layout.doorways.find((x) => x.facilityKind === facilityKind);
  if (d === undefined) throw new Error(`walk-city: "${ctx.layout.cityId}" has no "${facilityKind}" doorway`);
  return { x: d.position.x, y: d.position.y };
}

function keysForDir(dir) {
  const unit = DIRECTION_UNIT_VECTORS[dir];
  const keys = [];
  if (unit.y > 0) keys.push(KEYS.up);
  if (unit.y < 0) keys.push(KEYS.down);
  if (unit.x > 0) keys.push(KEYS.right);
  if (unit.x < 0) keys.push(KEYS.left);
  return keys;
}

/**
 * Servos the player from the spawn to a facility's doorway, and returns the
 * menu rows it found there. Stops as soon as a menu opens, or when the
 * estimated position is inside the interaction radius, whichever comes first.
 */
export async function walkIntoFacility(page, facilityKind, seed, log) {
  const ctx = cityWalkContext(seed);
  const target = doorwayPosition(ctx, facilityKind);
  let pos = { ...ctx.spawn };
  // A cap so a bug fails loudly instead of pressing keys forever.
  const maxSteps = Math.ceil((ctx.layout.boundsRadiusM * 3) / STEP_M) + 40;
  let opened = false;
  let steps = 0;

  for (; steps < maxSteps; steps++) {
    const dist = Math.hypot(target.x - pos.x, target.y - pos.y);
    if (dist <= ctx.interactionRadiusM * 0.7) {
      log?.(`  arrived within ${dist.toFixed(2)}m of "${facilityKind}" after ${steps} step(s)`);
      break;
    }
    const dir = bestDir(pos, target);
    if (dir === null) break;
    await stepOnce(page, ctx, dir, Math.min(STEP_M, dist));
    const unit = DIRECTION_UNIT_VECTORS[dir];
    pos = { x: pos.x + unit.x * STEP_M, y: pos.y + unit.y * STEP_M };
    opened = (await page.evaluate(() => document.querySelector('.sm-menu__item') !== null)) ?? false;
    if (opened) {
      log?.(`  menu opened after ${steps + 1} step(s), estimated ${Math.hypot(target.x - pos.x, target.y - pos.y).toFixed(2)}m from "${facilityKind}"`);
      break;
    }
  }
  if (!opened) {
    await page
      .waitForFunction(() => document.querySelector('.sm-menu__item') !== null, { timeout: 4_000, polling: 60 })
      .catch(() => {});
  }
  return page.evaluate(() => [...document.querySelectorAll('.sm-menu__label')].map((n) => n.textContent ?? ''));
}

/**
 * Walks off the spawn, back out through the gate, and takes the first route —
 * the same in/out/in-out shape `tests/integration/screens.test.ts` uses, and for
 * the same reason: the gate trigger is EDGE-triggered, so a player who starts
 * inside its circle never fires it. Stepping inward first is what makes
 * stepping back out count.
 */
export async function walkThroughGateToRoad(page, seed, log) {
  const ctx = cityWalkContext(seed);
  const centre = { x: 0, y: 0 };
  const inward = legFor(ctx.spawn, centre);
  const outward = legFor(centre, ctx.spawn);
  await walkLeg(page, ctx, inward, log);
  if ((await page.evaluate(() => document.querySelector('.sm-menu__item') !== null)) === true) {
    throw new Error('walk-city: a menu opened while walking inward off the gate');
  }
  await walkLeg(page, ctx, outward, log);
  await page.waitForFunction(() => document.querySelector('.sm-menu__item') !== null, { timeout: 8_000, polling: 60 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('.sm-menu__label')].map((n) => n.textContent ?? ''));
  log?.(`  gate prompt rows: ${JSON.stringify(rows)}`);
  if (rows.length === 0) throw new Error('walk-city: the gate prompt opened with no rows');
  await page.evaluate((label) => {
    const node = [...document.querySelectorAll('.sm-menu__label')].find((n) => n.textContent === label);
    node?.closest('.sm-menu__item')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, rows[0]);
  await page.waitForFunction(() => document.querySelector('.sm-screen--road') !== null, { timeout: 10_000, polling: 60 });
  return rows[0];
}
