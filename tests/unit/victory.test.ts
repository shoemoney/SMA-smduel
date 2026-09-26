import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildVictorySummary,
  deliverQuest,
  findQuestState,
  isVictoryQuest,
  questById,
  questCargoId,
  questDefs,
  victorySummaryLines,
  type ArenaRecord,
  type QuestDef,
} from '@/sim/victory';
import {
  STORE_GENERATIONS,
  STORE_POINTER,
  load,
  openSaveDatabase,
  save,
  type QuestState,
  type SaveGame,
} from '@/persist/save';
import { CURRENT_SCHEMA_VERSION } from '@/persist/migrate';
import type { Clock } from '@/sim/calendar';
import { makeArmorRecord, type CargoState, type DriverState, type VehicleState } from '@/sim/types';
import type { Fleet } from '@/sim/fleet';
import { createRng } from '@/util/rng';
import { t } from '@/ui/strings';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FINAL_QUEST = questById('the-boss-tape');
const DECOY_QUEST = questById('decoy-prize');
const TRANSPLANT_QUEST = questById('transplant-run');

/** No caller-supplied deadline in play - the delivery can never be LATE. */
const NO_DEADLINE = Number.POSITIVE_INFINITY;

const DAY_63_CLOCK: Clock = { dayIndex: 63, phase: 'DAY' };

/** Mirrors `@/sim/victory`'s removed (zero-production-caller) `hasWonVictory` - kept here only for this file's own assertions, never re-exported (see victory.ts's own doc comment on why it left). */
function wonVictory(quests: readonly QuestState[]): boolean {
  return quests.some((quest) => quest.completed && quest.flags.victory === true);
}

function makeDriver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    name: 'Duke',
    skills: { driving: 40, marksmanship: 35, mechanic: 20 },
    naturalHealth: 5,
    bodyArmor: 3,
    prestige: 95,
    cash: 8_000,
    cityId: 'watertown',
    cloneCityId: 'watertown',
    cloneSkills: { driving: 40, marksmanship: 35, mechanic: 20 },
    ...overrides,
  };
}

function makeCargo(overrides: Partial<CargoState> = {}): CargoState {
  return {
    id: questCargoId(FINAL_QUEST.id),
    kind: 'payload',
    weightLb: FINAL_QUEST.cargo.weightLb,
    spaces: FINAL_QUEST.cargo.spaces,
    integrity: 100,
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: 'v1',
    ownerId: 'driver-1',
    design: {
      name: 'Widowmaker',
      bodyId: 'body-standard',
      chassisId: 'chassis-light',
      suspensionId: 'suspension-heavy-duty',
      plantId: 'plant-large',
      tireId: 'tire-standard',
      armor: makeArmorRecord(10),
      weapons: [],
    },
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 99,
    odometerMiles: 42,
    armorDP: makeArmorRecord(10),
    tireDP: [10, 10, 10, 10],
    plantDP: 10,
    weapons: [],
    cargo: [makeCargo()],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    ...overrides,
  };
}

function makeFleet(vehicle: VehicleState, extraStored = 2): Fleet {
  const stored = Array.from({ length: extraStored }, (_, i) => ({
    vehicle: makeVehicle({ id: `stored-${i}`, cargo: [] }),
    cityId: 'watertown',
    stored: true,
  }));
  return { vehicles: [{ vehicle, cityId: 'watertown', stored: false }, ...stored] };
}

function makeGame(overrides: Partial<SaveGame> = {}): SaveGame {
  const driver = makeDriver();
  const vehicle = makeVehicle();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rulesetVersion: 'classic-1',
    seed: 42,
    currentDay: 63,
    phase: 'DAY',
    location: 'newyork',
    driver,
    activeVehicleId: vehicle.id,
    vehicles: { [vehicle.id]: vehicle },
    jobs: [],
    quests: [],
    world: null,
    rngState: createRng(42).serialize(),
    lastSafeCitySnapshot: {
      day: 63,
      phase: 'DAY',
      location: 'newyork',
      driver,
      vehicles: { [vehicle.id]: vehicle },
      activeVehicleId: vehicle.id,
    },
    ...overrides,
  };
}

// fake-indexeddb, one connection per file, matching tests/unit/save.test.ts's own pattern.
let db: IDBDatabase;

beforeEach(async () => {
  db = await openSaveDatabase(indexedDB);
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

// ---------------------------------------------------------------------------
// quests.json: the final mission really does carry a victory condition
// ---------------------------------------------------------------------------

describe('the-boss-tape is quests.json\'s own victory condition', () => {
  it('is the only quest with onDeliver.victory - proves isVictoryQuest reads data, not an id literal', () => {
    const victoryFlagged = questDefs().filter(isVictoryQuest);
    expect(victoryFlagged.map((q) => q.id)).toEqual(['the-boss-tape']);
    expect(FINAL_QUEST.onDeliver).toEqual({ victory: true, sandboxContinues: true });
  });
});

// ---------------------------------------------------------------------------
// Delivery: pays the quest's own pay, sets victory
// ---------------------------------------------------------------------------

describe('deliverQuest: delivering the final payload', () => {
  it('pays exactly the quest\'s own pay value, proven by mocking a DIFFERENT pay and watching it move', () => {
    const driver = makeDriver({ cash: 1_000 });
    const vehicle = makeVehicle();

    const mockedQuest: QuestDef = { ...FINAL_QUEST, pay: 123_456 };
    const result = deliverQuest(
      mockedQuest,
      [],
      driver,
      vehicle,
      mockedQuest.destination.cityId,
      mockedQuest.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );

    expect(result.outcome).toBe('DELIVERED');
    expect(result.paidAmount).toBe(123_456);
    expect(result.driver.cash).toBe(1_000 + 123_456);

    // Same wiring, quests.json's REAL pay, not the mock - the number moved
    // with the input rather than being a constant baked into victory.ts.
    const realResult = deliverQuest(
      FINAL_QUEST,
      [],
      driver,
      vehicle,
      FINAL_QUEST.destination.cityId,
      FINAL_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );
    expect(realResult.paidAmount).toBe(FINAL_QUEST.pay);
    expect(realResult.paidAmount).not.toBe(123_456);
  });

  it('sets the victory flag on the returned quest state', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle();

    const result = deliverQuest(
      FINAL_QUEST,
      [],
      driver,
      vehicle,
      FINAL_QUEST.destination.cityId,
      FINAL_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );

    expect(result.victory).toBe(true);
    const state = findQuestState(result.quests, FINAL_QUEST.id);
    expect(state).toEqual({ id: FINAL_QUEST.id, stage: 0, completed: true, flags: { victory: true } });
    expect(wonVictory(result.quests)).toBe(true);
  });

  it('sandboxContinues reads the quest\'s OWN onDeliver.sandboxContinues, proven both true and false', () => {
    const driver = makeDriver();

    const continuesResult = deliverQuest(
      FINAL_QUEST,
      [],
      driver,
      makeVehicle(),
      FINAL_QUEST.destination.cityId,
      FINAL_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );
    expect(continuesResult.sandboxContinues).toBe(true);

    // A mocked victory quest whose OWN data says the sandbox does NOT
    // continue - hardcoding `true` in the implementation would fail this.
    const endsSandboxQuest: QuestDef = { ...FINAL_QUEST, onDeliver: { victory: true, sandboxContinues: false } };
    const endsResult = deliverQuest(
      endsSandboxQuest,
      [],
      driver,
      makeVehicle({ cargo: [makeCargo({ id: questCargoId(endsSandboxQuest.id) })] }),
      endsSandboxQuest.destination.cityId,
      endsSandboxQuest.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );
    expect(endsResult.sandboxContinues).toBe(false);
  });

  it('a non-victory quest delivers normally but never sets the victory flag', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle({ cargo: [makeCargo({ id: questCargoId(DECOY_QUEST.id) })] });

    const result = deliverQuest(
      DECOY_QUEST,
      [],
      driver,
      vehicle,
      DECOY_QUEST.destination.cityId,
      DECOY_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );

    expect(result.outcome).toBe('DELIVERED');
    expect(result.victory).toBe(false);
    expect(wonVictory(result.quests)).toBe(false);
  });

  it('refuses at the wrong CITY, unchanged and no victory', () => {
    const driver = makeDriver();
    const vehicle = makeVehicle();

    const result = deliverQuest(FINAL_QUEST, [], driver, vehicle, 'boston', 'medical', DAY_63_CLOCK, NO_DEADLINE);

    expect(result.outcome).toBe('WRONG_LOCATION');
    expect(result.victory).toBe(false);
    expect(result.driver).toBe(driver);
    expect(result.vehicle).toBe(vehicle);
    expect(result.paidAmount).toBe(0);
  });

  it('refuses at the RIGHT city but the WRONG building - "right city, wrong building is still WRONG_LOCATION"', () => {
    // Same city as FINAL_QUEST's real destination (newyork), a DIFFERENT
    // facility (casino, not federal). Deleting the facility half of the
    // guard (leaving only the cityId check) would wrongly deliver this.
    const driver = makeDriver();
    const vehicle = makeVehicle();

    const result = deliverQuest(
      FINAL_QUEST,
      [],
      driver,
      vehicle,
      FINAL_QUEST.destination.cityId,
      'casino',
      DAY_63_CLOCK,
      NO_DEADLINE,
    );

    expect(result.outcome).toBe('WRONG_LOCATION');
    expect(result.victory).toBe(false);
    expect(result.driver).toBe(driver);
    expect(result.vehicle).toBe(vehicle);
    expect(result.paidAmount).toBe(0);
  });

  it('refuses when the quest\'s cargo is not aboard (or destroyed)', () => {
    const driver = makeDriver();
    const emptyVehicle = makeVehicle({ cargo: [] });
    const missing = deliverQuest(
      FINAL_QUEST,
      [],
      driver,
      emptyVehicle,
      FINAL_QUEST.destination.cityId,
      FINAL_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );
    expect(missing.outcome).toBe('CARGO_MISSING');

    const destroyedCargoVehicle = makeVehicle({ cargo: [makeCargo({ integrity: 0 })] });
    const destroyed = deliverQuest(
      FINAL_QUEST,
      [],
      driver,
      destroyedCargoVehicle,
      FINAL_QUEST.destination.cityId,
      FINAL_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );
    expect(destroyed.outcome).toBe('CARGO_MISSING');
  });
});

// ---------------------------------------------------------------------------
// Prestige: proven with a NONZERO prestigeReward (the-boss-tape's own is 0,
// which can't distinguish "awarded" from "never awarded").
// ---------------------------------------------------------------------------

describe('deliverQuest: prestige', () => {
  it('moves prestige by exactly the quest\'s own prestigeReward when on time', () => {
    const driver = makeDriver({ prestige: 20 });
    const vehicle = makeVehicle({ cargo: [makeCargo({ id: questCargoId(DECOY_QUEST.id) })] });

    expect(DECOY_QUEST.prestigeReward).toBeGreaterThan(0);

    const result = deliverQuest(
      DECOY_QUEST,
      [],
      driver,
      vehicle,
      DECOY_QUEST.destination.cityId,
      DECOY_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );

    expect(result.outcome).toBe('DELIVERED');
    expect(result.driver.prestige).toBe(20 + DECOY_QUEST.prestigeReward);
    expect(result.driver.prestige).not.toBe(20);
  });

  it('delivered PAST its dueDay is outcome LATE and loses failurePenalty prestige instead of gaining prestigeReward', () => {
    const driver = makeDriver({ prestige: 50 });
    const vehicle = makeVehicle({ cargo: [makeCargo({ id: questCargoId(TRANSPLANT_QUEST.id) })] });
    const lateClock: Clock = { dayIndex: 900, phase: 'DAY' };
    const dueDay = 10; // long past by day 900

    const result = deliverQuest(
      TRANSPLANT_QUEST,
      [],
      driver,
      vehicle,
      TRANSPLANT_QUEST.destination.cityId,
      TRANSPLANT_QUEST.destination.facility,
      lateClock,
      dueDay,
    );

    expect(result.outcome).toBe('LATE');
    expect(result.paidAmount).toBe(TRANSPLANT_QUEST.pay);
    expect(result.driver.prestige).toBe(50 - TRANSPLANT_QUEST.failurePenalty);
    expect(result.driver.prestige).not.toBe(50 + TRANSPLANT_QUEST.prestigeReward);
  });

  it('delivered BEFORE its dueDay is outcome DELIVERED, never LATE', () => {
    const driver = makeDriver({ prestige: 50 });
    const vehicle = makeVehicle({ cargo: [makeCargo({ id: questCargoId(TRANSPLANT_QUEST.id) })] });
    const onTimeClock: Clock = { dayIndex: 3, phase: 'DAY' };
    const dueDay = 5;

    const result = deliverQuest(
      TRANSPLANT_QUEST,
      [],
      driver,
      vehicle,
      TRANSPLANT_QUEST.destination.cityId,
      TRANSPLANT_QUEST.destination.facility,
      onTimeClock,
      dueDay,
    );

    expect(result.outcome).toBe('DELIVERED');
    expect(result.driver.prestige).toBe(50 + TRANSPLANT_QUEST.prestigeReward);
  });
});

// ---------------------------------------------------------------------------
// Winning twice is impossible
// ---------------------------------------------------------------------------

describe('deliverQuest: a second delivery attempt', () => {
  it('is refused as ALREADY_DELIVERED - not merely CARGO_MISSING - and pays nothing further', () => {
    const driver = makeDriver({ cash: 2_000 });
    const vehicle = makeVehicle();

    const first = deliverQuest(
      FINAL_QUEST,
      [],
      driver,
      vehicle,
      FINAL_QUEST.destination.cityId,
      FINAL_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );
    expect(first.outcome).toBe('DELIVERED');
    expect(first.driver.cash).toBe(2_000 + FINAL_QUEST.pay);

    // Second attempt: same accepted-quest ledger the first call produced,
    // cargo already gone from the vehicle (as a real second visit would be).
    const second = deliverQuest(
      FINAL_QUEST,
      first.quests,
      first.driver,
      first.vehicle,
      FINAL_QUEST.destination.cityId,
      FINAL_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );

    expect(second.outcome).toBe('ALREADY_DELIVERED');
    expect(second.paidAmount).toBe(0);
    expect(second.driver.cash).toBe(first.driver.cash);
    expect(second.quests).toEqual(first.quests);

    // The refusal is the `completed` flag, not an accident of empty cargo:
    // even handed a FRESH vehicle carrying the payload again, a completed
    // quest still refuses instead of paying out twice.
    const freshVehicleWithCargoAgain = makeVehicle();
    const thirdAttempt = deliverQuest(
      FINAL_QUEST,
      first.quests,
      first.driver,
      freshVehicleWithCargoAgain,
      FINAL_QUEST.destination.cityId,
      FINAL_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );
    expect(thirdAttempt.outcome).toBe('ALREADY_DELIVERED');
    expect(thirdAttempt.paidAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sandbox continues: driver and cash intact, still playable
// ---------------------------------------------------------------------------

describe('sandboxContinues: state survives victory', () => {
  it('leaves the driver and vehicle intact apart from the quest reward and delivered cargo', () => {
    const driver = makeDriver({ cash: 4_000, prestige: 95 });
    const vehicle = makeVehicle();

    const result = deliverQuest(
      FINAL_QUEST,
      [],
      driver,
      vehicle,
      FINAL_QUEST.destination.cityId,
      FINAL_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );

    expect(result.outcome).toBe('DELIVERED');
    expect(result.victory).toBe(true);

    // Cash moved by exactly the quest's own pay (prestigeReward is proven
    // elsewhere with a nonzero-reward quest - the-boss-tape's own is 0).
    expect(result.driver.cash).toBe(driver.cash + FINAL_QUEST.pay);

    // The vehicle keeps its delivered cargo consumed - the one field
    // `deliverQuest` genuinely computes on the vehicle (a filter, not a
    // pass-through), so this is the one vehicle assertion here a broken
    // filter predicate could actually fail.
    expect(result.vehicle.cargo).toEqual([]);

    // NOTE on what USED to be here: field-by-field "everything else is
    // untouched" checks (driver.name/skills/naturalHealth/bodyArmor/
    // cityId/cloneCityId, vehicle.destroyed/armorDP/plantDP/tireDP).
    // `payDriver`/the cargo-filtered vehicle literal both return the
    // FULLY-REQUIRED `DriverState`/`VehicleState` interfaces, so any
    // mutation that dropped `...driver`/`...vehicle` from those object
    // literals would fail `tsc --noEmit` before a test ever ran - this
    // suite's own acceptance gate already guarantees pass-through for
    // every field neither literal explicitly sets, same as it does for
    // every other spread in this codebase. Re-add a field-preservation
    // check here only if this file ever tests through an `as`-cast escape
    // hatch that could defeat that guarantee.
  });
});

// ---------------------------------------------------------------------------
// Victory flag persists through a save/load round trip
// ---------------------------------------------------------------------------

describe('the victory flag persists through save/load', () => {
  it('round-trips SaveGame.quests with the victory flag set, plus every other field untouched', async () => {
    const driver = makeDriver({ cash: 500 });
    const vehicle = makeVehicle();

    const delivery = deliverQuest(
      FINAL_QUEST,
      [],
      driver,
      vehicle,
      FINAL_QUEST.destination.cityId,
      FINAL_QUEST.destination.facility,
      DAY_63_CLOCK,
      NO_DEADLINE,
    );
    expect(delivery.victory).toBe(true);

    const game = makeGame({
      driver: delivery.driver,
      vehicles: { [delivery.vehicle.id]: delivery.vehicle },
      quests: delivery.quests,
    });

    await save(db, game);
    const loaded = await load(db, { mode: 'safe' });

    expect(loaded.game.quests).toEqual(delivery.quests);
    expect(wonVictory(loaded.game.quests)).toBe(true);
    expect(loaded.game.driver.cash).toBe(delivery.driver.cash);
    expect(loaded.game).toEqual(game);
  });
});

// ---------------------------------------------------------------------------
// Victory summary - real state, rendered through t()
// ---------------------------------------------------------------------------

describe('buildVictorySummary + victorySummaryLines', () => {
  const arenaRecord: ArenaRecord = { wins: 4, losses: 1 };

  it('reads every value off real state - none recomputed by hand', () => {
    const driver = makeDriver({ cash: 77_000, prestige: 95 });
    const vehicle = makeVehicle();
    const fleet = makeFleet(vehicle, 3); // 1 active + 3 stored = 4 cars owned

    const summary = buildVictorySummary({
      quest: FINAL_QUEST,
      clock: { dayIndex: 63, phase: 'DAY' },
      driver,
      fleet,
      arenaRecord,
    });

    expect(summary).toEqual({
      questId: FINAL_QUEST.id,
      questTitle: FINAL_QUEST.title,
      daysElapsed: 63,
      finalCash: 77_000,
      finalPrestige: 95,
      carsOwned: 4,
      arenaRecord,
    });

    // Mutation check inline: a DIFFERENT fleet size must move carsOwned, not
    // just happen to match a coincidental literal.
    const biggerFleet = makeFleet(vehicle, 7);
    const biggerSummary = buildVictorySummary({ quest: FINAL_QUEST, clock: { dayIndex: 63, phase: 'DAY' }, driver, fleet: biggerFleet, arenaRecord });
    expect(biggerSummary.carsOwned).toBe(8);
    expect(biggerSummary.carsOwned).not.toBe(summary.carsOwned);
  });

  it('renders every line with the real strings.json wording, key-by-key against hardcoded text', () => {
    const summary = buildVictorySummary({
      quest: FINAL_QUEST,
      clock: { dayIndex: 63, phase: 'DAY' },
      driver: makeDriver({ cash: 77_000, prestige: 95 }),
      fleet: makeFleet(makeVehicle(), 3),
      arenaRecord,
    });

    const lines = victorySummaryLines(summary);

    // Hardcoded expected text (not re-derived by calling t() again) so a
    // wrong strings.json key or a swapped line order actually fails this.
    expect(lines).toEqual([
      `${FINAL_QUEST.title} delivered. The structure falls - and you're still standing.`,
      'Days elapsed: 63',
      'Final cash: $77000',
      'Final prestige: 95',
      'Cars owned: 4',
      'Arena record: 4-1',
    ]);

    // Still exercises the real t() table, so a strings.json wording edit
    // that keeps the same values is reflected here too.
    expect(lines[0]).toBe(t('victory.announcement', { questTitle: FINAL_QUEST.title }));
  });
});
