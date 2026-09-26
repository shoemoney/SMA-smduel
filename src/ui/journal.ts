/**
 * Journal / tasks screen: the one place a driver can see, at a glance,
 * every courier job they're carrying and every campaign-mission clue
 * they've turned up — including whether they've been marked (docs/SPEC.md's
 * "Campaign" section: taking the final job marks the driver and creates
 * sustained pursuit, so a player must never discover that only by dying to
 * it with no explanation).
 *
 * Built the same way every other panel in this codebase is: a pure
 * `BuildingEngine<S>` core (`actions`/`header`/`activate`, `@/ui/buildings/shared`'s
 * own contract — reused here as-is rather than re-implemented, since it is
 * already generic over its state type and needs no `BuildingContext`) plus
 * `mountBuildingPanel`/`stepBuilding`, the same thin `@/ui/menu` wrapper and
 * pure-core test seam every facility interior uses. Every row here is an
 * always-ineligible info row except "Close Journal" — this screen shows
 * state, it doesn't transact.
 *
 * `quests.json`'s shape validation lives in exactly ONE place, `@/sim/victory`
 * (`questDefs`/`questById`/`findQuestState`, validated field-by-field at
 * import time) — this module never re-parses or re-casts the ruleset file
 * itself; it imports that module's already-validated data and types and
 * builds the clue-chain-specific reveal/reachability logic on top of them.
 * `@/ui/buildings/bar` and `@/ui/buildings/truckstop` (and every other
 * facility a mission's `clueChain` can name) import `questInvestigateRows`/
 * `applyInvestigateAction` from here rather than re-deriving "what's the
 * next hop, does it match this building, and what does revealing it do to
 * save-state" themselves — ONE implementation, used by every reader of it.
 */
import type { AcceptedJob } from '@/sim/courier';
import type { DriverState } from '@/sim/types';
import { findQuestState, questDefs as validatedQuestDefs, type QuestDef } from '@/sim/victory';
import type { Clock } from '@/sim/calendar';
import type { QuestState } from '@/persist/save';
import { cityName, facilityName, t, type StringId } from '@/ui/strings';
import type { MenuAction, MenuHeaderInfo } from '@/ui/menu';
import type { BuildingContext, BuildingEngine } from '@/ui/buildings/shared';

export type { QuestDef, QuestLocationDef } from '@/sim/victory';

/** Every mission quests.json defines, in file order (`order` ascending — the prestige-gate sequence docs/SPEC.md's Campaign section describes). Thin pass-through of `@/sim/victory`'s already-validated reader — see module header. */
export function questDefs(): readonly QuestDef[] {
  return validatedQuestDefs();
}

/** `id`'s def, or `undefined` for an id quests.json doesn't define — unlike `@/sim/victory`'s `questById` (which throws), callers here (`@/ui/buildings/bar`/`truckstop`'s `activate`) are guarding against a stale/malformed action id, not a programmer error, so a soft miss is the right shape. */
export function questDef(id: string): QuestDef | undefined {
  return validatedQuestDefs().find((q) => q.id === id);
}

// ---------------------------------------------------------------------------
// Clue hops — quests.json's `clueChain` entries are "<facility>:<cityId>".
// Pure parsing/reachability details, private to this module — nothing
// outside it needs a hop's own shape, only the answers `nextHopMatches`/
// `revealedHops`/`chainFullyRevealed` give.
// ---------------------------------------------------------------------------

interface ClueHop {
  readonly facility: string;
  readonly cityId: string;
}

function parseClueHop(raw: string): ClueHop {
  const sep = raw.indexOf(':');
  if (sep === -1) {
    throw new Error(`parseClueHop: malformed clue chain entry "${raw}" (expected "facility:cityId")`);
  }
  return { facility: raw.slice(0, sep), cityId: raw.slice(sep + 1) };
}

/** `state`'s revealed hop count — 0 (nothing revealed) when no save-state exists yet for this quest. */
function stageOf(state: QuestState | undefined): number {
  return state?.stage ?? 0;
}

/** Every hop `state` has already revealed, in chain order — never the hop(s) after it (see this module's header on why an unrevealed hop must never leak here). */
function revealedHops(def: QuestDef, state: QuestState | undefined): readonly ClueHop[] {
  return def.clueChain.slice(0, stageOf(state)).map(parseClueHop);
}

/** True once every hop in `def.clueChain` has been revealed (there is nothing left this quest's chain can still teach a building to offer). */
function chainFullyRevealed(def: QuestDef, state: QuestState | undefined): boolean {
  return stageOf(state) >= def.clueChain.length;
}

/**
 * True when `def`'s NEXT unrevealed hop (`clueChain[stageOf(state)]`) is
 * `facility` in `cityId` — the one check a building needs to decide whether
 * to offer "investigate" right now. A quest whose chain is already fully
 * revealed, or a completed quest, never matches anywhere.
 */
export function nextHopMatches(def: QuestDef, state: QuestState | undefined, facility: string, cityId: string): boolean {
  if (state?.completed === true) return false;
  const raw = def.clueChain[stageOf(state)];
  if (raw === undefined) return false;
  const hop = parseClueHop(raw);
  return hop.facility === facility && hop.cityId === cityId;
}

/**
 * Reveals `def`'s next hop against `existing` (or starts fresh at stage 1
 * when this quest has no save-state yet): a plain `+1` on `stage`, capped at
 * `clueChain.length`, never a per-quest-id branch. Investigating a clue is
 * otherwise pure information-gathering — the ONE exception is the moment
 * this reveal completes the chain (`nextStage === def.clueChain.length`):
 * `def.onAccept?.setFlag` (real quests.json data — never a quest id
 * compared in TypeScript) is folded into the returned state's `flags` right
 * then, generic over ANY quest that defines it. This is the reachable
 * "taking the job" moment in the current UI (there is no separate accept
 * screen anywhere in this codebase) and it's what makes
 * `driverIsMarked`/`@/sim/pursuit`'s `pursuitLevelFromQuestState`
 * — both of which read this exact flag off this exact `QuestState.flags`
 * container — genuinely reachable through real play instead of only a
 * hand-built test fixture. A hop that ISN'T the chain's last one never
 * touches `flags` — overhearing a lead partway through a chain must never,
 * by itself, mark the driver (see `tests/unit/journal.test.ts`'s
 * truck-stop case for `the-boss-tape`'s first hop). Never mutates
 * `existing`; returns the one entry the caller should splice into its own
 * `quests` array (see `questInvestigateRows`/`applyInvestigateAction`
 * below).
 */
export function revealNextHop(def: QuestDef, existing: QuestState | undefined): QuestState {
  const nextStage = Math.min(stageOf(existing) + 1, def.clueChain.length);
  const baseFlags = existing?.flags ?? {};
  const flags = nextStage >= def.clueChain.length && def.onAccept?.setFlag !== undefined
    ? { ...baseFlags, [def.onAccept.setFlag]: true }
    : baseFlags;
  if (existing !== undefined) {
    return { ...existing, stage: nextStage, flags };
  }
  return { id: def.id, stage: nextStage, completed: false, flags };
}

/**
 * The well-known campaign flag `the-boss-tape`'s `onAccept.setFlag` sets
 * (currently the only quest that defines one), read here by name rather
 * than by quest id so ANY quest that ever sets it counts, same as
 * `@/sim/pursuit`'s `pursuitLevelFromQuestState`, the other real consumer of
 * this exact flag on this exact container.
 */
const MARKED_FLAG = 'marked';

/** True the moment ANY quest's save-state carries the marked flag — the journal's own "you ARE marked, here's what that means" banner. */
export function driverIsMarked(quests: readonly QuestState[]): boolean {
  return quests.some((q) => q.flags[MARKED_FLAG] === true);
}

// ---------------------------------------------------------------------------
// Generic clue-hop wiring every facility a `clueChain` can name reuses —
// bar/truckstop/medical/garage/courierguild/stub all call these two
// functions instead of re-deriving "what quests are investigable here" or
// "what does investigating do to save-state" themselves.
// ---------------------------------------------------------------------------

/** Every unlocked, not-yet-fully-revealed quest whose NEXT clue-chain hop is `facility` in `ctx.cityId` — generic over every quests.json entry, never a per-quest-id branch. `ctx.quests` defaults to `[]` (see `BuildingContext.quests`'s own doc comment) so a construction site that predates campaign wiring just never offers one. Private: `questInvestigateRows` is the one public surface every facility calls. */
function questCluesAvailableHere(ctx: BuildingContext, facility: string): readonly QuestDef[] {
  const quests = ctx.quests ?? [];
  return questDefs().filter((def) => {
    if (ctx.driver.prestige < def.gate) return false;
    const existing = findQuestState(quests, def.id);
    return nextHopMatches(def, existing, facility, ctx.cityId);
  });
}

/** The "Investigate: {title}" row for every quest `questCluesAvailableHere` finds at `facility`, labelled through `labelId`'s own `t()` template (each facility kind keeps its own strings.json id, same convention `@/ui/buildings/bar`'s `building.bar.quest.investigate` already established). */
export function questInvestigateRows(ctx: BuildingContext, facility: string, labelId: StringId): MenuAction[] {
  return questCluesAvailableHere(ctx, facility).map((def) => ({
    id: `investigate-${def.id}`,
    label: t(labelId, { title: def.title }),
    eligible: true,
  }));
}

/** Applies an `investigate-<questId>` action id against `ctx`, returning the context with that quest's next hop revealed — or `ctx` unchanged for any other id (unknown quest, or not an investigate id at all). The one activation handler every facility with a clue hop needs. */
export function applyInvestigateAction(ctx: BuildingContext, actionId: string): BuildingContext {
  if (!actionId.startsWith('investigate-')) return ctx;
  const questId = actionId.slice('investigate-'.length);
  const def = questDef(questId);
  if (def === undefined) return ctx;
  const quests = ctx.quests ?? [];
  const existing = findQuestState(quests, questId);
  const revealed = revealNextHop(def, existing);
  const nextQuests: QuestState[] = existing !== undefined ? quests.map((q) => (q.id === questId ? revealed : q)) : [...quests, revealed];
  return { ...ctx, quests: nextQuests };
}

// ---------------------------------------------------------------------------
// Journal screen
// ---------------------------------------------------------------------------

export interface JournalContext {
  readonly driver: DriverState;
  readonly clock: Clock;
  readonly cityId: string;
  /** Every courier job accepted this game so far, any status — same shape/source as `@/ui/buildings/shared`'s `BuildingContext.activeCourierJobs`. Only `'ACTIVE'` ones are listed (see `activeCourierJobEntries`). */
  readonly activeCourierJobs: readonly AcceptedJob[];
  /** Campaign quest save-state — same shape/source as `BuildingContext.quests`. */
  readonly quests: readonly QuestState[];
}

export interface JournalState {
  readonly context: JournalContext;
}

export function createJournalState(context: JournalContext): JournalState {
  return { context };
}

/** Every job this screen lists: accepted, not yet delivered/failed. */
function activeCourierJobEntries(ctx: JournalContext): readonly AcceptedJob[] {
  return ctx.activeCourierJobs.filter((job) => job.status === 'ACTIVE');
}

interface QuestEntry {
  readonly def: QuestDef;
  readonly state: QuestState;
}

/** Every quest with real save-state (i.e. a driver has investigated at least its first clue hop somewhere) — split by `completed`. A gate-unlocked quest nobody has investigated yet has no state and is correctly invisible here, same as an unrevealed hop within one they HAVE started. */
function questEntries(ctx: JournalContext): { readonly active: readonly QuestEntry[]; readonly completed: readonly QuestEntry[] } {
  const active: QuestEntry[] = [];
  const completed: QuestEntry[] = [];
  for (const state of ctx.quests) {
    const def = questDef(state.id);
    if (def === undefined) continue; // save-state for a quest id this ruleset no longer defines
    (state.completed ? completed : active).push({ def, state });
  }
  active.sort((a, b) => a.def.order - b.def.order);
  completed.sort((a, b) => a.def.order - b.def.order);
  return { active, completed };
}

export const JOURNAL_LEAVE_ACTION_ID = 'leave';
export const JOURNAL_MARKED_BANNER_ID = 'journal-marked';

export function journalHeader(ctx: JournalContext): MenuHeaderInfo {
  return { cash: ctx.driver.cash, dayIndex: ctx.clock.dayIndex, phase: ctx.clock.phase, cityName: cityName(ctx.cityId) };
}

export function journalActions(state: JournalState): MenuAction[] {
  const ctx = state.context;
  const actions: MenuAction[] = [];

  if (driverIsMarked(ctx.quests)) {
    const label = t('journal.quest.marked');
    actions.push({ id: JOURNAL_MARKED_BANNER_ID, label, eligible: false, reason: label });
  }

  const jobs = activeCourierJobEntries(ctx);
  if (jobs.length === 0) {
    actions.push({ id: 'courier-none', label: t('journal.courier.none'), eligible: false, reason: t('journal.courier.none') });
  } else {
    for (const job of jobs) {
      const label = t('journal.courier.entry', {
        cargo: job.offer.cargoName,
        city: cityName(job.offer.destinationCityId),
        facility: facilityName(job.offer.destinationFacility),
        pay: job.offer.pay,
        day: job.offer.dueDay,
      });
      actions.push({ id: `courier-job-${job.cargoId}`, label, eligible: false, reason: label });
    }
  }

  const { active, completed } = questEntries(ctx);

  if (active.length === 0) {
    actions.push({ id: 'quest-none', label: t('journal.quest.none'), eligible: false, reason: t('journal.quest.none') });
  } else {
    for (const { def, state: questState } of active) {
      const titleLabel = t('journal.quest.title', { title: def.title });
      actions.push({ id: `quest-title-${def.id}`, label: titleLabel, eligible: false, reason: titleLabel });

      revealedHops(def, questState).forEach((hop, index) => {
        const label = t('journal.quest.clue', { city: cityName(hop.cityId), facility: facilityName(hop.facility) });
        actions.push({ id: `quest-clue-${def.id}-${index}`, label, eligible: false, reason: label });
      });

      if (!chainFullyRevealed(def, questState)) {
        actions.push({
          id: `quest-more-${def.id}`,
          label: t('journal.quest.moreToFind'),
          eligible: false,
          reason: t('journal.quest.moreToFind'),
        });
      }

      if (questState.flags[MARKED_FLAG] === true) {
        actions.push({ id: `quest-marked-${def.id}`, label: t('journal.quest.marked'), eligible: false, reason: t('journal.quest.marked') });
      }
    }
  }

  for (const { def } of completed) {
    const label = t('journal.quest.completed', { title: def.title });
    actions.push({ id: `quest-completed-${def.id}`, label, eligible: false, reason: label });
  }

  actions.push({ id: JOURNAL_LEAVE_ACTION_ID, label: t('journal.leave'), eligible: true });
  return actions;
}

/** Pure `BuildingEngine<JournalState>` core — this screen never mutates its own state; every activation either does nothing (an info row) or exits (`JOURNAL_LEAVE_ACTION_ID`). Mount it exactly like any facility panel: `mountBuildingPanel({ container, initialState: createJournalState(ctx), engine: journalEngine, onExit })`. */
export const journalEngine: BuildingEngine<JournalState> = {
  actions: journalActions,
  header: (state) => journalHeader(state.context),
  activate: (state, actionId) => ({ state, exit: actionId === JOURNAL_LEAVE_ACTION_ID }),
};
