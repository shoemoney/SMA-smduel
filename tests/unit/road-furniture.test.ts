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
import { roadFurnitureInstances } from '@/app';

const atlasIndex = {
  frame: (name: string) => ({ atlasIndex: 0, uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, name }),
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

  it('keeps the rails sized to the art rather than stretched to the period', () => {
    // The frame is 96x21, so its long axis is ~4.57:1. The segment length and
    // the period are DIFFERENT numbers; treating them as one is what would
    // stretch a 4.6:1 sprite into a 1:1 block.
    const rails = roadFurnitureInstances(atlasIndex, at(0), HEADING, HALF);
    const ratio = rails[0]!.sizeM.y / rails[0]!.sizeM.x;
    expect(ratio).toBeGreaterThan(4);
    expect(ratio).toBeLessThan(5);
  });
});
