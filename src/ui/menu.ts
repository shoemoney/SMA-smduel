/**
 * Reusable numbered-menu widget for building interiors: numbered actions, a
 * persistent money/date header, eligibility messages, and Confirm/Back —
 * driven entirely by arrow keys and number keys. The HUD and building
 * screens both mount this instead of rolling their own menu handling.
 *
 * Like `@/ui/builder`, this splits into a pure state/reducer core
 * (`createMenu`, `handleMenuKey`) that's unit-testable without a DOM, and a
 * thin DOM layer (`mountMenu`).
 */
import { formatDate } from '@/sim/calendar';
import type { DayPhase } from '@/sim/types';
import { t } from '@/ui/strings';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface MenuAction {
  readonly id: string;
  readonly label: string;
  readonly eligible: boolean;
  readonly reason?: string;
}

export interface MenuState {
  readonly actions: readonly MenuAction[];
  readonly selectedIndex: number;
  readonly message: string | null;
}

export interface MenuHeaderInfo {
  readonly cash: number;
  readonly dayIndex: number;
  readonly phase: DayPhase;
  readonly cityName?: string;
}

export type MenuOutcome = { readonly kind: 'NONE' } | { readonly kind: 'ACTIVATE'; readonly id: string } | { readonly kind: 'BACK' };

export interface MenuKeyResult {
  readonly state: MenuState;
  readonly outcome: MenuOutcome;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index));
}

/** Selects the first eligible action by default, or index 0 if none are eligible. */
export function createMenu(actions: readonly MenuAction[]): MenuState {
  const firstEligible = actions.findIndex((a) => a.eligible);
  return {
    actions,
    selectedIndex: firstEligible >= 0 ? firstEligible : 0,
    message: null,
  };
}

/** Replaces the action list in place (e.g. eligibility changed) while keeping selection in range. */
export function setMenuActions(state: MenuState, actions: readonly MenuAction[]): MenuState {
  return { actions, selectedIndex: clampIndex(state.selectedIndex, actions.length), message: null };
}

function activate(state: MenuState, index: number): MenuKeyResult {
  const action = state.actions[index];
  if (action === undefined) return { state, outcome: { kind: 'NONE' } };
  if (!action.eligible) {
    const reason = action.reason ?? t('ui.menu.actionUnavailable', { label: action.label });
    return { state: { ...state, selectedIndex: index, message: reason }, outcome: { kind: 'NONE' } };
  }
  return { state: { ...state, selectedIndex: index, message: null }, outcome: { kind: 'ACTIVATE', id: action.id } };
}

/**
 * The player pointed at row `index` (a tap or a click). Routes through the
 * SAME `activate` as a digit key, so an ineligible row answers a tap with the
 * identical refusal message it answers a digit with — there is no second
 * eligibility rule to drift out of sync.
 */
export function handleMenuPointer(state: MenuState, index: number): MenuKeyResult {
  return activate(state, index);
}

const DIGIT_RE = /^[0-9]$/;

/**
 * Maps one keyboard key to a state transition plus an outcome the caller
 * acts on (ACTIVATE an action's id, or BACK out of the menu). Arrow keys
 * move the selection; number keys 1-9 jump straight to and activate that
 * action (0 is the 10th); Enter activates the current selection; Escape and
 * Backspace both back out.
 */
export function handleMenuKey(state: MenuState, key: string): MenuKeyResult {
  if (key === 'ArrowUp') {
    const selectedIndex = clampIndex(state.selectedIndex - 1, state.actions.length);
    return { state: { ...state, selectedIndex, message: null }, outcome: { kind: 'NONE' } };
  }
  if (key === 'ArrowDown') {
    const selectedIndex = clampIndex(state.selectedIndex + 1, state.actions.length);
    return { state: { ...state, selectedIndex, message: null }, outcome: { kind: 'NONE' } };
  }
  if (key === 'Enter') {
    return activate(state, state.selectedIndex);
  }
  if (key === 'Escape' || key === 'Backspace') {
    return { state: { ...state, message: null }, outcome: { kind: 'BACK' } };
  }
  if (DIGIT_RE.test(key)) {
    const digit = Number.parseInt(key, 10);
    const index = digit === 0 ? 9 : digit - 1;
    if (index < 0 || index >= state.actions.length) return { state, outcome: { kind: 'NONE' } };
    return activate(state, index);
  }
  return { state, outcome: { kind: 'NONE' } };
}

/** Pure header text: "$cash | YYYY-MM-DD (PHASE) — City". */
export function renderHeaderText(info: MenuHeaderInfo): string {
  const date = formatDate(info.dayIndex);
  const money = `$${info.cash.toLocaleString('en-US')}`;
  const place = info.cityName !== undefined ? ` — ${info.cityName}` : '';
  return `${money}  |  ${date} (${info.phase})${place}`;
}

// ---------------------------------------------------------------------------
// DOM layer
// ---------------------------------------------------------------------------

export interface MenuMountOptions {
  readonly container: HTMLElement;
  readonly header: MenuHeaderInfo;
  /**
   * Whether to render the money/date header at all.
   *
   * It is genuinely useful on the in-run menus, where it is persistent status a
   * player wants while choosing. It is pure noise on the TITLE screen, where no
   * run is in progress: a review called the line "an unprompted debug-style text
   * block ($9 | 2030-01-01 (DAY) - smduel) placed over the primary menu" and said
   * it "makes the game look unfinished and confuses players about whether the
   * text is part of intended UI or a glitch".
   *
   * It read as a debug readout because that is effectively what it was — a
   * session header describing a session that does not exist yet, with a starting
   * balance of $9 and a day-zero date. Defaults to true so every existing caller
   * is unchanged.
   */
  readonly showHeader?: boolean;
  readonly actions: readonly MenuAction[];
  readonly onActivate: (id: string) => void;
  readonly onBack: () => void;
}

export interface MountedMenu {
  setActions(actions: readonly MenuAction[]): void;
  setHeader(header: MenuHeaderInfo): void;
  destroy(): void;
}

function buildMenuDom(
  state: MenuState,
  header: MenuHeaderInfo,
  onRowActivate: (index: number) => void,
  showHeader: boolean,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'sm-menu';

  if (showHeader) {
    const headerEl = document.createElement('div');
    headerEl.className = 'sm-menu__header';
    headerEl.textContent = renderHeaderText(header);
    root.appendChild(headerEl);
  }

  const list = document.createElement('ol');
  list.className = 'sm-menu__list';
  state.actions.forEach((action, index) => {
    const item = document.createElement('li');
    item.className = 'sm-menu__item';
    if (index === state.selectedIndex) item.classList.add('sm-menu__item--selected');
    if (!action.eligible) item.classList.add('sm-menu__item--ineligible');
    // Not `tabindex` on the row: `mountMenu` focuses the CONTAINER, which owns
    // keydown, so a tab-stopped row could take a stray Enter while a
    // different row is `state.selectedIndex` — the exact divergence a tap
    // must not introduce.
    item.setAttribute('role', 'button');
    if (index === state.selectedIndex) item.setAttribute('aria-selected', 'true');
    if (!action.eligible) item.setAttribute('aria-disabled', 'true');
    item.addEventListener('click', () => onRowActivate(index));

    // Only the first 10 rows are reachable by a single digit key at all
    // (1-9, then 0 for the 10th): handleMenuKey below maps digit d to index
    // d-1 (0 -> index 9) and has no digit for index >= 10. Labeling an 11th+
    // row via `% 10` would repeat an earlier row's own digit, making that
    // digit key silently activate the wrong row.
    const number = document.createElement('span');
    number.className = 'sm-menu__number';
    number.textContent = index < 10 ? String((index + 1) % 10) : '';
    item.appendChild(number);

    const label = document.createElement('span');
    label.className = 'sm-menu__label';
    label.textContent = action.label;
    item.appendChild(label);

    // Callers pass `reason: label` whenever the whole sentence IS the notice
    // (the arena's standing championship schedule, the stub building's
    // "not open yet" line). Those rows would print the same text twice, so
    // compare before adding a second copy. Exact equality, not a normalized
    // one: a reason that merely differs in spacing is still its own
    // explanation and must stay visible.
    if (!action.eligible && action.reason !== undefined && action.reason !== action.label) {
      const reason = document.createElement('span');
      reason.className = 'sm-menu__reason';
      reason.textContent = action.reason;
      item.appendChild(reason);
    }

    list.appendChild(item);
  });
  root.appendChild(list);

  if (state.message !== null) {
    const message = document.createElement('div');
    message.className = 'sm-menu__message';
    message.textContent = state.message;
    root.appendChild(message);
  }

  return root;
}

/**
 * Wires the pure reducer above to a container element: renders the header +
 * numbered list, listens for keydown on the container, and calls
 * `onActivate` / `onBack`.
 */
export function mountMenu(options: MenuMountOptions): MountedMenu {
  let state = createMenu(options.actions);
  let header = options.header;

  function render(): void {
    options.container.innerHTML = '';
    options.container.appendChild(buildMenuDom(state, header, onRowActivate, options.showHeader !== false));
  }

  function onKeyDown(ev: KeyboardEvent): void {
    const result = handleMenuKey(state, ev.key);
    state = result.state;
    ev.preventDefault();
    // ACTIVATE/BACK hand control back to the host (run the action, navigate
    // away) — it owns `options.container` from here, so we must not
    // re-render over whatever screen it just put there.
    if (result.outcome.kind === 'ACTIVATE') {
      options.onActivate(result.outcome.id);
      return;
    }
    if (result.outcome.kind === 'BACK') {
      options.onBack();
      return;
    }
    render();
  }

  function onRowActivate(index: number): void {
    const result = handleMenuPointer(state, index);
    state = result.state;
    // Same "don't re-render over the host's own callback" discipline as
    // onKeyDown above.
    if (result.outcome.kind === 'ACTIVATE') {
      options.onActivate(result.outcome.id);
      return;
    }
    if (result.outcome.kind === 'BACK') {
      options.onBack();
      return;
    }
    render();
  }

  options.container.tabIndex = 0;
  options.container.classList.add('sm-menu-root');
  options.container.addEventListener('keydown', onKeyDown);
  render();
  options.container.focus();

  return {
    setActions(actions: readonly MenuAction[]): void {
      state = setMenuActions(state, actions);
      render();
    },
    setHeader(nextHeader: MenuHeaderInfo): void {
      header = nextHeader;
      render();
    },
    destroy(): void {
      options.container.removeEventListener('keydown', onKeyDown);
      options.container.innerHTML = '';
      options.container.classList.remove('sm-menu-root');
      options.container.removeAttribute('tabindex');
    },
  };
}
