// @vitest-environment happy-dom
/**
 * The road's input frame.
 *
 * `src/sim/driving.ts` steers the nose to FACE the stick
 * (`desiredHeadingRad = atan2(dir.y, dir.x)`) — a deliberate
 * direction-and-throttle model that is correct in an open arena. The road is a
 * corridor with a fixed axis, so handing that model a world-space stick made
 * `W` mean "point north": holding forward turned the car ninety degrees and
 * walked it off an east–west highway while still accelerating.
 *
 * These are the properties the fix has to hold, stated as values rather than
 * prose: full throttle holds the road's axis, steering is an offset FROM that
 * axis rather than an absolute world direction, and the magnitude (which the
 * driving model reads as throttle and reverse) survives the rotation.
 */
import { describe, expect, it } from 'vitest';

import { roadStick } from '@/app';

const DEG = Math.PI / 180;
/** The heading of a stick, in degrees, measured the way the driving model reads it. */
function headingDeg(stick: { x: number; y: number }): number {
  return (Math.atan2(stick.y, stick.x) * 180) / Math.PI;
}

describe('roadStick — the stick is expressed in the road frame', () => {
  it('full throttle holds the road axis instead of pointing north', () => {
    // THE BUG. On a road running east (heading 0), W used to yield a stick of
    // (0, 1) -> heading 90deg, and the car turned off the carriageway.
    const stick = roadStick(0, 0, 1);
    expect(headingDeg(stick)).toBeCloseTo(0, 6);
  });

  it('holds the axis for ANY road orientation, not just due east', () => {
    // A fix that only works for heading 0 is a fix for one screenshot.
    for (const roadDeg of [0, 37, 90, 143, -118, 180, -90]) {
      const stick = roadStick(roadDeg * DEG, 0, 1);
      expect(headingDeg(stick)).toBeCloseTo(roadDeg, 6);
    }
  });

  it('steers to the RIGHT of the road axis on D, and to the left on A', () => {
    const road = 0;
    const right = roadStick(road, 1, 1); // W+D
    const left = roadStick(road, -1, 1); // W+A
    expect(headingDeg(right)).toBeCloseTo(45, 6);
    expect(headingDeg(left)).toBeCloseTo(-45, 6);
    // Crucially these are offsets FROM the road, so on a north-running road
    // "right" is still north-east rather than snapping back to world east.
    const nRight = roadStick(90 * DEG, 1, 1);
    expect(headingDeg(nRight)).toBeCloseTo(135, 6);
  });

  it('asks for the axis REVERSED on S, which the driving model reads as reverse', () => {
    // `wantsOpposite` is `dot(stickDir, forward) < reverseInputDotThreshold`.
    // With the stick pointing back along the road and the car pointing forward
    // along it, that dot is -1 — comfortably opposite.
    const stick = roadStick(0, 0, -1);
    expect(headingDeg(stick)).toBeCloseTo(180, 6);
    const dot = (stick.x * Math.cos(0) + stick.y * Math.sin(0)) / Math.hypot(stick.x, stick.y);
    expect(dot).toBeCloseTo(-1, 6);
  });

  it('preserves stick MAGNITUDE, because the driving model reads it as throttle', () => {
    // Rotating a stick must not change how hard the throttle is: a half-press
    // that arrives at full throttle would be a silent physics change.
    expect(Math.hypot(roadStick(0.7, 0, 1).x, roadStick(0.7, 0, 1).y)).toBeCloseTo(1, 6);
    const half = roadStick(0, 0.3, 0.4);
    expect(Math.hypot(half.x, half.y)).toBeCloseTo(0.5, 6);
  });

  it('is inert with no input', () => {
    // Zero stick must stay zero, or a coasting car would be handed a direction.
    expect(roadStick(0.9, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});