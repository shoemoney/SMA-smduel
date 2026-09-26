/**
 * Deterministic structural hashing. Pure — no I/O, no clock, no RNG.
 *
 * Used by `@/sim/world`'s `snapshot()` to turn a world (or any plain-data
 * value) into a short, stable fingerprint so two simulation runs can be
 * compared tick-for-tick without diffing full state.
 */

/** Tag written in place of a literal `undefined`, so an object property that
 * is *present with value undefined* hashes differently from one where the
 * key is simply absent (JSON.stringify silently drops both cases otherwise,
 * making a real divergence — one run carrying an optional field as
 * `undefined`, the other never setting it — invisible to the fingerprint). */
const UNDEFINED_TAG = { __undefined: true } as const;

function canonicalKeyOf(canonical: unknown): string {
  return JSON.stringify(canonical);
}

/** Map entries, canonicalized and then sorted by their canonical key so two
 * Maps holding the same entries hash identically regardless of insertion
 * order — the same order-independence guarantee plain objects already get
 * from the sorted-keys pass below. */
function canonicalizeMap(map: ReadonlyMap<unknown, unknown>): unknown {
  const entries = Array.from(map.entries(), ([key, entryValue]) => {
    return [canonicalize(key), canonicalize(entryValue)] as const;
  });
  entries.sort((a, b) => {
    const left = canonicalKeyOf(a[0]);
    const right = canonicalKeyOf(b[0]);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return { __map: entries };
}

/** Set values, canonicalized and sorted for the same order-independence
 * reason as canonicalizeMap — a Set has no meaningful order to preserve. */
function canonicalizeSet(set: ReadonlySet<unknown>): unknown {
  const values = Array.from(set.values(), (entryValue) => canonicalize(entryValue));
  values.sort((a, b) => {
    const left = canonicalKeyOf(a);
    const right = canonicalKeyOf(b);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return { __set: values };
}

/**
 * Recursively rebuilds `value` with every plain object's keys sorted, so two
 * structurally-equal objects hash the same regardless of property
 * insertion order. Arrays keep their order — order is meaningful (entity
 * iteration order affects determinism), so it must remain part of the hash.
 * A number, and the string that happens to look like it, must hash
 * differently, so numbers are tagged rather than left for JSON.stringify to
 * flatten into the same token as a numeric string.
 *
 * Throws TypeError on NaN/±Infinity: a non-finite number would either
 * serialize as `null` (indistinguishable from an actual null) or as a
 * literal `NaN`/`Infinity` token that isn't valid JSON, either of which
 * would make the hash silently lie about determinism instead of catching
 * the bug that produced a non-finite value in state.
 *
 * Also throws TypeError on functions, symbols and bigints: none of them
 * round-trip through JSON, so silently dropping or stringifying them would
 * be the same "hides a real divergence" failure as the undefined/Map/Set/
 * Date cases below. `undefined`, `Map`, `Set` and `Date` are each given an
 * explicit, order- and type-preserving encoding instead of falling through
 * to `Object.keys()` (which reads back empty for all four and would hash
 * every distinct Map/Set/Date the same as `{}`).
 */
function canonicalize(value: unknown): unknown {
  if (value === undefined) {
    return UNDEFINED_TAG;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`hashState: refusing to hash a non-finite number (${String(value)})`);
    }
    // Object.is(-0, 0) is false, but JSON.stringify(-0) === '0', so left
    // untagged -0 would hash identically to 0. Tag it as the distinct string
    // '-0' rather than the number -0 so canonicalKeyOf/JSON.stringify can't
    // silently re-collapse the two.
    if (Object.is(value, -0)) {
      return { __n: '-0' };
    }
    return { __n: value };
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError(`hashState: refusing to hash unsupported type '${typeof value}'`);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value instanceof Date) {
    // Routed through the number branch above so an Invalid Date (getTime()
    // === NaN) throws the same non-finite TypeError instead of hashing
    // every invalid Date identically to `{}`.
    return { __date: canonicalize(value.getTime()) };
  }
  if (value instanceof Map) {
    return canonicalizeMap(value);
  }
  if (value instanceof Set) {
    return canonicalizeSet(value);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sortedKeys = Object.keys(source).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

// 64-bit FNV-1a, computed with BigInt so the digest space is 2**64 rather
// than 2**32 — at sim scale (60 Hz over an 84-day campaign) a 32-bit digest
// has a real, non-theoretical collision rate (measured: 5 collisions across
// 200,000 distinct sim-shaped states), and loop.test.ts's determinism check
// trusts a digest match as proof the two runs agree, so its false-PASS
// probability has to actually be negligible.
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * Length-prefixes the payload before folding it in, so the digest commits to
 * *how much* was hashed as well as its content — closing off the boundary
 * ambiguity a plain, unprefixed hash over concatenated fields is prone to
 * (e.g. `{a:'bc'}` vs `{a:'b',c:''}`-shaped inputs sharing a byte run).
 */
function fnv1a64(text: string): bigint {
  let hash = FNV64_OFFSET_BASIS;
  const prefixed = `${text.length}:${text}`;
  for (let i = 0; i < prefixed.length; i++) {
    hash ^= BigInt(prefixed.charCodeAt(i));
    hash = (hash * FNV64_PRIME) & MASK_64;
  }
  return hash;
}

/**
 * 64-bit FNV-1a hash of `value`'s canonical JSON encoding, as a 16-hex-digit
 * string. Not cryptographic — it exists purely so determinism tests can
 * compare cheap fingerprints instead of full deep-equality on large worlds.
 */
export function hashState(value: unknown): string {
  const json = JSON.stringify(canonicalize(value));
  return fnv1a64(json).toString(16).padStart(16, '0');
}
