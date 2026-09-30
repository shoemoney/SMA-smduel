/**
 * Roadside furniture — the guardrail lattice on both verges.
 *
 * Two properties are worth pinning, and neither is "how many instances": that
 * number legitimately varies with the visible extent. The two that matter are
 * that the lattice is anchored to the WORLD (so the rhythm reads as ground
 * moving past a stationary car, which is the entire point of the feature — a
 * lattice that travelled with the car would say nothing about speed), and that
 * the count is BOUNDED by the visible window rather than by trip length (this
 * is an unbounded world, so an unbounded instance count is a capacity bug
 * waiting for a long drive; the city buffer blanking the whole screen in
 * iteration 19 is what that failure costs).
 */
import { describe, expect, it } from 'vitest';
import { roadFurnitureInstances, roadLaneInstances, roadLateralOffsetM, roadRecoveryDirectionDeg } from '@/app';

/**
 * The real `prop-delineator` frame's packed dimensions, 42x67 (the post plus its
 * shadow). The double carries them because `roadFurnitureInstances` now derives
 * the along-road extent from the art's own aspect — reading it from the atlas
 * entry rather than from a hand-copied literal, which is the point of the
 * change. A double that omitted them made the sizing NaN, which is the
 * fixture-lying shape this log has hit eleven times.
 */
const FRAME_W = 42;
const FRAME_H = 67;

const atlasIndex = {
  frame: (name: string) => ({
    atlasIndex: 0,
    uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
    name,
    pixelWidth: FRAME_W,
    pixelHeight: FRAME_H,
  }),
} as never;

const HEADING = 0; // route runs along +X, so lateral offsets are pure Y
const HALF = 33;

function at(x: number) {
  return { position: { x, y: 0 } } as never;
}

describe('roadside guardrail furniture', () => {
  it('lays a rail on both verges, clear of the painted road', () => {
    const rails = roadFurnitureInstances(atlasIndex, at(0), HEADING, HALF);
    expect(rails.length).toBeGreaterThan(4);
    const laterals = new Set(rails.map((r) => Math.round(r.position.y)));
    // Two distinct verges, symmetric about the centreline...
    expect(laterals.size).toBe(2);
    const [a, b] = [...laterals].map(Math.abs).sort((p, q) => p - q);
    expect(a).toBe(b);
    // ...and both OUTSIDE the white edge lines, which sit at +/-4.2m. A rail
    // inside the paint would read as more lane marking, which is the one thing
    // the dash lattice already is.
    expect(a).toBeGreaterThan(4.2);
  });

  it('is anchored to the world, not to the car', () => {
    const period = 7;
    // The property is that every rail sits on an ABSOLUTE multiple of the
    // period, wherever the car happens to be. A car-anchored lattice would
    // instead place them relative to the car, and would slide or re-randomise
    // as it moved — which would destroy the only thing the feature is for.
    for (const carX of [0, period, 123.5, 50_000]) {
      const rails = roadFurnitureInstances(atlasIndex, at(carX), HEADING, HALF);
      expect(rails.length).toBeGreaterThan(0);
      for (const rail of rails) {
        // Guard against float drift on the modulo, which is what a
        // `Math.round(x) % period` assertion would trip over.
        const offsetFromPeriod = Math.abs(rail.position.x / period - Math.round(rail.position.x / period));
        expect(offsetFromPeriod).toBeLessThan(1e-9);
      }
    }
    // Only the visible stretch is built, so a car a very long way down the
    // route gets the same COUNT — this is an unbounded world.
    const near = roadFurnitureInstances(atlasIndex, at(0), HEADING, HALF);
    const far = roadFurnitureInstances(atlasIndex, at(50_000), HEADING, HALF);
    expect(far.length).toBe(near.length);
  });

  it('keeps the furniture sized to the art rather than stretched to the period', () => {
    // The along-road extent is derived from the art's own aspect (read from the
    // atlas), and this pins the PROPERTY rather than a literal: the ratio must
    // equal the frame's aspect exactly, and must NOT equal the 7m period.
    //
    // The first version of this test asserted `ratio` was between 4 and 5, which
    // was the guardrail's 96x21 aspect. When the art changed to a 42x67 post it
    // failed — correctly, because the number it named was no longer true — and
    // the tempting fix was to widen the range. Asserting against the frame
    // instead means the next art regeneration updates the expectation on its
    // own, and the "not stretched to the period" half still has teeth.
    const rails = roadFurnitureInstances(atlasIndex, at(0), HEADING, HALF);
    const ratio = rails[0]!.sizeM.y / rails[0]!.sizeM.x;
    expect(ratio).toBeCloseTo(FRAME_H / FRAME_W, 6);
    // 7m of period is what "stretched to the period" would look like.
    expect(ratio).not.toBeCloseTo(7, 1);
  });
});

/**
 * The orientation guard, added two iterations after the feature shipped
 * quarter-turned.
 *
 * The rails were laid ACROSS the carriageway instead of along it for
 * iterations 80 and 81 — a row of vertical combs on a horizontal highway, in
 * this repo's own road captures (`.shots/iter85/road.png`) the whole
 * time — a `*` followed by `/` inside a block comment closes the comment,
 * which is its own small lesson and cost one rebuild. The code carried a comment
 * arguing FOR the bug ("the route heading alone points it ALONG the road, so no
 * extra quarter turn here"), which is why reading the code confirmed it.
 *
 * The invariant worth pinning is not a number, it is a RELATIONSHIP: the guardrail
 * and the lane paint are both laid lengthwise down the road, so they must take
 * the same rotation. Asserting against the lanes rather than against a literal
 * quarter turn is what makes this a real guard — a future change to the shared
 * orientation moves both together, and a change to only one still fails.
 *
 * Found by Codex `gpt-6.1-sol` driving the live road with computer use.
 */
describe('roadside furniture is laid ALONG the carriageway, like the lane paint', () => {
  it('shares its rotation with the lane markings, and carries the long axis in sizeM.y', () => {
    const heading = 0.7; // deliberately not axis-aligned, so a hard-coded
                          // "0" or "PI/2" cannot satisfy this
    const rails = roadFurnitureInstances(atlasIndex, at(0), heading, HALF);
    const dashes = roadLaneInstances(atlasIndex, at(0), heading, HALF);

    expect(rails.length).toBeGreaterThan(0);
    expect(dashes.length).toBeGreaterThan(0);
    for (const rail of rails) {
      const matchingDash = dashes.find((d: { rotationRad: number }) => d.rotationRad === rail.rotationRad);
      expect(
        matchingDash,
        `rail rotated to ${rail.rotationRad} but no lane marking shares that angle`,
      ).toBeDefined();
    }

    // And the shape follows the rotation: the world size is long in y, which is
    // the local axis a quarter turn maps onto the route's forward vector.
    for (const rail of rails) {
      expect(rail.sizeM.y).toBeGreaterThan(rail.sizeM.x);
    }
  });
});

describe('off-road recovery indicator geometry', () => {
  const SHOULDER_EDGE_M = 4.2 + 2.4; // ROAD_LANE_HALF_WIDTH_M + ROAD_SHOULDER_M

  it('measures the lateral offset on the trip axis, positive on one fixed side', () => {
    // heading 0: forward is +x, so `across` is +y and a car at +y is positive.
    expect(roadLateralOffsetM(0, { x: 0, y: 12 })).toBeCloseTo(12, 6);
    expect(roadLateralOffsetM(0, { x: 0, y: -12 })).toBeCloseTo(-12, 6);
    // heading pi/2: forward is +y, so `across` is -x and the sign flips.
    expect(roadLateralOffsetM(Math.PI / 2, { x: 12, y: 0 })).toBeCloseTo(-12, 6);
  });

  it('ignores distance ALONG the road — that is what progress measures', () => {
    // 500m up the carriageway is not off-road; only the perpendicular
    // component may trigger the indicator. Confusing the two would light it up
    // on every straight drive.
    expect(roadLateralOffsetM(0, { x: 500, y: 0 })).toBeCloseTo(0, 6);
  });

  it('points the arrow at the ROAD ON SCREEN, not at a fixed left/right', () => {
    // THE REGRESSION THIS EXISTS FOR. `roadRecoveryArrow()` returned `◀`/`▶`
    // from the lateral offset's SIGN, on the stated reasoning that the
    // world-space `across` axis "cannot disagree with where the road actually
    // is". It could and did: nothing ever projected it to screen, so the arrow
    // was only right for an east-west road with the car beside it. Codex drove
    // the build and got `◀` with the road plainly BELOW the car.
    //
    // The expectation is therefore derived from the screen projection rather
    // than asserted as a glyph, so this test fails if the projection is
    // removed rather than merely failing if a character changes.
    //
    // Reviewer's captured state: heading 0 (east-west road), car north of it.
    // World +y is screen-up (buildOrthoMatrix sets m[5] positive and WebGPU
    // puts clip +y at the top), so north-of-the-road is ABOVE on screen and
    // the road is DOWN: the arrow must point down, i.e. 180deg.
    expect(roadRecoveryDirectionDeg(+8, 0)).toBeCloseTo(180, 6);
    expect(roadRecoveryDirectionDeg(-8, 0)).toBeCloseTo(0, 6);

    // Rotate the road a quarter turn and the answer must rotate with it. The
    // old sign-only function returned `◀` for BOTH of these.
    // At heading 90deg the carriageway runs north-south, so `across` is -x: a
    // positive lateral offset puts the car at world -x and the road to its
    // +x, which is screen RIGHT.
    expect(roadRecoveryDirectionDeg(+8, Math.PI / 2)).toBeCloseTo(90, 6);
    expect(roadRecoveryDirectionDeg(-8, Math.PI / 2)).toBeCloseTo(270, 6);
    expect(roadRecoveryDirectionDeg(+8, Math.PI)).toBeCloseTo(0, 6);
    expect(roadRecoveryDirectionDeg(-8, Math.PI)).toBeCloseTo(180, 6);
  });

  it('agrees with the independently projected direction to the road', () => {
    // The strongest form of the property: compute where the road actually is
    // on screen from the vehicle's real world position, and check the arrow
    // points that way. Nothing here knows about `across`, signs or glyphs, so
    // this is a real cross-check rather than a restatement.
    for (const heading of [0, Math.PI / 4, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      for (const offset of [+30, -30]) {
        const lateralOffsetM = roadLateralOffsetM(heading, { x: 0, y: offset });
        const car = {
          x: Math.cos(heading) * 20 - Math.sin(heading) * lateralOffsetM,
          y: Math.sin(heading) * 20 + Math.cos(heading) * lateralOffsetM,
        };
        // Nearest point on the carriageway: the car's projection onto the route
        // axis through the origin.
        const along = car.x * Math.cos(heading) + car.y * Math.sin(heading);
        const roadPoint = { x: along * Math.cos(heading), y: along * Math.sin(heading) };
        // World +y is screen-up, so in CSS coordinates (y down) the screen
        // vector from car to road is (dx, -dy).
        const sx = roadPoint.x - car.x;
        const sy = -(roadPoint.y - car.y);
        const expectedDeg = (Math.atan2(sx, -sy) * 180) / Math.PI;
        const actualDeg = roadRecoveryDirectionDeg(lateralOffsetM, heading);
        // Compared as a CIRCULAR difference, not a subtraction: the function
        // normalises to [0,360) and `atan2` returns (-180,180], so a leftward
        // answer is legitimately 270 on one side and -90 on the other. What
        // matters is whether they name the same screen direction, and a plain
        // subtraction would report a 360-degree disagreement for a perfect
        // match — a test that fails on representation rather than on meaning.
        const off = Math.abs((((actualDeg - expectedDeg) % 360) + 540) % 360 - 180);
        expect(
          off,
          `heading ${((heading * 180) / Math.PI).toFixed(0)}deg, offset ${offset}: arrow points ${actualDeg.toFixed(0)}deg but the road is at ${expectedDeg.toFixed(0)}deg on screen`,
        ).toBeLessThan(1e-6);
      }
    }
  });

  it('has a threshold a driver on the carriageway never crosses', () => {
    // Tracking the centreline crosses the painted edge constantly, so the
    // indicator must wait until the SHOULDER is behind the player.
    expect(SHOULDER_EDGE_M).toBeGreaterThan(4.2);
    expect(Math.abs(roadLateralOffsetM(0, { x: 0, y: SHOULDER_EDGE_M * 0.5 }))).toBeLessThan(SHOULDER_EDGE_M);
  });
});
