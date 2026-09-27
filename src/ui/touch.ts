/**
 * The on-screen thumbstick + fire button for touch devices. Mounted per
 * driving screen (`@/app.ts`), never globally — a screen that tears itself
 * down must be able to take this with it.
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
 */
import { CONTROLS } from '@/ui/input';
import { t } from '@/ui/strings';

export interface TouchControls {
  /** This tick's stick reading, shaped for `RawInputState.touchAxes`. */
  axes(): readonly number[];
  /** Action ids whose on-screen button is held, for `RawInputState.touchButtonsDown`. */
  buttonsDown(): ReadonlySet<string>;
  destroy(): void;
}

const NO_BUTTONS_DOWN: ReadonlySet<string> = new Set();

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
    // stick still works without capture, just without the "keeps steering
    // off-pad" guarantee.
  }
}

/** Clamps the vector's LENGTH to 1 (never each axis separately), so a diagonal push doesn't read longer than a cardinal one. */
function clampVectorLength(x: number, y: number): readonly [number, number] {
  const length = Math.hypot(x, y);
  if (length <= 1) return [x, y];
  return [x / length, y / length];
}

/** Mounts a thumbstick and a fire button into `container`, or returns `null` on a non-coarse pointer so a desktop browser is byte-for-byte unchanged. */
export function mountTouchControls(container: HTMLElement): TouchControls | null {
  if (!isCoarsePointer()) return null;

  const root = document.createElement('div');
  root.className = 'sm-touch';
  root.style.setProperty('--sm-touch-radius', `${CONTROLS.touch.stickRadiusPx}px`);

  const stick = document.createElement('div');
  stick.className = 'sm-touch__stick';
  const knob = document.createElement('div');
  knob.className = 'sm-touch__stick-knob';
  stick.appendChild(knob);

  const fire = document.createElement('button');
  fire.type = 'button';
  fire.className = 'sm-touch__fire';
  fire.setAttribute('aria-label', t('ui.touch.fire'));

  root.appendChild(stick);
  root.appendChild(fire);
  container.appendChild(root);

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

  let firePointerId: number | null = null;

  function onFireDown(ev: PointerEvent): void {
    if (firePointerId !== null) return;
    firePointerId = ev.pointerId;
    capturePointer(fire, ev.pointerId);
  }

  function onFireRelease(ev: PointerEvent): void {
    if (firePointerId !== ev.pointerId) return;
    firePointerId = null;
  }

  stick.addEventListener('pointerdown', onStickDown);
  stick.addEventListener('pointermove', onStickMove);
  stick.addEventListener('pointerup', onStickRelease);
  stick.addEventListener('pointercancel', onStickRelease);
  fire.addEventListener('pointerdown', onFireDown);
  fire.addEventListener('pointerup', onFireRelease);
  fire.addEventListener('pointercancel', onFireRelease);

  return {
    axes(): readonly number[] {
      return axesValue ?? [];
    },
    buttonsDown(): ReadonlySet<string> {
      return firePointerId !== null ? new Set(['fire']) : NO_BUTTONS_DOWN;
    },
    destroy(): void {
      stick.removeEventListener('pointerdown', onStickDown);
      stick.removeEventListener('pointermove', onStickMove);
      stick.removeEventListener('pointerup', onStickRelease);
      stick.removeEventListener('pointercancel', onStickRelease);
      fire.removeEventListener('pointerdown', onFireDown);
      fire.removeEventListener('pointerup', onFireRelease);
      fire.removeEventListener('pointercancel', onFireRelease);
      root.remove();
    },
  };
}
