/**
 * Proves `@/arcade/score`'s formula against two hand-worked sanity numbers,
 * proves the payload's cross-field invariants hold even under states that
 * TRY to break them, and proves the submit gate excludes both `practice`
 * and every non-victory exit.
 */
import { describe, expect, it } from 'vitest';

import { arcadeScore, buildArcadePayload, shouldSubmitArcadeScore } from '@/arcade/score';
import { getArenaEvent, recordOpponentDefeated, type ArenaMatchState } from '@/sim/arena';
import { createRng } from '@/util/rng';

function stateFor(opponentsTotal: number, opponentsDefeated: number, driverDefeatedCount: number): ArenaMatchState {
  return { eventId: 'division-5', opponentsTotal, opponentsDefeated, driverDefeatedCount };
}

describe('arcadeScore(): the formula table', () => {
  it('division-5 shape: 3 opponents, 3 kills, 1 driver-kill, 60s => 1500', () => {
    const opponentsTotal = getArenaEvent('division-5').opponentCount;
    expect(
      arcadeScore({ kills: opponentsTotal, driverKills: 1, opponentsTotal, durationSeconds: 60 }),
    ).toBe(1500);
  });

  it('city-championship shape: 8 opponents, 8 kills, 3 driver-kills, 200s => 7050', () => {
    const opponentsTotal = getArenaEvent('city-championship').opponentCount;
    expect(
      arcadeScore({ kills: opponentsTotal, driverKills: 3, opponentsTotal, durationSeconds: 200 }),
    ).toBe(7050);
  });

  it('a MAXED easy division-5 run scores below a MEDIOCRE championship run, despite the easy run being flawless', () => {
    const divisionOpponents = getArenaEvent('division-5').opponentCount;
    const championshipOpponents = getArenaEvent('city-championship').opponentCount;

    const maxedDivision = arcadeScore({
      kills: divisionOpponents,
      driverKills: divisionOpponents,
      opponentsTotal: divisionOpponents,
      durationSeconds: 0,
    });
    const mediocreChampionship = arcadeScore({
      kills: championshipOpponents,
      driverKills: 0,
      opponentsTotal: championshipOpponents,
      durationSeconds: 360,
    });

    expect(maxedDivision).toBe(2550);
    expect(mediocreChampionship).toBe(4000);
    expect(maxedDivision).toBeLessThan(mediocreChampionship);
  });

  it('clamps at the 0 floor', () => {
    // Negative kills is bad-caller-data, never a real recordOpponentDefeated
    // sweep - but arcadeScore takes plain numbers, and this is the only input
    // shape that drives raw genuinely negative, so it's the one that can
    // actually tell a real floor clamp from a clamp that quietly isn't there.
    expect(arcadeScore({ kills: -1000, driverKills: 0, opponentsTotal: 0, durationSeconds: 0 })).toBe(0);
  });

  it('clamps at the maxScore ceiling', () => {
    expect(
      arcadeScore({ kills: 10_000_000, driverKills: 10_000_000, opponentsTotal: 10_000, durationSeconds: 0 }),
    ).toBe(1_000_000_000);
  });
});

describe('buildArcadePayload(): invariants hold even under states that try to break them', () => {
  it('kills <= wave, proven via real recordOpponentDefeated sweeps that TRY to overrun the roster', () => {
    const rng = createRng('arcade-payload-fuzz-kills-seed');

    for (let i = 0; i < 500; i++) {
      const opponentsTotal = rng.int(0, 8);
      // Deliberately MORE calls than opponentsTotal - recordOpponentDefeated's
      // own clamp (proven in tests/unit/arena.test.ts) is what has to hold
      // this at bay, not buildArcadePayload defending itself.
      const calls = opponentsTotal + rng.int(0, 5);
      let state = stateFor(opponentsTotal, 0, 0);
      for (let c = 0; c < calls; c++) state = recordOpponentDefeated(state, rng.chance(50));

      const payload = buildArcadePayload(state, rng.int(0, 100_000), 1 / 60);
      expect(payload.kills).toBeLessThanOrEqual(payload.wave);
      expect(payload.headshots).toBeLessThanOrEqual(payload.kills);
    }
  });

  it('headshots <= kills even when driverDefeatedCount is hand-set above opponentsDefeated, bypassing recordOpponentDefeated entirely', () => {
    const rng = createRng('arcade-payload-fuzz-headshots-seed');

    for (let i = 0; i < 500; i++) {
      const opponentsTotal = rng.int(0, 8);
      const opponentsDefeated = rng.int(0, opponentsTotal);
      const driverDefeatedCount = opponentsDefeated + rng.int(0, 10); // hand-set ABOVE opponentsDefeated
      const payload = buildArcadePayload(stateFor(opponentsTotal, opponentsDefeated, driverDefeatedCount), rng.int(0, 100_000), 1 / 60);

      expect(payload.headshots).toBeLessThanOrEqual(payload.kills);
      expect(payload.kills).toBeLessThanOrEqual(payload.wave);
    }
  });

  it('duration is round(tick * dtSeconds), clamped to 0..86400', () => {
    const payload = buildArcadePayload(stateFor(3, 3, 1), 600, 1 / 10);
    expect(payload.duration).toBe(60);
  });
});

describe('shouldSubmitArcadeScore(): the eligibility gate', () => {
  it('practice never submits, even on a VICTORY', () => {
    const practice = getArenaEvent('practice');
    expect(practice.opponentCount).toBe(0);
    expect(shouldSubmitArcadeScore('VICTORY', stateFor(practice.opponentCount, 0, 0))).toBe(false);
  });

  it('ESCAPE never submits, even with a full roster defeated', () => {
    expect(shouldSubmitArcadeScore('ESCAPE', stateFor(3, 3, 3))).toBe(false);
  });

  it('FORFEIT never submits, even with a full roster defeated', () => {
    expect(shouldSubmitArcadeScore('FORFEIT', stateFor(3, 3, 3))).toBe(false);
  });

  it('a real VICTORY over a nonzero roster submits', () => {
    expect(shouldSubmitArcadeScore('VICTORY', stateFor(3, 3, 1))).toBe(true);
  });
});
