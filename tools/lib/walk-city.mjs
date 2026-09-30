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

/**
 * Holds one compass key and returns the DISTANCE THE PLAYER ACTUALLY TRAVELLED.
 *
 * The return value is the entire point, and getting it wrong is what broke this
 * function for five facilities in a row. The city advances the player at
 * `pedestrian.speedMps` in REAL TIME, so a key held for `holdMs` moves the player
 * `speedMps * holdMs/1000` metres — which, with the slack and the floor in
 * `holdMs`, is about 1.07m for a step the caller believed was 0.5m.
 *
 * Crediting the model with the INTENDED 0.5m while the player actually moved
 * 1.07m makes the dead-reckoned position fall behind reality at 2x. The servo
 * then "arrives" at the map centre believing it is there, while the car is
 * halfway to a completely different building — and the menu that opens belongs to
 * that building. Every symptom in the failed runs was this: walks that reported
 * arriving near the centre and opened the weaponshop, 16.10m away.
 *
 * So the caller credits what the physics bought, not what it hoped to buy, and
 * the model and the player stay in agreement.
 */
async function stepOnce(page, ctx, dir) {
  const keys = keysForDir(dir);
  for (const k of keys) await page.keyboard.down(k);
  try {
    await page.waitForTimeout(holdMs(ctx, STEP_M));
  } finally {
    for (const k of keys) await page.keyboard.up(k);
  }
  return (walkSpeedMps(ctx) * holdMs(ctx, STEP_M)) / 1000;
}

const walkSpeedMps = (ctx) => ctx.walkSpeedMps;

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
/**
 * How far PAST a doorway to aim, in metres — finishing deep inside the target's
 * own trigger circle rather than balanced on its edge.
 */
const DOORWAY_OVERSHOOT_M = 1.2;

/**
 * Servos from `from` to `aim`, re-aiming each step.
 *
 * `stopAt` is per-leg and it is load-bearing. A single loose radius applied to
 * both legs explains every remaining failure in this file, and the two halves
 * fail in opposite directions:
 *
 * - On the leg to the MAP CENTRE, stopping 2.6m short means the next leg is not
 *   radial at all — it starts from a point off-centre and clips a neighbouring
 *   doorway. That is how `medical` opened the arena.
 * - On the leg to a DOORWAY, the aim point is already 1.2m past the doorway, so
 *   stopping 2.4m short of it leaves the player ~3.6m from the doorway centre —
 *   OUTSIDE the 3m trigger. That is why `bar`, `courierguild` and `federal` came
 *   back with no menu at all: not a wrong building, no building.
 *
 * So the centre leg stops tight (it is a staging point with no trigger in it) and
 * the doorway leg stops at 0.9m, which — given an aim already 1.2m past the
 * doorway — always lands inside the 3m circle.
 */
async function servoTo(page, ctx, from, aim, stopAt, log, label) {
  let pos = { ...from };
  const maxSteps = Math.ceil((ctx.layout.boundsRadiusM * 3) / STEP_M) + 60;
  for (let step = 0; step < maxSteps; step++) {
    const dist = Math.hypot(aim.x - pos.x, aim.y - pos.y);
    if (dist <= stopAt) {
      log?.(`  ${label}: arrived within ${dist.toFixed(2)}m after ${step} step(s)`);
      return { arrived: true, opened: false, pos };
    }
    const dir = bestDir(pos, aim);
    if (dir === null) break;
    const travelled = await stepOnce(page, ctx, dir);
    const unit = DIRECTION_UNIT_VECTORS[dir];
    pos = { x: pos.x + unit.x * travelled, y: pos.y + unit.y * travelled };
    if ((await page.evaluate(() => document.querySelector('.sm-menu__item') !== null)) === true) {
      log?.(`  ${label}: a menu opened after ${step + 1} step(s), ${Math.hypot(aim.x - pos.x, aim.y - pos.y).toFixed(2)}m short of the aim point`);
      return { arrived: false, opened: true, pos };
    }
  }
  return { arrived: false, opened: false, pos };
}

/**
 * Walks from the spawn into a facility's menu, relaying through the map centre.
 *
 * ## Why the relay, and what it cost to find out
 *
 * The obvious route — straight from the spawn to the doorway — is WRONG for most
 * of this map, and the first version of this function was wrong in exactly that
 * way for five facilities in a row. It is not a subtle drift; it is arithmetic.
 * Measured on seed `a11ce5eed5eed5eed5eed5ee`:
 *
 *     target     nearest OTHER doorway to the straight spawn->target path
 *     arena                        garage            1.69m
 *     truckstop                    assembly          1.69m
 *     medical                      garage            3.24m
 *     federal                      garage            4.53m
 *
 * The interaction radius is **3m**. A path that passes 1.69m from the garage puts
 * you INSIDE the garage's trigger circle on the way to the arena, so the garage
 * opens, the walk stops, and the e2e harness photographs a valid-looking frame of
 * the WRONG building and files it under `arena`. `truckstop` opened ASSEMBLY for
 * the same reason. Five of ten facilities were mislabelled, and nothing in the
 * output said so.
 *
 * (An earlier theory — that the trigger circles were tangent — was WRONG and was
 * discarded by measurement: the neighbour chord is 6.00m at minimum but the
 * facility spacing is uneven, 6.00m to 21.08m, because the ring is shared with
 * the gate.)
 *
 * The relay fixes it geometrically rather than by tuning. Every doorway sits ON
 * the ring, so a leg running between the gate and the map CENTRE moves away from
 * all of them at once, and a leg running from the centre outward to the aimed
 * doorway is RADIAL: its closest approach to any other ring point is 6.00m, at the
 * ring itself, where the target is. There is no path from the centre to a doorway
 * that passes another doorway. `tests/integration/arena-auto-end.test.ts` has
 * always used this same relay; this function is now the browser-side equivalent
 * of a route that was already known to work.
 */
export async function walkIntoFacility(page, facilityKind, seed, log) {
  const ctx = cityWalkContext(seed);
  const door = doorwayPosition(ctx, facilityKind);
  // Radially outward from the map centre: past the doorway, not up to it, so the
  // walk finishes well inside the target's own trigger circle.
  const ringLen = Math.hypot(door.x, door.y);
  const scale = ringLen === 0 ? 0 : (ringLen + DOORWAY_OVERSHOOT_M) / ringLen;
  const aim = { x: door.x * scale, y: door.y * scale };
  const centre = { x: 0, y: 0 };

  const inward = await servoTo(page, ctx, ctx.spawn, centre, 0.4, log, 'gate->centre');
  if (inward.opened) {
    log?.(`  WARNING: a menu opened on the way to the centre; "${facilityKind}" was NOT reached`);
  }
  const outward = await servoTo(page, ctx, inward.pos, aim, 0.9, log, `centre->${facilityKind}`);
  if (outward.opened) {
    log?.(`  ${facilityKind}: menu opened on the radial leg`);
  }

  if (!outward.opened) {
    await page
      .waitForFunction(() => document.querySelector('.sm-menu__item') !== null, { timeout: 4_000, polling: 60 })
      .catch(() => {});
  }
  return page.evaluate(() => [...document.querySelectorAll('.sm-menu__label')].map((n) => n.textContent ?? ''));
}

/**
 * Walks off the spawn, back out through the gate, and takes the first route.
 *
 * ## Why this uses EXACT timing and not the servo's
 *
 * The gate trigger is EDGE-triggered, so a player who starts inside its circle
 * never fires it — stepping inward first is what makes stepping back out count.
 * Neither leg needs precision here, only a *known* displacement, and this
 * function used to inherit the servo's hold time, which includes a 1.6x slack
 * factor and a 120ms floor. It therefore flung the player 17m when it meant to
 * move them 10.65m, straight through the far wall (the city clamps to its
 * boundary), and the walk back never returned to the gate. The e2e run hung on
 * `waitForFunction` for the gate menu that could not open.
 *
 * So these legs hold for EXACTLY the time the intended distance takes. Frame
 * pacing makes that approximate by a few percent, which is irrelevant for
 * "leave the circle, come back" and would not be for the servo — hence two
 * different helpers rather than one compromise.
 */
const EXACT_HOLD_SLACK = 1;

function exactHoldMs(ctx, metres) {
  return Math.round((metres / ctx.walkSpeedMps) * 1000 * EXACT_HOLD_SLACK);
}

export async function walkThroughGateToRoad(page, seed, log) {
  const ctx = cityWalkContext(seed);
  const centre = { x: 0, y: 0 };
  const inward = legFor(ctx.spawn, centre);
  const outward = legFor(centre, ctx.spawn);

  // 6m clears the 3m gate circle with room to spare; 10m on the way back
  // re-enters it and crosses the doorway.
  const IN_M = 6;
  const OUT_M = 10;

  const hold = async (leg, metres, label) => {
    for (const k of leg.keys) await page.keyboard.down(k);
    try {
      await page.waitForTimeout(exactHoldMs(ctx, metres));
    } finally {
      for (const k of leg.keys) await page.keyboard.up(k);
    }
    log?.(`  ${label}: ${metres}m (${exactHoldMs(ctx, metres)}ms)`);
  };

  await hold(inward, IN_M, 'off the gate');
  if ((await page.evaluate(() => document.querySelector('.sm-menu__item') !== null)) === true) {
    throw new Error('walk-city: a menu opened while walking clear of the gate — the clear distance is too short');
  }
  await hold(outward, OUT_M, 'back through the gate');

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
