/**
 * Vehicle constructor: capacity math + legality engine.
 *
 * Every priced/weighed/spaced number here is read from the ruleset tables
 * through `@/data/rulesets` — nothing here hardcodes a body price, a chassis
 * multiplier, a weapon's ammo cost, etc. There is deliberately no
 * "max weapon slots" constant in this module: docs/SPEC.md's Construction
 * section defines the mount budget purely by spaces, and no ruleset table
 * carries a slot cap, so `computeBuild` never rejects a design for mount
 * *count* alone — only for spaces, cost, and the other violations below. The
 * fixed number of mount rows the builder UI draws is a UI layout constant,
 * not a legality rule, and lives in `@/ui/hud` (`MAX_WEAPON_ROWS`) instead.
 */
import {
  accelerationTiers,
  getBody,
  getChassis,
  getPlant,
  getSuspension,
  getTire,
  getWeapon,
  hasBody,
  hasChassis,
  hasPlant,
  hasSuspension,
  hasTire,
  hasWeapon,
} from '@/data/rulesets';
import { FACINGS, mapFacings, sumArmor } from '@/sim/types';
import type { BuildMetrics, BuildViolation, MountedWeapon, VehicleDesign, WeaponDef } from '@/sim/types';

/**
 * A VehicleDesign plus the two build-time inputs the formulas need that
 * aren't part of the persisted design shape: how much cargo is loaded.
 * Both default to zero (an empty hold).
 */
export interface BuildDesign extends VehicleDesign {
  cargoWeightLb?: number;
  cargoSpaces?: number;
}

interface ResolvedWeapon {
  mounted: MountedWeapon;
  def: WeaponDef | undefined;
}

function resolveWeapons(design: BuildDesign): ResolvedWeapon[] {
  return design.weapons.map((mounted) => ({
    mounted,
    def: hasWeapon(mounted.weaponId) ? getWeapon(mounted.weaponId) : undefined,
  }));
}

/** Tiers sorted by descending powerRatio so the first match is the best-fitting one. */
function orderedAccelerationTiers() {
  return [...accelerationTiers()].sort((a, b) => b.powerRatio - a.powerRatio);
}

/**
 * Whole rounds actually usable in the weight/cost math: negative or
 * fractional input is reported as a violation (below) but never allowed to
 * poison a sum with a negative or non-integer contribution.
 */
function ammoForCalc(ammo: number, ammoCapacity: number): number {
  const safe = Number.isFinite(ammo) ? Math.trunc(ammo) : 0;
  return Math.min(Math.max(safe, 0), ammoCapacity);
}

/**
 * Whole armor points actually usable in the weight/cost math, same
 * clamp-and-report treatment as `ammoForCalc`.
 */
function armorPointsForCalc(armor: VehicleDesign['armor']): number {
  return sumArmor(
    mapFacings((facing) => {
      const points = armor[facing];
      return Number.isFinite(points) ? Math.max(0, Math.trunc(points)) : 0;
    }),
  );
}

export function computeBuild(design: BuildDesign): BuildMetrics {
  const violations: BuildViolation[] = [];

  const bodyOk = hasBody(design.bodyId);
  const chassisOk = hasChassis(design.chassisId);
  const suspensionOk = hasSuspension(design.suspensionId);
  const plantOk = hasPlant(design.plantId);
  const tireOk = hasTire(design.tireId);

  if (!bodyOk) violations.push({ code: 'MISSING_COMPONENT', message: `unknown body id "${design.bodyId}"` });
  if (!chassisOk) violations.push({ code: 'MISSING_COMPONENT', message: `unknown chassis id "${design.chassisId}"` });
  if (!suspensionOk) {
    violations.push({ code: 'MISSING_COMPONENT', message: `unknown suspension id "${design.suspensionId}"` });
  }
  if (!plantOk) violations.push({ code: 'MISSING_COMPONENT', message: `unknown plant id "${design.plantId}"` });
  if (!tireOk) violations.push({ code: 'MISSING_COMPONENT', message: `unknown tire id "${design.tireId}"` });

  const body = bodyOk ? getBody(design.bodyId) : undefined;
  const chassis = chassisOk ? getChassis(design.chassisId) : undefined;
  const suspension = suspensionOk ? getSuspension(design.suspensionId) : undefined;
  const plant = plantOk ? getPlant(design.plantId) : undefined;
  const tire = tireOk ? getTire(design.tireId) : undefined;

  const resolvedWeapons = resolveWeapons(design);
  for (const { mounted, def } of resolvedWeapons) {
    if (def === undefined) {
      violations.push({ code: 'MISSING_COMPONENT', message: `unknown weapon id "${mounted.weaponId}"` });
    }
  }

  for (const { mounted, def } of resolvedWeapons) {
    if (def === undefined) continue;
    if (!def.allowedFacings.includes(mounted.facing)) {
      violations.push({
        code: 'ILLEGAL_FACING',
        message: `${def.name} cannot be mounted ${mounted.facing} (allowed: ${def.allowedFacings.join(', ')})`,
      });
    }
    if (!Number.isInteger(mounted.ammo)) {
      violations.push({
        code: 'NON_INTEGER_AMMO',
        message: `${def.name} ammo must be a whole number of rounds (got ${mounted.ammo})`,
      });
    }
    if (mounted.ammo < 0) {
      violations.push({
        code: 'NEGATIVE_AMMO',
        message: `${def.name} ammo cannot be negative (got ${mounted.ammo})`,
      });
    }
    if (mounted.ammo > def.ammoCapacity) {
      violations.push({
        code: 'AMMO_OVER_CAPACITY',
        message: `${def.name} carries ${mounted.ammo} rounds, over its ${def.ammoCapacity}-round capacity`,
      });
    }
  }

  for (const facing of FACINGS) {
    const points = design.armor[facing];
    if (!Number.isInteger(points)) {
      violations.push({
        code: 'NON_INTEGER_ARMOR',
        message: `${facing} armor must be a whole number of points (got ${points})`,
      });
    }
    if (points < 0) {
      violations.push({ code: 'NEGATIVE_ARMOR', message: `${facing} armor is negative (${points})` });
    }
  }

  const cargoWeightLb = design.cargoWeightLb ?? 0;
  const cargoSpaces = design.cargoSpaces ?? 0;
  const armorPoints = armorPointsForCalc(design.armor);

  const tireWeight = tire ? 4 * tire.weightLb : 0;
  const tireCost = tire ? 4 * tire.price : 0;

  let weaponWeight = 0;
  let weaponSpaces = 0;
  let weaponCost = 0;
  for (const { mounted, def } of resolvedWeapons) {
    if (def === undefined) continue;
    const safeAmmo = ammoForCalc(mounted.ammo, def.ammoCapacity);
    weaponWeight += def.weightLb + safeAmmo * def.ammoWeightLb;
    weaponSpaces += def.spaces;
    weaponCost += def.price + safeAmmo * def.ammoCost;
  }

  const armorWeight = body ? armorPoints * body.armorWeightPerPoint : 0;
  const armorCost = body ? armorPoints * body.armorCostPerPoint : 0;

  const weightTotal =
    (body?.weightLb ?? 0) + (plant?.weightLb ?? 0) + tireWeight + weaponWeight + armorWeight + cargoWeightLb;

  const spacesUsed = (plant?.spaces ?? 0) + weaponSpaces + cargoSpaces;
  // A "?????"-worthy unknown, not a plausible 0 — see maxLoadLb/handlingClass/topSpeedMph below.
  const spacesTotal = body ? body.spaces : NaN;

  const bodyPrice = body?.price ?? 0;
  const chassisBodyContribution = chassis ? bodyPrice * chassis.bodyPriceModifier : 0;
  const suspensionBodyContribution = suspension ? bodyPrice * suspension.bodyPriceModifier : 0;

  // Rounded defensively: every current ruleset combination already lands on an
  // integer dollar, but "integer dollars" is a hard rule, not an accident of data.
  const costTotal = Math.round(
    bodyPrice +
      chassisBodyContribution +
      suspensionBodyContribution +
      (plant?.price ?? 0) +
      tireCost +
      weaponCost +
      armorCost,
  );

  // These three are derived FROM a resolved component, so a missing component
  // must show as unmistakably unknown, never as a plausible-looking number —
  // docs/SPEC.md: "must show `?????` for derived values rather than a wrong
  // number." 0 fails that: e.g. a van with light suspension has a genuine
  // handlingClass of 0, indistinguishable from "unknown" if we defaulted to 0.
  // NaN stays a `number` (no type change needed) but is never a real reading,
  // propagates through arithmetic instead of masquerading as one, and compares
  // false against everything below — so it can't spuriously trip OVER_WEIGHT
  // or OVER_SPACES on top of the MISSING_COMPONENT violation already recorded.
  const maxLoadLb = body && chassis ? Math.floor(body.baseMaxLoadLb * chassis.loadMultiplier) : NaN;
  const handlingClass = body && suspension ? suspension.handlingClass[body.class] : NaN;
  const topSpeedMph = plant ? plant.topSpeedMph : NaN;

  let accelMphPerSec: number | null = null;
  if (plant) {
    for (const tier of orderedAccelerationTiers()) {
      // tier.powerRatio is a ruleset-supplied decimal approximation of 1/1, 1/2,
      // 1/3 — multiplying weight by it directly (weight * 0.33334) drifts past
      // the true 1/3 boundary for large weights and rejects the documented
      // `power >= weight/3` exact case. Comparing against the rounded integer
      // reciprocal instead (power * 3 >= weight) is exact for every tier here
      // and isn't sensitive to how many decimal places the ruleset chose.
      const ratioDenominator = Math.round(1 / tier.powerRatio);
      if (plant.power * ratioDenominator >= weightTotal) {
        accelMphPerSec = tier.mphPerSecond;
        break;
      }
    }
    if (accelMphPerSec === null) {
      violations.push({ code: 'UNDERPOWERED', message: `plant power ${plant.power} cannot move ${weightTotal} lb` });
    }
  } else {
    violations.push({ code: 'UNDERPOWERED', message: 'no power plant mounted' });
  }

  if (weightTotal > maxLoadLb) {
    violations.push({ code: 'OVER_WEIGHT', message: `${weightTotal} lb exceeds max load ${maxLoadLb} lb` });
  }
  if (spacesUsed > spacesTotal) {
    violations.push({ code: 'OVER_SPACES', message: `${spacesUsed} spaces used exceeds ${spacesTotal} available` });
  }

  return {
    costTotal,
    weightTotal,
    maxLoadLb,
    spacesUsed,
    spacesTotal,
    handlingClass,
    accelMphPerSec,
    topSpeedMph,
    legal: violations.length === 0,
    violations,
  };
}

export function validateDesign(design: BuildDesign, cash: number): BuildViolation[] {
  const metrics = computeBuild(design);
  const violations = [...metrics.violations];
  if (metrics.costTotal > cash) {
    violations.push({ code: 'OVER_BUDGET', message: `build costs $${metrics.costTotal}, only $${cash} available` });
  }
  return violations;
}
