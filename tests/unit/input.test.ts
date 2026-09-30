import { describe, expect, it, vi } from 'vitest';

import { ControlsValidationError, validateControls } from '@/data/schema';
import controlsJson from '@rulesets/classic/controls.json';

import {
  CONTROLS,
  bindingsForPreset,
  cityShortcutForCode,
  cyclePressed,
  defaultBindings,
  describeAction,
  describeCityShortcut,
  describeCyclePair,
  emptyRawInputState,
  isBoundToAnyAction,
  keyLabel,
  rebind,
  resolveInput,
  type RawInputState,
} from '@/ui/input';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function withKeys(...codes: string[]): RawInputState {
  return { ...emptyRawInputState(), keysDown: new Set(codes) };
}

function withMouse(...buttons: number[]): RawInputState {
  return { ...emptyRawInputState(), mouseButtonsDown: new Set(buttons) };
}

function withGamepadButtons(...buttons: number[]): RawInputState {
  return { ...emptyRawInputState(), gamepadButtonsDown: new Set(buttons) };
}

function withGamepadAxes(...axes: number[]): RawInputState {
  return { ...emptyRawInputState(), gamepadAxes: axes };
}

function withTouchAxes(...axes: number[]): RawInputState {
  return { ...emptyRawInputState(), touchAxes: axes };
}

function withTouchButtons(...ids: string[]): RawInputState {
  return { ...emptyRawInputState(), touchButtonsDown: new Set(ids) };
}

// ---------------------------------------------------------------------------
// Direction resolution: the world-convention sign, every device, every axis
// ---------------------------------------------------------------------------

describe('resolveInput: direction resolution matches the declared world convention', () => {
  it('a centered input (nothing held) resolves to the zero vector', () => {
    const frame = resolveInput(emptyRawInputState(), 'classic', defaultBindings());
    expect(frame.moveX).toBe(0);
    expect(frame.moveY).toBe(0);
  });

  it('driveUp (KeyW) resolves to POSITIVE Y — up-screen, matching X-right/Y-up (no vertical flip) and app.ts\'s own sampleInput, which does moveY += 1 for the identical keypress', () => {
    const frame = resolveInput(withKeys('KeyW'), 'classic', defaultBindings());
    expect(frame.moveY).toBe(1);
    expect(frame.moveX).toBe(0);
  });

  it('driveDown (KeyS) resolves to NEGATIVE Y, the mirror of driveUp', () => {
    const frame = resolveInput(withKeys('KeyS'), 'classic', defaultBindings());
    expect(frame.moveY).toBe(-1);
    expect(frame.moveX).toBe(0);
  });

  it('driveLeft/driveRight resolve to -X/+X', () => {
    expect(resolveInput(withKeys('KeyA'), 'classic', defaultBindings()).moveX).toBe(-1);
    expect(resolveInput(withKeys('KeyD'), 'classic', defaultBindings()).moveX).toBe(1);
  });

  it('opposing directions held together cancel to zero, not to a signed sum', () => {
    const frame = resolveInput(withKeys('KeyW', 'KeyS'), 'classic', defaultBindings());
    expect(frame.moveX).toBe(0);
    expect(frame.moveY).toBe(0);
  });

  it('a diagonal (up+right) is normalized to length <= 1, not a faster length-sqrt(2) vector', () => {
    const frame = resolveInput(withKeys('KeyW', 'KeyD'), 'classic', defaultBindings());
    expect(Math.hypot(frame.moveX, frame.moveY)).toBeCloseTo(1, 6);
    expect(frame.moveX).toBeGreaterThan(0);
    expect(frame.moveY).toBeGreaterThan(0);
  });

  it('a mouse-bound action (fire) is read correctly and never touches the drive vector', () => {
    const frame = resolveInput(withMouse(0), 'classic', defaultBindings());
    expect(frame.fire).toBe(true);
    expect(frame.moveX).toBe(0);
    expect(frame.moveY).toBe(0);
  });

  it('a gamepad-button-bound action (Classic fire, button 7) is read correctly', () => {
    const frame = resolveInput(withGamepadButtons(7), 'classic', defaultBindings());
    expect(frame.fire).toBe(true);
    expect(frame.moveX).toBe(0);
    expect(frame.moveY).toBe(0);
  });

  it('Modern preset: driveUp/driveDown are gamepad BUTTONS (7/6), not the left-stick Y axis', () => {
    expect(resolveInput(withGamepadButtons(7), 'modern', defaultBindings()).moveY).toBe(1);
    expect(resolveInput(withGamepadButtons(6), 'modern', defaultBindings()).moveY).toBe(-1);
  });

  it('Classic preset: driveUp/driveDown are the left-stick Y axis (index 1), full deflection', () => {
    // Classic binds driveUp to {index: 1, sign: -1}: physical stick-up is a
    // negative axis-1 reading, and it must contribute POSITIVE moveY.
    expect(resolveInput(withGamepadAxes(0, -1), 'classic', defaultBindings()).moveY).toBe(1);
    expect(resolveInput(withGamepadAxes(0, 1), 'classic', defaultBindings()).moveY).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Analog magnitude: a gamepad axis is a continuous value, not a 3-state digital input
// ---------------------------------------------------------------------------

describe('resolveInput: gamepad axis magnitude is preserved, not collapsed to a boolean', () => {
  it('a partial deflection past the deadzone yields a PROPORTIONAL magnitude, not a snap to 1', () => {
    const frame = resolveInput(withGamepadAxes(0, -0.75), 'classic', defaultBindings());
    expect(frame.moveY).toBeCloseTo(0.75, 6);
    expect(frame.moveY).not.toBe(1);
  });

  it('a deflection exactly at the deadzone (0.5) counts, contributing exactly that magnitude', () => {
    expect(resolveInput(withGamepadAxes(0, -0.5), 'classic', defaultBindings()).moveY).toBeCloseTo(0.5, 6);
  });

  it('a deflection just below the deadzone (0.49) contributes NOTHING — not 0.49, not 1, exactly 0', () => {
    expect(resolveInput(withGamepadAxes(0, -0.49), 'classic', defaultBindings()).moveY).toBe(0);
  });

  it('full deflection (-1.0) still resolves to exactly 1, so this does not regress the digital case', () => {
    expect(resolveInput(withGamepadAxes(0, -1.0), 'classic', defaultBindings()).moveY).toBe(1);
  });

  it('a digital device (keyboard) is unaffected by this and stays a hard 0/1 step — magnitude only applies to axes', () => {
    expect(resolveInput(withKeys('KeyW'), 'classic', defaultBindings()).moveY).toBe(1);
  });

  it('gamepadAxisThreshold is genuinely ruleset-sourced, not a hardcoded literal (moves with a mocked controls.json)', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/controls.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: typeof controlsJson }>();
      return { default: { ...actual.default, gamepadAxisThreshold: 0.9 } };
    });
    try {
      const mod = await import('@/ui/input');
      const raw = { ...mod.emptyRawInputState(), gamepadAxes: [0, -0.75] };
      // 0.75 clears the real (0.5) deadzone but not this mocked (0.9) one —
      // if the threshold were a hardcoded 0.5 literal, this would still be
      // active and moveY would be 0.75, not 0.
      expect(mod.resolveInput(raw, 'classic', mod.defaultBindings()).moveY).toBe(0);
      // And 0.95 clears even the mocked threshold.
      const rawStrong = { ...mod.emptyRawInputState(), gamepadAxes: [0, -0.95] };
      expect(mod.resolveInput(rawStrong, 'classic', mod.defaultBindings()).moveY).toBeCloseTo(0.95, 6);
    } finally {
      vi.doUnmock('@rulesets/classic/controls.json');
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// Touch channel: a distinct analog + digital source, independent of gamepad
// ---------------------------------------------------------------------------

describe('resolveInput: touch channel', () => {
  it('touch stick axes fold into moveX/moveY with the correct signs for all four cardinals', () => {
    expect(resolveInput(withTouchAxes(0, -1), 'classic', defaultBindings()).moveY).toBe(1);
    expect(resolveInput(withTouchAxes(0, 1), 'classic', defaultBindings()).moveY).toBe(-1);
    expect(resolveInput(withTouchAxes(-1, 0), 'classic', defaultBindings()).moveX).toBe(-1);
    expect(resolveInput(withTouchAxes(1, 0), 'classic', defaultBindings()).moveX).toBe(1);
  });

  it('the touch deadzone is CONTROLS.touch.axisDeadzone, NOT gamepadAxisThreshold: a 0.3 stick (above 0.16, below 0.5) yields non-zero movement', () => {
    expect(CONTROLS.touch.axisDeadzone).toBeLessThan(0.3);
    expect(CONTROLS.gamepadAxisThreshold).toBeGreaterThan(0.3);
    const frame = resolveInput(withTouchAxes(0, -0.3), 'classic', defaultBindings());
    expect(frame.moveY).not.toBe(0);
    expect(frame.moveY).toBeCloseTo(0.3, 6);
  });

  it('magnitude is preserved, not collapsed to 1 (a 0.5 stick reads 0.5)', () => {
    const frame = resolveInput(withTouchAxes(0.5, 0), 'classic', defaultBindings());
    expect(frame.moveX).toBeCloseTo(0.5, 6);
    expect(frame.moveX).not.toBe(1);
  });

  it('a diagonal stick push is normalised to length <= 1', () => {
    const frame = resolveInput(withTouchAxes(1, -1), 'classic', defaultBindings());
    expect(Math.hypot(frame.moveX, frame.moveY)).toBeCloseTo(1, 6);
    expect(frame.moveX).toBeGreaterThan(0);
    expect(frame.moveY).toBeGreaterThan(0);
  });

  it('gamepad and touch analog contributions on the SAME action combine via MAX, not a sum: 0.5 gamepad plus 0.6 touch yields 0.6, never 1.1', () => {
    const raw: RawInputState = { ...emptyRawInputState(), gamepadAxes: [0, -0.5], touchAxes: [0, -0.6] };
    const frame = resolveInput(raw, 'classic', defaultBindings());
    expect(frame.moveY).toBeCloseTo(0.6, 6);
    expect(frame.moveY).not.toBeCloseTo(1.1, 6);
  });

  it('a held KeyW plus stick DOWN 0.6 cancels toward 0.4 exactly as the max rule predicts (up=max(1,0)=1, down=max(0,0.6)=0.6, 1-0.6=0.4)', () => {
    const raw: RawInputState = { ...withKeys('KeyW'), touchAxes: [0, 0.6] };
    expect(resolveInput(raw, 'classic', defaultBindings()).moveY).toBeCloseTo(0.4, 6);
  });

  it('a touch fire button sets fire', () => {
    expect(resolveInput(withTouchButtons('fire'), 'classic', defaultBindings()).fire).toBe(true);
  });

  it('touch and gamepad are independent channels: each alone reproduces the identical analog result the other channel would', () => {
    const gamepadOnly = resolveInput({ ...emptyRawInputState(), gamepadAxes: [0, -0.75] }, 'classic', defaultBindings());
    const touchOnly = resolveInput({ ...emptyRawInputState(), touchAxes: [0, -0.75] }, 'classic', defaultBindings());
    expect(gamepadOnly.moveY).toBeCloseTo(0.75, 6);
    expect(touchOnly.moveY).toBeCloseTo(0.75, 6);
  });
});

// ---------------------------------------------------------------------------
// Rebinding
// ---------------------------------------------------------------------------

describe('rebind', () => {
  it('a rebound key produces the rebound action, and the old key no longer does', () => {
    const original = defaultBindings();
    const rebound = rebind(original, 'classic', 'driveUp', { device: 'keyboard', code: 'KeyI' });

    expect(resolveInput(withKeys('KeyI'), 'classic', rebound).moveY).toBe(1);
    expect(resolveInput(withKeys('KeyW'), 'classic', rebound).moveY).toBe(0);

    // The un-rebound bindings object is untouched (rebind never mutates its input).
    expect(resolveInput(withKeys('KeyW'), 'classic', original).moveY).toBe(1);
    expect(resolveInput(withKeys('KeyI'), 'classic', original).moveY).toBe(0);
  });

  it('rebinding one device leaves the action bound on its other devices', () => {
    const rebound = rebind(defaultBindings(), 'classic', 'fire', { device: 'keyboard', code: 'KeyF' });
    const bindings = bindingsForPreset(rebound, 'classic');
    // Original default mouse/gamepad bindings for 'fire' (mouse button 0,
    // gamepad button 7) survive a keyboard-only rebind.
    expect(bindings['fire']?.mouse).toContain(0);
    expect(bindings['fire']?.gamepadButtons).toContain(7);
    expect(bindings['fire']?.keyboard).toEqual(['KeyF']);
  });

  it('rebind rejects an unknown preset name rather than silently inventing a new one', () => {
    expect(() => rebind(defaultBindings(), 'Classic', 'driveUp', { device: 'keyboard', code: 'KeyI' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Unknown preset name: must fail loud, not produce dead controls
// ---------------------------------------------------------------------------

describe('an unknown or misspelled preset name', () => {
  it('resolveInput throws instead of silently returning a permanently dead, all-zero frame', () => {
    // Capital "Classic" — a plausible typo, not "classic".
    expect(() => resolveInput(withKeys('KeyW'), 'Classic', defaultBindings())).toThrow();
  });

  it('cyclePressed throws too, for the same reason', () => {
    expect(() => cyclePressed(withKeys('KeyE'), 'Classic', defaultBindings())).toThrow();
  });

  it('every real preset in CONTROLS.presets resolves without throwing', () => {
    for (const preset of CONTROLS.presets) {
      expect(() => resolveInput(emptyRawInputState(), preset, defaultBindings())).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// No free aim, in either preset — probing EVERY device, not just keyboard[0]
// ---------------------------------------------------------------------------

describe('no preset can produce an aim direction independent of vehicle heading', () => {
  it('InputFrame carries no channel but the one drive vector', () => {
    for (const preset of CONTROLS.presets) {
      const baseline = resolveInput(emptyRawInputState(), preset, defaultBindings());
      expect(Object.keys(baseline).sort()).toEqual(['fire', 'moveX', 'moveY', 'weaponSlot'].sort());
    }
  });

  it('no non-drive action ever moves the drive vector, on ANY device it is bound to — keyboard, mouse, gamepad buttons, and gamepad axes', () => {
    const bindings = defaultBindings();
    for (const preset of CONTROLS.presets) {
      const presetBindings = bindingsForPreset(bindings, preset);
      const nonDriveActions = CONTROLS.actions.filter((id) => !id.startsWith('drive'));
      expect(nonDriveActions.length).toBeGreaterThan(0);

      for (const actionId of nonDriveActions) {
        const binding = presetBindings[actionId];
        if (binding === undefined) continue;

        for (const code of binding.keyboard) {
          const frame = resolveInput(withKeys(code), preset, bindings);
          expect(frame.moveX).toBe(0);
          expect(frame.moveY).toBe(0);
        }
        for (const button of binding.mouse) {
          const frame = resolveInput(withMouse(button), preset, bindings);
          expect(frame.moveX).toBe(0);
          expect(frame.moveY).toBe(0);
        }
        for (const button of binding.gamepadButtons) {
          const frame = resolveInput(withGamepadButtons(button), preset, bindings);
          expect(frame.moveX).toBe(0);
          expect(frame.moveY).toBe(0);
        }
        for (const axis of binding.gamepadAxes) {
          const axes: number[] = [];
          axes[axis.index] = axis.sign;
          const frame = resolveInput(withGamepadAxes(...axes), preset, bindings);
          expect(frame.moveX).toBe(0);
          expect(frame.moveY).toBe(0);
        }
      }
    }
  });

  it('this is a REAL check, not a vacuous one: the Modern preset genuinely has a gamepad-button-bound non-drive action (fire) to probe', () => {
    const modernFire = bindingsForPreset(defaultBindings(), 'modern')['fire'];
    expect(modernFire?.gamepadButtons.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Weapon slot: direct-select and cycle signals
// ---------------------------------------------------------------------------

describe('weapon slot resolution', () => {
  it('a held direct-select digit maps to its absolute slot (1,2,...,9,0 -> 0..9)', () => {
    const bindings = defaultBindings();
    expect(resolveInput(withKeys('Digit3'), 'classic', bindings).weaponSlot).toBe(2);
    expect(resolveInput(withKeys('Digit0'), 'classic', bindings).weaponSlot).toBe(9);
    expect(resolveInput(emptyRawInputState(), 'classic', bindings).weaponSlot).toBe(0);
  });

  it('cyclePressed reports next/prev independently of direct-select and fire', () => {
    const bindings = defaultBindings();
    expect(cyclePressed(withKeys('KeyE'), 'classic', bindings)).toEqual({ next: true, prev: false });
    expect(cyclePressed(withKeys('KeyQ'), 'classic', bindings)).toEqual({ next: false, prev: true });
    expect(cyclePressed(withKeys('KeyJ'), 'classic', bindings)).toEqual({ next: false, prev: false });
  });
});

// ---------------------------------------------------------------------------
// Cross-action binding collisions: validateControls must reject them
// ---------------------------------------------------------------------------

describe('validateControls: cross-action physical-binding collisions', () => {
  it('rejects two actions in the same preset sharing one gamepad button (the historical Modern "button 7 drives throttle AND fire" defect)', () => {
    const broken = structuredClone(controlsJson) as typeof controlsJson;
    broken.defaultBindings.modern.fire.gamepadButtons = [7]; // collides with modern driveUp's button 7
    expect(() => validateControls(broken)).toThrow(ControlsValidationError);
    try {
      validateControls(broken);
      throw new Error('expected validateControls to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ControlsValidationError);
      const message = (err as Error).message;
      expect(message).toContain('driveUp');
      expect(message).toContain('fire');
      expect(message).toContain('gamepad button 7');
    }
  });

  it('rejects a keyboard collision too (not just gamepad)', () => {
    const broken = structuredClone(controlsJson) as typeof controlsJson;
    broken.defaultBindings.classic.driveLeft.keyboard = ['KeyJ']; // collides with classic fire's KeyJ
    expect(() => validateControls(broken)).toThrow(ControlsValidationError);
  });

  it('the real shipped controls.json has NO such collision, in either preset (regression guard for the fix)', () => {
    // Cloned so this doesn't just hit the module's per-object memoization
    // and skip re-validating.
    expect(() => validateControls(structuredClone(controlsJson))).not.toThrow();
  });

  it('mutation check: reintroducing the exact historical defect (Modern fire on button 7) makes this fail', () => {
    // This is the same mutation the reviewer demonstrated against the live
    // file; asserting it fails here is what proves the invariant, rather
    // than the schema shape checks, is what is catching it.
    const reintroduced = structuredClone(controlsJson) as typeof controlsJson;
    reintroduced.defaultBindings.modern.fire.gamepadButtons = [7];
    expect(() => validateControls(reintroduced)).toThrow();
  });
});

/**
 * On-screen key hints are DERIVED from the live bindings.
 *
 * The arena's control hint used to be the literal string "Space/J fire" while
 * `controls.json` bound `fire` to `KeyJ` alone — so the most prominent
 * instruction on the combat screen named a key that did nothing. Found by Codex
 * `gpt-6.1-sol`, who drove the build, pressed Space in the arena, and watched
 * the ammunition sit still.
 *
 * The hint is now generated. These tests pin the property that makes it safe
 * rather than the string it happens to produce: whatever the bindings say, the
 * hint says the same thing. A test asserting `describeAction(...) === 'Space/J'`
 * would pass while a rebind made the on-screen text stale again, which is the
 * bug in a slower form.
 */
describe('key hints are derived from the live bindings', () => {
  it('maps codes to the labels a player reads', () => {
    expect(keyLabel('KeyJ')).toBe('J');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('ArrowUp')).toBe('Up');
    expect(keyLabel('Digit4')).toBe('4');
    // An unmapped code falls through to itself: ugly, but never a WRONG key.
    expect(keyLabel('IntlBackslash')).toBe('IntlBackslash');
  });

  it('joins an action\'s keys with a slash', () => {
    const b = defaultBindings();
    expect(describeAction(b, 'classic', 'fire')).toBe('Space/J');
    expect(describeAction(b, 'classic', 'cycleWeaponNext')).toBe('E');
  });

  it('says what the SHIPPED map says — and Space is genuinely bound to fire', () => {
    // The half that was a lie. Asserted against controls.json rather than a
    // literal so the test tracks the ruleset, and paired with the second half:
    // the hint and the binding are the same source, so they cannot disagree.
    const fireKeys = controlsJson.defaultBindings.classic.fire.keyboard;
    expect(fireKeys).toContain('KeyJ');
    expect(fireKeys).toContain('Space');
    const b = defaultBindings();
    const shown = describeAction(b, 'classic', 'fire');
    for (const code of fireKeys) expect(shown.split('/')).toContain(keyLabel(code));
  });

  it('FOLLOWS A REBIND, which is the property the old hardcoded string could not have', () => {
    // The durable half. `controls.json` documents every action as remappable at
    // runtime, so a literal in a hint is stale the moment a player rebinds — and
    // the game offers rebinding on the Controls screen. After moving `fire` to a
    // single key, the hint must report that key and nothing else.
    const b = defaultBindings();
    const rebound = rebind(b, 'classic', 'fire', { device: 'keyboard', code: 'KeyZ' });
    expect(describeAction(rebound, 'classic', 'fire')).toBe('Z');
    // The OTHER preset is untouched: rebinding is per-preset by design.
    expect(describeAction(rebound, 'modern', 'fire')).toBe('Space/J');
  });

  it('reports a key as bound only while it is, for the scroll guard', () => {
    const b = defaultBindings();
    expect(isBoundToAnyAction(b, 'classic', 'Space')).toBe(true);
    expect(isBoundToAnyAction(b, 'classic', 'KeyZ')).toBe(false);
    const unbound = rebind(b, 'classic', 'fire', { device: 'keyboard', code: 'KeyZ' });
    expect(isBoundToAnyAction(unbound, 'classic', 'Space')).toBe(false);
  });

  it('reports BOTH directions of a cycle pair, because reading one dropped a key', () => {
    // Regression guard for a bug the fix above introduced: generating the cycle
    // label from `cycleWeaponNext` alone made the hint TRUTHFUL and INCOMPLETE,
    // silently dropping the Q that the old hardcoded literal had. The capture
    // gate reported "0 with problems" — DOM text moves no pixel statistic — so
    // this was caught by cropping and reading the string in the capture.
    const b = defaultBindings();
    expect(describeCyclePair(b, 'classic', 'cycleWeaponPrev', 'cycleWeaponNext')).toBe('Q/E');
    // A half-bound pair still names what exists, rather than printing a
    // dangling slash.
    const oneWay = rebind(b, 'classic', 'cycleWeaponPrev', { device: 'keyboard', code: 'KeyQ' });
    expect(describeCyclePair(oneWay, 'classic', 'cycleWeaponPrev', 'cycleWeaponNext')).toBe('Q/E');
  });

  it('returns an empty label for an action nobody has bound, rather than throwing', () => {
    // An arena hint is built for a fixed action list, so an unknown id is a
    // programming error — but it should degrade to a blank rather than take the
    // whole combat screen down with a thrown error.
    expect(describeAction(defaultBindings(), 'classic', 'no-such-action')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// City shortcuts: their own namespace, read by CODE, labelled from the table
// ---------------------------------------------------------------------------

describe('city shortcuts', () => {
  it('ships the three city commands with the keys the status line used to hardcode', () => {
    // The regression this guards is subtle and invisible: the city's on-screen
    // instruction said "G enter/exit car · J journal · F fleet" while the
    // handler listened for `ev.key` letters. Both were right, so nothing looked
    // wrong, and neither could be changed. These are the same three keys.
    expect(describeCityShortcut('toggleVehicle')).toBe('G');
    expect(describeCityShortcut('journal')).toBe('J');
    expect(describeCityShortcut('fleet')).toBe('F');
  });

  it('resolves a code through the table, so a rebound key moves the feature', () => {
    expect(cityShortcutForCode('KeyJ')).toBe('journal');
    expect(cityShortcutForCode('KeyF')).toBe('fleet');
    expect(cityShortcutForCode('KeyG')).toBe('toggleVehicle');
    // Not bound, and must say so rather than falling through to some default.
    expect(cityShortcutForCode('KeyQ')).toBeUndefined();
  });

  it('is genuinely ruleset-sourced — a mocked controls.json moves BOTH the lookup and the label', async () => {
    // Two assertions in one test on purpose, because they can pass
    // independently for the wrong reason: a handler still matching literals
    // would keep the real lookup working while the label moved, and a label
    // still hardcoded would keep the real lookup moving while the text did not.
    vi.resetModules();
    vi.doMock('@rulesets/classic/controls.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: typeof controlsJson }>();
      return {
        default: {
          ...actual.default,
          cityShortcuts: { ...actual.default.cityShortcuts, journal: ['KeyK'] },
        },
      };
    });
    try {
      const mod = await import('@/ui/input');
      expect(mod.describeCityShortcut('journal'), 'the label did not follow the ruleset').toBe('K');
      expect(mod.cityShortcutForCode('KeyK'), 'the lookup did not follow the ruleset').toBe('journal');
      expect(mod.cityShortcutForCode('KeyJ'), 'the OLD key still resolves; the lookup is not table-driven').toBeUndefined();
    } finally {
      vi.doUnmock('@rulesets/classic/controls.json');
      vi.resetModules();
    }
  });
});
