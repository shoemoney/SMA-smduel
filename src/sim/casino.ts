/**
 * CASINO subsystem: five-card draw poker and blackjack.
 *
 * Payout tables and dealer rules come from `economy().casino` (rulesets/classic/
 * economy.json) - nothing gameplay-relevant is a literal in this file. All
 * randomness runs through a seeded `Rng` (see `@/util/rng`); `casinoRng`
 * derives one from (seed, day, actionIndex) so reloading a save can never
 * reroll a bet that already happened.
 *
 * Hand evaluation (`evaluatePokerHand`, `judgeBlackjackHands`, `handValue`,
 * `isBlackjack`, `dealerShouldHit`) is exposed as pure functions independent
 * of the Rng-driven deal/hit/stand orchestration below them, so every rank
 * and every dealer/payout branch can be tested directly against hand-built
 * cards instead of hunting for a seed that happens to produce them.
 */
import { createRng, type Rng } from '@/util/rng';
import { economy } from '@/data/rulesets';

// ---------------------------------------------------------------------------
// Cards & deck
// ---------------------------------------------------------------------------

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

/** rank 2..14, where 11=J, 12=Q, 13=K, 14=Ace. */
export interface Card {
  rank: number;
  suit: Suit;
}

const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

function freshDeck(): Card[] {
  const { minRank, maxRank } = economy().casino.poker;
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = minRank; rank <= maxRank; rank++) deck.push({ rank, suit });
  }
  return deck;
}

/** Fisher-Yates shuffle driven entirely by the seeded Rng. */
function shuffledDeck(rng: Rng): Card[] {
  const deck = freshDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = deck[i];
    const b = deck[j];
    if (a === undefined || b === undefined) continue; // unreachable: i, j always in bounds
    deck[i] = b;
    deck[j] = a;
  }
  return deck;
}

/** Non-mutating draw: returns the first `n` cards and the remaining deck. */
function takeCards(deck: readonly Card[], n: number): { drawn: Card[]; rest: Card[] } {
  const drawn = deck.slice(0, n);
  if (drawn.length !== n) throw new RangeError('takeCards: deck ran out of cards');
  return { drawn, rest: deck.slice(n) };
}

/**
 * Derives a reproducible Rng for one casino action: the same (seed, day,
 * actionIndex) always yields the same shuffle, so replaying a save cannot
 * reroll a bet that already resolved.
 */
export function casinoRng(seed: string | number, day: number, actionIndex: number): Rng {
  return createRng(seed).stream(`casino:${day}:${actionIndex}`);
}

// ---------------------------------------------------------------------------
// Poker: five-card draw
// ---------------------------------------------------------------------------

export type PokerRank =
  | 'highCard'
  | 'pair'
  | 'twoPair'
  | 'threeOfAKind'
  | 'straight'
  | 'flush'
  | 'fullHouse'
  | 'fourOfAKind'
  | 'straightFlush';

function isFlush(cards: readonly Card[]): boolean {
  const suit = cards[0]?.suit;
  if (suit === undefined) return false;
  return cards.every((c) => c.suit === suit);
}

/** True for `handSize` distinct consecutive ranks, INCLUDING the ace-low wheel (A-2-3-4-5). */
function isStraight(ranks: readonly number[], handSize: number): boolean {
  const sorted = [...new Set(ranks)].sort((a, b) => a - b);
  if (sorted.length !== handSize) return false;
  if (sorted.join(',') === '2,3,4,5,14') return true; // wheel: ace plays low
  const first = sorted[0];
  const last = sorted[handSize - 1];
  if (first === undefined || last === undefined) return false;
  return last - first === handSize - 1;
}

function rankCounts(ranks: readonly number[]): number[] {
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.values()].sort((a, b) => b - a);
}

/** Evaluates exactly economy.json's `poker.handSize` cards. Ace-high and ace-low (wheel) straights both count as straights. */
export function evaluatePokerHand(cards: readonly Card[]): PokerRank {
  const { handSize } = economy().casino.poker;
  if (cards.length !== handSize) throw new RangeError(`evaluatePokerHand: exactly ${handSize} cards required`);

  const ranks = cards.map((c) => c.rank);
  const flush = isFlush(cards);
  const straight = isStraight(ranks, handSize);
  if (straight && flush) return 'straightFlush';

  const counts = rankCounts(ranks);
  const top = counts[0] ?? 0;
  const second = counts[1] ?? 0;

  if (top === 4) return 'fourOfAKind';
  if (top === 3 && second === 2) return 'fullHouse';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (top === 3) return 'threeOfAKind';
  if (top === 2 && second === 2) return 'twoPair';
  if (top === 2) return 'pair';
  return 'highCard';
}

function pokerMultiplier(rank: PokerRank): number {
  if (rank === 'highCard') return 0;
  return economy().casino.poker[rank];
}

export interface PokerHandResult {
  rank: PokerRank;
  /** Payout table multiplier (0 for a losing hand). */
  multiplier: number;
  won: boolean;
  /** Total dollars returned to the player, including their own stake (0 if they lost). */
  payout: number;
  net: number;
  finalHand: Card[];
}

/**
 * Deals economy.json's `poker.handSize` cards, discards the indices in
 * `discardIndices` (0..handSize-1, each at most once) and replaces them from
 * the same shuffled deck, then evaluates and pays out the final hand.
 * Discarding the whole hand is allowed whenever economy.json's
 * `allowDiscardAllFive` is true (it is, by default).
 */
export function playFiveCardDraw(bet: number, rng: Rng, discardIndices: readonly number[] = []): PokerHandResult {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw new RangeError('playFiveCardDraw: bet must be a positive integer');
  }

  const poker = economy().casino.poker;
  const { handSize } = poker;
  const maxIndex = handSize - 1;
  const maxDiscards = poker.allowDiscardAllFive ? handSize : maxIndex;
  const uniqueDiscards = new Set(discardIndices);
  if (uniqueDiscards.size > maxDiscards) {
    throw new RangeError(`playFiveCardDraw: cannot discard more than ${maxDiscards} cards`);
  }
  for (const idx of uniqueDiscards) {
    if (!Number.isInteger(idx) || idx < 0 || idx > maxIndex) {
      throw new RangeError(`playFiveCardDraw: discard index ${idx} out of range 0..${maxIndex}`);
    }
  }

  const shuffled = shuffledDeck(rng);
  const { drawn: initialHand, rest: afterDeal } = takeCards(shuffled, handSize);
  const kept = initialHand.filter((_, i) => !uniqueDiscards.has(i));
  const { drawn: replacements } = takeCards(afterDeal, handSize - kept.length);
  const finalHand = [...kept, ...replacements];

  const rank = evaluatePokerHand(finalHand);
  const multiplier = pokerMultiplier(rank);
  const won = multiplier > 0;
  // economy.json's poker table is a classic "for 1" TOTAL-return paytable
  // (pair 1, ..., straightFlush 70): the multiplier already prices in the
  // player's own stake, so a win pays bet*multiplier, not bet+bet*multiplier.
  const payout = won ? bet * multiplier : 0;

  return { rank, multiplier, won, payout, net: payout - bet, finalHand };
}

// ---------------------------------------------------------------------------
// Blackjack
// ---------------------------------------------------------------------------

/** Best total under economy.json's targetScore when possible: each Ace counts as aceHighValue unless that would bust the hand. */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  const bj = economy().casino.blackjack;
  const maxRank = economy().casino.poker.maxRank;
  let total = 0;
  let acesAsEleven = 0;
  for (const c of cards) {
    if (c.rank === maxRank) {
      total += bj.aceHighValue;
      acesAsEleven += 1;
    } else if (c.rank >= bj.faceCardMinRank) {
      total += bj.faceCardValue; // J/Q/K
    } else {
      total += c.rank;
    }
  }
  while (total > bj.targetScore && acesAsEleven > 0) {
    total -= bj.aceHighValue - bj.aceLowValue;
    acesAsEleven -= 1;
  }
  return { total, soft: acesAsEleven > 0 };
}

/** A natural: exactly 2 cards totalling economy.json's targetScore. */
export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === economy().casino.blackjack.targetScore;
}

/** Dealer policy: hits through economy.json's dealerHitsThrough (16), stands at 17+. */
export function dealerShouldHit(dealerCards: readonly Card[]): boolean {
  return handValue(dealerCards).total <= economy().casino.blackjack.dealerHitsThrough;
}

export type BlackjackResultKind = 'playerWin' | 'dealerWin' | 'push';

export interface BlackjackOutcome {
  result: BlackjackResultKind;
  /** Payout table multiplier (0 on a loss or push). */
  multiplier: number;
  /** Total dollars returned to the player, including their own stake. */
  payout: number;
  net: number;
  playerTotal: number;
  dealerTotal: number;
  playerBlackjack: boolean;
  dealerBlackjack: boolean;
}

/**
 * Pure settlement given two FINAL hands - no dealing, no drawing. Encodes
 * every payout/tie rule straight out of economy.json's `casino.blackjack`:
 * dealer-wins-ties, a five-card non-bust hand winning outright, an exact 21
 * beating a would-be tie, and the ordinary vs. two-card-natural payouts.
 */
export function judgeBlackjackHands(bet: number, playerCards: readonly Card[], dealerCards: readonly Card[]): BlackjackOutcome {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw new RangeError('judgeBlackjackHands: bet must be a positive integer');
  }

  const cfg = economy().casino.blackjack;
  const playerTotal = handValue(playerCards).total;
  const dealerTotal = handValue(dealerCards).total;
  const playerBusted = playerTotal > cfg.targetScore;
  const dealerBusted = dealerTotal > cfg.targetScore;
  const playerBJ = isBlackjack(playerCards);
  const dealerBJ = isBlackjack(dealerCards);
  const fiveCardWin = cfg.fiveCardNonBustWins && !playerBusted && playerCards.length >= cfg.fiveCardCount;

  const win = (multiplier: number): BlackjackOutcome => {
    // Same "for 1" total-return convention as the poker table (see
    // playFiveCardDraw): ordinaryPayout/twoCardBlackjackPayout already
    // include the player's stake.
    const payout = bet * multiplier;
    return {
      result: 'playerWin',
      multiplier,
      payout,
      net: payout - bet,
      playerTotal,
      dealerTotal,
      playerBlackjack: playerBJ,
      dealerBlackjack: dealerBJ,
    };
  };
  const lose = (): BlackjackOutcome => ({
    result: 'dealerWin',
    multiplier: 0,
    payout: 0,
    net: -bet,
    playerTotal,
    dealerTotal,
    playerBlackjack: playerBJ,
    dealerBlackjack: dealerBJ,
  });
  const pushHand = (): BlackjackOutcome => ({
    result: 'push',
    multiplier: 0,
    payout: bet,
    net: 0,
    playerTotal,
    dealerTotal,
    playerBlackjack: playerBJ,
    dealerBlackjack: dealerBJ,
  });
  const tie = (): BlackjackOutcome => (cfg.dealerWinsTies ? lose() : pushHand());

  if (playerBusted) return lose();
  if (fiveCardWin) return win(cfg.ordinaryPayout);
  if (playerBJ && dealerBJ) return tie();
  if (playerBJ) return win(cfg.twoCardBlackjackPayout);
  if (dealerBJ) return lose();
  if (dealerBusted) return win(cfg.ordinaryPayout);
  if (cfg.exactTwentyOneWins && playerTotal === cfg.targetScore && dealerTotal === cfg.targetScore) return win(cfg.ordinaryPayout);
  if (playerTotal > dealerTotal) return win(cfg.ordinaryPayout);
  if (playerTotal < dealerTotal) return lose();
  return tie();
}

export interface BlackjackRound {
  bet: number;
  deck: Card[];
  player: Card[];
  dealer: Card[];
  playerDone: boolean;
  outcome: BlackjackOutcome | null;
}

function finishDealerTurn(round: BlackjackRound): BlackjackRound {
  const playerBusted = handValue(round.player).total > economy().casino.blackjack.targetScore;
  const playerBJ = isBlackjack(round.player);
  let deck = round.deck;
  let dealer = round.dealer;

  if (!playerBusted && !playerBJ) {
    while (dealerShouldHit(dealer)) {
      const { drawn, rest } = takeCards(deck, 1);
      const card = drawn[0];
      if (card === undefined) break;
      deck = rest;
      dealer = [...dealer, card];
    }
  }

  const outcome = judgeBlackjackHands(round.bet, round.player, dealer);
  return { ...round, deck, dealer, playerDone: true, outcome };
}

/** Deals the opening two cards each to player and dealer; settles immediately on any natural. */
export function dealBlackjackHand(bet: number, rng: Rng): BlackjackRound {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw new RangeError('dealBlackjackHand: bet must be a positive integer');
  }

  const shuffled = shuffledDeck(rng);
  const { drawn: player, rest: afterPlayer } = takeCards(shuffled, 2);
  const { drawn: dealer, rest: deck } = takeCards(afterPlayer, 2);
  const naturalEnds = isBlackjack(player) || isBlackjack(dealer);

  const round: BlackjackRound = { bet, deck, player, dealer, playerDone: naturalEnds, outcome: null };
  return naturalEnds ? finishDealerTurn(round) : round;
}

/** Draws one more player card; busting (or reaching 5 non-bust cards) ends the player's turn. */
export function blackjackHit(round: BlackjackRound): BlackjackRound {
  if (round.playerDone) {
    throw new RangeError('blackjackHit: hand is no longer accepting player actions');
  }
  const { drawn, rest } = takeCards(round.deck, 1);
  const card = drawn[0];
  if (card === undefined) throw new RangeError('blackjackHit: deck exhausted');

  const player = [...round.player, card];
  const total = handValue(player).total;
  const cfg = economy().casino.blackjack;
  const done = total > cfg.targetScore || player.length >= cfg.fiveCardCount;
  const next: BlackjackRound = { ...round, deck: rest, player, playerDone: done };
  return done ? finishDealerTurn(next) : next;
}

/** Ends the player's turn without drawing; plays out and settles the dealer's hand. */
export function blackjackStand(round: BlackjackRound): BlackjackRound {
  if (round.outcome !== null) return round;
  return finishDealerTurn({ ...round, playerDone: true });
}
