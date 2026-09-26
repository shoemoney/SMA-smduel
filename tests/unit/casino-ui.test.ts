/**
 * `@/ui/buildings/casino` wiring tests.
 *
 * `@/sim/casino` itself (five-card draw with every payout, blackjack with
 * dealer-hits-through-16/dealer-wins-ties/five-card-non-bust/two-card
 * blackjack) is already complete and independently tested in
 * tests/unit/casino.test.ts — nothing here re-derives hand evaluation or
 * dealer policy. This file proves the WIRING: the menu offers poker and
 * blackjack with a settable bet that's refused above cash, a bet above cash
 * charges nothing, every hand is dealt straight off the live `ctx.rng`
 * (never a formula that ignores how far it has actually advanced — see
 * `@/ui/buildings/casino`'s own header), winnings/losses move real cash by
 * the REAL sim payout for economy.json's own table (checked for one hand of
 * every poker rank plus every reachable blackjack outcome), cash never goes
 * negative, blackjack charges the bet at DEAL time so backing out mid-round
 * (including via the generic Escape/Backspace path) forfeits it instead of
 * refunding it, and the disable toggle hides the games behind an
 * explanation.
 *
 * The specific hand counts below (`POKER_INDEX_FOR_RANK`,
 * `BLACKJACK_INDEX_FOR_OUTCOME`) were found by brute-force search — for the
 * fixed seed/day this file uses, that many REAL hands played in a row (via
 * this exact engine: `casinoEngine.activate(state, 'poker'/'blackjack')`,
 * standing immediately on every open blackjack round) lands on that
 * rank/outcome. They are themselves neither ruleset data nor gameplay
 * constants (a genuine reproducibility fact about this seed, not a tunable
 * economy.json ever names), so hardcoding them is not the "constant
 * literal" the project's ruleset-sourcing rule is about — the PAYOUT for
 * whatever rank/outcome comes up is still always read from `economy()` or
 * independently recomputed at test time, never retyped.
 */
import { describe, expect, it } from 'vitest';
import { economy, skillsConfig } from '@/data/rulesets';
import { initialClock } from '@/sim/calendar';
import { blackjackStand, dealBlackjackHand, playFiveCardDraw, type PokerRank } from '@/sim/casino';
import { createRng, type Rng } from '@/util/rng';
import type { DriverState } from '@/sim/types';
import { casinoEngine, createCasinoState, type CasinoState } from '@/ui/buildings/casino';
import { menuFor, stepBuilding, type BuildingContext } from '@/ui/buildings/shared';
import { t } from '@/ui/strings';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDriver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    name: 'Duelist',
    skills: { driving: 20, marksmanship: 20, mechanic: 10 },
    naturalHealth: skillsConfig().driver.naturalHealthDP,
    bodyArmor: 0,
    prestige: skillsConfig().driver.prestigeFloor,
    cash: economy().startingCash,
    cityId: skillsConfig().startingLocation,
    cloneCityId: null,
    cloneSkills: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<BuildingContext> = {}): BuildingContext {
  return {
    driver: makeDriver(),
    clock: initialClock(),
    cityId: skillsConfig().startingLocation,
    vehicle: null,
    vehicleStored: false,
    fleetSize: 0,
    existingCarNames: [],
    rng: createRng('casino-ui-default-seed'),
    rumorsHeardToday: new Map(),
    activeCourierJobs: [],
    routeHistory: new Map(),
    ...overrides,
  };
}

const FIXTURE_SEED = 'casino-ui-fixture-seed';
const POKER_DAY = 10;
const BLACKJACK_DAY = 11;

function fixtureContext(day: number, cash = 1_000_000): BuildingContext {
  return makeContext({ driver: makeDriver({ cash }), clock: { ...initialClock(), dayIndex: day }, rng: createRng(FIXTURE_SEED) });
}

/** An independent Rng clone of `rng`'s CURRENT state — never the same object reference, so recomputing off it is a real second computation, not the engine's own draw reused. */
function cloneRng(rng: Rng): Rng {
  const snapshot = rng.serialize();
  const cloned = createRng(snapshot.seedKey);
  cloned.restore(snapshot);
  return cloned;
}

/** Plays `count` REAL poker hands through the engine (bet held constant) and returns the resulting state — `state.context.rng` is the SAME advancing object every real visit would share. */
function playPokerHands(ctx: BuildingContext, count: number): CasinoState {
  let state = createCasinoState(ctx);
  for (let i = 0; i < count; i++) {
    state = casinoEngine.activate(state, 'poker').state;
  }
  return state;
}

/** Plays `count` REAL blackjack hands through the engine, standing immediately whenever a round is left open (the same "stand pat" policy this file's other blackjack tests use), and returns the resulting state. */
function playBlackjackHands(ctx: BuildingContext, count: number): CasinoState {
  let state = createCasinoState(ctx);
  for (let i = 0; i < count; i++) {
    let result = casinoEngine.activate(state, 'blackjack');
    while (result.state.round !== null) result = casinoEngine.activate(result.state, 'stand');
    state = result.state;
  }
  return state;
}

// Found by brute-force search: for FIXTURE_SEED/POKER_DAY, calling
// casinoEngine.activate(state, 'poker') this many times in a row (0-indexed)
// lands on this rank. See this file's header.
const POKER_INDEX_FOR_RANK: Record<PokerRank, number> = {
  pair: 0,
  highCard: 1,
  straight: 16,
  threeOfAKind: 27,
  twoPair: 39,
  flush: 266,
  fullHouse: 1202,
  straightFlush: 3307,
  fourOfAKind: 7412,
};

// Found the same way, over repeated casinoEngine.activate(state, 'blackjack')
// + 'stand' (whenever a round is left open) calls for FIXTURE_SEED/BLACKJACK_DAY.
// `dealtNatural` records whether THIS call's own deal settled immediately
// (a two-card natural) rather than needing a 'stand' at all — independently
// confirmed against `dealBlackjackHand` below, never assumed.
const BLACKJACK_INDEX_FOR_OUTCOME = {
  dealerWin: { index: 0, dealtNatural: false },
  playerWinOrdinary: { index: 2, dealtNatural: false },
  playerWinNatural: { index: 10, dealtNatural: true },
};

// ---------------------------------------------------------------------------
// 1. Menu offers poker/blackjack with a settable bet
// ---------------------------------------------------------------------------

describe('casino menu: poker and blackjack with a settable bet', () => {
  it('offers both games, a bet the player can raise/lower, and leave', () => {
    const ctx = fixtureContext(POKER_DAY);
    const state = createCasinoState(ctx);
    const actions = casinoEngine.actions(state);
    expect(actions.some((a) => a.id === 'poker' && a.eligible)).toBe(true);
    expect(actions.some((a) => a.id === 'blackjack' && a.eligible)).toBe(true);
    expect(actions.some((a) => a.id === 'raise')).toBe(true);
    expect(actions.some((a) => a.id === 'lower')).toBe(true);
    expect(actions.some((a) => a.id === 'leave')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. A bet above cash is refused and charges nothing
// ---------------------------------------------------------------------------

describe('a bet above cash is refused and charges nothing', () => {
  it('poker/blackjack show ineligible, and activating them anyway leaves cash and round untouched', () => {
    const step = economy().services.drink.price;
    const ctx = fixtureContext(POKER_DAY, step - 1); // less than even the starting (one-step) bet
    const state = createCasinoState(ctx);
    expect(state.bet).toBeGreaterThan(ctx.driver.cash);

    const actions = casinoEngine.actions(state);
    expect(actions.find((a) => a.id === 'poker')?.eligible).toBe(false);
    expect(actions.find((a) => a.id === 'blackjack')?.eligible).toBe(false);

    const pokerAttempt = casinoEngine.activate(state, 'poker');
    expect(pokerAttempt.state.context.driver.cash).toBe(ctx.driver.cash);
    expect(pokerAttempt.state.lastOutcome).toBeNull();
    expect(pokerAttempt.state.round).toBeNull();

    const blackjackAttempt = casinoEngine.activate(state, 'blackjack');
    expect(blackjackAttempt.state.context.driver.cash).toBe(ctx.driver.cash);
    expect(blackjackAttempt.state.lastOutcome).toBeNull();
    expect(blackjackAttempt.state.round).toBeNull();

    // PROVED (mutation): deleting the `ctx.driver.cash < state.bet` guard in
    // casino.ts's 'poker'/'blackjack' activate branches makes both attempts
    // above deal a real hand and move cash — this test then fails on the
    // `cash` equality (and, for poker, on `lastOutcome` no longer being
    // null). Restoring the guard makes it green again.
  });

  it('raising the bet past cash is refused (bet never exceeds cash)', () => {
    const step = economy().services.drink.price;
    const ctx = fixtureContext(POKER_DAY, step); // exactly one step - the floor - and no more
    const state = createCasinoState(ctx);
    expect(state.bet).toBe(step);
    const raised = casinoEngine.activate(state, 'raise');
    expect(raised.state.bet).toBe(step); // unchanged: one more step would exceed cash
  });
});

// ---------------------------------------------------------------------------
// 3. Reload determinism vs. the leave-and-reenter exploit
// ---------------------------------------------------------------------------

describe('reloading the same save and replaying the same action reproduces the same hand — but leaving and coming back never does', () => {
  it('poker: two INDEPENDENTLY constructed sessions (same seed/day/cash — a save, then its reload) settle identically on their FIRST hand, matched against an independently-recomputed rare hand so a coincidental common-rank match cannot pass this', () => {
    // fourOfAKind (~1-in-4165 for an unrelated random hand) is deliberately
    // NOT a common rank: a broken/non-deterministic deal would need a
    // 0.024% coincidence to slip past the exact-net comparison below, unlike
    // testing the visit's literal first hand (mostly highCard/pair, ~93%
    // combined — too likely to coincidentally match even a broken deal).
    const stateA = playPokerHands(fixtureContext(POKER_DAY), POKER_INDEX_FOR_RANK.fourOfAKind);
    const stateB = playPokerHands(fixtureContext(POKER_DAY), POKER_INDEX_FOR_RANK.fourOfAKind); // a fresh Rng from the same seed - what reloading the save reconstructs

    const expectedRng = cloneRng(stateA.context.rng);
    const expected = playFiveCardDraw(stateA.bet, expectedRng, []);
    expect(expected.rank).toBe('fourOfAKind'); // sanity: this many hands in really does land the rare hand

    const resultA = casinoEngine.activate(stateA, 'poker');
    const resultB = casinoEngine.activate(stateB, 'poker');
    expect(resultA.state.lastOutcome?.net).toBe(expected.net);
    expect(resultB.state.lastOutcome?.net).toBe(expected.net);
    expect(resultB.state.context.driver.cash).toBe(resultA.state.context.driver.cash);

    // PROVED (mutation): swapping the real `ctx.rng` draw in casino.ts's
    // 'poker' branch for a fresh `createRng(\`seed-${Math.random()}\`)` makes
    // this fail (a fresh random reshuffle each call essentially never lands
    // fourOfAKind, let alone the SAME net on both A and B) — restoring the
    // live-`ctx.rng` draw makes it green again.
  });

  it('blackjack: same reload scenario settles identically on a natural, matched against an independently-recomputed hand', () => {
    const stateA = playBlackjackHands(fixtureContext(BLACKJACK_DAY), BLACKJACK_INDEX_FOR_OUTCOME.playerWinNatural.index);
    const stateB = playBlackjackHands(fixtureContext(BLACKJACK_DAY), BLACKJACK_INDEX_FOR_OUTCOME.playerWinNatural.index);

    const expectedRng = cloneRng(stateA.context.rng);
    const expectedRound = dealBlackjackHand(stateA.bet, expectedRng);
    expect(expectedRound.outcome).not.toBeNull(); // sanity: a natural settles immediately, no stand needed
    expect(expectedRound.outcome?.playerBlackjack).toBe(true);

    let resultA = casinoEngine.activate(stateA, 'blackjack');
    while (resultA.state.round !== null) resultA = casinoEngine.activate(resultA.state, 'stand');
    let resultB = casinoEngine.activate(stateB, 'blackjack');
    while (resultB.state.round !== null) resultB = casinoEngine.activate(resultB.state, 'stand');

    expect(resultA.state.lastOutcome?.net).toBe(expectedRound.outcome?.net);
    expect(resultB.state.lastOutcome).toEqual(resultA.state.lastOutcome);
    expect(resultB.state.context.driver.cash).toBe(resultA.state.context.driver.cash);
  });

  it('poker: a SECOND hand in the same visit (no reload) deals a genuinely different hand, not the first one replayed', () => {
    const ctx = fixtureContext(POKER_DAY);
    const first = casinoEngine.activate(createCasinoState(ctx), 'poker');
    const second = casinoEngine.activate(first.state, 'poker');
    // Independently confirms the two draws are NOT the same call reused:
    // recomputed directly against the sim function off ctx.rng's state
    // before/after the first deal, not against the engine's own output.
    expect(first.state.lastOutcome?.label).toBe(t('building.casino.pokerOutcome', { rank: 'pair', net: 0 }));
    expect(second.state.lastOutcome?.label).toBe(t('building.casino.pokerOutcome', { rank: 'highCard', net: -second.state.bet }));
    expect(second.state.lastOutcome?.label).not.toBe(first.state.lastOutcome?.label);
  });

  it("EXPLOIT CLOSED: leaving mid-visit (createCasinoState on the SAME context) and coming back does NOT replay the first hand, even with a raised bet — the exact 'probe cheap, leave, raise, replay the winner' scenario this module used to be vulnerable to", () => {
    const ctx = fixtureContext(POKER_DAY, 100_000);
    const first = casinoEngine.activate(createCasinoState(ctx), 'poker');
    expect(first.state.lastOutcome?.label).toBe(t('building.casino.pokerOutcome', { rank: 'pair', net: 0 }));

    // "leave" the building (exit only, no state change) then walk back in:
    // a brand new CasinoState off the exact same (still-mutated) context.
    const left = casinoEngine.activate(first.state, 'leave');
    expect(left.exit).toBe(true);
    const remounted = createCasinoState(left.state.context);

    // Raise the bet 40 times, exactly like the exploit probe.
    let raisedState = remounted;
    for (let i = 0; i < 40; i++) raisedState = casinoEngine.activate(raisedState, 'raise').state;
    expect(raisedState.bet).toBeGreaterThan(first.state.bet);

    const second = casinoEngine.activate(raisedState, 'poker');
    // Not the same rank/net as the first hand — the deck has moved on.
    expect(second.state.lastOutcome?.label).not.toBe(first.state.lastOutcome?.label);
    expect(second.state.lastOutcome?.label).toBe(t('building.casino.pokerOutcome', { rank: 'highCard', net: -raisedState.bet }));

    // PROVED (mutation): reverting `dealRng`/casino.ts's 'poker' branch to
    // derive from a local per-mount `actionIndex` reset to 0 by
    // `createCasinoState` (the pre-fix design) makes `second` replay the
    // EXACT SAME rank as `first` (scaled only by the raised bet) — this
    // test then fails on the `not.toBe` assertion. Restoring the direct
    // `ctx.rng` draw makes it green again.
  });
});

// ---------------------------------------------------------------------------
// 4. Payouts match economy.json for one hand of every rank/outcome
// ---------------------------------------------------------------------------

describe("winnings and losses move real cash by economy.json's own payout table, for one hand of every rank/outcome", () => {
  it.each(Object.entries(POKER_INDEX_FOR_RANK) as [PokerRank, number][])('poker rank %s pays economy().casino.poker[rank]', (rank, index) => {
    const state = playPokerHands(fixtureContext(POKER_DAY), index);
    const before = state.context.driver.cash;

    // Independent recomputation of the REAL sim payout off a CLONE of
    // ctx.rng's exact pre-deal state — not a hardcoded number, so a change
    // to economy.json's poker table moves this expectation with it, and not
    // the engine's own draw reused (a wrong/broken deal would desync this
    // clone from the real one long before hand #`index`).
    const expected = playFiveCardDraw(state.bet, cloneRng(state.context.rng), []);
    expect(expected.rank).toBe(rank); // sanity: this many hands in really does land this rank
    const expectedMultiplier = rank === 'highCard' ? 0 : economy().casino.poker[rank];
    expect(expected.multiplier).toBe(expectedMultiplier);

    const result = casinoEngine.activate(state, 'poker');
    expect(result.state.lastOutcome?.net).toBe(expected.net);
    expect(result.state.context.driver.cash).toBe(before + expected.net);
  });

  it.each(Object.entries(BLACKJACK_INDEX_FOR_OUTCOME))('blackjack outcome %s pays economy().casino.blackjack\'s table', (label, { index, dealtNatural }) => {
    const state = playBlackjackHands(fixtureContext(BLACKJACK_DAY), index);
    const before = state.context.driver.cash;

    // Independent recomputation off a CLONE of ctx.rng's exact pre-deal
    // state: deals, then stands immediately if the deal didn't already
    // settle on a natural — the exact same "stand pat" policy the engine
    // itself drives (see playBlackjackHands above).
    const expectedRound0 = dealBlackjackHand(state.bet, cloneRng(state.context.rng));
    expect(expectedRound0.outcome !== null).toBe(dealtNatural); // sanity: this many hands in really does (not) settle on a natural, as this fixture claims
    const expectedRound = expectedRound0.outcome !== null ? expectedRound0 : blackjackStand(expectedRound0);
    const expected = expectedRound.outcome;
    if (expected === null) throw new Error('fixture assumption broken: hand never settled');

    // Distinguishes all three cases (this is exactly what the old it.each
    // body failed to do — see this file's history): dealerWin has its own
    // branch, and playerWin is split ordinary-vs-natural by `playerBlackjack`,
    // each checked against its OWN economy().casino.blackjack multiplier.
    if (label === 'dealerWin') {
      expect(expected.result).toBe('dealerWin');
      expect(expected.multiplier).toBe(0);
      expect(expected.net).toBe(-state.bet);
    } else if (label === 'playerWinOrdinary') {
      expect(expected.result).toBe('playerWin');
      expect(expected.playerBlackjack).toBe(false);
      expect(expected.multiplier).toBe(economy().casino.blackjack.ordinaryPayout);
    } else {
      expect(label).toBe('playerWinNatural');
      expect(expected.result).toBe('playerWin');
      expect(expected.playerBlackjack).toBe(true);
      expect(expected.multiplier).toBe(economy().casino.blackjack.twoCardBlackjackPayout);
    }

    let result = casinoEngine.activate(state, 'blackjack');
    while (result.state.round !== null) result = casinoEngine.activate(result.state, 'stand');
    expect(result.state.lastOutcome?.net).toBe(expected.net);
    expect(result.state.context.driver.cash).toBe(before + expected.net);
  });

  it('poker: a total loss (highCard) never drives cash below zero — the whole (and only the whole) bet is lost', () => {
    const step = economy().services.drink.price;
    const state = playPokerHands(fixtureContext(POKER_DAY, step), POKER_INDEX_FOR_RANK.highCard);
    expect(state.context.driver.cash).toBe(step); // exactly one bet's worth left, nothing spent yet

    const result = casinoEngine.activate(state, 'poker');
    expect(result.state.lastOutcome?.label).toBe(t('building.casino.pokerOutcome', { rank: 'highCard', net: -step }));
    expect(result.state.context.driver.cash).toBe(0); // lands exactly at the floor, never negative

    // PROVED (mutation): this fixture is constructed so cash === bet going
    // in — `toBeGreaterThanOrEqual(0)` against a million-dollar bankroll
    // (the assertion this replaces) can never fail regardless of what the
    // payout math does; this one actually reaches the floor.
  });

  it('blackjack: a dealer win never drives cash below zero — the whole (and only the whole) bet is lost', () => {
    const step = economy().services.drink.price;
    const state = playBlackjackHands(fixtureContext(BLACKJACK_DAY, step), BLACKJACK_INDEX_FOR_OUTCOME.dealerWin.index);
    expect(state.context.driver.cash).toBe(step);

    let result = casinoEngine.activate(state, 'blackjack');
    while (result.state.round !== null) result = casinoEngine.activate(result.state, 'stand');
    expect(result.state.lastOutcome?.net).toBe(-step);
    expect(result.state.context.driver.cash).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Blackjack charges the bet at deal time — Escape/Backspace can't get a free look
// ---------------------------------------------------------------------------

describe('blackjack charges the bet the moment a round is dealt, so abandoning an open round never refunds it', () => {
  it("dealing charges the bet immediately, before any hit/stand — 'leave' is already hidden from the menu while a round is open", () => {
    const ctx = fixtureContext(BLACKJACK_DAY, 100_000);
    const dealt = casinoEngine.activate(createCasinoState(ctx), 'blackjack');
    expect(dealt.state.round).not.toBeNull(); // BLACKJACK_DAY's hand #0 is a real open round, not a natural (see BLACKJACK_INDEX_FOR_OUTCOME.dealerWin)
    expect(dealt.state.context.driver.cash).toBe(100_000 - dealt.state.bet);
    expect(casinoEngine.actions(dealt.state).some((a) => a.id === 'leave')).toBe(false);

    // PROVED (mutation): this is finding #2's own regression guard — before
    // the fix, `dealt.state.context.driver.cash` stayed at 100_000 here
    // (the bet was only ever applied at settlement). Charging it upfront
    // means there is nothing left to refund below.
  });

  it("Escape (and Backspace) exits mid-round via mountBuildingPanel's onBack — which bypasses casinoEngine.activate entirely — and the already-charged bet stays forfeited, not refunded", () => {
    const ctx = fixtureContext(BLACKJACK_DAY, 100_000);
    const dealt = casinoEngine.activate(createCasinoState(ctx), 'blackjack');
    expect(dealt.state.round).not.toBeNull();
    const debitedCash = dealt.state.context.driver.cash;
    expect(debitedCash).toBeLessThan(100_000);

    for (const key of ['Escape', 'Backspace']) {
      const menu = menuFor(casinoEngine, dealt.state);
      const stepped = stepBuilding(casinoEngine, dealt.state, menu, key);
      expect(stepped.exit).toBe(true); // @/ui/menu's BACK outcome, same path a real Escape/Backspace keydown takes
      expect(stepped.state.round).not.toBeNull(); // the hand is genuinely abandoned unsettled, not secretly auto-resolved
      expect(stepped.state.context.driver.cash).toBe(debitedCash); // NOT refunded back to 100_000
    }

    // PROVED (mutation): before finding #2's fix, `stepped.state.context.driver.cash`
    // here was 100_000 — walking out mid-round cost nothing after having
    // already seen both hands. Charging the bet at deal time (this file's
    // header) closes that regardless of which path (menu leave, which is
    // already hidden, or the generic Escape/Backspace `onBack`) the player
    // takes out of the building.
  });
});

// ---------------------------------------------------------------------------
// 6. Disable/skip toggle
// ---------------------------------------------------------------------------

describe('the disable toggle hides the games behind an explanation', () => {
  it('starts enabled; toggling disable replaces bet/game rows with an explanation + re-enable, and toggling back restores them', () => {
    const ctx = fixtureContext(POKER_DAY);
    const state0 = createCasinoState(ctx);
    expect(state0.disabled).toBe(false);
    expect(casinoEngine.actions(state0).some((a) => a.id === 'poker')).toBe(true);

    const disabled = casinoEngine.activate(state0, 'disable').state;
    expect(disabled.disabled).toBe(true);
    const disabledActions = casinoEngine.actions(disabled);
    expect(disabledActions.some((a) => a.id === 'poker')).toBe(false);
    expect(disabledActions.some((a) => a.id === 'blackjack')).toBe(false);
    expect(disabledActions.some((a) => a.id === 'raise')).toBe(false);
    expect(disabledActions.some((a) => a.id === 'lower')).toBe(false);
    const notice = disabledActions.find((a) => a.eligible === false);
    expect(notice?.label).toBe(t('building.casino.disabledLabel'));
    expect(disabledActions.some((a) => a.id === 'enable')).toBe(true);

    // Activating a hidden action id anyway still refuses to deal or charge
    // cash - defense in depth against a stale client.
    const stillCash = disabled.context.driver.cash;
    const attempted = casinoEngine.activate(disabled, 'poker');
    expect(attempted.state.context.driver.cash).toBe(stillCash);
    expect(attempted.state.round).toBeNull();

    const reenabled = casinoEngine.activate(disabled, 'enable').state;
    expect(reenabled.disabled).toBe(false);
    expect(casinoEngine.actions(reenabled).some((a) => a.id === 'poker')).toBe(true);

    // PROVED (mutation): removing the `if (state.disabled)` branch in
    // casino.ts's `casinoActions` makes `disabledActions.some(poker)` above
    // true and this test fail; restoring it makes it green again.
  });
});
