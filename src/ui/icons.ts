/**
 * The game's icon set: inline SVG, drawn here rather than pulled from an icon
 * font.
 *
 * ## Why these are hand-authored and not Font Awesome
 *
 * Icon fonts were the obvious pick and the wrong one here, for three reasons
 * that all showed up while building this:
 *
 * 1. **A webfont is a network request on the critical path.** The first thing
 *    these icons appear on is the driver-creation card, one interaction after
 *    boot. A 100KB+ font that has not arrived renders as invisible boxes or as
 *    a flash of fallback glyphs.
 * 2. **`currentColor` gives them the theme for free.** Every icon inherits
 *    whatever colour its context sets, so the same `shield` is teal in a
 *    heading, amber on a damaged facing and red on a destroyed one with no
 *    per-icon colour table and no second asset.
 * 3. **This is a WebGPU game that draws its own art.** The sprite atlas and the
 *    procedural renderer are how everything else is made; a flat cartoon icon
 *    set from a stock pack reads as a different product pasted on top.
 *
 * Every glyph is a 24x24 stroke drawing on a shared grid — `fill: none`,
 * `stroke: currentColor`, round caps and joins — so a row of six icons reads as
 * one set rather than six donations.
 *
 * ## Why the shapes are data and not an SVG string
 *
 * The first version of this file held each icon as a markup string and assigned
 * it with `innerHTML`. That is the obvious approach and it is wrong here: the
 * integration suite runs against `happy-dom`, where `innerHTML` on an
 * `SVGElement` does not reliably produce namespaced children, so the icons
 * would render in a real browser and be missing from every DOM test. Building
 * each node with `createElementNS` is a few more lines and behaves identically
 * in both places, which is the only definition of "works" that counts here.
 */

/** One drawing element: a tag plus its attributes. */
type Shape = readonly [tag: string, attrs: Readonly<Record<string, string | number>>];

/** Every icon in the set, on the shared 24x24 grid. */
const ICONS = {
  /** An identity card — the driver's name. */
  'id-badge': [
    ['rect', { x: 2.5, y: 4.5, width: 19, height: 15, rx: 2.5 }],
    ['circle', { cx: 8.5, cy: 10.5, r: 2.2 }],
    ['path', { d: 'M5 16.4c.5-1.7 1.9-2.6 3.5-2.6s3 .9 3.5 2.6' }],
    ['path', { d: 'M14.5 9.5h4M14.5 12.5h4M14.5 15.5h2.5' }],
  ],
  /** An ignition key: the ring, the shaft, the teeth. */
  key: [
    ['circle', { cx: 7.5, cy: 7.5, r: 4 }],
    ['path', { d: 'M10.4 10.4 20 20' }],
    ['path', { d: 'M17 17l2-2' }],
    ['path', { d: 'M19.5 19.5 22 22' }],
  ],
  /** A steering wheel — the driving skill. */
  'steering-wheel': [
    ['circle', { cx: 12, cy: 12, r: 8 }],
    ['circle', { cx: 12, cy: 12, r: 2.4 }],
    ['path', { d: 'M12 3.6V9.6M4.6 16.2 9.4 13.2M19.4 16.2 14.6 13.2' }],
  ],
  /** A crosshair — the marksmanship skill. */
  crosshair: [
    ['circle', { cx: 12, cy: 12, r: 7.5 }],
    ['path', { d: 'M12 1.8v4.2M12 18v4.2M1.8 12H6M18 12h4.2' }],
    ['circle', { cx: 12, cy: 12, r: 1.4 }],
  ],
  /** A wrench — the mechanic skill. */
  wrench: [['path', { d: 'M15.6 3.4a5 5 0 0 0-5.9 6.4L3.5 16a2 2 0 0 0 2.8 2.8l6.2-6.2a5 5 0 0 0 6.4-5.9l-3 3-2.4-.6-.6-2.4Z' }]],
  /** A shield — armour, at any scale. */
  shield: [['path', { d: 'M12 2.6 4.5 5.4v6.1c0 4.4 3.1 8.3 7.5 9.9 4.4-1.6 7.5-5.5 7.5-9.9V5.4Z' }]],
  /** A solid chevron, rotated per facing to say which side of the car. */
  chevron: [['path', { d: 'M12 4.5 19 13h-5.2v6.5h-3.6V13H5Z', fill: 'currentColor', stroke: 'none' }]],
  /** A block and its caps — the powertrain section. */
  engine: [
    ['path', { d: 'M3.5 10.5h3v-2h3v-2h3v2h3v-2h3l2 2v6l-2 2h-3v2h-3v-2h-3v2h-3v-2h-3Z' }],
    ['path', { d: 'M9 8.5v7M15 8.5v7' }],
  ],
  /** A balance — mass. */
  scale: [
    ['path', { d: 'M12 4.2v15.6M7.5 19.8h9M4 9.4h16' }],
    ['path', { d: 'M4 9.4 1.6 15a2.6 2.6 0 0 0 4.8 0Z' }],
    ['path', { d: 'M20 9.4 17.6 15a2.6 2.6 0 0 0 4.8 0Z' }],
  ],
  /** A coin — money and value. */
  coin: [
    ['circle', { cx: 12, cy: 12, r: 8.4 }],
    ['path', { d: 'M12 7.4v9.2M14.4 9.6c-.5-.8-1.4-1.2-2.4-1.2-1.4 0-2.4.8-2.4 1.9 0 2.6 4.8 1.2 4.8 3.8 0 1.1-1 1.9-2.4 1.9-1 0-1.9-.4-2.4-1.2' }],
  ],
  /** A gun mount — the weapons section. */
  weapon: [
    ['path', { d: 'M3 9.5h13.5l4.5 2.2V15h-5.2l-1.4 2.4H11l.6-2.4H3Z' }],
    ['path', { d: 'M6.5 9.5V7.2h4.2v2.3' }],
  ],
  /** A dial — performance read-outs. */
  gauge: [
    ['path', { d: 'M3.6 17.5a9 9 0 1 1 16.8 0' }],
    ['path', { d: 'M12 13.8 16.2 9' }],
    ['circle', { cx: 12, cy: 15, r: 1.5 }],
  ],
  /** A car in profile — the vehicle itself. */
  car: [
    ['path', { d: 'M2.6 15.5h18.8v3.2h-3v-1.6H5.6v1.6h-3Z' }],
    ['path', { d: 'M4.6 15.5 6 10.8h12l1.4 4.7M6 10.8 7.6 7.4h8.8L18 10.8' }],
    ['circle', { cx: 7.4, cy: 18.7, r: 1.5 }],
    ['circle', { cx: 16.6, cy: 18.7, r: 1.5 }],
  ],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The rotation, in degrees, that points `chevron` at each armour facing. */
const FACING_ROTATION: Readonly<Record<string, number>> = {
  FRONT: 0,
  REAR: 180,
  LEFT: -90,
  RIGHT: 90,
  // Underbody has no lateral direction to point at; the shield carries it and
  // the chevron is suppressed by the caller rather than drawn pointing at
  // nothing. See `facingIcon`.
  UNDERBODY: 0,
};

/** True when a facing is one of the four that have a direction to point at. */
export function facingHasDirection(facing: string): boolean {
  return facing !== 'UNDERBODY';
}

/**
 * Builds an icon element.
 *
 * @param name which glyph from the set
 * @param options.className extra classes, typically a sizing utility
 * @param options.rotation extra CSS `transform: rotate()` in degrees, for
 *   glyphs that point somewhere (the facing chevron)
 * @param options.title when given, the icon becomes an `img` with an
 *   accessible name; omit it (the default) and the icon is `aria-hidden`,
 *   because every icon here sits beside a real text label
 */
export function icon(name: IconName, options: { className?: string; rotation?: number; title?: string } = {}): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (options.className !== undefined) svg.setAttribute('class', options.className);
  // Sizing and flex behaviour come from `.sm-icon` in controls.css, not from
  // here: an icon that hard-codes its own layout cannot be resized by the theme
  // that owns it, and every caller was about to set the same two properties.
  //
  // The rotation is the one exception, because it is COMPUTED per facing rather
  // than themed — there is no class for "pointing 90° left" that is not four
  // near-identical rules pretending to be data.
  if (options.rotation !== undefined && options.rotation !== 0) {
    svg.style.transform = `rotate(${options.rotation}deg)`;
  }
  if (options.title === undefined) {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  } else {
    svg.setAttribute('role', 'img');
    const titleEl = document.createElementNS(SVG_NS, 'title');
    titleEl.textContent = options.title;
    svg.appendChild(titleEl);
  }
  for (const [tag, attrs] of ICONS[name]) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) child.setAttribute(key, String(value));
    svg.appendChild(child);
  }
  return svg;
}

/** The chevron rotation for an armour facing, or 0 for anything unknown. */
export function facingRotation(facing: string): number {
  return FACING_ROTATION[facing] ?? 0;
}

/**
 * A facing's icon pair: the shield, plus a rotated chevron for the four facings
 * that have a direction. `UNDERBODY` gets the shield alone — pointing a chevron
 * "up" at the underside of a car would be asserting a direction that does not
 * exist, and an icon that lies is worse than one that is merely quiet.
 */
export function facingIcons(facing: string, className: string): SVGElement[] {
  const shield = icon('shield', { className, title: facing });
  if (!facingHasDirection(facing)) return [shield];
  return [icon('chevron', { className: `${className} sm-icon--dir`, rotation: facingRotation(facing) }), shield];
}
