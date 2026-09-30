# Working rules for this repo

Every rule here was learned by getting it wrong. The incident numbers point at
`.opencode/ralph-loop.local.md`, which is the full record — read the entry
before acting on a rule you think you already know.

Read this file at the START of a round, not after something has gone wrong.

## Fixtures and imports

- **Never write a fixture, type, or import path from memory.** Grep the
  sibling test file first and copy its import block. Seventeen wrong guesses in
  two rounds (15–17), including three functions that were exported from a
  different module than the one I assumed, all of which were sitting correctly
  written in `screens.test.ts` the whole time. (Iter 102, 103, 104)
- **Derive values from the ruleset, never type them.** A hardcoded
  `skills: {driving: 12, ...}` failed on "must sum to exactly 50"; `bodyId:
  'body-standard'` did not exist. Read the real ids out of the ruleset.
- **A fixture must encode a state the system can actually reach.** `progressMiles`
  is DERIVED from the vehicle's position every tick, so hand-setting it while the
  vehicle sat at the start produced a save that "failed" three rounds of
  debugging while the game was entirely correct. Drive the real function and
  save what it produces. (Iter 104)

## Probing and measuring

- **Dump the thing; do not guess a selector.** Guessed the facility strip's DOM
  selector three times and got three confident wrong answers — it is a CLASSLESS
  div styled entirely in inline `cssText`, on a page with three class names in
  total. A probe that finds nothing is not a measurement, and one that finds the
  WRONG element is worse, because it produces a number. (Iter 98, 99)
- **A flat signal is not a frozen signal.** Two "verified" freeze/resume checks
  were reading a value that had saturated for an unrelated reason (route-axis
  projection). Always show the same value MOVING when the thing under test is
  disengaged, or the check is vacuous. (Iter 100, 103)
- **Locate an element by scanning for it, never by remembering where it was.**
  Three confident wrong measurements came from stale coordinates. (Iter 59, 50)
- **Sample the background from outside the text's own extent.** Every failed
  contrast measurement sampled the glyphs' own anti-aliased halo. A ratio near
  1.0 is a sampling error, not a legibility problem. (Iter 65)
- **A value that cannot move cannot be tested.** The road odometer needs
  counter-steering, not held throttle, or progress saturates off-axis in ~2s.

## Asserting on meaning

- **Assert on the VALUE, never on presence.** Four separate incidents where a
  healthy-looking signal stood in for a fact: a phantom "0 models asked" from a
  swallowed `readFileSync`; `sips` exiting 0 on a missing file; a deploy check
  that asked "does this path exist" instead of "is it the right build"; and a
  route returning 200 read as "my deploy is live". (Iter 16, 71, 81, 83)
- **A test can enforce the bug it was written to prevent.** One asserted
  `toHaveLength(2)` and was really guaranteeing permanent visibility; another
  restated the table under test and therefore AGREED WITH THE BUG for its whole
  life. When a test passes, check what it actually guarantees. (Iter 72, 87)
- **A mutation that cannot fire is a fact about the system, not a passing
  test.** Several here were written, failed to fail, and were worth recording
  anyway. Three of mine were too weak; the fix was a stronger mutation, not a
  weaker test. (Iter 25, 95, 96)
- **Check the selector matches real DOM ancestry before believing a rule
  "isn't applying".** A `color-mix()` on an undeclared custom property is
  INVALID and silently computes to transparent — it looked correct in the
  stylesheet for seventeen iterations. (Iter 32, 41)

## Duplication

- **One owner per rule; every other surface READS it.** A second derivation is
  a second thing to drift. Seven instances: `roadLegalityMisses`,
  `unmetRequirements`, the city-decal count, `facilityMarkerFamily`,
  `daysPerMile`, the furniture's art aspect, the operational-kind set.
- **Never hand-copy a constant the code already holds.** The furniture sized
  itself from a typed `21/96` beside the atlas entry with the real dimensions.
- **When a frame becomes unreferenced, decide deliberately.** Silently-unused
  atlas art is iteration 81's finding; keeping it is fine, leaving it unrecorded
  is not.

## Scope and honesty

- **A fix written to a BUILD OUTPUT instead of its INPUT will be reverted by
  the next build.** The regenerated title art survived exactly one iteration
  because only the next `pack-atlas` run clobbered it. (Iter 79)
- **Record what you did NOT establish.** Half the value of this log is the
  rounds that found nothing, the checks that were partial, and the
  measurements that turned out to be of the wrong element.
- **One run is not a baseline.** `screens.test.ts` is flaky on BOTH trees
  (branch 8/4/1, master 3/3/3). Measure scope before blaming a change.
  (Iter 87, 90, 95, 96)
- **Do not defer the same item twice.** If an iteration ends by recording a
  decision, the next round either makes it or says why not.
- **A design call with measured costs on both sides is a decision, not a
  defect.** Put the numbers in the log and let it be chosen, rather than
  applying a patch at the end of an unrelated round. (Iter 84, 97, 102)

## Testing

- **Prove the new test bites before shipping it.** Mutate the code it guards and
  confirm the right test fails. Writing the test is not the same as knowing it
  works — and a test that passes for the wrong reason is worse than none.
- **Never let a test file delete shared state.** `fake-indexeddb` on the real
  `DB_NAME` is shared with five other files; a `deleteDatabase` in
  `beforeEach` made this file flaky and nearly sent me auditing correct code.
  Discriminate on content instead. (Iter 103)
- **Never cache a resource you close.** Resetting a handle but not the promise
  that produced it hands out a dead connection to everything after it.
