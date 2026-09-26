import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  casinoRng,
  dealBlackjackHand,
  blackjackHit,
  blackjackStand,
  dealerShouldHit,
  evaluatePokerHand,
  handValue,
  isBlackjack,
  judgeBlackjackHands,
  playFiveCardDraw,
  type Card,
} from '@/sim/casino';
import { economy } from '@/data/rulesets';
import * as rulesetsModule from '@/data/rulesets';
import { createRng, type Rng } from '@/util/rng';

// ---------------------------------------------------------------------------
// Fixed-order fake Rng: forces the Fisher-Yates shuffle to a no-op by always
// returning the top of the swap range, so the deck stays in its build order
// (clubs 2..14, diamonds 2..14, hearts 2..14, spades 2..14). That gives exact,
// hand-checkable card sequences without hunting for a lucky seed.
// ---------------------------------------------------------------------------
function deckOrderRng(): Rng {
  const unused = (): never => {
    throw new Error('deckOrderRng: unexpected method call');
  };
  return {
    nextU32: unused,
    nextFloat: unused,
    int: (_min: number, max: number) => max,
    roll: unused,
    pick: unused,
    chance: unused,
    stream: unused,
    serialize: unused,
    restore: unused,
  };
}

function card(rank: number, suit: Card['suit']): Card {
  return { rank, suit };
}

// ---------------------------------------------------------------------------
// Poker hand evaluation - every rank, including A2345 and the wheel-flush.
// ---------------------------------------------------------------------------

describe('evaluatePokerHand', () => {
  it('highCard', () => {
    const hand = [card(2, 'clubs'), card(5, 'diamonds'), card(9, 'hearts'), card(11, 'spades'), card(13, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('highCard');
  });

  it('pair', () => {
    const hand = [card(4, 'clubs'), card(4, 'diamonds'), card(9, 'hearts'), card(11, 'spades'), card(13, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('pair');
  });

  it('twoPair', () => {
    const hand = [card(4, 'clubs'), card(4, 'diamonds'), card(9, 'hearts'), card(9, 'spades'), card(13, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('twoPair');
  });

  it('threeOfAKind', () => {
    const hand = [card(4, 'clubs'), card(4, 'diamonds'), card(4, 'hearts'), card(9, 'spades'), card(13, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('threeOfAKind');
  });

  it('straight (ace-high, mixed suits)', () => {
    const hand = [card(10, 'clubs'), card(11, 'diamonds'), card(12, 'hearts'), card(13, 'spades'), card(14, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('straight');
  });

  it('straight A2345 (the wheel, ace plays low)', () => {
    const hand = [card(14, 'clubs'), card(2, 'diamonds'), card(3, 'hearts'), card(4, 'spades'), card(5, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('straight');
  });

  it('flush', () => {
    const hand = [card(2, 'clubs'), card(5, 'clubs'), card(9, 'clubs'), card(11, 'clubs'), card(13, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('flush');
  });

  it('fullHouse', () => {
    const hand = [card(4, 'clubs'), card(4, 'diamonds'), card(4, 'hearts'), card(9, 'spades'), card(9, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('fullHouse');
  });

  it('fourOfAKind', () => {
    const hand = [card(4, 'clubs'), card(4, 'diamonds'), card(4, 'hearts'), card(4, 'spades'), card(13, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('fourOfAKind');
  });

  it('straightFlush (ace-high)', () => {
    const hand = [card(10, 'clubs'), card(11, 'clubs'), card(12, 'clubs'), card(13, 'clubs'), card(14, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('straightFlush');
  });

  it('straightFlush A2345 (the wheel-flush)', () => {
    const hand = [card(14, 'clubs'), card(2, 'clubs'), card(3, 'clubs'), card(4, 'clubs'), card(5, 'clubs')];
    expect(evaluatePokerHand(hand)).toBe('straightFlush');
  });

  it('rejects anything but exactly 5 cards', () => {
    expect(() => evaluatePokerHand([card(2, 'clubs')])).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Poker payout / draw flow
// ---------------------------------------------------------------------------

describe('playFiveCardDraw', () => {
  it('is reproducible from the same seeded Rng draw', () => {
    const a = playFiveCardDraw(100, casinoRng('save-1', 3, 0));
    const b = playFiveCardDraw(100, casinoRng('save-1', 3, 0));
    expect(b).toEqual(a);
  });

  it('pays exactly bet*multiplier ("for 1", stake included) for a deterministic straight-flush deal', () => {
    // With deckOrderRng the top 5 cards are clubs 2,3,4,5,6 - a straight flush.
    const result = playFiveCardDraw(100, deckOrderRng());
    expect(result.rank).toBe('straightFlush');
    expect(result.multiplier).toBe(economy().casino.poker.straightFlush);
    // Hand-computed against economy.json's paytable directly (70x for 1), NOT
    // derived from casino.ts's own payout formula - this is the exact bug
    // that shipped as bet + bet*multiplier (would assert 7100, not 7000).
    expect(result.payout).toBe(7000);
    expect(result.net).toBe(6900);
  });

  it('every rank pays exactly bet*multiplier against economy.json\'s table, across many real deals', () => {
    // No hand-tuned seed here: for every real shuffle, the reported payout must
    // match bet*multiplier for whatever rank evaluatePokerHand independently
    // assigns the final hand - and among 40 untouched deals, at least one must
    // be a no-pair loss, so this also exercises "losing hand pays nothing".
    const bet = 25;
    let sawALoss = false;
    let totalBet = 0;
    let totalPayout = 0;
    for (let seed = 0; seed < 40; seed++) {
      const result = playFiveCardDraw(bet, createRng(`poker-consistency-${seed}`));
      // Independently re-evaluate the final hand - a real check that casino.ts
      // isn't returning a rank inconsistent with the cards it dealt, not
      // f(x) === f(x): dealFinalHand's cards are re-judged by the same pure
      // evaluator the production code uses internally, so a rank/hand mismatch
      // here would mean casino.ts is lying about what it dealt.
      const independentRank = evaluatePokerHand(result.finalHand);
      expect(result.rank).toBe(independentRank);

      const expectedMultiplier = independentRank === 'highCard' ? 0 : economy().casino.poker[independentRank];
      const expectedPayout = expectedMultiplier > 0 ? bet * expectedMultiplier : 0;
      expect(result.multiplier).toBe(expectedMultiplier);
      expect(result.won).toBe(expectedMultiplier > 0);
      expect(result.payout).toBe(expectedPayout);
      expect(result.net).toBe(expectedPayout - bet);

      totalBet += bet;
      totalPayout += result.payout;
      if (!result.won) {
        expect(result.payout).toBe(0);
        expect(result.net).toBe(-bet);
        sawALoss = true;
      }
    }
    expect(sawALoss).toBe(true);
    // The house-edge regression guard: a "for 1" paytable must return LESS
    // than what was staked in aggregate. `bet + bet*multiplier` (the shipped
    // bug) makes every winning hand pay out MORE than the stake, which pushes
    // this comfortably over 1.0x - this is the assertion that would have
    // caught it.
    expect(totalPayout).toBeLessThan(totalBet);
  });

  it('allows discarding all five cards', () => {
    const result = playFiveCardDraw(10, deckOrderRng(), [0, 1, 2, 3, 4]);
    expect(result.finalHand).toHaveLength(5);
  });

  it('duplicate discard indices collapse to one instead of over-counting', () => {
    expect(economy().casino.poker.allowDiscardAllFive).toBe(true);
    expect(() => playFiveCardDraw(10, deckOrderRng(), [0, 0, 1, 2, 3, 4])).not.toThrow();
  });

  it('rejects an out-of-range discard index', () => {
    expect(() => playFiveCardDraw(10, deckOrderRng(), [5])).toThrow(RangeError);
    expect(() => playFiveCardDraw(10, deckOrderRng(), [-1])).toThrow(RangeError);
  });

  it('rejects a non-positive bet', () => {
    expect(() => playFiveCardDraw(0, deckOrderRng())).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Blackjack: hand math
// ---------------------------------------------------------------------------

describe('handValue', () => {
  it('treats an ace as 11 when it does not bust the hand (soft total)', () => {
    const { total, soft } = handValue([card(14, 'clubs'), card(6, 'diamonds')]);
    expect(total).toBe(17);
    expect(soft).toBe(true);
  });

  it('drops an ace to 1 to avoid busting (hard total)', () => {
    const { total, soft } = handValue([card(14, 'clubs'), card(6, 'diamonds'), card(9, 'hearts')]);
    expect(total).toBe(16); // 11+6+9=26 busts, one ace counted as 1 instead -> 16
    expect(soft).toBe(false);
  });

  it('face cards count as 10', () => {
    expect(handValue([card(13, 'clubs'), card(11, 'diamonds')]).total).toBe(20);
  });
});

describe('isBlackjack', () => {
  it('is true only for a 2-card 21', () => {
    expect(isBlackjack([card(14, 'clubs'), card(13, 'diamonds')])).toBe(true);
    expect(isBlackjack([card(7, 'clubs'), card(7, 'diamonds'), card(7, 'hearts')])).toBe(false); // 21 in 3 cards is not a natural
  });
});

describe('dealerShouldHit', () => {
  it('hits through 16 (the configured threshold)', () => {
    expect(economy().casino.blackjack.dealerHitsThrough).toBe(16);
    expect(dealerShouldHit([card(10, 'clubs'), card(6, 'diamonds')])).toBe(true); // 16
  });

  it('stands at 17, hard or soft', () => {
    expect(dealerShouldHit([card(10, 'clubs'), card(7, 'diamonds')])).toBe(false); // hard 17
    expect(dealerShouldHit([card(14, 'clubs'), card(6, 'diamonds')])).toBe(false); // soft 17
  });
});

// ---------------------------------------------------------------------------
// Blackjack: pure settlement, every named branch
// ---------------------------------------------------------------------------

describe('judgeBlackjackHands', () => {
  it('player busts: dealer wins regardless of the dealer hand', () => {
    const player = [card(10, 'clubs'), card(10, 'diamonds'), card(5, 'hearts')]; // 25, bust
    const dealer = [card(10, 'clubs'), card(9, 'diamonds')]; // 19
    const outcome = judgeBlackjackHands(100, player, dealer);
    expect(outcome).toEqual({
      result: 'dealerWin',
      multiplier: 0,
      payout: 0,
      net: -100,
      playerTotal: 25,
      dealerTotal: 19,
      playerBlackjack: false,
      dealerBlackjack: false,
    });
  });

  it('two-card blackjack pays the natural payout ("for 1", stake included)', () => {
    const player = [card(14, 'clubs'), card(13, 'diamonds')]; // natural 21
    const dealer = [card(10, 'clubs'), card(7, 'diamonds')]; // 17
    const outcome = judgeBlackjackHands(100, player, dealer);
    expect(outcome.result).toBe('playerWin');
    expect(outcome.multiplier).toBe(economy().casino.blackjack.twoCardBlackjackPayout);
    // Hand-computed against economy.json's twoCardBlackjackPayout (3x for 1)
    // directly, not derived from casino.ts's own formula - the shipped bug
    // (bet + bet*multiplier) would assert 400, not 300.
    expect(outcome.payout).toBe(300);
    expect(outcome.playerBlackjack).toBe(true);
  });

  it('both natural: dealer wins ties (dealerWinsTies)', () => {
    expect(economy().casino.blackjack.dealerWinsTies).toBe(true);
    const player = [card(14, 'clubs'), card(13, 'diamonds')];
    const dealer = [card(14, 'hearts'), card(12, 'spades')];
    const outcome = judgeBlackjackHands(100, player, dealer);
    expect(outcome.result).toBe('dealerWin');
    expect(outcome.net).toBe(-100);
  });

  it('push goes to dealer: an ordinary tied total is a dealer win, not a push', () => {
    const player = [card(10, 'clubs'), card(8, 'diamonds')]; // 18
    const dealer = [card(9, 'clubs'), card(9, 'diamonds')]; // 18
    const outcome = judgeBlackjackHands(100, player, dealer);
    expect(outcome.result).toBe('dealerWin');
  });

  it('five-card non-bust hand wins outright, even against a matching dealer total', () => {
    const player = [card(4, 'clubs'), card(4, 'diamonds'), card(4, 'hearts'), card(4, 'spades'), card(4, 'clubs')]; // 5 cards, doesn't bust (soft/hard n/a for non-aces): 4*5=20... wait rank 4 five times isn't a real deck but pure fn doesn't care
    const dealer = [card(10, 'clubs'), card(10, 'diamonds')]; // 20
    const outcome = judgeBlackjackHands(100, player, dealer);
    expect(outcome.result).toBe('playerWin');
    expect(outcome.multiplier).toBe(economy().casino.blackjack.ordinaryPayout);
  });

  it('exact 21 wins even when the dealer also has 21 (overrides the tie rule)', () => {
    expect(economy().casino.blackjack.exactTwentyOneWins).toBe(true);
    const player = [card(7, 'clubs'), card(7, 'diamonds'), card(7, 'hearts')]; // 21, 3 cards - not a natural
    const dealer = [card(6, 'clubs'), card(7, 'diamonds'), card(8, 'hearts')]; // 21, 3 cards - not a natural
    const outcome = judgeBlackjackHands(100, player, dealer);
    expect(outcome.result).toBe('playerWin');
    expect(outcome.multiplier).toBe(economy().casino.blackjack.ordinaryPayout);
  });

  it('ordinary win: higher total, no naturals, no bust', () => {
    const player = [card(10, 'clubs'), card(9, 'diamonds')]; // 19
    const dealer = [card(10, 'hearts'), card(8, 'spades')]; // 18
    expect(judgeBlackjackHands(100, player, dealer).result).toBe('playerWin');
  });

  it('ordinary loss: lower total, no naturals, no bust', () => {
    const player = [card(10, 'clubs'), card(8, 'diamonds')]; // 18
    const dealer = [card(10, 'hearts'), card(9, 'spades')]; // 19
    expect(judgeBlackjackHands(100, player, dealer).result).toBe('dealerWin');
  });

  it('dealer bust (player did not bust): player wins the ordinary payout', () => {
    const player = [card(10, 'clubs'), card(8, 'diamonds')]; // 18
    const dealer = [card(10, 'hearts'), card(9, 'spades'), card(5, 'clubs')]; // 24, bust
    const outcome = judgeBlackjackHands(100, player, dealer);
    expect(outcome.result).toBe('playerWin');
    expect(outcome.multiplier).toBe(economy().casino.blackjack.ordinaryPayout);
  });

  it('rejects a non-positive bet', () => {
    expect(() => judgeBlackjackHands(0, [card(10, 'clubs'), card(8, 'diamonds')], [card(10, 'hearts'), card(9, 'spades')])).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// Blackjack: Rng-driven deal/hit/stand orchestration
// ---------------------------------------------------------------------------

describe('deal / hit / stand orchestration', () => {
  it('is reproducible from the same seeded Rng draw', () => {
    const a = dealBlackjackHand(100, casinoRng('save-2', 7, 1));
    const b = dealBlackjackHand(100, casinoRng('save-2', 7, 1));
    expect(b).toEqual(a);
  });

  it('does NOT settle immediately when neither hand is a natural (round stays open for player action)', () => {
    // deckOrderRng deals clubs 2,3 to the player (5, no natural) and clubs 4,5 to
    // the dealer (9, no natural either).
    const round = dealBlackjackHand(100, deckOrderRng());
    expect(round.playerDone).toBe(false);
    expect(round.outcome).toBeNull();
  });

  /**
   * `int(min, max) => max - 2` (clamped) is a fixed, deterministic Fisher-Yates
   * tape - verified by direct simulation - that deals the player Ace-King of
   * spades (a natural) and the dealer 2,3 of clubs (5, not a natural). Used
   * only to exercise dealBlackjackHand's naturalEnds branch, which no other
   * test in this file reaches.
   */
  function naturalDealRng(): Rng {
    const unused = (): never => {
      throw new Error('naturalDealRng: unexpected method call');
    };
    return {
      nextU32: unused,
      nextFloat: unused,
      int: (minInclusive: number, maxInclusive: number) => Math.max(minInclusive, maxInclusive - 2),
      roll: unused,
      pick: unused,
      chance: unused,
      stream: unused,
      serialize: unused,
      restore: unused,
    };
  }

  it('settles immediately on a player natural, without letting the dealer draw further', () => {
    const round = dealBlackjackHand(100, naturalDealRng());
    expect(round.player).toEqual([card(14, 'spades'), card(13, 'spades')]);
    expect(round.dealer).toEqual([card(2, 'clubs'), card(3, 'clubs')]); // dealer stays at 5 - never gets to hit
    expect(round.playerDone).toBe(true);
    expect(round.outcome).not.toBeNull();
    expect(round.outcome?.playerBlackjack).toBe(true);
    expect(round.outcome?.result).toBe('playerWin');
    expect(round.outcome?.multiplier).toBe(economy().casino.blackjack.twoCardBlackjackPayout);
  });

  it('a hit that busts the player ends the round as a dealer win without the dealer drawing further', () => {
    let round = dealBlackjackHand(100, deckOrderRng()); // player clubs 2,3 (5); dealer clubs 4,5 (9)
    round = blackjackHit(round); // + clubs 6 -> 11
    round = blackjackHit(round); // + clubs 7 -> 18
    round = blackjackHit(round); // + clubs 8 -> 26, bust
    expect(round.playerDone).toBe(true);
    expect(round.outcome?.result).toBe('dealerWin');
    expect(round.outcome?.playerTotal).toBe(26);
    expect(round.dealer).toEqual([card(4, 'clubs'), card(5, 'clubs')]); // dealer never got to act
  });

  it('standing lets the dealer hit through 16 and stop once it busts or reaches 17+', () => {
    const round = blackjackStand(dealBlackjackHand(100, deckOrderRng())); // player clubs 2,3 (5); dealer clubs 4,5 (9)
    // dealer: 9 -> hit clubs6 -> 15 -> hit clubs7 -> 22 (bust) -> stop
    expect(round.dealer).toEqual([card(4, 'clubs'), card(5, 'clubs'), card(6, 'clubs'), card(7, 'clubs')]);
    expect(round.outcome?.result).toBe('playerWin');
    expect(round.outcome?.dealerTotal).toBe(22);
  });

  it('hitting or standing on an already-resolved round is rejected / is a no-op', () => {
    let round = dealBlackjackHand(100, deckOrderRng());
    round = blackjackHit(round);
    round = blackjackHit(round);
    round = blackjackHit(round); // busts
    expect(round.outcome).not.toBeNull();
    expect(() => blackjackHit(round)).toThrow(RangeError);
    expect(blackjackStand(round)).toEqual(round);
  });

  it('rejects a non-positive bet', () => {
    expect(() => dealBlackjackHand(0, deckOrderRng())).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// casinoRng
// ---------------------------------------------------------------------------

describe('casinoRng', () => {
  it('derives a deterministic stream keyed by (seed, day, actionIndex)', () => {
    const a = casinoRng('table-seed', 12, 3).nextU32();
    const b = casinoRng('table-seed', 12, 3).nextU32();
    expect(b).toBe(a);
  });

  it('a different actionIndex on the same day yields a different stream', () => {
    const a = casinoRng('table-seed', 12, 3).nextU32();
    const c = casinoRng('table-seed', 12, 4).nextU32();
    expect(c).not.toBe(a);
  });

  it('a different day yields a different stream even with the same actionIndex', () => {
    const a = casinoRng('table-seed', 12, 3).nextU32();
    const d = casinoRng('table-seed', 13, 3).nextU32();
    expect(d).not.toBe(a);
  });
});

// ---------------------------------------------------------------------------
// Blackjack constants are read from economy.json at call time, not baked in.
//
// Mirrors tests/unit/calendar.cadence-not-hardcoded.test.ts's proof
// technique: a hardcoded `21` in casino.ts would still pass every other test
// in this file, since they all build hands against the real economy.json,
// whose targetScore also happens to be 21. This spies on '@/data/rulesets'
// exports.economy to return a DIFFERENT targetScore (19 instead of 21) for
// one call, using vi.spyOn (restored in afterEach) rather than vi.mock +
// vi.resetModules - a module-registry reset here bleeds across other test
// FILES sharing this worker (verified: it turned tests/unit/hud.test.ts
// flaky under the full `vitest run` suite even though hud.test.ts never
// touches casino or economy.json) - and asserts the blackjack logic busts at
// the MOCKED value instead of the real one.
// ---------------------------------------------------------------------------

describe('blackjack: targetScore is sourced from economy.json, not hardcoded', () => {
  const MOCK_TARGET_SCORE = 19;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockTargetScore(): void {
    const real = economy();
    vi.spyOn(rulesetsModule, 'economy').mockReturnValue({
      ...real,
      casino: { ...real.casino, blackjack: { ...real.casino.blackjack, targetScore: MOCK_TARGET_SCORE } },
    });
  }

  it('judgeBlackjackHands busts a 20 (a real economy.json winner) at the mocked targetScore of 19', () => {
    mockTargetScore();
    const player = [card(10, 'clubs'), card(10, 'diamonds')]; // 20: not a bust under the real 21, IS a bust under the mocked 19
    const dealer = [card(2, 'clubs'), card(3, 'diamonds')]; // 5: a weak dealer hand the player would beat if 20 were not busted
    const outcome = judgeBlackjackHands(100, player, dealer);
    expect(outcome.playerTotal).toBe(20);
    expect(outcome.result).toBe('dealerWin');
    expect(outcome.net).toBe(-100);
  });

  it("handValue's ace-reduction loop reacts to the mocked targetScore instead of a hardcoded 21", () => {
    mockTargetScore();
    // Ace(11) + 9 = 20: soft and un-reduced against the real economy.json's
    // targetScore of 21 (20 <= 21), but over the mocked 19, forcing the ace
    // down to its low value (11 - 1 = 10 lower -> total 10, hard).
    const { total, soft } = handValue([card(14, 'clubs'), card(9, 'diamonds')]);
    expect(total).toBe(10);
    expect(soft).toBe(false);
  });
});
