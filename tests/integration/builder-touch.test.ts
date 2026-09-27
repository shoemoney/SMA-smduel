// @vitest-environment happy-dom
/**
 * The Constructor screen's touch path, driven through a real `mountBuilder`
 * mounted into a real happy-dom document — never through the pure
 * `handleBuilderPointer`/`handleBuilderCycle`/`handleBuilderName` reducers
 * directly (those are covered at the unit level in
 * tests/unit/builder.test.ts). This file exists because a fake-DOM harness
 * cannot prove the one regression that matters here: that typing into the
 * name `<input>` does not destroy and recreate itself mid-keystroke.
 *
 * happy-dom computes NO layout at all: `getBoundingClientRect()` returns
 * zeros for every element, and `@media` queries are never evaluated. So
 * this file asserts content, roles, attributes and behavior — never
 * geometry, pixel sizes or computed styles (see builder.css's own header
 * for the touch-target sizing this can't verify).
 */
import { describe, expect, it } from 'vitest';
import { computeRows, createBuilderState, mountBuilder, type BuilderConfirmedBuild, type BuilderContext } from '@/ui/builder';

function baseContext(overrides: Partial<BuilderContext> = {}): BuilderContext {
  return { cash: 1_000_000, existingCarNames: [], ownedCarCount: 0, ...overrides };
}

function tap(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('builder touch: tapping a row selects it', () => {
  it('a click on a non-confirm row sets aria-selected on that row and clears it from the previously-selected one', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountBuilder({ container: root, context: baseContext(), onBuilt: () => {}, onCancel: () => {} });

    const rows = root.querySelectorAll('.sm-builder__row');
    const bodyIndex = computeRows(createBuilderState()).findIndex((r) => r.kind === 'body');
    const bodyRow = rows[bodyIndex];
    if (bodyRow === undefined) throw new Error('test: expected a body row');

    expect(rows[0]?.getAttribute('aria-selected')).toBe('true'); // name row selected by default
    expect(bodyRow.getAttribute('aria-selected')).toBeNull();

    tap(bodyRow);

    const rowsAfter = root.querySelectorAll('.sm-builder__row');
    expect(rowsAfter[bodyIndex]?.getAttribute('aria-selected')).toBe('true');
    expect(rowsAfter[0]?.getAttribute('aria-selected')).toBeNull();

    root.remove();
  });
});

describe('builder touch: the -/+ cycle buttons', () => {
  it('tapping the increase button changes that rows rendered value text', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountBuilder({ container: root, context: baseContext(), onBuilt: () => {}, onCancel: () => {} });

    const bodyRow = root.querySelectorAll('.sm-builder__row--body')[0];
    if (bodyRow === undefined) throw new Error('test: expected a body row');
    const before = bodyRow.querySelector('.sm-builder__row-value')?.textContent;

    const incButton = bodyRow.querySelector('.sm-builder__row-cycle--inc');
    if (incButton === null || incButton === undefined) throw new Error('test: expected an increase button on the body row');
    tap(incButton);

    const bodyRowAfter = root.querySelectorAll('.sm-builder__row--body')[0];
    const after = bodyRowAfter?.querySelector('.sm-builder__row-value')?.textContent;
    expect(after).not.toBe(before);

    root.remove();
  });

  it('the name row and confirm row do NOT get cycle buttons (applyCycle has no case for them)', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountBuilder({ container: root, context: baseContext(), onBuilt: () => {}, onCancel: () => {} });

    const nameRow = root.querySelectorAll('.sm-builder__row--name')[0];
    const confirmRow = root.querySelectorAll('.sm-builder__row--confirm')[0];
    expect(nameRow?.querySelector('.sm-builder__row-cycle')).toBeNull();
    expect(confirmRow?.querySelector('.sm-builder__row-cycle')).toBeNull();

    root.remove();
  });
});

describe('builder touch: the name field is a real, focus-retaining input', () => {
  it('is a real <input>, prefilled from state and capped at the ruleset name-length limit', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountBuilder({ container: root, context: baseContext(), onBuilt: () => {}, onCancel: () => {} });

    const input = root.querySelector('.sm-builder__row-input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.tagName).toBe('INPUT');
    expect(input?.maxLength).toBeGreaterThan(0);

    root.remove();
  });

  it('survives three successive input events with growing values without losing focus or dropping keystrokes', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountBuilder({ container: root, context: baseContext(), onBuilt: () => {}, onCancel: () => {} });

    const input = root.querySelector('.sm-builder__row-input') as HTMLInputElement | null;
    if (input === null) throw new Error('test: expected the name input');
    input.focus();
    expect(document.activeElement).toBe(input);

    for (const value of ['R', 'Ro', 'Roa']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // The regression this guards: a full `render()` on every keystroke
    // destroys and recreates the input element, so `document.activeElement`
    // would fall back to <body> and the DOM node under `.sm-builder__row-input`
    // would no longer be the SAME object identity as `input` above.
    expect(document.activeElement).toBe(input);
    expect(root.querySelector('.sm-builder__row-input')).toBe(input);
    expect(input.value).toBe('Roa');

    // The right pane, by contrast, DOES reflect the typed name (its
    // "car name is required" violation clears) — proving state actually
    // updated, not just that the input avoided being destroyed.
    const violations = Array.from(root.querySelectorAll('.sm-builder__violation')).map((el) => el.textContent);
    expect(violations.some((text) => text !== null && text.includes('name is required'))).toBe(false);

    root.remove();
  });
});

describe('builder touch: Confirm via tap', () => {
  it('tapping Confirm on a legal build calls onBuilt', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let built: BuilderConfirmedBuild | null = null;
    mountBuilder({
      container: root,
      context: baseContext(),
      onBuilt: (confirmed) => {
        built = confirmed;
      },
      onCancel: () => {},
    });

    const input = root.querySelector('.sm-builder__row-input') as HTMLInputElement | null;
    if (input === null) throw new Error('test: expected the name input');
    input.value = 'Roadhog';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const confirmRow = root.querySelectorAll('.sm-builder__row--confirm')[0];
    if (confirmRow === undefined) throw new Error('test: expected a confirm row');
    tap(confirmRow);

    expect(built).not.toBeNull();
    expect((built as unknown as BuilderConfirmedBuild | null)?.design.name).toBe('Roadhog');

    root.remove();
  });

  it('tapping Confirm on an illegal (unnamed) build does not call onBuilt, and surfaces the violation text', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let built: BuilderConfirmedBuild | null = null;
    mountBuilder({
      container: root,
      context: baseContext(),
      onBuilt: (confirmed) => {
        built = confirmed;
      },
      onCancel: () => {},
    });

    const confirmRow = root.querySelectorAll('.sm-builder__row--confirm')[0];
    if (confirmRow === undefined) throw new Error('test: expected a confirm row');
    tap(confirmRow);

    expect(built).toBeNull();
    const message = root.querySelector('.sm-builder__message')?.textContent ?? '';
    expect(message.length).toBeGreaterThan(0);
    expect(message.toLowerCase()).toContain('name');

    root.remove();
  });
});
