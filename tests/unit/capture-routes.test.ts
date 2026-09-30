import { describe, expect, it } from 'vitest';

import { SCREEN_TARGETS, screenFromSearch } from '@/app';

/**
 * `?screen=` is how this loop reaches every screen: the capture rig
 * (`tools/shoot.mjs`), every review the reviewer drives, and every live probe.
 *
 * The guard exists because of a silent failure that cost a whole round. The
 * `arena-event` capture target was added and then mounted NOTHING in a live
 * browser — no screen, no error, no warning. `screenFromSearch` validated the
 * param with `/^[a-z]+$/`, which rejects the HYPHEN in `arena-event`, so it
 * returned `null`; and `null` is indistinguishable from "no `screen` param at
 * all". Iteration 109's first production probe consequently reported the
 * arena pause "not working" when it was probing the wrong closure, and the
 * fallback workaround — walking the city to an arena door — dead-ended exactly
 * as iteration 90's did.
 *
 * So this is the same class the log keeps paying for — a healthy-looking
 * signal standing in for a fact — with the sharpest possible sting: a feature
 * that was fully built, fully tested, and still unreachable, because a
 * three-character regular expression said no.
 *
 * The property is therefore not "the regex is right" but "no listed target can
 * be unreachable". Every entry must survive the parser, and anything that does
 * not must be rejected loudly enough to notice.
 */
describe('capture routes: ?screen= reaches every screen the rig claims to have', () => {
  it('every declared target survives screenFromSearch', () => {
    const unreachable = SCREEN_TARGETS.filter((t) => screenFromSearch(`?screen=${t}`) !== t);
    expect(
      unreachable,
      `these targets are routable in startScreenJump but rejected by screenFromSearch, so they silently mount nothing: ${unreachable.join(', ')}`,
    ).toEqual([]);
  });

  it('normalises case and surrounding whitespace, because a URL param will have them', () => {
    for (const t of SCREEN_TARGETS) {
      expect(screenFromSearch(`?screen=${t.toUpperCase()}`), `${t} uppercased`).toBe(t);
      expect(screenFromSearch(`?screen=%20${t}%20`), `${t} padded`).toBe(t);
    }
  });

  it('still rejects what no target could legitimately contain', () => {
    // The regex is a cheap pre-filter, not the allowlist — `SCREEN_TARGETS` is
    // the real gate. These must not reach the router either way.
    for (const junk of ['arena event', 'arena/event', 'a;b', 'arena_event', '<script>']) {
      const parsed = screenFromSearch(`?screen=${encodeURIComponent(junk)}`);
      expect(parsed === null || !SCREEN_TARGETS.includes(parsed as (typeof SCREEN_TARGETS)[number]), `${junk} reached the router`).toBe(true);
    }
  });

  it('distinguishes "no screen param" from "a screen param that was rejected"', () => {
    // Both return null, which is exactly the ambiguity that hid the bug — so
    // this test does not try to fix the return type, it PINS the current
    // contract and puts the two cases side by side so the next reader sees
    // that `null` is ambiguous by design and that the allowlist test above is
    // what keeps it safe.
    expect(screenFromSearch('')).toBeNull();
    expect(screenFromSearch('?screen=')).toBeNull();
    expect(screenFromSearch('?seed=a11ce5ee')).toBeNull();
  });

  it('includes the arena-event target, the one whose absence cost two verifications', () => {
    expect(SCREEN_TARGETS).toContain('arena-event');
    expect(SCREEN_TARGETS).toContain('arena');
    // and they are DIFFERENT screens: `arena` is the practice sandbox,
    // `arena-event` is `showArenaEvent`. A probe that confuses them will read
    // a working fix as broken.
    expect(SCREEN_TARGETS).not.toContain('arenaEvent');
  });
});
