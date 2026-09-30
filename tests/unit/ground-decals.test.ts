/**
 * Ground stains — the arena decal scatter.
 *
 * Three properties are worth pinning, and one of them is the whole reason this
 * is decals rather than a second ground texture.
 *
 * 1. WORLD-ANCHORED. The scatter is hashed from integer world cells, so a stain
 *    sits at the same spot on every frame and every visit. The failure this
 *    guards is iteration 21's: a player-centred arena ring travelled with the
 *    car, which destroys the only thing a ground marking is for. A stain that
 *    swims under you is noise, and a stain that re-randomises between visits
 *    means the arena has no memory of having been driven in.
 * 2. NOT A TILE. Placed content, so it does not repeat. `src/render/ground.ts`
 *    measured the alternative — a per-cell grid of different ground textures
 *    meeting at hard edges — as a "visible grid of seams", measurably worse than
 *    the repetition it was meant to fix. A decal has to stay irregular for the
 *    same reason, which is why a fraction of cells are left empty rather than
 *    every cell drawing one.
 * 3. BOUNDED by the visible window, not by arena size. Same capacity reasoning
 *    as the guardrails: an unbounded count in an unbounded world is a capacity
 *    bug waiting for a long drive.
 *
 * And the frames must actually exist, which is the check that would have caught
 * the real defect this work uncovered: `decal-oil-slick`, `decal-tire-marks` and
 * `decal-scorch` were packed into the shipping atlas and referenced by nothing.
 * The art was never missing. The wiring was.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { groundDecalInstances } from '@/app';
import { cityGroundDecalCount, cityGroundDecalInstances, CITY_DECAL_CELL_M, DECAL_CELL_M } from '@/ui/city-view';
import { generateCityLayout } from '@/sim/city';
import { citiesConfig } from '@/data/rulesets';

// Each frame gets a DISTINCT atlasIndex so a test can prove all three stain
// kinds are actually reachable — a single shared id would let a kind that is
// never drawn pass unnoticed, which is precisely the defect this file exists to
// guard (three frames packed into the atlas, referenced by nothing).
const FRAME_IDS: Record<string, number> = {
  'decal-oil-slick': 101,
  'decal-tire-marks': 102,
  'decal-scorch': 103,
};
const NAME_OF_ID: Record<number, string> = Object.fromEntries(
  Object.entries(FRAME_IDS).map(([name, id]) => [id, name]),
);

const atlasIndex = {
  frame: (name: string) => ({ atlasIndex: FRAME_IDS[name] ?? 999, uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, name }),
} as never;

/**
 * A world point, in the FLAT shape `groundDecalInstances` actually takes. The
 * road-furniture helper wraps its argument as `{ position: { x, y } }` because
 * that is what the road builder wants; copying it here produced a fixture whose
 * `centre.x` was undefined, so every cell index was NaN and the scatter
 * correctly returned nothing. Same shape as iteration 25's NaN bar fixture: the
 * guard worked, the fixture was wrong.
 */
function at(x: number, y: number) {
  return { x, y } as never;
}

/** Position rounded to a key that ignores hash-salted order differences. */
function key(i: { position: { x: number; y: number } }) {
  return `${i.position.x.toFixed(4)},${i.position.y.toFixed(4)}`;
}

const HALF = 40;

describe('ground stains', () => {
  it('draws oil, tyre marks and scorch from frames that are really in the atlas', () => {
    const atlas = JSON.parse(readFileSync('assets/atlas.json', 'utf8')) as {
      frames: Record<string, unknown>;
    };
    for (const frame of Object.keys(FRAME_IDS)) {
      expect(atlas.frames[frame], `${frame} is not packed in the atlas`).toBeTruthy();
    }
    // Walk a wide grid of cells and collect which frame each stain used. All
    // three kinds must appear: a kind that never draws is dead art shipping in
    // the atlas, which is the exact state this work found the art in.
    const used = new Set<string>();
    for (let cx = -6; cx <= 6; cx += 1) {
      for (let cy = -6; cy <= 6; cy += 1) {
        for (const i of groundDecalInstances(atlasIndex, at(cx * 16 + 8, cy * 16 + 8), 9)) {
          used.add(NAME_OF_ID[Number((i as unknown as { atlasId: string }).atlasId)] ?? 'unknown');
        }
      }
    }
    expect([...used].sort()).toEqual(['decal-oil-slick', 'decal-scorch', 'decal-tire-marks']);
  });

  it('anchors stains to the world, so they do not travel with the car', () => {
    // Two windows that overlap heavily, asked from different car positions.
    const a = groundDecalInstances(atlasIndex, at(0, 0), HALF);
    const b = groundDecalInstances(atlasIndex, at(6, 0), HALF);

    // Every stain of A inside the region B also covers must be at the SAME
    // world position in B — that is the whole property. A car-relative scatter
    // shifts by exactly the car delta and fails here.
    const bKeys = new Set(b.map(key));
    const shared = a.filter((i) => Math.abs(i.position.x) <= HALF - 6);
    expect(shared.length).toBeGreaterThan(0);
    for (const i of shared) {
      expect(bKeys.has(key(i)), `stain at ${key(i)} moved when the car did`).toBe(true);
    }
  });

  it('is deterministic — the same query returns the same stains', () => {
    const a = groundDecalInstances(atlasIndex, at(13, -7), HALF).map(key);
    const b = groundDecalInstances(atlasIndex, at(13, -7), HALF).map(key);
    expect(a).toEqual(b);
  });

  it('leaves most cells empty, so it never reads as a grid', () => {
    // 81 candidate cells at the default spacing; a scatter that filled them all
    // would be tiling wearing a hash as a disguise.
    const drawn = groundDecalInstances(atlasIndex, at(0, 0), 80);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(81 * 0.8);
  });

  it('bounds the count by the visible window rather than growing with the world', () => {
    const small = groundDecalInstances(atlasIndex, at(0, 0), 40).length;
    const large = groundDecalInstances(atlasIndex, at(0, 0), 400).length;
    expect(small).toBeLessThan(large);
    // Window area grows 100x; the scatter is per-CELL so it grows ~100x too,
    // but a 400m half-extent is 1600m across and must still fit the 2048-slot
    // ground buffer with the ground quad and everything else in it.
    expect(large).toBeLessThan(2048);
  });

  it('keeps every stain flat on the ground and inside its own cell', () => {
    for (const i of groundDecalInstances(atlasIndex, at(37, 21), HALF)) {
      expect(i.layer).toBe(0);
      // Offset is capped at 0.35 of a cell each way from the cell centre, so a
      // stain never straddles a boundary and reads as a seam between neighbours.
      const cx = (Math.floor(i.position.x / 16) + 0.5) * 16;
      const cy = (Math.floor(i.position.y / 16) + 0.5) * 16;
      expect(Math.abs(i.position.x - cx)).toBeLessThan(16 * 0.35);
      expect(Math.abs(i.position.y - cy)).toBeLessThan(16 * 0.35);
    }
  });
});

/**
 * The city scatter, and the guard for a failure mode this round actually
 * shipped once.
 *
 * `DECAL_CELL_M = 16` is sized for an UNBOUNDED arena. The city is a fixed
 * ~21m-radius circle, so at the arena's cell size the whole city is barely
 * three cells across, only four cells fall inside the wall, and a 45% gate on
 * four cells averages under two stains. The first version of this did exactly
 * that: it rendered, it built, every test passed, and the city's measured
 * ground spread moved 65.99 -> 66.00 — a change small enough to read as noise
 * on any dashboard, which is why it was caught by noticing the number rather
 * than by any gate.
 *
 * So the contract pinned here is not "the city has decals" — it is that the
 * city has ENOUGH of them to change the surface. A count floor is the only
 * check that would have failed.
 */
describe('city ground stains', () => {
  // The REAL city ids and a real session seed. An earlier draft of this file
  // passed a function where `saveSeed: string` is expected, which silently
  // produced a degenerate 1-doorway layout rather than a city.
  const ids = citiesConfig().cities.map((c) => c.id);
  const layout = generateCityLayout('newyork', 'a11ce5ee');
  // Every city in the ruleset must place stains, not just the largest one —
  // radius scales with facility count from 6.0m to 10.65m, so the smallest
  // city is the one that runs out of cells first.
  const smallest = ids.reduce((a, b) =>
    generateCityLayout(a, 'a11ce5ee').boundsRadiusM <= generateCityLayout(b, 'a11ce5ee').boundsRadiusM ? a : b,
  );

  it('uses a finer cell than the arena, sized for the SMALLEST city', () => {
    expect(CITY_DECAL_CELL_M).toBeLessThan(DECAL_CELL_M);
    // The binding case is the smallest city, not the largest: at the arena's
    // 16m cell, atlanticcity's 6.0m radius is less than ONE cell across. The
    // threshold is cells-across-the-smallest-city, because that is the case
    // that runs out of positions first.
    const small = generateCityLayout(smallest, 'a11ce5ee');
    expect((small.boundsRadiusM * 2) / CITY_DECAL_CELL_M).toBeGreaterThanOrEqual(4);
  });

  it('places enough stains to actually change the plaza surface', () => {
    const count = cityGroundDecalCount(layout);
    // A floor, not an equality. The failure this guards produced ZERO stains in
    // a 6m-radius city while every other check stayed green, so the assertion
    // has to be one that a too-fine grid cannot accidentally pass.
    expect(count).toBeGreaterThanOrEqual(3);
    expect(cityGroundDecalInstances(layout, atlasIndex)).toHaveLength(count);
  });

  it('places stains in the SMALLEST city too, not just New York', () => {
    // 6.0m radius vs New York's 10.65m. The small city is 12m across, so this
    // is the case that runs out of cells — and the case a max-size assumption
    // would have hidden.
    const smallLayout = generateCityLayout(smallest, 'a11ce5ee');
    expect(smallLayout.boundsRadiusM).toBeLessThan(layout.boundsRadiusM);
    expect(cityGroundDecalCount(smallLayout)).toBeGreaterThanOrEqual(3);
  });

  it('scales stain size to the city, so a slick is not bigger than a building', () => {
    // layout.tileSizeM is the building footprint (3m). An oil slick scaled at
    // the arena's 4.2m would be larger than the garage it sits beside.
    for (const i of cityGroundDecalInstances(layout, atlasIndex)) {
      expect(i.sizeM.y).toBeLessThan(layout.tileSizeM);
    }
  });

  it('keeps every stain inside the wall, so none is half-drawn on the ring', () => {
    for (const i of cityGroundDecalInstances(layout, atlasIndex)) {
      const d = Math.hypot(i.position.x, i.position.y);
      expect(d).toBeLessThan(layout.boundsRadiusM);
      expect(i.layer).toBe(0);
    }
  });

  it('is deterministic per city, so the same city always looks the same', () => {
    const a = cityGroundDecalInstances(generateCityLayout('newyork', 'a11ce5ee'), atlasIndex).map((i) => i.position.x.toFixed(3) + ',' + i.position.y.toFixed(3));
    const b = cityGroundDecalInstances(generateCityLayout('newyork', 'a11ce5ee'), atlasIndex).map((i) => i.position.x.toFixed(3) + ',' + i.position.y.toFixed(3));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(3);
  });
});
