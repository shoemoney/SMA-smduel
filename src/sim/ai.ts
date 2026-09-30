/**
 * Arena / road AI.
 *
 * COMPLIANCE (this is the point of the whole module): the AI is not a cheating
 * oracle. It reads exactly the same `VehicleState` / `WeaponState` shapes the
 * player's HUD reads, and its *only* output is an `InputFrame` — the same
 * struct a human's controller/keyboard would produce. It never mutates a
 * `VehicleState`, never rolls damage, never grants itself ammo, armor, or a
 * facing it didn't actually mount, and never aims at an angle its own mounted
 * facing doesn't cover. Whatever fire pipeline validates and resolves the
 * player's `InputFrame` must do the same work for this one — that is what
 * "no stat cheating, no infinite ammo, no free aim" means in code.
 *
 * Facing / heading convention (documented once, used everywhere below):
 *   - `headingRad` is whatever numeric angle `src/sim/driving.ts` is steering
 *     the vehicle toward (it moves the car by `position += (cos, sin) *
 *     speed`), and `src/sim/combat.ts`'s `validateFire` is the ONLY authority
 *     on which world direction a mounted `Facing` points given that same
 *     `headingRad` (see its `FACING_LOCAL_UNIT` table). This module does not
 *     re-derive that mapping — it imports `facingWorldDirection` from
 *     `@/sim/combat` and `facingForLocalDirection`/`rotateVec` from
 *     `@/sim/damage`, the exact functions `validateFire` itself calls, so
 *     "does facing F bear on point P" is one formula shared by both the
 *     player's fire pipeline and this AI's, not two independently-typed
 *     copies that can drift apart (that drift — a 90-degree rotated local
 *     frame — is exactly what made the AI's shots validate as WRONG_FACING
 *     against every target it thought it was aiming at).
 *
 * Behavior-tree / utility hybrid: `decideAI` is a small ordered chain of
 * priority gates (behavior-tree style: avoid hazard > retreat > ram > engage
 * > pursue > idle, first non-null wins), and inside the gates that have to
 * choose among several live options (which enemy to target, which mounted
 * weapon to work with) the choice is a scored utility pick, not a fixed rule.
 * Every node is exported by name so a test can assert exactly which one fired.
 */

import { getBody, getPlant, getTire, getWeapon } from '@/data/rulesets';
import type { Facing, Vec2, VehicleState, WeaponDeployable, WeaponState } from '@/sim/types';
import { sumArmor } from '@/sim/types';
import { facingWorldDirection } from '@/sim/combat';
import { facingForLocalDirection, rotateVec } from '@/sim/damage';

// ---------------------------------------------------------------------------
// Public contract types
// ---------------------------------------------------------------------------

/**
 * The one and only thing the AI is allowed to produce. Identical shape to
 * what a human's input layer emits — `weaponSlot` is an index into
 * `VehicleState.weapons`, or -1 for "no weapon change requested this tick".
 */
export interface InputFrame {
  readonly moveX: number;
  readonly moveY: number;
  readonly fire: boolean;
  readonly weaponSlot: number;
}

/**
 * Per-opponent tuning. This is DATA, read at decision time — never a hidden
 * constant baked into the scoring code. `playerThreatBias` in particular is
 * a calibration knob (see docs/SPEC.md Arena section: "Opponent
 * threat-weighting toward the player is a calibration knob, never a hidden
 * constant") that makes an AI weigh the human player as more of a threat
 * than an equally-vulnerable, equally-close AI opponent. Set it to 0 for a
 * perfectly neutral free-for-all combatant.
 */
export interface AIPersonality {
  /** 0..1. Higher = prefers ramming/engaging over retreating or standing off. */
  readonly aggression: number;
  /** 0..1. Higher = retreats sooner and gives hazards a wider berth. */
  readonly caution: number;
  /**
   * 0..1. Scales this AI's OWN decision quality only — hazard detection
   * radius, tie-break sharpness. It never touches the fire pipeline's hit
   * chance or damage roll; those still come from the driver's marksmanship
   * skill exactly like the player, so this is not a stat-cheat lever.
   */
  readonly skill: number;
  /**
   * CALIBRATION KNOB, never a hidden constant: additive score bonus this AI
   * gives the human player when comparing targets. 0 = no bias at all (the
   * player is just another opponent). Tune it here, in one place — never by
   * special-casing "is this the player" inside the scoring math itself.
   */
  readonly playerThreatBias: number;
}

export type HazardKind = 'MINE' | 'SPIKES' | 'OIL' | 'SMOKE';

/** A hazard as the AI perceives it — the world/road system owns the truth. */
export interface HazardInstance {
  readonly id: string;
  readonly kind: HazardKind;
  readonly position: Vec2;
  readonly radiusM: number;
  /** SMOKE only: whether this cloud blocks line of sight (per its weapon def). */
  readonly blocksLineOfSight?: boolean;
  /** Whose weapon deployed it, if known — irrelevant to LOS blocking (a cloud
   *  blocks everyone's LOS through it, including its owner's). */
  readonly ownerId?: string;
}

export interface ArenaBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Read-only snapshot of everything the AI is allowed to look at. */
export interface AIWorldView {
  readonly tick: number;
  readonly bounds: ArenaBounds;
  readonly vehicles: readonly VehicleState[];
  readonly hazards: readonly HazardInstance[];
  readonly playerVehicleId: string;
}

export interface AIContext {
  readonly self: VehicleState;
  readonly world: AIWorldView;
  readonly personality: AIPersonality;
  /** Seeds every deterministic tie-break this decision makes. Same world +
   *  same seed => same InputFrame, every time. */
  readonly seed: number;
}

export type AIBehaviorName =
  | 'AVOID_HAZARD'
  | 'RETREAT'
  | 'RAM'
  | 'ALIGN_AND_FIRE'
  | 'CIRCLE'
  | 'KITE_REAR'
  | 'PURSUE'
  | 'IDLE';

export interface AIDecision {
  readonly behavior: AIBehaviorName;
  readonly targetId: string | null;
  readonly input: InputFrame;
}

export interface TargetAcquisition {
  readonly vehicle: VehicleState;
  readonly score: number;
}

// ---------------------------------------------------------------------------
// Deterministic RNG (seeded only — no Math.random, no Date.now)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic per-decision seed: pure function of (self, world tick, seed, salt). */
function seedFor(ctx: AIContext, salt: string): number {
  return (hashString(`${ctx.self.id}|${salt}`) ^ ctx.seed ^ ctx.world.tick) >>> 0;
}

/** Pick the highest-scoring item; break exact ties deterministically via seeded RNG. */
function pickBest<T>(items: readonly T[], score: (item: T) => number, seed: number): T | null {
  if (items.length === 0) return null;
  let bestScore = -Infinity;
  let bests: T[] = [];
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) {
      bestScore = s;
      bests = [item];
    } else if (s === bestScore) {
      bests.push(item);
    }
  }
  const first = bests[0];
  if (first === undefined) return null;
  if (bests.length === 1) return first;
  const draw = mulberry32(seed)();
  const idx = Math.min(bests.length - 1, Math.floor(draw * bests.length));
  return bests[idx] ?? first;
}

// ---------------------------------------------------------------------------
// Vector / angle helpers
// ---------------------------------------------------------------------------

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

const TAU = Math.PI * 2;

function normalizeAngle(rad: number): number {
  let a = rad % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

function bearingTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Angular offset of `facing`'s world direction from the vehicle's own
 * heading, at heading 0 — read straight off combat.ts's own
 * `facingWorldDirection` (which is `FACING_LOCAL_UNIT` rotated by heading)
 * instead of a second, hand-typed table that could silently diverge from it.
 * UNDERBODY has no aim direction (no weapon ever mounts there — mines target
 * UNDERBODY, they don't mount on it — so this branch is never exercised by a
 * real weapon; it exists only so the function is total over `Facing`).
 */
function facingOffsetRad(facing: Facing): number {
  if (facing === 'UNDERBODY') return 0;
  const dir = facingWorldDirection(0, facing);
  return Math.atan2(dir.y, dir.x);
}

/**
 * Converts a world-space delta (target - self) into the vehicle's local
 * frame using the exact same two functions (`rotateVec` +
 * `facingForLocalDirection`) that `combat.ts`'s `validateFire` composes to
 * decide `WRONG_FACING` — not a second, re-derived formula. This is how the
 * AI checks "does this mounted facing bear on that point right now", and it
 * is now provably the identical rule the fire pipeline itself enforces.
 */
function bearingQuadrant(headingRad: number, worldDelta: Vec2): Facing {
  const local = rotateVec(worldDelta, -headingRad);
  return facingForLocalDirection(local);
}

/**
 * The heading the vehicle needs to reach for `facing` to bear on a target at
 * world bearing `bearingRad` — the exact inverse of `bearingQuadrant` above
 * (and therefore of `validateFire`'s own facing check). Exported so a test
 * can independently confirm `bearingQuadrant(alignHeadingFor(b, F),
 * unitVectorAt(b)) === F` for every facing.
 */
export function alignHeadingFor(bearingRad: number, facing: Facing): number {
  return normalizeAngle(bearingRad - facingOffsetRad(facing));
}

/**
 * The steering half of "align a valid weapon facing": turns the desired
 * heading for `facing` into the joystick-style InputFrame axes the player
 * uses (direction of push = desired travel direction, per Classic Input in
 * docs/SPEC.md). This is what actually turns the car — it is not "drive at
 * the target", it is "drive at the heading that brings this facing to
 * bear".
 *
 * It USED to be true that these two did not coincide for ANY facing, FRONT
 * included: `facingOffsetRad` read a `FACING_LOCAL_UNIT` whose FRONT was 90
 * degrees from driving's own forward vector, so the combat frame was rotated
 * relative to the chassis. That offset is gone now that `VEHICLE_LOCAL_FACING`
 * puts FRONT on the chassis nose, and this comment was the one place still
 * asserting the old relationship — a stale explanation of live code, which is
 * how a future reader would have "restored" the 90 degrees as intentional.
 * `facingOffsetRad` still DERIVES from `facingWorldDirection` rather than
 * keeping its own table, which is why it followed the rotation with no edit.
 */
export function computeAlignmentInput(bearingRad: number, facing: Facing): { moveX: number; moveY: number } {
  const heading = alignHeadingFor(bearingRad, facing);
  return { moveX: Math.cos(heading), moveY: Math.sin(heading) };
}

/** Segment-circle intersection, used for smoke line-of-sight blocking. */
function segmentIntersectsCircle(a: Vec2, b: Vec2, center: Vec2, radius: number): boolean {
  const d = sub(b, a);
  const f = sub(a, center);
  const aa = dot(d, d);
  if (aa === 0) return length(f) <= radius;
  const bb = 2 * dot(f, d);
  const cc = dot(f, f) - radius * radius;
  const disc = bb * bb - 4 * aa * cc;
  if (disc < 0) return false;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-bb - sqrtDisc) / (2 * aa);
  const t2 = (-bb + sqrtDisc) / (2 * aa);
  if (t1 >= 0 && t1 <= 1) return true;
  if (t2 >= 0 && t2 <= 1) return true;
  return t1 < 0 && t2 > 1;
}

/** True when nothing blocks sight between two points — smoke included, own
 *  smoke included, exactly like the fire pipeline must treat it. */
export function hasLineOfSight(world: AIWorldView, from: Vec2, to: Vec2): boolean {
  for (const hazard of world.hazards) {
    if (hazard.kind !== 'SMOKE' || hazard.blocksLineOfSight !== true) continue;
    if (segmentIntersectsCircle(from, to, hazard.position, hazard.radiusM)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Vehicle condition
// ---------------------------------------------------------------------------

/** 0 (wrecked) .. 1 (pristine) average of armor / plant / tire remaining fraction. */
function conditionFraction(vehicle: VehicleState): number {
  const maxArmor = sumArmor(vehicle.design.armor);
  const armorFraction = maxArmor > 0 ? sumArmor(vehicle.armorDP) / maxArmor : 1;

  const plantMax = getPlant(vehicle.design.plantId).maxDP;
  const plantFraction = plantMax > 0 ? vehicle.plantDP / plantMax : 1;

  const tireMax = getTire(vehicle.design.tireId).maxDP;
  const tireSum = vehicle.tireDP[0] + vehicle.tireDP[1] + vehicle.tireDP[2] + vehicle.tireDP[3];
  const tireFraction = tireMax > 0 ? tireSum / (tireMax * 4) : 1;

  return (armorFraction + plantFraction + tireFraction) / 3;
}

// ---------------------------------------------------------------------------
// Target acquisition (utility scoring: nearest OR most vulnerable + player bias)
// ---------------------------------------------------------------------------

export function acquireTarget(ctx: AIContext): TargetAcquisition | null {
  const candidates = ctx.world.vehicles.filter((v) => v.id !== ctx.self.id && !v.destroyed);
  const scored = candidates.map((vehicle) => {
    const distance = length(sub(vehicle.position, ctx.self.position));
    const proximity = 1 / (1 + distance);
    const vulnerability = 1 - conditionFraction(vehicle);
    const playerBonus = vehicle.id === ctx.world.playerVehicleId ? ctx.personality.playerThreatBias : 0;
    return { vehicle, score: proximity + vulnerability + playerBonus };
  });
  const best = pickBest(scored, (c) => c.score, seedFor(ctx, 'target'));
  return best;
}

// ---------------------------------------------------------------------------
// Weapon evaluation
// ---------------------------------------------------------------------------

interface WeaponCandidate {
  readonly index: number;
  readonly state: WeaponState;
  readonly facing: Facing;
  readonly bearsNow: boolean;
  readonly inRange: boolean;
  readonly losClear: boolean;
  readonly readyToFire: boolean;
  readonly score: number;
}

/**
 * A DEPLOYABLE's own effect radius (the only ruleset-sourced measure of "how
 * close does this need to land to matter") — `triggerRadiusM` for a
 * MINE/SPIKES patch on the ground, `radiusM` for a CLOUD/SLICK's area of
 * effect. Exhaustive over `WeaponDeployable['kind']`.
 */
function deployableEffectRadiusM(deployable: WeaponDeployable): number {
  switch (deployable.kind) {
    case 'MINE':
    case 'SPIKES':
      return deployable.triggerRadiusM;
    case 'CLOUD':
    case 'SLICK':
      return deployable.radiusM;
  }
}

function evaluateWeapon(ctx: AIContext, target: VehicleState, index: number, state: WeaponState): WeaponCandidate | null {
  if (state.destroyed || state.dp <= 0) return null;
  const def = getWeapon(state.weaponId);
  const delta = sub(target.position, ctx.self.position);
  const distance = length(delta);
  const deployableDef = def.mode === 'DEPLOYABLE' ? def.deployable : undefined;
  const isDeployable = deployableDef !== undefined;

  // Same bearing test for every mode, deployable or not — validateFire never
  // special-cases DEPLOYABLE either (a minedropper's mount facing has to bear
  // on wherever the AI names as its "target" just like a gun's does).
  const currentQuadrant = bearingQuadrant(ctx.self.headingRad, delta);
  const bearsNow = currentQuadrant === state.facing;

  // A deployable has no aim range (weapons.json's rangeM is 0 for all of
  // them) — its own effect radius is the only meaningful proximity gate, so
  // it is scored "in range" only when something is actually close enough
  // behind/beside self for the drop to matter, not unconditionally.
  const inRange = isDeployable
    ? distance <= deployableEffectRadiusM(deployableDef) * (1 + ctx.personality.skill)
    : distance <= def.rangeM && (def.minRangeM === undefined || distance >= def.minRangeM);
  // A dropped mine/cloud isn't aimed through space, so line of sight to the
  // target it's meant to catch is not a meaningful gate for it.
  const losClear = isDeployable ? true : hasLineOfSight(ctx.world, ctx.self.position, target.position);

  const cooldownReady = state.cooldownRemaining <= 0;
  const ammoReady = def.usesBattery === true ? ctx.self.battery >= (def.batteryPerShot ?? 0) : state.ammo > 0;
  const readyToFire = cooldownReady && ammoReady;

  let score = 0;
  if (readyToFire) score += 1;
  if (bearsNow) score += 1;
  if (inRange) score += 1;
  if (losClear) score += 1;
  // Schema guarantees maxDP >= 1 (POSITIVE_INT in data/schema.ts). Guarded
  // anyway because a NaN here is uniquely destructive: in `pickBest` every
  // `s > bestScore` and `s === bestScore` is FALSE for NaN, so `bests` stays
  // empty, the function returns null, and the weapon disappears from the AI's
  // entire decision tree with no error and no log line. The opponent silently
  // degrades to PURSUE and nobody can tell why.
  score += state.maxDP > 0 ? state.dp / state.maxDP : 0;
  if (def.ammoCapacity > 0) score += Math.min(1, state.ammo / def.ammoCapacity);

  return { index, state, facing: state.facing, bearsNow, inRange, losClear, readyToFire, score };
}

function usableWeapons(ctx: AIContext, target: VehicleState): WeaponCandidate[] {
  const out: WeaponCandidate[] = [];
  ctx.self.weapons.forEach((state, index) => {
    const candidate = evaluateWeapon(ctx, target, index, state);
    if (candidate !== null) out.push(candidate);
  });
  return out;
}

function behaviorForFacing(facing: Facing): AIBehaviorName {
  switch (facing) {
    case 'FRONT':
      return 'ALIGN_AND_FIRE';
    case 'LEFT':
    case 'RIGHT':
      return 'CIRCLE';
    case 'REAR':
      return 'KITE_REAR';
    case 'UNDERBODY':
      return 'ALIGN_AND_FIRE';
  }
}

function buildDecision(behavior: AIBehaviorName, targetId: string | null, input: InputFrame): AIDecision {
  return { behavior, targetId, input };
}

// ---------------------------------------------------------------------------
// Priority nodes (behavior-tree gates, evaluated in order — first non-null wins)
// ---------------------------------------------------------------------------

/**
 * Steer away from a hazard within skill-scaled detection range, or back
 * inside the arena if already out of bounds. Never fires while dodging.
 *
 * Only MINE/SPIKES/OIL are treated as something to dodge — they damage or
 * disable whatever drives over them. A SMOKE cloud is a visibility problem
 * (it costs accuracy and can block line of sight — see `hasLineOfSight` and
 * `evaluateWeapon`'s `losClear`), not a hazard a car needs to steer clear of,
 * so it never reaches this gate — including a cloud this same AI just laid
 * down, which used to trap it in its own smoke with fire suppressed for the
 * cloud's entire lifetime.
 */
export function avoidHazardNode(ctx: AIContext, target: VehicleState | null): AIDecision | null {
  const { bounds } = ctx.world;
  const self = ctx.self;

  if (self.position.x < bounds.minX || self.position.x > bounds.maxX || self.position.y < bounds.minY || self.position.y > bounds.maxY) {
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const heading = bearingTo(self.position, center);
    return buildDecision('AVOID_HAZARD', target?.id ?? null, {
      moveX: Math.cos(heading),
      moveY: Math.sin(heading),
      fire: false,
      weaponSlot: -1,
    });
  }

  const threatening = ctx.world.hazards
    .filter((hazard) => hazard.kind !== 'SMOKE')
    .map((hazard) => ({ hazard, distance: length(sub(hazard.position, self.position)) }))
    .filter(({ hazard, distance }) => distance <= hazard.radiusM * (1 + ctx.personality.skill));

  const nearest = pickBest(threatening, (h) => -h.distance, seedFor(ctx, 'hazard'));
  if (nearest === null) return null;

  const awayHeading = normalizeAngle(bearingTo(nearest.hazard.position, self.position));
  return buildDecision('AVOID_HAZARD', target?.id ?? null, {
    moveX: Math.cos(awayHeading),
    moveY: Math.sin(awayHeading),
    fire: false,
    weaponSlot: -1,
  });
}

/**
 * Flee the nearest live threat once condition drops below this AI's own
 * caution threshold. Also reuses the REAR-facing evaluation so a rear-mounted
 * weapon that happens to already bear (e.g. mid-kite, not necessarily the
 * instant flight begins — running straight away does not by itself guarantee
 * REAR bears, since a mounted facing's world direction is combat.ts's own
 * convention, not simply "whichever way the chassis isn't pointing") still
 * gets fired opportunistically while running: "run while firing rear
 * weapons" without ever granting itself a facing it doesn't actually have
 * mounted.
 */
export function retreatNode(ctx: AIContext, target: VehicleState | null): AIDecision | null {
  if (conditionFraction(ctx.self) >= ctx.personality.caution) return null;

  const threats = ctx.world.vehicles.filter((v) => v.id !== ctx.self.id && !v.destroyed);
  const nearestThreat = pickBest(threats, (v) => -length(sub(v.position, ctx.self.position)), seedFor(ctx, 'retreat'));
  const threat = nearestThreat ?? target;
  if (threat === null) return null;

  // Literally drive away from the threat — this is a travel direction, not a
  // facing to bring to bear, so it is the raw bearing, not
  // `alignHeadingFor`'s output (that function answers a different question:
  // "what heading makes facing F bear", not "which way is away").
  const runHeading = bearingTo(threat.position, ctx.self.position);
  const rearCandidates = usableWeapons(ctx, threat).filter((c) => c.facing === 'REAR');
  const rear = pickBest(rearCandidates, (c) => c.score, seedFor(ctx, 'retreat-weapon'));
  const fire = rear !== null && rear.bearsNow && rear.inRange && rear.losClear && rear.readyToFire;

  return buildDecision('RETREAT', threat.id, {
    moveX: Math.cos(runHeading),
    moveY: Math.sin(runHeading),
    fire,
    weaponSlot: fire && rear !== null ? rear.index : -1,
  });
}

/**
 * The farthest range this AI has any mounted, functional, non-deployable
 * weapon that could otherwise take the shot — the data-driven "is ramming
 * even relevant yet" gate for `ramAndPinNode` below. `null` when this AI has
 * no such weapon (nothing usable to fight with at range at all, in which
 * case closing to ram is always the right call, at any distance).
 */
function bestUsableWeaponRangeM(ctx: AIContext): number | null {
  let best: number | null = null;
  for (const state of ctx.self.weapons) {
    if (state.destroyed || state.dp <= 0) continue;
    const def = getWeapon(state.weaponId);
    if (def.mode === 'DEPLOYABLE') continue;
    if (best === null || def.rangeM > best) best = def.rangeM;
  }
  return best;
}

/**
 * Drive straight into the target to ram/pin it. Gated on data this AI
 * actually has: more aggression than caution, a body that is at least as
 * heavy as the target's (a shoving match a lighter car would lose), AND —
 * so this cannot preempt `engageWeaponNode` from a distance no mounted
 * weapon could ever close fast enough to matter at — being no farther out
 * than the longest range this AI has anything usable to shoot with. Fires
 * opportunistically if any mounted facing already happens to bear.
 */
export function ramAndPinNode(ctx: AIContext, target: VehicleState): AIDecision | null {
  if (!(ctx.personality.aggression > ctx.personality.caution)) return null;
  const selfWeight = getBody(ctx.self.design.bodyId).weightLb;
  const targetWeight = getBody(target.design.bodyId).weightLb;
  if (selfWeight < targetWeight) return null;

  const delta = sub(target.position, ctx.self.position);
  const distance = length(delta);
  const rangeGate = bestUsableWeaponRangeM(ctx);
  if (rangeGate !== null && distance > rangeGate) return null;

  const bearing = bearingTo(ctx.self.position, target.position);
  const currentQuadrant = bearingQuadrant(ctx.self.headingRad, delta);
  const usable = usableWeapons(ctx, target);
  const bearingCandidates = usable.filter((c) => c.facing === currentQuadrant);

  // YIELD WHEN IT HAS WEAPONS BUT NONE OF THEM BEARS, so `engageWeaponNode`
  // gets to steer.
  //
  // This node is a straight-line charge: it has no steering of its own, and it
  // sits ABOVE `engageWeaponNode` in `decideAI`'s priority chain, so whenever it
  // returns a decision the steering node never runs. It can only fire with a
  // mount that ALREADY bears, so a RAM with nothing bearing is a full-throttle
  // push toward a target it cannot shoot at — the worst of both nodes, and
  // against an equally-weighted or lighter car it is a permanent standoff
  // rather than a shove.
  //
  // The house arena kart carries ONE mount (a machinegun on FRONT), so every
  // amateur-night opponent is a single-front-mount AI: the moment the target
  // leaves the forward quadrant this was the decision it made, forever.
  // Measured live in iteration 145 — two opponents parked ~3.7m from a
  // stationary player, not firing, unmoved for 37,000 ticks.
  //
  // This is the NEAR side of a gate the suite already covers on the FAR side
  // ("engageWeaponNode becomes reachable once ram is range-gated out at long
  // range"). Nothing yielded when RAM simply had nothing to shoot with.
  //
  // **The `usable.length > 0` half is load-bearing, and the pre-existing
  // "no range gate at all when it has no ranged weapon" test is what proved
  // it.** A weaponless AI has no steering node to fall through to — nothing
  // bears because nothing is mounted — so closing is genuinely its only option,
  // and gating that would strand it. Yielding is only correct when the AI HAS
  // weapons and they are simply not pointed at the target yet, which is the one
  // case where `engageWeaponNode` can do better.
  if (usable.length > 0 && bearingCandidates.length === 0) return null;

  const ready = pickBest(bearingCandidates, (c) => c.score, seedFor(ctx, 'ram-weapon'));
  const fire = ready !== null && ready.bearsNow && ready.inRange && ready.losClear && ready.readyToFire;

  return buildDecision('RAM', target.id, {
    moveX: Math.cos(bearing),
    moveY: Math.sin(bearing),
    fire,
    weaponSlot: fire && ready !== null ? ready.index : -1,
  });
}

/**
 * Pick the best mounted weapon to work with (utility score across all
 * usable weapons, ready-or-not) and steer to bring it to bear. The chosen
 * facing determines the label: FRONT reads as a direct align-and-fire pass,
 * LEFT/RIGHT reads as circling for a side pass, REAR reads as kiting.
 * Returns null only when every mounted weapon is destroyed or out of DP —
 * i.e. there is genuinely nothing to engage with.
 */
export function engageWeaponNode(ctx: AIContext, target: VehicleState): AIDecision | null {
  const candidates = usableWeapons(ctx, target);
  const best = pickBest(candidates, (c) => c.score, seedFor(ctx, 'engage-weapon'));
  if (best === null) return null;

  const bearing = bearingTo(ctx.self.position, target.position);
  const { moveX, moveY } = computeAlignmentInput(bearing, best.facing);
  const fire = best.bearsNow && best.inRange && best.losClear && best.readyToFire;

  return buildDecision(behaviorForFacing(best.facing), target.id, {
    moveX,
    moveY,
    fire,
    weaponSlot: fire ? best.index : -1,
  });
}

/** Nothing usable to fight with yet — close the distance. */
export function pursueNode(ctx: AIContext, target: VehicleState): AIDecision {
  const bearing = bearingTo(ctx.self.position, target.position);
  return buildDecision('PURSUE', target.id, {
    moveX: Math.cos(bearing),
    moveY: Math.sin(bearing),
    fire: false,
    weaponSlot: -1,
  });
}

/** No live target anywhere in the world. Sit still. */
export function idleNode(_ctx: AIContext): AIDecision {
  return buildDecision('IDLE', null, { moveX: 0, moveY: 0, fire: false, weaponSlot: -1 });
}

// ---------------------------------------------------------------------------
// Top-level decision
// ---------------------------------------------------------------------------

/** Named node registry, exported so a test can assert exactly which node a
 *  given world produced a decision from. */
export const AI_NODES = {
  acquireTarget,
  avoidHazardNode,
  retreatNode,
  ramAndPinNode,
  engageWeaponNode,
  pursueNode,
  idleNode,
} as const;

/**
 * The AI's single entry point. Pure function of `ctx` — reads `ctx.self` and
 * `ctx.world`, never writes to either, and returns nothing but an
 * `InputFrame` wrapped with the behavior label and target id a test can
 * assert against. Priority order below IS the behavior tree; the scored
 * picks inside `acquireTarget` / `engageWeaponNode` are the utility half.
 */
export function decideAI(ctx: AIContext): AIDecision {
  const acquired = acquireTarget(ctx);
  const target = acquired?.vehicle ?? null;

  return (
    avoidHazardNode(ctx, target) ??
    (target !== null ? retreatNode(ctx, target) : null) ??
    (target !== null ? ramAndPinNode(ctx, target) : null) ??
    (target !== null ? engageWeaponNode(ctx, target) : null) ??
    (target !== null ? pursueNode(ctx, target) : idleNode(ctx))
  );
}
