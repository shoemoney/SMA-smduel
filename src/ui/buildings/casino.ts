/**
 * Casino interior: raise/lower a bet in fixed steps, then play a hand of the
 * existing poker or blackjack sim (`@/sim/casino`) — this module never
 * re-implements the card game itself, only the numbered-menu front end onto
 * `playFiveCardDraw`/`dealBlackjackHand`/`blackjackHit`/`blackjackStand`.
 *
 * Neither docs/SPEC.md nor any ruleset table names a bet SIZE (economy.json
 * `casino` only carries payout tables) — casino stakes are simply not a
 * documented number anywhere in this project. Rather than invent one, the
 * bet step reuses economy.json's `drink` price as the smallest real dollar
 * figure the ruleset already prices small transactions at, so this is a
 * reused ruleset number, not a fabricated literal; the starting bet is one
 * step, and it's clamped to `[step, cash]` on every raise/lower.
 *
 * Poker here always plays "stand pat" (`playFiveCardDraw`'s own supported
 * zero-discard mode) — full discard selection is a second interactive
 * sub-flow out of this pass's scope. Blackjack is fully interactive
 * (hit/stand) since `@/sim/casino` already exposes that as discrete steps.
 */
import {
  blackjackHit,
  blackjackStand,
  dealBlackjackHand,
  playFiveCardDraw,
  type BlackjackRound,
} from '@/sim/casino';
import { t } from '@/ui/strings';
import type { MenuAction } from '@/ui/menu';
import {
  type BuildingContext,
  type BuildingEngine,
  closedAction,
  facilityOpenNow,
  headerFor,
  leaveAction,
  LEAVE_ACTION_ID,
  servicePrice,
} from '@/ui/buildings/shared';

export const CASINO_KIND = 'casino';

export interface CasinoLastOutcome {
  readonly kind: 'poker' | 'blackjack';
  readonly label: string;
  readonly net: number;
}

export interface CasinoState {
  readonly context: BuildingContext;
  readonly bet: number;
  readonly round: BlackjackRound | null;
  readonly lastOutcome: CasinoLastOutcome | null;
}

function betStep(): number {
  return servicePrice('drink');
}

export function createCasinoState(context: BuildingContext): CasinoState {
  return { context, bet: betStep(), round: null, lastOutcome: null };
}

function settledBlackjack(context: BuildingContext, round: BlackjackRound): { context: BuildingContext; lastOutcome: CasinoLastOutcome } {
  const outcome = round.outcome;
  // Only ever called once `round.outcome !== null` — see call sites below,
  // both of which check that before reaching here.
  const net = outcome?.net ?? 0;
  return {
    context: { ...context, driver: { ...context.driver, cash: context.driver.cash + net } },
    lastOutcome: { kind: 'blackjack', label: t('building.casino.blackjackOutcome', { result: outcome?.result ?? '', net }), net },
  };
}

export function casinoActions(state: CasinoState): MenuAction[] {
  const ctx = state.context;
  if (!facilityOpenNow(CASINO_KIND, ctx)) return [closedAction(CASINO_KIND)];

  const actions: MenuAction[] = [];

  if (state.lastOutcome !== null) {
    actions.push({ id: 'last-outcome', label: state.lastOutcome.label, eligible: false, reason: state.lastOutcome.label });
  }

  if (state.round !== null) {
    const canAct = !state.round.playerDone;
    actions.push({ id: 'hit', label: t('building.casino.hit.name'), eligible: canAct, reason: t('building.casino.roundOver') });
    actions.push({ id: 'stand', label: t('building.casino.stand.name'), eligible: canAct, reason: t('building.casino.roundOver') });
    return actions;
  }

  const step = betStep();
  const cash = ctx.driver.cash;
  actions.push({
    id: 'raise',
    label: t('building.casino.raiseBet', { step }),
    eligible: state.bet + step <= cash,
    reason: t('building.insufficientFunds', { price: state.bet + step, cash }),
  });
  actions.push({
    id: 'lower',
    label: t('building.casino.lowerBet', { step }),
    eligible: state.bet - step >= step,
    reason: t('building.casino.betAtFloor', { step }),
  });
  actions.push({
    id: 'poker',
    label: t('building.casino.poker', { bet: state.bet }),
    eligible: cash >= state.bet,
    reason: t('building.insufficientFunds', { price: state.bet, cash }),
  });
  actions.push({
    id: 'blackjack',
    label: t('building.casino.blackjack', { bet: state.bet }),
    eligible: cash >= state.bet,
    reason: t('building.insufficientFunds', { price: state.bet, cash }),
  });
  actions.push(leaveAction());
  return actions;
}

export const casinoEngine: BuildingEngine<CasinoState> = {
  actions: casinoActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    const ctx = state.context;
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (actionId === 'closed' || actionId === 'last-outcome') return { state, exit: false };

    const step = betStep();

    if (actionId === 'raise') {
      const nextBet = state.bet + step;
      if (nextBet > ctx.driver.cash) return { state, exit: false };
      return { state: { ...state, bet: nextBet }, exit: false };
    }
    if (actionId === 'lower') {
      const nextBet = state.bet - step;
      if (nextBet < step) return { state, exit: false };
      return { state: { ...state, bet: nextBet }, exit: false };
    }

    if (actionId === 'poker') {
      if (state.round !== null || ctx.driver.cash < state.bet) return { state, exit: false };
      const result = playFiveCardDraw(state.bet, ctx.rng, []);
      const nextContext: BuildingContext = { ...ctx, driver: { ...ctx.driver, cash: ctx.driver.cash + result.net } };
      const lastOutcome: CasinoLastOutcome = {
        kind: 'poker',
        label: t('building.casino.pokerOutcome', { rank: result.rank, net: result.net }),
        net: result.net,
      };
      return { state: { context: nextContext, bet: state.bet, round: null, lastOutcome }, exit: false };
    }

    if (actionId === 'blackjack') {
      if (state.round !== null || ctx.driver.cash < state.bet) return { state, exit: false };
      const round = dealBlackjackHand(state.bet, ctx.rng);
      if (round.outcome !== null) {
        const settled = settledBlackjack(ctx, round);
        return { state: { context: settled.context, bet: state.bet, round: null, lastOutcome: settled.lastOutcome }, exit: false };
      }
      return { state: { context: ctx, bet: state.bet, round, lastOutcome: null }, exit: false };
    }

    if (actionId === 'hit' && state.round !== null && !state.round.playerDone) {
      const nextRound = blackjackHit(state.round);
      if (nextRound.outcome !== null) {
        const settled = settledBlackjack(ctx, nextRound);
        return { state: { context: settled.context, bet: state.bet, round: null, lastOutcome: settled.lastOutcome }, exit: false };
      }
      return { state: { ...state, round: nextRound }, exit: false };
    }

    if (actionId === 'stand' && state.round !== null && !state.round.playerDone) {
      const nextRound = blackjackStand(state.round);
      const settled = settledBlackjack(ctx, nextRound);
      return { state: { context: settled.context, bet: state.bet, round: null, lastOutcome: settled.lastOutcome }, exit: false };
    }

    return { state, exit: false };
  },
};
