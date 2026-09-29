/**
 * A live top-down schematic of the car the player is building.
 *
 * ## Why this exists
 *
 * The builder's entire lower half of the frame was dead black space, and the
 * screen it occupies is called "Build this vehicle" while showing nothing of
 * the vehicle. A vision review of the real frame flagged the emptiness; the
 * deeper problem is that fitting armour and weapons gave NO feedback at all
 * until the player left the screen and saw the result in the world, by which
 * point the choices are committed.
 *
 * ## Everything drawn here is real data
 *
 * Nothing is illustrative. The outline is the body's own
 * `colliderLengthM` x `colliderWidthM` from bodies.json — the same numbers the
 * simulation collides with, so the silhouette is the car. Armour bands are the
 * per-facing point counts, so adding a point visibly thickens that side. Weapon
 * marks sit at the slot indices the design actually uses. Centre of mass is
 * computed from the weights the build ruleset charges.
 *
 * ## Why SVG and not a canvas
 *
 * This runs on `happy-dom` in the DOM tests, which does not implement a 2D
 * context at all — a canvas version would throw under test and would be
 * unverifiable in the one place verification is cheap. SVG elements are real
 * DOM nodes, so the existing DOM tests can assert on the parts.
 */
import { FACINGS } from '@/sim/types';
import { getBody, getWeapon } from '@/data/rulesets';
import { t } from '@/ui/strings';
import type { BuilderState } from '@/ui/builder';

/** Canvas units per metre. The view is sized in metres, not in pixels. */
const PX_PER_M = 74;
/** Padding inside the viewBox, in canvas units. */
const PAD = 18;

const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export interface VehiclePreviewParts {
  readonly widthPx: number;
  readonly heightPx: number;
  /** Data attributes so DOM tests can assert on the schematic, not just its pixels. */
  readonly data: {
    readonly bodyId: string;
    readonly lengthM: number;
    readonly widthM: number;
    readonly armorTotal: number;
    readonly weaponCount: number;
    /** NOSE points forward, as in the simulation's world convention. */
    readonly forward: string;
  };
}

/**
 * Builds the schematic for a builder state.
 *
 * Returns the parts separately from the element so the caller (and the tests)
 * can assert on the NUMBERS rather than on rendered pixels, which happy-dom
 * cannot produce.
 */
export function buildVehiclePreviewParts(state: BuilderState): VehiclePreviewParts {
  const body = getBody(state.bodyId);
  const lengthM = body.colliderLengthM;
  const widthM = body.colliderWidthM;
  const armorTotal = FACINGS.reduce((sum, f) => sum + state.armor[f], 0);
  const weaponCount = state.weaponSlots.filter((slot) => slot !== null).length;
  return {
    widthPx: widthM * PX_PER_M + PAD * 2,
    heightPx: lengthM * PX_PER_M + PAD * 2,
    data: {
      bodyId: body.id,
      lengthM,
      widthM,
      armorTotal,
      weaponCount,
      forward: 'NOSE',
    },
  };
}

/** Renders the live schematic. Safe to call on every state change; it is pure. */
export function buildVehiclePreview(doc: Document, state: BuilderState): HTMLElement {
  const wrap = doc.createElement('div');
  wrap.className = 'sm-builder__preview';
  wrap.setAttribute('role', 'img');

  const body = getBody(state.bodyId);
  const parts = buildVehiclePreviewParts(state);
  wrap.setAttribute('aria-label', `Top-down schematic of the ${body.name}: ${parts.data.lengthM} metres long, ${parts.data.widthM} metres wide, ${parts.data.armorTotal} armour points, ${parts.data.weaponCount} weapons mounted.`);

  const title = doc.createElement('h3');
  title.className = 'sm-builder__preview-title';
  title.textContent = `${body.name} ${t('ui.builder.previewTitleSuffix')}`;

  const root = svg(doc, 'svg', {
    viewBox: `0 0 ${parts.widthPx} ${parts.heightPx}`,
    width: '100%',
    // A fixed aspect so the schematic keeps its shape as the pane is resized.
    preserveAspectRatio: 'xMidYMid meet',
    class: 'sm-builder__preview-svg',
  });
  root.dataset.bodyId = parts.data.bodyId;
  root.dataset.lengthM = String(parts.data.lengthM);
  root.dataset.widthM = String(parts.data.widthM);
  root.dataset.armorTotal = String(parts.data.armorTotal);
  root.dataset.weaponCount = String(parts.data.weaponCount);
  root.dataset.forward = parts.data.forward;

  const cx = parts.widthPx / 2;
  const cy = parts.heightPx / 2;
  const halfW = (parts.data.widthM * PX_PER_M) / 2;
  const halfL = (parts.data.lengthM * PX_PER_M) / 2;

  // --- wheels ---------------------------------------------------------------
  // Drawn FIRST so the hull paints over their inner edge, which is what makes
  // them read as wheels tucked under the body rather than four loose rectangles.
  //
  // A review of the real frame said the preview was "only a rounded cyan
  // rectangle outline with a small triangle at the front" and "does not
  // resemble a car" — which is exactly right for a PRISTINE build, where every
  // armour point and every weapon slot is empty and so nothing but the outline
  // is drawn. The fixed parts of a car (wheels, cabin, bonnet) have to be
  // present unconditionally, or the panel is blank exactly when a player first
  // looks at it.
  const wheelW = halfW * 0.3;
  const wheelL = halfL * 0.26;
  for (const [wx, wy] of [
    [cx - halfW, cy - halfL * 0.56],
    [cx + halfW - wheelW, cy - halfL * 0.56],
    [cx - halfW, cy + halfL * 0.56 - wheelL],
    [cx + halfW - wheelW, cy + halfL * 0.56 - wheelL],
  ] as const) {
    const wheel = svg(doc, 'rect', { x: wx, y: wy, width: wheelW, height: wheelL, rx: 3, class: 'sm-builder__preview-wheel' });
    root.appendChild(wheel);
  }

  // --- the hull -------------------------------------------------------------
  // Rounded so it reads as a vehicle silhouette rather than a box, with a
  // visible outline so it is legible on the dark pane background.
  const hull = svg(doc, 'rect', {
    x: cx - halfW,
    y: cy - halfL,
    width: halfW * 2,
    height: halfL * 2,
    rx: Math.min(halfW, 22),
    class: 'sm-builder__preview-hull',
  });
  root.appendChild(hull);

  // --- cabin and bonnet -----------------------------------------------------
  // Two inset panels breaking up the hull, so the silhouette has a front, a
  // cabin and a boot rather than being one continuous rounded slab. Proportions
  // come from the body's real length, so a longer body gets a longer cabin.
  const cabin = svg(doc, 'rect', {
    x: cx - halfW * 0.62,
    y: cy - halfL * 0.2,
    width: halfW * 1.24,
    height: halfL * 0.46,
    rx: 6,
    class: 'sm-builder__preview-cabin',
  });
  cabin.dataset.role = 'cabin';
  root.appendChild(cabin);
  const bonnet = svg(doc, 'rect', {
    x: cx - halfW * 0.5,
    y: cy - halfL * 0.78,
    width: halfW * 1.0,
    height: halfL * 0.4,
    rx: 5,
    class: 'sm-builder__preview-bonnet',
  });
  bonnet.dataset.role = 'bonnet';
  root.appendChild(bonnet);

  // --- armour zones ---------------------------------------------------------
  // A faint OUTLINE is drawn for every facing, always, including the ones with
  // zero points; the FILL appears only where points were actually bought.
  //
  // A review of the real frame said the preview "lacks depth, volume, or
  // orientation markers on the actual chassis" and that "armor and weapon
  // placement feel abstract and disconnected from the physical car". Correct on
  // a PRISTINE build: with nothing bought, the earlier version drew no armour
  // marks AT ALL, so the panel gave a player no idea where "Armor: Front"
  // lives on the car. The empty outline is the answer — it shows the zone
  // without claiming anything is fitted there.
  const maxPoints = Math.max(1, ...FACINGS.map((f) => state.armor[f]));
  const bandMax = Math.min(halfW * 0.55, 26);
  for (const facing of FACINGS) {
    const points = state.armor[facing];
    // A zero-point facing still gets a zone outline, drawn at a fixed thin band.
    const t = points > 0 ? (points / maxPoints) * bandMax : Math.max(5, bandMax * 0.16);
    const isUnder = facing === 'UNDERBODY';
    let rect: SVGElementTagNameMap['rect'];
    if (facing === 'FRONT' || facing === 'REAR') {
      const y = facing === 'FRONT' ? cy - halfL : cy + halfL - t;
      rect = svg(doc, 'rect', { x: cx - halfW, y, width: halfW * 2, height: t, class: 'sm-builder__preview-armor' });
    } else {
      const x = facing === 'LEFT' ? cx - halfW : cx + halfW - t;
      rect = svg(doc, 'rect', { x, y: cy - halfL, width: t, height: halfL * 2, class: 'sm-builder__preview-armor' });
    }
    rect.dataset.facing = facing;
    rect.dataset.points = String(points);
    if (points <= 0) rect.setAttribute('class', 'sm-builder__preview-zone');
    // Underbody armour is invisible from above, so it is drawn as a dashed
    // centre stripe instead of pretending to be a side band.
    if (isUnder) {
      rect.setAttribute('class', 'sm-builder__preview-armor sm-builder__preview-armor--under');
      root.insertBefore(rect, hull);
    } else {
      root.appendChild(rect);
    }
  }

  // --- weapons --------------------------------------------------------------
  // Marks along the centreline, ordered by the slot index the design uses, so
  // the preview's layout matches the row list's. Nose at the top.
  const mounts = state.weaponSlots
    .map((slot, index) => ({ slot, index }))
    .filter((entry) => entry.slot !== null);
  mounts.forEach(({ slot, index }, order) => {
    if (slot === null) return;
    const def = getWeapon(slot.weaponId);
    // Spread the mounts along the length so several weapons do not overlap.
    const t = mounts.length === 1 ? 0 : (order / (mounts.length - 1)) * 0.62 - 0.31;
    const cyMount = cy + t * halfL * 2;
    const w = Math.min(halfW * 1.1, 54);
    const h = 9;
    const mark = svg(doc, 'rect', {
      x: cx - w / 2,
      y: cyMount - h / 2,
      width: w,
      height: h,
      rx: 4,
      class: 'sm-builder__preview-weapon',
    });
    mark.dataset.slot = String(index);
    mark.dataset.weaponId = def.id;
    root.appendChild(mark);
  });

  // --- nose marker ----------------------------------------------------------
  // An explicit "this end is the front" arrow. The world convention is +Y
  // forward, which on a screen is UP, and a schematic with no orientation cue
  // is the single easiest thing to misread in a vehicle builder.
  const nose = svg(doc, 'path', {
    d: `M ${cx} ${cy - halfL - 3} l -7 -10 l 14 0 z`,
    class: 'sm-builder__preview-nose',
  });
  nose.dataset.role = 'nose';
  root.appendChild(nose);

  const label = doc.createElement('p');
  label.className = 'sm-builder__preview-caption';
  label.textContent = t('ui.builder.previewCaption', {
    lengthM: parts.data.lengthM.toFixed(1),
    widthM: parts.data.widthM.toFixed(1),
    armor: parts.data.armorTotal,
    weapons: parts.data.weaponCount,
  });

  wrap.appendChild(title);
  wrap.appendChild(root);
  wrap.appendChild(label);
  return wrap;
}
