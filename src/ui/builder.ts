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
    const result = attemptConfirm(state, context);
    if (result.ok) {
      return { state: createBuilderState(), confirmed: result.confirmed };
    }
    return { state: { ...state, message: summarizeViolations(result.violations) }, confirmed: null };
  }

  if (DIGIT_RE.test(key)) {
    return { state: clampSelected(applyDigit(state, Number.parseInt(key, 10))), confirmed: null };
  }

  if (key.length === 1) {
    return { state: clampSelected(applyChar(state, key)), confirmed: null };
  }

  return { state, confirmed: null };
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

function buildBuilderDom(state: BuilderState, context: BuilderContext): HTMLElement {
  const root = document.createElement('div');
  root.className = 'sm-builder';

  // --- left pane -----------------------------------------------------------
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

    const label = document.createElement('span');
    label.className = 'sm-builder__row-label';
    label.textContent = row.label;
    li.appendChild(label);

    const value = document.createElement('span');
    value.className = 'sm-builder__row-value';
    value.textContent = row.valueLabel;
    li.appendChild(value);

    list.appendChild(li);
  });
  left.appendChild(list);

  const hint = document.createElement('div');
  hint.className = 'sm-builder__hint';
  hint.textContent = '↑↓ select row · ←→ change · 0-9 type value · Enter confirm';
  left.appendChild(hint);

  root.appendChild(left);

  // --- right pane ------------------------------------------------------------
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

  const legality = document.createElement('div');
  legality.className = 'sm-builder__legality';
  const title = document.createElement('h3');
  title.className = 'sm-builder__legality-title';
  title.textContent = 'Legality';
  legality.appendChild(title);

  if (derived.violations.length === 0) {
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

  root.appendChild(right);
  return root;
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

  function render(): void {
    options.container.innerHTML = '';
    options.container.appendChild(buildBuilderDom(state, context));
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
    render();
  }

  options.container.tabIndex = 0;
  options.container.classList.add('sm-builder-root');
  options.container.addEventListener('keydown', onKeyDown);
  render();
  options.container.focus();

  return {
    setContext(nextContext: BuilderContext): void {
      context = nextContext;
      render();
    },
    destroy(): void {
      options.container.removeEventListener('keydown', onKeyDown);
      options.container.innerHTML = '';
      options.container.classList.remove('sm-builder-root');
      options.container.removeAttribute('tabindex');
    },
  };
}
