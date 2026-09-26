/**
 * Medical center interior: get cloned, update an existing clone snapshot, or
 * buy one point of healing (economy.json's `medicalPerPoint` — $100 and 7
 * days per point, applied once per activation so buying N points is N
 * activations, same "repeat the action" shape `@/sim/economy`'s
 * `applyService` already gives every other per-unit service).
 */
import { skillsConfig } from '@/data/rulesets';
import { applyService, type EconomyWorld } from '@/sim/economy';
import type { ServiceId } from '@/sim/types';
import { t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
import { applyInvestigateAction, questInvestigateRows } from '@/ui/journal';
import {
  type BuildingContext,
  type BuildingEngine,
  canAfford,
  closedAction,
  facilityOpenNow,
  headerFor,
  insufficientFundsReason,
  leaveAction,
  LEAVE_ACTION_ID,
  pricedLabel,
  servicePrice,
} from '@/ui/buildings/shared';

export const MEDICAL_KIND = 'medical';

export interface MedicalState {
  readonly context: BuildingContext;
}

export function createMedicalState(context: BuildingContext): MedicalState {
  return { context };
}

function economyWorldFor(ctx: BuildingContext): EconomyWorld {
  return { clock: ctx.clock, vehicle: ctx.vehicle, vehicleStored: ctx.vehicleStored };
}

function applyEconomyService(ctx: BuildingContext, serviceId: ServiceId): BuildingContext {
  const result = applyService(ctx.driver, economyWorldFor(ctx), serviceId, ctx.rng);
  if (!result.ok) return ctx;
  return { ...ctx, driver: result.driver, clock: result.world.clock, vehicle: result.world.vehicle, vehicleStored: result.world.vehicleStored };
}

export function medicalActions(state: MedicalState): MenuAction[] {
  const ctx = state.context;
  if (!facilityOpenNow(MEDICAL_KIND, ctx)) return [closedAction(MEDICAL_KIND)];

  const actions: MenuAction[] = [];

  const clonePrice = servicePrice('clone');
  actions.push({
    id: 'clone',
    label: pricedLabel(t('building.medical.clone.name'), clonePrice),
    eligible: canAfford(ctx, clonePrice),
    reason: insufficientFundsReason(clonePrice, ctx.driver.cash),
  });

  const braintapePrice = servicePrice('braintapeUpdate');
  const hasClone = ctx.driver.cloneCityId !== null;
  actions.push({
    id: 'braintapeUpdate',
    label: pricedLabel(t('building.medical.braintape.name'), braintapePrice),
    eligible: hasClone && canAfford(ctx, braintapePrice),
    reason: hasClone ? insufficientFundsReason(braintapePrice, ctx.driver.cash) : t('building.medical.noClone'),
  });

  const treatmentPrice = servicePrice('medicalPerPoint');
  const cap = skillsConfig().driver.naturalHealthDP;
  const atFullHealth = ctx.driver.naturalHealth >= cap;
  actions.push({
    id: 'medicalPerPoint',
    label: pricedLabel(t('building.medical.treatment.name'), treatmentPrice),
    eligible: !atFullHealth && canAfford(ctx, treatmentPrice),
    reason: atFullHealth ? t('building.medical.fullHealth') : insufficientFundsReason(treatmentPrice, ctx.driver.cash),
  });

  actions.push(...questInvestigateRows(ctx, MEDICAL_KIND, 'building.medical.quest.investigate'));

  actions.push(leaveAction());
  return actions;
}

export const medicalEngine: BuildingEngine<MedicalState> = {
  actions: medicalActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    const ctx = state.context;
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (actionId === 'closed') return { state, exit: false };
    if (actionId === 'clone' || actionId === 'braintapeUpdate' || actionId === 'medicalPerPoint') {
      return { state: { context: applyEconomyService(ctx, actionId) }, exit: false };
    }
    if (actionId.startsWith('investigate-')) {
      return { state: { context: applyInvestigateAction(ctx, actionId) }, exit: false };
    }
    return { state, exit: false };
  },
};
