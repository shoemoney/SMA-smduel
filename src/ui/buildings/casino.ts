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
 *
 * Every hand is dealt by shuffling straight off `ctx.rng` itself — the same
 * live, persisted-on-save Rng every other building panel shares (mechanic
 * lessons, illicit-sale consequences, ...) — NOT a derived stream keyed by
 * (seed, day, a per-visit counter). That distinction is the whole security
 * property here: `ctx.rng` is a mutable stream that keeps advancing forever
 * forward as the game is played, so every real deal permanently moves it,
 * and no amount of leaving the building and walking back in can rewind it.
 * Concretely: (1) leaving and re-entering the casino (or raising the bet in
 * between) can never re-deal the same hand, because the SECOND deal reads
 * `ctx.rng` from wherever the FIRST deal left it, never from square one —
 * closing the "probe cheap, see the outcome, leave, raise, replay the same
 * winning hand" exploit a prior (seed, day, actionIndex)-derived version of
 * this file had, where `actionIndex` reset to 0 on every mount and the
 * derivation never depended on how far `ctx.rng` had actually advanced.
 * (2) Reloading an actual save and retrying the exact same action from that
 * exact point DOES reproduce the exact same hand, because `Rng.restore()`
 * puts `ctx.rng`'s internal words back to precisely what they were at save
 * time — so a bet can still never be rerolled by save-scumming, the
 * property this module has always wanted, just derived from the real
 * mutable stream instead of a pure formula that happened to ignore it.
 *
 * Blackjack charges the bet at DEAL time (before the player sees a single
 * card), not at settlement: `settledBlackjack` only ever credits `payout`
 * (the sim's own "total returned, including the stake" figure) onto a
 * context whose cash was already debited by `state.bet` the moment the
 * round was dealt. That closes a second hole: `@/ui/menu`'s Escape/
 * Backspace path (wired by `@/ui/buildings/shared`'s `mountBuildingPanel`)
 * backs out of ANY panel unconditionally, bypassing this engine's own
 * `activate` and the `casinoActions` guard that hides the `leave` row while
 * a round is open — so a player could always back out of a blackjack hand
 * after seeing both hands but before standing, for zero cost. With the bet
 * already spent at deal time, backing out mid-round forfeits the (already
 * paid) bet instead of refunding it — walking away costs exactly what
 * finishing a loss would have, so there is no free option on a bad-looking
 * hand.
 *
 * A disable/skip toggle lives in `CasinoState.disabled`: once set, the menu
 * shows only an explanation row (plus a toggle back on) instead of the bet/
 * game rows, for players who'd rather skip the gambling content entirely.
 */
import { blackjackHit, blackjackStand, dealBlackjackHand, playFiveCardDraw, type BlackjackRound } from '@/sim/casino';
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
  /** When true, the menu shows an explanation instead of the bet/game rows. */
  readonly disabled: boolean;
}

function betStep(): number {
  return servicePrice('drink');
}

export function createCasinoState(context: BuildingContext): CasinoState {
  return { context, bet: betStep(), round: null, lastOutcome: null, disabled: false };
}

/**
 * Settlement given a round whose `outcome` is already final — see this
 * file's header on why this credits `payout` (the total returned, stake
 * included) rather than `net`: the caller already debited `round.bet` from
 * `context.driver.cash` at deal time, so crediting `net` here would shortchange
 * the player's own returned stake on every non-loss.
 */
function settledBlackjack(context: BuildingContext, round: BlackjackRound): { context: BuildingContext; lastOutcome: CasinoLastOutcome } {
  const outcome = round.outcome;
  // Only ever called once `round.outcome !== null` — see call sites below,
  // both of which check that before reaching here.
  const payout = outcome?.payout ?? 0;
  const net = outcome?.net ?? 0;
  return {
    context: { ...context, driver: { ...context.driver, cash: context.driver.cash + payout } },
    lastOutcome: { kind: 'blackjack', label: t('building.casino.blackjackOutcome', { result: outcome?.result ?? '', net }), net },
  };
}

export function casinoActions(state: CasinoState): MenuAction[] {
  const ctx = state.context;
  if (!facilityOpenNow(CASINO_KIND, ctx)) return [closedAction(CASINO_KIND)];

  if (state.disabled) {
    return [
      { id: 'disabled-notice', label: t('building.casino.disabledLabel'), eligible: false, reason: t('building.casino.disabledExplanation') },
      { id: 'enable', label: t('building.casino.enableToggle.name'), eligible: true },
      leaveAction(),
    ];
  }

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
  actions.push({ id: 'disable', label: t('building.casino.disableToggle.name'), eligible: true });
  actions.push(leaveAction());
  return actions;
}

export const casinoEngine: BuildingEngine<CasinoState> = {
  actions: casinoActions,
  header: (state) => headerFor(state.context),
  activate: (state, actionId) => {
    const ctx = state.context;
    if (actionId === LEAVE_ACTION_ID) return { state, exit: true };
    if (actionId === 'closed' || actionId === 'last-outcome' || actionId === 'disabled-notice') return { state, exit: false };

    if (actionId === 'disable') return { state: { ...state, disabled: true }, exit: false };
    if (actionId === 'enable') return { state: { ...state, disabled: false }, exit: false };
    if (state.disabled) return { state, exit: false };

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
      // Shuffles straight off the live, persisted `ctx.rng` — see this
      // file's header. This is also a real draw (not a snapshot read): it
      // permanently advances `ctx.rng` for the rest of the game/save.
      const result = playFiveCardDraw(state.bet, ctx.rng, []);
      const nextContext: BuildingContext = { ...ctx, driver: { ...ctx.driver, cash: ctx.driver.cash + result.net } };
      const lastOutcome: CasinoLastOutcome = {
        kind: 'poker',
        label: t('building.casino.pokerOutcome', { rank: result.rank, net: result.net }),
        net: result.net,
      };
      return { state: { context: nextContext, bet: state.bet, round: null, lastOutcome, disabled: state.disabled }, exit: false };
    }

    if (actionId === 'blackjack') {
      if (state.round !== null || ctx.driver.cash < state.bet) return { state, exit: false };
      // Bet is charged HERE, before the round is even dealt — see this
      // file's header on why (closes the free-look/free-escape hole via
      // Escape/Backspace, which this engine's own `activate` never gets a
      // chance to intercept). `settledBlackjack` below only ever credits
      // `payout` back onto this already-debited context.
      const debitedContext: BuildingContext = { ...ctx, driver: { ...ctx.driver, cash: ctx.driver.cash - state.bet } };
      const round = dealBlackjackHand(state.bet, ctx.rng);
      if (round.outcome !== null) {
        const settled = settledBlackjack(debitedContext, round);
        return { state: { context: settled.context, bet: state.bet, round: null, lastOutcome: settled.lastOutcome, disabled: state.disabled }, exit: false };
      }
      return { state: { context: debitedContext, bet: state.bet, round, lastOutcome: null, disabled: state.disabled }, exit: false };
    }

    if (actionId === 'hit' && state.round !== null && !state.round.playerDone) {
      const nextRound = blackjackHit(state.round);
      if (nextRound.outcome !== null) {
        const settled = settledBlackjack(ctx, nextRound);
        return { state: { ...state, context: settled.context, round: null, lastOutcome: settled.lastOutcome }, exit: false };
      }
      return { state: { ...state, round: nextRound }, exit: false };
    }

    if (actionId === 'stand' && state.round !== null && !state.round.playerDone) {
      const nextRound = blackjackStand(state.round);
      const settled = settledBlackjack(ctx, nextRound);
      return { state: { ...state, context: settled.context, round: null, lastOutcome: settled.lastOutcome }, exit: false };
    }

    return { state, exit: false };
  },
};
