/**
 * Pure arcade leaderboard scoring: the formula, the API payload shape, and
 * the submit-eligibility gate. No fetch, no DOM, no `document`/`window` -
 * `@/arcade/client` is the only file in the repo that talks to the score
 * API; this file only computes numbers from a real `ArenaMatchState`.
 *
 * Difficulty and par time are derived from `opponentsTotal` rather than a
 * second per-event difficulty table: `opponentCount` already lives in
 * rulesets/classic/arenas.json (via `@/sim/arena`'s `getArenaEvent`), and a
 * duplicate table here would drift from it.
 */
import { arcadeScoreWeights } from '@/data/arcade';
import type { ArenaMatchState, ArenaOutcome } from '@/sim/arena';

export interface ArcadeScoreInput {
  readonly kills: number;
  readonly driverKills: number;
  readonly opponentsTotal: number;
  readonly durationSeconds: number;
}

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * raw   = (killPoints*kills + driverKillPoints*driverKills) * (1 + opponentScaling*opponentsTotal)
 *         + max(0, parSecondsPerOpponent*opponentsTotal - durationSeconds) * speedPoints
 * score = clamp(0, maxScore, round(raw))
 */
export function arcadeScore(input: ArcadeScoreInput): number {
  const weights = arcadeScoreWeights();
  const base = weights.killPoints * input.kills + weights.driverKillPoints * input.driverKills;
  const scaled = base * (1 + weights.opponentScaling * input.opponentsTotal);
  const par = weights.parSecondsPerOpponent * input.opponentsTotal;
  const speedBonus = Math.max(0, par - input.durationSeconds) * weights.speedPoints;
  return clamp(0, weights.maxScore, Math.round(scaled + speedBonus));
}

export interface ArcadeScorePayload {
  readonly score: number;
  readonly wave: number;
  readonly kills: number;
  readonly headshots: number;
  readonly duration: number;
}

/**
 * Pure payload builder from a real match state plus the tick count and
 * fixed timestep the match ran at (never a tick-rate NUMBER - that comes
 * from `drivingConfig().tickRateHz` at the caller, via `@/sim/loop`'s
 * `dtSecondsFromTickRate`, so this file stays free of gameplay literals).
 *
 * `headshots` is `min(driverDefeatedCount, kills)` - belt and braces on top
 * of the construction guarantee already inside `recordOpponentDefeated`
 * (opponentsDefeated clamps at opponentsTotal, and driverDefeatedCount only
 * ever increments on that SAME clamped increment, so it can never exceed
 * opponentsDefeated). The server rejects `headshots > kills` outright, and
 * it wants BOTH guarantees, not either - deleting this clamp because "the
 * match state already proves it" removes the belt while the suspenders are
 * a different file's promise.
 */
export function buildArcadePayload(state: ArenaMatchState, tick: number, dtSeconds: number): ArcadeScorePayload {
  const durationSeconds = tick * dtSeconds;
  const score = arcadeScore({
    kills: state.opponentsDefeated,
    driverKills: state.driverDefeatedCount,
    opponentsTotal: state.opponentsTotal,
    durationSeconds,
  });
  return {
    score,
    wave: state.opponentsTotal,
    kills: state.opponentsDefeated,
    headshots: Math.min(state.driverDefeatedCount, state.opponentsDefeated),
    duration: clamp(0, 86400, Math.round(durationSeconds)),
  };
}

/**
 * True only for a VICTORY over a nonzero roster - excludes `practice`
 * (opponentCount 0 in rulesets/classic/arenas.json), which would otherwise
 * be an instant free win with nothing to score. Every other event is
 * cadence-gated (weekly / scheduled / championship-cycle), so farming is
 * already bounded by the game's own calendar; this adds no anti-farm state
 * of its own.
 */
export function shouldSubmitArcadeScore(outcome: ArenaOutcome, state: ArenaMatchState): boolean {
  return outcome === 'VICTORY' && state.opponentsTotal > 0;
}
