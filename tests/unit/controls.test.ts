// @vitest-environment happy-dom
/**
 * The modernised form controls.
 *
 * `src/ui/controls.ts` exists because four inputs were each built with their own
 * inline `style.cssText`, and the ignition switch exists because a flat teal
 * button labelled with a second copy of the page title was not a start control.
 * Both are behaviour as much as appearance, and the behaviour is what these
 * cover.
 *
 * The DOM here is the same `happy-dom` the rest of the integration suite drives
 * (see vite.config.ts), which is the point: the icons are built with
 * `createElementNS` precisely so they exist in this environment as well as in a
 * browser, and a test that only ever ran in a browser would not have caught it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { button, field, ignitionButton, panel, setIgnitionCrankMs, stat } from '@/ui/controls';
import { DAMAGE_GLYPH } from '@/ui/hud';
import { facingHasDirection, facingIcons, facingRotation, icon } from '@/ui/icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('icons', () => {
  it('builds real namespaced SVG children, not markup assigned through innerHTML', () => {
    // The reason `icons.ts` holds shapes as data rather than as an SVG string:
    // `innerHTML` on an SVGElement does not reliably produce namespaced children
    // under happy-dom, so a string-based icon renders in a browser and is EMPTY
    // in every DOM test. Asserting the child count is what makes that class of
    // bug impossible to reintroduce silently.
    const shield = icon('shield');
    expect(shield.namespaceURI).toBe(SVG_NS);
    expect(shield.tagName.toLowerCase()).toBe('svg');
    expect(shield.children.length).toBeGreaterThan(0);
    for (const child of Array.from(shield.children)) {
      expect(child.namespaceURI).toBe(SVG_NS);
    }
    // A path's geometry is the icon; an icon with no `d` draws nothing.
    const path = shield.children[0];
    expect(path?.getAttribute('d')).toBeTruthy();
  });

  it('is aria-hidden by default and only becomes an img when given a title', () => {
    expect(icon('car').getAttribute('aria-hidden')).toBe('true');
    // A titled icon is announced; an untitled one beside a real text label is
    // noise, and that distinction is the whole reason the option exists.
    const titled = icon('car', { title: 'Vehicle' });
    expect(titled.getAttribute('aria-hidden')).toBeNull();
    expect(titled.getAttribute('role')).toBe('img');
    expect(titled.querySelector('title')?.textContent).toBe('Vehicle');
  });

  it('inherits its colour rather than carrying one, so the theme owns it', () => {
    const shield = icon('shield');
    // `currentColor` is the mechanism: the same glyph is teal, amber or red
    // depending only on the colour its context sets.
    expect(shield.getAttribute('stroke')).toBe('currentColor');
    expect(shield.getAttribute('fill')).toBe('none');
    // And no hardcoded paint anywhere on the element or its children.
    for (const el of [shield, ...Array.from(shield.children)]) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.value).not.toMatch(/^#[0-9a-f]{3,8}$/i);
      }
    }
  });

  it('rotates the facing chevron to each of the four directions, and points at nothing for UNDERBODY', () => {
    expect(facingRotation('FRONT')).toBe(0);
    expect(facingRotation('REAR')).toBe(180);
    expect(facingRotation('LEFT')).toBe(-90);
    expect(facingRotation('RIGHT')).toBe(90);

    // UNDERBODY has no lateral direction. Pointing a chevron "up" at the
    // underside of a car asserts a direction that does not exist, so the
    // underbody row gets the shield alone.
    expect(facingHasDirection('UNDERBODY')).toBe(false);
    expect(facingIcons('UNDERBODY', 'sm-icon')).toHaveLength(1);
    expect(facingIcons('REAR', 'sm-icon')).toHaveLength(2);
    const rear = facingIcons('REAR', 'sm-icon');
    expect(rear[0]?.style.transform).toBe('rotate(180deg)');
    // An unknown facing must not throw — it falls back to no rotation.
    expect(facingRotation('SIDEWAYS')).toBe(0);
  });
});

describe('field', () => {
  it('wires the label to the input with for/id, so clicking the label focuses it', () => {
    const f = field({ label: 'Name', iconName: 'id-badge' });
    const label = f.root.querySelector('label');
    const input = f.root.querySelector('input');
    expect(label?.getAttribute('for')).toBe(input?.id);
    expect(label?.textContent).toBe('Name');
  });

  it('gives every field a unique id, because two fields sharing one breaks both labels', () => {
    const a = field({ label: 'A' });
    const b = field({ label: 'B' });
    expect(a.input.id).not.toBe(b.input.id);
  });

  it('renders the icon it was asked for and nothing when none was asked for', () => {
    expect(field({ label: 'Name', iconName: 'id-badge' }).root.querySelector('svg')).not.toBeNull();
    expect(field({ label: 'Name' }).root.querySelector('svg')).toBeNull();
  });

  it('keeps the error line in the DOM at all times, only changing its text', () => {
    // A message that appears and disappears moves the button under the player's
    // cursor, which is how a click lands on the wrong control.
    const f = field({ label: 'Name' });
    const errorBefore = f.root.querySelector('.sm-field__error');
    f.setError('That name is taken');
    const errorAfter = f.root.querySelector('.sm-field__error');
    expect(errorAfter).toBe(errorBefore);
    expect(errorAfter?.textContent).toBe('That name is taken');
    expect(f.input.getAttribute('aria-invalid')).toBe('true');

    f.setError(null);
    expect(f.root.querySelector('.sm-field__error')?.textContent).toBe('');
    expect(f.input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('reports a trimmed value, and submits on Enter without the browser also incrementing a number field', () => {
    const onSubmit = vi.fn();
    const f = field({ label: 'Points', type: 'number', onSubmit });
    f.input.value = '  7  ';
    // A bare input in a screen with no <form> has no default Enter action, and on
    // a number field the default would be "increment". preventDefault is what
    // stops that, so the test asserts the handler ran AND the event was not
    // left to the browser.
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    f.input.dispatchEvent(ev);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    expect(f.value()).toBe('7');
  });

  it('ignores every key that is not Enter', () => {
    const onSubmit = vi.fn();
    const f = field({ label: 'Name', onSubmit });
    for (const key of ['a', 'Tab', 'Escape', ' ']) {
      f.input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('puts a unit suffix outside the input, so it can never be typed into or read as a value', () => {
    const f = field({ label: 'Mass', suffix: 'kg' });
    const suffix = f.root.querySelector('.sm-field__suffix');
    expect(suffix?.textContent).toBe('kg');
    expect(f.input.value).toBe('');
  });
});

describe('ignition switch', () => {
  beforeEach(() => {
    setIgnitionCrankMs(30);
  });
  afterEach(() => {
    // Leave the seam as the suite found it: the setup file owns the default.
    setIgnitionCrankMs(0);
    vi.useRealTimers();
  });

  it('does NOT build the driver on click — the key turns first', async () => {
    // The behaviour the control exists for. A version that fired on `click` and
    // animated for show would pass every appearance check and fail this one.
    vi.useFakeTimers();
    let ignited = 0;
    const btn = ignitionButton({ label: 'Turn the key', onIgnite: () => (ignited += 1) });

    btn.click();
    expect(ignited).toBe(0);

    vi.advanceTimersByTime(29);
    expect(ignited).toBe(0);

    vi.advanceTimersByTime(1);
    expect(ignited).toBe(1);
  });

  it('ignores a second click while cranking, so the destination cannot run twice', async () => {
    // Not hypothetical: this callback builds a driver and advances to the
    // constructor, so a double-click would either double-construct or land the
    // player on a screen they did not ask for.
    //
    // Both a user click AND a programmatic `click()` are covered, because the
    // lock is the `disabled` attribute and that is a DOM-level suppression — it
    // holds for synthetic events too, which a boolean flag in a closure would
    // not have needed but also would not have guaranteed.
    vi.useFakeTimers();
    let ignited = 0;
    const btn = ignitionButton({ label: 'Turn the key', onIgnite: () => (ignited += 1) });

    btn.click();
    btn.click();
    btn.click();
    vi.advanceTimersByTime(100);
    expect(ignited).toBe(1);
  });

  it('locks itself while cranking and unlocks afterwards', () => {
    vi.useFakeTimers();
    const btn = ignitionButton({ label: 'Turn the key', onIgnite: () => {} });
    expect(btn.disabled).toBe(false);
    btn.click();
    // `disabled` rather than only a guard, so the control visibly locks instead
    // of silently swallowing clicks.
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('sm-ignition--cranking')).toBe(true);
    vi.advanceTimersByTime(100);
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains('sm-ignition--cranking')).toBe(false);
  });

  it('carries the key glyph and the label as separate children, so the key can rotate alone', () => {
    const btn = ignitionButton({ label: 'Turn the key', onIgnite: () => {} });
    const key = btn.querySelector('.sm-ignition__key');
    const label = btn.querySelector('.sm-ignition__label');
    expect(key?.tagName.toLowerCase()).toBe('svg');
    expect(key?.namespaceURI).toBe(SVG_NS);
    expect(label?.textContent).toBe('Turn the key');
  });

  it('shows no car until the starter engages, then runs it', () => {
    // The ask was a switch that "turns over and a car starts". A key that turns
    // with nothing behind it is half that sentence, and a car silhouette parked
    // in the button before anyone presses it is decoration pretending to be
    // feedback. The class is the whole mechanism, so the test reads the class
    // and the glyph in one place.
    vi.useFakeTimers();
    const btn = ignitionButton({ label: 'Turn the key', onIgnite: () => {} });
    const car = btn.querySelector('.sm-ignition__car');

    // Present in the DOM (so it cannot pop in and reflow the label) but inert.
    expect(car?.tagName.toLowerCase()).toBe('svg');
    expect(btn.classList.contains('sm-ignition--cranking')).toBe(false);
    // The running animation is bound to the cranking class, so at rest the glyph
    // is governed by the resting rule alone.
    expect(car?.className).toContain('sm-ignition__car');
    // The resting/carrying rule is in CSS, which this environment never loads, so
    // the binding itself is asserted from the stylesheet's source. Without this
    // the test proves a glyph exists and says nothing about whether it is hidden
    // until the car starts.
    // `URL` imported from node:url on purpose. Under `happy-dom` the GLOBAL `URL`
    // is the DOM implementation, and it throws ERR_INVALID_URL_SCHEME when asked
    // to resolve a relative path against a `file:` base — which is why the
    // equivalent read in atlas.test.ts works (it runs in the `node` environment)
    // and this one did not. Same expression, two environments, one of them lying
    // about what a URL is.
    const css = readFileSync(fileURLToPath(new NodeURL('../../src/ui/controls.css', import.meta.url)), 'utf8');
    const resting = css.slice(css.indexOf('.sm-ignition__car {'), css.indexOf('.sm-ignition--cranking .sm-ignition__car {'));
    expect(resting).toMatch(/opacity:\s*0/);
    const running = css.slice(css.indexOf('.sm-ignition--cranking .sm-ignition__car {'));
    expect(running.slice(0, 200)).toMatch(/opacity:\s*1/);
    expect(running.slice(0, 400)).toMatch(/animation:\s*sm-ignition-run/);

    btn.click();
    expect(btn.classList.contains('sm-ignition--cranking')).toBe(true);

    vi.advanceTimersByTime(100);
    expect(btn.classList.contains('sm-ignition--cranking')).toBe(false);
  });

  it('keeps the car decorative — the label is the accessible name', () => {
    const btn = ignitionButton({ label: 'Turn the key', onIgnite: () => {} });
    // An announced "car" beside the word "Turn the key" is noise for anyone
    // using a screen reader; the whole icon set is aria-hidden for this reason.
    expect(btn.querySelector('.sm-ignition__car')?.getAttribute('aria-hidden')).toBe('true');
    expect(btn.querySelector('.sm-ignition__key')?.getAttribute('aria-hidden')).toBe('true');
    expect(btn.querySelector('.sm-ignition__label')?.textContent).toBe('Turn the key');
  });

  it('rejects a negative or non-finite duration rather than storing it', () => {
    // The seam is a seam, not a loophole: a bad value would otherwise become a
    // NaN timeout and the control would simply never fire.
    expect(() => setIgnitionCrankMs(-1)).toThrow();
    expect(() => setIgnitionCrankMs(Number.NaN)).toThrow();
  });
});

describe('panels and stats', () => {
  it('gives a panel an icon in its header and a body to fill', () => {
    const p = panel('Armour', 'shield');
    expect(p.root.querySelector('.sm-panel__head svg')).not.toBeNull();
    expect(p.root.querySelector('.sm-panel__head')?.textContent).toContain('Armour');
    expect(p.body.textContent).toBe('');
    const row = stat('FRONT', '2/2', { iconName: 'chevron', state: 'ok' });
    p.body.appendChild(row);
    expect(p.root.textContent).toContain('2/2');
  });

  it('colours a stat by meaning, and the state class is the only thing that decides it', () => {
    // A bare armour number does not answer "how hurt am I" at a glance; these
    // are the same three semantic colours the HUD already uses.
    expect(stat('FRONT', '2/2', { state: 'ok' }).className).toContain('sm-stat--ok');
    expect(stat('FRONT', '1/2', { state: 'damaged' }).className).toContain('sm-stat--damaged');
    expect(stat('FRONT', '0/2', { state: 'destroyed' }).className).toContain('sm-stat--destroyed');
    expect(stat('FRONT', '2/2').className).not.toContain('sm-stat--');
  });

  it('reserves the icon column even with no icon, so rows stay aligned', () => {
    // Without the spacer a row without a glyph would start its text one column
    // left of every row that has one, and a ragged column of labels is the
    // first thing that makes a spec sheet look hand-made.
    const without = stat('Mass', '900');
    expect(without.children).toHaveLength(3);
    expect(without.children[0]?.className).toBe('sm-icon');
  });

  describe('a stat state is never colour alone', () => {
    // docs/SPEC.md release gate 5: "No information conveyed by color alone".
    // This component broke it. `sm-stat--{state}` coloured `.sm-stat__value`
    // and did nothing else, so the constructor's "how hurt am I" row was
    // unreadable without colour vision AND in a greyscale screenshot — in the
    // one component whose entire job is to report a number's condition.
    //
    // The check is on the RENDERED VALUE (the glyph character, the word, the
    // attribute), never on the presence of a class name. A test that asserted
    // `className` already existed above and would have kept passing through
    // the defect — which is exactly what happened.

    const STATES = ['ok', 'damaged', 'critical', 'destroyed'] as const;

    it('gives every state a glyph, so the row is readable with no colour at all', () => {
      const glyphs = STATES.map((s) => stat('FRONT', '1/2', { state: s }).querySelector('.sm-stat__glyph')?.textContent);
      // Distinct AND present. The distinctness is the load-bearing half: four
      // states sharing one glyph would pass a "has a glyph" test forever.
      expect(glyphs.every((g) => typeof g === 'string' && g.length > 0)).toBe(true);
      expect(new Set(glyphs).size).toBe(STATES.length);
    });

    it('uses the SAME glyph the HUD uses for each state, rather than a second mapping', () => {
      // One owner per rule. If `stat()` grew its own private glyph table this
      // would fail, which is the point: the constructor and the arena must not
      // be able to disagree about what "damaged" looks like.
      for (const s of STATES) {
        const glyph = stat('FRONT', '1/2', { state: s }).querySelector('.sm-stat__glyph')?.textContent;
        expect(glyph).toBe(DAMAGE_GLYPH[s]);
      }
    });

    it('says the state in words too, which is what a screen reader announces', () => {
      expect(stat('FRONT', '2/2', { state: 'ok' }).querySelector('.sm-stat__word')?.textContent).toBe('ok');
      expect(stat('FRONT', '0/2', { state: 'destroyed' }).querySelector('.sm-stat__word')?.textContent).toBe('destroyed');
    });

    it('exposes the state as an attribute a test or stylesheet can read as a value', () => {
      // Reading a state by parsing `sm-stat--damaged` out of a class name is a
      // string operation that silently breaks on a rename. `data-state` is a
      // value, and happy-dom resolves it without a stylesheet.
      expect(stat('FRONT', '1/2', { state: 'critical' }).getAttribute('data-state')).toBe('critical');
      expect(stat('Mass', '900').getAttribute('data-state')).toBeNull();
    });

    it('hides the decorative glyph from assistive tech, so the word is not announced twice', () => {
      const glyph = stat('FRONT', '1/2', { state: 'damaged' }).querySelector('.sm-stat__glyph');
      expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    });

    it('adds NO glyph, word or data-state when no state was asked for', () => {
      // The plain readouts (mass, cost) must not sprout a spurious "ok".
      const plain = stat('Mass', '900');
      expect(plain.querySelector('.sm-stat__glyph')).toBeNull();
      expect(plain.querySelector('.sm-stat__word')).toBeNull();
      expect(plain.children).toHaveLength(3);
    });
  });
});

describe('button', () => {
  it('renders its icon before its text and fires on click', () => {
    let clicks = 0;
    const b = button('Sell', () => (clicks += 1), { variant: 'primary', iconName: 'coin' });
    expect(b.className).toContain('sm-btn--primary');
    const [first, second] = Array.from(b.children);
    expect(first?.tagName.toLowerCase()).toBe('svg');
    expect(second?.textContent).toBe('Sell');
    b.click();
    expect(clicks).toBe(1);
  });

  it('defaults to the neutral variant and sets an id when given one', () => {
    expect(button('Cancel', () => {}).className).toBe('sm-btn');
    expect(button('Confirm', () => {}, { id: 'confirm' }).id).toBe('confirm');
  });
});
