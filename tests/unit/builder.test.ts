import { describe, expect, it } from 'vitest';
import { allBodies, allWeapons, economy, getBody } from '@/data/rulesets';
import { computeBuild, validateDesign } from '@/sim/construct';
import {
  attemptConfirm,
  computeDerived,
  computeRows,
  computeViolations,
  createBuilderState,
  handleKey,
  mountBuilder,
  toDesign,
  type BuilderConfirmedBuild,
  type BuilderContext,
  type BuilderState,
} from '@/ui/builder';

function baseContext(overrides: Partial<BuilderContext> = {}): BuilderContext {
  return { cash: 1_000_000, existingCarNames: [], ownedCarCount: 0, ...overrides };
}

function typeText(state: BuilderState, text: string, ctx: BuilderContext): BuilderState {
  let cur = state;
  for (const char of text) {
    cur = handleKey(cur, char, ctx).state;
  }
  return cur;
}

describe('builder — navigation', () => {
  it('starts on the name row and ArrowDown moves through rows in order', () => {
    const ctx = baseContext();
    let state = createBuilderState();
    expect(state.selectedIndex).toBe(0);
    expect(computeRows(state)[0]?.kind).toBe('name');

    state = handleKey(state, 'ArrowDown', ctx).state;
    expect(state.selectedIndex).toBe(1);
    expect(computeRows(state)[1]?.kind).toBe('body');

    state = handleKey(state, 'ArrowDown', ctx).state;
    expect(computeRows(state)[state.selectedIndex]?.kind).toBe('chassis');

    // ArrowUp reverses it, and never goes negative.
    state = handleKey(state, 'ArrowUp', ctx).state;
    state = handleKey(state, 'ArrowUp', ctx).state;
    state = handleKey(state, 'ArrowUp', ctx).state;
    expect(state.selectedIndex).toBe(0);
  });

  it('ArrowRight/ArrowLeft cycles the option list for a select-style row', () => {
    const ctx = baseContext();
    const bodies = allBodies();
    let state = createBuilderState();
    state = handleKey(state, 'ArrowDown', ctx).state; // -> body row
    expect(state.bodyId).toBe(bodies[0]?.id);

    state = handleKey(state, 'ArrowRight', ctx).state;
    expect(state.bodyId).toBe(bodies[1]?.id);

    // Clamped at the top of the list.
    for (let i = 0; i < bodies.length + 2; i += 1) {
      state = handleKey(state, 'ArrowRight', ctx).state;
    }
    expect(state.bodyId).toBe(bodies[bodies.length - 1]?.id);

    state = handleKey(state, 'ArrowLeft', ctx).state;
    expect(state.bodyId).toBe(bodies[bodies.length - 2]?.id);
  });

  it('number keys set the value on an armor row via a digit buffer', () => {
    const ctx = baseContext();
    let state = createBuilderState();
    // Row 6 is Armor: Front (name, body, chassis, suspension, plant, tire, then armor rows).
    for (let i = 0; i < 6; i += 1) state = handleKey(state, 'ArrowDown', ctx).state;
    expect(computeRows(state)[state.selectedIndex]?.kind).toBe('armor');

    state = handleKey(state, '5', ctx).state;
    expect(state.armor.FRONT).toBe(5);
    state = handleKey(state, '2', ctx).state;
    expect(state.armor.FRONT).toBe(52);

    state = handleKey(state, 'Backspace', ctx).state;
    expect(state.armor.FRONT).toBe(5);

    // ArrowRight/ArrowLeft nudge by 1 and reset the digit buffer.
    state = handleKey(state, 'ArrowRight', ctx).state;
    expect(state.armor.FRONT).toBe(6);
    state = handleKey(state, 'ArrowLeft', ctx).state;
    state = handleKey(state, 'ArrowLeft', ctx).state;
    expect(state.armor.FRONT).toBe(4);
  });

  it('cycling a weapon mount sets a legal default facing and zero ammo, and ammo is clamped to capacity', () => {
    const ctx = baseContext();
    const weapons = allWeapons();
    const firstWeapon = weapons[0];
    if (firstWeapon === undefined) throw new Error('expected at least one weapon in the ruleset');

    let state = createBuilderState();
    // Rows: 0 name,1 body,2 chassis,3 suspension,4 plant,5 tire,6-10 armor -> first weapon row is index 11.
    for (let i = 0; i < 11; i += 1) state = handleKey(state, 'ArrowDown', ctx).state;
    expect(computeRows(state)[state.selectedIndex]?.kind).toBe('weapon');

    state = handleKey(state, 'ArrowRight', ctx).state;
    const mounted = state.weaponSlots[0];
    expect(mounted).not.toBeNull();
    expect(mounted?.weaponId).toBe(firstWeapon.id);
    expect(mounted?.facing).toBe(firstWeapon.allowedFacings[0]);
    expect(mounted?.ammo).toBe(0);

    // Move to the ammo row for this slot and try to type past capacity.
    state = handleKey(state, 'ArrowDown', ctx).state; // facing row
    state = handleKey(state, 'ArrowDown', ctx).state; // ammo row
    expect(computeRows(state)[state.selectedIndex]?.kind).toBe('ammo');
    const overCapacity = String(firstWeapon.ammoCapacity + 50);
    for (const digit of overCapacity) state = handleKey(state, digit, ctx).state;
    expect(state.weaponSlots[0]?.ammo).toBe(firstWeapon.ammoCapacity);
  });
});

describe('builder — legality display', () => {
  it('shows numeric stats for a legal design and blanks them to ????? once it becomes physically illegal', () => {
    const ctx = baseContext();
    let state = createBuilderState();
    const legal = computeDerived(state, ctx);
    expect(legal.physicallyLegal).toBe(true);
    expect(legal.weightDisplay).not.toBe('?????');
    expect(legal.canConfirm).toBe(false); // no name yet

    // Pile on absurd front armor until the design is over-weight.
    for (let i = 0; i < 6; i += 1) state = handleKey(state, 'ArrowDown', ctx).state; // front armor row
    for (const digit of '9999') state = handleKey(state, digit, ctx).state;

    const illegal = computeDerived(state, ctx);
    expect(illegal.physicallyLegal).toBe(false);
    expect(illegal.weightDisplay).toBe('?????');
    expect(illegal.spacesDisplay).toBe('?????');
    expect(illegal.topSpeedDisplay).toBe('?????');
    expect(illegal.handlingDisplay).toBe('?????');
    // Cost is still a real, meaningful number even when the design is illegal.
    expect(illegal.costDisplay).not.toBe('?????');
    expect(illegal.violations.some((v) => v.code === 'OVER_WEIGHT')).toBe(true);

    const result = attemptConfirm(state, baseContext({ existingCarNames: [] }));
    expect(result.ok).toBe(false);
  });
});

describe('builder — violation list matches validateDesign', () => {
  it('equals validateDesign exactly once the name is valid and unique and the fleet has room', () => {
    // A budget of $1 and a wildly over-weight armor loadout push
    // validateDesign into returning MULTIPLE real violations (OVER_BUDGET
    // and OVER_WEIGHT). Asserting equality against a fixture that stays
    // legal (validateDesign(...) === []) would pass even if computeViolations
    // were hardcoded to return [] - it must actually carry the base
    // violations through, not just fail to add its own on top of them.
    const ctx = baseContext({ cash: 1 });
    let state = createBuilderState();
    state = typeText(state, 'Roadhog', ctx);
    for (let i = 0; i < 6; i += 1) state = handleKey(state, 'ArrowDown', ctx).state; // front armor row
    for (const digit of '9999') state = handleKey(state, digit, ctx).state;

    const design = toDesign(state);
    const expected = validateDesign(design, ctx.cash);
    expect(expected.map((v) => v.code)).toEqual(expect.arrayContaining(['OVER_BUDGET', 'OVER_WEIGHT']));
    expect(expected.length).toBeGreaterThan(1);

    expect(computeViolations(state, ctx)).toEqual(expected);
  });
});

describe('builder — name rules', () => {
  it('refuses a duplicate car name', () => {
    let state = createBuilderState();
    const ctx = baseContext({ existingCarNames: ['Roadhog'] });
    state = typeText(state, 'Roadhog', ctx);

    const result = attemptConfirm(state, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'NAME_DUPLICATE')).toBe(true);
    }
  });

  it('refuses a 17-character name', () => {
    let state = createBuilderState();
    const ctx = baseContext();
    state = typeText(state, '12345678901234567', ctx); // 17 chars
    expect(state.name).toHaveLength(17);

    const result = attemptConfirm(state, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'NAME_TOO_LONG')).toBe(true);
    }
  });

  it('accepts a name at exactly the 16-character limit', () => {
    let state = createBuilderState();
    const ctx = baseContext();
    state = typeText(state, '1234567890123456', ctx); // 16 chars
    const result = attemptConfirm(state, ctx);
    expect(result.ok).toBe(true);
  });

  it('refuses a duplicate name that differs only by a trailing space', () => {
    let state = createBuilderState();
    const ctx = baseContext({ existingCarNames: ['Roadhog'] });
    state = typeText(state, 'Roadhog ', ctx); // trailing space
    expect(state.name).toBe('Roadhog ');

    const result = attemptConfirm(state, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'NAME_DUPLICATE')).toBe(true);
    }
  });

  it('refuses a duplicate name that differs only by leading/interior whitespace or case', () => {
    let state = createBuilderState();
    const ctx = baseContext({ existingCarNames: [' roadHOG'] });
    state = typeText(state, 'Roadhog', ctx);

    const result = attemptConfirm(state, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'NAME_DUPLICATE')).toBe(true);
    }
  });

  it('refuses a whitespace-only name as empty, not as a valid unique name', () => {
    let state = createBuilderState();
    const ctx = baseContext();
    state = typeText(state, '   ', ctx); // three spaces, typed via the name row
    expect(state.name).toBe('   ');

    const result = attemptConfirm(state, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'NAME_EMPTY')).toBe(true);
      // It must not ALSO be reported as duplicate/legal-looking — empty is empty.
      expect(result.violations.some((v) => v.code === 'NAME_DUPLICATE')).toBe(false);
    }
  });
});

describe('builder — armor digit-entry safety', () => {
  it('caps a mashed-in armor value at a safe integer derived from the body\'s own load capacity, never scientific notation', () => {
    const ctx = baseContext();
    let state = createBuilderState();
    for (let i = 0; i < 6; i += 1) state = handleKey(state, 'ArrowDown', ctx).state; // Armor: Front row
    expect(computeRows(state)[state.selectedIndex]?.kind).toBe('armor');

    for (let i = 0; i < 20; i += 1) state = handleKey(state, '9', ctx).state;

    const body = getBody(state.bodyId);
    const expectedCap = Math.floor(body.baseMaxLoadLb / body.armorWeightPerPoint);
    expect(state.armor.FRONT).toBe(expectedCap);
    expect(Number.isSafeInteger(state.armor.FRONT)).toBe(true);

    const derived = computeDerived(state, ctx);
    expect(derived.costDisplay).not.toMatch(/e\+/i);
    expect(Number.isSafeInteger(derived.metrics.costTotal)).toBe(true);
  });

  it('a lower cap on a lighter body still bounds the digit buffer instead of letting it grow unboundedly', () => {
    const ctx = baseContext();
    let state = createBuilderState();
    for (let i = 0; i < 6; i += 1) state = handleKey(state, 'ArrowDown', ctx).state;
    for (const digit of '123456789123456789') state = handleKey(state, digit, ctx).state;

    const body = getBody(state.bodyId);
    const expectedCap = Math.floor(body.baseMaxLoadLb / body.armorWeightPerPoint);
    expect(state.armor.FRONT).toBeLessThanOrEqual(expectedCap);
    expect(Number.isSafeInteger(state.armor.FRONT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DOM layer (mountBuilder)
// ---------------------------------------------------------------------------
//
// No jsdom/happy-dom is installed and the project's vitest environment is
// plain `node` (see vite.config.ts, out of scope to change here), so these
// tests install a minimal fake `document`/element pair on the global just
// for the duration of the test, matching only the handful of DOM APIs
// `mountBuilder`'s DOM layer actually calls.

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
  // Mirrors the browser's tabIndex/`tabindex` reflection closely enough for
  // these tests: setting the IDL property marks the attribute present,
  // removeAttribute('tabindex') clears both.
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
}

function installFakeDom(): void {
  const fakeDocument = { createElement: (tag: string): FakeElement => new FakeElement(tag) };
  (globalThis as unknown as { document: unknown }).document = fakeDocument;
}

describe('builder — mountBuilder DOM layer', () => {
  it('does not re-render over the screen its own onBuilt callback just installed', () => {
    installFakeDom();
    const container = new FakeElement('div');
    const hostMarkers: FakeElement[] = [];
    const confirmedBuilds: BuilderConfirmedBuild[] = [];

    const mounted = mountBuilder({
      container: container as unknown as HTMLElement,
      context: baseContext(),
      onBuilt: (confirmed) => {
        confirmedBuilds.push(confirmed);
        // Simulate a host that routes screens into this same container: it
        // takes over on a successful build and installs its own screen.
        container.innerHTML = '';
        const marker = new FakeElement('div');
        marker.className = 'host-marker';
        container.appendChild(marker);
        hostMarkers.push(marker);
      },
      onCancel: () => {},
    });

    for (const char of 'Roadhog') container.dispatch('keydown', fakeKeyEvent(char));
    for (let i = 0; i < 30; i += 1) container.dispatch('keydown', fakeKeyEvent('ArrowDown'));
    container.dispatch('keydown', fakeKeyEvent('Enter'));

    expect(confirmedBuilds).toHaveLength(1);
    expect(confirmedBuilds[0]?.design.name).toBe('Roadhog');
    expect(container.children).toHaveLength(1);
    expect(container.children[0]).toBe(hostMarkers[0]);

    mounted.destroy();
  });

  it('destroy() clears the DOM and the classes/attributes it added, not just the listener', () => {
    installFakeDom();
    const container = new FakeElement('div');
    const mounted = mountBuilder({
      container: container as unknown as HTMLElement,
      context: baseContext(),
      onBuilt: () => {},
      onCancel: () => {},
    });

    expect(container.children.length).toBeGreaterThan(0);
    expect(container.classList.contains('sm-builder-root')).toBe(true);

    mounted.destroy();

    expect(container.children).toHaveLength(0);
    expect(container.classList.contains('sm-builder-root')).toBe(false);
    expect(container.hasAttribute('tabindex')).toBe(false);

    // The keydown listener is gone too: further keys must not throw or mutate.
    expect(() => container.dispatch('keydown', fakeKeyEvent('ArrowDown'))).not.toThrow();
    expect(container.children).toHaveLength(0);
  });
});

describe('builder — cash gate', () => {
  it('accepts a legal design at exactly the cash limit and refuses it one dollar short', () => {
    let state = createBuilderState();
    const nameCtx = baseContext();
    state = typeText(state, 'Roadhog', nameCtx);

    const design = toDesign(state);
    const metrics = computeBuild(design);
    expect(metrics.legal).toBe(true);

    const exact = attemptConfirm(state, baseContext({ cash: metrics.costTotal }));
    expect(exact.ok).toBe(true);
    if (exact.ok) {
      expect(exact.confirmed.costTotal).toBe(metrics.costTotal);
      expect(exact.confirmed.daysCost).toBe(economy().timeCostDays.buildCar);
    }

    const short = attemptConfirm(state, baseContext({ cash: metrics.costTotal - 1 }));
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.violations.some((v) => v.code === 'OVER_BUDGET')).toBe(true);
    }
  });
});

describe('builder — fleet size gate', () => {
  it('refuses to build when the fleet is already at maxFleetSize', () => {
    let state = createBuilderState();
    const ctx = baseContext({ ownedCarCount: economy().maxFleetSize });
    state = typeText(state, 'Roadhog', ctx);

    const result = attemptConfirm(state, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'FLEET_FULL')).toBe(true);
    }
  });
});

describe('builder — Confirm key', () => {
  it('Enter on the Confirm row returns a BuilderConfirmedBuild and resets to a fresh state', () => {
    let state = createBuilderState();
    const ctx = baseContext();
    state = typeText(state, 'Roadhog', ctx);

    const rows = computeRows(state);
    const confirmIndex = rows.findIndex((r) => r.kind === 'confirm');
    expect(confirmIndex).toBeGreaterThan(0);
    for (let i = state.selectedIndex; i < confirmIndex; i += 1) {
      state = handleKey(state, 'ArrowDown', ctx).state;
    }
    expect(computeRows(state)[state.selectedIndex]?.kind).toBe('confirm');

    const result = handleKey(state, 'Enter', ctx);
    expect(result.confirmed).not.toBeNull();
    expect(result.confirmed?.design.name).toBe('Roadhog');
    expect(result.state.name).toBe(''); // reset to a fresh builder
  });
});
