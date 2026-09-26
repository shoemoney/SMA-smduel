/**
 * VICTORY subsystem: delivering a `quests.json` mission whose `onDeliver`
 * carries `victory: true`.
 *
 * `quests.json` is not yet wired into the central `@/data/rulesets` loader
 * (same situation `@/sim/courier` documents for `couriers.json`), so this
 * module reads it directly and validates its own shape at import time -
 * nothing gameplay-relevant here is a TypeScript literal; every number and
 * flag this module acts on (pay, prestigeReward, destination, `onDeliver`)
 * comes straight from the quest's own row in quests.json. `@/sim/rumour`
 * (clue-chain discovery) deliberately reuses THIS module's `questDefs()`/
 * `findQuestState()` rather than parsing quests.json a second time - this is
 * the one shared, canonical reader/validator for the ruleset file, and its
 * `QuestDef`/`QuestLocationDef` types are the ones a caller should reuse
 * rather than declaring their own.
 *
 * NOTE ON `@/sim/quest`: that module ALSO reads and validates quests.json,
 * with its own `QuestDef`, and drives accept/deliver through an entirely
 * separate, unpersisted `QuestProgress`/`CampaignState` pair rather than
 * this module's `@/persist/save.QuestState` ledger. The rest of this
 * codebase that already touches campaign quests (`@/sim/rumour`,
 * `@/ui/journal`, `@/ui/buildings/bar`, `@/ui/buildings/truckstop`) is built
 * against the PERSISTED `QuestState` ledger this module also uses, so THAT
 * is the one an integrator should keep - `@/sim/quest`'s parallel engine is
 * out of this file's scope to rewrite, but it must never be wired up
 * alongside this module against the SAME delivery: two engines racing the
 * same `quest.pay`/`prestigeReward` is a double payout, not a feature.
 *
 * Deliberately generic: nothing here names `the-boss-tape`. `deliverQuest`
 * treats ANY quest whose `onDeliver.victory` is `true` as a victory
 * delivery - today that is exactly one row in quests.json, but the branch
 * is "does this quest's own data say victory", never a quest id compared in
 * TypeScript. Extending or adding a second victory condition is a
 * quests.json edit, not a code change.
 *
 * "The sandbox survives victory" is a property of what this module does
 * NOT do: `deliverQuest` never touches anything but the driver's cash and
 * prestige, the vehicle's cargo hold, and the one `QuestState` row for the
 * delivered quest. The fleet, every other vehicle, the save, the clock -
 * none of it is read or mutated, so a caller that just keeps playing after
 * victory has nothing to restore.
 *
 * A delivered quest's `QuestState.completed` is a one-way door: `deliverQuest`
 * refuses (`ALREADY_DELIVERED`, no pay, no state change) the moment that flag
 * is already set, so the same mission can never be delivered - and never pay
 * out - twice.
 */
import { addPrestige, losePrestige } from '@/sim/driver';
import { fleetSize, type Fleet } from '@/sim/fleet';
import type { DriverState, VehicleState } from '@/sim/types';
import type { QuestState } from '@/persist/save';
import { daysLate, type Clock } from '@/sim/calendar';
import { t } from '@/ui/strings';
import questsJson from '@rulesets/classic/quests.json';

// ---------------------------------------------------------------------------
// Ruleset shape (quests.json)
// ---------------------------------------------------------------------------

export interface QuestLocationDef {
  readonly cityId: string;
  readonly facility: string;
}

export interface QuestCargoDef {
  readonly name: string;
  readonly weightLb: number;
  readonly spaces: number;
  readonly declaredValue: number;
}

export interface QuestOnAccept {
  readonly destroyClone?: boolean;
  readonly setFlag?: string;
  readonly pursuitLevel?: number;
}

export interface QuestOnDeliver {
  readonly victory?: boolean;
  readonly sandboxContinues?: boolean;
}

export interface QuestDef {
  readonly id: string;
  readonly gate: number;
  readonly order: number;
  readonly title: string;
  readonly summary: string;
  readonly clueChain: readonly string[];
  readonly source?: QuestLocationDef;
  readonly destination: QuestLocationDef;
  readonly dueDays: number | null;
  readonly pay: number;
  readonly prestigeReward: number;
  readonly failurePenalty: number;
  readonly cargo: QuestCargoDef;
  readonly flags?: readonly string[];
  readonly onAccept?: QuestOnAccept;
  readonly onDeliver?: QuestOnDeliver;
}

interface QuestsFile {
  readonly $schemaVersion: number;
  readonly rumorsPerLocationPerDay: number;
  readonly quests: readonly QuestDef[];
}

// ---------------------------------------------------------------------------
// Shape validation - quests.json is NOT ajv-validated by @/data/rulesets, so
// a blind cast is the only thing standing between a malformed/edited-out
// field and a `number` that's silently `undefined` at runtime. Every field
// this module actually reads is checked here, once, at import time (same
// pattern `@/sim/courier`'s `assertCouriersShape` uses for couriers.json).
// ---------------------------------------------------------------------------

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`victory.ts: quests.json "${path}" must be an object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`victory.ts: quests.json "${path}" must be a non-empty string, got ${JSON.stringify(value)}`);
  }
}

function requireFiniteNumber(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`victory.ts: quests.json "${path}" must be a finite number, got ${JSON.stringify(value)}`);
  }
}

function requireFiniteNumberOrNull(value: unknown, path: string): void {
  if (value === null) return;
  requireFiniteNumber(value, path);
}

function requireStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`victory.ts: quests.json "${path}" must be an array of strings, got ${JSON.stringify(value)}`);
  }
}

function requireLocation(value: unknown, path: string): void {
  const location = requireObject(value, path);
  requireNonEmptyString(location.cityId, `${path}.cityId`);
  requireNonEmptyString(location.facility, `${path}.facility`);
}

function requireCargo(value: unknown, path: string): void {
  const cargo = requireObject(value, path);
  requireNonEmptyString(cargo.name, `${path}.name`);
  requireFiniteNumber(cargo.weightLb, `${path}.weightLb`);
  requireFiniteNumber(cargo.spaces, `${path}.spaces`);
  requireFiniteNumber(cargo.declaredValue, `${path}.declaredValue`);
}

function requireOnAccept(value: unknown, path: string): void {
  if (value === undefined) return;
  const onAccept = requireObject(value, path);
  if (onAccept.destroyClone !== undefined && typeof onAccept.destroyClone !== 'boolean') {
    throw new Error(`victory.ts: quests.json "${path}.destroyClone" must be a boolean, got ${JSON.stringify(onAccept.destroyClone)}`);
  }
  if (onAccept.setFlag !== undefined) requireNonEmptyString(onAccept.setFlag, `${path}.setFlag`);
  if (onAccept.pursuitLevel !== undefined) requireFiniteNumber(onAccept.pursuitLevel, `${path}.pursuitLevel`);
}

function requireOnDeliver(value: unknown, path: string): void {
  if (value === undefined) return;
  const onDeliver = requireObject(value, path);
  if (onDeliver.victory !== undefined && typeof onDeliver.victory !== 'boolean') {
    throw new Error(`victory.ts: quests.json "${path}.victory" must be a boolean, got ${JSON.stringify(onDeliver.victory)}`);
  }
  if (onDeliver.sandboxContinues !== undefined && typeof onDeliver.sandboxContinues !== 'boolean') {
    throw new Error(
      `victory.ts: quests.json "${path}.sandboxContinues" must be a boolean, got ${JSON.stringify(onDeliver.sandboxContinues)}`,
    );
  }
}

function assertQuestsShape(raw: unknown): void {
  const root = requireObject(raw, '<root>');
  if (!Array.isArray(root.quests) || root.quests.length === 0) {
    throw new Error(`victory.ts: quests.json "quests" must be a non-empty array, got ${JSON.stringify(root.quests)}`);
  }
  root.quests.forEach((entry: unknown, index: number) => {
    const quest = requireObject(entry, `quests[${index}]`);
    requireNonEmptyString(quest.id, `quests[${index}].id`);
    requireFiniteNumber(quest.gate, `quests[${index}].gate`);
    requireFiniteNumber(quest.order, `quests[${index}].order`);
    requireNonEmptyString(quest.title, `quests[${index}].title`);
    requireNonEmptyString(quest.summary, `quests[${index}].summary`);
    requireStringArray(quest.clueChain, `quests[${index}].clueChain`);
    if (quest.source !== undefined) requireLocation(quest.source, `quests[${index}].source`);
    requireLocation(quest.destination, `quests[${index}].destination`);
    requireFiniteNumberOrNull(quest.dueDays, `quests[${index}].dueDays`);
    requireFiniteNumber(quest.pay, `quests[${index}].pay`);
    requireFiniteNumber(quest.prestigeReward, `quests[${index}].prestigeReward`);
    requireFiniteNumber(quest.failurePenalty, `quests[${index}].failurePenalty`);
    requireCargo(quest.cargo, `quests[${index}].cargo`);
    if (quest.flags !== undefined) requireStringArray(quest.flags, `quests[${index}].flags`);
    requireOnAccept(quest.onAccept, `quests[${index}].onAccept`);
    requireOnDeliver(quest.onDeliver, `quests[${index}].onDeliver`);
  });
}

assertQuestsShape(questsJson);

const quests = questsJson as QuestsFile;

export function questDefs(): readonly QuestDef[] {
  return quests.quests;
}

export function questById(id: string): QuestDef {
  const found = quests.quests.find((quest) => quest.id === id);
  if (found === undefined) throw new Error(`victory.ts: unknown quest id "${id}" - not in quests.json`);
  return found;
}

/** A quest counts as a victory delivery purely by its OWN data - never a hardcoded id. */
export function isVictoryQuest(quest: QuestDef): boolean {
  return quest.onDeliver?.victory === true;
}

// ---------------------------------------------------------------------------
// Quest-state helpers (over @/persist/save's `SaveGame.quests`)
// ---------------------------------------------------------------------------

export function findQuestState(quests: readonly QuestState[], questId: string): QuestState | undefined {
  return quests.find((quest) => quest.id === questId);
}

function upsertQuestState(quests: readonly QuestState[], next: QuestState): readonly QuestState[] {
  const index = quests.findIndex((quest) => quest.id === next.id);
  if (index === -1) return [...quests, next];
  return quests.map((quest, i) => (i === index ? next : quest));
}

// `hasWonVictory` (a "has this save already won" query over `QuestState.flags`)
// used to live here with zero callers: a victory delivery is recognized
// entirely off `deliverQuest`'s own fresh `QuestDeliverResult.victory`, read
// once at the exact call site (see `@/app`'s `openFacility`), never by
// re-scanning saved quest flags for a past win. `noUnusedLocals` refuses an
// unexported function nothing in this module calls either, so there was no
// "module-private" middle ground to leave it in - removed rather than kept
// as dead weight with an invented caller. Bring it back, exported, the
// moment a real caller needs to ask that question (a title-screen "already
// won" state, a journal entry) - `quests.some((q) => q.completed &&
// q.flags.victory === true)` is the one-line shape it was.

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * The stable cargo id a quest's payload is carried under while active.
 * `@/persist/save`'s `QuestState` has no `cargoId` field of its own, so
 * this fixed, quest-id-derived convention is the contract any code that
 * loads a quest's payload onto a vehicle must follow for `deliverQuest`
 * below to ever find it again.
 */
export function questCargoId(questId: string): string {
  return `quest:${questId}`;
}

export type QuestDeliverOutcome = 'DELIVERED' | 'LATE' | 'ALREADY_DELIVERED' | 'WRONG_LOCATION' | 'CARGO_MISSING';

export interface QuestDeliverResult {
  readonly outcome: QuestDeliverOutcome;
  readonly quests: readonly QuestState[];
  readonly driver: DriverState;
  readonly vehicle: VehicleState;
  readonly paidAmount: number;
  /** True only when THIS call is the one that delivered a victory quest - see `hasWonVictory` for "has this save ever won". */
  readonly victory: boolean;
  readonly sandboxContinues: boolean;
}

function payDriver(driver: DriverState, amount: number): DriverState {
  return { ...driver, cash: driver.cash + amount };
}

/**
 * Delivers `quest`'s payload: requires `currentCityId`/`currentFacility` to
 * be exactly `quest.destination` and the quest's own cargo (id
 * `questCargoId(quest.id)`) to still be aboard `vehicle` with positive
 * integrity, same as `@/sim/courier`'s `deliver()` requires for a generated
 * job - "right city, wrong building is still WRONG_LOCATION" (docs/SPEC.md).
 *
 * `dueDay` is the absolute dayIndex this delivery was due, fixed by the
 * CALLER at accept time (`Number.POSITIVE_INFINITY` for a `dueDays: null`
 * quest) - this module keeps no accept-time state of its own to compute it
 * from, the same reason `buildVictorySummary` below takes `arenaRecord` as
 * a plain input rather than inventing one. On time (`clock.dayIndex` at or
 * before `dueDay`): outcome `DELIVERED`, full `quest.pay` plus
 * `quest.prestigeReward`. Late: outcome `LATE`, still fully paid `quest.pay`
 * (quests.json documents no pay-decay-per-day, unlike `couriers.json`'s
 * `lateness` table), but `quest.prestigeReward` is replaced by
 * `quest.failurePenalty` - a late campaign delivery is never silently free.
 *
 * Already-`completed` is checked FIRST, before location or cargo, so a
 * second delivery attempt is refused (`ALREADY_DELIVERED`, no pay, no
 * mutation) even if the caller somehow still has a matching cargo item
 * aboard - the one-way `completed` flag is what makes winning twice
 * impossible, not the cargo having already been removed.
 */
export function deliverQuest(
  quest: QuestDef,
  quests: readonly QuestState[],
  driver: DriverState,
  vehicle: VehicleState,
  currentCityId: string,
  currentFacility: string,
  clock: Clock,
  dueDay: number,
): QuestDeliverResult {
  const sandboxContinues = quest.onDeliver?.sandboxContinues !== false;
  const existing = findQuestState(quests, quest.id);

  if (existing?.completed === true) {
    return {
      outcome: 'ALREADY_DELIVERED',
      quests,
      driver,
      vehicle,
      paidAmount: 0,
      victory: false,
      sandboxContinues,
    };
  }

  if (currentCityId !== quest.destination.cityId || currentFacility !== quest.destination.facility) {
    return { outcome: 'WRONG_LOCATION', quests, driver, vehicle, paidAmount: 0, victory: false, sandboxContinues };
  }

  const cargoId = questCargoId(quest.id);
  const cargoItem = vehicle.cargo.find((item) => item.id === cargoId);
  if (cargoItem === undefined || cargoItem.integrity <= 0) {
    return { outcome: 'CARGO_MISSING', quests, driver, vehicle, paidAmount: 0, victory: false, sandboxContinues };
  }

  const late = daysLate(dueDay, clock);
  const victory = isVictoryQuest(quest);
  const nextVehicle: VehicleState = { ...vehicle, cargo: vehicle.cargo.filter((item) => item.id !== cargoId) };
  const nextDriver =
    late > 0
      ? losePrestige(payDriver(driver, quest.pay), quest.failurePenalty)
      : addPrestige(payDriver(driver, quest.pay), quest.prestigeReward);
  const nextQuestState: QuestState = {
    id: quest.id,
    stage: existing?.stage ?? 0,
    completed: true,
    flags: { ...(existing?.flags ?? {}), victory },
  };

  return {
    outcome: late > 0 ? 'LATE' : 'DELIVERED',
    quests: upsertQuestState(quests, nextQuestState),
    driver: nextDriver,
    vehicle: nextVehicle,
    paidAmount: quest.pay,
    victory,
    sandboxContinues,
  };
}

// ---------------------------------------------------------------------------
// Victory summary - every value below is read off real, passed-in state,
// never recomputed by hand. `arenaRecord` is the one exception worth calling
// out: nothing in @/sim/arena or @/persist/save persists a running
// win/loss tally today (arena resolution only ever returns a per-match
// outcome; see @/sim/arena's `resolveArenaExit`), so it is not this module's
// data to invent - a caller that already tracks it hands it in, exactly like
// `clock`, `driver` and `fleet`.
// ---------------------------------------------------------------------------

export interface ArenaRecord {
  readonly wins: number;
  readonly losses: number;
}

export interface VictorySummary {
  readonly questId: string;
  readonly questTitle: string;
  readonly daysElapsed: number;
  readonly finalCash: number;
  readonly finalPrestige: number;
  readonly carsOwned: number;
  readonly arenaRecord: ArenaRecord;
}

export interface VictorySummaryInput {
  readonly quest: QuestDef;
  readonly clock: Clock;
  readonly driver: DriverState;
  readonly fleet: Fleet;
  readonly arenaRecord: ArenaRecord;
}

/** Builds the summary from real state - no field here is a hardcoded or re-derived number. */
export function buildVictorySummary(input: VictorySummaryInput): VictorySummary {
  return {
    questId: input.quest.id,
    questTitle: input.quest.title,
    daysElapsed: input.clock.dayIndex,
    finalCash: input.driver.cash,
    finalPrestige: input.driver.prestige,
    carsOwned: fleetSize(input.fleet),
    arenaRecord: input.arenaRecord,
  };
}

/** The summary rendered as display lines, every one of them through `t()` (rulesets/classic/strings.json). */
export function victorySummaryLines(summary: VictorySummary): readonly string[] {
  return [
    t('victory.announcement', { questTitle: summary.questTitle }),
    t('victory.summary.days', { days: summary.daysElapsed }),
    t('victory.summary.cash', { cash: summary.finalCash }),
    t('victory.summary.prestige', { prestige: summary.finalPrestige }),
    t('victory.summary.cars', { cars: summary.carsOwned }),
    t('victory.summary.arenaRecord', { wins: summary.arenaRecord.wins, losses: summary.arenaRecord.losses }),
  ];
}
