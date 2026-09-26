/**
 * src/ui/journal.ts unit tests, plus the "mission entries in the buildings
 * that offer them" half of the same feature (`@/ui/buildings/bar` and
 * `@/ui/buildings/truckstop`'s "Investigate" action) — both surfaces read
 * the same `@/ui/journal` clue-chain helpers, so a bug in either shows up
 * from either angle.
 *
 * Follows this suite's own established pattern (`tests/unit/buildings.test.ts`,
 * `tests/unit/menu.test.ts`): pure-core assertions directly on
 * `journalActions`/`journalEngine`, then a real keyboard-driven walk via
 * `@/ui/buildings/shared`'s `stepBuilding`/`menuFor` — the same generic
 * `BuildingEngine<S>` plumbing every facility panel already uses, reused
 * here rather than re-implemented.
 */
import { describe, expect, it } from 'vitest';
import { initialClock } from '@/sim/calendar';
import { createRng } from '@/util/rng';
import type { AcceptedJob, CourierOffer } from '@/sim/courier';
import type { DriverState, VehicleState } from '@/sim/types';
import type { QuestState } from '@/persist/save';
import { cityName, facilityName, t } from '@/ui/strings';
import { menuFor, stepBuilding, type BuildingContext } from '@/ui/buildings/shared';
import {
  createJournalState,
  driverIsMarked,
  journalActions,
  journalEngine,
  journalHeader,
  JOURNAL_LEAVE_ACTION_ID,
  JOURNAL_MARKED_BANNER_ID,
  nextHopMatches,
  questDef,
  questDefs,
  revealNextHop,
  type JournalContext,
  type QuestDef,
} from '@/ui/journal';
import { barActions, barEngine, createBarState, BAR_KIND } from '@/ui/buildings/bar';
import { truckstopActions, truckstopEngine, createTruckstopState, TRUCKSTOP_KIND } from '@/ui/buildings/truckstop';
import { medicalActions, medicalEngine, createMedicalState } from '@/ui/buildings/medical';
import { garageActions, garageEngine, createGarageState } from '@/ui/buildings/garage';
import { courierGuildActions, courierGuildEngine, createCourierGuildState } from '@/ui/buildings/courierguild';
import { stubActions, stubEngine, createStubState } from '@/ui/buildings/stub';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDriver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    name: 'Duelist',
    skills: { driving: 20, marksmanship: 20, mechanic: 10 },
    naturalHealth: 3,
    bodyArmor: 0,
    prestige: 0,
    cash: 2000,
    cityId: 'newyork',
    cloneCityId: null,
    cloneSkills: null,
    ...overrides,
  };
}

function makeCourierOffer(overrides: Partial<CourierOffer> = {}): CourierOffer {
  return {
    id: 'test-offer-0',
    originCityId: 'newyork',
    destinationCityId: 'boston',
    destinationFacility: 'medical',
    routeId: 'test-route',
    distanceMiles: 100,
    dangerLevel: 0,
    weightLb: 100,
    spaces: 1,
    dueDay: 14,
    declaredValue: 1000,
    pay: 400,
    cargoName: 'Cold Cargo',
    ...overrides,
  };
}

function makeAcceptedJob(overrides: Partial<AcceptedJob> = {}): AcceptedJob {
  return { offer: makeCourierOffer(), cargoId: 'cargo-test-offer-0', status: 'ACTIVE', acceptedDay: 4, ...overrides };
}

function makeJournalContext(overrides: Partial<JournalContext> = {}): JournalContext {
  return {
    driver: makeDriver(),
    clock: initialClock(),
    cityId: 'newyork',
    activeCourierJobs: [],
    quests: [],
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: 'veh-1',
    ownerId: 'driver-1',
    design: {
      name: 'Roadhog',
      bodyId: 'van',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'small',
      tireId: 'standard',
      armor: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
      weapons: [],
    },
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 10,
    odometerMiles: 0,
    armorDP: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
    tireDP: [0, 0, 0, 0],
    plantDP: 0,
    weapons: [],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    ...overrides,
  };
}

function makeBuildingContext(overrides: Partial<BuildingContext> = {}): BuildingContext {
  return {
    driver: makeDriver(),
    clock: initialClock(),
    cityId: 'newyork',
    vehicle: makeVehicle(),
    vehicleStored: false,
    fleetSize: 1,
    existingCarNames: [],
    rng: createRng('journal-test-seed'),
    rumorsHeardToday: new Map(),
    activeCourierJobs: [],
    routeHistory: new Map(),
    quests: [],
    ...overrides,
  };
}

/** Real quests.json data: `decoy-prize`'s clue chain is bar:newyork -> bar:albany -> courierguild:albany -> arena:manchester. */
const DECOY_PRIZE = questDef('decoy-prize');
if (DECOY_PRIZE === undefined) throw new Error('quests.json must define "decoy-prize" for this suite to mean anything');

// ---------------------------------------------------------------------------
// quests.json data helpers
// ---------------------------------------------------------------------------

/** Real quests.json data: `the-boss-tape` is the only mission with an `onAccept.setFlag` — its two-hop chain is truckstop:watertown -> story:watertown. */
const BOSS_TAPE = questDef('the-boss-tape');
if (BOSS_TAPE === undefined) throw new Error('quests.json must define "the-boss-tape" for this suite to mean anything');
if (BOSS_TAPE.onAccept?.setFlag !== 'marked') {
  throw new Error('this suite assumes quests.json\'s "the-boss-tape" still sets the "marked" flag on accept');
}

/** Drives `def`'s ENTIRE clueChain through the real `revealNextHop` pipeline, hop by hop, exactly as repeated "Investigate" activations at each building would — the reachable way to produce a fully-revealed (and, where `def.onAccept.setFlag` exists, flagged) `QuestState`, never a hand-built fixture. */
function revealFullChain(def: QuestDef): QuestState {
  let state: QuestState | undefined = undefined;
  for (let i = 0; i < def.clueChain.length; i++) state = revealNextHop(def, state);
  if (state === undefined) throw new Error('revealFullChain: def.clueChain must be non-empty');
  return state;
}

describe('journal — quests.json data helpers', () => {
  it('questDefs returns every real quests.json mission, questDef looks one up by id', () => {
    expect(questDefs().length).toBeGreaterThan(0);
    expect(questDef('decoy-prize')?.title).toBe(DECOY_PRIZE.title);
    expect(questDef('does-not-exist')).toBeUndefined();
  });

  it('nextHopMatches is true only for the exact next unrevealed hop, at the exact facility+city', () => {
    // Fresh quest, nothing revealed: next hop is bar:newyork.
    expect(nextHopMatches(DECOY_PRIZE, undefined, 'bar', 'newyork')).toBe(true);
    expect(nextHopMatches(DECOY_PRIZE, undefined, 'bar', 'albany')).toBe(false); // right facility, wrong city (not yet)
    expect(nextHopMatches(DECOY_PRIZE, undefined, 'truckstop', 'newyork')).toBe(false); // right city, wrong facility

    const afterFirst: QuestState = { id: DECOY_PRIZE.id, stage: 1, completed: false, flags: {} };
    expect(nextHopMatches(DECOY_PRIZE, afterFirst, 'bar', 'newyork')).toBe(false); // already revealed, not offered again
    expect(nextHopMatches(DECOY_PRIZE, afterFirst, 'bar', 'albany')).toBe(true); // now the next one
  });

  it('nextHopMatches never matches a completed quest', () => {
    const done: QuestState = { id: DECOY_PRIZE.id, stage: 1, completed: true, flags: {} };
    expect(nextHopMatches(DECOY_PRIZE, done, 'bar', 'albany')).toBe(false);
  });

  it('revealNextHop creates a fresh stage-1 entry when none exists, and increments an existing one', () => {
    const created = revealNextHop(DECOY_PRIZE, undefined);
    expect(created).toEqual({ id: DECOY_PRIZE.id, stage: 1, completed: false, flags: {} });

    const bumped = revealNextHop(DECOY_PRIZE, created);
    expect(bumped.stage).toBe(2);
    expect(created.stage).toBe(1); // never mutated in place
  });

  it('revealNextHop caps stage at clueChain.length (mutation guard: a plain +1 with no cap would overshoot)', () => {
    const chainLength = DECOY_PRIZE.clueChain.length;
    const almostDone: QuestState = { id: DECOY_PRIZE.id, stage: chainLength, completed: false, flags: {} };
    expect(revealNextHop(DECOY_PRIZE, almostDone).stage).toBe(chainLength);
  });

  it('revealNextHop never sets a flag on a partial reveal, even for a quest with an onAccept.setFlag — overhearing a lead must never, by itself, mark the driver', () => {
    const first = revealNextHop(BOSS_TAPE, undefined);
    expect(first.stage).toBe(1);
    expect(first.stage).toBeLessThan(BOSS_TAPE.clueChain.length);
    expect(first.flags.marked).toBeUndefined();
  });

  it('revealNextHop applies onAccept.setFlag the moment (and only the moment) a reveal completes the chain — the reachable "taking the job" event this UI has (mutation-proven: dropping the setFlag application, or firing it early, both fail this)', () => {
    const chainLength = BOSS_TAPE.clueChain.length;
    expect(chainLength).toBeGreaterThan(1); // this test is only meaningful with >=2 hops

    let state: QuestState | undefined = undefined;
    for (let i = 0; i < chainLength - 1; i++) {
      state = revealNextHop(BOSS_TAPE, state);
      expect(state?.flags.marked).toBeUndefined(); // not yet — chain isn't full
    }
    const final = revealNextHop(BOSS_TAPE, state);
    expect(final.stage).toBe(chainLength);
    expect(final.flags.marked).toBe(true);
  });

  it('revealNextHop never sets a flag for a quest with no onAccept at all, even once its chain is fully revealed', () => {
    expect(DECOY_PRIZE.onAccept).toBeUndefined();
    const state = revealFullChain(DECOY_PRIZE);
    expect(state.stage).toBe(DECOY_PRIZE.clueChain.length);
    expect(state.flags).toEqual({});
  });

  it('driverIsMarked is false by default, and true only once the SAME pipeline every building calls (revealNextHop, driven to a full chain) has actually set the flag — not a hand-built fixture', () => {
    expect(driverIsMarked([])).toBe(false);
    expect(driverIsMarked([revealFullChain(BOSS_TAPE)])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Journal screen — pure core
// ---------------------------------------------------------------------------

describe('journal — courier jobs', () => {
  it('lists an accepted courier job with its due day', () => {
    const job = makeAcceptedJob({ offer: makeCourierOffer({ cargoName: 'Cold Cargo', destinationCityId: 'boston', destinationFacility: 'medical', pay: 8000, dueDay: 14 }) });
    const ctx = makeJournalContext({ activeCourierJobs: [job] });
    const actions = journalActions(createJournalState(ctx));

    const expectedLabel = t('journal.courier.entry', {
      cargo: 'Cold Cargo',
      city: cityName('boston'),
      facility: facilityName('medical'),
      pay: 8000,
      day: 14,
    });
    const row = actions.find((a) => a.id === `courier-job-${job.cargoId}`);
    expect(row).toBeDefined();
    expect(row?.label).toBe(expectedLabel);
    expect(row?.label).toContain('14');
  });

  it('does not list a DELIVERED or FAILED job', () => {
    const delivered = makeAcceptedJob({ cargoId: 'cargo-a', status: 'DELIVERED' });
    const failed = makeAcceptedJob({ cargoId: 'cargo-b', status: 'FAILED' });
    const ctx = makeJournalContext({ activeCourierJobs: [delivered, failed] });
    const actions = journalActions(createJournalState(ctx));
    expect(actions.some((a) => a.id.startsWith('courier-job-'))).toBe(false);
    expect(actions.some((a) => a.id === 'courier-none')).toBe(true);
  });

  it('shows a placeholder row when no courier work is carried', () => {
    const actions = journalActions(createJournalState(makeJournalContext()));
    const row = actions.find((a) => a.id === 'courier-none');
    expect(row?.label).toBe(t('journal.courier.none'));
  });
});

describe('journal — campaign missions', () => {
  it('shows no missions until at least one has real save-state', () => {
    const actions = journalActions(createJournalState(makeJournalContext()));
    expect(actions.find((a) => a.id === 'quest-none')).toBeDefined();
    expect(actions.some((a) => a.id.startsWith('quest-title-'))).toBe(false);
  });

  it('a revealed clue hop shows its destination city and facility', () => {
    const state: QuestState = { id: DECOY_PRIZE.id, stage: 1, completed: false, flags: {} };
    const ctx = makeJournalContext({ quests: [state] });
    const actions = journalActions(createJournalState(ctx));

    const clueRow = actions.find((a) => a.id === `quest-clue-${DECOY_PRIZE.id}-0`);
    expect(clueRow).toBeDefined();
    expect(clueRow?.label).toBe(t('journal.quest.clue', { city: cityName('newyork'), facility: facilityName('bar') }));
    expect(clueRow?.label).toContain(cityName('newyork'));
    expect(clueRow?.label).toContain(facilityName('bar'));
  });

  it('an unrevealed hop is NOT shown — no second/third clue row, and its city/facility text appears nowhere on the screen', () => {
    const state: QuestState = { id: DECOY_PRIZE.id, stage: 1, completed: false, flags: {} };
    const ctx = makeJournalContext({ quests: [state] });
    const actions = journalActions(createJournalState(ctx));

    // Hop 1 (bar:albany) and beyond must not be shown.
    expect(actions.find((a) => a.id === `quest-clue-${DECOY_PRIZE.id}-1`)).toBeUndefined();
    const albanyName = cityName('albany');
    expect(actions.some((a) => a.label.includes(albanyName))).toBe(false);
    // Instead, a generic "more leads remain" placeholder, revealing nothing.
    expect(actions.find((a) => a.id === `quest-more-${DECOY_PRIZE.id}`)?.label).toBe(t('journal.quest.moreToFind'));
  });

  it('once every hop is revealed, no "more leads" placeholder remains', () => {
    const chainLength = DECOY_PRIZE.clueChain.length;
    const state: QuestState = { id: DECOY_PRIZE.id, stage: chainLength, completed: false, flags: {} };
    const ctx = makeJournalContext({ quests: [state] });
    const actions = journalActions(createJournalState(ctx));
    expect(actions.find((a) => a.id === `quest-more-${DECOY_PRIZE.id}`)).toBeUndefined();
    expect(actions.filter((a) => a.id.startsWith(`quest-clue-${DECOY_PRIZE.id}-`))).toHaveLength(chainLength);
  });

  it('a completed mission moves to the completed list, not the active one', () => {
    const done: QuestState = { id: DECOY_PRIZE.id, stage: DECOY_PRIZE.clueChain.length, completed: true, flags: {} };
    const ctx = makeJournalContext({ quests: [done] });
    const actions = journalActions(createJournalState(ctx));
    expect(actions.some((a) => a.id.startsWith('quest-title-'))).toBe(false);
    expect(actions.find((a) => a.id === `quest-completed-${DECOY_PRIZE.id}`)?.label).toBe(t('journal.quest.completed', { title: DECOY_PRIZE.title }));
  });

  it('active missions list in def.order, not insertion order (mutation-proven: reversing the sort comparator flips this)', () => {
    // decoy-prize is order 1, the-boss-tape is order 5 — inserted here in
    // the OPPOSITE of order so a comparator bug (or a plain reversal) shows
    // up as a wrong sequence rather than passing by accident.
    expect(BOSS_TAPE.order).toBeGreaterThan(DECOY_PRIZE.order);
    const bossTapeState: QuestState = { id: BOSS_TAPE.id, stage: 1, completed: false, flags: {} };
    const decoyState: QuestState = { id: DECOY_PRIZE.id, stage: 1, completed: false, flags: {} };
    const ctx = makeJournalContext({ quests: [bossTapeState, decoyState] });
    const actions = journalActions(createJournalState(ctx));

    const titleIds = actions.filter((a) => a.id.startsWith('quest-title-')).map((a) => a.id);
    expect(titleIds).toEqual([`quest-title-${DECOY_PRIZE.id}`, `quest-title-${BOSS_TAPE.id}`]);
  });

  it('the marked state is visible, with an explanation, and ONLY when a quest actually carries the flag — driven through the real revealNextHop pipeline, not a hand-built fixture', () => {
    const unmarked: QuestState = { id: DECOY_PRIZE.id, stage: 1, completed: false, flags: {} };
    const unmarkedActions = journalActions(createJournalState(makeJournalContext({ quests: [unmarked] })));
    expect(unmarkedActions.some((a) => a.label === t('journal.quest.marked'))).toBe(false);
    expect(unmarkedActions.some((a) => a.id === JOURNAL_MARKED_BANNER_ID)).toBe(false);

    const marked = revealFullChain(BOSS_TAPE);
    expect(marked.flags.marked).toBe(true); // sanity: the fixture really is reachable

    const markedActions = journalActions(createJournalState(makeJournalContext({ quests: [marked] })));
    const perQuestWarning = markedActions.find((a) => a.id === `quest-marked-${BOSS_TAPE.id}`);
    expect(perQuestWarning?.label).toBe(t('journal.quest.marked'));

    const banner = markedActions.find((a) => a.id === JOURNAL_MARKED_BANNER_ID);
    expect(banner?.label).toBe(t('journal.quest.marked'));
  });
});

describe('journal — every string goes through t()', () => {
  it("the header's city name and every action label trace back to strings.json/cities.json data, not a literal (mutation-proven per row kind, not just non-empty)", () => {
    const job = makeAcceptedJob({ offer: makeCourierOffer({ cargoName: 'Cold Cargo', destinationCityId: 'boston', destinationFacility: 'medical', pay: 8000, dueDay: 14 }) });
    const clue: QuestState = { id: DECOY_PRIZE.id, stage: 1, completed: false, flags: {} };
    const ctx = makeJournalContext({ activeCourierJobs: [job], quests: [clue], cityId: 'boston' });
    const state = createJournalState(ctx);

    const header = journalHeader(ctx);
    expect(header.cityName).toBe(cityName('boston'));

    const actions = journalActions(state);
    for (const action of actions) {
      expect(action.label.length).toBeGreaterThan(0);
      if (action.reason !== undefined) expect(action.reason).toBe(action.label);
    }

    // Every row's label re-derived, independently, from the SAME t() call
    // with the SAME real data the row is supposed to carry — a row that
    // silently hardcoded its own text (or read the wrong field) fails one
    // of these, unlike a bare "is this non-empty" check.
    const courierRow = actions.find((a) => a.id === `courier-job-${job.cargoId}`);
    expect(courierRow?.label).toBe(
      t('journal.courier.entry', { cargo: 'Cold Cargo', city: cityName('boston'), facility: facilityName('medical'), pay: 8000, day: 14 }),
    );

    const titleRow = actions.find((a) => a.id === `quest-title-${DECOY_PRIZE.id}`);
    expect(titleRow?.label).toBe(t('journal.quest.title', { title: DECOY_PRIZE.title }));

    const clueRow = actions.find((a) => a.id === `quest-clue-${DECOY_PRIZE.id}-0`);
    expect(clueRow?.label).toBe(t('journal.quest.clue', { city: cityName('newyork'), facility: facilityName('bar') }));

    const moreRow = actions.find((a) => a.id === `quest-more-${DECOY_PRIZE.id}`);
    expect(moreRow?.label).toBe(t('journal.quest.moreToFind'));

    const leaveRow = actions.find((a) => a.id === JOURNAL_LEAVE_ACTION_ID);
    expect(leaveRow?.label).toBe(t('journal.leave'));
  });
});

// ---------------------------------------------------------------------------
// Keyboard operability — real key-driven walk through the generic
// BuildingEngine<S> plumbing (@/ui/buildings/shared's stepBuilding/menuFor),
// same as every facility panel's own tests.
// ---------------------------------------------------------------------------

describe('journal — fully operable with arrow and number keys', () => {
  it('ArrowUp/ArrowDown move the selection across ineligible info rows; Enter on one refuses (stays open); Escape backs out', () => {
    const job = makeAcceptedJob();
    const ctx = makeJournalContext({ activeCourierJobs: [job] });
    const state = createJournalState(ctx);
    const menu = menuFor(journalEngine, state);

    // Rows: [courier-job (ineligible), quest-none (ineligible), leave (eligible)].
    // createMenu selects the first ELIGIBLE row by default — "Close Journal".
    expect(menu.actions[0]?.id).toBe(`courier-job-${job.cargoId}`);
    expect(menu.actions[1]?.id).toBe('quest-none');
    const leaveIndex = menu.actions.length - 1;
    expect(menu.actions[leaveIndex]?.id).toBe(JOURNAL_LEAVE_ACTION_ID);
    expect(menu.selectedIndex).toBe(leaveIndex);

    let result = stepBuilding(journalEngine, state, menu, 'ArrowUp');
    expect(result.menu.selectedIndex).toBe(leaveIndex - 1); // quest-none
    expect(result.exit).toBe(false);

    result = stepBuilding(journalEngine, result.state, result.menu, 'ArrowUp');
    expect(result.menu.selectedIndex).toBe(leaveIndex - 2); // courier-job row
    expect(result.exit).toBe(false);

    // Enter on this still-ineligible row must not exit and must not change state.
    result = stepBuilding(journalEngine, result.state, result.menu, 'Enter');
    expect(result.exit).toBe(false);
    expect(result.state).toBe(state); // untouched — an info row activating is a strict no-op
    expect(result.menu.message).toBe(menu.actions[0]?.reason); // info rows carry their own reason (== their label)

    result = stepBuilding(journalEngine, result.state, result.menu, 'ArrowDown');
    expect(result.menu.selectedIndex).toBe(leaveIndex - 1);

    result = stepBuilding(journalEngine, result.state, result.menu, 'Escape');
    expect(result.exit).toBe(true);
  });

  it('a digit key jumps straight to and activates that numbered row — the eligible "Close Journal" row exits', () => {
    const state = createJournalState(makeJournalContext());
    const menu = menuFor(journalEngine, state);
    const leaveIndex = menu.actions.findIndex((a) => a.id === JOURNAL_LEAVE_ACTION_ID);
    expect(leaveIndex).toBeGreaterThanOrEqual(0);
    expect(leaveIndex).toBeLessThan(9); // reachable by a single digit key (1-9)

    const digit = String((leaveIndex + 1) % 10);
    const result = stepBuilding(journalEngine, state, menu, digit);
    expect(result.exit).toBe(true);
  });

  it('journalEngine.activate never mutates state for a non-leave id', () => {
    const state = createJournalState(makeJournalContext());
    const result = journalEngine.activate(state, 'courier-none');
    expect(result.exit).toBe(false);
    expect(result.state).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// The other half: bar/truckstop offer "Investigate" at the right hop, and
// revealing it advances real save-state (mutation-proven: break either
// building's gate/facility/city check and one of these fails).
// ---------------------------------------------------------------------------

describe('bar/truckstop — mission entries offered at the right clue-chain hop', () => {
  it('bar offers "Investigate" only once prestige clears the gate, at the exact next hop city', () => {
    const belowGate = makeBuildingContext({ driver: makeDriver({ prestige: DECOY_PRIZE.gate - 1 }), cityId: 'newyork' });
    expect(barActions(createBarState(belowGate)).some((a) => a.id === `investigate-${DECOY_PRIZE.id}`)).toBe(false);

    const wrongCity = makeBuildingContext({ driver: makeDriver({ prestige: DECOY_PRIZE.gate }), cityId: 'boston' });
    expect(barActions(createBarState(wrongCity)).some((a) => a.id === `investigate-${DECOY_PRIZE.id}`)).toBe(false);

    const rightSpot = makeBuildingContext({ driver: makeDriver({ prestige: DECOY_PRIZE.gate }), cityId: 'newyork' });
    const row = barActions(createBarState(rightSpot)).find((a) => a.id === `investigate-${DECOY_PRIZE.id}`);
    expect(row).toBeDefined();
    expect(row?.label).toBe(t('building.bar.quest.investigate', { title: DECOY_PRIZE.title }));
    expect(row?.eligible).toBe(true);
  });

  // This proves the pure BuildingEngine<BarState> core does the right thing
  // with the BuildingContext it's handed — it does NOT by itself prove the
  // host wires ctx.quests back into its own persistent city/save state across
  // a Leave; that's a src/app.ts CityRunState.quests + buildingContextFrom/
  // applyBuildingContext concern, outside this module's (and this suite's)
  // file scope. See this repo's own campaign-ui review for that gap.
  it('activating "Investigate" at the bar reveals that hop and the action then disappears from the bar (the next hop is elsewhere)', () => {
    const ctx = makeBuildingContext({ driver: makeDriver({ prestige: DECOY_PRIZE.gate }), cityId: 'newyork', quests: [] });
    const result = barEngine.activate(createBarState(ctx), `investigate-${DECOY_PRIZE.id}`);
    expect(result.exit).toBe(false);
    expect(result.state.context.quests).toEqual([{ id: DECOY_PRIZE.id, stage: 1, completed: false, flags: {} }]);

    // Re-render at the SAME building with the updated quests: the row is gone (next hop is bar:albany, a different city).
    const again = barActions(result.state);
    expect(again.some((a) => a.id === `investigate-${DECOY_PRIZE.id}`)).toBe(false);
  });

  it('truckstop offers "Investigate" for the-boss-tape at truckstop:watertown once gated, and reveals it the same generic way', () => {
    const bossTape = questDef('the-boss-tape');
    if (bossTape === undefined) throw new Error('quests.json must define "the-boss-tape"');

    const ctx = makeBuildingContext({ driver: makeDriver({ prestige: bossTape.gate }), cityId: 'watertown', quests: [] });
    const row = truckstopActions(createTruckstopState(ctx)).find((a) => a.id === `investigate-${bossTape.id}`);
    expect(row).toBeDefined();
    expect(row?.label).toBe(t('building.truckstop.quest.investigate', { title: bossTape.title }));

    // Investigating is pure information-gathering — the-boss-tape's own
    // onAccept.setFlag ("marked") is deliberately NOT applied here (see
    // `revealNextHop`'s doc comment): overhearing its first lead at a truck
    // stop must never, by itself, mark the driver.
    const result = truckstopEngine.activate(createTruckstopState(ctx), `investigate-${bossTape.id}`);
    expect(result.state.context.quests).toEqual([{ id: bossTape.id, stage: 1, completed: false, flags: {} }]);
  });

  it('never offers "Investigate" for a facility/city that is not the exact next hop (BAR_KIND/TRUCKSTOP_KIND spot-check)', () => {
    expect(BAR_KIND).toBe('bar');
    expect(TRUCKSTOP_KIND).toBe('truckstop');
    const ctx = makeBuildingContext({ driver: makeDriver({ prestige: 100 }), cityId: 'albany' });
    // decoy-prize's FIRST hop is bar:newyork, not bar:albany — must not be offered yet from Albany.
    expect(barActions(createBarState(ctx)).some((a) => a.id === `investigate-${DECOY_PRIZE.id}`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The remaining facility kinds quests.json's clueChains actually name
// (medical/garage/courierguild, plus a stub kind for "story") — every one
// of them wired the same generic way as bar/truckstop above, through the
// SAME `questInvestigateRows`/`applyInvestigateAction` (`@/ui/journal`).
// Before this, only bar/truckstop offered "Investigate" anywhere, so no
// clue chain that touches any of these could ever be completed — see this
// repo's own campaign-ui review.
// ---------------------------------------------------------------------------

describe('medical/garage/courierguild/stub — the other clue-chain hops', () => {
  it('medical offers "Investigate" for transplant-run at medical:newyork (its ONLY hop)', () => {
    const transplantRun = questDef('transplant-run');
    if (transplantRun === undefined) throw new Error('quests.json must define "transplant-run"');
    expect(transplantRun.clueChain).toEqual(['medical:newyork']);

    const ctx = makeBuildingContext({ driver: makeDriver({ prestige: transplantRun.gate }), cityId: 'newyork', quests: [] });
    const row = medicalActions(createMedicalState(ctx)).find((a) => a.id === `investigate-${transplantRun.id}`);
    expect(row).toBeDefined();
    expect(row?.label).toBe(t('building.medical.quest.investigate', { title: transplantRun.title }));

    const result = medicalEngine.activate(createMedicalState(ctx), `investigate-${transplantRun.id}`);
    expect(result.state.context.quests).toEqual([{ id: transplantRun.id, stage: 1, completed: false, flags: {} }]);
    // Fully revealed in one hop — chain is complete, matching `chainFullyRevealed` via the journal's own "no more leads" behavior.
    expect(result.state.context.quests?.[0]?.stage).toBe(transplantRun.clueChain.length);
  });

  it('garage offers "Investigate" for ledger-evidence at garage:watertown, its LAST hop, once the first two are already revealed', () => {
    const ledgerEvidence = questDef('ledger-evidence');
    if (ledgerEvidence === undefined) throw new Error('quests.json must define "ledger-evidence"');
    expect(ledgerEvidence.clueChain[2]).toBe('garage:watertown');

    const twoRevealed: QuestState = { id: ledgerEvidence.id, stage: 2, completed: false, flags: {} };
    const ctx = makeBuildingContext({ driver: makeDriver({ prestige: ledgerEvidence.gate }), cityId: 'watertown', quests: [twoRevealed] });
    const row = garageActions(createGarageState(ctx)).find((a) => a.id === `investigate-${ledgerEvidence.id}`);
    expect(row).toBeDefined();
    expect(row?.label).toBe(t('building.garage.quest.investigate', { title: ledgerEvidence.title }));

    const result = garageEngine.activate(createGarageState(ctx), `investigate-${ledgerEvidence.id}`);
    expect(result.state.context.quests).toEqual([{ id: ledgerEvidence.id, stage: 3, completed: false, flags: {} }]);
  });

  it('courierguild offers "Investigate" for decoy-prize at courierguild:albany, its third hop, once the first two are already revealed', () => {
    expect(DECOY_PRIZE.clueChain[2]).toBe('courierguild:albany');

    const twoRevealed: QuestState = { id: DECOY_PRIZE.id, stage: 2, completed: false, flags: {} };
    const ctx = makeBuildingContext({ driver: makeDriver({ prestige: DECOY_PRIZE.gate }), cityId: 'albany', quests: [twoRevealed] });
    const row = courierGuildActions(createCourierGuildState(ctx)).find((a) => a.id === `investigate-${DECOY_PRIZE.id}`);
    expect(row).toBeDefined();
    expect(row?.label).toBe(t('building.courierguild.quest.investigate', { title: DECOY_PRIZE.title }));

    const result = courierGuildEngine.activate(createCourierGuildState(ctx), `investigate-${DECOY_PRIZE.id}`);
    expect(result.state.context.quests).toEqual([{ id: DECOY_PRIZE.id, stage: 3, completed: false, flags: {} }]);
  });

  it('the "story" stub facility offers "Investigate" for the-boss-tape at story:watertown — its LAST hop, generic over ANY stub kind, not a "story" special case', () => {
    expect(BOSS_TAPE.clueChain[1]).toBe('story:watertown');

    const firstRevealed: QuestState = { id: BOSS_TAPE.id, stage: 1, completed: false, flags: {} };
    const ctx = makeBuildingContext({ driver: makeDriver({ prestige: BOSS_TAPE.gate }), cityId: 'watertown', quests: [firstRevealed] });
    const row = stubActions(createStubState(ctx, 'story')).find((a) => a.id === `investigate-${BOSS_TAPE.id}`);
    expect(row).toBeDefined();
    expect(row?.label).toBe(t('building.stub.quest.investigate', { title: BOSS_TAPE.title }));

    // A DIFFERENT stub kind (e.g. "federal") at the same city must NOT offer it — proves this is genuinely city+facility gated, not "any stub anywhere".
    expect(stubActions(createStubState(ctx, 'federal')).some((a) => a.id === `investigate-${BOSS_TAPE.id}`)).toBe(false);

    // Revealing the LAST hop completes the-boss-tape's chain AND applies its onAccept.setFlag — the reachable "taking the job" moment (see `revealNextHop`).
    const result = stubEngine.activate(createStubState(ctx, 'story'), `investigate-${BOSS_TAPE.id}`);
    expect(result.state.context.quests).toEqual([{ id: BOSS_TAPE.id, stage: 2, completed: false, flags: { marked: true } }]);
  });
});
