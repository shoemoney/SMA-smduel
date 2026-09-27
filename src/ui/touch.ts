/**
 * The on-screen thumbstick + fire button + fixed-hotkey command buttons for
 * touch devices. Mounted per driving screen (`@/app.ts`), never globally — a
 * screen that tears itself down must be able to take this with it.
 *
 * `mountTouchControls` returns `null` on anything but a genuinely coarse
 * pointer (`isCoarsePointer`), so a desktop mouse/trackpad session appends
 * NOTHING to the DOM and pays no cost for a control scheme it can't use.
 *
 * The stick is a "floating" joystick, not a fixed-position one: the origin
 * is wherever the thumb first lands inside the stick's hit area on
 * `pointerdown`, not the pad's visual center. That is what lets this module
 * avoid `getBoundingClientRect()` (which happy-dom always answers with
 * zeros, and which would otherwise force a real layout pass just to know
 * where a thumb landed) — `pointermove` only ever needs the DELTA from that
 * recorded origin, never the element's absolute position on screen.
 *
 * Command buttons (`TouchCommandSpec`) are a DIFFERENT kind of control from
 * the stick/fire: they cover `@/app.ts`'s fixed hotkeys (G/F/J/X), which
 * are discrete edge-triggered actions, not part of `controls.json`'s
 * rebindable, continuous action set. They are deliberately NOT folded into
 * `RawInputState.touchButtonsDown`/`resolveInput` — a command fires its own
 * `onPress` callback directly, exactly once per tap, the same as a screen's
 * own `keydown` handler fires once per fixed-hotkey press. `resolveInput`
 * stays exactly as pure and as unaware of them as it was before.
 */
import { CONTROLS } from '@/ui/input';
import { t, type StringId } from '@/ui/strings';

export interface TouchCommandSpec {
  readonly id: string;
  /** strings.json key, resolved through `t()` — never a bare literal. */
  readonly labelKey: string;
  readonly onPress: () => void;
  /** Defaults to true. A command that is only sometimes available starts false. */
  readonly initiallyVisible?: boolean;
}

export interface TouchMountOptions {
  readonly fire: boolean;
  readonly commands?: readonly TouchCommandSpec[];
}

export interface TouchControls {
  /** This tick's stick reading, shaped for `RawInputState.touchAxes`. */
  axes(): readonly number[];
  /** Action ids whose on-screen button is held, for `RawInputState.touchButtonsDown`. */
  buttonsDown(): ReadonlySet<string>;
  /** Show or hide one command button at runtime, for a control that is only valid in some situations. Cheap and idempotent — safe to call every frame. An unknown `id` is a no-op. */
  setCommandVisible(id: string, visible: boolean): void;
  destroy(): void;
}

const NO_BUTTONS_DOWN: ReadonlySet<string> = new Set();
const FIRE_DOWN: ReadonlySet<string> = new Set(['fire']);

/**
 * True only on a genuinely coarse pointer. A capability query, never a
 * user-agent string: a tablet with a keyboard, a touchscreen laptop and a
 * phone all lie in a UA string and all answer this correctly. Returns false
 * when `matchMedia` is absent or throws, so a non-browser host (happy-dom
 * without a stub, jsdom, SSR) gets no touch UI rather than a crash.
 */
export function isCoarsePointer(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(pointer: coarse)').matches === true;
  } catch {
    return false;
  }
}

function capturePointer(el: HTMLElement, pointerId: number): void {
  if (typeof el.setPointerCapture !== 'function') return;
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Some hosts (and some already-released pointer ids) throw here; the
    // stick/button still work without capture — a slid-off thumb just
    // stops tracking `pointermove` until it lifts, rather than continuing
    // to steer off-pad. The window-level release fallback below is what
    // keeps a release reachable even so; capture only affects move
    // fidelity, never whether a release is ever seen.
  }
}

/** Clamps the vector's LENGTH to 1 (never each axis separately), so a diagonal push doesn't read longer than a cardinal one. */
function clampVectorLength(x: number, y: number): readonly [number, number] {
  const length = Math.hypot(x, y);
  if (length <= 1) return [x, y];
  return [x / length, y / length];
}

/** Mounts the thumbstick, an optional fire button, and any fixed-hotkey command buttons into `container`, or returns `null` on a non-coarse pointer so a desktop browser is byte-for-byte unchanged. */
export function mountTouchControls(container: HTMLElement, options: TouchMountOptions): TouchControls | null {
  if (!isCoarsePointer()) return null;

  const root = document.createElement('div');
  root.className = 'sm-touch';
  root.style.setProperty('--sm-touch-radius', `${CONTROLS.touch.stickRadiusPx}px`);

  const stick = document.createElement('div');
  stick.className = 'sm-touch__stick';
  const knob = document.createElement('div');
  knob.className = 'sm-touch__stick-knob';
  stick.appendChild(knob);
  root.appendChild(stick);

  let stickPointerId: number | null = null;
  let origin: { x: number; y: number } | null = null;
  let axesValue: readonly [number, number] | null = null;

  function resetKnob(): void {
    knob.style.transform = 'translate(0, 0)';
  }

  function onStickDown(ev: PointerEvent): void {
    if (stickPointerId !== null) return;
    stickPointerId = ev.pointerId;
    origin = { x: ev.clientX, y: ev.clientY };
    axesValue = [0, 0];
    capturePointer(stick, ev.pointerId);
  }

  function onStickMove(ev: PointerEvent): void {
    if (stickPointerId !== ev.pointerId || origin === null) return;
    const dx = (ev.clientX - origin.x) / CONTROLS.touch.stickRadiusPx;
    const dy = (ev.clientY - origin.y) / CONTROLS.touch.stickRadiusPx;
    const [x, y] = clampVectorLength(dx, dy);
    axesValue = [x, y];
    knob.style.transform = `translate(${x * CONTROLS.touch.stickRadiusPx}px, ${y * CONTROLS.touch.stickRadiusPx}px)`;
  }

  function onStickRelease(ev: PointerEvent): void {
    if (stickPointerId !== ev.pointerId) return;
    stickPointerId = null;
    origin = null;
    axesValue = null;
    resetKnob();
  }

  stick.addEventListener('pointerdown', onStickDown);
  stick.addEventListener('pointermove', onStickMove);
  stick.addEventListener('pointerup', onStickRelease);
  stick.addEventListener('pointercancel', onStickRelease);
  window.addEventListener('pointerup', onStickRelease);
  window.addEventListener('pointercancel', onStickRelease);

  // --- fire (optional: a screen whose frame loop never reads `fire` — see
  // `showCity` — passes `fire: false` rather than mount a button that's
  // visible but inert). ---
  let fire: HTMLButtonElement | null = null;
  let firePointerId: number | null = null;

  function onFireDown(ev: PointerEvent): void {
    if (firePointerId !== null) return;
    firePointerId = ev.pointerId;
    if (fire !== null) capturePointer(fire, ev.pointerId);
  }

  function onFireRelease(ev: PointerEvent): void {
    if (firePointerId !== ev.pointerId) return;
    firePointerId = null;
  }

  if (options.fire) {
    fire = document.createElement('button');
    fire.type = 'button';
    fire.className = 'sm-touch__fire';
    fire.setAttribute('aria-label', t('ui.touch.fire'));
    root.appendChild(fire);

    fire.addEventListener('pointerdown', onFireDown);
    fire.addEventListener('pointerup', onFireRelease);
    fire.addEventListener('pointercancel', onFireRelease);
    // `capturePointer` swallows a missing/throwing `setPointerCapture` — a
    // thumb that slides off the round pad before lifting then sends its
    // `pointerup`/`pointercancel` to whatever element is now underneath it,
    // never to `fire`. Without a window-level fallback that leaves
    // `firePointerId` frozen at its last reading forever (a stuck throttle
    // with no way to stop, escapable only by leaving the screen). Both
    // handlers already guard on `pointerId`, so when capture DOES work
    // this is just a harmless duplicate delivery, not a double release.
    window.addEventListener('pointerup', onFireRelease);
    window.addEventListener('pointercancel', onFireRelease);
  }

  // --- fixed-hotkey command buttons (G/F/J/X and friends): discrete,
  // edge-triggered, never routed through `RawInputState` — see file header. ---
  const commandButtons = new Map<string, HTMLButtonElement>();
  const commandListeners = new Map<string, () => void>();
  const commands = options.commands ?? [];

  if (commands.length > 0) {
    const commandsHost = document.createElement('div');
    commandsHost.className = options.fire ? 'sm-touch__commands' : 'sm-touch__commands sm-touch__commands--no-fire';

    for (const spec of commands) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sm-touch__cmd';
      btn.dataset.touchCommand = spec.id;
      const label = t(spec.labelKey as StringId);
      btn.setAttribute('aria-label', label);
      btn.textContent = label;
      btn.hidden = spec.initiallyVisible === false;

      const onClick = (): void => spec.onPress();
      btn.addEventListener('click', onClick);
      commandListeners.set(spec.id, onClick);
      commandButtons.set(spec.id, btn);
      commandsHost.appendChild(btn);
    }

    root.appendChild(commandsHost);
  }

  container.appendChild(root);

  return {
    axes(): readonly number[] {
      return axesValue ?? [];
    },
    buttonsDown(): ReadonlySet<string> {
      return firePointerId !== null ? FIRE_DOWN : NO_BUTTONS_DOWN;
    },
    setCommandVisible(id: string, visible: boolean): void {
      const btn = commandButtons.get(id);
      if (btn === undefined) return;
      btn.hidden = !visible;
    },
    destroy(): void {
      stick.removeEventListener('pointerdown', onStickDown);
      stick.removeEventListener('pointermove', onStickMove);
      stick.removeEventListener('pointerup', onStickRelease);
      stick.removeEventListener('pointercancel', onStickRelease);
      window.removeEventListener('pointerup', onStickRelease);
      window.removeEventListener('pointercancel', onStickRelease);
      if (fire !== null) {
        fire.removeEventListener('pointerdown', onFireDown);
        fire.removeEventListener('pointerup', onFireRelease);
        fire.removeEventListener('pointercancel', onFireRelease);
        window.removeEventListener('pointerup', onFireRelease);
        window.removeEventListener('pointercancel', onFireRelease);
      }
      for (const [id, onClick] of commandListeners) {
        commandButtons.get(id)?.removeEventListener('click', onClick);
      }
      root.remove();
    },
  };
}
