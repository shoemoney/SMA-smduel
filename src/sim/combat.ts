/**
 * The fire pipeline: validate -> consume ammo/battery -> spawn by mode -> accuracy ->
 * damage roll -> (for instant modes) hand off to `@/sim/damage` for the penetration
 * order. No free aim, no turret — a weapon's facing is fixed at construction and must
 * bear toward the target or it cannot fire at all.
 *
 * Determinism note: accuracy and damage are both rolled AT TRIGGER TIME, for every
 * mode including PROJECTILE. "Resolves on intersection" (for a travelling projectile)
 * means the pre-rolled outcome is *released* to the target when the projectile's
 * position reaches it or it expires — not that the outcome is re-rolled then. This
 * keeps a shot's result independent of exact frame timing, which the sim's
 * determinism gate (same seed + same inputs -> identical state) requires.
 */
import type { Rng } from '@/util/rng';
import { getWeapon } from '@/data/rulesets';
import type {
  DriverState,
  Facing,
  MineDeployable,
  TireDef,
  Vec2,
  VehicleState,
  WeaponDef,
  WeaponDeployable,
  WeaponState,
} from '@/sim/types';
import { VEHICLE_LOCAL_FACING, type PenetratingFacing } from '@/sim/types';
import {
  applyMineDamage,
  applyPenetratingDamage,
  applySpikeDamage,
  facingForLocalDirection,
  impactFacingFromPositions,
  isPenetratingFacing,
  rotateVec,
  subtractVec,
  vecLength,
  type MineDamageResult,
  type PenetrationReport,
  type TireHitResult,
} from '@/sim/damage';
import { hitChance } from '@/sim/driver';

// ---------------------------------------------------------------------------
// Accuracy: '@/sim/driver' owns the marksmanship/pivot formula
// (`hitChance(weapon, marksmanship, penalties)`, already clamped to the weapon's own
// [minChance, maxChance]). This module's job is only to assemble `penalties` from
// range, relative motion, and any active smoke/paint cloud — each already a plain
// percentage supplied by the caller (world/driving own those computations; the
// smoke/paint figures themselves come straight off the cloud's own ruleset
// `accuracyPenalty`), so no additional gameplay constant is invented here.
// ---------------------------------------------------------------------------

export interface FireContext {
  readonly rng: Rng;
  readonly marksmanshipSkill: number;
  readonly rangePenaltyPercent: number;
  readonly relativeMotionPenaltyPercent: number;
  readonly smokePenaltyPercent: number;
  readonly paintPenaltyPercent: number;
}

/**
 * Rocket launcher has a minimum effective range; below it, this forces a guaranteed
 * miss. Every weapon also has a maximum `rangeM` — beyond it this is a guaranteed
 * miss too, for every mode (HITSCAN and CONE have no travelling projectile entity to
 * cap their reach physically, so this is the only place their range is enforced; a
 * PROJECTILE's outcome is pre-rolled against this same trigger-time range, matching
 * the ai.ts's own `distance <= def.rangeM` gate so the player and the AI play by the
 * same reach).
 */
export function effectiveHitChance(weaponDef: WeaponDef, ctx: FireContext, rangeM: number): number {
  if (weaponDef.minRangeM !== undefined && rangeM < weaponDef.minRangeM) return 0;
  if (rangeM > weaponDef.rangeM) return 0;
  const penalties =
    ctx.rangePenaltyPercent + ctx.relativeMotionPenaltyPercent + ctx.smokePenaltyPercent + ctx.paintPenaltyPercent;
  return Math.round(hitChance(weaponDef, ctx.marksmanshipSkill, penalties));
}

/** Machine gun is 4 independent checks of 0..1 DP; other weapons roll their RANGE once. */
export function rollDamage(weaponDef: WeaponDef, rng: Rng): number {
  const damage = weaponDef.damage;
  switch (damage.kind) {
    case 'NONE':
      return 0;
    case 'RANGE':
      return rng.int(damage.min, damage.max);
    case 'BURST': {
      let total = 0;
      for (let i = 0; i < damage.checks; i++) {
        total += rng.int(damage.minPerCheck, damage.maxPerCheck);
      }
      return total;
    }
  }
}

// ---------------------------------------------------------------------------
// Facing geometry (fixed mounts, no turret)
// ---------------------------------------------------------------------------

/** The body-local frame is owned by `VEHICLE_LOCAL_FACING` in `@/sim/types` — see the derivation there. This module used to keep its own copy, and that copy is what the 90-degree aim bug lived in. */
const FACING_LOCAL_UNIT = VEHICLE_LOCAL_FACING;

/** World-space unit direction a fixed mount on `facing` points, given the hull's heading. */
export function facingWorldDirection(headingRad: number, facing: Facing): Vec2 {
  if (facing === 'UNDERBODY') throw new RangeError('facingWorldDirection: UNDERBODY has no world direction');
  return rotateVec(FACING_LOCAL_UNIT[facing], headingRad);
}

/**
 * Absolute angle (0..180 degrees) between `local` (the target's direction in the
 * shooter's own local frame) and the centerline of a fixed mount on `facing`. A CONE
 * weapon's actual arc is `coneHalfAngleDeg` either side of this centerline — narrower
 * than the 90-degree quadrant `facingForLocalDirection` tests, which only says which
 * of the four mount facings is broadly nearest.
 */
export function coneAngleDeltaDeg(local: Vec2, facing: PenetratingFacing): number {
  const mount = FACING_LOCAL_UNIT[facing];
  const dot = local.x * mount.x + local.y * mount.y;
  const cross = local.x * mount.y - local.y * mount.x;
  return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
}

// ---------------------------------------------------------------------------
// Step 1: validate
// ---------------------------------------------------------------------------

export type FireFailureReason =
  | 'NO_WEAPON'
  | 'NO_DP'
  | 'DESTROYED'
  | 'SPENT'
  | 'COOLDOWN'
  | 'NO_AMMO'
  | 'NO_BATTERY'
  | 'WRONG_FACING';

export interface FireValidation {
  readonly ok: boolean;
  readonly reason: FireFailureReason | null;
  readonly weaponState: WeaponState | null;
  readonly weaponDef: WeaponDef | null;
}

/**
 * `batteryPerShot` is only optional in `WeaponDef`'s TS type because it is
 * conditional on `usesBattery` (ruleset validation, `checkWeaponInvariants` in
 * `@/data/schema`, requires it whenever `usesBattery` is true). This throws rather
 * than silently defaulting to 1 — a fallback would hide a bad ruleset row instead of
 * failing loudly at the one weapon it actually affects.
 */
function requireBatteryPerShot(weaponDef: WeaponDef): number {
  if (weaponDef.batteryPerShot === undefined) {
    throw new RangeError(`combat: usesBattery weapon "${weaponDef.id}" has no batteryPerShot`);
  }
  return weaponDef.batteryPerShot;
}

export function validateFire(vehicle: VehicleState, weaponSlotIndex: number, targetPosition: Vec2): FireValidation {
  const weaponState = vehicle.weapons[weaponSlotIndex];
  if (weaponState === undefined) {
    return { ok: false, reason: 'NO_WEAPON', weaponState: null, weaponDef: null };
  }
  if (weaponState.dp <= 0) {
    return { ok: false, reason: 'NO_DP', weaponState, weaponDef: null };
  }
  if (weaponState.destroyed) {
    return { ok: false, reason: 'DESTROYED', weaponState, weaponDef: null };
  }
  if (weaponState.spent === true) {
    return { ok: false, reason: 'SPENT', weaponState, weaponDef: null };
  }
  if (weaponState.cooldownRemaining > 0) {
    return { ok: false, reason: 'COOLDOWN', weaponState, weaponDef: null };
  }

  const weaponDef = getWeapon(weaponState.weaponId);
  if (weaponDef.usesBattery === true) {
    const cost = requireBatteryPerShot(weaponDef);
    if (vehicle.battery < cost) return { ok: false, reason: 'NO_BATTERY', weaponState, weaponDef };
  } else if (weaponState.ammo <= 0) {
    return { ok: false, reason: 'NO_AMMO', weaponState, weaponDef };
  }

  const local = rotateVec(subtractVec(targetPosition, vehicle.position), -vehicle.headingRad);
  if (weaponDef.mode === 'CONE') {
    // A CONE weapon's true firing arc is `coneHalfAngleDeg` either side of its mount
    // centerline — narrower than the 90-degree quadrant test below, which every other
    // mode uses. `checkWeaponInvariants` guarantees every CONE weapon has this field.
    if (weaponDef.coneHalfAngleDeg === undefined) {
      throw new RangeError(`combat: CONE weapon "${weaponDef.id}" has no coneHalfAngleDeg`);
    }
    if (!isPenetratingFacing(weaponState.facing) || coneAngleDeltaDeg(local, weaponState.facing) > weaponDef.coneHalfAngleDeg) {
      return { ok: false, reason: 'WRONG_FACING', weaponState, weaponDef };
    }
  } else if (facingForLocalDirection(local) !== weaponState.facing) {
    return { ok: false, reason: 'WRONG_FACING', weaponState, weaponDef };
  }

  return { ok: true, reason: null, weaponState, weaponDef };
}

/**
 * Weapons still mounted and functional. Destroyed weapons disappear from this list,
 * and so does a spent one-shot (fired, unfireable again) — but a spent weapon is
 * NOT destroyed: it still occupies its mount and still absorbs penetrating damage
 * (see `applyPenetratingDamage` in `@/sim/damage`).
 */
export function activeWeapons(vehicle: VehicleState): readonly WeaponState[] {
  return vehicle.weapons.filter((weapon) => !weapon.destroyed && weapon.spent !== true);
}

/** Advances every weapon's cooldown by `elapsedTicks` (called once per sim tick). */
export function tickCooldowns(vehicle: VehicleState, elapsedTicks = 1): VehicleState {
  if (elapsedTicks <= 0) return vehicle;
  return {
    ...vehicle,
    weapons: vehicle.weapons.map((weapon) =>
      weapon.cooldownRemaining <= 0
        ? weapon
        : { ...weapon, cooldownRemaining: Math.max(0, weapon.cooldownRemaining - elapsedTicks) },
    ),
  };
}

// ---------------------------------------------------------------------------
// Steps 3-5: spawn by mode, accuracy, damage
// ---------------------------------------------------------------------------

export interface ProjectileOutcome {
  readonly hit: boolean;
  readonly damage: number;
  readonly facing: PenetratingFacing | null;
}

export interface ProjectileState {
  readonly id: string;
  readonly ownerId: string;
  readonly weaponId: string;
  readonly mountFacing: Facing;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly spawnTick: number;
  readonly maxRangeM: number;
  readonly traveledM: number;
  /** Rolled at trigger time — released to the target on intersection/expiry. */
  readonly outcome: ProjectileOutcome;
}

export function spawnProjectile(
  id: string,
  ownerId: string,
  originPosition: Vec2,
  weaponDef: WeaponDef,
  mountFacing: Facing,
  shooterHeadingRad: number,
  spawnTick: number,
  outcome: ProjectileOutcome,
): ProjectileState {
  if (weaponDef.projectileSpeedMps === undefined) {
    // A speed-0 projectile would never travel (`advanceProjectile` adds nothing to
    // position/traveledM) and never expire (`projectileExpired` tests
    // `traveledM >= maxRangeM`, i.e. `0 >= rangeM`, false forever for rangeM > 0) — a
    // permanent, live hit outcome leaked into the world. Fail loudly instead, exactly
    // as the DEPLOYABLE branch below already does for a missing `deployable` block.
    throw new RangeError(`weapon ${weaponDef.id} has no projectileSpeedMps for PROJECTILE mode`);
  }
  const speed = weaponDef.projectileSpeedMps;
  const direction = facingWorldDirection(shooterHeadingRad, mountFacing);
  return {
    id,
    ownerId,
    weaponId: weaponDef.id,
    mountFacing,
    position: originPosition,
    velocity: { x: direction.x * speed, y: direction.y * speed },
    spawnTick,
    maxRangeM: weaponDef.rangeM,
    traveledM: 0,
    outcome,
  };
}

export function advanceProjectile(projectile: ProjectileState, dtSeconds: number): ProjectileState {
  const dx = projectile.velocity.x * dtSeconds;
  const dy = projectile.velocity.y * dtSeconds;
  return {
    ...projectile,
    position: { x: projectile.position.x + dx, y: projectile.position.y + dy },
    traveledM: projectile.traveledM + vecLength({ x: dx, y: dy }),
  };
}

export function projectileExpired(projectile: ProjectileState): boolean {
  return projectile.traveledM >= projectile.maxRangeM;
}

export interface DeployableState {
  readonly id: string;
  readonly ownerId: string;
  readonly weaponId: string;
  readonly deployable: WeaponDeployable;
  readonly position: Vec2;
  readonly spawnTick: number;
}

/**
 * Deployables (mines, spikes, smoke, oil, paint) trail BEHIND the vehicle's own
 * travel direction, not behind the mount facing — you lay them in your own wake
 * regardless of which side of the hull they're bolted to.
 */
export function spawnDeployable(
  id: string,
  ownerId: string,
  originPosition: Vec2,
  shooterHeadingRad: number,
  weaponDef: WeaponDef,
  dropOffsetM: number,
  spawnTick: number,
): DeployableState {
  const deployable = weaponDef.deployable;
  if (deployable === undefined) {
    throw new RangeError(`weapon ${weaponDef.id} has no deployable definition`);
  }
  const behind = facingWorldDirection(shooterHeadingRad, 'REAR');
  const position: Vec2 = {
    x: originPosition.x + behind.x * dropOffsetM,
    y: originPosition.y + behind.y * dropOffsetM,
  };
  return { id, ownerId, weaponId: weaponDef.id, deployable, position, spawnTick };
}

export function triggerMine(
  vehicle: VehicleState,
  deployable: MineDeployable,
  damage: number,
  rng: Rng,
): { vehicle: VehicleState; result: MineDamageResult } {
  const result = applyMineDamage(vehicle.armorDP, vehicle.tireDP, deployable, damage, rng);
  return {
    vehicle: { ...vehicle, armorDP: result.armorDP, tireDP: result.tireHit?.tireDP ?? vehicle.tireDP },
    result,
  };
}

export function triggerSpikes(
  vehicle: VehicleState,
  tire: TireDef,
  damage: number,
  rng: Rng,
): { vehicle: VehicleState; result: TireHitResult } {
  const result = applySpikeDamage(vehicle.tireDP, tire, damage, rng);
  return { vehicle: { ...vehicle, tireDP: result.tireDP }, result };
}

// ---------------------------------------------------------------------------
// The fire pipeline entry point
// ---------------------------------------------------------------------------

export interface FireTarget {
  readonly position: Vec2;
  readonly headingRad: number;
}

export type FireSpawn =
  | { readonly kind: 'PROJECTILE'; readonly projectile: ProjectileState }
  | { readonly kind: 'DEPLOYABLE'; readonly deployable: DeployableState }
  | { readonly kind: 'INSTANT'; readonly hit: boolean; readonly damage: number; readonly facing: PenetratingFacing | null };

export interface FireResult {
  readonly ok: boolean;
  readonly reason: FireFailureReason | null;
  /** The shooter's vehicle with ammo/battery/cooldown consumed (unchanged on failure). */
  readonly vehicle: VehicleState;
  readonly ammoConsumed: boolean;
  readonly batteryConsumed: number;
  readonly spawn: FireSpawn | null;
}

export interface FireCommand {
  readonly vehicle: VehicleState;
  readonly weaponSlotIndex: number;
  readonly target: FireTarget;
  readonly ctx: FireContext;
  readonly tick: number;
  /** Id for the spawned projectile/deployable entity (PROJECTILE/DEPLOYABLE modes only). */
  readonly spawnedEntityId: string;
  /** Distance behind the hull a DEPLOYABLE is laid down (ignored for other modes). */
  readonly deployDropOffsetM: number;
}

export function fire(cmd: FireCommand): FireResult {
  const { vehicle, weaponSlotIndex, target, ctx, tick } = cmd;
  const validation = validateFire(vehicle, weaponSlotIndex, target.position);
  if (!validation.ok || validation.weaponDef === null || validation.weaponState === null) {
    return { ok: false, reason: validation.reason, vehicle, ammoConsumed: false, batteryConsumed: 0, spawn: null };
  }
  const { weaponDef, weaponState } = validation;

  // Step 2: consume ammo or battery AT TRIGGER TIME — a miss still costs the round.
  const usesBattery = weaponDef.usesBattery === true;
  const batteryCost = usesBattery ? requireBatteryPerShot(weaponDef) : 0;
  const ammoConsumed = !usesBattery;

  const rangeM = vecLength(subtractVec(target.position, vehicle.position));

  // Steps 4-5: accuracy then damage, rolled now regardless of mode (see module doc).
  // A DEPLOYABLE doesn't "aim" at a range at all (it drops behind the hull — see
  // `spawnDeployable`), so it skips `effectiveHitChance`'s range logic entirely
  // rather than reading a hardcoded 100: every deployable's own ruleset row already
  // pins baseAccuracy/minChance/maxChance to 100, so `maxChance` IS that guarantee.
  const isDeployable = weaponDef.mode === 'DEPLOYABLE';
  const chance = isDeployable ? weaponDef.maxChance : effectiveHitChance(weaponDef, ctx, rangeM);
  const hit = ctx.rng.chance(chance);
  const damage = !isDeployable && hit ? rollDamage(weaponDef, ctx.rng) : 0;
  const facing = !isDeployable && hit ? impactFacingFromPositions(vehicle.position, target.position, target.headingRad) : null;

  let spawn: FireSpawn;
  if (weaponDef.mode === 'PROJECTILE') {
    spawn = {
      kind: 'PROJECTILE',
      projectile: spawnProjectile(
        cmd.spawnedEntityId,
        vehicle.id,
        vehicle.position,
        weaponDef,
        weaponState.facing,
        vehicle.headingRad,
        tick,
        { hit, damage, facing },
      ),
    };
  } else if (isDeployable) {
    spawn = {
      kind: 'DEPLOYABLE',
      deployable: spawnDeployable(
        cmd.spawnedEntityId,
        vehicle.id,
        vehicle.position,
        vehicle.headingRad,
        weaponDef,
        cmd.deployDropOffsetM,
        tick,
      ),
    };
  } else {
    spawn = { kind: 'INSTANT', hit, damage, facing };
  }

  // Step 6: only the active weapon fires — enforced by the caller only ever passing
  // that weapon's slot index. Holding fire repeats by calling `fire()` again once
  // `cooldownRemaining` reaches 0 (see `tickCooldowns`).
  const weaponsAfter = vehicle.weapons.map((weapon, index) => {
    if (index !== weaponSlotIndex) return weapon;
    const spentOneShot = weaponDef.removeAfterFire === true;
    return {
      ...weapon,
      ammo: ammoConsumed ? Math.max(0, weapon.ammo - 1) : weapon.ammo,
      cooldownRemaining: weaponDef.cooldownTicks,
      // `spent`, NOT `destroyed`: a spent launcher tube is still bolted to the hull
      // and still absorbs penetrating damage (`applyPenetratingDamage` in
      // `@/sim/damage` only skips weapons where `destroyed` is true). `destroyed`
      // is left untouched here — it is set only by combat damage, when `dp` hits 0.
      spent: weapon.spent === true || spentOneShot,
    };
  });

  return {
    ok: true,
    reason: null,
    vehicle: {
      ...vehicle,
      battery: usesBattery ? vehicle.battery - batteryCost : vehicle.battery,
      weapons: weaponsAfter,
    },
    ammoConsumed,
    batteryConsumed: batteryCost,
    spawn,
  };
}

// ---------------------------------------------------------------------------
// Handing a resolved hit off to the penetration order
// ---------------------------------------------------------------------------

export interface EngagementTarget {
  readonly vehicle: VehicleState;
  readonly driver: DriverState;
}

export interface ResolvedShot {
  readonly target: EngagementTarget;
  readonly report: PenetrationReport;
}

/** Applies an already-hit shot's rolled damage to the target via the penetration chain. */
export function applyResolvedShot(
  target: EngagementTarget,
  facing: PenetratingFacing,
  damage: number,
  rng: Rng,
): ResolvedShot {
  const { vehicle, driver, report } = applyPenetratingDamage(target.vehicle, target.driver, facing, damage, rng);
  return { target: { vehicle, driver }, report };
}

