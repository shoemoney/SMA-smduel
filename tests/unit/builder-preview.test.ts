import { beforeEach, describe, expect, it } from 'vitest';

import { createBuilderState } from '@/ui/builder';
import { buildVehiclePreview, buildVehiclePreviewParts } from '@/ui/builder-preview';
import { allBodies, getBody } from '@/data/rulesets';
import { makeArmorRecord } from '@/sim/types';
import type { BuilderState } from '@/ui/builder';

/**
 * The vehicle schematic is the only place the builder shows the player what
 * they are actually making, and every number in it comes from the ruleset.
 *
 * These assert on the DATA the preview carries, not on pixels: the DOM layer
 * runs on a fake document in the sibling builder tests, so asserting a rendered
 * appearance would pass on any possible implementation. Asserting the geometry
 * and the per-facing armour points actually catches a schematic that is
 * decorative rather than truthful.
 */

interface FakeElement {
  tagName: string;
  className: string;
  textContent: string;
  children: FakeElement[];
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild(child: FakeElement): void;
  insertBefore(child: FakeElement, reference: FakeElement | null): void;
}

/** A document double with exactly the two factories the preview uses. */
function fakeDocument(): Document {
  const make = (tag: string): FakeElement => {
    const attributes: Record<string, string> = {};
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      children: [],
      dataset: {},
      attributes,
      setAttribute(name: string, value: string): void {
        attributes[name] = value;
        // A real element REFLECTS the `class` attribute onto `className`. The
        // SVG preview sets its class as an attribute, so without this
        // reflection the classes are invisible to any assertion reading
        // `className` — and a test that silently sees nothing reports "not
        // drawn" for a shape that is drawn correctly.
        if (name === 'class') (this as unknown as { className: string }).className = value;
      },
      getAttribute(name: string): string | null {
        return attributes[name] ?? null;
      },
      appendChild(child: FakeElement): void {
        el.children.push(child);
      },
      insertBefore(child: FakeElement, reference: FakeElement | null): void {
        if (reference === null) {
          el.children.push(child);
          return;
        }
        const at = el.children.indexOf(reference);
        if (at === -1) el.children.push(child);
        else el.children.splice(at, 0, child);
      },
    } as unknown as FakeElement;
    return el;
  };
  return {
    createElement: (tag: string) => make(tag),
    createElementNS: (_ns: string, tag: string) => make(tag),
  } as unknown as Document;
}

function pristineState(): BuilderState {
  return createBuilderState();
}

describe('buildVehiclePreviewParts: the schematic reports real ruleset geometry', () => {
  it('uses the selected body\'s OWN collider dimensions, not an invented box', () => {
    const state = pristineState();
    const body = getBody(state.bodyId);
    const parts = buildVehiclePreviewParts(state);
    expect(parts.data.lengthM).toBe(body.colliderLengthM);
    expect(parts.data.widthM).toBe(body.colliderWidthM);
    // A different body must produce a different silhouette, or the preview is
    // not actually showing the body the player picked.
    const other = allBodies().find((b) => b.id !== body.id);
    expect(other).toBeDefined();
    const otherState: BuilderState = { ...state, bodyId: other!.id };
    const otherParts = buildVehiclePreviewParts(otherState);
    expect(otherParts.data.bodyId).toBe(other!.id);
  });

  it('sums armour across every facing', () => {
    const state: BuilderState = {
      ...pristineState(),
      armor: { ...makeArmorRecord(0), FRONT: 7, REAR: 3, LEFT: 2 },
    };
    expect(buildVehiclePreviewParts(state).data.armorTotal).toBe(12);
  });

  it('counts only MOUNTED weapons, not empty slots', () => {
    const state = pristineState();
    expect(buildVehiclePreviewParts(state).data.weaponCount).toBe(0);
  });

  it('declares the nose direction explicitly, because a top-down schematic with no orientation cue is easy to misread', () => {
    expect(buildVehiclePreviewParts(pristineState()).data.forward).toBe('NOSE');
  });

  it('sizes the canvas in metres with padding, so a longer body gets a taller canvas', () => {
    const state = pristineState();
    const parts = buildVehiclePreviewParts(state);
    expect(parts.heightPx).toBeGreaterThan(parts.widthPx); // cars are longer than they are wide
    expect(parts.widthPx).toBeGreaterThan(0);
  });
});

describe('buildVehiclePreview: the rendered schematic', () => {
  let doc: Document;
  beforeEach(() => {
    doc = fakeDocument();
  });

  function flatten(node: FakeElement, out: FakeElement[] = []): FakeElement[] {
    out.push(node);
    for (const child of node.children) flatten(child, out);
    return out;
  }

  it('marks the zone the selected row is editing, and nothing when the row has no region', () => {
    // The item iteration 14 queued as "constructor row->diagram linking" and
    // seven reviews circled. Selecting "Armor: Front" now lights the front band.
    //
    // The second half is the part that is easy to get wrong: a row with no
    // region on the car — Name, Body, Chassis, Plant, Tyres, Confirm — must
    // highlight NOTHING. An arrow that points at the bonnet because you selected
    // the tyre would teach the player the diagram lies.
    const state: BuilderState = {
      ...pristineState(),
      armor: { ...makeArmorRecord(0), FRONT: 9, LEFT: 4 },
    };

    const front = buildVehiclePreview(doc, state, { facing: 'FRONT' }) as unknown as FakeElement;
    const frontNodes = flatten(front).filter((n) => n.dataset.facing === 'FRONT');
    expect(frontNodes).toHaveLength(1);
    expect(frontNodes[0]!.className).toContain('sm-builder__preview-zone--selected');
    // ...and only that one.
    const otherSelected = flatten(front).filter((n) => n.className.includes('sm-builder__preview-zone--selected'));
    expect(otherSelected).toHaveLength(1);

    const none = buildVehiclePreview(doc, state) as unknown as FakeElement;
    expect(flatten(none).filter((n) => n.className.includes('sm-builder__preview-zone--selected'))).toHaveLength(0);
  });

  it('draws one armour band per non-zero facing, tagged with its points', () => {
    const state: BuilderState = {
      ...pristineState(),
      armor: { ...makeArmorRecord(0), FRONT: 9, LEFT: 4 },
    };
    const root = buildVehiclePreview(doc, state) as unknown as FakeElement;
    const nodes = flatten(root);
    const bands = nodes.filter((n) => (n.className || '').includes('preview-armor') && !n.className.includes('--under'));
    expect(bands.map((b) => b.dataset.facing).sort()).toEqual(['FRONT', 'LEFT']);
    expect(bands.find((b) => b.dataset.facing === 'FRONT')?.dataset.points).toBe('9');
  });

  it('draws underbody armour as a distinct dashed stripe rather than a side band', () => {
    const state: BuilderState = { ...pristineState(), armor: { ...makeArmorRecord(0), UNDERBODY: 5 } };
    const root = buildVehiclePreview(doc, state) as unknown as FakeElement;
    const under = flatten(root).find((n) => n.className.includes('preview-armor--under'));
    expect(under).toBeDefined();
    expect(under?.dataset.facing).toBe('UNDERBODY');
  });

  it('emits a nose marker, so the front of the car is never ambiguous', () => {
    const root = buildVehiclePreview(doc, pristineState()) as unknown as FakeElement;
    expect(flatten(root).some((n) => n.dataset.role === 'nose')).toBe(true);
  });

  it('carries its numbers as data attributes, so a test can assert on truth rather than pixels', () => {
    const state: BuilderState = { ...pristineState(), armor: { ...makeArmorRecord(0), FRONT: 6 } };
    const root = buildVehiclePreview(doc, state) as unknown as FakeElement;
    const svgNode = flatten(root).find((n) => n.tagName === 'SVG');
    expect(svgNode).toBeDefined();
    expect(svgNode?.dataset.armorTotal).toBe('6');
    expect(svgNode?.dataset.forward).toBe('NOSE');
  });

  it('has a text alternative, because a role=img with no label is invisible to a screen reader', () => {
    const state: BuilderState = { ...pristineState(), armor: { ...makeArmorRecord(0), FRONT: 6 } };
    const root = buildVehiclePreview(doc, state) as unknown as FakeElement;
    const label = root.getAttribute('aria-label') ?? '';
    expect(label).toContain('armour points');
    expect(label).toMatch(/\d+(\.\d+)? metres/);
  });
});

// ---------------------------------------------------------------------------
// The schematic's NOSE points the same way the car's does
//
// Nothing before this round asserted WHERE the nose was — only that a marker
// existed and that the armour bands were tagged. A diagram pointing anywhere at
// all passed every test here, which is how the constructor spent 120 iterations
// showing FRONT at the top of a car that drives nose-right.
//
// The rotation is re-derived here from the parts the code publishes, rather than
// read off a screenshot: rotating the drawing frame a quarter turn clockwise
// about its own centre maps an unrotated point (x, y) to (w - y, ...), so a
// shape near the TOP of the unrotated frame lands at the LARGE-x end — the
// right — and that is the side FRONT must be on.
// ---------------------------------------------------------------------------

/** Where an unrotated point ends up on screen, per the group's quarter turn. */
function rotatedX(parts: { widthPx: number; heightPx: number }, y: number): number {
  return parts.widthPx - y;
}

function allNodes(node: FakeElement, out: FakeElement[] = []): FakeElement[] {
  out.push(node);
  for (const child of node.children) allNodes(child, out);
  return out;
}

describe('buildVehiclePreview: the schematic faces the same way the car does', () => {
  let doc: Document;
  beforeEach(() => {
    doc = fakeDocument();
  });

  it('puts the FRONT armour band on the RIGHT and REAR on the LEFT, derived from the rotation', () => {
    const parts = buildVehiclePreviewParts(pristineState());
    const root = buildVehiclePreview(doc, pristineState(), undefined) as unknown as FakeElement;

    const group = allNodes(root).find((n) => n.dataset.role === 'body-frame');
    expect(group?.getAttribute('transform')).toContain('rotate(90');

    const bandFor = (facing: string): FakeElement | undefined =>
      allNodes(root).find((n) => n.dataset.facing === facing);

    const front = bandFor('FRONT');
    const rear = bandFor('REAR');
    expect(front).toBeTruthy();
    expect(rear).toBeTruthy();

    const frontY = Number(front!.getAttribute('y'));
    const rearY = Number(rear!.getAttribute('y'));
    // FRONT is drawn at the TOP of the unrotated frame (small y), which rotates
    // to a LARGE x — the right. Asserting the rotation rather than a literal
    // coordinate is what keeps this from becoming another restatement.
    expect(rotatedX(parts, frontY)).toBeGreaterThan(rotatedX(parts, rearY));
  });

  it('places the viewBox over the rotated content, not the unrotated one', () => {
    const parts = buildVehiclePreviewParts(pristineState());
    // A viewBox is minX minY WIDTH HEIGHT — four numbers.
    const [minX, minY, boxW, boxH] = parts.viewBox.split(' ').map(Number) as [number, number, number, number];
    // The box's LONG axis is the car's LENGTH: the schematic is wider than it is
    // tall now, which is the visible consequence of the nose moving to the right.
    expect(boxW).toBeGreaterThan(boxH);
    // And it starts where the rotated content actually is — a non-zero, negative
    // origin, which is what a non-square rotation forces. An origin of 0 with a
    // rotated transform is the bug this whole change exists to prevent.
    expect(minX).toBeLessThan(0);
    expect(Number.isFinite(minY)).toBe(true);
  });
});
