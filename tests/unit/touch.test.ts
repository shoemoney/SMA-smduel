// @vitest-environment happy-dom
/**
 * `src/ui/touch.ts` unit tests. happy-dom, not the plain `node` environment
 * the rest of `tests/unit/**` uses (see `vite.config.ts`), because
 * `mountTouchControls` needs a real `document`/`window` and real
 * `PointerEvent`s — but this is pure event plumbing, no layout, so unlike
 * `menu.css`/`touch.css` there IS an automated guard here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mountTouchControls, type TouchControls } from '@/ui/touch';

describe('mountTouchControls: a release the stick element never sees still recentres it', () => {
  let container: HTMLElement;
  let originalMatchMedia: typeof window.matchMedia;
  let originalSetPointerCapture: typeof HTMLElement.prototype.setPointerCapture;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({ matches: true, media: query }) as MediaQueryList) as typeof window.matchMedia;

    // Simulates a host where `setPointerCapture` doesn't work — exactly the
    // case `capturePointer`'s catch branch swallows. `capturePointer`
    // already guards a THROWING capture; this is what forces that branch
    // rather than the happy-path.
    originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    HTMLElement.prototype.setPointerCapture = () => {
      throw new Error('test: setPointerCapture unavailable on this host');
    };
  });

  afterEach(() => {
    container.remove();
    window.matchMedia = originalMatchMedia;
    HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
  });

  it('a pointerup dispatched on window (never bubbling through the stick) zeroes axes(), instead of leaving the last reading stuck forever', () => {
    const touch = mountTouchControls(container, { fire: true });
    if (touch === null) throw new Error('test: expected mountTouchControls to mount under the coarse-pointer stub');

    const stick = container.querySelector('.sm-touch__stick');
    if (stick === null) throw new Error('test: expected a mounted .sm-touch__stick element');

    stick.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));
    stick.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 20, clientY: 0, bubbles: true }));
    expect(touch.axes()).not.toEqual([]);
    expect(touch.axes()[0]).toBeGreaterThan(0);

    // A real browser delivers this pointerup wherever the thumb physically
    // lifted, not necessarily over `stick` — dispatching it directly on
    // `window` (which never bubbles DOWN into `stick`'s own listeners) is
    // the faithful stand-in for that, and is exactly the case capture
    // failing to retarget produces.
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

    expect(touch.axes()).toEqual([]);
  });

  it('the same holds for the fire button: a pointerup on window clears it out of buttonsDown()', () => {
    const touch = mountTouchControls(container, { fire: true }) as TouchControls;
    const fire = container.querySelector('.sm-touch__fire');
    if (fire === null) throw new Error('test: expected a mounted .sm-touch__fire element');

    fire.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true }));
    expect(touch.buttonsDown().has('fire')).toBe(true);

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, bubbles: true }));

    expect(touch.buttonsDown().has('fire')).toBe(false);
  });
});
