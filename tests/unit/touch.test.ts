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
import { t } from '@/ui/strings';

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

describe('mountTouchControls: fixed-hotkey command buttons', () => {
  let container: HTMLElement;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({ matches: true, media: query }) as MediaQueryList) as typeof window.matchMedia;
  });

  afterEach(() => {
    container.remove();
    window.matchMedia = originalMatchMedia;
  });

  it('a command button renders with its t() label as aria-label, and pressing it calls onPress exactly once', () => {
    let pressCount = 0;
    const touch = mountTouchControls(container, {
      fire: true,
      commands: [{ id: 'enterExitCar', labelKey: 'ui.touch.enterExitCar', onPress: () => (pressCount += 1) }],
    });
    if (touch === null) throw new Error('test: expected mountTouchControls to mount under the coarse-pointer stub');

    const btn = container.querySelector('[data-touch-command="enterExitCar"]');
    if (btn === null) throw new Error('test: expected a mounted command button for "enterExitCar"');
    expect(btn.getAttribute('aria-label')).toBe(t('ui.touch.enterExitCar'));

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(pressCount).toBe(1);

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(pressCount).toBe(2);
  });

  it('setCommandVisible hides and shows a command, and initiallyVisible: false starts hidden', () => {
    const touch = mountTouchControls(container, {
      fire: true,
      commands: [
        { id: 'fleet', labelKey: 'ui.touch.fleet', onPress: () => {} },
        { id: 'searchWreck', labelKey: 'ui.touch.searchWreck', onPress: () => {}, initiallyVisible: false },
      ],
    });
    if (touch === null) throw new Error('test: expected mountTouchControls to mount under the coarse-pointer stub');

    const fleetBtn = container.querySelector<HTMLButtonElement>('[data-touch-command="fleet"]');
    const wreckBtn = container.querySelector<HTMLButtonElement>('[data-touch-command="searchWreck"]');
    if (fleetBtn === null || wreckBtn === null) throw new Error('test: expected both command buttons to be mounted');

    expect(fleetBtn.hidden).toBe(false);
    expect(wreckBtn.hidden).toBe(true);

    touch.setCommandVisible('fleet', false);
    expect(fleetBtn.hidden).toBe(true);

    touch.setCommandVisible('searchWreck', true);
    expect(wreckBtn.hidden).toBe(false);
  });

  it('an unknown id passed to setCommandVisible does not throw', () => {
    const touch = mountTouchControls(container, { fire: true, commands: [] });
    if (touch === null) throw new Error('test: expected mountTouchControls to mount under the coarse-pointer stub');

    expect(() => touch.setCommandVisible('does-not-exist', true)).not.toThrow();
  });

  it('fire: false renders no fire button, and fire: true renders one', () => {
    const withoutFire = mountTouchControls(container, { fire: false });
    if (withoutFire === null) throw new Error('test: expected mountTouchControls to mount under the coarse-pointer stub');
    expect(container.querySelector('.sm-touch__fire')).toBeNull();
    withoutFire.destroy();

    const withFire = mountTouchControls(container, { fire: true });
    if (withFire === null) throw new Error('test: expected mountTouchControls to mount under the coarse-pointer stub');
    expect(container.querySelector('.sm-touch__fire')).not.toBeNull();
    withFire.destroy();
  });

  it('destroy() removes the command buttons from the DOM and their click listeners stop firing onPress', () => {
    let pressCount = 0;
    const touch = mountTouchControls(container, {
      fire: true,
      commands: [{ id: 'journal', labelKey: 'ui.touch.journal', onPress: () => (pressCount += 1) }],
    });
    if (touch === null) throw new Error('test: expected mountTouchControls to mount under the coarse-pointer stub');

    const btn = container.querySelector('[data-touch-command="journal"]');
    if (btn === null) throw new Error('test: expected a mounted command button for "journal"');

    touch.destroy();
    expect(container.querySelector('[data-touch-command="journal"]')).toBeNull();

    // The saved reference still exists as a detached node — dispatching
    // directly on it (not through `container`) is what proves the click
    // LISTENER was removed, not merely that the node left the DOM (a
    // detached element still fires its own listeners if they were never
    // unregistered).
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(pressCount).toBe(0);
  });
});
