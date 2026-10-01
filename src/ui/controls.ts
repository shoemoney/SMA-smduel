/**
 * Shared form controls.
 *
 * ## Why this module exists
 *
 * There were four hand-built `<input>` elements in this codebase, each created
 * with its own inline `style.cssText`. That is four copies of the same idea and
 * it showed: none of them had a focus ring, none had a hover or disabled state,
 * and the two that were supposed to look like a pair (the driver's name and the
 * arcade score name) had drifted into visibly different boxes. `controls.css`
 * owns the *look*; this module owns the *construction*, so a new field cannot
 * arrive without the icon slot, the focus behaviour and the label wiring that
 * every existing field has.
 *
 * Everything here returns real elements and takes callbacks. Nothing reads or
 * writes a private field of the game state, so a control can be built in a test
 * with no driver, no city and no ruleset.
 */

import { icon, type IconName } from './icons';

export interface FieldOptions {
  /** Visible label. Rendered as a real `<label for>`, not a bare `<span>`. */
  label: string;
  /** Glyph in the field's leading slot. */
  iconName?: IconName;
  /** Input type. `number` gets the spinner-free, centred treatment. */
  type?: 'text' | 'number';
  /** Text shown before anything is typed. */
  placeholder?: string;
  /** Trailing unit, e.g. `kg`. Rendered outside the input so it cannot be typed into. */
  suffix?: string;
  /** Extra element appended after the suffix — a stepper, a hint. */
  adornment?: HTMLElement;
  /** Notified on every keystroke. */
  onInput?: (value: string) => void;
  /** Notified on Enter. Lets a field submit without owning the submit button. */
  onSubmit?: () => void;
  /** Minimum/maximum, for number fields. */
  min?: number;
  max?: number;
  /** Uppercase CSS `maxlength` cap, set on the input itself. */
  maxLength?: number;
  /**
   * `stacked` (the default) puts the label above a full-width field — right for
   * a value the player is invited to type into, like a name.
   *
   * `inline` drops the visible label and the full-width block, leaving a compact
   * box meant to sit at the end of a row that already names the thing. The
   * accessible name moves to `aria-label` rather than disappearing, because
   * "16" with no label is a number a screen-reader user cannot attribute.
   */
  layout?: 'stacked' | 'inline';
}

export interface Field {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  /** Current value, trimmed — the form's notion of "what the player typed". */
  value(): string;
  /** Mark the field invalid and show `reason` beneath it, or clear that state. */
  setError(reason: string | null): void;
}

let fieldSeq = 0;

/**
 * Builds a labelled field: label, icon, input, optional suffix/adornment, and a
 * live error line.
 *
 * The error line is always present in the DOM and only its text changes, so
 * showing a validation failure does not reflow the card the button lives in —
 * a message that appears and disappears changes the button's position under the
 * player's cursor, which is how a click ends up on the wrong control.
 */
export function field(options: FieldOptions): Field {
  const id = `sm-field-${++fieldSeq}`;
  const inline = options.layout === 'inline';

  const label = document.createElement('label');
  label.className = 'sm-field__label';
  label.htmlFor = id;
  label.textContent = options.label;
  label.style.cssText = 'display:block;margin-bottom:6px;font-family:var(--ui-font-display);font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:var(--ui-ink-muted);';

  const root = document.createElement('div');
  root.className = inline ? 'sm-field sm-field--inline' : options.type === 'number' ? 'sm-field sm-field--number' : 'sm-field';

  if (options.iconName !== undefined) {
    const glyph = icon(options.iconName, { className: 'sm-field__icon' });
    root.appendChild(glyph);
  }

  const input = document.createElement('input');
  input.className = 'sm-field__input';
  input.id = id;
  input.type = options.type ?? 'text';
  // `hidden` on a label still exposes it to assistive tech via `for`, which is
  // how the inline variant keeps its accessible name without spending vertical
  // space on a word the surrounding row already says.
  if (inline) {
    label.classList.add('sm-field__label--inline');
    input.setAttribute('aria-label', options.label);
  }
  if (options.placeholder !== undefined) input.placeholder = options.placeholder;
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.maxLength !== undefined) input.maxLength = options.maxLength;
  input.addEventListener('input', () => options.onInput?.(input.value));
  if (options.onSubmit !== undefined) {
    input.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      // The screen has no wrapping <form>, so Enter has no default action of its
      // own. preventDefault stops the browser doing something else with the key
      // (on a number field, that would be incrementing the value).
      ev.preventDefault();
      options.onSubmit?.();
    });
  }
  root.appendChild(input);

  if (options.suffix !== undefined) {
    const suffix = document.createElement('span');
    suffix.className = 'sm-field__suffix';
    suffix.textContent = options.suffix;
    root.appendChild(suffix);
  }
  if (options.adornment !== undefined) root.appendChild(options.adornment);

  const error = document.createElement('div');
  error.className = 'sm-field__error';
  error.style.cssText = 'min-height:1.1em;margin-top:5px;font-size:11px;letter-spacing:0.04em;color:var(--ui-critical);';

  const wrap = document.createElement('div');
  wrap.className = 'sm-field-wrap';
  wrap.appendChild(label);
  wrap.appendChild(root);
  wrap.appendChild(error);

  const setError = (reason: string | null): void => {
    error.textContent = reason ?? '';
    if (reason === null) {
      root.classList.remove('sm-field--invalid');
      // aria-invalid is the programmatic half of the same statement; the red
      // border alone says nothing to a screen reader.
      input.removeAttribute('aria-invalid');
    } else {
      root.classList.add('sm-field--invalid');
      input.setAttribute('aria-invalid', 'true');
    }
  };

  return { root: wrap, input, value: () => input.value.trim(), setError };
}

export interface IgnitionOptions {
  /** The button's text. Read as the switch's own legend. */
  label: string;
  /**
   * Fired after the key has finished turning, not on the raw click. The screen
   * that owns the destination does its work here, so a player cannot skip the
   * animation by clicking twice.
   */
  onIgnite: () => void;
}

/** How long the key turns before the starter engages, in ms. */
const CRANK_MS = 420;

/**
 * The crank duration, as a variable so tests can shorten it.
 *
 * ## Why this is a seam and not just a constant
 *
 * The ignition defers its callback, which is the whole point of it — but it also
 * means "click Create Driver" is no longer synchronous, and six integration
 * files plus the browser harness boot through this exact button and then assert
 * on the NEXT screen immediately. Left alone, every one of those would have to
 * become time-dependent, and a test that waits 420ms of wall clock is a test
 * that can fail on a loaded machine. This repo has spent a dozen iterations
 * removing exactly that class of flake.
 *
 * So the duration is settable, the suite sets it to 0 in `tests/setup/`, and the
 * deferral itself is proven by one test that deliberately sets it back to a real
 * non-zero value. The production default is unchanged and nothing else in the
 * app can reach this.
 */
let crankMs = CRANK_MS;

/** Test seam. See `crankMs`. Returns the value now in force. */
export function setIgnitionCrankMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`setIgnitionCrankMs: expected a non-negative finite ms, got ${ms}`);
  crankMs = ms;
  return crankMs;
}

/**
 * The ignition switch: a real key that turns a quarter turn, a starter that
 * engages, and only then the destination screen.
 *
 * ## Why the delay is deliberate and not a UX papercut
 *
 * The obvious implementation calls `onIgnite` on `click` and animates for show.
 * That makes the animation decorative, and it means a double-click runs the
 * destination twice — which on this screen builds a driver and advances to the
 * constructor, so the second call would either double-construct or land on a
 * screen the player never asked for. Gating the callback on the end of the
 * crank makes the key the thing that starts the car, which is both truer to the
 * metaphor and idempotent for free.
 *
 * Enter on a field is routed to the same path by the caller, so the keyboard
 * route cannot bypass the crank either.
 */
export function ignitionButton(options: IgnitionOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'sm-ignition';
  button.type = 'button';

  const key = icon('key', { className: 'sm-ignition__key' });
  const label = document.createElement('span');
  label.className = 'sm-ignition__label';
  label.textContent = options.label;
  // The car itself. Absent at rest, and it runs when the starter engages: the
  // ask was a switch that "turns over and a car starts", and a key that turns
  // with nothing behind it is only half of that sentence. It is decorative and
  // `aria-hidden` — the label is the accessible name, and an announced graphic
  // beside it would be noise.
  const car = icon('car', { className: 'sm-ignition__car' });
  button.appendChild(key);
  button.appendChild(label);
  button.appendChild(car);

  let timer: ReturnType<typeof setTimeout> | null = null;

  const ignite = (): void => {
    // A duration of zero means "no crank, no deferral" — the callback runs
    // inside the click. This is not a convenience, it is what makes the test
    // seam honest: `setTimeout(fn, 0)` is still a MACROTASK, so a seam that only
    // shortened the delay left every caller that asserts on the next screen one
    // tick early, and eleven integration tests failed exactly that way before
    // this branch existed. Production never takes it (the default is 420ms) and
    // the deferral is proven at a real duration in `controls.test.ts`.
    if (crankMs === 0) {
      options.onIgnite();
      return;
    }
    // `disabled` is the ONLY lock, and it is deliberate. This used to also carry
    // a `cranking` boolean guard, and a mutation that deleted that guard passed
    // every test — because a disabled button does not dispatch clicks at all,
    // DOM-level, so the flag was unreachable protection sitting under a comment
    // that called it load-bearing. One mechanism, and the tests pin this one.
    button.disabled = true;
    button.classList.add('sm-ignition--cranking');
    timer = setTimeout(() => {
      button.classList.remove('sm-ignition--cranking');
      button.disabled = false;
      options.onIgnite();
    }, crankMs);
  };

  button.addEventListener('click', ignite);

  // A test (or a host that tears the screen down mid-crank) must not be able to
  // leave a pending timer that fires `onIgnite` into a destroyed screen.
  button.addEventListener('sm-ignition:cancel', () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    button.classList.remove('sm-ignition--cranking');
    button.disabled = false;
  });

  return button;
}

/** A plain themed button, for the ordinary actions that are not an ignition. */
export function button(
  label: string,
  onClick: () => void,
  options: { variant?: 'primary' | 'danger' | 'default'; iconName?: IconName; id?: string } = {},
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = options.variant === undefined || options.variant === 'default' ? 'sm-btn' : `sm-btn sm-btn--${options.variant}`;
  if (options.id !== undefined) el.id = options.id;
  if (options.iconName !== undefined) el.appendChild(icon(options.iconName, { className: 'sm-btn__icon' }));
  const text = document.createElement('span');
  text.textContent = label;
  el.appendChild(text);
  el.addEventListener('click', onClick);
  return el;
}

/** A titled panel with an icon in its header, for the constructor's sections. */
export function panel(titleText: string, iconName: IconName): { root: HTMLElement; body: HTMLElement } {
  const root = document.createElement('section');
  root.className = 'sm-panel';

  const head = document.createElement('header');
  head.className = 'sm-panel__head';
  head.appendChild(icon(iconName, { className: 'sm-icon' }));
  const title = document.createElement('span');
  title.textContent = titleText;
  head.appendChild(title);

  const body = document.createElement('div');
  body.className = 'sm-panel__body';

  root.appendChild(head);
  root.appendChild(body);
  return { root, body };
}

/**
 * One icon + name + value line, with an optional semantic state class so the
 * value is coloured by meaning rather than left for the player to interpret.
 */
export function stat(
  name: string,
  valueText: string,
  options: { iconName?: IconName; state?: 'ok' | 'damaged' | 'critical' | 'destroyed' } = {},
): HTMLElement {
  const row = document.createElement('div');
  row.className = options.state === undefined ? 'sm-stat' : `sm-stat sm-stat--${options.state}`;
  if (options.iconName !== undefined) row.appendChild(icon(options.iconName, { className: 'sm-icon' }));
  else {
    const spacer = document.createElement('span');
    spacer.className = 'sm-icon';
    row.appendChild(spacer);
  }
  const nameEl = document.createElement('span');
  nameEl.className = 'sm-stat__name';
  nameEl.textContent = name;
  const valueEl = document.createElement('span');
  valueEl.className = 'sm-stat__value';
  valueEl.textContent = valueText;
  row.appendChild(nameEl);
  row.appendChild(valueEl);
  return row;
}
