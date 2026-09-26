/**
 * Stub interior for facility kinds with no phase-1/2/3 gameplay yet (hotel,
 * federal, story, studio, petshop — task brief). Still opens a real numbered
 * panel through `@/ui/menu` rather than doing nothing: the single row is
 * always shown, always explains itself as future content, and Escape/
 * Backspace (or the row itself) leaves cleanly — "never a dead button".
 *
 * A stub facility can still be a mission's clue-chain hop (quests.json's
 * `the-boss-tape` names `story:watertown`) — `questInvestigateRows`/
 * `applyInvestigateAction` (`@/ui/journal`) are wired here generically over
 * `state.kind`, exactly like every other facility, so ANY stub kind a
 * future quest names works with no per-kind branch.
 */
import { facilityName, t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
import { applyInvestigateAction, questInvestigateRows } from '@/ui/journal';
import { closedAction, facilityOpenNow, headerFor, LEAVE_ACTION_ID, leaveAction, type BuildingContext, type BuildingEngine } from '@/ui/buildings/shared';

export interface StubState {
  readonly context: BuildingContext;
  readonly kind: string;
}

export function createStubState(context: BuildingContext, kind: string): StubState {
  return { context, kind };
}

export function stubActions(state: StubState): MenuAction[] {
  if (!facilityOpenNow(state.kind, state.context)) return [closedAction(state.kind)];
  const notice = t('building.stub.notReady', { facility: facilityName(state.kind) });
  const actions: MenuAction[] = [{ id: 'notice', label: notice, eligible: false, reason: notice }];
  actions.push(...questInvestigateRows(state.context, state.kind, 'building.stub.quest.investigate'));
  actions.push(leaveAction());
  return actions;
}

export const stubEngine: BuildingEngine<StubState> = {
  actions: stubActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (actionId.startsWith('investigate-')) {
      return { state: { ...state, context: applyInvestigateAction(state.context, actionId) }, exit: false };
    }
    return { state, exit: false };
  },
};
