// Deterministic PRNG for simulation code.
//
// Algorithm: xoshiro128** (Blackman & Vigna), 128-bit state held as four
// Uint32Array words. All arithmetic is 32-bit integer math (`>>> 0`,
// `Math.imul`, bit shifts) - the generator never accumulates floating-point
// state, so the exact same seed and draw sequence reproduces bit-for-bit
// across every browser/engine. A float is only ever produced as the final,
// one-shot conversion of an integer draw (see nextFloat), never fed back in.

const STATE_WORDS = 4;

export interface RngState {
  /**
   * The root seed key this generator (or substream) was derived from.
   * Required for a correct restore(): the 128-bit `words` alone only fix the
   * *next draw*, not which substreams `stream(label)` derives afterward.
   * Without this, loading a save into an Rng constructed from any other seed
   * resumes the main sequence correctly but silently derives every substream
   * from the WRONG root, desyncing anything that calls `.stream(...)` after
   * a load (see rng.test.ts's restore substream-reseeding test).
   */
  readonly seedKey: string;
  readonly words: readonly [number, number, number, number];
}

export interface Rng {
  /** Raw 32-bit unsigned integer draw, 0..0xFFFFFFFF. */
  nextU32(): number;
  /** Float in [0, 1) derived from a single integer draw (24 bits of precision). */
  nextFloat(): number;
  /** Uniform integer in [minInclusive, maxInclusive], unbiased via rejection sampling. */
  int(minInclusive: number, maxInclusive: number): number;
  /** Uniform integer in [0, 99]. */
  roll(): number;
  /** Uniformly picks one element from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** True with probability percent0to100/100 (0 never fires, 100 always fires). */
  chance(percent0to100: number): boolean;
  /**
   * Derives a new, independent child Rng from this stream's root seed and `label`.
   * Deterministic in the label alone - it does NOT depend on how many draws this
   * Rng (or any sibling) has already consumed, so two systems that pull substreams
   * with different labels can never desync each other regardless of draw order.
   */
  stream(label: string): Rng;
  /** Snapshots the current internal state for persistence. */
  serialize(): RngState;
  /** Overwrites the current internal state from a previously serialized snapshot. */
  restore(state: RngState): void;
}

function readWord(state: Uint32Array, index: number): number {
  const value = state[index];
  if (value === undefined) {
    throw new RangeError(`rng: state index ${index} out of range`);
  }
  return value;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

// splitmix32: expands one 32-bit seed into a stream of well-mixed 32-bit words.
// Used only to build the initial xoshiro128** state (and per-substream state) -
// never used as the draw generator itself.
function makeSplitMix32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1) >>> 0;
    z = (z ^ (Math.imul(z ^ (z >>> 7), z | 61) >>> 0)) >>> 0;
    return (z ^ (z >>> 14)) >>> 0;
  };
}

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function seedKeyOf(seed: string | number): string {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) throw new RangeError('rng: numeric seed must be finite');
    return `n:${Math.trunc(seed)}`;
  }
  return `s:${seed}`;
}

// xoshiro128** is undefined for an all-zero state: every future draw and
// state transition stays 0 forever (0 XOR 0 = 0, 0 * anything = 0). Shared
// by both the seed-expansion path and restore(), so a corrupted or
// zero-defaulted save can never resurrect this degenerate state either way.
function isAllZero(words: readonly number[]): boolean {
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== 0) return false;
  }
  return true;
}

function stateFromSeedKey(seedKey: string): Uint32Array {
  const draw = makeSplitMix32(fnv1a32(seedKey));
  const state = new Uint32Array(STATE_WORDS);
  for (let i = 0; i < STATE_WORDS; i++) {
    state[i] = draw();
  }
  if (isAllZero(Array.from(state))) state[0] = 1;
  return state;
}

function nextRaw(state: Uint32Array): number {
  const s0 = readWord(state, 0);
  const s1 = readWord(state, 1);
  const s2 = readWord(state, 2);
  const s3 = readWord(state, 3);

  const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;

  const s2a = (s2 ^ s0) >>> 0;
  const s3a = (s3 ^ s1) >>> 0;
  const s1n = (s1 ^ s2a) >>> 0;
  const s0n = (s0 ^ s3a) >>> 0;
  const s2n = (s2a ^ t) >>> 0;
  const s3n = rotl(s3a, 11);

  state[0] = s0n;
  state[1] = s1n;
  state[2] = s2n;
  state[3] = s3n;

  return result;
}

function makeRng(seedKey: string, state: Uint32Array): Rng {
  // Mutable so restore() can re-point substream derivation at the restored
  // save's root seed instead of whatever seed this instance happened to be
  // constructed with (see the RngState.seedKey doc comment above).
  let activeSeedKey = seedKey;

  const nextU32 = (): number => nextRaw(state);

  const nextFloat = (): number => (nextU32() >>> 8) * (1 / (1 << 24));

  const int = (minInclusive: number, maxInclusive: number): number => {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new RangeError('rng.int: bounds must be integers');
    }
    if (maxInclusive < minInclusive) {
      throw new RangeError('rng.int: maxInclusive must be >= minInclusive');
    }
    const span = maxInclusive - minInclusive + 1;
    if (!Number.isSafeInteger(span) || span <= 0) {
      throw new RangeError('rng.int: range is too large');
    }

    // No shortcut for span === 1 (min === max): every call must consume
    // exactly one draw regardless of how trivial the range is, so a ruleset
    // tunable that shrinks a range to a single value doesn't shift the draw
    // position of every consumer sharing this stream afterward. The rejection
    // loop below already resolves to `minInclusive` deterministically when
    // span is 1 (limit = 2**32, so the single draw is never rejected).
    //
    // Unbiased rejection sampling: reject draws that fall in the trailing
    // partial bucket so every remaining value in [0, span) is equally likely.
    const limit = Math.floor(0x100000000 / span) * span;
    let draw: number;
    do {
      draw = nextU32();
    } while (draw >= limit);
    return minInclusive + (draw % span);
  };

  const roll = (): number => int(0, 99);

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError('rng.pick: array is empty');
    const index = int(0, items.length - 1);
    // `index` is derived from `int(0, items.length - 1)`, so it is always in
    // bounds; the cast only works around noUncheckedIndexedAccess's blanket
    // `| undefined` on index-signature reads.
    return items[index] as T;
  };

  const chance = (percent0to100: number): boolean => {
    if (!Number.isInteger(percent0to100) || percent0to100 < 0 || percent0to100 > 100) {
      throw new RangeError('rng.chance: percent0to100 must be an integer in [0, 100]');
    }
    // No shortcuts for 0 or 100: `int(0, 99) < percent0to100` is already
    // mathematically exact at both edges (0..99 is never < 0; always < 100),
    // so the early returns were pure (and buggy) premature optimization -
    // they skipped consuming a draw, making stream position depend on the
    // tunable's value instead of only on how many times chance() was called.
    return int(0, 99) < percent0to100;
  };

  // Length-prefixed, not delimiter-joined: `${parent}::${label}` let a label
  // (or a root seed) containing "::" forge another stream's key, e.g.
  // createRng('root').stream('loot') and createRng('root::loot') both
  // reduced to the literal key "s:root::loot" and produced identical draws.
  // Prefixing each part with its own length makes the encoding unambiguous
  // regardless of what characters either part contains - no label can ever
  // be crafted to make `derive(parent, label)` collide with a different
  // (parent, label) pair or with a top-level seed's key.
  const stream = (label: string): Rng => {
    const childKey = `${activeSeedKey.length}:${activeSeedKey}|${label.length}:${label}`;
    return makeRng(childKey, stateFromSeedKey(childKey));
  };

  const serialize = (): RngState => ({
    seedKey: activeSeedKey,
    words: [readWord(state, 0), readWord(state, 1), readWord(state, 2), readWord(state, 3)],
  });

  const restore = (saved: RngState): void => {
    if (typeof saved.seedKey !== 'string' || saved.seedKey.length === 0) {
      throw new RangeError('rng.restore: seedKey must be a non-empty string');
    }
    if (!Array.isArray(saved.words) || saved.words.length !== STATE_WORDS) {
      throw new RangeError('rng.restore: state must have exactly 4 words');
    }
    const words: number[] = [];
    for (let i = 0; i < STATE_WORDS; i++) {
      const word = saved.words[i];
      if (word === undefined || !Number.isInteger(word) || word < 0 || word > 0xffffffff) {
        throw new RangeError(`rng.restore: word ${i} is not a valid uint32`);
      }
      words.push(word);
    }
    if (isAllZero(words)) {
      throw new RangeError(
        'rng.restore: all-zero state is invalid for xoshiro128** (would produce a dead ' +
          'generator that returns 0 forever) - refusing to load it',
      );
    }
    for (let i = 0; i < STATE_WORDS; i++) {
      state[i] = words[i] as number;
    }
    activeSeedKey = saved.seedKey;
  };

  return { nextU32, nextFloat, int, roll, pick, chance, stream, serialize, restore };
}

export function createRng(seed: string | number): Rng {
  const seedKey = seedKeyOf(seed);
  return makeRng(seedKey, stateFromSeedKey(seedKey));
}
