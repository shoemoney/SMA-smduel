/**
 * Salvage yard interior: sell the active car outright, strip and sell one
 * mounted (non-destroyed) weapon, or sell off abstract salvage cargo picked
 * up on the road. Every payout runs through `@/sim/economy`'s `saleValue`
 * (originalCost, condition) — the same formula the rest of the game uses to
 * price a used vehicle — so nothing here invents a second pricing curve.
 * Wreck searching itself (`salvageRoll`) happens on the road, not here; this
 * building only ever sells what is already in the driver's possession.
 */
import { getWeapon } from '@/data/rulesets';
import { currentValue, purchaseValue, saleValue } from '@/sim/economy';
import type { CargoState, VehicleState, WeaponState } from '@/sim/types';
import { t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
import {
  type BuildingContext,
  type BuildingEngine,
  cargoConditionFraction,
  cargoOriginalCostEstimate,
  closedAction,
  facilityOpenNow,
  headerFor,
  leaveAction,
  LEAVE_ACTION_ID,
} from '@/ui/buildings/shared';

export const SALVAGE_KIND = 'salvage';

export interface SalvageState {
  readonly context: BuildingContext;
}

export function createSalvageState(context: BuildingContext): SalvageState {
  return { context };
}

export function vehicleSaleValue(vehicle: VehicleState): number {
  const original = purchaseValue(vehicle);
  const condition = original > 0 ? currentValue(vehicle) / original : 1;
  return saleValue(original, condition);
}

export function weaponSaleValue(weapon: WeaponState): number {
  const def = getWeapon(weapon.weaponId);
  const condition = weapon.maxDP > 0 ? weapon.dp / weapon.maxDP : 0;
  return saleValue(def.price, condition);
}

export function salvageCargoSaleValue(cargo: CargoState): number {
  return saleValue(cargoOriginalCostEstimate(cargo), cargoConditionFraction(cargo));
}

export function salvageActions(state: SalvageState): MenuAction[] {
  const ctx = state.context;
  if (!facilityOpenNow(SALVAGE_KIND, ctx)) return [closedAction(SALVAGE_KIND)];

  const actions: MenuAction[] = [];
  const vehicle = ctx.vehicle;

  if (vehicle !== null) {
    const price = vehicleSaleValue(vehicle);
    actions.push({
      id: 'sell-car',
      label: t('building.salvage.sellCar', { car: vehicle.design.name, price }),
      eligible: true,
    });

    vehicle.weapons.forEach((weapon, index) => {
      if (weapon.destroyed) return;
      const def = getWeapon(weapon.weaponId);
      const price = weaponSaleValue(weapon);
      actions.push({
        id: `sell-weapon-${index}`,
        label: t('building.salvage.sellWeapon', { weapon: def.name, facing: weapon.facing, price }),
        eligible: true,
      });
    });

    vehicle.cargo.forEach((cargo, index) => {
      if (cargo.kind !== 'salvage') return;
      const price = salvageCargoSaleValue(cargo);
      actions.push({
        id: `sell-cargo-${index}`,
        label: t('building.salvage.sellCargo', { price }),
        eligible: true,
      });
    });
  } else {
    actions.push({ id: 'no-vehicle', label: t('building.salvage.noVehicleLabel'), eligible: false, reason: t('building.noVehicle') });
  }

  actions.push(leaveAction());
  return actions;
}

export const salvageEngine: BuildingEngine<SalvageState> = {
  actions: salvageActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    const ctx = state.context;
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (actionId === 'closed' || actionId === 'no-vehicle') return { state, exit: false };

    const vehicle = ctx.vehicle;
    if (vehicle === null) return { state, exit: false };

    if (actionId === 'sell-car') {
      const price = vehicleSaleValue(vehicle);
      return {
        state: {
          context: {
            ...ctx,
            driver: { ...ctx.driver, cash: ctx.driver.cash + price },
            vehicle: null,
            // A sold car can never be "in storage" - vehicleStored is only
            // ever meaningful while `vehicle` is non-null (see
            // BuildingContext's own doc comment). Leaving it true here is
            // exactly the desync @/ui/buildings/garage's retrieveCar row
            // guards against: a dead "Retrieve Car" button with a price on
            // it that can never succeed (economy.ts's applyService refuses
            // every VEHICLE_SERVICES call once vehicle is null).
            vehicleStored: false,
            fleetSize: Math.max(0, ctx.fleetSize - 1),
          },
        },
        exit: false,
      };
    }

    if (actionId.startsWith('sell-weapon-')) {
      const index = Number.parseInt(actionId.slice('sell-weapon-'.length), 10);
      const weapon = vehicle.weapons[index];
      if (weapon === undefined) return { state, exit: false };
      const price = weaponSaleValue(weapon);
      // Strip the SAME index out of `design.weapons`, not just the runtime
      // `weapons` array - the two stay index-aligned from construction
      // (`@/app.ts`'s vehicleStateFromConfirmedBuild) through every mount
      // (`@/ui/buildings/weaponshop`'s installWeapon appends to both at
      // once), and `purchaseValue`/`currentValue` price the car off
      // `computeBuild(vehicle.design)` alone. Leaving the design entry
      // behind after a sale is the exact money-printer this mirrors:
      // vehicleSaleValue of the "same" car stays inflated by every weapon
      // ever sold off it, payable again in full on the next 'sell-car'.
      const nextVehicle: VehicleState = {
        ...vehicle,
        weapons: vehicle.weapons.filter((_, i) => i !== index),
        design: { ...vehicle.design, weapons: vehicle.design.weapons.filter((_, i) => i !== index) },
      };
      return {
        state: { context: { ...ctx, driver: { ...ctx.driver, cash: ctx.driver.cash + price }, vehicle: nextVehicle } },
        exit: false,
      };
    }

    if (actionId.startsWith('sell-cargo-')) {
      const index = Number.parseInt(actionId.slice('sell-cargo-'.length), 10);
      const cargo = vehicle.cargo[index];
      if (cargo === undefined || cargo.kind !== 'salvage') return { state, exit: false };
      const price = salvageCargoSaleValue(cargo);
      const nextVehicle: VehicleState = { ...vehicle, cargo: vehicle.cargo.filter((_, i) => i !== index) };
      return {
        state: { context: { ...ctx, driver: { ...ctx.driver, cash: ctx.driver.cash + price }, vehicle: nextVehicle } },
        exit: false,
      };
    }

    return { state, exit: false };
  },
};
