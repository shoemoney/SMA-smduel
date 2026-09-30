/**
 * Arena victory acceptance gate: a HEADLESS run of a real amateur-night
 * match, driving only `@/app`'s own exported arena-event systems (the exact
 * spawn/AI/driving/weapons/damage pipeline `showArenaEvent` wires up) and
 * `@/sim/arena`'s own `beginArenaMatch`/`resolveArenaExit` — never a
 * developer shortcut that calls `recordOpponentDefeated` directly. No DOM,
 * no renderer, no `@/ui/**`.
 *
 * Before this pass, `recordOpponentDefeated` was dead code and every paying
 * arena event could only resolve as ESCAPE (see `@/sim/arena`'s own
 * `resolveArenaExit`): opponents were never spawned, so `opponentsDefeated`
 * could never reach `opponentsTotal`. This test proves the opposite is now
 * true for a real match:
 *
 *   1. `spawnArenaOpponents` deals amateur-night's real 5-opponent roster
 *      onto the real spawn ring (`driving.json`'s `arena.spawnRingRadiusM`/
 *      `minSpawnSeparationM`), deterministically from the match's own
 *      seeded RNG.
 *   2. Every opponent is driven by the REAL `@/sim/ai` `decideAI` via
 *      `makeArenaAISystem` — it only ever emits an `InputFrame`, same as
 *      the player's own input.
 *   3. Every shot (player's and every opponent's) goes through the REAL
 *      `fire()`/`applyResolvedShot()` pipeline (`makeArenaWeaponsSystem`/
 *      `makeArenaDamageSystem`) — no field is ever hand-set to "destroyed".
 *   4. An opponent whose hit report comes back plant-destroyed or
 *      driver-defeated is marked `destroyed` and its defeat is recorded
 *      through the REAL `recordOpponentDefeated` — never a direct
 *      `opponentsDefeated` write.
 *   5. Once every opponent is down and the player drives out under their
 *      own power, `resolveArenaExit` resolves a real VICTORY and pays
 *      amateur-night's own `cashReward`/`prestigeReward` (read from
 *      `getArenaEvent`, never a literal here).
 *
 * The player's own "input" is a small scripted policy (lock onto the
 * nearest live opponent, steer to bring the FRONT machine gun to bear via
 * the same `computeAlignmentInput` the AI itself uses, hold the trigger) —
 * driven through the exact same `sampleInput -> loop.advance -> systems`
 * pipeline a human's keyboard input would be, never a developer shortcut
 * into the sim. Amateur-night fields five simultaneous, real, undiminished
 * "runner"-tuned opponents (see `@/sim/arena`'s `selectArchetypeForEvent` —
 * chosen by the house kart's own construction value, not hand-picked for
 * this test) against a stock, unarmored house kart, so a fair fight is
 * genuinely close: this exact seed was found by running the real production
 * pipeline against many candidate seeds and keeping one where the real,
 * unmodified combat RNG lets the player survive long enough to win — not by
 * weakening the opponents (see `arena-victory-seed-search` in git history/
 * scratch tooling for how it was found). `AMATEUR_NIGHT_SEED` is the whole
 * fixture; changing it changes the entire derived RNG stream, so it is
 * never "cleaned up" to something more readable.
 */
import { describe, expect, it } from 'vitest';

import {
  PLAYER_ID,
  cleanupSystem,
  createArenaWorld,
  findPlayer,
  makeArenaAISystem,
  makeArenaDamageSystem,
  makeArenaDrivingSystem,
  makeArenaWeaponsSystem,
  projectilesSystem,
  spawnArenaOpponents,
  vehicleStateFromDesign,
  type ArenaOpponentState,
} from '@/app';
import {
  allOpponentsDefeated,
  beginArenaMatch,
  getArenaEvent,
  allArenaArchetypes,
  arenaEligibleArchetypes,
  houseKartDesign,
  houseLoanerDesign,
  isCombatCapableArchetype,
  recordOpponentDefeated,
  selectArchetypeByValue,
  selectArchetypeForEvent,
  resolveArenaExit,
  rosterFor,
  vehicleValue,
  type ArenaEventId,
  type ArenaMatchState,
} from '@/sim/arena';
import { drivingConfig, getWeapon } from '@/data/rulesets';
import { createDriver } from '@/sim/driver';
import { createGameLoop, createSystemsRegistry, dtSecondsFromTickRate, type InputFrame } from '@/sim/loop';
import type { DriverState, SkillName, VehicleState } from '@/sim/types';
import type { World } from '@/sim/world';
import { createArenaAutopilot, type ArenaAutopilotPolicy } from '@/sim/arena-autopilot';
import arenasJsonRaw from '@rulesets/classic/arenas.json';
import encountersJsonRaw from '@rulesets/classic/encounters.json';

const AMATEUR_NIGHT_EVENT_ID = 'amateur-night' as const;
/** See the file header: found by sweeping the real production pipeline for a seed where the real combat RNG lets the player survive to a real victory. */
const AMATEUR_NIGHT_SEED = 'sweep-seed-504';
/**
 * A seed the competent bot WINS on, for the fixed-seed victory gate below.
 * `AMATEUR_NIGHT_SEED` is not one: the competent bot clears the roster on
 * 86 of 150 seeds in this family (57.3%, measured at the loaner's shipped
 * provisioning), so a named winner is needed rather than assuming any seed
 * does. The aggregate rate is gated separately, so this constant proves the
 * victory PATH and cannot by itself make an unwinnable event look winnable.
 */
const AMATEUR_NIGHT_VICTORY_SEED = 'sweep-seed-500';
const MAX_TICKS = 3000;

function testPlayerSkills(): Record<SkillName, number> {
  // A marksman, not an all-rounder. The previous 25/25 split made the victory
  // test a 5-on-1 against opponents who were BETTER shots than the player —
  // which only looked survivable while opponents were unarmed couriers that
  // never fired. Still a legal 50-point allocation.
  return { driving: 15, marksmanship: 35, mechanic: 0 };
}

function makeTestDriver(): DriverState {
  const result = createDriver('Night Tester', testPlayerSkills());
  if (!result.ok) throw new Error(`test fixture: expected a legal skill split, got "${result.reason}"`);
  return result.driver;
}

/** How the scripted player manages its magazines. See `samplePlayerInput`. */
type PlayerPolicy = ArenaAutopilotPolicy;

interface AmateurNightMatch {
  readonly world: World;
  readonly playerVehicleId: string;
  readonly opponents: Map<string, ArenaOpponentState>;
  readonly driverRef: { current: DriverState };
  readonly matchStateRef: { current: ArenaMatchState };
  readonly loop: ReturnType<typeof createGameLoop>;
}

/**
 * Begins a real amateur-night match through the exact production seam
 * `showArenaEvent` itself calls (`beginArenaMatch` -> `createArenaWorld` ->
 * `spawnArenaOpponents`), then wires the same `makeArena*System` factories
 * into a headless `createGameLoop` — no DOM, but not a re-implementation
 * either.
 */
function beginAmateurNightMatch(seed: string, policy: PlayerPolicy = 'naive'): AmateurNightMatch {
  const driver0 = makeTestDriver();
  // amateur-night is entered on foot (`eligibility.kind ===
  // 'on-foot-under-threshold'`) — no player-owned vehicle to check, so the
  // eligibility argument is `null`, exactly like `resolveArenaWorld` passes
  // for a house-sourced event.
  const matchResult = beginArenaMatch(driver0, null, AMATEUR_NIGHT_EVENT_ID);
  if (!matchResult.ok) throw new Error(`test fixture: expected amateur-night to be enterable, got "${matchResult.reason}"`);

  // The REAL loaner `arenaPlayerVehicle` hands a carless entrant, not the
  // opponents' kart. Those were one row until amateur-night proved unplayable
  // that way; building the player from `houseKartDesign` here would test a car
  // production no longer issues.
  const playerVehicle: VehicleState = vehicleStateFromDesign(houseLoanerDesign(), 'veh-player', PLAYER_ID);
  const world = createArenaWorld(seed, playerVehicle);
  const event = getArenaEvent(AMATEUR_NIGHT_EVENT_ID);
  const opponents = spawnArenaOpponents(world, event);

  const driverRef = { current: matchResult.driver };
  const matchStateRef = { current: matchResult.state };
  const spawnCounter = { current: 0 };
  const aiInputs = new Map<string, InputFrame>();
  const projectileTargets = new Map<string, string>();
  const noopLog = (): void => {};

  const systems = createSystemsRegistry();
  systems.register('driving', makeArenaDrivingSystem(driverRef, playerVehicle.id, opponents, aiInputs));
  systems.register(
    'weapons',
    makeArenaWeaponsSystem(driverRef, playerVehicle.id, opponents, aiInputs, projectileTargets, spawnCounter, noopLog),
  );
  systems.register('projectiles', projectilesSystem);
  systems.register('damage', makeArenaDamageSystem(playerVehicle.id, driverRef, opponents, projectileTargets, matchStateRef, noopLog));
  systems.register('ai', makeArenaAISystem(playerVehicle.id, opponents, aiInputs));
  systems.register('cleanup', cleanupSystem);

  // The player's own "controller" is now SHARED production code, not a second
  // copy living in this test. It was test-local here until iteration 136, when
  // the DOM auto-end test needed the same driver and a duplicate would have
  // been exactly the failure mode that produced the 90-degree body-frame bug:
  // two implementations of "how a competent player aims", free to disagree.
  const autopilot = createArenaAutopilot(world, playerVehicle.id, policy);

  const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);
  const loop = createGameLoop({ world, dtSeconds, systems, sampleInput: () => autopilot.sample() });

  return { world, playerVehicleId: playerVehicle.id, opponents, driverRef, matchStateRef, loop };
}

describe('arena-event opponents: real spawn, real decideAI, real fire pipeline', () => {
  it('deals the real amateur-night roster onto the real spawn ring, deterministically, with real separation', () => {
    const match = beginAmateurNightMatch(AMATEUR_NIGHT_SEED);
    const roster = rosterFor(AMATEUR_NIGHT_EVENT_ID);
    const event = getArenaEvent(AMATEUR_NIGHT_EVENT_ID);
    const cfg = drivingConfig();

    expect(match.opponents.size).toBe(roster.opponentCount);
    expect(match.matchStateRef.current.opponentsTotal).toBe(event.opponentCount);
    expect(match.world.entities.vehicles.length).toBe(1 + roster.opponentCount);

    const opponentVehicles = match.world.entities.vehicles.filter((v) => v.id !== match.playerVehicleId);
    expect(opponentVehicles.length).toBe(roster.opponentCount);

    // Every opponent drives the real house-kart design (vehicleSource:
    // 'house'), the exact same one the player themselves is issued.
    for (const vehicle of opponentVehicles) {
      expect(vehicle.design.bodyId).toBe(houseKartDesign().bodyId);
      expect(vehicle.weapons.length).toBe(houseKartDesign().weapons.length);
    }

    // On the real spawn ring, radius `driving.json`'s own spawnRingRadiusM.
    for (const vehicle of opponentVehicles) {
      const radiusM = Math.hypot(vehicle.position.x, vehicle.position.y);
      expect(radiusM).toBeCloseTo(cfg.arena.spawnRingRadiusM, 6);
    }

    // At least minSpawnSeparationM apart, pairwise — checked directly here,
    // not just trusted from computeArenaSpawnPositions' own internal guard.
    for (let i = 0; i < opponentVehicles.length; i++) {
      for (let j = i + 1; j < opponentVehicles.length; j++) {
        const a = opponentVehicles[i];
        const b = opponentVehicles[j];
        if (a === undefined || b === undefined) throw new Error('unreachable');
        const distance = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        expect(distance).toBeGreaterThanOrEqual(cfg.arena.minSpawnSeparationM);
      }
    }

    // Deterministic from the session seed: a second match built from the
    // exact same seed spawns the exact same roster in the exact same
    // positions.
    const again = beginAmateurNightMatch(AMATEUR_NIGHT_SEED);
    const againVehicles = again.world.entities.vehicles.filter((v) => v.id !== again.playerVehicleId);
    expect(againVehicles.map((v) => ({ id: v.id, position: v.position }))).toEqual(
      opponentVehicles.map((v) => ({ id: v.id, position: v.position })),
    );
  });

  // WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT.
  //
  // It proves the VICTORY PIPELINE: opponents spawn, take damage through the
  // real fire/applyResolvedShot path, and their defeats are recorded through the
  // real recordOpponentDefeated — never a direct field write — and that when
  // opponentsDefeated reaches opponentsTotal, resolveArenaExit pays exactly the
  // event's own reward.
  //
  // It does NOT assert the scripted player WINS a 5-on-1. It used to, and that
  // only passed because the arena was fielding the `runner` archetype — an
  // unarmed courier whose sole mount is a REAR smokescreen — so the player took
  // literally zero damage and the "victory" was uncontested. Once opponents
  // could actually shoot (see isCombatCapableArchetype in @/sim/arena), the
  // reference bot loses: it drives straight at the nearest enemy and never
  // evades. Whether a HUMAN can win amateur-night is a balance question this
  // bot cannot answer, so it is asked separately below rather than smuggled
  // into a pipeline assertion.
  it('defeats opponents through the real damage pipeline, and pays exactly the event reward on a real VICTORY', () => {
    const event = getArenaEvent(AMATEUR_NIGHT_EVENT_ID);
    const match = beginAmateurNightMatch(AMATEUR_NIGHT_SEED);
    const driverBefore = match.driverRef.current;

    for (let tick = 0; tick < MAX_TICKS; tick++) {
      match.loop.sampleInput();
      match.loop.step();
      if (allOpponentsDefeated(match.matchStateRef.current)) break;
      const p = findPlayer(match.world);
      if (p === undefined || p.destroyed) break;
    }

    // At least one opponent died through the REAL pipeline. recordOpponentDefeated
    // only ever runs from inside makeArenaDamageSystem's hit resolution, so a
    // nonzero count is proof the whole chain executed.
    expect(match.matchStateRef.current.opponentsDefeated).toBeGreaterThan(0);
    const destroyedOpponents = match.world.entities.vehicles.filter((v) => v.id !== match.playerVehicleId && v.destroyed);
    expect(destroyedOpponents.length).toBe(match.matchStateRef.current.opponentsDefeated);

    // Payout accounting on a real VICTORY. The match state is advanced to a full
    // sweep the ONLY legitimate way — through recordOpponentDefeated itself — so
    // this still never hand-writes opponentsDefeated.
    let finished = match.matchStateRef.current;
    while (!allOpponentsDefeated(finished)) finished = recordOpponentDefeated(finished);

    const resolution = resolveArenaExit(finished, match.driverRef.current, 'UNDER_POWER');
    expect(resolution.outcome).toBe('VICTORY');
    expect(resolution.cashAwarded).toBe(event.cashReward);
    expect(resolution.driver.cash).toBe(driverBefore.cash + event.cashReward);
    expect(resolution.prestigeDelta).toBe(event.prestigeReward);
    expect(resolution.driver.prestige).toBe(driverBefore.prestige + event.prestigeReward);
    expect(resolution.vehicleForfeited).toBe(false);
  });

  // KNOWN BALANCE STATE, asserted so it cannot change silently.
  //
  // The naive bot LOSES amateur-night, and it is supposed to. It differs from the
  // competent bot below by one habit: it pulls mount 0 until that magazine is dry
  // and then keeps pulling it, so past 20 rounds it cannot hurt anyone. Clearing
  // the roster costs more rounds than one mount holds, which is exactly why the
  // loaner carries four. A careless entrant losing is the intended shape of the
  // on-ramp; if this ever flips to a win, the loaner has been over-provisioned
  // and the pair of tests stops discriminating, so look at it on purpose.
  it('KNOWN: a bot that never switches magazines does not clear a 5-on-1 amateur night', () => {
    const match = beginAmateurNightMatch(AMATEUR_NIGHT_SEED, 'naive');
    let swept = false;
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      match.loop.sampleInput();
      match.loop.step();
      if (allOpponentsDefeated(match.matchStateRef.current)) { swept = true; break; }
      const p = findPlayer(match.world);
      if (p === undefined || p.destroyed) break;
    }
    expect({ swept, note: 'if this flips to true, amateur-night balance changed — review it' })
      .toEqual({ swept: false, note: 'if this flips to true, amateur-night balance changed — review it' });
  });

  // THE GATE THAT WOULD HAVE CAUGHT THE ORIGINAL BUG.
  //
  // Amateur-night shipped unwinnable. The loaner was the opponents' own row, so
  // one player faced five cars that all prefer the player as a target: the
  // player died around tick 152 on every seed, and clearing the roster cost
  // about 59 rounds against a 20-round magazine, so VICTORY was unreachable at
  // any skill level on any seed. Nothing in the suite asserted a player could
  // ever win, only that the pipeline COULD record a win once handed a full
  // sweep. This drives the real production loaner through the real systems and
  // requires an actual sweep.
  it('a competent player CLEARS the roster and resolves a real VICTORY', () => {
    const event = getArenaEvent(AMATEUR_NIGHT_EVENT_ID);
    const match = beginAmateurNightMatch(AMATEUR_NIGHT_VICTORY_SEED, 'competent');
    const driverBefore = match.driverRef.current;

    let swept = false;
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      match.loop.sampleInput();
      match.loop.step();
      if (allOpponentsDefeated(match.matchStateRef.current)) { swept = true; break; }
      const p = findPlayer(match.world);
      if (p === undefined || p.destroyed) break;
    }

    const player = findPlayer(match.world);
    expect({ swept, playerDestroyed: player?.destroyed }).toEqual({ swept: true, playerDestroyed: false });
    expect(match.matchStateRef.current.opponentsDefeated).toBe(match.matchStateRef.current.opponentsTotal);

    // Driven out under its own power, off a roster cleared by real shots, so
    // this is the genuine VICTORY branch rather than the hand-advanced one.
    const resolution = resolveArenaExit(match.matchStateRef.current, match.driverRef.current, 'UNDER_POWER');
    expect(resolution.outcome).toBe('VICTORY');
    expect(resolution.cashAwarded).toBe(event.cashReward);
    expect(resolution.driver.cash).toBe(driverBefore.cash + event.cashReward);
  });

  // THE BALANCE GATE, and the one that does not rest on a chosen seed.
  //
  // A single winning seed proves the victory path exists; it cannot tell you
  // whether the event is winnable in general, which is precisely the hole the
  // original bug hid in. This runs a seed SET and gates the rate from both
  // sides: unwinnable fails it, and so does a walkover. The band is wide on
  // purpose, because the shipped tuning sits near the middle of it (57.3%
  // measured over 150 seeds) and a retune should have room to move without
  // a red suite, while 0% or 100% must never pass.
  it('amateur-night is winnable at a real rate, and never a walkover', () => {
    const SEEDS = 40;
    let competentWins = 0;
    let naiveWins = 0;

    for (let i = 0; i < SEEDS; i++) {
      const seed = `sweep-seed-${500 + i}`;
      for (const policy of ['competent', 'naive'] as const) {
        const match = beginAmateurNightMatch(seed, policy);
        for (let tick = 0; tick < MAX_TICKS; tick++) {
          match.loop.sampleInput();
          match.loop.step();
          if (allOpponentsDefeated(match.matchStateRef.current)) break;
          const p = findPlayer(match.world);
          if (p === undefined || p.destroyed) break;
        }
        const player = findPlayer(match.world);
        const won = allOpponentsDefeated(match.matchStateRef.current) && player?.destroyed === false;
        if (won && policy === 'competent') competentWins += 1;
        if (won && policy === 'naive') naiveWins += 1;
      }
    }

    // Winnable: the whole point of the fix. Before it this was 0 at every seed.
    expect({ winnable: competentWins > 0, competentWins }).toEqual({ winnable: true, competentWins });
    expect(competentWins).toBeGreaterThanOrEqual(Math.round(SEEDS * 0.3));
    // Not a walkover: an on-ramp the player cannot lose teaches nothing either.
    expect(competentWins).toBeLessThanOrEqual(Math.round(SEEDS * 0.85));
    // And the careless entrant still loses, so the two are really different.
    expect({ naiveWins }).toEqual({ naiveWins: 0 });
    // This one simulates 80 full matches (40 seeds x 2 policies) through the
    // real systems. Alone it takes ~2.7s; running alongside the rest of the
    // suite it exceeded vitest's 5s DEFAULT timeout and failed intermittently,
    // which reads as a balance regression and is really just a loaded machine.
    // The budget is set explicitly so the failure mode stays "the numbers
    // changed", not "the box was busy".
  }, 60_000);

  // An on-ramp won in four seconds teaches nothing. Measured on the victory
  // seed, where the sweep lands at a median of tick 744 (about 12 seconds), so
  // a five-second floor is a real bound rather than a restatement of the median.
  it('a win takes a fight, not a blink', () => {
    const match = beginAmateurNightMatch(AMATEUR_NIGHT_VICTORY_SEED, 'competent');
    const fiveSeconds = Math.round(drivingConfig().tickRateHz * 5);

    for (let tick = 0; tick < MAX_TICKS; tick++) {
      match.loop.sampleInput();
      match.loop.step();
      if (allOpponentsDefeated(match.matchStateRef.current)) break;
      const p = findPlayer(match.world);
      if (p === undefined || p.destroyed) break;
    }

    const wonAtTick = match.world.tick;
    expect(allOpponentsDefeated(match.matchStateRef.current)).toBe(true);
    expect({ wonAtTick, tookAFight: wonAtTick > fiveSeconds }).toEqual({ wonAtTick, tookAFight: true });
  });

  // SURVIVABILITY, the other half of the fix and separable from winnability:
  // the loaner needs armor it can afford to lose, not just magazines. Three
  // seconds is chosen against the measured failure it replaces — the old loaner
  // died at a median of tick 152, about 2.5 seconds — so this assertion is one
  // the shipped-broken build could not have passed. Run on the HARD seed, the
  // one the competent bot does not even win, so it bounds the bad case.
  it('the loaner is still alive three seconds in, past the tick the old one died on', () => {
    const match = beginAmateurNightMatch(AMATEUR_NIGHT_SEED, 'competent');
    const threeSeconds = Math.round(drivingConfig().tickRateHz * 3);
    for (let tick = 0; tick < threeSeconds; tick++) {
      match.loop.sampleInput();
      match.loop.step();
    }
    const player = findPlayer(match.world);
    expect(player).toBeDefined();
    if (player === undefined) throw new Error('unreachable');
    expect({ destroyed: player.destroyed, driverAlive: match.driverRef.current.naturalHealth > 0 }).toEqual({
      destroyed: false,
      driverAlive: true,
    });
  });

  // The victory test asserts `player.destroyed === false`, which a verifier proved
  // is satisfied just as well by a player who CANNOT be hurt: making the player
  // invulnerable in makeArenaDamageSystem (RNG draws preserved, so the stream is
  // identical) passed 975/975. Nothing in the whole suite asserted the fight was
  // two-sided. Winning against opponents who cannot hurt you is not a win.
  it('the player genuinely takes INCOMING FIRE — damage a collision could not have caused', () => {
    const match = beginAmateurNightMatch(AMATEUR_NIGHT_SEED);
    const start = findPlayer(match.world);
    expect(start).toBeDefined();
    if (start === undefined) throw new Error('unreachable');

    // Collision damage is confined to ONE facing by driving.json
    // (collision.armorLossFacing), and never touches tires or the power plant.
    // So loss anywhere else is proof a weapon connected. An earlier version of
    // this test just summed total armor, and a verifier showed it passed even
    // with the combat-capability gate removed — the player was being RAMMED by
    // retreating unarmed couriers, not shot at.
    const collisionFacing = drivingConfig().collision.armorLossFacing;
    const nonCollisionArmor = (v: VehicleState) =>
      Object.entries(v.armorDP).reduce((sum, [facing, dp]) => (facing === collisionFacing ? sum : sum + dp), 0);

    const startArmor = nonCollisionArmor(start);
    const startTires = start.tireDP.reduce((a, b) => a + b, 0);
    const startPlant = start.plantDP;
    let worstArmor = startArmor;
    let worstTires = startTires;
    let worstPlant = startPlant;

    for (let tick = 0; tick < MAX_TICKS; tick++) {
      match.loop.sampleInput();
      match.loop.step();
      const p = findPlayer(match.world);
      if (p === undefined) break;
      worstArmor = Math.min(worstArmor, nonCollisionArmor(p));
      worstTires = Math.min(worstTires, p.tireDP.reduce((a, b) => a + b, 0));
      worstPlant = Math.min(worstPlant, p.plantDP);
      if (allOpponentsDefeated(match.matchStateRef.current) || p.destroyed) break;
    }

    const wasShot = worstArmor < startArmor || worstTires < startTires || worstPlant < startPlant;
    expect({ wasShot, startArmor, worstArmor }).toEqual({ wasShot: true, startArmor, worstArmor });
  });

  it('exiting early (before any opponent is defeated) still yields ESCAPE with the real prestige penalty, and pays nothing', () => {
    // A fresh driver starts AT skillsConfig().driver.prestigeFloor, where
    // losePrestige has nowhere left to go — bumped up first so the penalty
    // below has real room to land and isn't silently clamped to a no-op.
    const driver0: DriverState = { ...makeTestDriver(), prestige: 5 };
    const matchResult = beginArenaMatch(driver0, null, AMATEUR_NIGHT_EVENT_ID);
    if (!matchResult.ok) throw new Error(`test fixture: expected amateur-night to be enterable, got "${matchResult.reason}"`);
    expect(matchResult.state.opponentsDefeated).toBe(0);
    expect(allOpponentsDefeated(matchResult.state)).toBe(false);

    const resolution = resolveArenaExit(matchResult.state, matchResult.driver, 'UNDER_POWER');
    expect(resolution.outcome).toBe('ESCAPE');
    expect(resolution.cashAwarded).toBe(0);
    expect(resolution.driver.cash).toBe(matchResult.driver.cash);

    const expectedPenalty = arenasJsonRaw._reconstruction.escapePrestigePenalty;
    expect(resolution.prestigeDelta).toBe(-expectedPenalty);
    expect(resolution.driver.prestige).toBe(matchResult.driver.prestige - expectedPenalty);
  });
});

// ---------------------------------------------------------------------------
// A small sanity check on the value used to select amateur-night's opponent
// archetype (`selectArchetypeForEvent` in `@/sim/arena`) — a real,
// ruleset-derived number, not a literal.
// ---------------------------------------------------------------------------
describe('amateur-night opponent tuning is value-derived, not a literal', () => {
  // Direct assertion, deliberately NOT emergent. encounters.json's archetype pool
  // is shared with the road, so it contains genuine non-combatants: `beater` has
  // no weapons at all and `runner`'s only mount is a REAR smokescreen. Selecting
  // purely by value band once handed the arena the `runner`.
  //
  // Testing this through amateur-night does not work and it is worth saying why:
  // that event is house-sourced, so opponents fly the house kart's FRONT machine
  // gun whatever archetype is chosen — only skill and personality come from the
  // archetype. The gate genuinely bites on own-vehicle events (divisions,
  // unlimited, championship), where `archetype.design` IS the opponent's car. So
  // assert the selection rule itself rather than hoping a match surfaces it.
  it('every arena event selects a COMBAT-CAPABLE archetype — never a weaponless civilian or a smoke-only courier', () => {
    const eventIds = (arenasJsonRaw as { events: Array<{ id: string }> }).events.map((e) => e.id as ArenaEventId);
    expect(eventIds.length).toBeGreaterThan(0);

    for (const id of eventIds) {
      const event = getArenaEvent(id);
      const chosen = selectArchetypeForEvent(event);
      expect({ event: id, combatCapable: isCombatCapableArchetype(chosen) }).toEqual({ event: id, combatCapable: true });
      const damaging = chosen.design.weapons.filter((m) => getWeapon(m.weaponId).damage.kind !== 'NONE');
      expect({ event: id, archetype: chosen.id, damagingMounts: damaging.length > 0 }).toEqual({
        event: id,
        archetype: chosen.id,
        damagingMounts: true,
      });
    }
  });

  // The discriminating case. encounters.json deliberately contains a value range
  // where the nearest-banded archetype overall IS a non-combatant (`beater`, no
  // weapons at all). Without the combat-capability gate, selectArchetypeByValue
  // returns it and the arena fields a car that cannot shoot. With the gate, the
  // nearest FIGHTER is returned instead. This is the assertion that actually dies
  // if the gate is removed.
  it('selectArchetypeByValue never returns a non-combatant, even at a value where one is nearest', () => {
    const raw = (encountersJsonRaw as unknown as { archetypes: Array<{ id: string; valueBand: [number, number]; design: { weapons: Array<{ weaponId: string }> } }> }).archetypes;
    const nearestOverall = (value: number) => {
      let best = raw[0]!;
      let bestDistance = Infinity;
      for (const a of raw) {
        const [min, max] = a.valueBand;
        const d = value < min ? min - value : value > max ? value - max : 0;
        if (d < bestDistance) { bestDistance = d; best = a; }
      }
      return best;
    };

    // Find a probe value where the unfiltered nearest genuinely cannot fight.
    let probe: number | null = null;
    for (let v = 0; v <= 30_000; v += 50) {
      const candidate = nearestOverall(v);
      const damaging = candidate.design.weapons.filter((m) => getWeapon(m.weaponId).damage.kind !== 'NONE');
      if (damaging.length === 0) { probe = v; break; }
    }
    // If this ever becomes null the fixture has lost its teeth — fail loudly
    // rather than silently asserting nothing.
    expect({ foundNonCombatantProbe: probe !== null }).toEqual({ foundNonCombatantProbe: true });

    const chosen = selectArchetypeByValue(probe as number);
    expect({ probe, combatCapable: isCombatCapableArchetype(chosen) }).toEqual({ probe, combatCapable: true });
  });

  it('the arena-eligible pool excludes the archetypes that cannot fight', () => {
    const eligible = new Set(arenaEligibleArchetypes().map((a) => a.id));
    const all = allArenaArchetypes();
    const excluded = all.filter((a) => !eligible.has(a.id)).map((a) => a.id).sort();
    // beater carries no weapons; runner carries only a smokescreen.
    expect(excluded).toEqual(['beater', 'runner']);
    expect(eligible.size).toBeGreaterThan(0);
  });

  it('the house kart has a real, positive construction value to select an archetype by', () => {
    const value = vehicleValue({ design: houseKartDesign(), destroyed: false });
    expect(value).toBeGreaterThan(0);
  });

  // WAS VACUOUS. The previous version asserted only `>= 0`, which every skill
  // trivially satisfies — a verifier proved that hard-coding every opponent to
  // { driving: 0, marksmanship: 0 } passed 975/975. That is exactly the "nerf the
  // AI so the player wins" failure this test is named for, and it sailed through.
  // Skills must now MATCH the archetype they were selected from, read out of
  // encounters.json rather than restated here.
  it('every spawned opponent carries its archetype\'s OWN skill pair, not a zeroed or invented one', () => {
    const match = beginAmateurNightMatch(AMATEUR_NIGHT_SEED);
    const archetypeSkills = new Map(
      (encountersJsonRaw as { archetypes: Array<{ id: string; skill: { driving: number; marksmanship: number } }> }).archetypes.map(
        (a) => [a.id, a.skill],
      ),
    );

    const opponents = [...match.opponents.values()];
    expect(opponents.length).toBeGreaterThan(0);

    for (const opponent of opponents) {
      const expected = archetypeSkills.get(opponent.archetypeId);
      expect({ id: opponent.archetypeId, known: expected !== undefined }).toEqual({ id: opponent.archetypeId, known: true });
      expect({
        driving: opponent.driver.skills.driving,
        marksmanship: opponent.driver.skills.marksmanship,
      }).toEqual({ driving: expected!.driving, marksmanship: expected!.marksmanship });
    }

    // And at least one opponent must actually be competent — a roster where every
    // archetype happened to be skill-0 would satisfy the equality above.
    expect(Math.max(...opponents.map((o) => o.driver.skills.marksmanship))).toBeGreaterThan(0);
    expect(Math.max(...opponents.map((o) => o.driver.skills.driving))).toBeGreaterThan(0);
  });
});
