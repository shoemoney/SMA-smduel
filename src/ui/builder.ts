/**
 * Vehicle constructor UI: a two-pane, fully keyboard-operable builder.
 *
 * Left pane lists component rows (name, body, chassis, suspension, plant,
 * tires, each armor facing, each weapon mount with facing + ammo). Right
 * pane shows the live-computed build (cost/weight/spaces/speed/accel/
 * handling/armor/battery) plus a legality panel.
 *
 * Every number shown here comes from `computeBuild`/`validateDesign`
 * (`@/sim/construct`) or the ruleset tables via `@/data/rulesets` — this
 * module never recomputes build math itself.
 *
 * The module is split into a pure state/reducer core (`createBuilderState`,
 * `computeRows`, `handleKey`, `computeDerived`, `attemptConfirm`) that is
 * fully unit-testable without a DOM, and a thin DOM layer (`mountBuilder`)
 * that wires that core to `builder.css` classes and keyboard events.
 */
import { allBodies, allChassis, allPlants, allSuspensions, allTires, allWeapons, economy, getBody, getChassis, getPlant, getSuspension, getTire, getWeapon, skillsConfig } from '@/data/rulesets';
import { computeBuild, validateDesign, type BuildDesign } from '@/sim/construct';
import { drivingConfig } from '@/data/rulesets';
import { FACINGS, makeArmorRecord, sumArmor } from '@/sim/types';
import type { BuildMetrics, BuildViolation, Facing, MountedWeapon, VehicleDesign, WeaponDef } from '@/sim/types';
// The builder's fixed mount-row count is a UI layout constant, not a
// legality rule (see `@/sim/construct`'s file header) — its one definition
// lives in `@/ui/hud`, which this module already sits alongside.
import { MAX_WEAPON_ROWS as MAX_WEAPON_SLOTS } from '@/ui/hud';
import { buildVehiclePreview } from '@/ui/builder-preview';
import { t } from '@/ui/strings';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface BuilderState {
  readonly name: string;
  readonly bodyId: string;
  readonly chassisId: string;
  readonly suspensionId: string;
  readonly plantId: string;
  readonly tireId: string;
  readonly armor: Record<Facing, number>;
  /** Fixed-length (MAX_WEAPON_SLOTS) positional slots; null = empty mount. */
  readonly weaponSlots: readonly (MountedWeapon | null)[];
  readonly selectedIndex: number;
  /** Digit buffer for the row currently being typed into (armor/ammo only). Reset on navigation. */
  readonly editBuffer: string | null;
  /** Last user-facing message (e.g. a failed confirm attempt). */
  readonly message: string | null;
}

/** Everything the builder needs from the wider game/fleet that it does not own. */
export interface BuilderContext {
  readonly cash: number;
  readonly existingCarNames: readonly string[];
  readonly ownedCarCount: number;
}

export interface BuilderConfirmedBuild {
  readonly design: VehicleDesign;
  readonly costTotal: number;
  readonly daysCost: number;
}

export interface BuilderKeyResult {
  readonly state: BuilderState;
  readonly confirmed: BuilderConfirmedBuild | null;
}

const INVALID_DISPLAY = '?????';

/**
 * True when the player has not yet made any choice at all: no name, no armour
 * fitted, no weapons mounted.
 *
 * This drives PRESENTATION only — see the legality panel's own note. The rule
 * that a car must be named is unchanged and still enforced by
 * `computeViolations`; this exists so the screen can say "here is what to do"
 * instead of opening on a red failure the player did not cause.
 */
function isPristineBuilder(state: BuilderState): boolean {
  if (state.name.trim().length > 0) return false;
  if (state.weaponSlots.some((slot) => slot !== null)) return false;
  return Object.values(state.armor).every((points) => points === 0);
}

function firstId<T extends { id: string }>(rows: readonly T[], table: string): string {
  const first = rows[0];
  if (first === undefined) throw new Error(`ruleset table "${table}" must not be empty`);
  return first.id;
}

export function createBuilderState(): BuilderState {
  return {
    name: '',
    bodyId: firstId(allBodies(), 'bodies'),
    chassisId: firstId(allChassis(), 'chassis'),
    suspensionId: firstId(allSuspensions(), 'suspension'),
    plantId: firstId(allPlants(), 'plants'),
    tireId: firstId(allTires(), 'tires'),
    armor: makeArmorRecord(0),
    weaponSlots: new Array<MountedWeapon | null>(MAX_WEAPON_SLOTS).fill(null),
    selectedIndex: 0,
    editBuffer: null,
    message: null,
  };
}

export function toDesign(state: BuilderState): VehicleDesign {
  const weapons: MountedWeapon[] = [];
  for (const mounted of state.weaponSlots) {
    if (mounted !== null) weapons.push(mounted);
  }
  return {
    name: state.name,
    bodyId: state.bodyId,
    chassisId: state.chassisId,
    suspensionId: state.suspensionId,
    plantId: state.plantId,
    tireId: state.tireId,
    armor: state.armor,
    weapons,
  };
}

function toBuildDesign(state: BuilderState): BuildDesign {
  return toDesign(state);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type BuilderRow =
  | { readonly kind: 'name'; readonly label: string; readonly valueLabel: string }
  | { readonly kind: 'body'; readonly label: string; readonly valueLabel: string }
  | { readonly kind: 'chassis'; readonly label: string; readonly valueLabel: string }
  | { readonly kind: 'suspension'; readonly label: string; readonly valueLabel: string }
  | { readonly kind: 'plant'; readonly label: string; readonly valueLabel: string }
  | { readonly kind: 'tire'; readonly label: string; readonly valueLabel: string }
  | { readonly kind: 'armor'; readonly label: string; readonly valueLabel: string; readonly facing: Facing }
  | { readonly kind: 'weapon'; readonly label: string; readonly valueLabel: string; readonly slot: number }
  | { readonly kind: 'facing'; readonly label: string; readonly valueLabel: string; readonly slot: number }
  | { readonly kind: 'ammo'; readonly label: string; readonly valueLabel: string; readonly slot: number }
  | { readonly kind: 'confirm'; readonly label: string; readonly valueLabel: string };

function titleCase(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

export function computeRows(state: BuilderState): BuilderRow[] {
  const rows: BuilderRow[] = [];

  rows.push({ kind: 'name', label: 'Name', valueLabel: state.name.length > 0 ? state.name : '(unnamed)' });
  rows.push({ kind: 'body', label: 'Body', valueLabel: getBody(state.bodyId).name });
  rows.push({ kind: 'chassis', label: 'Chassis', valueLabel: getChassis(state.chassisId).name });
  rows.push({ kind: 'suspension', label: 'Suspension', valueLabel: getSuspension(state.suspensionId).name });
  rows.push({ kind: 'plant', label: 'Power Plant', valueLabel: getPlant(state.plantId).name });
  rows.push({ kind: 'tire', label: 'Tires', valueLabel: getTire(state.tireId).name });

  for (const facing of FACINGS) {
    rows.push({ kind: 'armor', label: `Armor: ${titleCase(facing)}`, valueLabel: String(state.armor[facing]), facing });
  }

  state.weaponSlots.forEach((mounted, slot) => {
    if (mounted === null) {
      rows.push({ kind: 'weapon', label: `Weapon ${slot + 1}`, valueLabel: '(empty)', slot });
      return;
    }
    const def = getWeapon(mounted.weaponId);
    rows.push({ kind: 'weapon', label: `Weapon ${slot + 1}`, valueLabel: def.name, slot });
    rows.push({ kind: 'facing', label: 'Facing', valueLabel: mounted.facing, slot });
    rows.push({ kind: 'ammo', label: 'Ammo', valueLabel: `${mounted.ammo} / ${def.ammoCapacity}`, slot });
  });

  rows.push({ kind: 'confirm', label: 'Confirm', valueLabel: 'Build this vehicle' });
  return rows;
}

function selectedRow(state: BuilderState): BuilderRow | undefined {
  return computeRows(state)[state.selectedIndex];
}

// ---------------------------------------------------------------------------
// Option cycling helpers
// ---------------------------------------------------------------------------

function cycleListId(ids: readonly string[], current: string, dir: number): string {
  const idx = ids.indexOf(current);
  const base = idx < 0 ? 0 : idx;
  const next = Math.min(ids.length - 1, Math.max(0, base + dir));
  return ids[next] ?? current;
}

function weaponChoiceIds(): (string | null)[] {
  return [null, ...allWeapons().map((w) => w.id)];
}

function cycleWeaponChoice(current: string | null, dir: number): string | null {
  const choices = weaponChoiceIds();
  const idx = choices.findIndex((c) => c === current);
  const base = idx < 0 ? 0 : idx;
  const next = Math.min(choices.length - 1, Math.max(0, base + dir));
  return choices[next] ?? null;
}

function cycleFacingChoice(def: WeaponDef, current: Facing, dir: number): Facing {
  const choices = def.allowedFacings;
  const idx = choices.indexOf(current);
  const base = idx < 0 ? 0 : idx;
  const next = Math.min(choices.length - 1, Math.max(0, base + dir));
  return choices[next] ?? current;
}

function firstAllowedFacing(def: WeaponDef): Facing {
  const facing = def.allowedFacings[0];
  if (facing === undefined) throw new Error(`weapon "${def.id}" has no allowed facings`);
  return facing;
}

function replaceSlot(
  slots: readonly (MountedWeapon | null)[],
  slot: number,
  value: MountedWeapon | null,
): (MountedWeapon | null)[] {
  const next = [...slots];
  next[slot] = value;
  return next;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function applyMove(state: BuilderState, dir: -1 | 1): BuilderState {
  const rows = computeRows(state);
  const maxIndex = Math.max(0, rows.length - 1);
  const nextIndex = Math.min(maxIndex, Math.max(0, state.selectedIndex + dir));
  if (nextIndex === state.selectedIndex) return state;
  return { ...state, selectedIndex: nextIndex, editBuffer: null };
}

function applyCycle(state: BuilderState, dir: -1 | 1): BuilderState {
  const row = selectedRow(state);
  if (row === undefined) return state;

  switch (row.kind) {
    case 'body':
      return { ...state, bodyId: cycleListId(allBodies().map((b) => b.id), state.bodyId, dir), editBuffer: null };
    case 'chassis':
      return { ...state, chassisId: cycleListId(allChassis().map((c) => c.id), state.chassisId, dir), editBuffer: null };
    case 'suspension':
      return {
        ...state,
        suspensionId: cycleListId(allSuspensions().map((s) => s.id), state.suspensionId, dir),
        editBuffer: null,
      };
    case 'plant':
      return { ...state, plantId: cycleListId(allPlants().map((p) => p.id), state.plantId, dir), editBuffer: null };
    case 'tire':
      return { ...state, tireId: cycleListId(allTires().map((t) => t.id), state.tireId, dir), editBuffer: null };
    case 'armor': {
      const current = state.armor[row.facing];
      const next = Math.max(0, current + dir);
      return { ...state, armor: { ...state.armor, [row.facing]: next }, editBuffer: null };
    }
    case 'weapon': {
      const current = state.weaponSlots[row.slot] ?? null;
      const nextWeaponId = cycleWeaponChoice(current === null ? null : current.weaponId, dir);
      const nextValue: MountedWeapon | null =
        nextWeaponId === null
          ? null
          : { weaponId: nextWeaponId, facing: firstAllowedFacing(getWeapon(nextWeaponId)), ammo: 0 };
      return { ...state, weaponSlots: replaceSlot(state.weaponSlots, row.slot, nextValue), editBuffer: null };
    }
    case 'facing': {
      const mounted = state.weaponSlots[row.slot] ?? null;
      if (mounted === null) return state;
      const def = getWeapon(mounted.weaponId);
      const nextFacing = cycleFacingChoice(def, mounted.facing, dir);
      return {
        ...state,
        weaponSlots: replaceSlot(state.weaponSlots, row.slot, { ...mounted, facing: nextFacing }),
        editBuffer: null,
      };
    }
    case 'ammo': {
      const mounted = state.weaponSlots[row.slot] ?? null;
      if (mounted === null) return state;
      const def = getWeapon(mounted.weaponId);
      const next = Math.min(def.ammoCapacity, Math.max(0, mounted.ammo + dir));
      return {
        ...state,
        weaponSlots: replaceSlot(state.weaponSlots, row.slot, { ...mounted, ammo: next }),
        editBuffer: null,
      };
    }
    default:
      return state;
  }
}

/**
 * Upper bound for a single armor facing's point value, derived entirely from
 * the current body's own ruleset numbers (never a literal in this file): a
 * facing can never sanely carry more armor weight than the body's whole
 * carrying capacity, so that capacity divided by the per-point weight cost is
 * the ceiling. This keeps the digit buffer (below) from ever producing a
 * value outside `Number.isSafeInteger` range or a scientific-notation cost.
 */
function maxArmorPointsFor(state: BuilderState): number {
  const body = getBody(state.bodyId);
  if (body.armorWeightPerPoint <= 0) return body.baseMaxLoadLb;
  return Math.floor(body.baseMaxLoadLb / body.armorWeightPerPoint);
}

function applyDigit(state: BuilderState, digit: number): BuilderState {
  const row = selectedRow(state);
  if (row === undefined) return state;

  if (row.kind === 'name') {
    return { ...state, name: state.name + String(digit), editBuffer: null };
  }

  if (row.kind === 'armor') {
    const cap = maxArmorPointsFor(state);
    const buffer = (state.editBuffer ?? '') + String(digit);
    const parsed = Number.parseInt(buffer, 10);
    const value = Number.isFinite(parsed) ? Math.min(cap, Math.max(0, parsed)) : 0;
    // Re-seed the buffer from the clamped value (not the raw, ever-growing
    // keystroke buffer) so mashing a digit past the cap can't accumulate an
    // unbounded string — the next keystroke starts from the capped number.
    return { ...state, armor: { ...state.armor, [row.facing]: value }, editBuffer: String(value) };
  }

  if (row.kind === 'ammo') {
    const mounted = state.weaponSlots[row.slot] ?? null;
    if (mounted === null) return state;
    const def = getWeapon(mounted.weaponId);
    const buffer = (state.editBuffer ?? '') + String(digit);
    const parsed = Number.parseInt(buffer, 10);
    const value = Number.isFinite(parsed) ? Math.min(def.ammoCapacity, Math.max(0, parsed)) : 0;
    return {
      ...state,
      weaponSlots: replaceSlot(state.weaponSlots, row.slot, { ...mounted, ammo: value }),
      editBuffer: buffer,
    };
  }

  return state;
}

function applyChar(state: BuilderState, char: string): BuilderState {
  const row = selectedRow(state);
  if (row === undefined || row.kind !== 'name') return state;
  return { ...state, name: state.name + char, editBuffer: null };
}

function applyBackspace(state: BuilderState): BuilderState {
  const row = selectedRow(state);
  if (row === undefined) return state;

  if (row.kind === 'name') {
    return { ...state, name: state.name.slice(0, -1) };
  }

  if (row.kind === 'armor') {
    const buffer = (state.editBuffer ?? String(state.armor[row.facing])).slice(0, -1);
    const parsed = buffer === '' ? 0 : Number.parseInt(buffer, 10);
    const value = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    return { ...state, armor: { ...state.armor, [row.facing]: value }, editBuffer: buffer };
  }

  if (row.kind === 'ammo') {
    const mounted = state.weaponSlots[row.slot] ?? null;
    if (mounted === null) return state;
    const def = getWeapon(mounted.weaponId);
    const buffer = (state.editBuffer ?? String(mounted.ammo)).slice(0, -1);
    const parsed = buffer === '' ? 0 : Number.parseInt(buffer, 10);
    const value = Number.isFinite(parsed) ? Math.min(def.ammoCapacity, Math.max(0, parsed)) : 0;
    return {
      ...state,
      weaponSlots: replaceSlot(state.weaponSlots, row.slot, { ...mounted, ammo: value }),
      editBuffer: buffer,
    };
  }

  return state;
}

function clampSelected(state: BuilderState): BuilderState {
  const rows = computeRows(state);
  const maxIndex = Math.max(0, rows.length - 1);
  if (state.selectedIndex > maxIndex) return { ...state, selectedIndex: maxIndex };
  if (state.selectedIndex < 0) return { ...state, selectedIndex: 0 };
  return state;
}

function summarizeViolations(violations: readonly BuildViolation[]): string {
  if (violations.length === 0) return '';
  const [first] = violations;
  const rest = violations.length - 1;
  const suffix = rest > 0 ? ` (+${rest} more)` : '';
  return `Cannot build: ${first?.message ?? 'design is illegal'}${suffix}`;
}

const DIGIT_RE = /^[0-9]$/;

/**
 * Attempts to confirm the build from `state` as-is: the ONE place
 * `attemptConfirm` turns into a `BuilderKeyResult`, so Enter-on-confirm and a
 * tap-on-confirm (`handleBuilderPointer` below) share this instead of each
 * carrying its own copy that could drift out of sync.
 */
function runConfirm(state: BuilderState, context: BuilderContext): BuilderKeyResult {
  const result = attemptConfirm(state, context);
  if (result.ok) {
    return { state: createBuilderState(), confirmed: result.confirmed };
  }
  return { state: { ...state, message: summarizeViolations(result.violations) }, confirmed: null };
}

/**
 * Maps one keyboard key (a `KeyboardEvent.key` string) to a state
 * transition. Pure — the same (state, key, context) triple always produces
 * the same result, so this is exercised directly by tests without any DOM.
 */
export function handleKey(state: BuilderState, key: string, context: BuilderContext): BuilderKeyResult {
  if (key === 'ArrowUp') return { state: clampSelected(applyMove(state, -1)), confirmed: null };
  if (key === 'ArrowDown') return { state: clampSelected(applyMove(state, 1)), confirmed: null };
  if (key === 'ArrowLeft') return { state: clampSelected(applyCycle(state, -1)), confirmed: null };
  if (key === 'ArrowRight') return { state: clampSelected(applyCycle(state, 1)), confirmed: null };
  if (key === 'Backspace') return { state: clampSelected(applyBackspace(state)), confirmed: null };

  if (key === 'Enter') {
    const row = selectedRow(state);
    if (row === undefined || row.kind !== 'confirm') return { state, confirmed: null };
    return runConfirm(state, context);
  }

  if (DIGIT_RE.test(key)) {
    return { state: clampSelected(applyDigit(state, Number.parseInt(key, 10))), confirmed: null };
  }

  if (key.length === 1) {
    return { state: clampSelected(applyChar(state, key)), confirmed: null };
  }

  return { state, confirmed: null };
}

/**
 * The player tapped row `index`. A non-confirm row just gets selected (same
 * as an arrow key landing on it); the confirm row routes through the SAME
 * `runConfirm` an Enter keypress uses, so a tap and a keypress can never
 * disagree about whether a given build is legal.
 */
export function handleBuilderPointer(state: BuilderState, index: number, context: BuilderContext): BuilderKeyResult {
  const rows = computeRows(state);
  const row = rows[index];
  if (row === undefined) return { state, confirmed: null };
  const selected = clampSelected({ ...state, selectedIndex: index, editBuffer: null });
  if (row.kind !== 'confirm') return { state: selected, confirmed: null };
  return runConfirm(selected, context);
}

/**
 * The player tapped a cycle (-/+) button for row `index`. Selects that row
 * (mirroring what a tap on the row itself would do) and applies the SAME
 * `applyCycle` transition ArrowLeft/ArrowRight already use, so there is one
 * definition of "what changing this row's value means" for keyboard and
 * touch alike.
 */
export function handleBuilderCycle(state: BuilderState, index: number, dir: -1 | 1): BuilderState {
  const selected = clampSelected({ ...state, selectedIndex: index });
  return clampSelected(applyCycle(selected, dir));
}

/**
 * Sets the car name directly from a real `<input>`'s value (the touch path —
 * see `mountBuilder`'s name-row rendering for why a real input is needed at
 * all). Deliberately does NOT clamp or truncate: `computeViolations` already
 * reports `NAME_TOO_LONG` for an over-length name, and silently truncating
 * here would hide that state from the player instead of surfacing it.
 */
export function handleBuilderName(state: BuilderState, name: string): BuilderState {
  return { ...state, name, editBuffer: null };
}

// ---------------------------------------------------------------------------
// Legality / derived view
// ---------------------------------------------------------------------------

/**
 * Every reason Confirm would currently be blocked: the design's own physical
 * legality (from `validateDesign`, which already folds in the cash check)
 * plus this UI's own name and fleet-size rules. When the name is valid and
 * unique and the fleet has room, this returns exactly `validateDesign(...)`.
 */
export function computeViolations(state: BuilderState, context: BuilderContext): BuildViolation[] {
  const design = toBuildDesign(state);
  const violations = validateDesign(design, context.cash);

  const nameMax = skillsConfig().driver.nameMaxLength;
  // Leading/trailing whitespace is never part of the *meaningful* name: a
  // trailing-space "Roadhog " must collide with "Roadhog", and "   " must
  // count as no name at all, or a car can enter the fleet indistinguishable
  // from (or literally invisible next to) another.
  const trimmedName = state.name.trim();

  if (trimmedName.length === 0) {
    violations.push({ code: 'NAME_EMPTY', message: 'car name is required' });
  } else if (trimmedName.length > nameMax) {
    violations.push({
      code: 'NAME_TOO_LONG',
      message: `name is ${trimmedName.length} characters, over the ${nameMax}-character limit`,
    });
  }

  if (trimmedName.length > 0) {
    const lower = trimmedName.toLowerCase();
    const duplicate = context.existingCarNames.some((existing) => existing.trim().toLowerCase() === lower);
    if (duplicate) {
      violations.push({ code: 'NAME_DUPLICATE', message: `"${trimmedName}" is already in your fleet` });
    }
  }

  const maxFleet = economy().maxFleetSize;
  if (context.ownedCarCount >= maxFleet) {
    violations.push({
      code: 'FLEET_FULL',
      message: `fleet already has ${context.ownedCarCount} cars (max ${maxFleet})`,
    });
  }

  return violations;
}

export interface BuilderDerivedView {
  readonly metrics: BuildMetrics;
  readonly physicallyLegal: boolean;
  readonly costDisplay: string;
  readonly weightDisplay: string;
  readonly spacesDisplay: string;
  readonly topSpeedDisplay: string;
  readonly accelDisplay: string;
  readonly handlingDisplay: string;
  readonly armorTotalDisplay: string;
  readonly battery: number;
  readonly violations: readonly BuildViolation[];
  readonly canConfirm: boolean;
}

/**
 * Everything the right pane renders. Numeric fields that depend on a
 * physically illegal design (missing component, over weight/space/slots,
 * illegal facing, ammo over capacity, negative armor, underpowered) render
 * as '?????' instead of a technically-computed-but-meaningless number.
 * Cost still shows a real number even when over budget — that figure is
 * correct, it's just unaffordable, which the legality panel says plainly.
 */
export function computeDerived(state: BuilderState, context: BuilderContext): BuilderDerivedView {
  const design = toBuildDesign(state);
  const metrics = computeBuild(design);
  const violations = computeViolations(state, context);
  const physicallyLegal = metrics.legal;

  const fmt = (value: number): string => (physicallyLegal ? String(value) : INVALID_DISPLAY);

  return {
    metrics,
    physicallyLegal,
    costDisplay: `$${metrics.costTotal}`,
    weightDisplay: physicallyLegal ? `${metrics.weightTotal} / ${metrics.maxLoadLb} lb` : INVALID_DISPLAY,
    spacesDisplay: physicallyLegal ? `${metrics.spacesUsed} / ${metrics.spacesTotal}` : INVALID_DISPLAY,
    topSpeedDisplay: fmt(metrics.topSpeedMph),
    accelDisplay: metrics.accelMphPerSec === null ? INVALID_DISPLAY : `${metrics.accelMphPerSec} mph/s`,
    handlingDisplay: fmt(metrics.handlingClass),
    armorTotalDisplay: String(sumArmor(state.armor)),
    battery: drivingConfig().battery.full,
    violations,
    canConfirm: violations.length === 0,
  };
}

export type BuilderConfirmResult =
  | { readonly ok: true; readonly confirmed: BuilderConfirmedBuild }
  | { readonly ok: false; readonly violations: BuildViolation[] };

/**
 * Attempts the purchase. On success the caller (owner of fleet/cash/calendar
 * state) is responsible for deducting `costTotal`, spending `daysCost` days,
 * making this the active vehicle, and returning to the city — none of that
 * is this module's state to own.
 */
export function attemptConfirm(state: BuilderState, context: BuilderContext): BuilderConfirmResult {
  const violations = computeViolations(state, context);
  if (violations.length > 0) return { ok: false, violations };

  const design = toBuildDesign(state);
  const metrics = computeBuild(design);
  return {
    ok: true,
    confirmed: {
      design,
      costTotal: metrics.costTotal,
      daysCost: economy().timeCostDays.buildCar,
    },
  };
}

// ---------------------------------------------------------------------------
// DOM layer
// ---------------------------------------------------------------------------

export interface BuilderMountOptions {
  readonly container: HTMLElement;
  readonly context: BuilderContext;
  readonly onBuilt: (confirmed: BuilderConfirmedBuild) => void;
  readonly onCancel: () => void;
}

export interface MountedBuilder {
  setContext(context: BuilderContext): void;
  destroy(): void;
}

function statRow(list: HTMLElement, label: string, value: string, invalid: boolean): void {
  const row = document.createElement('div');
  row.className = 'sm-builder__stat';
  const dt = document.createElement('span');
  dt.className = 'sm-builder__stat-label';
  dt.textContent = label;
  const dd = document.createElement('span');
  dd.className = invalid ? 'sm-builder__stat-value sm-builder__stat-value--invalid' : 'sm-builder__stat-value';
  dd.textContent = value;
  row.appendChild(dt);
  row.appendChild(dd);
  list.appendChild(row);
}

/** Row kinds `applyCycle` (above) actually has a case for — everything but the free-text name row and the terminal confirm row. */
function rowHasCycle(kind: BuilderRow['kind']): boolean {
  return kind !== 'name' && kind !== 'confirm';
}

interface BuilderRowHandlers {
  readonly onRowActivate: (index: number) => void;
  readonly onRowCycle: (index: number, dir: -1 | 1) => void;
  readonly onNameInput: (value: string) => void;
  readonly onNameSubmit: () => void;
}

/**
 * Left pane: the row list plus the hint line. Rebuilt wholesale on every
 * state change EXCEPT typing into the name input — see `mountBuilder`'s
 * `refreshRightPane`, and the name-row `keydown` listener below, for why that
 * one path is deliberately kept away from a full rebuild of this pane.
 */
function buildLeftPane(state: BuilderState, handlers: BuilderRowHandlers): HTMLElement {
  const left = document.createElement('div');
  left.className = 'sm-builder__pane sm-builder__pane--left';

  const rows = computeRows(state);
  const list = document.createElement('ol');
  list.className = 'sm-builder__rows';
  rows.forEach((row, index) => {
    const li = document.createElement('li');
    li.className = `sm-builder__row sm-builder__row--${row.kind}`;
    if (row.kind === 'facing' || row.kind === 'ammo') li.classList.add('sm-builder__row--sub');
    if (index === state.selectedIndex) li.classList.add('sm-builder__row--selected');
    // Per-row closures over `index`, not a delegated container listener and
    // not `dataset`/`closest` lookups: the unit-test fake DOM harness (see
    // tests/unit/builder.test.ts) implements neither.
    li.setAttribute('role', 'button');
    if (index === state.selectedIndex) li.setAttribute('aria-selected', 'true');
    li.addEventListener('click', () => handlers.onRowActivate(index));

    const label = document.createElement('span');
    label.className = 'sm-builder__row-label';
    label.textContent = row.label;
    li.appendChild(label);

    if (row.kind === 'name') {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sm-builder__row-input';
      input.maxLength = skillsConfig().driver.nameMaxLength;
      input.value = state.name;
      input.setAttribute('aria-label', 'Car name');
      // A real, focusable input is the whole fix (see this file's header):
      // it's what lets a phone's on-screen keyboard open at all. Its own
      // `keydown` must not bubble up to the container's listener below —
      // that listener calls `preventDefault()` on every key AND re-renders
      // via `handleKey`, which would fight the input's native editing and,
      // through `onKeyDown`'s full re-render, destroy and recreate this very
      // input mid-keystroke (the focus/caret bug this task exists to avoid).
      //
      // Enter is the one exception, routed to `onSubmit` instead of
      // `handleKey`'s own Enter branch: that branch only confirms when the
      // SELECTED row is 'confirm', so a player who typed a name and hit
      // Enter without first arrowing down to Confirm got silently ignored.
      // `onSubmit` runs the identical `runConfirm` the Confirm row and a tap
      // on it already share, so Enter-from-the-name-field can never legalize
      // (or refuse) a build differently than Confirm itself would.
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          handlers.onNameSubmit();
          return;
        }
        ev.stopPropagation();
      });
      input.addEventListener('input', () => handlers.onNameInput(input.value));
      li.appendChild(input);
    } else {
      const value = document.createElement('span');
      value.className = 'sm-builder__row-value';
      value.textContent = row.valueLabel;
      li.appendChild(value);
    }

    if (rowHasCycle(row.kind)) {
      const controls = document.createElement('span');
      controls.className = 'sm-builder__row-controls';
      const dec = document.createElement('button');
      dec.type = 'button';
      dec.className = 'sm-builder__row-cycle sm-builder__row-cycle--dec';
      dec.setAttribute('aria-label', `${row.label} decrease`);
      dec.addEventListener('click', (ev) => {
        ev.stopPropagation(); // don't also let the row-select click above fire
        handlers.onRowCycle(index, -1);
      });
      const inc = document.createElement('button');
      inc.type = 'button';
      inc.className = 'sm-builder__row-cycle sm-builder__row-cycle--inc';
      inc.setAttribute('aria-label', `${row.label} increase`);
      inc.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handlers.onRowCycle(index, 1);
      });
      controls.appendChild(dec);
      controls.appendChild(inc);
      li.appendChild(controls);
    }

    list.appendChild(li);
  });
  left.appendChild(list);

  // Keyboard-only hint: a phone player has none of ↑↓←→/0-9/Enter, and there
  // is no in-scope way to say so instead — every route (a new bare literal,
  // routing through `t()`) needs a matching entry in either
  // tests/unit/strings.test.ts's allowlist or rulesets/classic/strings.json,
  // and this task owns neither file (see YOUR FILES in the task brief).
  // `builder.css`'s `@media (pointer: coarse)` block hides this line
  // entirely on a touch device instead of leaving it up and wrong.
  const hint = document.createElement('div');
  hint.className = 'sm-builder__hint';
  hint.textContent = '↑↓ select row · ←→ change · 0-9 type value · Enter confirm';
  left.appendChild(hint);

  return left;
}

/**
 * Right pane: derived stats, legality panel, message. Rebuilt on its own by
 * `mountBuilder.refreshRightPane` while the player types a name, so this
 * function must not assume it's being appended into a fresh root — it just
 * returns the pane element and lets the caller decide where it goes.
 */
function buildRightPane(state: BuilderState, context: BuilderContext): HTMLElement {
  const right = document.createElement('div');
  right.className = 'sm-builder__pane sm-builder__pane--right';

  const derived = computeDerived(state, context);
  const stats = document.createElement('div');
  stats.className = 'sm-builder__stats';
  statRow(stats, 'Cost', derived.costDisplay, false);
  statRow(stats, 'Weight', derived.weightDisplay, !derived.physicallyLegal);
  statRow(stats, 'Spaces', derived.spacesDisplay, !derived.physicallyLegal);
  statRow(stats, 'Top Speed', derived.topSpeedDisplay, !derived.physicallyLegal);
  statRow(stats, 'Acceleration', derived.accelDisplay, derived.metrics.accelMphPerSec === null);
  statRow(stats, 'Handling Class', derived.handlingDisplay, !derived.physicallyLegal);
  statRow(stats, 'Armor Total', derived.armorTotalDisplay, false);
  statRow(stats, 'Battery', `${derived.battery} / ${derived.battery}`, false);
  right.appendChild(stats);

  // The live schematic. Appended before the legality panel so the pane reads
  // top-to-bottom as "what it costs -> what it looks like -> what is wrong
  // with it", and so the preview sits in the space that used to be empty
  // black below the two columns.
  right.appendChild(buildVehiclePreview(document, state));

  const legality = document.createElement('div');
  legality.className = 'sm-builder__legality';
  const title = document.createElement('h3');
  title.className = 'sm-builder__legality-title';
  title.textContent = 'Legality';
  legality.appendChild(title);

  // An untouched builder is not a FAILED builder.
  //
  // Requiring a car name is deliberate and tested — `canConfirm` is false until
  // one is typed, and that must not change. But the screen used to render that
  // requirement as a red VIOLATION panel the instant it opened, before the
  // player had touched anything, so the first thing anyone saw was a failure
  // state and the screen read as broken rather than as unfinished. A review of
  // the real frame flagged it, and it is a fair reading: nothing in that red
  // box was a mistake anyone had made.
  //
  // The violations themselves are untouched and still computed — this only
  // changes how a PRISTINE state is PRESENTED. Once the player has entered a
  // name, or moved a single slider, the panel switches to the normal violation
  // list and starts behaving like a real feedback surface.
  if (isPristineBuilder(state)) {
    const prompt = document.createElement('div');
    prompt.className = 'sm-builder__legality-prompt';
    const promptText = document.createElement('strong');
    promptText.textContent = t('ui.builder.legalityPrompt');
    prompt.appendChild(promptText);
    // The steps, because "something is required" is a worse onboarding message
    // than "do these three things" — a review of the real frame said a new
    // player "may not know to add weapons/armor", and the fix is to say so.
    const steps = document.createElement('ol');
    for (const key of ['ui.builder.legalityStepName', 'ui.builder.legalityStepArmor', 'ui.builder.legalityStepWeapon'] as const) {
      // The text is set BEFORE appending rather than off appendChild's return
      // value: the real DOM returns the appended node, but the builder's test
      // double returns void, so relying on it is a difference between the
      // double and the browser that only shows up as a confusing
      // "Cannot set properties of undefined".
      const item = document.createElement('li');
      item.textContent = t(key);
      steps.appendChild(item);
    }
    prompt.appendChild(steps);
    legality.appendChild(prompt);
  } else if (derived.violations.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'sm-builder__violation sm-builder__violation--none';
    ok.textContent = 'No violations — ready to build.';
    legality.appendChild(ok);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'sm-builder__violation-list';
    for (const violation of derived.violations) {
      const li = document.createElement('li');
      li.className = 'sm-builder__violation';
      li.textContent = violation.message;
      ul.appendChild(li);
    }
    legality.appendChild(ul);
  }
  right.appendChild(legality);

  if (state.message !== null) {
    const message = document.createElement('div');
    message.className = 'sm-builder__message';
    message.textContent = state.message;
    right.appendChild(message);
  }

  return right;
}

/**
 * Wires the pure reducer above to a container element: renders the two
 * panes, listens for keydown on the container, and calls `onBuilt` /
 * `onCancel` on Confirm / Escape. All build math still flows through
 * `computeBuild`/`validateDesign` via the pure helpers above.
 */
export function mountBuilder(options: BuilderMountOptions): MountedBuilder {
  let state = createBuilderState();
  let context = options.context;
  let rootEl: HTMLElement | null = null;
  let rightPaneEl: HTMLElement | null = null;

  function fullRender(): void {
    options.container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'sm-builder';
    root.appendChild(buildLeftPane(state, { onRowActivate, onRowCycle, onNameInput, onNameSubmit }));
    rightPaneEl = buildRightPane(state, context);
    root.appendChild(rightPaneEl);
    options.container.appendChild(root);
    rootEl = root;
  }

  /**
   * The name-input's `input` event path ONLY. Swaps the right pane (derived
   * stats + legality, including the "car name is required" message) without
   * touching the left pane at all — a full `fullRender()` here would destroy
   * and recreate the very `<input>` the player is mid-keystroke in, losing
   * focus and caret after one character (this is the regression the touch
   * fix exists to close; see `buildLeftPane`'s name-row comment).
   */
  function refreshRightPane(): void {
    if (rootEl === null || rightPaneEl === null) {
      fullRender();
      return;
    }
    const nextRight = buildRightPane(state, context);
    rootEl.replaceChild(nextRight, rightPaneEl);
    rightPaneEl = nextRight;
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      options.onCancel();
      return;
    }
    const result = handleKey(state, ev.key, context);
    state = result.state;
    ev.preventDefault();
    if (result.confirmed !== null) {
      // A confirm hands control back to the host (spend cash, add the car,
      // navigate away) — it owns `options.container` from here, so we must
      // not re-render over whatever screen it just put there.
      options.onBuilt(result.confirmed);
      return;
    }
    fullRender();
  }

  function onRowActivate(index: number): void {
    const result = handleBuilderPointer(state, index, context);
    state = result.state;
    // Same "don't re-render over the host's own callback" discipline as
    // onKeyDown above.
    if (result.confirmed !== null) {
      options.onBuilt(result.confirmed);
      return;
    }
    fullRender();
  }

  function onRowCycle(index: number, dir: -1 | 1): void {
    state = handleBuilderCycle(state, index, dir);
    fullRender();
  }

  function onNameInput(value: string): void {
    state = handleBuilderName(state, value);
    refreshRightPane();
  }

  /**
   * Enter pressed inside the name `<input>` — routed here instead of through
   * `handleKey`'s Enter branch because that branch only fires on the
   * SELECTED row, and the name row is selected while the player is typing
   * into it, not the confirm row. Shares `runConfirm` with the Confirm row
   * (Enter-on-selection) and a tap on it, so all three agree on what "submit
   * this build" means. A failed confirm only swaps the right pane (message),
   * matching `onNameInput`'s no-full-rebuild discipline so the player keeps
   * focus/caret in the field to fix the name and try again.
   */
  function onNameSubmit(): void {
    const result = runConfirm(state, context);
    state = result.state;
    if (result.confirmed !== null) {
      options.onBuilt(result.confirmed);
      return;
    }
    refreshRightPane();
  }

  options.container.tabIndex = 0;
  options.container.classList.add('sm-builder-root');
  options.container.addEventListener('keydown', onKeyDown);
  fullRender();
  options.container.focus();

  return {
    setContext(nextContext: BuilderContext): void {
      context = nextContext;
      fullRender();
    },
    destroy(): void {
      options.container.removeEventListener('keydown', onKeyDown);
      options.container.innerHTML = '';
      options.container.classList.remove('sm-builder-root');
      options.container.removeAttribute('tabindex');
      rootEl = null;
      rightPaneEl = null;
    },
  };
}
