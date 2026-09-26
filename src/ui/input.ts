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
 * gameplay-numeric (including the gamepad deadzone) is a literal here.
 */
import { validateControls, type ActionBindingDefaults, type ControlsConfig, type GamepadAxisBinding } from '@/data/schema';
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
}

export function emptyRawInputState(): RawInputState {
  return { keysDown: new Set(), mouseButtonsDown: new Set(), gamepadButtonsDown: new Set(), gamepadAxes: [] };
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

/** This one axis binding's contribution toward its action, in `[0, 1]`: 0 below the deadzone, otherwise the axis's own magnitude (clamped to 1) — NOT collapsed to a boolean. That magnitude is what carries the Classic single-stick contract's "speed as a fraction of top speed" (file header) all the way through to `@/sim/driving`, which reads it via `stick` length; collapsing it here would make every gamepad axis a 3-state (0/+1/-1) digital input no matter how far it's actually pushed. */
function axisContribution(raw: RawInputState, axis: GamepadAxisBinding, axisThreshold: number): number {
  const value = raw.gamepadAxes[axis.index] ?? 0;
  if (axis.sign > 0) {
    return value >= axisThreshold ? Math.min(value, 1) : 0;
  }
  return value <= -axisThreshold ? Math.min(-value, 1) : 0;
}

/** How strongly `binding` is being held this tick, in `[0, 1]`. Digital devices (keyboard/mouse/gamepad buttons) are all-or-nothing — pressed contributes exactly 1, matching keyboard's inherent lack of magnitude. A gamepad axis contributes its own analog magnitude via `axisContribution`; when a binding lists more than one axis, the strongest wins. */
function actionStrength(raw: RawInputState, binding: ActionBindingDefaults | undefined, axisThreshold: number): number {
  if (binding === undefined) return 0;
  for (const code of binding.keyboard) if (raw.keysDown.has(code)) return 1;
  for (const button of binding.mouse) if (raw.mouseButtonsDown.has(button)) return 1;
  for (const button of binding.gamepadButtons) if (raw.gamepadButtonsDown.has(button)) return 1;
  let strongest = 0;
  for (const axis of binding.gamepadAxes) strongest = Math.max(strongest, axisContribution(raw, axis, axisThreshold));
  return strongest;
}

function isActionActive(raw: RawInputState, binding: ActionBindingDefaults | undefined, axisThreshold: number): boolean {
  return actionStrength(raw, binding, axisThreshold) > 0;
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
 * stateless. Cycling (`fireCycle` below) inherently needs to know the
 * PREVIOUS tick's active slot to advance from, which a pure
 * `resolveInput(rawState, preset, bindings)` — deliberately given no
 * memory of earlier ticks, so it can't drift out of sync with whatever
 * else reads the same raw state — cannot supply; that persistent slot is
 * the caller's state to own (exactly how `@/app.ts`'s human-input path
 * already tracks its own `activeWeaponIndex` across frames).
 */
function resolveDirectWeaponSlot(raw: RawInputState, bindings: PresetBindings, axisThreshold: number): number | null {
  for (const [actionId, slot] of DIRECT_SELECT_ORDER) {
    if (isActionActive(raw, bindings[actionId], axisThreshold)) return slot;
  }
  return null;
}

/** Whether cycle-next / cycle-prev are held this tick. Edge-detection and slot bookkeeping are the caller's job (see `resolveDirectWeaponSlot`'s doc) — this only reports the raw, current, rebindable button state. */
export function cyclePressed(raw: RawInputState, preset: PresetName, bindings: AllBindings): { next: boolean; prev: boolean } {
  const presetBindings = bindingsForPreset(bindings, preset);
  const axisThreshold = CONTROLS.gamepadAxisThreshold;
  return {
    next: isActionActive(raw, presetBindings['cycleWeaponNext'], axisThreshold),
    prev: isActionActive(raw, presetBindings['cycleWeaponPrev'], axisThreshold),
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
 * `weaponSlot`: direct-select only (see `resolveDirectWeaponSlot`),
 * defaulting to 0 (matching `@/sim/loop`'s `defaultInputFrame()`) when no
 * digit is held. Cycling is exposed separately via `cyclePressed()`.
 */
export function resolveInput(rawState: RawInputState, preset: PresetName, bindings: AllBindings): InputFrame {
  const presetBindings = bindingsForPreset(bindings, preset);
  const axisThreshold = CONTROLS.gamepadAxisThreshold;
  const active = (actionId: string): boolean => isActionActive(rawState, presetBindings[actionId], axisThreshold);
  const strength = (actionId: string): number => actionStrength(rawState, presetBindings[actionId], axisThreshold);

  const up = strength('driveUp');
  const down = strength('driveDown');
  const left = strength('driveLeft');
  const right = strength('driveRight');

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
  const weaponSlot = resolveDirectWeaponSlot(rawState, presetBindings, axisThreshold) ?? 0;

  return { moveX, moveY, fire, weaponSlot };
}
