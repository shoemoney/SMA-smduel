/**
 * Directional damage and the penetration order. Pure functions only — no RNG side
 * effects beyond the `Rng` passed in, no mutation of inputs. `combat.ts` calls these
 * once a shot's outcome (hit + raw damage) has already been decided.
 */
import { rearPenetrationWeights } from '@/data/rulesets';
import type { Rng } from '@/util/rng';
import type {
  ArmorRecord,
  CargoState,
  DriverState,
  Facing,
  MineDeployable,
  TireDef,
  TireDPTuple,
  Vec2,
  VehicleState,
  WeaponState,
} from '@/sim/types';

// ---------------------------------------------------------------------------
// Vector / facing geometry
// ---------------------------------------------------------------------------

export function rotateVec(v: Vec2, angleRad: number): Vec2 {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

export function subtractVec(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vecLength(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/**
 * FRONT / REAR / LEFT / RIGHT — the four facings a directional-quadrant test can
 * produce. UNDERBODY is reachable only via mines (`applyMineDamage`), never via the
 * quadrant test, so it is deliberately excluded from this type.
 */
export type PenetratingFacing = 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT';

export function isPenetratingFacing(facing: Facing): facing is PenetratingFacing {
  return facing !== 'UNDERBODY';
}

/**
 * Which quadrant of the target's local frame `local` falls in.
 *   abs(x) > abs(y)  ->  x > 0 ? RIGHT : LEFT
 *   otherwise         ->  y > 0 ? FRONT : REAR
 * Exact diagonals (abs(x) === abs(y)) fall through to the FRONT/REAR branch.
 */
export function facingForLocalDirection(local: Vec2): PenetratingFacing {
  if (Math.abs(local.x) > Math.abs(local.y)) {
    return local.x > 0 ? 'RIGHT' : 'LEFT';
  }
  return local.y > 0 ? 'FRONT' : 'REAR';
}

/**
 * `worldImpactDir` points FROM the target TOWARD the origin of the incoming attack
 * (i.e. "which direction did this hit come from"). Rotating that vector into the
 * target's local frame and reading the quadrant gives the struck facing — a shot
 * arriving from behind the target (impact dir opposite the target's forward vector)
 * lands on REAR, one arriving from dead ahead lands on FRONT.
 */
export function impactFacing(worldImpactDir: Vec2, targetHeadingRad: number): PenetratingFacing {
  return facingForLocalDirection(rotateVec(worldImpactDir, -targetHeadingRad));
}

/** Convenience wrapper: impact facing from the attacker's and target's world positions. */
export function impactFacingFromPositions(
  attackerPosition: Vec2,
  targetPosition: Vec2,
  targetHeadingRad: number,
): PenetratingFacing {
  return impactFacing(subtractVec(attackerPosition, targetPosition), targetHeadingRad);
}

// ---------------------------------------------------------------------------
// Weighted pick (used only by the REAR penetration table)
// ---------------------------------------------------------------------------

function weightedPick<T extends string>(rng: Rng, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) throw new RangeError('weightedPick: total weight must be > 0');
  let roll = rng.int(0, total - 1);
  for (const [key, weight] of entries) {
    if (roll < weight) return key;
    roll -= weight;
  }
  const last = entries[entries.length - 1];
  if (last === undefined) throw new RangeError('weightedPick: no entries provided');
  return last[0];
}

// ---------------------------------------------------------------------------
// Tire helpers (fixed 4-tuple; switched rather than indexed to stay
// noUncheckedIndexedAccess-safe without assertions)
// ---------------------------------------------------------------------------

function getTireDP(tuple: TireDPTuple, index: number): number {
  switch (index) {
    case 0:
      return tuple[0];
    case 1:
      return tuple[1];
    case 2:
      return tuple[2];
    case 3:
      return tuple[3];
    default:
      throw new RangeError(`tire index out of range: ${index}`);
  }
}

function setTireDP(tuple: TireDPTuple, index: number, value: number): TireDPTuple {
  switch (index) {
    case 0:
      return [value, tuple[1], tuple[2], tuple[3]];
    case 1:
      return [tuple[0], value, tuple[2], tuple[3]];
    case 2:
      return [tuple[0], tuple[1], value, tuple[3]];
    case 3:
      return [tuple[0], tuple[1], tuple[2], value];
    default:
      throw new RangeError(`tire index out of range: ${index}`);
  }
}

export interface TireHitResult {
  readonly tireDP: TireDPTuple;
  readonly tireIndex: number;
  readonly damageApplied: number;
  readonly destroyed: boolean;
}

export function applyTireDamage(tireDP: TireDPTuple, index: number, amount: number): TireHitResult {
  const current = getTireDP(tireDP, index);
  if (amount <= 0 || current <= 0) {
    return { tireDP, tireIndex: index, damageApplied: 0, destroyed: current <= 0 };
  }
  const applied = Math.min(amount, current);
  const next = current - applied;
  return { tireDP: setTireDP(tireDP, index, next), tireIndex: index, damageApplied: applied, destroyed: next <= 0 };
}

/**
 * Spikes hit ELIGIBLE TIRES ONLY and deal ZERO against spike-immune (solid) tires —
 * per the ruleset flag on the mounted tire, not a hard-coded id check.
 */
export function applySpikeDamage(tireDP: TireDPTuple, tire: TireDef, damage: number, rng: Rng): TireHitResult {
  const index = rng.int(0, 3);
  if (tire.spikeImmune) {
    return { tireDP, tireIndex: index, damageApplied: 0, destroyed: getTireDP(tireDP, index) <= 0 };
  }
  return applyTireDamage(tireDP, index, damage);
}

export interface MineDamageResult {
  readonly armorDP: ArmorRecord;
  readonly underbodyAbsorbed: number;
  readonly overflow: number;
  readonly tireHit: TireHitResult | null;
}

/** Mines strike UNDERBODY armor directly, then may splash a random tire with any overflow. */
export function applyMineDamage(
  armorDP: ArmorRecord,
  tireDP: TireDPTuple,
  deployable: MineDeployable,
  damage: number,
  rng: Rng,
): MineDamageResult {
  const before = armorDP[deployable.targetsFacing];
  const absorbed = Math.min(damage, before);
  const newArmorDP: ArmorRecord = { ...armorDP, [deployable.targetsFacing]: before - absorbed };
  const overflow = damage - absorbed;
  const tireHit = deployable.tireSplash && overflow > 0 ? applyTireDamage(tireDP, rng.int(0, 3), overflow) : null;
  return { armorDP: newArmorDP, underbodyAbsorbed: absorbed, overflow, tireHit };
}

// ---------------------------------------------------------------------------
// Driver / cargo damage
// ---------------------------------------------------------------------------

export interface DriverDamageResult {
  readonly driver: DriverState;
  readonly armorDamageApplied: number;
  readonly healthDamageApplied: number;
  readonly defeated: boolean;
}

/** Driver damage consumes body armor before natural health. Natural health 0 = defeated. */
export function applyDriverDamage(driver: DriverState, amount: number): DriverDamageResult {
  if (amount <= 0) {
    return { driver, armorDamageApplied: 0, healthDamageApplied: 0, defeated: driver.naturalHealth <= 0 };
  }
  const armorDamageApplied = Math.min(amount, driver.bodyArmor);
  const remaining = amount - armorDamageApplied;
  const healthDamageApplied = Math.min(remaining, driver.naturalHealth);
  const driverOut: DriverState = {
    ...driver,
    bodyArmor: driver.bodyArmor - armorDamageApplied,
    naturalHealth: driver.naturalHealth - healthDamageApplied,
  };
  return { driver: driverOut, armorDamageApplied, healthDamageApplied, defeated: driverOut.naturalHealth <= 0 };
}

export interface CargoDamageResult {
  readonly cargo: CargoState;
  readonly damageApplied: number;
  /** True once integrity has hit 0 — the payload/salvage is lost and its task fails. */
  readonly failed: boolean;
}

export function applyCargoDamage(cargo: CargoState, amount: number): CargoDamageResult {
  if (amount <= 0 || cargo.integrity <= 0) {
    return { cargo, damageApplied: 0, failed: cargo.integrity <= 0 };
  }
  const applied = Math.min(amount, cargo.integrity);
  const cargoOut: CargoState = { ...cargo, integrity: cargo.integrity - applied };
  return { cargo: cargoOut, damageApplied: applied, failed: cargoOut.integrity <= 0 };
}

// ---------------------------------------------------------------------------
// Main penetration chain (FRONT / LEFT / RIGHT / REAR — UNDERBODY goes through
// applyMineDamage instead, it never has mounted weapons or a "beyond" component)
// ---------------------------------------------------------------------------

export interface WeaponHitReport {
  readonly weaponId: string;
  readonly damageApplied: number;
  readonly destroyed: boolean;
}

export interface CargoHitReport {
  readonly cargoId: string;
  readonly damageApplied: number;
  readonly failed: boolean;
}

export interface PenetrationReport {
  readonly facing: PenetratingFacing;
  readonly incomingDamage: number;
  readonly armorAbsorbed: number;
  readonly weaponHits: readonly WeaponHitReport[];
  readonly plantDamageApplied: number;
  readonly plantDestroyed: boolean;
  readonly driverArmorDamageApplied: number;
  readonly driverHealthDamageApplied: number;
  readonly driverDefeated: boolean;
  readonly cargoHits: readonly CargoHitReport[];
  /** Damage left with nowhere left to go (every downstream component exhausted). */
  readonly overflowDissipated: number;
}

export interface PenetrationResult {
  readonly vehicle: VehicleState;
  readonly driver: DriverState;
  readonly report: PenetrationReport;
}

type RearComponent = 'plant' | 'driver' | 'cargo';

/**
 * REAR overflow — after armor and rear-mounted weapons — has no published sequence
 * (the manual never documents one), so it is resolved as a weighted lottery over the
 * components a rear hit could plausibly reach, re-rolled per remaining POINT of
 * damage (not per remaining component — see the loop in `applyPenetratingDamage`).
 * Fidelity: Reconstruction. Weights themselves live in weapons.json's
 * `_reconstruction.rearPenetrationWeights` (via `@/data/rulesets`), never as a TS
 * literal, so a designer can retune rear-hit lethality without touching this file.
 * The power plant sits at the rear of every body in this fiction, so it gets first
 * crack; the cabin and cargo bay are progressively further forward/enclosed.
 */

export function applyPenetratingDamage(
  vehicle: VehicleState,
  driver: DriverState,
  facing: PenetratingFacing,
  incomingDamage: number,
  rng: Rng,
): PenetrationResult {
  const armorBefore = vehicle.armorDP[facing];
  const armorAbsorbed = Math.max(0, Math.min(incomingDamage, armorBefore));
  const newArmorDP: ArmorRecord = { ...vehicle.armorDP, [facing]: armorBefore - armorAbsorbed };
  let overflow = Math.max(0, incomingDamage - armorAbsorbed);

  // Step 2: overflow damages weapons MOUNTED ON THAT FACING, in mount order.
  const weaponHits: WeaponHitReport[] = [];
  const newWeapons: WeaponState[] = vehicle.weapons.map((weapon) => {
    if (overflow <= 0 || weapon.destroyed || weapon.facing !== facing) return weapon;
    const applied = Math.min(overflow, weapon.dp);
    if (applied <= 0) return weapon;
    overflow -= applied;
    const newDp = weapon.dp - applied;
    const destroyed = newDp <= 0;
    weaponHits.push({ weaponId: weapon.weaponId, damageApplied: applied, destroyed });
    return { ...weapon, dp: newDp, destroyed };
  });

  let plantDP = vehicle.plantDP;
  let plantDamageApplied = 0;
  let currentDriver = driver;
  let driverArmorDamageApplied = 0;
  let driverHealthDamageApplied = 0;
  const cargoHits: CargoHitReport[] = [];
  let currentCargo = vehicle.cargo;

  /** Applies up to `amount` to the plant. Returns how much was actually applied. */
  const hitPlant = (amount: number): number => {
    if (amount <= 0 || plantDP <= 0) return 0;
    const applied = Math.min(amount, plantDP);
    plantDP -= applied;
    plantDamageApplied += applied;
    return applied;
  };

  /** Applies up to `amount` to the driver (armor then health). Returns how much landed. */
  const hitDriver = (amount: number): number => {
    if (amount <= 0) return 0;
    if (currentDriver.bodyArmor + currentDriver.naturalHealth <= 0) return 0;
    const result = applyDriverDamage(currentDriver, amount);
    driverArmorDamageApplied += result.armorDamageApplied;
    driverHealthDamageApplied += result.healthDamageApplied;
    currentDriver = result.driver;
    return result.armorDamageApplied + result.healthDamageApplied;
  };

  /**
   * Applies up to `amount` to the first cargo item with integrity remaining,
   * merging into that item's existing `cargoHits` entry (rather than pushing a
   * new one) so a REAR hit distributed one point at a time still reports a
   * single per-item total. Returns how much landed.
   */
  const hitCargo = (amount: number): number => {
    if (amount <= 0) return 0;
    const index = currentCargo.findIndex((item) => item.integrity > 0);
    if (index === -1) return 0;
    const target = currentCargo[index];
    if (target === undefined) return 0;
    const result = applyCargoDamage(target, amount);
    const existingIndex = cargoHits.findIndex((hit) => hit.cargoId === target.id);
    if (existingIndex === -1) {
      cargoHits.push({ cargoId: target.id, damageApplied: result.damageApplied, failed: result.failed });
    } else {
      const existing = cargoHits[existingIndex];
      if (existing !== undefined) {
        cargoHits[existingIndex] = {
          cargoId: target.id,
          damageApplied: existing.damageApplied + result.damageApplied,
          failed: result.failed,
        };
      }
    }
    currentCargo = currentCargo.map((item, i) => (i === index ? result.cargo : item));
    return result.damageApplied;
  };

  if (facing === 'FRONT') {
    // FRONT overflow then reaches the power plant, then the driver. (Exact order.)
    overflow -= hitPlant(overflow);
    overflow -= hitDriver(overflow);
  } else if (facing === 'LEFT' || facing === 'RIGHT') {
    // SIDE overflow can reach driver, plant, or cargo after side weapons.
    // Reconstruction: fixed order (driver, then plant, then cargo) — the manual
    // only says these three are reachable, not in what order.
    overflow -= hitDriver(overflow);
    overflow -= hitPlant(overflow);
    overflow -= hitCargo(overflow);
  } else {
    // REAR: data-driven weighted table (weapons.json's
    // `_reconstruction.rearPenetrationWeights`, via `@/data/rulesets`), re-rolled per
    // remaining POINT of damage — not per component exhaustion — so a large hit
    // spreads probabilistically across plant/driver/cargo instead of always dumping
    // the whole shot into whichever component the first roll lands on.
    const weights = rearPenetrationWeights();
    let guard = 0;
    const guardLimit = incomingDamage + 8; // one iteration per point, plus slack for early breaks
    while (overflow > 0 && guard < guardLimit) {
      guard += 1;
      const available: Array<readonly [RearComponent, number]> = [];
      if (plantDP > 0) available.push(['plant', weights.plant]);
      if (currentDriver.bodyArmor + currentDriver.naturalHealth > 0) {
        available.push(['driver', weights.driver]);
      }
      if (currentCargo.some((item) => item.integrity > 0)) {
        available.push(['cargo', weights.cargo]);
      }
      if (available.length === 0) break;
      const chosen = weightedPick(rng, available);
      const point = Math.min(1, overflow);
      if (chosen === 'plant') overflow -= hitPlant(point);
      else if (chosen === 'driver') overflow -= hitDriver(point);
      else overflow -= hitCargo(point);
    }
  }

  // Report the TRANSITION this shot caused, not just the resulting state — a hit
  // that lands after the plant/driver was already at 0 must not re-report the
  // destroy/defeat event every time.
  const plantDestroyed = plantDP <= 0 && vehicle.plantDP > 0;
  const driverDefeated = currentDriver.naturalHealth <= 0 && driver.naturalHealth > 0;

  return {
    vehicle: { ...vehicle, armorDP: newArmorDP, weapons: newWeapons, plantDP, cargo: currentCargo },
    driver: currentDriver,
    report: {
      facing,
      incomingDamage,
      armorAbsorbed,
      weaponHits,
      plantDamageApplied,
      plantDestroyed,
      driverArmorDamageApplied,
      driverHealthDamageApplied,
      driverDefeated,
      cargoHits,
      overflowDissipated: overflow,
    },
  };
}
