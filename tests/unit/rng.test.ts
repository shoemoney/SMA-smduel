import { describe, expect, it } from 'vitest';
import { createRng, type RngState } from '@/util/rng';
import { hashState } from '@/util/hash';

// ---------------------------------------------------------------------------
// Independent reference implementation.
//
// Hand-coded directly from the algorithm documented at the top of
// src/util/rng.ts (splitmix32 seed expansion, fed into xoshiro128**, per
// Blackman & Vigna) — it does NOT call into src/util/rng.ts. This is what
// actually pins the algorithm: every other test in this file exercises
// createRng() against a second createRng() instance, so a change that moves
// both sides together (reordering the two xoshiro update lines, changing the
// splitmix32 constant, swapping which word gets XORed with which) stays
// green. Comparing against a second, independently-typed implementation of
// the same documented rule is the one thing that can actually catch that.
// ---------------------------------------------------------------------------

function refSeedKeyOf(seed: string | number): string {
  return typeof seed === 'number' ? `n:${Math.trunc(seed)}` : `s:${seed}`;
}

function refFnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function refSplitMix32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1) >>> 0;
    z = (z ^ (Math.imul(z ^ (z >>> 7), z | 61) >>> 0)) >>> 0;
    return (z ^ (z >>> 14)) >>> 0;
  };
}

function refRotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

function refSequence(seed: string | number, count: number): number[] {
  const draw = refSplitMix32(refFnv1a32(refSeedKeyOf(seed)));
  const s: [number, number, number, number] = [draw(), draw(), draw(), draw()];
  if (s.every((word) => word === 0)) s[0] = 1;

  const out: number[] = [];
  for (let n = 0; n < count; n++) {
    const [s0, s1, s2, s3] = s;
    const result = Math.imul(refRotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    const s2a = (s2 ^ s0) >>> 0;
    const s3a = (s3 ^ s1) >>> 0;
    s[0] = (s0 ^ s3a) >>> 0;
    s[1] = (s1 ^ s2a) >>> 0;
    s[2] = (s2a ^ t) >>> 0;
    s[3] = refRotl(s3a, 11);
    out.push(result);
  }
  return out;
}

describe('createRng golden vectors (independent reference implementation)', () => {
  it('matches an independently-coded splitmix32 + xoshiro128** reference for a string seed', () => {
    const rng = createRng('golden-vector-seed-1');
    const actual = Array.from({ length: 50 }, () => rng.nextU32());
    expect(actual).toEqual(refSequence('golden-vector-seed-1', 50));
  });

  it('matches the reference for a numeric seed', () => {
    const rng = createRng(1234);
    const actual = Array.from({ length: 50 }, () => rng.nextU32());
    expect(actual).toEqual(refSequence(1234, 50));
  });

  it('pins a literal first-draw value (computed once from the reference above) so a future ' +
    'implementation change cannot pass just by moving both sides of a self-comparison together', () => {
    expect(createRng('duel-seed-1').nextU32()).toBe(refSequence('duel-seed-1', 1)[0]);
    // Concrete, non-tautological anchor: this exact number is what the
    // documented algorithm produces for this exact seed. If this literal
    // ever needs to change, the algorithm changed and every existing save's
    // rngState is invalidated — that is the point of pinning it.
    expect(refSequence('duel-seed-1', 1)[0]).toBe(1210912935);
  });
});

describe('hashState golden vectors (independent reference implementation)', () => {
  // Hand-coded 64-bit FNV-1a, independent of src/util/hash.ts, over the same
  // length-prefixed-string rule documented there.
  function refFnv1a64(text: string): bigint {
    const OFFSET = 0xcbf29ce484222325n;
    const PRIME = 0x100000001b3n;
    const MASK = 0xffffffffffffffffn;
    let hash = OFFSET;
    const prefixed = `${text.length}:${text}`;
    for (let i = 0; i < prefixed.length; i++) {
      hash ^= BigInt(prefixed.charCodeAt(i));
      hash = (hash * PRIME) & MASK;
    }
    return hash;
  }

  it('matches an independent 64-bit FNV-1a reference over the canonical (tagged-number) JSON', () => {
    const value = { tick: 1200, cars: [{ id: 'a', hp: 40 }] };
    const canonicalJson = JSON.stringify({
      cars: [{ hp: { __n: 40 }, id: 'a' }],
      tick: { __n: 1200 },
    });
    expect(hashState(value)).toBe(refFnv1a64(canonicalJson).toString(16).padStart(16, '0'));
  });

  it('produces a 16-hex-digit (64-bit) digest, not the old 8-hex-digit (32-bit) one', () => {
    expect(hashState({ v: 1 })).toHaveLength(16);
    expect(hashState({ v: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('createRng determinism', () => {
  it('produces an identical sequence for the same seed over 10000 draws', () => {
    const a = createRng('duel-seed-1');
    const b = createRng('duel-seed-1');
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      seqA.push(a.nextU32());
      seqB.push(b.nextU32());
    }
    expect(seqB).toEqual(seqA);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng('duel-seed-1');
    const b = createRng('duel-seed-2');
    const seqA = Array.from({ length: 256 }, () => a.nextU32());
    const seqB = Array.from({ length: 256 }, () => b.nextU32());
    expect(seqB).not.toEqual(seqA);
  });

  it('accepts a numeric seed and a string seed as distinct spaces', () => {
    const numeric = createRng(42);
    const numericAgain = createRng(42);
    const stringly = createRng('42');
    expect(numericAgain.nextU32()).toBe(numeric.nextU32());
    expect(stringly.nextU32()).not.toBe(createRng(42).nextU32());
  });

  it('resumes identically after serialize/restore mid-sequence', () => {
    const reference = createRng('mid-combat-save');
    for (let i = 0; i < 137; i++) reference.nextU32();
    const saved: RngState = reference.serialize();
    const expectedTail = Array.from({ length: 500 }, () => reference.nextU32());

    // A differently-seeded, already-advanced rng must resume the MAIN draw
    // sequence exactly like `reference` once its state is overwritten via
    // restore(), regardless of what it was originally constructed with.
    const other = createRng('unrelated-seed');
    for (let i = 0; i < 9001; i++) other.nextU32();
    other.restore(saved);
    const actualTail = Array.from({ length: 500 }, () => other.nextU32());

    expect(actualTail).toEqual(expectedTail);
  });

  it('serialize() returns a snapshot, not a live view', () => {
    const rng = createRng('snapshot-seed');
    const snap = rng.serialize();
    rng.nextU32();
    const snapAfter = rng.serialize();
    expect(snapAfter.words).not.toEqual(snap.words);
  });
});

describe('createRng restore()', () => {
  it('rejects an all-zero state instead of silently creating a dead generator', () => {
    const rng = createRng('restore-guard');
    expect(() => rng.restore({ seedKey: 's:whatever', words: [0, 0, 0, 0] })).toThrow(RangeError);
  });

  it('a rejected all-zero restore leaves the generator producing real (non-zero-locked) draws', () => {
    const rng = createRng('restore-guard-survives');
    try {
      rng.restore({ seedKey: 's:whatever', words: [0, 0, 0, 0] });
    } catch {
      // expected
    }
    const draws = Array.from({ length: 10 }, () => rng.nextU32());
    expect(draws.some((value) => value !== 0)).toBe(true);
  });

  it('rejects a missing or empty seedKey', () => {
    const rng = createRng('restore-guard-seedkey');
    const saved = rng.serialize();
    expect(() => rng.restore({ ...saved, seedKey: '' })).toThrow(RangeError);
  });

  it('rejects a malformed words array', () => {
    const rng = createRng('restore-guard-words');
    const saved = rng.serialize();
    expect(() =>
      rng.restore({ ...saved, words: [1, 2, 3] as unknown as RngState['words'] }),
    ).toThrow(RangeError);
    expect(() =>
      rng.restore({ ...saved, words: [1, 2, 3, 0xffffffff + 1] as unknown as RngState['words'] }),
    ).toThrow(RangeError);
  });

  it('restores substream derivation along with the main draw sequence (a loaded save must ' +
    'not desync substreams taken after the load)', () => {
    const reference = createRng('real-world-seed');
    for (let i = 0; i < 50; i++) reference.nextU32();
    const saved = reference.serialize();

    // Constructed with the WRONG seed, exactly like a real load path that
    // builds an Rng before it has read the save's seed back out.
    const loaded = createRng('default-seed');
    loaded.restore(saved);

    expect(loaded.serialize().seedKey).toBe(reference.serialize().seedKey);
    expect(loaded.stream('crash').nextU32()).toBe(
      createRng('real-world-seed').stream('crash').nextU32(),
    );
    // And explicitly NOT derived from the seed it was originally constructed with.
    expect(loaded.stream('crash-2').nextU32()).not.toBe(
      createRng('default-seed').stream('crash-2').nextU32(),
    );
  });
});

describe('createRng substreams', () => {
  it('derives different sequences for different labels', () => {
    const root = createRng('substream-root');
    const a = root.stream('salvage:wreck-17').nextU32();
    const b = root.stream('salvage:wreck-18').nextU32();
    expect(b).not.toBe(a);
  });

  it('derives a substream deterministically from the seed + label alone, independent of prior draws', () => {
    const freshParent = createRng('substream-root');
    const freshChild = freshParent.stream('salvage:wreck-17');

    const advancedParent = createRng('substream-root');
    for (let i = 0; i < 4321; i++) advancedParent.nextU32();
    const advancedChild = advancedParent.stream('salvage:wreck-17');

    const freshSeq = Array.from({ length: 200 }, () => freshChild.nextU32());
    const advancedSeq = Array.from({ length: 200 }, () => advancedChild.nextU32());
    expect(advancedSeq).toEqual(freshSeq);
  });

  it('lets unrelated systems draw in any order without desyncing each other', () => {
    const parentA = createRng('order-independence');
    const combatChild = parentA.stream('combat').nextU32();
    const lootChild = parentA.stream('loot').nextU32();

    const parentB = createRng('order-independence');
    const lootChildB = parentB.stream('loot').nextU32();
    const combatChildB = parentB.stream('combat').nextU32();

    expect(combatChildB).toBe(combatChild);
    expect(lootChildB).toBe(lootChild);
  });

  it('nests substreams of substreams deterministically', () => {
    const a = createRng('nest-root').stream('outer').stream('inner').nextU32();
    const b = createRng('nest-root').stream('outer').stream('inner').nextU32();
    expect(b).toBe(a);
  });

  it('a stream label can never forge a colliding seed or a different stream\'s key', () => {
    // A delimiter-joined derivation (`${parent}::${label}`) collapses these
    // to the identical literal key and produces identical draws - which
    // would silently correlate two systems that are supposed to be
    // independent (e.g. loot rolls and a literally-seeded 'root::loot' RNG
    // used elsewhere). The length-prefixed derivation must keep them apart.
    const viaStream = createRng('root').stream('loot').nextU32();
    const viaLiteralSeed = createRng('root::loot').nextU32();
    expect(viaStream).not.toBe(viaLiteralSeed);

    // Same hazard one level deeper: nesting two labels must not collide with
    // a single label that happens to contain the same delimiter.
    const nested = createRng('root').stream('a').stream('b').nextU32();
    const flatWithDelimiter = createRng('root').stream('a::b').nextU32();
    expect(nested).not.toBe(flatWithDelimiter);
  });
});

describe('rng.int', () => {
  it(
    'never leaves [min, max] over 100000 draws, including min === max',
    () => {
      const rng = createRng('int-range-check');
      const ranges: Array<[number, number]> = [
        [0, 9],
        [5, 5],
        [-10, 10],
        [0, 99],
        [1_000_000, 1_000_000],
        [-5, -1],
      ];
      for (const [min, max] of ranges) {
        for (let i = 0; i < 100_000; i++) {
          const value = rng.int(min, max);
          expect(value).toBeGreaterThanOrEqual(min);
          expect(value).toBeLessThanOrEqual(max);
          expect(Number.isInteger(value)).toBe(true);
        }
      }
    },
    20_000,
  );

  it('is uniform-ish across a small range', () => {
    const rng = createRng('int-uniformity-check');
    const counts = new Array<number>(10).fill(0);
    const draws = 100_000;
    for (let i = 0; i < draws; i++) {
      const value = rng.int(0, 9);
      counts[value] = (counts[value] ?? 0) + 1;
    }
    const expected = draws / 10;
    for (const count of counts) {
      // Loose bound: each bucket within 20% of the expected uniform share.
      expect(count).toBeGreaterThan(expected * 0.8);
      expect(count).toBeLessThan(expected * 1.2);
    }
  });

  it('rejects non-integer or inverted bounds', () => {
    const rng = createRng('int-validation');
    expect(() => rng.int(1.5, 2)).toThrow(RangeError);
    expect(() => rng.int(5, 4)).toThrow(RangeError);
  });

  it('roll() always returns 0..99', () => {
    const rng = createRng('roll-check');
    for (let i = 0; i < 10_000; i++) {
      const value = rng.roll();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(99);
    }
  });

  it('int(min, min) still consumes exactly one draw, so a ruleset range collapsing to a ' +
    'single value does not shift every other consumer sharing this stream', () => {
    const rng = createRng('int-degenerate-draw-consumption');
    const before = rng.serialize();
    expect(rng.int(7, 7)).toBe(7);
    const after = rng.serialize();
    expect(after.words).not.toEqual(before.words);
  });
});

describe('rng.nextFloat', () => {
  it('stays in [0, 1)', () => {
    const rng = createRng('float-range');
    for (let i = 0; i < 10_000; i++) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('rng.pick', () => {
  it('returns one of the given elements', () => {
    const rng = createRng('pick-check');
    const items = ['a', 'b', 'c', 'd'] as const;
    for (let i = 0; i < 1000; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it('throws on an empty array', () => {
    const rng = createRng('pick-empty');
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});

describe('rng.chance', () => {
  it('never fires at 0% and always fires at 100%, while still consuming a draw each time ' +
    '(stream position must not depend on whether a tunable is trivial)', () => {
    const rng = createRng('chance-edges');
    for (let i = 0; i < 1000; i++) {
      const beforeZero = rng.serialize();
      expect(rng.chance(0)).toBe(false);
      const afterZero = rng.serialize();
      expect(afterZero.words).not.toEqual(beforeZero.words);

      const beforeHundred = rng.serialize();
      expect(rng.chance(100)).toBe(true);
      const afterHundred = rng.serialize();
      expect(afterHundred.words).not.toEqual(beforeHundred.words);
    }
  });

  it('fires roughly percent% of the time', () => {
    const rng = createRng('chance-distribution');
    let hits = 0;
    const draws = 50_000;
    for (let i = 0; i < draws; i++) {
      if (rng.chance(70)) hits++;
    }
    const ratio = hits / draws;
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(0.75);
  });

  it('rejects an out-of-range percent', () => {
    const rng = createRng('chance-validation');
    expect(() => rng.chance(-1)).toThrow(RangeError);
    expect(() => rng.chance(101)).toThrow(RangeError);
    expect(() => rng.chance(1.5)).toThrow(RangeError);
  });
});

describe('hashState', () => {
  it('is stable when object keys are reordered', () => {
    const a = { body: 'sedan', weight: 2200, armor: { front: 30, rear: 10 } };
    const b = { armor: { rear: 10, front: 30 }, weight: 2200, body: 'sedan' };
    expect(hashState(b)).toBe(hashState(a));
  });

  it('changes when a single number changes', () => {
    const a = { body: 'sedan', weight: 2200 };
    const b = { body: 'sedan', weight: 2201 };
    expect(hashState(b)).not.toBe(hashState(a));
  });

  it('is order-sensitive for arrays', () => {
    const a = { list: [1, 2, 3] };
    const b = { list: [3, 2, 1] };
    expect(hashState(b)).not.toBe(hashState(a));
  });

  it('distinguishes a number from the equivalent string', () => {
    expect(hashState({ v: 1 })).not.toBe(hashState({ v: '1' }));
  });

  it('is stable across repeated calls (no run-to-run drift)', () => {
    const world = { tick: 1200, cars: [{ id: 'a', hp: 40 }, { id: 'b', hp: 12 }], battery: 87 };
    expect(hashState(world)).toBe(hashState(JSON.parse(JSON.stringify(world))));
  });

  it('rejects non-finite numbers', () => {
    expect(() => hashState({ v: Number.NaN })).toThrow(TypeError);
    expect(() => hashState({ v: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it('distinguishes a property explicitly set to undefined from the key being absent entirely', () => {
    expect(hashState({ a: undefined })).not.toBe(hashState({}));
    // And, symmetrically, two objects that both omit/both set it must still agree.
    expect(hashState({ a: undefined, b: 1 })).toBe(hashState({ b: 1, a: undefined }));
  });

  it('rejects functions instead of silently hashing them the same as an empty object', () => {
    expect(() => hashState({ a: () => 1 })).toThrow(TypeError);
  });

  it('distinguishes Maps by content instead of hashing every Map the same as {}', () => {
    expect(hashState(new Map([[1, 2]]))).not.toBe(hashState(new Map([[9, 9]])));
    expect(hashState(new Map([[1, 2]]))).not.toBe(hashState({}));
  });

  it('hashes a Map the same regardless of entry insertion order', () => {
    const a = new Map([
      [1, 'a'],
      [2, 'b'],
    ]);
    const b = new Map([
      [2, 'b'],
      [1, 'a'],
    ]);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('distinguishes Sets by content instead of hashing every Set the same as {}', () => {
    expect(hashState(new Set([1, 2, 3]))).not.toBe(hashState(new Set([1, 2])));
    expect(hashState(new Set([1, 2, 3]))).not.toBe(hashState({}));
  });

  it('distinguishes Dates by their instant instead of hashing every Date the same as {}', () => {
    expect(hashState(new Date(0))).not.toBe(hashState(new Date(99999)));
    expect(hashState(new Date(0))).not.toBe(hashState({}));
  });

  it('rejects an Invalid Date the same way it rejects other non-finite numbers', () => {
    expect(() => hashState(new Date(Number.NaN))).toThrow(TypeError);
  });
});
