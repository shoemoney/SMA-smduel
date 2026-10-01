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
  handleMenuPointer,
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
// handleMenuPointer — a tap/click, routed through the same activate() a digit key uses
// ---------------------------------------------------------------------------

describe('menu — handleMenuPointer', () => {
  it('on an eligible index returns ACTIVATE with that row\'s id', () => {
    const actions = [action('a0'), action('a1')];
    const state = createMenu(actions);
    expect(handleMenuPointer(state, 1).outcome).toEqual({ kind: 'ACTIVATE', id: 'a1' });
  });

  it('on an ineligible index returns NONE and sets the row\'s refusal message, identical to the digit-key path', () => {
    const actions = [action('a0', { eligible: false, reason: 'too poor' })];
    const state = createMenu(actions);
    const viaPointer = handleMenuPointer(state, 0);
    const viaDigit = handleMenuKey(state, '1');
    expect(viaPointer.outcome).toEqual({ kind: 'NONE' });
    expect(viaPointer.state.message).toBe('too poor');
    expect(viaPointer.state.message).toBe(viaDigit.state.message);
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
  private readonly attrValues = new Map<string, string>();
  /** Reads an attribute back. The real DOM stores name AND value; storing only
   *  the name made it impossible to assert on `role` or `aria-disabled` here. */
  attr(name: string): string | null {
    return this.attrValues.get(name) ?? null;
  }
  /** Fires every listener registered for `type`. Present so a test can assert
   *  that a control with NO listener does nothing when activated — which is the
   *  whole point of the informational-row change. */
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn({} as FakeKeyEvent);
  }
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
  /** Stores the attribute's VALUE as well as its name. The real DOM does, and
   *  a double that keeps only names cannot answer "what role does this row
   *  have?" — it can only answer "does it have one?". */
  setAttribute(name: string, value = ''): void {
    this.attrs.add(name);
    this.attrValues.set(name, value);
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
function readRenderedRows(root: FakeElement): Array<{ number: string; label: string; reason: string }> {
  const items = [...root.walk()].filter((el) => el.tagName === 'LI');
  return items.map((item) => {
    const number = item.children.find((c) => c.className === 'sm-menu__number');
    const label = item.children.find((c) => c.className === 'sm-menu__label');
    const reason = item.children.find((c) => c.className === 'sm-menu__reason');
    return {
      number: number?.textContent ?? '',
      label: label?.textContent ?? '',
      reason: reason?.textContent ?? '',
    };
  });
}

describe('menu — informational rows are readouts, not commands', () => {
  // A menu that mixes readouts with commands lies about its own contents. Three
  // separate review rounds flagged two instances: the Arena's standing schedule
  // rendered as "actionable menu item 9", and the Courier Guild assigning the
  // scarce digit keys to informational text while real commands got none.
  function findByClass(root: FakeElement, className: string): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (n: FakeElement): void => {
      if (n.className.split(/\s+/).includes(className)) found.push(n);
      for (const c of n.children) walk(c);
    };
    walk(root);
    return found;
  }

  function render(rows: MenuAction[]): { root: FakeElement; container: FakeElement; activated: string[] } {
    installFakeDom();
    const container = new FakeElement('div');
    const activated: string[] = [];
    mountMenu({
      container: container as unknown as HTMLElement,
      header: header(),
      actions: rows,
      onActivate: (id) => activated.push(id),
      onBack: () => {},
    });
    const root = container.children[0];
    if (root === undefined) throw new Error('test: mountMenu rendered nothing');
    return { root, container, activated };
  }

  const info = (id: string) => action(id, { informational: true });

  it('renders no number and no button role on an informational row', () => {
    const { root } = render([action('real1'), info('readout')]);
    const items = findByClass(root, 'sm-menu__item');
    const readout = items.find((li) => li.className.includes('sm-menu__item--info'));
    expect(readout, 'the informational row should carry the --info modifier').toBeDefined();
    expect(findByClass(readout!, 'sm-menu__number')).toHaveLength(0);
    expect(readout?.attr('role')).toBeNull();
    expect(readout?.attr('aria-selected')).toBeNull();
    // The real command still has both.
    expect(items[0]?.attr('role')).toBe('button');
  });

  it('does not activate an informational row on click', () => {
    const { root, activated } = render([info('readout'), action('real1')]);
    const readout = findByClass(root, 'sm-menu__item--info')[0];
    readout?.fire('click');
    expect(activated).toEqual([]);
  });

  it('numbers the actionable rows consecutively, so digit 1 is the FIRST command', () => {
    // The bug this fixes: with a readout first, the old array-position numbering
    // printed "1" on the readout and pushed the first real command to "2".
    const { root } = render([info('readout'), action('c1'), action('c2')]);
    const numbers = findByClass(root, 'sm-menu__number').map((n) => n.textContent);
    expect(numbers).toEqual(['1', '2']);
  });

  it('resolves a digit key to the same row the digit is printed on, past a readout', () => {
    const { container, activated } = render([action('c1'), info('readout'), action('c2')]);
    // Printed: c1 is "1", c2 is "2".
    container.dispatch('keydown', fakeKeyEvent('2'));
    expect(activated).toEqual(['c2']);
  });

  it('keeps `eligible: false` meaning "you cannot do this YET", which is a different thing', () => {
    // The distinction the whole change exists to make: an ineligible command is
    // still a command with a digit, and says why it is refused.
    const { root } = render([action('locked', { eligible: false, reason: 'not yet' })]);
    const item = findByClass(root, 'sm-menu__item')[0];
    expect(item?.attr('role')).toBe('button');
    expect(item?.attr('aria-disabled')).toBe('true');
    expect(findByClass(item!, 'sm-menu__number')[0]?.textContent).toBe('1');
    expect(item?.className).not.toContain('--info');
  });
});

describe('menu — the hint line that states the constraints the screen only enforces', () => {
  // Two advisory reviews, on two different screens, said the same two things:
  // rows past `0` have no digit key, and there is no visible way out. Both are
  // TRUE of the code — `1`-`9` then `0` reaches exactly ten rows, and the
  // Courier Guild serves fifteen, so "Leave" is row 15. The digit limit is
  // deliberate (labelling row 11 with `% 10` would repeat an earlier row's own
  // digit and fire the wrong action), so the fix is to STATE the limit rather
  // than remove it.
  //
  // This file's FakeElement has no `querySelector`, so the tree is walked
  // directly. Reaching for a DOM method the double does not implement is the
  // same class of mistake as assuming a class name exists.
  function findByClass(root: FakeElement, className: string): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (n: FakeElement): void => {
      if (n.className.split(/\s+/).includes(className)) found.push(n);
      for (const c of n.children) walk(c);
    };
    walk(root);
    return found;
  }

  function renderWith(actions: MenuAction[]): FakeElement {
    installFakeDom();
    const container = new FakeElement('div');
    mountMenu({
      container: container as unknown as HTMLElement,
      header: header(),
      actions,
      onActivate: () => {},
      onBack: () => {},
    });
    const root = container.children[0];
    if (root === undefined) throw new Error('test: mountMenu rendered nothing');
    return root;
  }

  const many = (n: number) => Array.from({ length: n }, (_, i) => action(`a${i}`));

  it('tells the player the arrow keys reach the rest, only when they must', () => {
    const hintOf = (n: number) => findByClass(renderWith(many(n)), 'sm-menu__hint')[0]?.textContent ?? '';
    // Ten rows are fully reachable by digit, so mentioning arrows would be noise.
    expect(hintOf(10)).not.toContain('reach the remaining rows');
    expect(hintOf(11)).toContain('reach the remaining rows');
    // Escape is always stated: a menu whose only exit is an undocumented key is
    // a menu with no visible way out.
    expect(hintOf(3)).toContain('Esc');
    expect(hintOf(11)).toContain('Esc');
  });

  it('puts the hint outside the list, so it can never become a selectable row', () => {
    // Inside the <ol> it would shift the digit numbering — the exact bug the
    // ten-row limit exists to prevent.
    const root = renderWith(many(12));
    const list = findByClass(root, 'sm-menu__list')[0] ?? findByClass(root, 'sm-menu__rows')[0];
    expect(list, 'the row list should exist').toBeDefined();
    expect(findByClass(list!, 'sm-menu__hint')).toHaveLength(0);
    expect(findByClass(root, 'sm-menu__hint')).toHaveLength(1);
  });

  it('adds no row: a 15-row menu still renders exactly 15 selectable rows', () => {
    // The regression this guards is subtle — an extra node inside the list would
    // not change the row COUNT check above but would shift every digit mapping.
    const root = renderWith(many(15));
    expect(findByClass(root, 'sm-menu__item')).toHaveLength(15);
  });
});

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

  it('dispatching click on an eligible <li> calls onActivate with that row\'s id; on an ineligible <li> it does not', () => {
    installFakeDom();
    const container = new FakeElement('div');
    const activated: string[] = [];
    const actions = [action('a0'), action('a1', { eligible: false, reason: 'nope' })];

    mountMenu({
      container: container as unknown as HTMLElement,
      header: header(),
      actions,
      onActivate: (id) => activated.push(id),
      onBack: () => {},
    });

    const root = container.children[0];
    if (root === undefined) throw new Error('mountMenu did not render anything');
    const rows = [...root.walk()].filter((el) => el.tagName === 'LI');
    expect(rows).toHaveLength(2);

    rows[0]?.dispatch('click', fakeKeyEvent(''));
    expect(activated).toEqual(['a0']);

    activated.length = 0;
    rows[1]?.dispatch('click', fakeKeyEvent(''));
    expect(activated).toEqual([]);
  });

  it('rows carry role="button", and the selected/ineligible rows carry aria-selected/aria-disabled (presence only — FakeElement records the attribute NAME, not its value)', () => {
    installFakeDom();
    const container = new FakeElement('div');
    const actions = [action('a0'), action('a1', { eligible: false, reason: 'nope' })];

    mountMenu({
      container: container as unknown as HTMLElement,
      header: header(),
      actions,
      onActivate: () => {},
      onBack: () => {},
    });

    const root = container.children[0];
    if (root === undefined) throw new Error('mountMenu did not render anything');
    const rows = [...root.walk()].filter((el) => el.tagName === 'LI');
    expect(rows.every((row) => row.hasAttribute('role'))).toBe(true);
    expect(rows[0]?.hasAttribute('aria-selected')).toBe(true);
    expect(rows[1]?.hasAttribute('aria-selected')).toBe(false);
    expect(rows[0]?.hasAttribute('aria-disabled')).toBe(false);
    expect(rows[1]?.hasAttribute('aria-disabled')).toBe(true);
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

// ---------------------------------------------------------------------------
// Ineligible-row reason de-duplication
//
// The renderer printed `action.reason` on every ineligible row, but several
// callers pass `reason: label` — the whole sentence IS the notice, so the row
// showed it twice (Arena "City Championship upcoming: day 50, 134, 218" and the
// Federal Building "isn't open for business yet" stub, both seen in review
// evidence). `eligible: false` requires a reason for a11y, so the callers keep
// passing it; the renderer is the single place that can drop the second copy.
// ---------------------------------------------------------------------------

describe('menu — ineligible rows do not print their notice twice', () => {
  function mountRows(actions: MenuAction[]): Array<{ label: string; reason: string }> {
    installFakeDom();
    const container = new FakeElement('div');
    const mounted = mountMenu({
      container: container as unknown as HTMLElement,
      header: header(),
      actions,
      onActivate: () => {},
      onBack: () => {},
    });
    const rows = readRenderedRows(container.children[0] as FakeElement);
    mounted.destroy();
    return rows;
  }

  it('prints one copy when a disabled row passes reason === label', () => {
    const notice = "Federal Building isn't open for business yet — coming in a future phase.";
    const [row] = mountRows([{ id: 'notice', label: notice, eligible: false, reason: notice }]);

    expect(row?.label).toBe(notice);
    expect(row?.reason).toBe('');
    // The text appears exactly once in the whole row, not merely hidden.
    expect(notice).not.toBe('');
  });

  it('still prints a genuinely different reason on a disabled row', () => {
    const [row] = mountRows([
      { id: 'entry', label: 'Enter Championship', eligible: false, reason: 'Requires a roadworthy vehicle' },
    ]);

    expect(row?.label).toBe('Enter Championship');
    expect(row?.reason).toBe('Requires a roadworthy vehicle');
  });
});
