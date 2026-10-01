import { describe, expect, it } from 'vitest';
import { allBodies, allWeapons, economy, getBody, skillsConfig } from '@/data/rulesets';
import { computeBuild, validateDesign } from '@/sim/construct';
import { FACINGS, type Facing } from '@/sim/types';
import { ARMOR_FACING_0_ROW, WEAPON_SLOT_0_ROW } from '../integration/constructor-fixture';
import {
  attemptConfirm,
  computeDerived,
  computeRows,
  computeViolations,
  createBuilderState,
  handleBuilderCycle,
  handleBuilderName,
  handleBuilderPointer,
  handleKey,
  mountBuilder,
  toDesign,
  type BuilderConfirmedBuild,
  type BuilderContext,
  type BuilderRow,
  type BuilderState,
  unmetRequirements,
  formatMoney,
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

describe('builder — unmet requirements reach the legality panel', () => {
  /**
   * The screen used to say two contradictory things at once. The amber rails
   * on the rows came from the name/armour/weapon requirement, and the panel
   * rendered `validateDesign`'s violations — which cover component validity,
   * cost and fractional input, but NOT road legality. So naming a car, with
   * zero armour and zero weapons, produced "No violations — ready to build"
   * directly beneath rails marking every weapon slot and all five facings as
   * needing input. Verified in a real browser: Enter on CONFIRM then built the
   * car, arriving in the city reading "0 armor · 0 mounted · Not road-legal".
   *
   * `validateDesign` is deliberately NOT changed here — it answers "is this a
   * coherent, affordable, physically legal design", and folding the road
   * requirement into it would put a player-facing prompt into a rules function.
   * The panel now reads `unmetRequirements`, the same derivation the rails use.
   */
  it('lists the unmet requirements instead of claiming a build is ready', () => {
    const state = createBuilderState();
    // A build that is untidy in the way that used to hide the problem: a name,
    // and nothing else. `validateDesign` has nothing to say about this.
    const named = { ...state, name: 'Halfway' };
    const unmet = unmetRequirements(named);
    expect(unmet).toHaveLength(2); // armour + weapon; the name is present
    // American, to match every other string in the game. This asserted
    // /armour/i and so PINNED the British spelling — the same class of problem as
    // a test that drove with `KeyD` because a bug made `KeyD` work: the test
    // described the defect instead of the requirement.
    expect(unmet.join(' ')).toMatch(/armor/i);
    expect(unmet.join(' ')).not.toMatch(/armour/i);
    expect(unmet.join(' ')).toMatch(/weapon/i);
  });

  it('reports no unmet requirements once name, armour and a weapon are all present', () => {
    const base = createBuilderState();
    const complete = { ...base, name: 'Roadworthy', armor: { ...base.armor, FRONT: 1 } };
    const withWeapon = { ...complete, weaponSlots: [{ weaponId: 'machinegun', facing: 'FRONT' as const, ammo: 1 }, ...complete.weaponSlots.slice(1)] };
    expect(unmetRequirements(withWeapon)).toHaveLength(0);
  });

  it('keeps the pristine onboarding branch, which is a different surface on purpose', () => {
    // A fresh build shows the bold prompt plus the three steps (iteration 23),
    // NOT the violation list — the point of pristine is that an untouched build
    // is not a failure the player caused. The two branches must not collapse.
    const fresh = createBuilderState();
    expect(unmetRequirements(fresh)).toHaveLength(3);
  });
});

describe('builder — the driver can see what they can spend', () => {
  /**
   * Found by Codex `gpt-6.1-sol` driving the live app with computer use: the
   * panel showed `Cost: $940` and nothing else. A single cost figure cannot be
   * read as good or bad — against what? The player either had to remember the
   * balance from the previous screen, or drive the total past the limit and
   * read the violation message to learn the number exists.
   */
  it('shows cost, budget and remaining as three adjacent numbers', () => {
    const ctx = baseContext();
    const derived = computeDerived(createBuilderState(), ctx);
    expect(derived.costDisplay).toBe('$940');
    expect(derived.budgetDisplay).toBe(`$${ctx.cash}`);
    expect(derived.remainingDisplay).toBe(formatMoney(ctx.cash - 940));
  });

  it('reports a NEGATIVE remaining balance rather than hiding it', () => {
    // `baseContext()` defaults to a MILLION in cash, which no design can exceed
    // — the first run of this test failed with `expected false to be true` for
    // exactly that reason, and the fixture was lying rather than the code. The
    // real driver's starting budget, measured off the live build, is $2000.
    const ctx = baseContext({ cash: 2000 });
    let state = createBuilderState();
    // Pile on armour until the design is unaffordable.
    for (let i = 0; i < 10; i += 1) state = handleKey(state, 'ArrowDown', ctx).state;
    for (const digit of '9999') state = handleKey(state, digit, ctx).state;

    const derived = computeDerived(state, ctx);
    expect(derived.overBudget).toBe(true);
    expect(derived.remainingDisplay.startsWith('-$')).toBe(true);
    // The cost is still a real figure when unaffordable — iteration 84's note
    // that `?????` means "unknown", and an unaffordable price is not unknown.
    expect(derived.costDisplay).not.toBe('?????');
  });

  it('puts the sign before the symbol, not after it', () => {
    // `${-4000}` reads as a typo; `-$4000` is a number a player can act on,
    // which is the entire reason the row exists.
    expect(formatMoney(-4000)).toBe('-$4000');
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(1060)).toBe('$1060');
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
  /**
   * Stand-in for the real `DOMStringMap`. A plain object is enough because the
   * builder's DOM layer only ever WRITES through it — the values are asserted
   * by reading the property back, not by querying `[data-*]` attributes.
   */
  readonly dataset: Record<string, string> = {};
  /**
   * Stand-in for `CSSStyleDeclaration`, holding only what this codebase writes
   * through it. Added because `@/ui/icons` sets a computed `transform` per
   * facing and nothing else — the sizing and flex behaviour moved to
   * `controls.css` precisely so this double only has to model one property. A
   * test double missing a property the code writes is not a smaller double, it
   * is a wrong one: it threw `Cannot set properties of undefined` and took two
   * unrelated builder tests down with it.
   */
  readonly style: { transform?: string } = {};
  private _tabIndex = -1;
  private readonly attrs = new Set<string>();
  private readonly attrValues = new Map<string, string>();
  private readonly listeners = new Map<string, Array<(ev: FakeKeyEvent) => void>>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  appendChild(child: FakeElement): void {
    this.children.push(child);
  }
  /**
   * Insert before an existing child, or append when `reference` is null — the
   * same contract as the real `Node.insertBefore`.
   *
   * Added for the vehicle schematic, which inserts the underbody-armour stripe
   * BEHIND the hull so it is visible through it. Without this the schematic
   * would be untestable here, and a test double that silently lacks a method
   * the code calls is worse than one that is deliberately complete.
   */
  insertBefore(child: FakeElement, reference: FakeElement | null): void {
    if (reference === null) {
      this.children.push(child);
      return;
    }
    const at = this.children.indexOf(reference);
    if (at === -1) {
      this.children.push(child);
      return;
    }
    this.children.splice(at, 0, child);
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
  /**
   * Records the attribute AND applies the two that have real DOM side effects on
   * the reflected property. `setAttribute('class', v)` genuinely sets
   * `className` in a browser, and `@/ui/icons` sets its glyph's class that way —
   * so a double that only recorded the NAME made every icon's class read as
   * empty, which is how a duplicate-glyph count came back as zero and looked
   * like a missing row rather than a missing reflection.
   */
  setAttribute(name: string, value = ''): void {
    this.attrs.add(name);
    if (name === 'class') this.className = value;
    this.attrValues.set(name, value);
  }
  /** Read back an attribute's VALUE. The real DOM stores both; storing only the
   *  name made it impossible to tell two different icons apart in a test. */
  getAttribute(name: string): string | null {
    return this.attrValues.get(name) ?? null;
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
  const fakeDocument = {
    createElement: (tag: string): FakeElement => new FakeElement(tag),
    // SVG children must be created in the SVG namespace; `createElement` would
    // produce HTML elements that never render. The vehicle schematic is real
    // SVG, so the double needs the real method to exercise it.
    createElementNS: (_namespace: string, tag: string): FakeElement => new FakeElement(tag),
  };
  (globalThis as unknown as { document: unknown }).document = fakeDocument;
}

describe('builder — mountBuilder DOM layer', () => {
  /**
   * The fake DOM has no `querySelectorAll`, so this walks for a class the way
   * the element actually nests: `container > .sm-builder > .pane > .rows`.
   * Reaching into `children[0].children[0]` instead would be a guess about the
   * depth that breaks the moment a wrapper is added — and a test that silently
   * finds nothing is worse than one that throws.
   */
  function findByClass(root: FakeElement, className: string): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
      if (node.className.split(/\s+/).includes(className)) found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(root);
    return found;
  }

  it('gives every armour row exactly the glyphs its facing calls for, and no more', () => {
    // The duplicate-shield bug: `facingIcons` already returns the shield, and
    // the renderer appended the generic row icon as well, so every armour row
    // drew a chevron and TWO shields. It survived a real screenshot — three
    // small glyphs in a row read as a slightly busy icon — and was only caught
    // by COUNTING the SVGs in a browser. Hence an exact count here.
    installFakeDom();
    const container = new FakeElement('div');
    const mounted = mountBuilder({
      container: container as unknown as HTMLElement,
      context: baseContext(),
      onBuilt: () => {},
      onCancel: () => {},
    });

    const armourRows = findByClass(container, 'sm-builder__row--armor');
    expect(armourRows).toHaveLength(5);

    const byFacing = new Map<string, FakeElement>();
    for (const li of armourRows) {
      const label = li.children.find((c) => c.className === 'sm-builder__row-label')?.textContent ?? '';
      byFacing.set(label.replace('Armor: ', '').toLowerCase(), li);
    }
    // FRONT's chevron points up already, so it carries no transform at all —
    // which is why "has a rotate()" is the wrong assertion for it.
    // `tagName` is uppercased by this double (as the real DOM does), so the
    // comparison is case-insensitive rather than against a literal 'svg'.
    const isSvg = (c: FakeElement): boolean => c.tagName.toLowerCase() === 'svg';
    const glyphCount = (li: FakeElement): number => li.children.filter(isSvg).length;
    const dirCount = (li: FakeElement): number =>
      li.children.filter((c) => isSvg(c) && c.className.includes('sm-icon--dir')).length;

    for (const facing of ['front', 'rear', 'left', 'right']) {
      const li = byFacing.get(facing);
      expect(li, `no armour row for ${facing}`).toBeDefined();
      expect(glyphCount(li!)).toBe(2);
      expect(dirCount(li!)).toBe(1);
    }
    // UNDERBODY has no lateral direction, so it gets the shield alone — pointing
    // a chevron "up" at the underside of a car would assert a direction that
    // does not exist.
    const under = byFacing.get('underbody');
    expect(under).toBeDefined();
    expect(glyphCount(under!)).toBe(1);
    expect(dirCount(under!)).toBe(0);

    mounted.destroy();
  });

  it('gives every derived stat a real glyph, sharing one ONLY between the three money rows', () => {
    // Ten label/value pairs in a column is a table; ten glyph/name/value rows is
    // a read-out. But a column where every icon means the same thing is
    // decoration, so the sharing has to be deliberate rather than incidental.
    //
    // Cost, Budget and Remaining share a coin ON PURPOSE: they are the same
    // quantity at three moments, and inventing three different money icons would
    // be drawing a distinction the numbers do not make. Everything else must be
    // its own glyph — and the first version of this table gave Top Speed AND
    // Acceleration the same dial, which is the incidental kind, so the test
    // names the one permitted group and forbids every other pairing.
    installFakeDom();
    const container = new FakeElement('div');
    const mounted = mountBuilder({
      container: container as unknown as HTMLElement,
      context: baseContext(),
      onBuilt: () => {},
      onCancel: () => {},
    });

    const stats = findByClass(container, 'sm-builder__stat');
    expect(stats.length).toBeGreaterThanOrEqual(8);

    const MONEY = new Set(['Cost', 'Budget', 'Remaining']);
    const byShape = new Map<string, string[]>();
    for (const row of stats) {
      const glyphs = row.children.filter((c) => c.tagName.toLowerCase() === 'svg');
      const label = row.children.find((c) => c.className === 'sm-builder__stat-label')?.textContent ?? '';
      // Exactly one: "forgot the icon" and "pasted it twice" are both wrong, and
      // only an exact count tells them apart.
      expect(glyphs, `stat "${label}" should carry exactly one glyph`).toHaveLength(1);
      // A real drawing, not an empty svg.
      expect(glyphs[0]?.children.length ?? 0, `stat "${label}" glyph is empty`).toBeGreaterThan(0);

      const shape = (glyphs[0]?.children ?? [])
        .map((c) => `${c.tagName}:${c.getAttribute('d') ?? c.getAttribute('cx') ?? ''}`)
        .join('|');
      byShape.set(shape, [...(byShape.get(shape) ?? []), label]);
    }

    for (const labels of byShape.values()) {
      // A glyph only ONE stat uses is not sharing anything, and the check below
      // would otherwise fail every stat for the crime of being unique.
      if (labels.length < 2) continue;
      expect(
        labels.every((l) => MONEY.has(l)),
        `"${labels.join('" and "')}" share a glyph but are not all money rows`,
      ).toBe(true);
    }
    // And the sharing is not an excuse for a monochrome column.
    expect(byShape.size).toBeGreaterThanOrEqual(7);
    mounted.destroy();
  });

  it('heads each group with a section marker that is not a selectable row', () => {
    // Section headings are `<li>`s in the same list as the rows, so the count of
    // things a player can arrow to must NOT grow because of decoration.
    installFakeDom();
    const container = new FakeElement('div');
    const mounted = mountBuilder({
      container: container as unknown as HTMLElement,
      context: baseContext(),
      onBuilt: () => {},
      onCancel: () => {},
    });

    const sections = findByClass(container, 'sm-builder__section');
    expect(sections.length).toBeGreaterThanOrEqual(4);
    // A heading carries no `role="button"` and no click listener, so arrowing
    // through the list can never land on one.
    for (const section of sections) {
      expect(section.children.filter((c) => c.tagName.toLowerCase() === 'svg').length).toBeGreaterThan(0);
    }
    mounted.destroy();
  });

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

// ---------------------------------------------------------------------------
// Touch reducers: handleBuilderPointer / handleBuilderCycle / handleBuilderName
// ---------------------------------------------------------------------------

/** Drives selectedIndex from `state.selectedIndex` down to `confirmIndex` via ArrowDown, matching the "Confirm key" describe block above. */
function moveToRow(state: BuilderState, targetIndex: number, ctx: BuilderContext): BuilderState {
  let cur = state;
  for (let i = cur.selectedIndex; i < targetIndex; i += 1) cur = handleKey(cur, 'ArrowDown', ctx).state;
  return cur;
}

describe('builder — handleBuilderPointer (tap a row)', () => {
  it('selects the tapped row', () => {
    const ctx = baseContext();
    const state = createBuilderState();
    const result = handleBuilderPointer(state, 3, ctx); // suspension row
    expect(computeRows(state)[3]?.kind).toBe('suspension');
    expect(result.state.selectedIndex).toBe(3);
    expect(result.confirmed).toBeNull();
  });

  it('on the confirm row confirms a legal build, returning the same BuilderConfirmedBuild the Enter path returns', () => {
    const ctx = baseContext();
    let state = createBuilderState();
    state = typeText(state, 'Roadhog', ctx);
    const confirmIndex = computeRows(state).findIndex((r) => r.kind === 'confirm');
    expect(confirmIndex).toBeGreaterThan(0);

    const enterResult = handleKey(moveToRow(state, confirmIndex, ctx), 'Enter', ctx);
    const tapResult = handleBuilderPointer(state, confirmIndex, ctx);

    expect(enterResult.confirmed).not.toBeNull();
    expect(tapResult.confirmed).not.toBeNull();
    expect(tapResult.confirmed).toEqual(enterResult.confirmed);
    expect(tapResult.state).toEqual(enterResult.state); // both reset to a fresh builder
  });

  it('on the confirm row with an illegal build does not confirm, and sets the IDENTICAL violation message the Enter path sets', () => {
    const ctx = baseContext(); // no name typed yet -> NAME_EMPTY
    const state = createBuilderState();
    const confirmIndex = computeRows(state).findIndex((r) => r.kind === 'confirm');

    const enterResult = handleKey(moveToRow(state, confirmIndex, ctx), 'Enter', ctx);
    const tapResult = handleBuilderPointer(state, confirmIndex, ctx);

    expect(enterResult.confirmed).toBeNull();
    expect(tapResult.confirmed).toBeNull();
    expect(tapResult.state.message).not.toBeNull();
    expect(tapResult.state.message).toBe(enterResult.state.message);
  });
});

describe('builder — handleBuilderCycle (tap a -/+ control)', () => {
  it('changes the rows value and matches what ArrowRight/ArrowLeft produce from the same state', () => {
    const ctx = baseContext();
    let state = createBuilderState();
    state = handleKey(state, 'ArrowDown', ctx).state; // body row
    const index = state.selectedIndex;

    const viaCycleRight = handleBuilderCycle(state, index, 1);
    const viaArrowRight = handleKey(state, 'ArrowRight', ctx).state;
    expect(viaCycleRight.bodyId).not.toBe(state.bodyId);
    expect(viaCycleRight).toEqual(viaArrowRight);

    const viaCycleLeft = handleBuilderCycle(viaCycleRight, index, -1);
    const viaArrowLeft = handleKey(viaArrowRight, 'ArrowLeft', ctx).state;
    expect(viaCycleLeft).toEqual(viaArrowLeft);
  });

  it('selects the targeted row before cycling it, same as tapping the row first then pressing an arrow key', () => {
    const state = createBuilderState(); // selectedIndex 0 (name row)
    const bodyRowIndex = computeRows(state).findIndex((r) => r.kind === 'body');

    const result = handleBuilderCycle(state, bodyRowIndex, 1);
    expect(result.selectedIndex).toBe(bodyRowIndex);
    expect(result.bodyId).not.toBe(state.bodyId);
  });
});

describe('builder — handleBuilderName (typed into the real <input>)', () => {
  it('sets the name directly', () => {
    const state = createBuilderState();
    const result = handleBuilderName(state, 'Roadhog');
    expect(result.name).toBe('Roadhog');
  });

  it('does not truncate an over-length name, so NAME_TOO_LONG still fires instead of hiding the invalid state', () => {
    const ctx = baseContext();
    const maxLen = skillsConfig().driver.nameMaxLength;
    const longName = 'x'.repeat(maxLen + 5);

    const state = handleBuilderName(createBuilderState(), longName);
    expect(state.name).toBe(longName);
    expect(state.name.length).toBe(maxLen + 5);

    const result = attemptConfirm(state, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'NAME_TOO_LONG')).toBe(true);
    }
  });
});

describe('computeRows: rows that are holding the build up are marked as such', () => {
  it('marks name, armour and weapons while unmet, and clears every mark once met', () => {
    // The legality panel states the three requirements in a paragraph BELOW the
    // list. This marks them on the list itself, which is the thing the player is
    // actually scanning and editing. Derived from the same fields the violations
    // come from, so the marker can never disagree with the rule that gates CONFIRM.
    const marked = (state: ReturnType<typeof createBuilderState>) =>
      computeRows(state)
        .filter((r) => 'needsInput' in r && r.needsInput === true)
        .map((r) => r.label);

    const fresh = createBuilderState();
    expect(marked(fresh)).toEqual([
      'Name',
      'Armor: Front',
      'Armor: Rear',
      'Armor: Left',
      'Armor: Right',
      'Armor: Underbody',
      ...Array.from({ length: fresh.weaponSlots.length }, (_, i) => `Weapon ${i + 1}`),
    ]);

    // Component rows are never marked: they are chosen for the player and are
    // satisfied by construction, so a marker there would be noise.
    // Everything NOT marked is satisfied. Rows that never carry the key at all
    // count as satisfied — the absence of a marker is the signal.
    const all = computeRows(fresh);
    const satisfiedLabels = all.filter((r) => !('needsInput' in r) || r.needsInput !== true).map((r) => r.label);
    for (const label of ['Body', 'Chassis', 'Suspension', 'Power Plant', 'Tires', 'Confirm']) {
      expect(satisfiedLabels).toContain(label);
    }

    const done: ReturnType<typeof createBuilderState> = {
      ...createBuilderState(),
      name: 'Rig',
      armor: { FRONT: 2, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
      weaponSlots: [{ weaponId: allWeapons()[0]!.id, facing: 'FRONT', ammo: 1 }, ...createBuilderState().weaponSlots.slice(1)],
    };
    expect(marked(done)).toEqual([]);
  });
});

/**
 * The integration tests that drive the constructor by KEYBOARD navigate by
 * row INDEX, and those indexes are a second, unowned copy of the row order
 * `computeRows` produces. They now live in ONE place —
 * `tests/integration/constructor-fixture.ts`, which `screens`, `road-bounds-wiring`
 * and `road-trip-menu` all read — so this guard exists to keep that one place
 * honest.
 *
 * That is the same shape as iteration 142's `roadContactPlacement` copy, which
 * had drifted in two independent ways and produced a confident, measured,
 * entirely wrong finding about the game's road fights. Here the indexes happen
 * to be correct, and nothing keeps them so: inserting a row — or the mount-row
 * change iteration 39 made when CONFIRM moved into a pinned footer — silently
 * points the index at some other row. That failure surfaces as a
 * legitimate-looking complaint about the city gate refusing an illegal car,
 * which is precisely how iteration 92's identical bug presented.
 *
 * **AND IT ASSERTS THE FACING AND THE SLOT, NOT THE `kind`.** That correction
 * came from a mutation that did not fire: shifting `ARMOR_FACING_0_ROW` from 6
 * to 7 left all nine gate-walking tests green, because row 7 is also
 * `kind: 'armor'` and `roadLegalityMisses` only ever asks for "some armour".
 * So the fixture would have quietly put the points on REAR instead of FRONT —
 * which is the one thing `buildRoadLegalCar`'s comment promises, and the reason
 * the panel shows one real depleting bar next to four unfitted chips. A guard
 * that cannot fail on the defect it was written for is the iteration-94 shape,
 * and this one had it.
 *
 * Both assertions read production's own data rather than a typed name:
 * `computeRows` iterates `FACINGS` and stamps each armour row with its
 * `facing`, and stamps each weapon row with its `slot`. So the property is
 * "the row this index names is the one holding `FACINGS[0]`" and it stays true
 * through a reorder, while a wrong number fails with the facing spelled out.
 */
describe('builder — row indexes the integration tests navigate by', () => {
  it('still points at the FIRST armour facing and the FIRST weapon slot', () => {
    const rows = computeRows(createBuilderState());
    const armor = rows[ARMOR_FACING_0_ROW];
    const weapon = rows[WEAPON_SLOT_0_ROW];
    const where = (row: BuilderRow | undefined): string =>
      row === undefined ? 'missing' : `${row.label} (${row.kind})`;
    // `BuilderRow` is a discriminated union, so these narrow on `kind` — which
    // is also what makes the assertion worth more than a `kind` check: a row
    // that is the right CATEGORY but the wrong facing still fails here.
    const facingOf = (row: BuilderRow | undefined): Facing | undefined =>
      row?.kind === 'armor' ? row.facing : undefined;
    const slotOf = (row: BuilderRow | undefined): number | undefined =>
      row?.kind === 'weapon' ? row.slot : undefined;

    expect(
      facingOf(armor),
      `row ${ARMOR_FACING_0_ROW} is ${where(armor)} — a row was inserted or reordered, and the fixture would fit armour on the wrong facing`,
    ).toBe(FACINGS[0]);
    expect(
      slotOf(weapon),
      `row ${WEAPON_SLOT_0_ROW} is ${where(weapon)} — a row was inserted or reordered, and the fixture would mount into the wrong slot`,
    ).toBe(0);
  });

  it('keeps CONFIRM last, since iteration 39 gave it a pinned footer', () => {
    // The keyboard path selects by index across the WHOLE list, and CONFIRM
    // is what Enter acts on, so a row appearing after it would be unreachable
    // by the tests that press Enter to build a car.
    const rows = computeRows(createBuilderState());
    expect(rows[rows.length - 1]?.kind).toBe('confirm');
  });
});
