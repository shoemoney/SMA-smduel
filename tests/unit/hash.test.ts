import { describe, expect, it } from 'vitest';

import { hashState } from '@/util/hash';

// ---------------------------------------------------------------------------
// hashState is the entire basis of the sim's determinism guarantee
// (@/sim/world's snapshot()). Every case below was a MEASURED collision
// before the fix: all of {}, {a: undefined}, {f: () => {}}, new Map([[1,2]]),
// new Map([[9,9]]), new Set([1,2]), new Date(0) and new Date(99999) hashed to
// the identical value, and hashState(-0) === hashState(0). A snapshot-based
// determinism test cannot fail against a real divergence in any of these
// shapes while that holds, no matter how far two runs actually disagree.
// ---------------------------------------------------------------------------

describe('hashState', () => {
  it('distinguishes -0 from 0', () => {
    expect(hashState(-0)).not.toBe(hashState(0));
  });

  it('distinguishes an object with an undefined-valued property from one missing the key', () => {
    expect(hashState({ a: undefined })).not.toBe(hashState({}));
  });

  it('distinguishes an undefined-valued property from an explicit null', () => {
    expect(hashState({ a: undefined })).not.toBe(hashState({ a: null }));
  });

  it('refuses to hash a function rather than silently dropping it', () => {
    expect(() => hashState({ f: () => 1 })).toThrow(TypeError);
  });

  it('distinguishes Maps with different entries', () => {
    expect(hashState(new Map([[1, 2]]))).not.toBe(hashState(new Map([[9, 9]])));
  });

  it('distinguishes a Map from a plain object and from a Set with the same-shaped content', () => {
    expect(hashState(new Map([[1, 2]]))).not.toBe(hashState({ 1: 2 }));
    expect(hashState(new Map([[1, 2]]))).not.toBe(hashState({}));
  });

  it('hashes two Maps with identical entries the same regardless of insertion order', () => {
    const a = new Map([
      ['x', 1],
      ['y', 2],
    ]);
    const b = new Map([
      ['y', 2],
      ['x', 1],
    ]);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('distinguishes Sets with different values, and a Set from {}', () => {
    expect(hashState(new Set([1, 2]))).not.toBe(hashState(new Set([3, 4])));
    expect(hashState(new Set([1, 2]))).not.toBe(hashState({}));
  });

  it('hashes two Sets with identical values the same regardless of insertion order', () => {
    expect(hashState(new Set([1, 2]))).toBe(hashState(new Set([2, 1])));
  });

  it('distinguishes different Dates, and a Date from {}', () => {
    expect(hashState(new Date(0))).not.toBe(hashState(new Date(99999)));
    expect(hashState(new Date(0))).not.toBe(hashState({}));
  });

  it('refuses to hash an Invalid Date rather than silently treating it like any other Date', () => {
    expect(() => hashState(new Date(Number.NaN))).toThrow();
  });

  it('still throws on a top-level non-finite number (pre-existing contract, kept intact)', () => {
    expect(() => hashState(Number.NaN)).toThrow();
    expect(() => hashState(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('still tags numbers so a number and its lookalike string hash differently (pre-existing contract, kept intact)', () => {
    expect(hashState(5)).not.toBe(hashState('5'));
  });

  it('still sorts plain-object keys so property insertion order does not affect the hash (pre-existing contract, kept intact)', () => {
    expect(hashState({ a: 1, b: 2 })).toBe(hashState({ b: 2, a: 1 }));
  });

  it('still keeps array order significant (pre-existing contract, kept intact)', () => {
    expect(hashState([1, 2])).not.toBe(hashState([2, 1]));
  });
});
