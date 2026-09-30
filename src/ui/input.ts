/**
 * Control presets and rebinding (docs/SPEC.md "Controls"). Pure input
 * resolution: `resolveInput()` turns a buffered `RawInputState` snapshot
 * into the exact `InputFrame` `@/sim/loop` already defines — that type is
 * the output contract, not reinvented here. No DOM, no `Math.random()`,
 * no `Date.now()`, so it's testable with plain objects.
 *
 * Classic contract: ONE stick's direction is desired heading, its
 * magnitude is desired speed as a fraction of top speed (`@/sim/driving`
 * does the actual heading/speed integration — this module only produces
 * the vector it reads). Centering coasts; nothing here brakes or reverses,
 * that is `stepDriving`'s job once it sees a centered or opposed stick.
 *
 * Modern contract: the same direction+magnitude vector (the sim's fixed
 * input shape leaves no other way to drive), but its default bindings
 * put steering and throttle on physically separate controls (gamepad
 * triggers for throttle instead of sharing the left stick) rather than
 * changing the resolution math. Both presets run through the SAME
 * direction-combining code below — there is no separate "aim" concept
 * anywhere in this module or in `InputFrame` itself, which is what makes
 * "no preset can produce an aim direction independent of heading"
 * structurally true rather than merely tested-for: weapon facings are
 * fixed at construction (`@/sim/combat`) and this module never emits
 * anything resembling an aim vector, only the one drive vector.
 *
 * Every key/button default lives in `rulesets/classic/controls.json`,
 * AJV-validated by `@/data/schema`'s `validateControls` — nothing
 * gameplay-numeric (including the gamepad deadzone, the touch deadzone
 * and the on-screen stick's travel radius) is a literal here. The
 * on-screen stick's own action map (`TOUCH_AXIS_ACTIONS` below) IS fixed
 * in code, not data: an on-screen stick has no physical button to
 * reassign, so its geometry is its binding and there is nothing to
 * rebind.
 */
import {
  DRIVE_ACTION_IDS,
  validateControls,
  type ActionBindingDefaults,
  type ControlsConfig,
  type GamepadAxisBinding,
} from '@/data/schema';
import type { InputFrame } from '@/sim/loop';

import controlsJson from '@rulesets/classic/controls.json';

/** Validated once at module load, exactly like `@/data/rulesets`'s `RULESETS`. */
export const CONTROLS: ControlsConfig = validateControls(controlsJson);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PresetName = string;

/**
 * Throws when `preset` is not one of `CONTROLS.presets`, instead of the
 * historical silent failure: an unrecognized preset name (a typo, a stale
 * save, a caller that never validated it) used to fall through to `{}`
 * bindings and produce a permanently dead, all-zero `InputFrame` forever —
 * no throw, no log, the car just never responds. `PresetName` stays `string`
 * because presets are data loaded from `controls.json` at runtime, not a
 * compile-time literal union, so this is the only place that can actually
 * catch the typo.
 */
function assertKnownPreset(preset: string): void {
  if (!CONTROLS.presets.includes(preset)) {
    throw new Error(`Unknown control preset "${preset}" (expected one of: ${CONTROLS.presets.join(', ')})`);
  }
}

/** A single tick's buffered device state. Never read from the DOM inside resolveInput — a caller samples this once per frame, same discipline as `@/sim/loop`'s InputFrame. */
export interface RawInputState {
  /** Currently-held `KeyboardEvent.code` values, e.g. `'KeyW'`. */
  keysDown: ReadonlySet<string>;
  /** Currently-held mouse button indices (`MouseEvent.button`: 0 = left). */
  mouseButtonsDown: ReadonlySet<number>;
  /** Currently-held Standard Gamepad button indices. */
  gamepadButtonsDown: ReadonlySet<number>;
  /** Standard Gamepad axis readings, index-aligned (0 = left stick X, 1 = left stick Y, ...). Empty when no gamepad is connected. */
  gamepadAxes: readonly number[];
  /** On-screen thumbstick readings, index-aligned and using the SAME convention as `gamepadAxes` above so there is one analog-axis convention in this module: 0 = X (right positive), 1 = Y (screen-DOWN positive). Empty when no touch UI is mounted. */
  touchAxes: readonly number[];
  /** Action ids whose on-screen button is currently held. Unlike every other channel these are action ids, not device indices, because an on-screen button is LABELLED with what it does — there is no device-level number to map from, and nothing to rebind. */
  touchButtonsDown: ReadonlySet<string>;
}

export function emptyRawInputState(): RawInputState {
  return {
    keysDown: new Set(),
    mouseButtonsDown: new Set(),
    gamepadButtonsDown: new Set(),
    gamepadAxes: [],
    touchAxes: [],
    touchButtonsDown: new Set(),
  };
}

/** One preset's full action-id -> binding map. */
export type PresetBindings = Record<string, ActionBindingDefaults>;
/** Every preset's bindings, keyed by preset name — what a save would persist. */
export type AllBindings = Record<string, PresetBindings>;

/** What a rebind assigns an action to. Assigning ANY of these to an action REPLACES that action's whole binding list for that one device (see `rebind`) — the old input for that device stops working, by design. */
export type RebindTarget =
  | { device: 'keyboard'; code: string }
  | { device: 'mouse'; button: number }
  | { device: 'gamepad'; button: number }
  | { device: 'gamepadAxis'; index: number; sign: 1 | -1 };

// ---------------------------------------------------------------------------
// Bindings: defaults + rebinding
// ---------------------------------------------------------------------------

/** A fresh, independently-mutable copy of controls.json's shipped defaults for every preset — safe to hand to `rebind()` without aliasing the module-level `CONTROLS` singleton. */
export function defaultBindings(): AllBindings {
  return structuredClone(CONTROLS.defaultBindings);
}

/** This preset's slice of `bindings`, defaulting to controls.json's shipped map if the preset has no entry yet. Throws on an unknown preset name (see `assertKnownPreset`) rather than silently handing back `{}`. */
export function bindingsForPreset(bindings: AllBindings, preset: PresetName): PresetBindings {
  assertKnownPreset(preset);
  return bindings[preset] ?? CONTROLS.defaultBindings[preset] ?? {};
}

/**
 * Returns a NEW `AllBindings` with `actionId` (under `preset`) rebound to
 * `target`. Only the ONE device array `target` names is replaced —
 * wholesale, not appended to — so the action's other devices (e.g. its
 * gamepad binding, if `target` is a keyboard code) are untouched, but
 * every key/button previously bound to it on `target`'s device stops
 * working the instant this returns. Never mutates `bindings`.
 */
export function rebind(bindings: AllBindings, preset: PresetName, actionId: string, target: RebindTarget): AllBindings {
  const presetBindings = bindingsForPreset(bindings, preset);
  const current: ActionBindingDefaults = presetBindings[actionId] ?? { keyboard: [], mouse: [], gamepadButtons: [], gamepadAxes: [] };

  let nextAction: ActionBindingDefaults;
  switch (target.device) {
    case 'keyboard':
      nextAction = { ...current, keyboard: [target.code] };
      break;
    case 'mouse':
      nextAction = { ...current, mouse: [target.button] };
      break;
    case 'gamepad':
      nextAction = { ...current, gamepadButtons: [target.button] };
      break;
    case 'gamepadAxis':
      nextAction = { ...current, gamepadAxes: [{ index: target.index, sign: target.sign }] };
      break;
  }

  return {
    ...bindings,
    [preset]: { ...presetBindings, [actionId]: nextAction },
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** This one axis binding's contribution toward its action, in `[0, 1]`: 0 below the deadzone, otherwise the axis's own magnitude (clamped to 1) — NOT collapsed to a boolean. That magnitude is what carries the Classic single-stick contract's "speed as a fraction of top speed" (file header) all the way through to `@/sim/driving`, which reads it via `stick` length; collapsing it here would make every gamepad axis a 3-state (0/+1/-1) digital input no matter how far it's actually pushed. Takes the axis array explicitly (rather than reading `raw.gamepadAxes` itself) so the same function scores both `gamepadAxes` and `touchAxes` against their own threshold. */
function axisContribution(axes: readonly number[], axis: GamepadAxisBinding, axisThreshold: number): number {
  const value = axes[axis.index] ?? 0;
  if (axis.sign > 0) {
    return value >= axisThreshold ? Math.min(value, 1) : 0;
  }
  return value <= -axisThreshold ? Math.min(-value, 1) : 0;
}

/**
 * Which drive action each half of the on-screen stick feeds. Fixed, unlike
 * every map in `controls.json`, because an on-screen stick is not rebindable:
 * its geometry IS its binding, there is no physical button to reassign. Same
 * shape and same sign convention as classic's gamepad left-stick bindings, so
 * `axisContribution` above reads both channels with one rule.
 */
const TOUCH_AXIS_ACTIONS: readonly (readonly [actionId: string, axis: GamepadAxisBinding])[] = [
  ['driveLeft', { index: 0, sign: -1 }],
  ['driveRight', { index: 0, sign: 1 }],
  ['driveUp', { index: 1, sign: -1 }],
  ['driveDown', { index: 1, sign: 1 }],
];

/** How strongly `binding` is being held this tick, in `[0, 1]`. Digital devices (keyboard/mouse/gamepad buttons, and an on-screen button naming `actionId` directly) are all-or-nothing — pressed contributes exactly 1, matching keyboard's inherent lack of magnitude. A gamepad axis contributes its own analog magnitude via `axisContribution`, and the on-screen stick's half matching `actionId` (per `TOUCH_AXIS_ACTIONS`) is folded in the SAME way against its own `CONTROLS.touch.axisDeadzone`; when more than one analog source applies, the strongest wins — MAX, never a sum, so a held key plus a pushed stick never exceeds 1. */
function actionStrength(raw: RawInputState, actionId: string, binding: ActionBindingDefaults | undefined, axisThreshold: number): number {
  if (raw.touchButtonsDown.has(actionId)) return 1;
  if (binding !== undefined) {
    for (const code of binding.keyboard) if (raw.keysDown.has(code)) return 1;
    for (const button of binding.mouse) if (raw.mouseButtonsDown.has(button)) return 1;
    for (const button of binding.gamepadButtons) if (raw.gamepadButtonsDown.has(button)) return 1;
  }
  let strongest = 0;
  if (binding !== undefined) {
    for (const axis of binding.gamepadAxes) strongest = Math.max(strongest, axisContribution(raw.gamepadAxes, axis, axisThreshold));
  }
  for (const [touchActionId, axis] of TOUCH_AXIS_ACTIONS) {
    if (touchActionId !== actionId) continue;
    strongest = Math.max(strongest, axisContribution(raw.touchAxes, axis, CONTROLS.touch.axisDeadzone));
  }
  return strongest;
}

function isActionActive(raw: RawInputState, actionId: string, binding: ActionBindingDefaults | undefined, axisThreshold: number): boolean {
  return actionStrength(raw, actionId, binding, axisThreshold) > 0;
}

const DIRECT_SELECT_ORDER: readonly [actionId: string, slot: number][] = [
  ['weaponDirect1', 0],
  ['weaponDirect2', 1],
  ['weaponDirect3', 2],
  ['weaponDirect4', 3],
  ['weaponDirect5', 4],
  ['weaponDirect6', 5],
  ['weaponDirect7', 6],
  ['weaponDirect8', 7],
  ['weaponDirect9', 8],
  ['weaponDirect0', 9],
];

/**
 * Direct weapon-select only (docs/SPEC.md "1-0 direct select"): the first
 * held digit in 1,2,...,9,0 order maps to slot 0..9, absolute and
 * stateless. `null` means NO digit is held this tick, which is a different
 * fact from "slot 0 is asked for" — `resolveInput` below has to flatten the
 * two together to fill `InputFrame.weaponSlot`, so a caller that owns a
 * persistent active slot must read this directly rather than that flattened
 * field, or it can never tell "the player asked for mount 1" from "the
 * player asked for nothing".
 *
 * Cycling (`cyclePressed` below) inherently needs to know the PREVIOUS
 * tick's active slot to advance from, which a pure
 * `resolveInput(rawState, preset, bindings)` — deliberately given no
 * memory of earlier ticks, so it can't drift out of sync with whatever
 * else reads the same raw state — cannot supply; that persistent slot is
 * the caller's state to own (see `@/app.ts`'s `makeWeaponSelection`, the
 * one writer of it, which drives BOTH this and `cyclePressed`).
 */
export function directWeaponSlot(raw: RawInputState, preset: PresetName, bindings: AllBindings): number | null {
  const presetBindings = bindingsForPreset(bindings, preset);
  const axisThreshold = CONTROLS.gamepadAxisThreshold;
  for (const [actionId, slot] of DIRECT_SELECT_ORDER) {
    if (isActionActive(raw, actionId, presetBindings[actionId], axisThreshold)) return slot;
  }
  return null;
}

/** Whether cycle-next / cycle-prev are held this tick. Edge-detection and slot bookkeeping are the caller's job (see `directWeaponSlot`'s doc) — this only reports the raw, current, rebindable button state. */
export function cyclePressed(raw: RawInputState, preset: PresetName, bindings: AllBindings): { next: boolean; prev: boolean } {
  const presetBindings = bindingsForPreset(bindings, preset);
  const axisThreshold = CONTROLS.gamepadAxisThreshold;
  return {
    next: isActionActive(raw, 'cycleWeaponNext', presetBindings['cycleWeaponNext'], axisThreshold),
    prev: isActionActive(raw, 'cycleWeaponPrev', presetBindings['cycleWeaponPrev'], axisThreshold),
  };
}

/**
 * Turns one tick's raw device state into an `InputFrame`. Both presets
 * combine `driveUp/Down/Left/Right` into a single direction+magnitude
 * vector the same way (see file header) — only WHICH physical inputs
 * feed those four action ids differs between presets, and that lives
 * entirely in `bindings`, not in this function.
 *
 * `moveX`/`moveY`: each held direction contributes a unit step; opposing
 * directions cancel; a diagonal (e.g. up+right) is normalized back to
 * length <= 1 so it is not faster than a single direction. All four
 * released is the zero vector — a centered stick, which `stepDriving`
 * reads as "coast", never a hard brake.
 *
 * `weaponSlot`: direct-select only (see `directWeaponSlot`), defaulting to 0
 * (matching `@/sim/loop`'s `defaultInputFrame()`) when no digit is held.
 * Cycling is exposed separately via `cyclePressed()`. A caller that tracks
 * its own active slot across ticks must NOT read this field — the default
 * makes "nothing held" indistinguishable from "mount 1" — and should call
 * `directWeaponSlot()` instead.
 */
export function resolveInput(rawState: RawInputState, preset: PresetName, bindings: AllBindings): InputFrame {
  const presetBindings = bindingsForPreset(bindings, preset);
  const axisThreshold = CONTROLS.gamepadAxisThreshold;
  const active = (actionId: string): boolean => isActionActive(rawState, actionId, presetBindings[actionId], axisThreshold);
  const strength = (actionId: string): number => actionStrength(rawState, actionId, presetBindings[actionId], axisThreshold);

  // The four movement strengths, read through the ONE list that also tells the
  // controls validator which actions a city shortcut may not collide with.
  // Spelled inline here once, this function and the validator would each own
  // the same fact and a fifth movement key would land in one and not the other.
  const [upId, downId, leftId, rightId] = DRIVE_ACTION_IDS;
  const up = strength(upId);
  const down = strength(downId);
  const left = strength(leftId);
  const right = strength(rightId);

  // World convention (`@/render/camera`'s header, `@/sim/driving`'s
  // `forward = {cos(h), sin(h)}`): X right, Y UP, no vertical flip — so
  // driveUp must contribute POSITIVE Y, matching app.ts's own
  // sampleInput() (`moveY += 1` for the same up keys/keycodes).
  let moveX = right - left;
  let moveY = up - down;
  const length = Math.hypot(moveX, moveY);
  if (length > 1) {
    moveX /= length;
    moveY /= length;
  }

  const fire = active('fire');
  const weaponSlot = directWeaponSlot(rawState, preset, bindings) ?? 0;

  return { moveX, moveY, fire, weaponSlot };
}

/**
 * A keyboard `code` as a player should read it, for on-screen instructions.
 *
 * Built from the CODE rather than the `KeyboardEvent.key` because the bindings
 * are code-keyed, and a `KeyboardEvent` is not available when the hint is
 * rendered. The table is intentionally small and explicit: an unmapped code
 * falls through to the code itself, which is ugly but never WRONG, and a
 * generated instruction that says `KeyZ` is at least honest about what it does
 * not know.
 */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  switch (code) {
    case 'Space':
      return 'Space';
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
      return code.slice(5);
    default:
      return code;
  }
}

/**
 * One action's keyboard bindings as a slash-joined label: `fire` reads
 * "Space/J" from the shipped map.
 *
 * This exists because the arena's control hint used to be the hardcoded string
 * "Space/J fire" while `controls.json` bound `fire` to `KeyJ` alone — so the
 * most prominent instruction on the combat screen named a key that did
 * nothing, and pressing Space did nothing. `controls.json`'s own note says
 * every action is remappable at runtime, which means ANY hardcoded key in a
 * hint is a lie waiting for a rebind; deriving the label from the live
 * bindings makes that class unrepresentable rather than merely fixed.
 *
 * Mouse and gamepad bindings are ignored deliberately: a keyboard hint for a
 * keyboard player, and the gamepad's own prompts are a separate surface.
 */
export function describeAction(bindings: AllBindings, preset: PresetName, actionId: string): string {
  const presetBindings = bindingsForPreset(bindings, preset);
  const keys = presetBindings[actionId]?.keyboard ?? [];
  return keys.map(keyLabel).join('/');
}

/**
 * The shortcut ids the city screen honours, in the order the status line lists
 * them. Derived from `CONTROLS.cityShortcuts` rather than typed, so adding a
 * fourth shortcut to the ruleset makes it appear here automatically instead of
 * silently going unhinted — which is precisely how `J journal · F fleet` ended
 * up hardcoded in the first place.
 */
export function cityShortcutIds(): string[] {
  return Object.keys(CONTROLS.cityShortcuts);
}

/** One city shortcut's keys as a label — `journal` reads "J". Same rule as `describeAction`: generated from the live table, never a literal. */
export function describeCityShortcut(shortcutId: string): string {
  return (CONTROLS.cityShortcuts[shortcutId] ?? []).map(keyLabel).join('/');
}

/**
 * Which city shortcut, if any, this `code` triggers.
 *
 * Keyed by CODE rather than `ev.key`, because that is how `controls.json`
 * declares bindings and how every other lookup in this module works: matching
 * on `ev.key` is what made the old city handler accept both `'j'` and `'J'`
 * with a pair of literal comparisons, and would have ignored a rebind to a
 * non-letter key entirely (Shift+J reports `key: 'J'` but `code: 'KeyJ'`).
 */
export function cityShortcutForCode(code: string): string | undefined {
  for (const [shortcutId, codes] of Object.entries(CONTROLS.cityShortcuts)) {
    if (codes.includes(code)) return shortcutId;
  }
  return undefined;
}

/** True when `code` is bound to any action in the given preset — used to decide whether a key's browser default should be suppressed. */
export function isBoundToAnyAction(bindings: AllBindings, preset: PresetName, code: string): boolean {
  return Object.values(bindingsForPreset(bindings, preset)).some((b) => (b.keyboard ?? []).includes(code));
}

/**
 * BOTH directions of a cycle pair as one label — `Q/E`, not `E`.
 *
 * Added immediately after getting this wrong. The arena hint is generated from
 * the live bindings, and the first version read only `cycleWeaponNext`, so the
 * moment the hint became truthful it became INCOMPLETE: the shipped map binds
 * `cycleWeaponPrev` to KeyQ and `cycleWeaponNext` to KeyE, and the generated
 * text silently dropped the Q. The old hardcoded literal said "Q/E cycle
 * weapon", so this was a regression introduced by the fix for a different bug.
 *
 * Worth recording how it was caught, because the gate did not catch it and the
 * screenshot gate reported "0 with problems": the hint is DOM text, and the
 * numeric statistics cannot see text at all (iteration 92 measured that a
 * 411-pixel change in a HUD panel moves the frame's mean by 0.068 luma). It was
 * caught by CROPPING AND READING the string in the capture — the same
 * iteration-89 discipline of verifying the artefact rather than the source.
 * A generated hint trades one class of bug (stale literal) for another (an
 * incomplete derivation), and the second is only visible by reading it.
 */
export function describeCyclePair(
  bindings: AllBindings,
  preset: PresetName,
  prevActionId: string,
  nextActionId: string,
): string {
  const prev = describeAction(bindings, preset, prevActionId);
  const next = describeAction(bindings, preset, nextActionId);
  return [prev, next].filter((part) => part.length > 0).join('/');
}
