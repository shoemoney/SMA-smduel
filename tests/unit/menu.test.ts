/**
 * menu.ts unit tests.
 *
 * Before this file, menu.ts (227 lines, five exported symbols) had zero
 * tests and zero callers anywhere in the codebase — exactly how the
 * `(index + 1) % 10` row-numbering bug shipped unnoticed. This file covers
 * the pure reducer core directly, then the DOM layer (`mountMenu`) against a
 * minimal fake `document`, matching the approach `builder.test.ts` uses for
 * `mountBuilder` — no jsdom/happy-dom is installed and the project's vitest
 * environment is plain `node` (see vite.config.ts, out of scope to change
 * here).
 */
import { describe, expect, it } from 'vitest';
import {
  createMenu,
  handleMenuKey,
  mountMenu,
  renderHeaderText,
  setMenuActions,
  type MenuAction,
  type MenuHeaderInfo,
  type MenuState,
} from '@/ui/menu';

function action(id: string, overrides: Partial<MenuAction> = {}): MenuAction {
  return { id, label: `Label ${id}`, eligible: true, ...overrides };
}

function header(overrides: Partial<MenuHeaderInfo> = {}): MenuHeaderInfo {
  return { cash: 2000, dayIndex: 0, phase: 'DAY', ...overrides };
}

// ---------------------------------------------------------------------------
// createMenu / setMenuActions
// ---------------------------------------------------------------------------

describe('menu — createMenu', () => {
  it('selects the first eligible action by default', () => {
    const actions = [action('a0', { eligible: false }), action('a1', { eligible: false }), action('a2')];
    const state = createMenu(actions);
    expect(state.selectedIndex).toBe(2);
    expect(state.message).toBeNull();
  });

  it('falls back to index 0 when no action is eligible', () => {
    const actions = [action('a0', { eligible: false }), action('a1', { eligible: false })];
    const state = createMenu(actions);
    expect(state.selectedIndex).toBe(0);
  });
});

describe('menu — setMenuActions', () => {
  it('clamps the selection into the new list and clears any message', () => {
    const state: MenuState = { actions: [action('a0'), action('a1'), action('a2')], selectedIndex: 2, message: 'stale' };
    const next = setMenuActions(state, [action('b0')]);
    expect(next.selectedIndex).toBe(0);
    expect(next.message).toBeNull();
    expect(next.actions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// handleMenuKey — navigation
// ---------------------------------------------------------------------------

describe('menu — handleMenuKey navigation', () => {
  it('ArrowDown/ArrowUp move the selection and clamp at both ends', () => {
    const actions = [action('a0'), action('a1'), action('a2')];
    let state = createMenu(actions);
    expect(state.selectedIndex).toBe(0);

    state = handleMenuKey(state, 'ArrowDown').state;
    expect(state.selectedIndex).toBe(1);
    state = handleMenuKey(state, 'ArrowDown').state;
    state = handleMenuKey(state, 'ArrowDown').state; // one past the end
    expect(state.selectedIndex).toBe(2);

    state = handleMenuKey(state, 'ArrowUp').state;
    state = handleMenuKey(state, 'ArrowUp').state;
    state = handleMenuKey(state, 'ArrowUp').state; // one past the start
    expect(state.selectedIndex).toBe(0);
  });

  it('Escape and Backspace both back out without changing the selection', () => {
    const actions = [action('a0'), action('a1')];
    let state = createMenu(actions);
    state = handleMenuKey(state, 'ArrowDown').state;

    const viaEscape = handleMenuKey(state, 'Escape');
    expect(viaEscape.outcome).toEqual({ kind: 'BACK' });
    expect(viaEscape.state.selectedIndex).toBe(1);

    const viaBackspace = handleMenuKey(state, 'Backspace');
    expect(viaBackspace.outcome).toEqual({ kind: 'BACK' });
  });
});

// ---------------------------------------------------------------------------
// handleMenuKey — activation
// ---------------------------------------------------------------------------

describe('menu — handleMenuKey activation', () => {
  it('Enter activates the currently selected eligible action', () => {
    const actions = [action('a0'), action('a1')];
    let state = createMenu(actions);
    state = handleMenuKey(state, 'ArrowDown').state;

    const result = handleMenuKey(state, 'Enter');
    expect(result.outcome).toEqual({ kind: 'ACTIVATE', id: 'a1' });
  });

  it('Enter on an ineligible action sets its reason as the message and does not activate', () => {
    const actions = [action('a0', { eligible: false, reason: 'too poor' })];
    const state = createMenu(actions);

    const result = handleMenuKey(state, 'Enter');
    expect(result.outcome).toEqual({ kind: 'NONE' });
    expect(result.state.message).toBe('too poor');
  });

  it('a digit key jumps straight to and activates that 1-based row (digit 0 is the 10th row)', () => {
    const actions = Array.from({ length: 10 }, (_, i) => action(`a${i}`));
    const state = createMenu(actions);

    expect(handleMenuKey(state, '1').outcome).toEqual({ kind: 'ACTIVATE', id: 'a0' });
    expect(handleMenuKey(state, '9').outcome).toEqual({ kind: 'ACTIVATE', id: 'a8' });
    expect(handleMenuKey(state, '0').outcome).toEqual({ kind: 'ACTIVATE', id: 'a9' });
  });

  it('a digit with no corresponding row is a no-op, not an activation of some other row', () => {
    const actions = [action('a0'), action('a1')];
    const state = createMenu(actions);

    const result = handleMenuKey(state, '5');
    expect(result.outcome).toEqual({ kind: 'NONE' });
    expect(result.state).toBe(state);
  });

  it('an 11th+ action has no reachable digit key at all — every digit 0-9 stays mapped to rows 0-9', () => {
    const actions = Array.from({ length: 12 }, (_, i) => action(`a${i}`));
    const state = createMenu(actions);

    // Digits 1-9 and 0 must always resolve to indices 0-9, never to the 11th
    // (index 10) or 12th (index 11) row — those are only reachable by arrow
    // keys + Enter, exactly matching what the DOM layer is allowed to label.
    for (let digit = 1; digit <= 9; digit += 1) {
      const outcome = handleMenuKey(state, String(digit)).outcome;
      expect(outcome).toEqual({ kind: 'ACTIVATE', id: `a${digit - 1}` });
    }
    expect(handleMenuKey(state, '0').outcome).toEqual({ kind: 'ACTIVATE', id: 'a9' });
  });
});

// ---------------------------------------------------------------------------
// renderHeaderText
// ---------------------------------------------------------------------------

describe('menu — renderHeaderText', () => {
  it('formats cash, date and phase, with no city segment when cityName is absent', () => {
    const text = renderHeaderText(header({ cash: 12345, dayIndex: 0, phase: 'DAY' }));
    expect(text).toBe('$12,345  |  2030-01-01 (DAY)');
  });

  it('appends " — City" when cityName is present', () => {
    const text = renderHeaderText(header({ cash: 0, dayIndex: 1, phase: 'NIGHT', cityName: 'New York' }));
    expect(text).toBe('$0  |  2030-01-02 (NIGHT) — New York');
  });
});

// ---------------------------------------------------------------------------
// DOM layer (mountMenu)
// ---------------------------------------------------------------------------

class FakeClassList {
  private readonly names = new Set<string>();
  add(...values: string[]): void {
    for (const value of values) this.names.add(value);
  }
  remove(...values: string[]): void {
    for (const value of values) this.names.delete(value);
  }
  contains(value: string): boolean {
    return this.names.has(value);
  }
}

interface FakeKeyEvent {
  readonly key: string;
  preventDefault(): void;
}

function fakeKeyEvent(key: string): FakeKeyEvent {
  return { key, preventDefault(): void {} };
}

class FakeElement {
  readonly tagName: string;
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  className = '';
  textContent = '';
  private _tabIndex = -1;
  private readonly attrs = new Set<string>();
  private readonly listeners = new Map<string, Array<(ev: FakeKeyEvent) => void>>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  appendChild(child: FakeElement): void {
    this.children.push(child);
  }
  set innerHTML(value: string) {
    if (value === '') this.children.length = 0;
  }
  get innerHTML(): string {
    return '';
  }
  get tabIndex(): number {
    return this._tabIndex;
  }
  set tabIndex(value: number) {
    this._tabIndex = value;
    this.attrs.add('tabindex');
  }
  setAttribute(name: string): void {
    this.attrs.add(name);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name === 'tabindex') this._tabIndex = -1;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  addEventListener(type: string, handler: (ev: FakeKeyEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, handler: (ev: FakeKeyEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((h) => h !== handler),
    );
  }
  dispatch(type: string, ev: FakeKeyEvent): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(ev);
  }
  focus(): void {}

  /** Depth-first walk of every descendant, including this element. */
  *walk(): Generator<FakeElement> {
    yield this;
    for (const child of this.children) yield* child.walk();
  }
}

function installFakeDom(): void {
  const fakeDocument = { createElement: (tag: string): FakeElement => new FakeElement(tag) };
  (globalThis as unknown as { document: unknown }).document = fakeDocument;
}

/** Every `sm-menu__item`, in row order, alongside its rendered number label. */
function readRenderedRows(root: FakeElement): Array<{ number: string; label: string }> {
  const items = [...root.walk()].filter((el) => el.tagName === 'LI');
  return items.map((item) => {
    const number = item.children.find((c) => c.className === 'sm-menu__number');
    const label = item.children.find((c) => c.className === 'sm-menu__label');
    return { number: number?.textContent ?? '', label: label?.textContent ?? '' };
  });
}

describe('menu — mountMenu DOM layer', () => {
  it('every rendered digit label activates exactly the row it is printed on, for 12 actions', () => {
    installFakeDom();
    const container = new FakeElement('div');
    const activated: string[] = [];
    const actions = Array.from({ length: 12 }, (_, i) => action(`a${i}`));

    mountMenu({
      container: container as unknown as HTMLElement,
      header: header(),
      actions,
      onActivate: (id) => activated.push(id),
      onBack: () => {},
    });

    const root = container.children[0];
    if (root === undefined) throw new Error('mountMenu did not render anything');
    const rows = readRenderedRows(root);
    expect(rows).toHaveLength(12);

    // Rows 0-9 each print a distinct, non-empty digit; rows 10-11 (no
    // reachable digit key) must print nothing, never a repeat of an earlier
    // row's digit.
    const digitsShown = rows.slice(0, 10).map((r) => r.number);
    expect(new Set(digitsShown).size).toBe(10);
    expect(rows[10]?.number).toBe('');
    expect(rows[11]?.number).toBe('');

    for (const row of rows) {
      if (row.number === '') continue;
      activated.length = 0;
      container.dispatch('keydown', fakeKeyEvent(row.number));
      expect(activated).toEqual([`a${rows.indexOf(row)}`]);
    }
  });

  it('does not re-render over the screen its own onActivate/onBack callback just installed', () => {
    installFakeDom();

    for (const key of ['1', 'Escape']) {
      const container = new FakeElement('div');
      const hostMarkers: FakeElement[] = [];
      const installHostMarker = (): void => {
        container.innerHTML = '';
        const marker = new FakeElement('div');
        marker.className = 'host-marker';
        container.appendChild(marker);
        hostMarkers.push(marker);
      };

      mountMenu({
        container: container as unknown as HTMLElement,
        header: header(),
        actions: [action('a0')],
        onActivate: installHostMarker,
        onBack: installHostMarker,
      });

      container.dispatch('keydown', fakeKeyEvent(key));

      expect(container.children).toHaveLength(1);
      expect(container.children[0]).toBe(hostMarkers[0]);
    }
  });

  it('destroy() clears the DOM and the classes/attributes it added, not just the listener', () => {
    installFakeDom();
    const container = new FakeElement('div');
    const mounted = mountMenu({
      container: container as unknown as HTMLElement,
      header: header(),
      actions: [action('a0')],
      onActivate: () => {},
      onBack: () => {},
    });

    expect(container.children.length).toBeGreaterThan(0);
    expect(container.classList.contains('sm-menu-root')).toBe(true);

    mounted.destroy();

    expect(container.children).toHaveLength(0);
    expect(container.classList.contains('sm-menu-root')).toBe(false);
    expect(container.hasAttribute('tabindex')).toBe(false);
  });
});
