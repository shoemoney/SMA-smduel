/**
 * hud.ts unit tests.
 *
 * No jsdom/happy-dom is installed and the project's vitest environment is
 * plain `node` (see vite.config.ts, which is out of scope to change here),
 * so these tests drive `renderHud` with a small in-memory `HudDocument`/
 * `HudElement` fake (a plain tree of tag/attrs/children/text) and assert on
 * the tree it built, exactly as `renderHud`'s injectable-document design
 * intends.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_WEAPON_ROWS,
  damageState,
  renderHud,
  type HudDocument,
  type HudElement,
  type HudMessage,
  type HudSnapshot,
} from '@/ui/hud';
import { createBuilderState } from '@/ui/builder';
import type { CargoState, Facing, MountedWeapon, TireDPTuple, VehicleState, WeaponState } from '@/sim/types';

// ---------------------------------------------------------------------------
// Minimal fake DOM
// ---------------------------------------------------------------------------

class FakeElement implements HudElement {
  readonly tagName: string;
  readonly attrs = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Array<() => void>>();
  text = '';

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  appendChild(child: HudElement): void {
    if (child instanceof FakeElement) this.children.push(child);
  }
  clearChildren(): void {
    this.children.length = 0;
  }
  setText(text: string): void {
    this.text = text;
  }
  addEventListener(type: string, handler: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  click(): void {
    for (const handler of this.listeners.get('click') ?? []) handler();
  }
  className(): string {
    return this.attrs.get('class') ?? '';
  }
  hasClass(name: string): boolean {
    return this.className().split(/\s+/).includes(name);
  }
}

class FakeDocument implements HudDocument {
  createElement(tag: string): HudElement {
    return new FakeElement(tag);
  }
}

function findAll(root: FakeElement, predicate: (node: FakeElement) => boolean): FakeElement[] {
  const out: FakeElement[] = [];
  const walk = (node: FakeElement): void => {
    if (predicate(node)) out.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return out;
}

function byClass(root: FakeElement, cls: string): FakeElement[] {
  return findAll(root, (n) => n.hasClass(cls));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function armorRecord(value: number): Record<Facing, number> {
  return { FRONT: value, REAR: value, LEFT: value, RIGHT: value, UNDERBODY: value };
}

function mountedWeapon(weaponId: string, facing: Facing, ammo: number): MountedWeapon {
  return { weaponId, facing, ammo };
}

interface WeaponFixtureInput {
  weaponId: string;
  facing: Facing;
  ammo: number;
  dp: number;
  maxDP: number;
  cooldownRemaining: number;
  destroyed: boolean;
}

function weaponState(input: WeaponFixtureInput): WeaponState {
  return { ...input };
}

function baseVehicle(overrides: Partial<VehicleState> = {}, weapons: WeaponFixtureInput[] = []): VehicleState {
  const weaponStates = weapons.map(weaponState);
  const designWeapons: MountedWeapon[] = weapons.map((w) => mountedWeapon(w.weaponId, w.facing, w.ammo));
  const tireDP: TireDPTuple = [4, 4, 4, 4];
  const cargo: CargoState[] = [];

  return {
    id: 'veh-1',
    ownerId: 'driver-1',
    design: {
      name: 'Test Rig',
      bodyId: 'subcompact',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'small',
      tireId: 'standard',
      armor: armorRecord(10),
      weapons: designWeapons,
    },
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 20,
    battery: 99,
    odometerMiles: 12.5,
    armorDP: armorRecord(10),
    tireDP,
    plantDP: 5,
    weapons: weaponStates,
    cargo,
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    ...overrides,
  };
}

function baseSnapshot(overrides: Partial<HudSnapshot> = {}): HudSnapshot {
  return {
    vehicle: baseVehicle(),
    activeWeaponIndex: null,
    accelMphPerSec: 10,
    radar: { enabled: true, contacts: [] },
    driver: { naturalHealth: 3, bodyArmor: 3 },
    messages: [],
    settings: { scale: 1, radarOrientation: 'world', reducedFlash: false, reducedShake: false },
    ...overrides,
  };
}

function render(snapshot: HudSnapshot): { doc: FakeDocument; root: FakeElement } {
  const doc = new FakeDocument();
  const root = new FakeElement('div');
  renderHud(doc, root, snapshot);
  return { doc, root };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('damageState', () => {
  it('classifies by remaining fraction, never by color', () => {
    expect(damageState(10, 10)).toBe('ok');
    expect(damageState(6, 10)).toBe('damaged');
    expect(damageState(2, 10)).toBe('critical');
    expect(damageState(0, 10)).toBe('destroyed');
    expect(damageState(-3, 10)).toBe('destroyed');
  });

  it('treats a zero-max facing (0 armor points bought) as untouched, not destroyed', () => {
    // A legal build choice (e.g. 0 armor on UNDERBODY) — construct.ts never
    // enforces a minimum armor purchase — must not read as battle damage.
    expect(damageState(0, 0)).toBe('ok');
    // max <= 0 always wins regardless of current, since there is nothing to
    // take a fraction of.
    expect(damageState(5, 0)).toBe('ok');
  });
});

describe('weapon list', () => {
  const weapons: WeaponFixtureInput[] = [
    { weaponId: 'machinegun', facing: 'FRONT', ammo: 12, dp: 3, maxDP: 3, cooldownRemaining: 0, destroyed: false },
    { weaponId: 'laser', facing: 'LEFT', ammo: 0, dp: 1, maxDP: 2, cooldownRemaining: 10, destroyed: false },
    { weaponId: 'rocketlauncher', facing: 'REAR', ammo: 5, dp: 0, maxDP: 2, cooldownRemaining: 0, destroyed: true },
    { weaponId: 'flamethrower', facing: 'RIGHT', ammo: 0, dp: 0, maxDP: 3, cooldownRemaining: 0, destroyed: false },
  ];

  it('drops a destroyed weapon from the rendered list entirely', () => {
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({}, weapons), activeWeaponIndex: 1 }));
    const rows = byClass(root, 'hud-weapon-row');
    expect(rows).toHaveLength(3); // 4 mounted, 1 destroyed -> vanishes
    const weaponIndices = rows.map((r) => r.attrs.get('data-weapon-index'));
    expect(weaponIndices).not.toContain('2'); // the destroyed rocketlauncher's index
  });

  it('marks the active weapon distinctly (class + aria-current), not the others', () => {
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({}, weapons), activeWeaponIndex: 1 }));
    const rows = byClass(root, 'hud-weapon-row');
    const active = rows.filter((r) => r.attrs.get('data-active') === 'true');
    expect(active).toHaveLength(1);
    expect(active[0]?.attrs.get('data-weapon-index')).toBe('1');
    expect(active[0]?.hasClass('hud-weapon-row--active')).toBe(true);
    expect(active[0]?.attrs.get('aria-current')).toBe('true');
    const inactive = rows.filter((r) => r.attrs.get('data-active') === 'false');
    inactive.forEach((r) => expect(r.attrs.has('aria-current')).toBe(false));
  });

  it('gives a live component (0 DP, not flagged destroyed) a distinct non-color damage state and label', () => {
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({}, weapons) }));
    const dpBadges = byClass(root, 'hud-weapon-dp');
    const destroyedLookingBadge = dpBadges.find((b) => b.attrs.get('data-state') === 'destroyed');
    expect(destroyedLookingBadge).toBeDefined();
    expect(destroyedLookingBadge?.text).toMatch(/0\/3/);
    expect(destroyedLookingBadge?.text).not.toBe('destroyed'); // carries a shape/glyph, not just the word
  });

  it('caps the visible list at MAX_WEAPON_ROWS even with more mounts', () => {
    const many: WeaponFixtureInput[] = Array.from({ length: MAX_WEAPON_ROWS + 2 }, () => ({
      weaponId: 'machinegun',
      facing: 'FRONT',
      ammo: 5,
      dp: 3,
      maxDP: 3,
      cooldownRemaining: 0,
      destroyed: false,
    }));
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({}, many) }));
    expect(byClass(root, 'hud-weapon-row')).toHaveLength(MAX_WEAPON_ROWS);
  });

  // Regression guard for the HUD's row cap and the builder's fixed mount-slot
  // array silently drifting apart: both must read the exact same constant
  // (`MAX_WEAPON_ROWS`, exported once from `@/ui/hud`), so if a future edit
  // reintroduces a second hand-typed copy in either module, this fails the
  // moment the two diverge instead of only when someone notices the UI.
  it('renders exactly as many weapon rows as the builder offers mount slots', () => {
    const builderSlotCount = createBuilderState().weaponSlots.length;
    const many: WeaponFixtureInput[] = Array.from({ length: builderSlotCount + 5 }, () => ({
      weaponId: 'machinegun',
      facing: 'FRONT',
      ammo: 5,
      dp: 3,
      maxDP: 3,
      cooldownRemaining: 0,
      destroyed: false,
    }));
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({}, many) }));
    expect(byClass(root, 'hud-weapon-row')).toHaveLength(builderSlotCount);
    expect(builderSlotCount).toBe(MAX_WEAPON_ROWS);
  });

  it('shows a battery glyph (not an ammo count) for a battery-powered weapon', () => {
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({}, weapons) }));
    const ammoBadges = byClass(root, 'hud-weapon-ammo');
    const laserBadge = ammoBadges.find((b) => b.attrs.get('aria-label') === 'uses battery');
    expect(laserBadge?.text).toContain('battery');
  });
});

describe('radar', () => {
  it('renders a distinct offline state, not an empty contact list, when disabled', () => {
    const { root } = render(
      baseSnapshot({
        radar: { enabled: false, contacts: [{ id: 'x', kind: 'vehicle', worldDx: 10, worldDy: 0, hostile: true }] },
      }),
    );
    const panel = byClass(root, 'hud-panel--radar')[0];
    expect(panel?.attrs.get('data-state')).toBe('offline');
    const offline = byClass(root, 'hud-radar-offline');
    expect(offline).toHaveLength(1);
    expect(offline[0]?.text).toMatch(/OFFLINE/);
    // No contact dots should be rendered while offline.
    expect(byClass(root, 'hud-radar-contact')).toHaveLength(0);
  });

  it('renders contacts with a shape/kind label, not color alone, when enabled', () => {
    const { root } = render(
      baseSnapshot({
        radar: {
          enabled: true,
          contacts: [
            { id: 'a', kind: 'vehicle', worldDx: 30, worldDy: 0, hostile: true },
            { id: 'b', kind: 'pedestrian', worldDx: 0, worldDy: -5, hostile: false },
          ],
        },
      }),
    );
    const panel = byClass(root, 'hud-panel--radar')[0];
    expect(panel?.attrs.get('data-state')).toBe('online');
    const contacts = byClass(root, 'hud-radar-contact');
    expect(contacts).toHaveLength(2);
    expect(contacts.every((c) => c.attrs.has('data-kind'))).toBe(true);
    expect(contacts.some((c) => c.attrs.get('data-hostile') === 'true')).toBe(true);
  });

  it('exposes an orientation toggle button that calls back on click', () => {
    let toggled = 0;
    const doc = new FakeDocument();
    const root = new FakeElement('div');
    renderHud(doc, root, baseSnapshot(), { onToggleRadarOrientation: () => (toggled += 1) });
    const toggle = byClass(root, 'hud-radar-orientation-toggle')[0] as FakeElement | undefined;
    expect(toggle).toBeDefined();
    toggle?.click();
    expect(toggled).toBe(1);
  });

  it('plots a contact dead ahead straight up (not to the side) in heading-up mode', () => {
    // Facing north (headingRad = PI/2, sim/driving.ts's forward = (cos, sin)
    // convention) with a contact 40m due north of the player: heading-up
    // must place it at the nose (x ~ 0, y > 0), never off to a side (x != 0).
    const { root } = render(
      baseSnapshot({
        vehicle: baseVehicle({ headingRad: Math.PI / 2 }),
        settings: { scale: 1, radarOrientation: 'heading', reducedFlash: false, reducedShake: false },
        radar: { enabled: true, contacts: [{ id: 'ahead', kind: 'vehicle', worldDx: 0, worldDy: 40, hostile: false }] },
      }),
    );
    const contact = byClass(root, 'hud-radar-contact')[0];
    const style = contact?.attrs.get('style') ?? '';
    const x = Number(/--hud-radar-x:(-?[\d.]+)/.exec(style)?.[1]);
    const y = Number(/--hud-radar-y:(-?[\d.]+)/.exec(style)?.[1]);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeGreaterThan(0);
  });

  it('does not rotate contacts at all in world (north-up) mode regardless of heading', () => {
    const { root } = render(
      baseSnapshot({
        vehicle: baseVehicle({ headingRad: Math.PI / 2 }),
        settings: { scale: 1, radarOrientation: 'world', reducedFlash: false, reducedShake: false },
        radar: { enabled: true, contacts: [{ id: 'north', kind: 'vehicle', worldDx: 0, worldDy: 40, hostile: false }] },
      }),
    );
    const contact = byClass(root, 'hud-radar-contact')[0];
    const style = contact?.attrs.get('style') ?? '';
    const x = Number(/--hud-radar-x:(-?[\d.]+)/.exec(style)?.[1]);
    const y = Number(/--hud-radar-y:(-?[\d.]+)/.exec(style)?.[1]);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeGreaterThan(0);
  });

  it('scales contact position to the ruleset visual range, not a fixed pixel guess', () => {
    // driving.json's radar.visualRangeM is 160: a contact exactly at that
    // range must land exactly on the edge of the face (fraction magnitude 1),
    // not somewhere derived from an arbitrary CSS pixel constant.
    const { root } = render(
      baseSnapshot({
        radar: { enabled: true, contacts: [{ id: 'edge', kind: 'vehicle', worldDx: 160, worldDy: 0, hostile: false }] },
      }),
    );
    const contact = byClass(root, 'hud-radar-contact')[0];
    const style = contact?.attrs.get('style') ?? '';
    const x = Number(/--hud-radar-x:(-?[\d.]+)/.exec(style)?.[1]);
    expect(x).toBeCloseTo(1, 3);
  });

  it('culls contacts beyond the ruleset visual range instead of letting them escape the face', () => {
    const { root } = render(
      baseSnapshot({
        radar: {
          enabled: true,
          contacts: [
            { id: 'far', kind: 'vehicle', worldDx: 500, worldDy: 0, hostile: false }, // beyond visualRangeM (160)
            { id: 'near', kind: 'vehicle', worldDx: 10, worldDy: 0, hostile: false },
          ],
        },
      }),
    );
    const contacts = byClass(root, 'hud-radar-contact');
    expect(contacts).toHaveLength(1);
    const summary = byClass(root, 'hud-radar-summary')[0];
    expect(summary?.text).toMatch(/^1 contacts/);
  });

  it('makes each contact a real, individually-announceable text node instead of only aria-label under a pruned role=img subtree', () => {
    const { root } = render(
      baseSnapshot({
        radar: {
          enabled: true,
          contacts: [{ id: 'h1', kind: 'pedestrian', worldDx: 5, worldDy: 5, hostile: true }],
        },
      }),
    );
    const face = byClass(root, 'hud-radar-face')[0];
    expect(face?.attrs.get('aria-hidden')).toBe('true'); // decorative; not where AT should look
    const list = byClass(root, 'hud-radar-contact-list');
    expect(list).toHaveLength(1);
    const items = list[0]?.children ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toMatch(/hostile pedestrian/);
  });
});

describe('speed / battery', () => {
  it('renders 0 battery as a visually and textually distinct empty state', () => {
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({ battery: 0 }) }));
    const battery = byClass(root, 'hud-battery')[0];
    expect(battery?.attrs.get('data-state')).toBe('empty');
    expect(battery?.hasClass('hud-battery--empty')).toBe(true);
    expect(battery?.text).toMatch(/0%/);
  });

  it('renders a non-empty battery with its own percentage label', () => {
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({ battery: 50 }) }));
    const battery = byClass(root, 'hud-battery')[0];
    expect(battery?.attrs.get('data-state')).not.toBe('empty');
    expect(battery?.text).toMatch(/%/);
  });

  it('converts speed to mph using the ruleset metersPerMile, not a hardcoded factor', () => {
    // Expected value derived independently from the documented rule
    // (speedMps * 3600 / metersPerMile), not copied from the implementation:
    // 20 m/s * 3600 / 1609.344 = 44.7386... -> "45 mph". Any other factor
    // (a hardcoded 2.237, or 0) would produce a different rounded value, so
    // unlike a speedMps:0 fixture this assertion can actually fail.
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({ speedMps: 20 }) }));
    const digital = byClass(root, 'hud-speed-digital')[0];
    expect(digital?.text).toBe('45 mph');
  });

  it('scales the speed dial to the ruleset\'s fastest plant, not a hardcoded 200 mph ceiling', () => {
    // plants.json's fastest plant tops out at 90 mph (topSpeedMph: 90 on
    // "large"/"super"). A hardcoded /200 ceiling would render this build at
    // 45% of the dial's sweep; the honest full-scale value puts it at 100%.
    const metersPerMile = 1609.344; // driving.json, asserted independently in rulesets.test.ts
    const speedMpsAt90Mph = (90 * metersPerMile) / 3600;
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({ speedMps: speedMpsAt90Mph }) }));
    const dial = byClass(root, 'hud-speed-dial')[0];
    const style = dial?.attrs.get('style') ?? '';
    const frac = Number(/--hud-speed-frac:([\d.]+)/.exec(style)?.[1]);
    expect(frac).toBeCloseTo(1, 2);
  });

  it('labels an UNDERPOWERED (accelMphPerSec: null) build distinctly, not as a fake nearest tier', () => {
    const { root } = render(baseSnapshot({ accelMphPerSec: null }));
    const tier = byClass(root, 'hud-accel-tier')[0];
    expect(tier?.text.toLowerCase()).toContain('immobile');
    expect(tier?.text).not.toMatch(/Tier \d/);
  });

  it('labels acceleration by an EXACT ruleset tier match, not the nearest one', () => {
    // plants.json's accelerationTiers are exactly [15, 10, 5] mph/s.
    const { root: r15 } = render(baseSnapshot({ accelMphPerSec: 15 }));
    expect(byClass(r15, 'hud-accel-tier')[0]?.text).toBe('Tier 1/3');
    const { root: r5 } = render(baseSnapshot({ accelMphPerSec: 5 }));
    expect(byClass(r5, 'hud-accel-tier')[0]?.text).toBe('Tier 3/3');
  });

  it('does not silently snap an out-of-range acceleration value to a plausible-looking wrong tier', () => {
    // A midpoint (12.5, between the 15 and 10 tiers) or a wildly out-of-range
    // value (999) are both NOT exact tier values computeBuild would ever
    // produce; a nearest-tier scan used to swallow both into a confident-
    // looking "Tier 1/3" instead of surfacing that something is wrong.
    const { root: rMid } = render(baseSnapshot({ accelMphPerSec: 12.5 }));
    const midText = byClass(rMid, 'hud-accel-tier')[0]?.text;
    expect(midText).not.toMatch(/^Tier \d\/3$/);

    const { root: rHigh } = render(baseSnapshot({ accelMphPerSec: 999 }));
    const highText = byClass(rHigh, 'hud-accel-tier')[0]?.text;
    expect(highText).not.toMatch(/^Tier \d\/3$/);
  });
});

describe('vehicle condition panel', () => {
  it('lists all five armor facings and four tires with non-color damage state', () => {
    const { root } = render(baseSnapshot());
    const armor = byClass(root, 'hud-armor-facing');
    expect(armor).toHaveLength(5);
    armor.forEach((a) => expect(a.attrs.has('data-state')).toBe(true));
    const tires = byClass(root, 'hud-tire');
    expect(tires).toHaveLength(4);
  });

  it('scales the armour bar to current/max, and gives an UNFITTED facing no bar at all', () => {
    // A bar whose length is current/max is the pre-attentive read a 2-column
    // grid of numbers cannot give under pressure — but only for a facing that
    // has armour to lose. A zero-max facing gets the dashed chip instead,
    // because "0 / 0" is a fraction of nothing and a zero-length bar is the same
    // lie in a different costume.
    const fitted = baseVehicle(
      { armorDP: { FRONT: 3, REAR: 1, LEFT: 4, RIGHT: 0, UNDERBODY: 2 } },
      [],
    );
    // The design's max is the source of "is anything fitted", so zero it on one
    // facing rather than only zeroing the damage pool.
    (fitted.design as { armor: Record<string, number> }).armor = { FRONT: 4, REAR: 4, LEFT: 4, RIGHT: 0, UNDERBODY: 4 };
    const { root } = render(baseSnapshot({ vehicle: fitted }));

    // Scoped to ARMOUR bars: tyre fills carry their own modifier class precisely
    // so this query cannot start counting them when tyres grew bars too.
    const bars = byClass(root, 'hud-armor-bar__fill').filter((b) => !b.hasClass('hud-armor-bar__fill--tire'));
    // Four fitted facings, one unfitted (right, max 0).
    expect(bars).toHaveLength(4);
    const scales = bars.map((b) => Number(/scaleX\(([\d.]+)\)/.exec(b.attrs.get('style') ?? '')?.[1])).sort((a, b) => a - b);
    // 1/4 (rear), 2/4 (underbody), 3/4 (front), 4/4 (left). RIGHT is max 0, so
    // it is unfitted and contributes no bar at all.
    expect(scales).toEqual([0.25, 0.5, 0.75, 1]);
    for (const scale of scales) {
      expect(Number.isFinite(scale)).toBe(true);
    }
  });

  it('clamps a damaged bar instead of trusting current/max to be in range', () => {
    // A negative or over-max current would make the scale NaN or >1, and a NaN
    // scaleX collapses the entire row rather than just the bar.
    const { root } = render(
      baseSnapshot({ vehicle: baseVehicle({ armorDP: { FRONT: 9, REAR: -2, LEFT: 1, RIGHT: 0, UNDERBODY: 0 } }, []) }),
    );
    const scales = byClass(root, 'hud-armor-bar__fill')
      .filter((b) => !b.hasClass('hud-armor-bar__fill--tire'))
      .map((b) => Number(/scaleX\(([\d.]+)\)/.exec(b.attrs.get('style') ?? '')?.[1]));
    for (const scale of scales) {
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThanOrEqual(0);
      expect(scale).toBeLessThanOrEqual(1);
    }
  });


  it('gives every tyre a depleting bar, on the same visual grammar as armour', () => {
    // A review called the condition indicators "tiny colored dots (approx 4px)
    // that are difficult to distinguish from one another or read quickly while
    // the vehicle is moving". Armour got bars in iteration 25; if tyres kept dots
    // the panel would be answering the same question in two visual grammars.
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({}, []) }));
    const tireBars = byClass(root, 'hud-armor-bar__fill--tire');
    expect(tireBars).toHaveLength(4);
    // baseVehicle's tyreDP is 4/4 across, so every bar is full.
    for (const bar of tireBars) {
      expect(/scaleX\(1\.0000\)/.test(bar.attrs.get('style') ?? '')).toBe(true);
    }
  });


  it('renders cargo integrity as its own raw magnitude, not a fabricated percentage of an invented max', () => {
    // No ruleset table defines a cargo integrity max, and sim/damage.ts's
    // applyCargoDamage subtracts raw weapon DP straight off it — a "%" sign
    // here would imply a scale (out of 100) that does not exist.
    const cargo: CargoState[] = [{ id: 'c1', kind: 'payload', weightLb: 100, spaces: 2, integrity: 40 }];
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({ cargo }) }));
    const cargoRows = byClass(root, 'hud-cargo');
    expect(cargoRows).toHaveLength(1);
    expect(cargoRows[0]?.text).toContain('40');
    expect(cargoRows[0]?.text).not.toContain('%');
    expect(cargoRows[0]?.attrs.get('data-state')).toBe('ok');
  });

  it('marks cargo destroyed once integrity hits zero, distinct from merely damaged', () => {
    const cargo: CargoState[] = [{ id: 'c1', kind: 'payload', weightLb: 100, spaces: 2, integrity: 0 }];
    const { root } = render(baseSnapshot({ vehicle: baseVehicle({ cargo }) }));
    const cargoRow = byClass(root, 'hud-cargo')[0];
    expect(cargoRow?.attrs.get('data-state')).toBe('destroyed');
  });
});

describe('message feed', () => {
  function msg(id: string, tick: number): HudMessage {
    return { id, kind: 'hit', text: `event ${id}`, tick };
  }

  it('caps the number of rendered messages', () => {
    const messages = Array.from({ length: 20 }, (_, i) => msg(`m${i}`, i));
    const { root } = render(baseSnapshot({ messages }));
    const items = byClass(root, 'hud-message');
    expect(items.length).toBeLessThanOrEqual(8);
    expect(items.length).toBeGreaterThan(0);
  });

  it('keeps the most recent messages, dropping the oldest first', () => {
    const messages = Array.from({ length: 20 }, (_, i) => msg(`m${i}`, i));
    const { root } = render(baseSnapshot({ messages }));
    const items = byClass(root, 'hud-message');
    const texts = items.map((i) => i.text);
    expect(texts).toContain('event m19');
    expect(texts).not.toContain('event m0');
  });

  it('is a polite, non-atomic live region', () => {
    const { root } = render(baseSnapshot());
    const list = byClass(root, 'hud-message-list')[0];
    expect(list?.attrs.get('aria-live')).toBe('polite');
    expect(list?.attrs.get('role')).toBe('log');
  });
});

describe('settings', () => {
  it('applies the HUD scale as a CSS custom property on the root', () => {
    const { root } = render(baseSnapshot({ settings: { scale: 1.5, radarOrientation: 'world', reducedFlash: false, reducedShake: false } }));
    expect(root.attrs.get('style')).toContain('--hud-scale:1.5');
  });

  it('reflects reduced-flash and reduced-shake on the root as data attributes', () => {
    const { root } = render(baseSnapshot({ settings: { scale: 1, radarOrientation: 'world', reducedFlash: true, reducedShake: true } }));
    expect(root.attrs.get('data-reduced-flash')).toBe('true');
    expect(root.attrs.get('data-reduced-shake')).toBe('true');
  });

  // Only the ACTIVE reduction is rendered (see `buildAccessibilityControls`): a
  // chip reading "off" reports a null in a corner that carries live telemetry, so
  // both chips are omitted while both settings are off and the panel marks
  // itself empty for the stylesheet to hide. Asserted in BOTH directions now,
  // where the old version asserted only that two buttons exist — which is how a
  // permanently-visible pair of "off" chips survived three reviews unnoticed.
  it('hides the accessibility panel entirely when neither reduction is active', () => {
    const { root } = render(baseSnapshot({ settings: { scale: 1, radarOrientation: 'world', reducedFlash: false, reducedShake: false } }));
    const panel = byClass(root, 'hud-panel--a11y')[0] as FakeElement;
    expect(byClass(root, 'hud-a11y-toggle')).toHaveLength(0);
    expect(panel.attrs.get('data-empty')).toBe('true');
  });

  it('wires the reduced-flash and reduced-shake toggle buttons to their handlers', () => {
    let flash = 0;
    let shake = 0;
    const doc = new FakeDocument();
    const root = new FakeElement('div');
    renderHud(doc, root, baseSnapshot({ settings: { scale: 1, radarOrientation: 'world', reducedFlash: true, reducedShake: true } }), {
      onToggleReducedFlash: () => (flash += 1),
      onToggleReducedShake: () => (shake += 1),
    });
    const panel = byClass(root, 'hud-panel--a11y')[0] as FakeElement;
    expect(panel.attrs.get('data-empty')).toBeUndefined();
    const buttons = byClass(root, 'hud-a11y-toggle') as FakeElement[];
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => b.click());
    expect(flash).toBe(1);
    expect(shake).toBe(1);
  });

  it('renders only the one chip whose reduction is active', () => {
    const { root } = render(baseSnapshot({ settings: { scale: 1, radarOrientation: 'world', reducedFlash: true, reducedShake: false } }));
    const panel = byClass(root, 'hud-panel--a11y')[0] as FakeElement;
    expect(byClass(root, 'hud-a11y-toggle')).toHaveLength(1);
    expect(panel.attrs.get('data-empty')).toBeUndefined();
  });
});

describe('purity', () => {
  it('renders identical trees for identical snapshots', () => {
    const snapshot = baseSnapshot();
    const a = render(snapshot).root;
    const b = render(snapshot).root;
    const serialize = (node: FakeElement): unknown => ({
      tag: node.tagName,
      attrs: [...node.attrs.entries()].sort(),
      text: node.text,
      children: node.children.map(serialize),
    });
    expect(serialize(a)).toEqual(serialize(b));
  });

  it('rebuilds root children from scratch, clearing anything from a previous render', () => {
    const doc = new FakeDocument();
    const root = new FakeElement('div');
    root.appendChild(new FakeElement('stale'));
    renderHud(doc, root, baseSnapshot());
    expect(root.children.some((c) => c.tagName === 'STALE')).toBe(false);
  });
});
