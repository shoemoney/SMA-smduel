/**
 * Federal building interior: the bureau's case board — a read-only readout of
 * every campaign case whose OWN `destination` names this facility, and where
 * the driver currently stands on each one.
 *
 * It is deliberately a READOUT and not a "turn in evidence" action. Delivery is
 * already owned, and owned correctly, by `@/app`'s `attemptQuestDelivery`
 * (`src/app.ts`), which fires the instant `openFacility` is called — BEFORE
 * this panel ever mounts — because docs/SPEC.md's contract and this codebase's
 * own comment both say arriving with the cargo aboard IS the delivery action
 * ("there is no dedicated deliver menu row anywhere in this UI"). Adding one
 * here would be a second, competing owner of one rule: it could only ever
 * disagree with the real one about whether something was deliverable, and the
 * row would go dead the moment the auto-delivery had already consumed it. So
 * this panel's whole job is to make the player UNDERSTAND why the building
 * matters, which is exactly what a stub could not do.
 *
 * That is not a consolation prize. Two of quests.json's five campaigns name
 * this facility as their `destination` — `fixed-race-proof` (gate 80) and
 * `the-boss-tape` (gate 95), the victory condition — so the Federal Building is
 * where the game's win condition is turned in. Walking into it today opened a
 * panel whose only row said "coming in a future phase", while the delivery it
 * had just completed was real. This panel is the honest counterpart to that.
 *
 * Every figure on screen is real quests.json data read through `@/sim/victory`'s
 * already-validated `questDefs()` — title, gate, clue-chain length, pay, and
 * whether it carries `onDeliver.victory`. There is deliberately NOT ONE invented
 * number here, which is the same constraint `casino.ts` records when it reuses
 * economy.json's `drink` price as its bet step rather than typing a stake: a
 * bureau that filed fabricated fees would be worse than one that filed nothing.
 * `tests/unit/ruleset-dead-keys.test.ts` proves the related point from the other
 * direction — every number in the rulesets already has a production reader, so
 * there was no orphan constant here to claim in the first place.
 *
 * The rows are `informational: true`, not merely `eligible: false`. Those are
 * different claims and `arena.ts`'s schedule row documents exactly why: an
 * ineligible row means "not yet", an informational row means "not a thing you do
 * at all", and conflating the two is what makes a menu lie about its contents.
 * `informational` also costs the row its digit hotkey, which matters because
 * the only real command in this panel is Leave.
 *
 * Generic over every quest, never over quest ids: the set of cases shown is
 * `questDefs().filter(def => def.destination.facility === FEDERAL_KIND)`, so a
 * campaigns.json edit that points another mission at the bureau needs no change
 * here at all.
 */
import { t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
// `@/sim/victory` is the ONE place quests.json is shape-validated (at import
// time); this module reads its already-validated data and re-implements none of
// it, the same boundary `@/ui/journal`'s own header draws.
import { findQuestState, questCargoId, questDefs, type QuestDef } from '@/sim/victory';
import {
  type BuildingContext,
  type BuildingEngine,
  closedAction,
  facilityOpenNow,
  headerFor,
  leaveAction,
  LEAVE_ACTION_ID,
} from '@/ui/buildings/shared';

export const FEDERAL_KIND = 'federal';

export interface FederalState {
  readonly context: BuildingContext;
}

export function createFederalState(context: BuildingContext): FederalState {
  return { context };
}

/** Every case whose own `destination` names this facility — the real data, filtered at call time, never a hardcoded list of quest ids. */
export function federalCases(_ctx: BuildingContext): readonly QuestDef[] {
  // `_ctx` is unused by construction: `@/sim/victory` validates quests.json once
  // at import time and exposes no per-context accessor, so this read genuinely
  // is context-free. The parameter is kept so every `federalCases` call site has
  // the same shape as the other per-facility readers.
  return questDefs().filter((def) => def.destination.facility === FEDERAL_KIND);
}

/** True once the driver stands at this facility carrying `def`'s own payload — the exact precondition `@/app`'s auto-delivery checks, read here only to explain it. */
function cargoAboard(ctx: BuildingContext, def: QuestDef): boolean {
  const cargoId = questCargoId(def.id);
  return (ctx.vehicle?.cargo ?? []).some((item) => item.id === cargoId && item.integrity > 0);
}

/**
 * The status half of a case row, always derived from real save-state
 * (`@/persist/save`'s `QuestState`) against the real def. Ordered so the most
 * specific answer wins: a completed case is closed, a fully-revealed chain is
 * awaiting hand-in, a partial chain is mid-investigation, and nothing at all
 * means the case has not opened yet.
 */
function caseStatus(ctx: BuildingContext, def: QuestDef): string {
  const state = findQuestState(ctx.quests ?? [], def.id);
  if (state?.completed === true) return t('building.federal.caseClosed', { title: def.title, pay: def.pay });
  if (state !== undefined && state.stage >= def.clueChain.length) {
    return cargoAboard(ctx, def)
      ? t('building.federal.caseReadyToDeliver', { title: def.title })
      : t('building.federal.caseAwaitingCargo', { title: def.title });
  }
  const stage = state?.stage ?? 0;
  return t('building.federal.caseInProgress', { title: def.title, stage, total: def.clueChain.length });
}

function caseAction(ctx: BuildingContext, def: QuestDef): MenuAction {
  const label = caseStatus(ctx, def);
  return { id: `case-${def.id}`, label, eligible: false, informational: true, reason: label };
}

export function federalActions(state: FederalState): MenuAction[] {
  const ctx = state.context;
  if (!facilityOpenNow(FEDERAL_KIND, ctx)) return [closedAction(FEDERAL_KIND)];

  const actions: MenuAction[] = [];

  // Every case this facility is the destination for. quests.json always names
  // at least one today, so the board is never empty — but the guard is here so
  // an edit that pointed every case elsewhere degrades to a truthful empty board
  // instead of a panel whose only content is "Leave".
  const cases = federalCases(ctx);
  if (cases.length > 0) {
    actions.push({
      id: 'board',
      label: t('building.federal.board', { count: cases.length }),
      eligible: false,
      informational: true,
      reason: t('building.federal.board', { count: cases.length }),
    });
    for (const def of cases) actions.push(caseAction(ctx, def));
  } else {
    actions.push({
      id: 'no-cases',
      label: t('building.federal.noCases'),
      eligible: false,
      informational: true,
      reason: t('building.federal.noCases'),
    });
  }

  actions.push(leaveAction());
  return actions;
}

export const federalEngine: BuildingEngine<FederalState> = {
  actions: federalActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    // Every row above is a readout and the only command is Leave, so this is
    // total: an unknown id is a no-op rather than a throw, because a menu can
    // legitimately hand back an id this panel considers inert (an ineligible
    // row, a stale selection) and a crash on that would be a worse bug than
    // doing nothing.
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    return { state, exit: false };
  },
};