/**
 * Headless end-to-end campaign run, driven purely through the app's own
 * exported functions and the sim/UI modules they wire together — no DOM, no
 * `boot()` (`tests/integration/screens.test.ts` is the DOM half of this
 * acceptance bar; this is the "does the wiring itself actually hold" half).
 *
 * Scripts a driver's prestige to every quests.json gate (proving the
 * generic prestige gate, not just the-boss-tape's), then drives
 * `the-boss-tape` — the campaign's one victory-condition mission — through
 * its whole real lifecycle: hearing both clue-chain hops through the exact
 * `@/ui/journal` pipeline every facility panel calls, crossing into
 * "accepted" (`@/app`'s own `applyQuestAcceptEffects`, the same function
 * `openFacility`'s `onExit` calls) and proving BOTH `onAccept` side effects
 * fire from real ruleset data — the clone destroyed, the quest's cargo
 * loaded onto the vehicle — pursuit actually appearing on the road
 * (`beginRoadTripWithEncounters`) and at rest
 * (`rollRestAssassinationAttempt`), delivering the payload
 * (`@/app`'s own `attemptQuestDelivery`, the same function `openFacility`
 * calls on entry) for a real victory, and proving the sandbox survives it:
 * the same driver/vehicle/quest state works for another delivery attempt
 * (a no-op, never a double payout) right afterward.
 */
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  PLAYER_ID,
  applyQuestAcceptEffects,
  attemptQuestDelivery,
  beginRoadTripWithEncounters,
  cityRunStateFromSaveGame,
  persistArenaSession,
  vehicleStateFromDesign,
  type CityRunState,
} from '@/app';
import { initialClock } from '@/sim/calendar';
import { createClone, createDriver } from '@/sim/driver';
import { FRESH_ROUTE_HISTORY } from '@/sim/encounters';
import { pursuitLevelFromQuestState, rollRestAssassinationAttempt } from '@/sim/pursuit';
import { resolveRoute } from '@/sim/road';
import type { DriverState, SkillName, VehicleDesign, VehicleState } from '@/sim/types';
import { questCargoId, questDefs } from '@/sim/victory';
import { skillsConfig, economy } from '@/data/rulesets';
import { createRng } from '@/util/rng';
import { STORE_GENERATIONS, STORE_POINTER, load, openSaveDatabase, type QuestState } from '@/persist/save';
import { applyInvestigateAction, questDef, questInvestigateRows } from '@/ui/journal';
import type { BuildingContext } from '@/ui/buildings/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function evenSkillSplit(): Record<SkillName, number> {
  const cfg = skillsConfig();
  const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
  const remainder = cfg.startingSkillPool - base * cfg.skills.length;
  const skills = {} as Record<SkillName, number>;
  cfg.skills.forEach((name, index) => {
    skills[name] = base + (index === cfg.skills.length - 1 ? remainder : 0);
  });
  return skills;
}

function makeDriver(overrides: Partial<DriverState> = {}): DriverState {
  const result = createDriver('CampaignTest', evenSkillSplit());
  if (!result.ok) throw new Error(`test fixture: expected a legal skill split, got "${result.reason}"`);
  return { ...result.driver, cash: 200_000, ...overrides };
}

const TEST_DESIGN: VehicleDesign = {
  name: 'Campaign Test Rig',
  bodyId: 'subcompact',
  chassisId: 'standard',
  suspensionId: 'light',
  plantId: 'small',
  tireId: 'standard',
  armor: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
  weapons: [],
};

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return { ...vehicleStateFromDesign(TEST_DESIGN, 'veh-campaign-1', PLAYER_ID), ...overrides };
}

function makeContext(overrides: Partial<BuildingContext> = {}): BuildingContext {
  return {
    driver: makeDriver(),
    clock: initialClock(),
    cityId: 'watertown',
    vehicle: makeVehicle(),
    vehicleStored: false,
    fleetSize: 1,
    existingCarNames: [],
    rng: createRng('campaign-test-seed').stream('building'),
    rumorsHeardToday: new Map(),
    activeCourierJobs: [],
    routeHistory: new Map(),
    quests: [],
    ...overrides,
  };
}

function makeCityRunState(overrides: Partial<CityRunState> = {}): CityRunState {
  return {
    driver: makeDriver(),
    vehicle: makeVehicle(),
    vehicleStored: false,
    clock: initialClock(),
    cityId: 'newyork',
    sessionSeed: 'campaign-test-seed',
    openDb: () => Promise.reject(new Error('test: no save database in a headless campaign run')),
    rng: createRng('campaign-test-seed').stream('driver'),
    search: '',
    rumorsHeardToday: new Map(),
    activeCourierJobs: [],
    fleet: { vehicles: [] },
    routeHistory: new Map(),
    quests: [],
    arenaRecord: { wins: 0, losses: 0 },
    ...overrides,
  };
}

/** `"facility:cityId"` -> `{ facility, cityId }` — quests.json's own clueChain shape (mirrors `@/ui/journal`'s private `parseClueHop`, duplicated here only for test setup, never for game logic). */
function parseHop(raw: string): { readonly facility: string; readonly cityId: string } {
  const sep = raw.indexOf(':');
  const facility = raw.slice(0, sep);
  const cityId = raw.slice(sep + 1);
  return { facility, cityId };
}

/** Mirrors `@/sim/victory`'s (module-private) `hasWonVictory` — kept in the test fixture rather than exported, since nothing in the shipped game reads it either (see victory.ts's own doc comment on why it stays private). */
function wonVictory(quests: readonly QuestState[]): boolean {
  return quests.some((quest) => quest.completed && quest.flags.victory === true);
}

const BOSS_TAPE = questDef('the-boss-tape');
if (BOSS_TAPE === undefined) throw new Error('test fixture: quests.json no longer defines "the-boss-tape"');

// ---------------------------------------------------------------------------
// 1. Prestige gates — every quests.json mission, not just the-boss-tape.
// ---------------------------------------------------------------------------

describe('campaign: prestige gates unlock each mission\'s first clue, generically', () => {
  for (const def of questDefs()) {
    it(`"${def.id}" (gate ${def.gate}) is not offered one point below its gate, and IS offered at it`, () => {
      const firstHop = parseHop(def.clueChain[0]!);

      const belowGate = makeContext({ driver: makeDriver({ prestige: def.gate - 1 }), cityId: firstHop.cityId });
      const belowRows = questInvestigateRows(belowGate, firstHop.facility, 'building.stub.quest.investigate');
      expect(belowRows.some((row) => row.id === `investigate-${def.id}`)).toBe(false);

      const atGate = makeContext({ driver: makeDriver({ prestige: def.gate }), cityId: firstHop.cityId });
      const atRows = questInvestigateRows(atGate, firstHop.facility, 'building.stub.quest.investigate');
      expect(atRows.some((row) => row.id === `investigate-${def.id}`)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. The full the-boss-tape lifecycle.
// ---------------------------------------------------------------------------

describe('campaign: the-boss-tape end to end (clue chain -> marked/clone/pursuit -> victory -> still playable)', () => {
  it('hearing both clues, then accepting, applies onAccept.setFlag/destroyClone/pursuitLevel from real ruleset data — never on a partial reveal', () => {
    const markedDriver = createClone(makeDriver({ prestige: 95, cityId: 'watertown' }), 'newyork');
    expect(markedDriver.cloneCityId).toBe('newyork'); // sanity: a clone really is on file before acceptance

    const hop0 = parseHop(BOSS_TAPE.clueChain[0]!); // "truckstop:watertown"
    const hop1 = parseHop(BOSS_TAPE.clueChain[1]!); // "story:watertown"

    // --- First clue: overhearing it must NOT mark the driver or touch the clone/cargo. ---
    const ctxAtHop0 = makeContext({ driver: markedDriver, cityId: hop0.cityId, quests: [] });
    const rowsAtHop0 = questInvestigateRows(ctxAtHop0, hop0.facility, 'building.truckstop.quest.investigate');
    expect(rowsAtHop0.some((row) => row.id === `investigate-${BOSS_TAPE.id}`)).toBe(true);

    const afterHop0 = applyInvestigateAction(ctxAtHop0, `investigate-${BOSS_TAPE.id}`);
    const afterHop0WithEffects = applyQuestAcceptEffects([], afterHop0);

    expect(afterHop0WithEffects.quests).toEqual([{ id: BOSS_TAPE.id, stage: 1, completed: false, flags: {} }]);
    expect(afterHop0WithEffects.driver.cloneCityId).toBe('newyork'); // clone untouched
    expect(afterHop0WithEffects.vehicle?.cargo ?? []).toEqual([]); // no cargo yet

    // --- Second (last) clue: THIS is the reachable "accept" moment. ---
    const ctxAtHop1: BuildingContext = { ...afterHop0WithEffects, cityId: hop1.cityId };
    const rowsAtHop1 = questInvestigateRows(ctxAtHop1, hop1.facility, 'building.stub.quest.investigate');
    expect(rowsAtHop1.some((row) => row.id === `investigate-${BOSS_TAPE.id}`)).toBe(true);

    const afterHop1 = applyInvestigateAction(ctxAtHop1, `investigate-${BOSS_TAPE.id}`);
    // Mutation-proof the crossing: previousQuests MUST be the pre-hop1 state
    // (stage 1), or the "only fire on the exact crossing" guard can't tell
    // this apart from a re-visit of an already-accepted quest.
    const accepted = applyQuestAcceptEffects(afterHop0WithEffects.quests ?? [], afterHop1);

    expect(accepted.quests).toEqual([{ id: BOSS_TAPE.id, stage: 2, completed: false, flags: { marked: true } }]);

    // onAccept.destroyClone: true — the clone is gone, "no second attempt".
    expect(accepted.driver.cloneCityId).toBeNull();
    expect(accepted.driver.cloneSkills).toBeNull();

    // The quest's own cargo is now aboard, under the fixed questCargoId convention.
    const cargoId = questCargoId(BOSS_TAPE.id);
    const cargoItem = accepted.vehicle?.cargo.find((item) => item.id === cargoId);
    expect(cargoItem).toEqual({
      id: cargoId,
      kind: 'payload',
      weightLb: BOSS_TAPE.cargo.weightLb,
      spaces: BOSS_TAPE.cargo.spaces,
      integrity: economy()._reconstruction.cargoFullIntegrity,
    });

    // Re-running acceptance on an ALREADY-accepted quest (a second visit
    // after marking) must never re-fire — no double clone-destroy call, no
    // duplicate cargo line. Mutation guard: this is what `wasComplete` in
    // `applyQuestAcceptEffects` actually protects.
    const reVisited = applyQuestAcceptEffects(accepted.quests ?? [], accepted);
    expect(reVisited).toBe(accepted); // referentially unchanged: nothing fired
    expect(reVisited.vehicle?.cargo.filter((item) => item.id === cargoId).length).toBe(1);
  });

  it('pursuit begins the moment the driver is marked: pursuer contacts on the road, and a reachable rest-time assassination attempt — neither exists while unmarked', () => {
    const unmarkedQuests: readonly QuestState[] = [];
    const markedQuests: readonly QuestState[] = [{ id: BOSS_TAPE.id, stage: 2, completed: false, flags: { marked: true } }];

    expect(pursuitLevelFromQuestState(unmarkedQuests)).toBe(0);
    // Pinned to the exact real onAccept.pursuitLevel — a separate
    // ">0" check here would be dominated by this equality (quests.json's
    // own pursuitLevel is a positive number; anything that broke it would
    // already fail the line above first).
    expect(pursuitLevelFromQuestState(markedQuests)).toBe(BOSS_TAPE.onAccept?.pursuitLevel ?? -1);

    // --- Road: beginRoadTripWithEncounters (the exact function
    // openGatePrompt's road-departure branch calls) must add pursuer
    // contacts once marked, and add NONE while unmarked. ---
    const resolved = resolveRoute('newyork', 'philadelphia');
    const vehicle = makeVehicle();
    const clock = initialClock();

    const unmarkedTrip = beginRoadTripWithEncounters(resolved, vehicle, clock, 'campaign-road-seed', FRESH_ROUTE_HISTORY, pursuitLevelFromQuestState(unmarkedQuests));
    const markedTrip = beginRoadTripWithEncounters(resolved, vehicle, clock, 'campaign-road-seed', FRESH_ROUTE_HISTORY, pursuitLevelFromQuestState(markedQuests));

    expect(unmarkedTrip.contacts.some((c) => c.faction === 'pursuer')).toBe(false);
    const markedPursuerCount = markedTrip.contacts.filter((c) => c.faction === 'pursuer').length;
    expect(markedPursuerCount).toBeGreaterThan(0);
    expect(markedPursuerCount).toBe(Math.floor(pursuitLevelFromQuestState(markedQuests)));
    // Marked never REMOVES or reorders the base table's own contacts.
    const baseContactIds = unmarkedTrip.contacts.map((c) => c.id);
    expect(markedTrip.contacts.map((c) => c.id).slice(0, baseContactIds.length)).toEqual(baseContactIds);

    // --- Rest: an unmarked driver never rolls an attempt at all. ---
    for (let day = 0; day < 10; day++) {
      expect(rollRestAssassinationAttempt('campaign-rest-seed', day, 'watertown', pursuitLevelFromQuestState(unmarkedQuests)).triggered).toBe(false);
    }

    // A marked driver's rest CAN trigger one (searched, same convention
    // tests/unit/pursuit.test.ts itself uses: deterministic per (seed, day,
    // city), so a wide-enough day search is guaranteed to find one rather
    // than flaking on a single hand-picked day).
    let triggeredDay: number | null = null;
    for (let day = 0; day < 60 && triggeredDay === null; day++) {
      if (rollRestAssassinationAttempt('campaign-rest-seed', day, 'watertown', pursuitLevelFromQuestState(markedQuests)).triggered) triggeredDay = day;
    }
    if (triggeredDay === null) throw new Error('test fixture: no rest-assassination attempt triggered in 60 days at pursuitLevel 4 — widen the search');
    const attempt = rollRestAssassinationAttempt('campaign-rest-seed', triggeredDay, 'watertown', pursuitLevelFromQuestState(markedQuests));
    expect(attempt.triggered).toBe(true);
    // A non-empty pack is already implied by `triggered` (`@/sim/pursuit`'s
    // roller only ever sets it once a round rolls in, and every dangerLevel
    // tier's real packSizeMin is >= 1 — it never returns triggered with an
    // empty pack), so a separate length check here would only ever fail
    // together with the line above, never independently of it.
    expect(attempt.contacts.every((c) => c.faction === 'pursuer')).toBe(true);
  });

  it('delivering the payload wins the game AND the same driver/vehicle/quest state is still playable afterward — no double payout on a second attempt', () => {
    const acceptedQuests: readonly QuestState[] = [{ id: BOSS_TAPE.id, stage: 2, completed: false, flags: { marked: true } }];
    const cargoId = questCargoId(BOSS_TAPE.id);
    const vehicleWithCargo = makeVehicle({
      cargo: [{ id: cargoId, kind: 'payload', weightLb: BOSS_TAPE.cargo.weightLb, spaces: BOSS_TAPE.cargo.spaces, integrity: economy()._reconstruction.cargoFullIntegrity }],
    });
    const driverBefore = makeDriver({ prestige: 95, cash: 1_000, cityId: BOSS_TAPE.destination.cityId });

    const preDeliveryState = makeCityRunState({
      driver: driverBefore,
      vehicle: vehicleWithCargo,
      cityId: BOSS_TAPE.destination.cityId, // "newyork"
      quests: acceptedQuests,
    });

    expect(wonVictory(preDeliveryState.quests)).toBe(false);

    // Accepted, at the right city/facility, but the cargo isn't aboard
    // (lost, sold, whatever) — `attemptQuestDelivery` must decline
    // cleanly (no result, no state mutation, no false victory) rather than
    // reporting a delivery that never actually happened.
    const withoutCargo = attemptQuestDelivery({ ...preDeliveryState, vehicle: makeVehicle({ cargo: [] }) }, BOSS_TAPE.destination.facility);
    expect(withoutCargo.result).toBeNull();
    expect(withoutCargo.def).toBeNull();
    expect(wonVictory(withoutCargo.state.quests)).toBe(false);

    // The exact function `openFacility` calls on every facility entry.
    const delivery = attemptQuestDelivery(preDeliveryState, BOSS_TAPE.destination.facility); // "federal"

    expect(delivery.result).not.toBeNull();
    expect(delivery.result?.outcome).toBe('DELIVERED');
    expect(delivery.result?.victory).toBe(true);
    expect(delivery.result?.sandboxContinues).toBe(true);
    expect(delivery.result?.paidAmount).toBe(BOSS_TAPE.pay);
    expect(delivery.state.driver.cash).toBe(driverBefore.cash + BOSS_TAPE.pay);
    // The delivery keeps the driver in the same car they arrived in, so a null
    // here would itself be the regression, not a shape to shrug past.
    expect(delivery.state.vehicle).not.toBeNull();
    expect(delivery.state.vehicle?.cargo.some((item) => item.id === cargoId)).toBe(false); // cargo consumed
    expect(wonVictory(delivery.state.quests)).toBe(true);
    expect(delivery.def?.id).toBe(BOSS_TAPE.id);

    // --- Sandbox survives: `attemptQuestDelivery` only ever replaces
    // driver/vehicle/quests on the state it returns (`@/sim/victory`'s own
    // module doc: "the fleet, every other vehicle, the save, the clock -
    // none of it is read or mutated, so a caller that just keeps playing
    // after victory has nothing to restore"). Proven by REFERENCE identity
    // on every other `CityRunState` field against the pre-delivery state,
    // not a value that would happen to still look right on its own — a
    // caller that forgot to spread `...state` (or rebuilt a fresh
    // clock/fleet) would fail every line below. ---
    expect(delivery.state.clock).toBe(preDeliveryState.clock);
    expect(delivery.state.cityId).toBe(preDeliveryState.cityId);
    expect(delivery.state.sessionSeed).toBe(preDeliveryState.sessionSeed);
    expect(delivery.state.fleet).toBe(preDeliveryState.fleet);
    expect(delivery.state.arenaRecord).toBe(preDeliveryState.arenaRecord);

    // Attempting delivery again (walking back into the same facility) must
    // never pay out twice — `deliverQuest`'s own one-way `completed` door,
    // reached here through the real integrator call, not a hand-built
    // QuestState fixture.
    const secondAttempt = attemptQuestDelivery(delivery.state, BOSS_TAPE.destination.facility);
    expect(secondAttempt.result).toBeNull(); // ALREADY_DELIVERED is filtered out — nothing to (re)apply
    expect(secondAttempt.state).toBe(delivery.state); // referentially unchanged
    expect(secondAttempt.state.driver.cash).toBe(delivery.state.driver.cash); // no second payout
  });
});

// ---------------------------------------------------------------------------
// 3. Quests actually survive a real save/resume round trip.
//
// `@/app`'s `persistArenaSession` is the app's ONLY save writer, and
// `resumeSession` is the ONLY reader that turns a load back into something
// playable — both live inside `boot()`'s module-private closures, so this
// drives their real, exported DOM-free seams directly (`persistArenaSession`
// itself, and `cityRunStateFromSaveGame`, the function `resumeSession` calls
// to rebuild a `CityRunState` from a save whose `world` is `null`) against a
// REAL `@/persist/save` `save()`/`load()` round trip (fake-indexeddb, same
// convention `tests/unit/save.test.ts`/`victory.test.ts` use) — never a
// hand-rolled `SaveGame` literal, which would prove nothing about whether
// the app's own writer/reader actually thread quests through.
// ---------------------------------------------------------------------------

describe('campaign quests survive a real save/resume round trip (persistArenaSession -> save -> load -> cityRunStateFromSaveGame)', () => {
  let db: IDBDatabase;
  const openDb = () => openSaveDatabase(indexedDB);

  beforeEach(async () => {
    db = await openDb();
    const genTx = db.transaction(STORE_GENERATIONS, 'readwrite');
    genTx.objectStore(STORE_GENERATIONS).clear();
    const pointerTx = db.transaction(STORE_POINTER, 'readwrite');
    pointerTx.objectStore(STORE_POINTER).clear();
    await new Promise<void>((resolve) => {
      genTx.oncomplete = () => resolve();
    });
    await new Promise<void>((resolve) => {
      pointerTx.oncomplete = () => resolve();
    });
  });

  /** A real accepted quest, reached the one way this codebase can reach it — hearing both `the-boss-tape` clue hops through `@/ui/journal`, exactly like the lifecycle suite above. Never a hand-built `QuestState` literal. */
  const acceptBossTapeThroughRealFlow = (): { readonly driver: DriverState; readonly vehicle: VehicleState; readonly quests: readonly QuestState[] } => {
    const markedDriver = createClone(makeDriver({ prestige: 95, cityId: 'watertown' }), 'newyork');
    const hop0 = parseHop(BOSS_TAPE.clueChain[0]!);
    const hop1 = parseHop(BOSS_TAPE.clueChain[1]!);

    const ctxAtHop0 = makeContext({ driver: markedDriver, cityId: hop0.cityId, quests: [] });
    const afterHop0 = applyQuestAcceptEffects([], applyInvestigateAction(ctxAtHop0, `investigate-${BOSS_TAPE.id}`));

    const ctxAtHop1: BuildingContext = { ...afterHop0, cityId: hop1.cityId };
    const accepted = applyQuestAcceptEffects(afterHop0.quests ?? [], applyInvestigateAction(ctxAtHop1, `investigate-${BOSS_TAPE.id}`));

    if (accepted.vehicle === null || accepted.vehicle === undefined) throw new Error('test fixture: expected a vehicle after accepting the-boss-tape');
    return { driver: accepted.driver, vehicle: accepted.vehicle, quests: accepted.quests ?? [] };
  };

  it('persistArenaSession writes the real CityRunState.quests into SaveGame.quests, not an empty array', async () => {
    const { driver, vehicle, quests } = acceptBossTapeThroughRealFlow();
    expect(quests.length).toBeGreaterThan(0); // sanity: a real accepted quest exists before we ever touch save/load

    await persistArenaSession({
      openDb,
      driver,
      vehicle,
      clock: initialClock(),
      location: 'newyork',
      quests,
      sessionSeed: 'campaign-save-round-trip-seed',
      world: null, // safely back in the city — exactly `showArenaEvent`'s exit
    });

    const loaded = await load(db, { mode: 'safe' });

    expect(loaded.game.quests).toEqual(quests);
    expect(loaded.game.quests.length).toBeGreaterThan(0);
    expect(loaded.game.world).toBeNull();
  });

  it("resumeSession's real reconstruction (cityRunStateFromSaveGame) restores the loaded quests into a resumable CityRunState — never a fresh, quest-less session", async () => {
    const { driver, vehicle, quests } = acceptBossTapeThroughRealFlow();

    await persistArenaSession({
      openDb,
      driver,
      vehicle,
      clock: initialClock(),
      location: 'newyork',
      quests,
      sessionSeed: 'campaign-resume-round-trip-seed',
      world: null,
    });

    const loaded = await load(db, { mode: 'safe' });
    const resumedVehicleId = loaded.game.activeVehicleId ?? Object.keys(loaded.game.vehicles)[0];
    if (resumedVehicleId === undefined) throw new Error('test fixture: expected a resumable active vehicle id');
    const resumedVehicle = loaded.game.vehicles[resumedVehicleId];
    if (resumedVehicle === undefined) throw new Error('test fixture: expected the active vehicle id to resolve to a real vehicle');

    const resumedCityState: CityRunState = cityRunStateFromSaveGame(loaded.game, resumedVehicle, { openDb, search: '' });

    expect(resumedCityState.quests).toEqual(quests);
    expect(resumedCityState.quests.length).toBeGreaterThan(0);
    expect(resumedCityState.driver.cloneCityId).toBeNull(); // the real onAccept.destroyClone effect survived the round trip too
    expect(resumedCityState.cityId).toBe('newyork');
    expect(resumedCityState.arenaRecord).toEqual({ wins: 0, losses: 0 }); // intentionally session-only, never save data — see @/sim/victory's ArenaRecord doc
  });
});
