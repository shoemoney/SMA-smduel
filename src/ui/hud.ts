/**
 * Combat HUD: an accessible DOM/CSS overlay rendered above the WebGPU canvas.
 *
 * `renderHud` is a pure function of a read-only `HudSnapshot` (plus the tiny
 * `HudDocument` it uses to create elements): given the same snapshot it
 * always produces the same tree. It never mutates world state, never touches
 * `Math.random`/`Date.now`, and never imports anything runtime from
 * `@/sim/**` — only types. Every displayed number that comes from game
 * balance (max DP, ammo capacity, cooldown ticks, battery capacity, top
 * speed, acceleration tiers, natural-health/body-armor caps, radar range) is
 * read from the ruleset tables through `@/data/rulesets`, never hardcoded.
 *
 * DOM access is injected through the tiny `HudDocument`/`HudElement`
 * interfaces below instead of the global `document`, so the module has zero
 * hard dependency on a browser or a DOM polyfill: production code wires it to
 * the real DOM with `createBrowserHudDocument()`; tests wire it to a small
 * fake that records the tree it built.
 */
import { accelerationTiers, allPlants, drivingConfig, getPlant, getTire, getWeapon, skillsConfig } from '@/data/rulesets';
import type { Facing, VehicleState, WeaponState } from '@/sim/types';
import { t } from '@/ui/strings';

// ---------------------------------------------------------------------------
// Minimal injectable DOM
// ---------------------------------------------------------------------------

/** The subset of `Element` the HUD needs. Implementable by a real DOM node or a test fake. */
export interface HudElement {
  readonly tagName: string;
  setAttribute(name: string, value: string): void;
  appendChild(child: HudElement): void;
  /** Detach and discard every child built by a previous render. */
  clearChildren(): void;
  setText(text: string): void;
  addEventListener(type: string, handler: () => void): void;
}

/** The subset of `Document` the HUD needs. */
export interface HudDocument {
  createElement(tag: string): HudElement;
}

class DomHudElement implements HudElement {
  constructor(private readonly el: Element) {}
  get tagName(): string {
    return this.el.tagName;
  }
  setAttribute(name: string, value: string): void {
    this.el.setAttribute(name, value);
  }
  appendChild(child: HudElement): void {
    if (child instanceof DomHudElement) this.el.appendChild(child.el);
  }
  clearChildren(): void {
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
  }
  setText(text: string): void {
    this.el.textContent = text;
  }
  addEventListener(type: string, handler: () => void): void {
    this.el.addEventListener(type, handler);
  }
}

/** Wrap a real (or DOM-shimmed) `Document` for production use. */
export function createBrowserHudDocument(doc: Document): HudDocument {
  return {
    createElement(tag: string): HudElement {
      return new DomHudElement(doc.createElement(tag));
    },
  };
}

// ---------------------------------------------------------------------------
// Snapshot contract
// ---------------------------------------------------------------------------

export type RadarOrientation = 'world' | 'heading';

export interface HudRadarContact {
  readonly id: string;
  readonly kind: 'vehicle' | 'pedestrian' | 'hazard' | 'wreck';
  /** Meters, world-frame offset from the player (+x east, +y north). */
  readonly worldDx: number;
  readonly worldDy: number;
  readonly hostile: boolean;
}

export interface HudRadarSnapshot {
  /** False when plant damage has knocked radar out; renders an offline state, not an empty one. */
  readonly enabled: boolean;
  readonly contacts: readonly HudRadarContact[];
}

export type HudMessageKind = 'hit' | 'destroyed' | 'controlLoss' | 'salvage' | 'deadline' | 'victory' | 'info';

export interface HudMessage {
  readonly id: string;
  readonly kind: HudMessageKind;
  readonly text: string;
  /** World tick the message was generated at; used only for feed ordering, never wall-clock time. */
  readonly tick: number;
}

export interface HudDriverVitals {
  readonly naturalHealth: number;
  readonly bodyArmor: number;
}

export interface HudSettings {
  /** Multiplies the `--hud-scale` custom property. */
  readonly scale: number;
  readonly radarOrientation: RadarOrientation;
  readonly reducedFlash: boolean;
  readonly reducedShake: boolean;
}

export interface HudSnapshot {
  readonly vehicle: VehicleState;
  /** Index into `vehicle.weapons`, or null when nothing is selected. */
  readonly activeWeaponIndex: number | null;
  /**
   * mph/s the build currently accelerates at, or `null` when the build is
   * UNDERPOWERED and cannot move under its own power at all (see
   * `computeBuild` in `@/sim/construct`, whose `BuildMetrics.accelMphPerSec`
   * is `number | null` for exactly this reason). The HUD only classifies a
   * non-null value against the ruleset's acceleration tiers for display; it
   * never re-derives the build math.
   */
  readonly accelMphPerSec: number | null;
  readonly radar: HudRadarSnapshot;
  readonly driver: HudDriverVitals;
  readonly messages: readonly HudMessage[];
  readonly settings: HudSettings;
}

/** Optional callbacks wired to the interactive accessibility controls. Pure event forwarding — nothing here reads or mutates world state. */
export interface HudHandlers {
  onToggleRadarOrientation?: () => void;
  onToggleReducedFlash?: () => void;
  onToggleReducedShake?: () => void;
}

// ---------------------------------------------------------------------------
// UI-only constants (not gameplay balance; see file header)
// ---------------------------------------------------------------------------

/**
 * Fixed number of weapon-mount rows drawn: by the HUD here, and by the
 * builder's fixed-length `weaponSlots` array (`@/ui/builder`, which imports
 * this constant rather than restating it). It is a UI layout constant, not a
 * legality rule — `computeBuild` (`@/sim/construct`) never rejects a design
 * for mount *count* alone, only for spaces/cost/etc — so it lives here in
 * `@/ui/` and not in `@/sim/`, and this is its one definition.
 */
export const MAX_WEAPON_ROWS = 10;
/** Recent-messages window for the feed; a display cap, not a game-balance number. */
const MESSAGE_FEED_CAP = 8;
/** Display order for the five armor facings; mirrors the `Facing` union, not a priced/weighed constant. */
const FACING_ORDER: readonly Facing[] = ['FRONT', 'REAR', 'LEFT', 'RIGHT', 'UNDERBODY'];
/** Positional labels for the fixed 4-tuple in `VehicleState.tireDP`. */
const TIRE_LABELS = ['FL', 'FR', 'RL', 'RR'] as const;

// ---------------------------------------------------------------------------
// Pure display helpers
// ---------------------------------------------------------------------------

export type DamageState = 'ok' | 'damaged' | 'critical' | 'destroyed';

/** Every damage state maps to a distinct glyph — never color alone. */
const DAMAGE_GLYPH: Record<DamageState, string> = {
  ok: '●', // ● filled circle
  damaged: '▲', // ▲ triangle
  critical: '◆', // ◆ diamond
  destroyed: '✕', // ✕ cross
};

export function damageState(current: number, max: number): DamageState {
  // A facing/component bought with zero max points (e.g. 0 armor on
  // UNDERBODY) is a legal, untouched build choice, not battle damage — this
  // must be checked BEFORE the current<=0 branch, or 0-of-0 reads as
  // "destroyed" even though nothing has ever been hit.
  if (max <= 0) return 'ok';
  if (current <= 0) return 'destroyed';
  const frac = current / max;
  if (frac <= 0.25) return 'critical';
  if (frac <= 0.75) return 'damaged';
  return 'ok';
}

function damageLabel(current: number, max: number): string {
  const state = damageState(current, max);
  return `${DAMAGE_GLYPH[state]} ${Math.max(0, current)}/${max}`;
}

function mphFromMps(speedMps: number): number {
  return (speedMps * 3600) / drivingConfig().metersPerMile;
}

/**
 * Acceleration tier label. `computeBuild` (the HUD's only source for this
 * number, per the `HudSnapshot.accelMphPerSec` contract above) always
 * assigns it from one EXACT `tier.mphPerSecond` value, or leaves it `null`
 * for an UNDERPOWERED build — so this looks up the exact tier by value
 * instead of snapping to the nearest one. A "nearest" scan silently turns
 * bad input into a plausible-looking wrong tier (0 mph/s -> the slowest
 * tier, 999 mph/s -> the fastest); an exact lookup surfaces a distinct,
 * honest state for both instead.
 */
function accelTierLabel(accelMphPerSec: number | null): string {
  if (accelMphPerSec === null) return 'Immobile — cannot accelerate';
  const tiers = [...accelerationTiers()].sort((a, b) => b.mphPerSecond - a.mphPerSecond);
  const index = tiers.findIndex((tier) => tier.mphPerSecond === accelMphPerSec);
  if (index === -1) return `Tier ?/${tiers.length}`;
  return `Tier ${index + 1}/${tiers.length}`;
}

function facingArrow(facing: Facing): string {
  switch (facing) {
    case 'FRONT':
      return '↑'; // ↑
    case 'REAR':
      return '↓'; // ↓
    case 'LEFT':
      return '←'; // ←
    case 'RIGHT':
      return '→'; // →
    case 'UNDERBODY':
      return '●'; // ●
  }
}

/** Fastest `topSpeedMph` across every plant the ruleset defines — the speedometer's honest full-scale value, never a hardcoded guess. */
function maxTopSpeedMph(): number {
  return allPlants().reduce((max, plant) => Math.max(max, plant.topSpeedMph), 0);
}

function rotate(dx: number, dy: number, headingRad: number): { x: number; y: number } {
  // Rotate a world-frame offset into vehicle-heading frame for display only —
  // pure coordinate math, not a gameplay computation.
  const cos = Math.cos(-headingRad);
  const sin = Math.sin(-headingRad);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

// ---------------------------------------------------------------------------
// Element builders
// ---------------------------------------------------------------------------

function el(doc: HudDocument, tag: string, attrs?: Readonly<Record<string, string>>, text?: string): HudElement {
  const node = doc.createElement(tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  }
  if (text !== undefined) node.setText(text);
  return node;
}

function buildWeaponRow(doc: HudDocument, index: number, state: WeaponState, active: boolean): HudElement {
  const def = getWeapon(state.weaponId);
  const usesBattery = def.usesBattery === true;
  const ammoText = usesBattery
    ? t('ui.hud.batteryPowered')
    : t('ui.hud.ammoCount', { current: state.ammo, capacity: def.ammoCapacity });
  const cooldownMax = def.cooldownTicks;
  const cooldownFrac = cooldownMax > 0 ? state.cooldownRemaining / cooldownMax : 0;
  const cooldownPct = Math.round((1 - Math.min(1, Math.max(0, cooldownFrac))) * 100);
  const ready = state.cooldownRemaining <= 0;

  const row = el(doc, 'li', {
    class: `hud-weapon-row${active ? ' hud-weapon-row--active' : ''}`,
    'data-weapon-index': String(index),
    'data-active': String(active),
  });
  if (active) row.setAttribute('aria-current', 'true');

  row.appendChild(el(doc, 'span', { class: 'hud-weapon-slot' }, String(index + 1)));
  // The ARROW ALONE, with the facing word kept in the accessible name.
  //
  // This row used to render "↑ FRONT" in a fixed 3.2em column with
  // `white-space: nowrap` and no overflow rule, so the text painted straight
  // over the weapon name beside it. Measured in a real browser: the facing's
  // content is 49px in a 33px box, the inter-column gap is 6px, so 10px of
  // "NT" landed on top of the name — the row read "FRO**Mach…** 20/20".
  //
  // Every capture in this project's history missed it, and the reason is worth
  // recording: the capture rig's car carried NO WEAPONS, so the weapons panel
  // rendered its "none fitted" line and this row's layout was never
  // photographed. It took making the rig's car genuinely road-legal — the
  // change that let the city gate stop lying — to put a real weapon in the
  // frame and expose a layout that had been wrong the whole time. An
  // unrepresentative fixture does not merely document less; it HIDES defects.
  //
  // Why the arrow and not a wider column: the panel is 260px wide holding six
  // columns, and the name is the one value that identifies the row (the
  // stylesheet says so). Measuring both options rather than picking: widening
  // the facing column to its 49px of content takes the name from 37px to 21px,
  // so "Machine Gun" truncates to "Mac…". Dropping the redundant word instead
  // gives the name roughly 72px, which fits it whole. The arrow is the
  // pre-attentive read, the word was already in the aria-label, and this is the
  // same answer the radar got 44 times over — the symbol is explained, in text,
  // for anyone who needs it.
  row.appendChild(
    el(
      doc,
      'span',
      { class: 'hud-weapon-facing', 'aria-label': t('ui.hud.weaponFacing', { facing: state.facing }) },
      facingArrow(state.facing),
    ),
  );
  row.appendChild(el(doc, 'span', { class: 'hud-weapon-name' }, def.name));
  row.appendChild(
    el(
      doc,
      'span',
      { class: 'hud-weapon-ammo', 'aria-label': usesBattery ? t('ui.hud.usesBattery') : t('ui.hud.ammunition') },
      ammoText,
    ),
  );
  row.appendChild(
    el(
      doc,
      'span',
      {
        class: `hud-weapon-cooldown${ready ? ' hud-weapon-cooldown--ready' : ''}`,
        'data-ready': String(ready),
        'aria-label': ready ? t('ui.hud.readyToFire') : t('ui.hud.coolingDown', { percent: cooldownPct }),
      },
      ready ? '● READY' : `◔ ${cooldownPct}%`,
    ),
  );
  const dpState = damageState(state.dp, state.maxDP);
  row.appendChild(
    el(
      doc,
      'span',
      {
        class: 'hud-weapon-dp',
        'data-state': dpState,
        'aria-label': t('ui.hud.componentCondition', { current: state.dp, max: state.maxDP }),
      },
      damageLabel(state.dp, state.maxDP),
    ),
  );
  return row;
}

function buildWeaponList(doc: HudDocument, vehicle: VehicleState, activeIndex: number | null): HudElement {
  const panel = el(doc, 'section', { class: 'hud-panel hud-panel--weapons', 'aria-label': t('ui.hud.ariaWeaponsPanel') });
  panel.appendChild(el(doc, 'h2', { class: 'hud-panel-title' }, t('ui.panel.weapons')));
  const list = el(doc, 'ul', { class: 'hud-weapon-list' });

  let shown = 0;
  vehicle.weapons.forEach((state, index) => {
    if (state.destroyed) return; // destroyed weapons vanish from the list entirely
    if (shown >= MAX_WEAPON_ROWS) return;
    list.appendChild(buildWeaponRow(doc, index, state, index === activeIndex));
    shown += 1;
  });

  panel.appendChild(list);

  // An EMPTY TITLED BOX READS AS AN UNFINISHED BUILD.
  //
  // This panel is a fixed corner of the arena, so with nothing fitted it
  // rendered as a bordered box headed WEAPONS containing no content whatsoever.
  // A review read the corner — an empty titled panel with the session's hex seed
  // chip tucked directly beneath it (iteration 22 put it there because every
  // other corner was spoken for) — as "a developer console left open", and named
  // the label/content mismatch as the real defect. That reading is correct about
  // the PANEL and wrong about the seed, which is real state: the full hash is in
  // the console log and the crash banner for bug reports.
  //
  // The fix belongs here rather than in the seed's placement, because the empty
  // box is the part that is actually ambiguous. The sibling `buildRadar` has
  // always handled its own nothing-to-show case explicitly (`hud-radar-offline`),
  // and iteration 21 reached the same conclusion for the armour panel — a state
  // with nothing in it should be LOUDER than an empty region, not quieter, so it
  // cannot read as an area that failed to render. An explicit line says what is
  // true: this car has no weapons fitted, which on a practice run is normal and
  // not a fault.
  if (shown === 0) {
    panel.setAttribute('data-state', 'empty');
    panel.appendChild(el(doc, 'p', { class: 'hud-weapons-empty' }, t('ui.hud.weaponsNone')));
  }
  return panel;
}

function buildRadar(doc: HudDocument, snapshot: HudSnapshot, handlers: HudHandlers): HudElement {
  const panel = el(doc, 'section', { class: 'hud-panel hud-panel--radar', 'aria-label': t('ui.hud.ariaRadarPanel') });
  panel.appendChild(el(doc, 'h2', { class: 'hud-panel-title' }, t('ui.panel.radar')));

  if (!snapshot.radar.enabled) {
    panel.setAttribute('data-state', 'offline');
    panel.appendChild(el(doc, 'p', { class: 'hud-radar-offline', role: 'status' }, t('ui.radar.offline')));
    return panel;
  }
  panel.setAttribute('data-state', 'online');

  const visualRangeM = drivingConfig().radar.visualRangeM;
  const orientation = snapshot.settings.radarOrientation;
  // 'heading' mode must rotate the player's forward vector onto screen-up.
  // Forward is (cos(headingRad), sin(headingRad)) (sim/driving.ts), so
  // heading 0 already sits along +x/screen-right — feeding `rotate` a
  // heading pre-rotated by -PI/2 is what actually lands "dead ahead" on
  // screen-up, matching the ▲ player marker and the CSS's +y-is-up mapping.
  // 'world' mode passes heading 0 through untouched: +y (north) already
  // renders as screen-up with no rotation needed.
  const heading = orientation === 'heading' ? snapshot.vehicle.headingRad - Math.PI / 2 : 0;

  // The PLAYER MARKER needs its own angle, and this is the whole fix. The
  // marker is a literal '▲' glyph with no rotation, so it pointed screen-up
  // unconditionally — correct in 'heading' mode, where the entire face is
  // rotated to put the car dead ahead, and a LIE in 'world' mode, where the
  // face is drawn in world coordinates and the car can point any direction.
  // A triangular marker is a direction cue; a fixed one tells the player their
  // car faces north when it faces east.
  // Found by Codex `gpt-6.1-sol` driving the live arena with computer use:
  // "the car points east while the radar triangle still points straight up."
  //
  // The angle: '▲' already points screen-up, and CSS rotate() is clockwise, so
  // the marker must be turned by (north-up baseline) MINUS the vehicle heading.
  // Checked at three headings:
  //   h = 0      (facing +x, screen right)  ->  +90deg, up rotated to right
  //   h = PI/2   (facing +y, screen up)     ->    0deg, unchanged
  //   h = PI     (facing -x, screen left)   ->  -90deg, up rotated to left
  // In 'heading' mode the face already carries the heading, so the marker stays
  // at 0 — rotating it as well would double-count.
  const playerMarkerDeg =
    orientation === 'heading' ? 0 : ((Math.PI / 2 - snapshot.vehicle.headingRad) * 180) / Math.PI;

  // Only contacts the face can actually place stay on it — anything beyond
  // the ruleset's visual range would render outside the circular dial (see
  // hud.css .hud-radar-face, sized off this same range) or be misreported.
  const visibleContacts = snapshot.radar.contacts.filter(
    (contact) => Math.hypot(contact.worldDx, contact.worldDy) <= visualRangeM,
  );

  // Decorative only: a compound graphic whose internal kind/color distinctions
  // AT can't perceive anyway (see the `hud-radar-contact-list` below for the
  // real, individually-announceable text alternative).
  const face = el(doc, 'div', { class: 'hud-radar-face', 'aria-hidden': 'true' });
  face.appendChild(
    el(doc, 'div', {
      class: 'hud-radar-player',
      style: `--hud-radar-player-rot:${playerMarkerDeg.toFixed(2)}deg`,
    }, '▲'),
  );

  visibleContacts.forEach((contact) => {
    const { x, y } = rotate(contact.worldDx, contact.worldDy, heading);
    // Unitless fraction of visualRangeM, in [-1, 1]; hud.css maps this onto
    // the face's radius so a contact at the edge of sensor range renders
    // exactly on the edge of the dial regardless of panel size.
    const fracX = Math.max(-1, Math.min(1, x / visualRangeM));
    const fracY = Math.max(-1, Math.min(1, y / visualRangeM));
    const dot = el(doc, 'div', {
      class: `hud-radar-contact hud-radar-contact--${contact.kind}${contact.hostile ? ' hud-radar-contact--hostile' : ''}`,
      'data-kind': contact.kind,
      'data-hostile': String(contact.hostile),
      style: `--hud-radar-x:${fracX.toFixed(3)};--hud-radar-y:${fracY.toFixed(3)}`,
    });
    face.appendChild(dot);
  });
  panel.appendChild(face);

  const summary = el(
    doc,
    'p',
    { class: 'hud-radar-summary hud-visually-hidden' },
    `${visibleContacts.length} contacts, range ${visualRangeM} meters, oriented to ${orientation}`,
  );
  panel.appendChild(summary);

  // Real DOM text per contact, so a screen reader isn't limited to the
  // summary's aggregate count (see finding: role="img" on the face above
  // prunes descendant aria-labels from the accessibility tree entirely).
  const contactList = el(doc, 'ul', { class: 'hud-radar-contact-list hud-visually-hidden' });
  visibleContacts.forEach((contact) => {
    contactList.appendChild(
      el(doc, 'li', { 'data-kind': contact.kind }, `${contact.hostile ? 'hostile' : 'contact'} ${contact.kind}`),
    );
  });
  panel.appendChild(contactList);

  const toggle = el(
    doc,
    'button',
    { type: 'button', class: 'hud-radar-orientation-toggle', 'aria-pressed': String(orientation === 'heading') },
    orientation === 'heading' ? t('ui.radar.orientationHeading') : t('ui.radar.orientationNorth'),
  );
  if (handlers.onToggleRadarOrientation) toggle.addEventListener('click', handlers.onToggleRadarOrientation);
  panel.appendChild(toggle);
  return panel;
}

function buildSpeedBlock(doc: HudDocument, snapshot: HudSnapshot): HudElement {
  const vehicle = snapshot.vehicle;
  const mph = mphFromMps(vehicle.speedMps);
  const batteryFull = drivingConfig().battery.full;
  const batteryPct = Math.round((vehicle.battery / batteryFull) * 100);
  const batteryEmpty = vehicle.battery <= 0;

  const panel = el(doc, 'section', { class: 'hud-panel hud-panel--speed', 'aria-label': t('ui.hud.ariaSpeedPanel') });

  const dial = el(doc, 'div', {
    class: 'hud-speed-dial',
    role: 'img',
    'aria-label': t('ui.hud.speedAriaLabel', { mph: mph.toFixed(0) }),
    style: `--hud-speed-frac:${Math.max(0, Math.min(1, mph / maxTopSpeedMph())).toFixed(3)}`,
  });
  panel.appendChild(dial);

  panel.appendChild(el(doc, 'div', { class: 'hud-speed-digital' }, `${mph.toFixed(0)} mph`));
  panel.appendChild(el(doc, 'div', { class: 'hud-accel-tier' }, accelTierLabel(snapshot.accelMphPerSec)));
  panel.appendChild(el(doc, 'div', { class: 'hud-odometer' }, `${vehicle.odometerMiles.toFixed(1)} mi`));

  const batteryState: DamageState = batteryEmpty ? 'destroyed' : damageState(vehicle.battery, batteryFull);
  panel.appendChild(
    el(
      doc,
      'div',
      {
        class: `hud-battery${batteryEmpty ? ' hud-battery--empty' : ''}`,
        'data-state': batteryEmpty ? 'empty' : batteryState,
        'aria-label': batteryEmpty ? t('ui.hud.batteryEmpty') : t('ui.hud.batteryPercent', { percent: batteryPct }),
      },
      batteryEmpty ? `${DAMAGE_GLYPH.destroyed} 0%` : `${DAMAGE_GLYPH[batteryState]} ${batteryPct}%`,
    ),
  );
  return panel;
}

function buildDamageFacings(doc: HudDocument, vehicle: VehicleState, driver: HudDriverVitals): HudElement {
  const panel = el(doc, 'section', { class: 'hud-panel hud-panel--damage', 'aria-label': t('ui.hud.ariaConditionPanel') });
  panel.appendChild(el(doc, 'h2', { class: 'hud-panel-title' }, t('ui.panel.condition')));

  const armorList = el(doc, 'ul', { class: 'hud-armor-list' });
  FACING_ORDER.forEach((facing) => {
    const current = vehicle.armorDP[facing];
    const max = vehicle.design.armor[facing];
    const state = damageState(current, max);
    // "NOTHING FITTED" is not the same claim as "FULLY HEALTHY", and it must
    // not LOOK the same.
    //
    // `damageState` deliberately returns 'ok' for a zero-max facing — and a
    // test pins that — because "no armour was bought here" is a build choice,
    // not battle damage, and rendering it red would be a lie about a car that
    // has never been hit. The bug was downstream of that decision: the row
    // then drew a GREEN dot beside "0/0", identical to the green beside a
    // healthy 4/4 tyre, so a review of the real frame could not tell "no armour
    // installed" from "armour undamaged". Green-on-zero also trains the player
    // to ignore the panel, which is the one instrument they will need when
    // damage does start.
    //
    // So the DAMAGE classification is untouched and a separate visual state
    // carries "nothing fitted": neutral grey, a dash, and no green.
    const unfitted = max <= 0;
    const row = el(doc, 'li', {
      class: 'hud-armor-facing',
      'data-state': unfitted ? 'unfitted' : state,
      // The accessible name always carries the full meaning, whatever the
      // visible cell says.
      'aria-label': unfitted
        ? t('ui.hud.facingArmorUnfitted', { facing })
        : t('ui.hud.facingArmor', { facing, current, max }),
    });
    if (unfitted) {
      // Built as ELEMENTS, not as a markup string. `el()` sets text through
      // `setText`, so a string containing "<span>" would have been rendered as
      // literal tag characters on screen.
      //
      // Only the unfitted cell is split, because only it needs to be contained:
      // a dash inside a dashed chip is unmistakably a slot with nothing in it,
      // where a bare faint dash reads as an area that failed to render. Fitted
      // rows keep their existing flat text, so the normal case is untouched, and
      // the concatenated text content ("FRONT: —") is unchanged either way.
      row.appendChild(el(doc, 'span', {}, `${facing}: `));
      row.appendChild(el(doc, 'span', { class: 'hud-armor-value' }, t('ui.hud.notFitted')));
    } else {
      row.setText(`${facing}: ${damageLabel(current, max)}`);
      // A filled row now carries a BAR as well as its number.
      //
      // Four reviews have now asked for one, and the framing was always the same
      // and slightly wrong: "each armor slot is depicted as an empty dashed box
      // with no fill or values ... looks like a placeholder". On a PRISTINE build
      // every facing genuinely is unfitted, so a dashed box is the honest
      // rendering and the review was describing iteration 21's fix rather than a
      // missing feature. But the underlying ask is sound for a DAMAGED car, and
      // a damaged car is the case that matters in a combat arena: four numbers
      // in a 2-column grid are genuinely hard to scan under pressure, whereas a
      // bar's length is pre-attentive.
      //
      // So the bar is added for FITTED rows only, scaled to current/max and
      // coloured by the same `data-state` the text already uses — one source of
      // truth, no new colour vocabulary. Unfitted rows keep the chip: there is
      // no fraction to scale, and a zero-length bar is precisely the "0 / 0 is a
      // fraction of nothing" problem the chip exists to avoid.
      const bar = el(doc, 'span', { class: 'hud-armor-bar' });
      const fill = el(doc, 'span', { class: 'hud-armor-bar__fill' });
      // Guarded rather than trusting the caller: a zero or negative max would
      // make this Infinity/NaN, and a NaN scaleX collapses the whole row.
      const frac = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
      fill.setAttribute('style', `transform:scaleX(${frac.toFixed(4)})`);
      bar.appendChild(fill);
      row.appendChild(bar);
    }
    armorList.appendChild(row);
  });
  // The group label goes BEFORE the rows it names. It was first inserted after
  // the list was appended, which put "ARMOUR" underneath the armour and made
  // the panel read as if the first group were unlabelled — caught by looking at
  // the rendered frame, not by any test, because both are just sibling nodes.
  panel.appendChild(el(doc, 'h3', { class: 'hud-condition-group' }, t('ui.hud.groupArmour')));
  panel.appendChild(armorList);

  // Group labels. The panel went from "twelve rows of tiny green text" to a
  // dashboard by making the armour a shape-matching grid AND naming the groups,
  // so a glance tells you which system a line belongs to without reading it.
  const tireList = el(doc, 'ul', { class: 'hud-tire-list' });
  const tireMax = getTire(vehicle.design.tireId).maxDP;
  vehicle.tireDP.forEach((dp, i) => {
    const label = TIRE_LABELS[i] ?? t('ui.hud.tireFallbackLabel', { index: i + 1 });
    const state = damageState(dp, tireMax);
    const tireRow = el(
      doc,
      'li',
      { class: 'hud-tire', 'data-state': state, 'aria-label': t('ui.hud.tireArmor', { label, current: dp, max: tireMax }) },
    );
    tireRow.appendChild(el(doc, 'span', {}, `${label}: `));
    tireRow.appendChild(el(doc, 'span', { class: 'hud-tire-value' }, damageLabel(dp, tireMax)));
    // A tyre wears down gradually, so unlike armour it is almost never in the
    // unfitted state — which makes it the best candidate in the whole panel for
    // the pre-attentive read a 4px status dot cannot give. A review said the
    // indicators are "tiny colored dots (approx 4px) that are difficult to
    // distinguish from one another or read quickly while the vehicle is moving",
    // and asked to "replace the dot indicators with wider horizontal bars that
    // visibly deplete". That is the same argument that put bars on the armour
    // rows in iteration 25, and the panel should speak ONE language: if armour
    // has a bar, a tyre must too, or the player is reading two different
    // visual grammars for the same question.
    //
    // Same fill as the armour bar — `currentColor`, so it inherits the row's
    // existing state colour and cannot disagree with the number beside it.
    const tireBar = el(doc, 'span', { class: 'hud-armor-bar hud-armor-bar--tire' });
    const tireFill = el(doc, 'span', { class: 'hud-armor-bar__fill hud-armor-bar__fill--tire' });
    const tireFrac = tireMax > 0 ? Math.max(0, Math.min(1, dp / tireMax)) : 0;
    tireFill.setAttribute('style', `transform:scaleX(${tireFrac.toFixed(4)})`);
    tireBar.appendChild(tireFill);
    tireRow.appendChild(tireBar);
    tireList.appendChild(tireRow);
  });
  panel.appendChild(el(doc, 'h3', { class: 'hud-condition-group' }, t('ui.hud.groupTyres')));
  panel.appendChild(tireList);

  panel.appendChild(el(doc, 'h3', { class: 'hud-condition-group' }, t('ui.hud.groupSystems')));
  const plantMax = getPlant(vehicle.design.plantId).maxDP;
  const plantState = damageState(vehicle.plantDP, plantMax);
  panel.appendChild(
    el(
      doc,
      'div',
      {
        class: 'hud-plant',
        'data-state': plantState,
        'aria-label': t('ui.hud.plantCondition', { current: vehicle.plantDP, max: plantMax }),
      },
      `Plant: ${damageLabel(vehicle.plantDP, plantMax)}`,
    ),
  );

  const cfg = skillsConfig().driver;
  const healthState = damageState(driver.naturalHealth, cfg.naturalHealthDP);
  panel.appendChild(
    el(
      doc,
      'div',
      {
        class: 'hud-driver-health',
        'data-state': healthState,
        'aria-label': t('ui.hud.driverHealth', { current: driver.naturalHealth, max: cfg.naturalHealthDP }),
      },
      `Driver: ${damageLabel(driver.naturalHealth, cfg.naturalHealthDP)}`,
    ),
  );
  const armorState = damageState(driver.bodyArmor, cfg.bodyArmorDP);
  panel.appendChild(
    el(
      doc,
      'div',
      {
        class: 'hud-driver-armor',
        'data-state': armorState,
        'aria-label': t('ui.hud.bodyArmor', { current: driver.bodyArmor, max: cfg.bodyArmorDP }),
      },
      `Body armor: ${damageLabel(driver.bodyArmor, cfg.bodyArmorDP)}`,
    ),
  );

  if (vehicle.cargo.length > 0) {
    const cargoList = el(doc, 'ul', { class: 'hud-cargo-list' });
    vehicle.cargo.forEach((cargo) => {
      // CargoState defines no ruleset max for `integrity` — it's a raw
      // DP-scale magnitude that applyCargoDamage (@/sim/damage) chips at
      // directly with weapon DP, not a percentage of some fixed ceiling. The
      // only threshold the sim itself treats as meaningful is "hit zero", so
      // that's the only one displayed here instead of a fabricated fraction.
      const failed = cargo.integrity <= 0;
      const state: DamageState = failed ? 'destroyed' : 'ok';
      const shown = Math.max(0, Math.round(cargo.integrity));
      cargoList.appendChild(
        el(
          doc,
          'li',
          {
            class: 'hud-cargo',
            'data-state': state,
            'aria-label': t('ui.hud.cargoIntegrity', { kind: cargo.kind, id: cargo.id, value: shown }),
          },
          `${cargo.kind}: ${DAMAGE_GLYPH[state]} ${shown}`,
        ),
      );
    });
    panel.appendChild(el(doc, 'h3', { class: 'hud-condition-group' }, t('ui.hud.groupCargo')));
    panel.appendChild(cargoList);
  }

  return panel;
}

function buildMessageFeed(doc: HudDocument, messages: readonly HudMessage[]): HudElement {
  const panel = el(doc, 'section', { class: 'hud-panel hud-panel--messages', 'aria-label': t('ui.hud.ariaMessageFeed') });
  const list = el(doc, 'ul', { class: 'hud-message-list', role: 'log', 'aria-live': 'polite', 'aria-atomic': 'false' });

  const recent = [...messages].sort((a, b) => a.tick - b.tick).slice(-MESSAGE_FEED_CAP);

  // An EMPTY feed is a dark rounded pill with nothing in it, floating under the
  // screen's status banner. On the road that is the first thing under the
  // objective line, and a vision review of the frame read it as a broken
  // progress bar — which is not what it is, but it is a fair description of
  // how it looks: a meaningless horizontal bar directly beneath the objective.
  //
  // So an empty feed renders nothing at all. The region is still built (the
  // live-region announcement behaviour does not change), it simply carries no
  // visible box, and the first message that arrives is the first thing seen.
  recent.forEach((message) => {
    list.appendChild(el(doc, 'li', { class: `hud-message hud-message--${message.kind}`, 'data-kind': message.kind }, message.text));
  });

  // The list is ALWAYS attached, empty or not: it is the `aria-live="polite"`
  // region a screen reader announces new messages into, and dropping it when
  // empty would remove the very element that has to exist before there is
  // anything to announce. An earlier version returned early on empty, which
  // silently took the live region with it.
  //
  // The `data-empty` flag only hides the BOX. See hud.css.
  //
  // The HudElement abstraction has no classList, so the state is carried by a
  // data attribute and the stylesheet keys off it — the same mechanism the rest
  // of the HUD uses for `data-state`.
  if (recent.length === 0) panel.setAttribute('data-empty', 'true');

  panel.appendChild(list);
  return panel;
}

function buildAccessibilityControls(doc: HudDocument, settings: HudSettings, handlers: HudHandlers): HudElement {
  const panel = el(doc, 'section', { class: 'hud-panel hud-panel--a11y', 'aria-label': t('ui.hud.ariaAccessibilityOptions') });

  // ONLY THE ACTIVE REDUCTION IS SHOWN.
  //
  // Three reviews have now called these two permanent chips a problem: "crowding
  // the HUD with debug information" (iteration 52), "train players to scan past
  // that corner" and "add two dead lines of text to every combat frame" (this
  // round). The earlier two asked for them REMOVED or moved into a menu, and
  // both were declined on the same ground: these are one-key reachable BECAUSE
  // they are on screen, and hiding them behind a menu means a player who needs
  // reduced shake has to find a menu mid-combat.
  //
  // This proposal is the one that survives that objection, because it keeps the
  // access and drops the noise. A chip reading "off" is not telling the player
  // anything — it is occupying a corner that otherwise carries radar, telemetry
  // and the speedometer, on every frame of every run, to report a null. A chip
  // reading "on" is load-bearing: it is how the player knows a reduction is
  // active, and how they turn it back off. So each chip is rendered only while
  // its own setting is on, and the panel hides itself entirely when both are
  // off — the same `data-empty` mechanism `buildMessageFeed` already uses for
  // the same reason.
  //
  // The trade is real and worth naming: a keyboard player can still turn either
  // reduction on with the same key, but a player who has never seen the control
  // has one fewer cue that it exists. That is a smaller loss than two permanent
  // "off" lines teaching everyone to ignore the corner.
  const flashBtn = el(
    doc,
    'button',
    { type: 'button', class: 'hud-a11y-toggle', 'aria-pressed': String(settings.reducedFlash) },
    t('ui.a11y.reducedFlash', { state: settings.reducedFlash ? t('ui.a11y.on') : t('ui.a11y.off') }),
  );
  if (handlers.onToggleReducedFlash) flashBtn.addEventListener('click', handlers.onToggleReducedFlash);

  const shakeBtn = el(
    doc,
    'button',
    { type: 'button', class: 'hud-a11y-toggle', 'aria-pressed': String(settings.reducedShake) },
    t('ui.a11y.reducedShake', { state: settings.reducedShake ? t('ui.a11y.on') : t('ui.a11y.off') }),
  );
  if (handlers.onToggleReducedShake) shakeBtn.addEventListener('click', handlers.onToggleReducedShake);

  if (settings.reducedFlash) panel.appendChild(flashBtn);
  if (settings.reducedShake) panel.appendChild(shakeBtn);
  if (!settings.reducedFlash && !settings.reducedShake) panel.setAttribute('data-empty', 'true');

  return panel;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Render the full combat HUD into `root`. Pure given (`doc`, `root`, `snapshot`):
 * clears and rebuilds `root`'s children from scratch every call so the tree
 * is always exactly what the current snapshot describes, with no leftover
 * state from a previous render (e.g. a destroyed weapon's row).
 */
export function renderHud(doc: HudDocument, root: HudElement, snapshot: HudSnapshot, handlers: HudHandlers = {}): void {
  root.clearChildren();
  root.setAttribute('class', 'hud-root');
  root.setAttribute('style', `--hud-scale:${snapshot.settings.scale}`);
  root.setAttribute('data-reduced-flash', String(snapshot.settings.reducedFlash));
  root.setAttribute('data-reduced-shake', String(snapshot.settings.reducedShake));

  root.appendChild(buildWeaponList(doc, snapshot.vehicle, snapshot.activeWeaponIndex));
  root.appendChild(buildRadar(doc, snapshot, handlers));
  root.appendChild(buildSpeedBlock(doc, snapshot));
  root.appendChild(buildDamageFacings(doc, snapshot.vehicle, snapshot.driver));
  root.appendChild(buildMessageFeed(doc, snapshot.messages));
  root.appendChild(buildAccessibilityControls(doc, snapshot.settings, handlers));
}
