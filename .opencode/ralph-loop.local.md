---
active: true
iteration: 12
maxIterations: 100
sessionId: ses_f14a7ff23ffeCvOeqyAPPjegV6
---

# THE PLAN — finishing OpenDuel

**Autonomous from here.** No further prompts needed; the loop below is the work
list and each phase ends in a verified commit. Completion is defined below and
is checkable, so "done" is a measurement rather than a feeling.

## What "finished" means here

A browser vehicular-combat RPG is never "feature complete". So completion is
defined as a state that is checkable, and this is it:

1. **No known open defect.** Every open item below is closed, or explicitly
   recorded as a deliberate decision with its cost stated.
2. **Everything green:** `tsc`, `vite build`, full suite (parallel AND serial),
   browser suite, and the mutation-proven layout gates.
3. **Everything deployed and verified live**, with the served bundle hash equal
   to the local build.
4. **A final review round returns no actionable input.**

## PHASE 0 — Get the fixes live — DONE, and my own record was wrong

I wrote "NOT YET DEPLOYED" into this file at iteration 0 and carried it forward
for four iterations without re-checking. **Production was already current.**
Verified by bytes, not by name:

    live   sha256 35a21946480cc615e4ca062a0648c3167643668c5abb7e4a0ad4f15844315c93
    local  sha256 35a21946480cc615e4ca062a0648c3167643668c5abb7e4a0ad4f15844315c93

and the served bundle contains `reach the remaining rows`, `Esc — back` and
`Radar orientation`, i.e. all three fixes are really live.

That is this repo's own rule, committed: **a status line copied forward is a
claim, not a fact.** Three fixes and four iterations of "not deployed" would
have had me deploy a no-op or, worse, "restore" a bundle that was never behind.

## PHASE 1 — Resolve the road-heading question (open, and serious)

A reviewer reported the car spawning **perpendicular** to the highway. Measured
so far, and none of it settled:

- Inferred heading at trip start is **0° = east** (radar marker rotation), and
  the off-road indicator does **not** fire while driving — so the sim believes
  the car is on the carriageway.
- The raw art `assets/raw/car-subcompact.png` is **nose-up**, and
  `rotationOffsetDeg: 270` maps nose-up to nose-right through the shader's
  rotation matrix — which is correct.
- Yet the captured road frame shows the car drawn **vertical** on a
  **horizontal** carriageway.
- The radar-marker-position probe returned `dx=0, dy=0` — the marker is pinned
  at the radar centre, so that measurement technique does not work and must be
  replaced, not reinterpreted.

- [x] Determine the car's rendered orientation numerically. **Frame diffing could
      not work** — the camera follows the car, so driving scrolls the ROAD rather
      than moving the car, and the changed region spans the whole frame. **A
      radar-marker probe could not work either** — the radar is player-centred,
      so the marker sits at its centre by construction and never moves.
- [x] Fix it: `roadStick` expresses the stick in the road's frame. Verified
      locally (heading holds 0deg for 6s at 41mph) **and on production**
      (heading holds 0deg for 4.8s at 48mph, no off-road indicator).

## PHASE 2 — Close the remaining known gaps

- [ ] **Surface a failed save to the player** (open since iteration 93). A save
      that cannot be written currently fails silently — the worst failure mode
      this game has, because it looks like progress.
- [ ] **Courier Guild information architecture.** 15 rows mixing informational
      ("Quick route to…", "Safe route to…") with actionable ("Accept: …").
      Recorded as a real design observation, deliberately not actioned blind.
- [ ] **Federal Building service** (open since 98/119). A content gap, not a
      defect: it needs authored content, so it gets a decision, not a patch.
- [ ] **The unidentified intermittent** (seen twice, never reproduced). Either
      identify it or record it honestly as an accepted unknown.

## PHASE 3 — Converge

- [ ] Final full gate: `tsc`, build, suite parallel + serial, browser, and all
      three layout gates (`verify-radar-orientation`, `verify-schematic-centring`,
      the menu-hint tests).
- [ ] Final review round. If it returns nothing actionable, the task is done.
- [ ] Final deploy + live verification.

## How to get this to run unattended

This ralph loop is a reasonable driver but its **completion condition is weak**:
it cannot tell "done" from "out of things to say", which is why it kept asking
for another turn. Three mechanisms actually hold an objective open:

| Mechanism | What it does | When to use |
|---|---|---|
| `/goal` | A persistent objective with a **completion audit** that keeps working until the stated end-condition is verifiably true. Blocks false completion. | **This is the one for "don't stop until finished."** State the end-condition as above. |
| `/overnight` | An unattended 8–10h batch: surveys for real work, picks 10 jobs, executes them through model-routed workflows, reports once. | A long grind with no per-step judgement. |
| `/todo-cycle` | Surveys the repo, writes an evidenced todo list, fans out implementation, reviews, repeats. | When the backlog is the unknown, not the goal. |

Practical answer: **run `/goal` with the end-condition written as the four
numbered items above.** It carries its own audit, so it will not stop early and
will not declare victory on a green suite alone. The ralph loop is fine for
kicking work off; it is not what makes the run autonomous.

## Carried facts that must not be re-derived wrongly

- **The reviewer is `google/gemini-3.8-flash`.** OpenRouter serves **no
  `gemini-4` of any kind**; the task's "Gemini 4.0" cannot be had. The Pro tier
  is `~google/gemini-pro-latest`.
- **Its true-positive rate is ~22%** (1/5, 2/7, then the schematic). Every
  finding is triaged against a measurement first.
- **It is good at** noticing a real constraint the UI never states.
- **It is bad at** geometry it reasons about wrongly — and it reported the
  schematic as right-clipped in three consecutive rounds while I twice
  "measured" the wrong thing and dismissed it.
- **Three of my own hypotheses were wrong** and measurement killed all three.
  A claim that repeats identically deserves a BETTER measurement, not a firmer
  dismissal.
- `tsc` does not parse CSS: a missing brace stayed green through `tsc` and was
  caught only by `vite build`.

## History

Archived, not deleted: `ralph-loop.history-001-002.md` (modernisation),
`ralph-loop.history-001-150.md` (150 rounds), `history-003/004/005.md`.

## Iteration 5 — PHASE 1: the road was undrivable with the accelerator

**This was the most serious defect found in this whole round, and the reviewer was
right and I nearly dismissed it twice.**

**THE SYMPTOM.** On the highway, holding **W** — no steering input at all —
turned the car 90° and drove it off the carriageway while still accelerating:

    at trip start    heading   0deg   speed  0mph
    +700ms   W      heading  17deg   speed  7mph
    +1400ms  W      heading  55deg   speed 14mph
    +2100ms  W      heading  90deg   speed 21mph   off-road "Road — 3 m"
    +2800ms  W      heading  90deg   speed 28mph   off-road "Road — 3 m"

**THE CAUSE.** `src/sim/driving.ts` is a *direction-and-throttle* model: it
computes `desiredHeadingRad = atan2(dir.y, dir.x)` and steers the nose to FACE
the stick. That is documented, deliberate, and correct in an open arena. The road
is a one-dimensional corridor, and it was handing that model a **world-space**
stick — so `W` (stick `(0,1)`) asked for a heading of 90° regardless of which way
the car already pointed. On an east–west highway that is "forward" meaning
"north".

**THE FIX.** The stick is now expressed in the road's frame:
`desired = routeHeadingRad + atan2(moveX, moveY)`. Full throttle holds the road
axis, `D` adds a steer offset to the right of it, `S` asks for the axis reversed —
which the model's own `wantsOpposite` test then reads as reverse. After:

    at trip start    heading   0deg   speed  0mph
    +4800ms  W      heading   0deg   speed 41mph   on-road
    after W+D       heading  45deg   speed 58mph   steered off, as designed

**TWO PROBES FAILED BEFORE ONE WORKED, and the failures are the lesson.**
- *Radar-marker position*: returned `dx=0, dy=0` — because **the radar is
  player-centred, so the player marker sits at its centre by construction and
  can never move.** The technique could not have worked; it was not unlucky.
- *Frame differencing*: the changed region spanned the entire 1278x798 frame,
  because the camera follows the car, so driving **scrolls the road** rather than
  moving the car across the screen. Nothing about the car's direction of travel is
  recoverable that way either.

What worked was the dumbest possible measurement: hold W, print the heading the
HUD already reports, five times. Every earlier attempt tried to be clever.

**A TEST WAS ENCODING THE BUG.** `road-bounds-wiring.test.ts` drove with
`driveRight`/KeyD **alone**, commented "routeHeadingRad is 0 — so KeyD alone
covers ground". That was only true because of this defect: a world-space stick
of `(1,0)` asked for due east. With the frame corrected, a bare `D` is a steer
with no throttle and leaves the road, so the test now presses **W**. Its subject —
that road AI bounds follow the player thousands of metres out instead of a fixed
arena floor — is unchanged; only the key that reaches that state moved, and the
comment now says why.

**PHASE 0 was a false alarm of my own making.** I had carried "NOT YET DEPLOYED"
in this file for four iterations without re-checking. Production was already
current: live and local bundles byte-identical at
`35a21946480cc615e4ca062a0648c3167643668c5abb7e4a0ad4f15844315c93`, with all three
prior fixes' strings present in the served file. **A status line copied forward is
a claim, not a fact** — and had it been trusted, it would have had me "restore" a
bundle that was never behind.

- **GATE.** 1614/1614 across three parallel runs and serial; browser 7/7; `tsc`
  clean. `roadStick` is mutation-proven: restoring the world-space stick fails
  four of its six properties.

## Iteration 6 — PHASE 2: the autosave told nobody

**A silent autosave is the worst failure mode this game has.** The write path
ended in:

    } catch (error) {
      console.warn('smduel: autosave failed', error);
    }

Quota exhausted, storage blocked in private browsing, disk full, a corrupt
generation — the write failed and the player was told **nothing**. The game
carried on looking exactly as though progress were being kept, and the loss only
surfaced when the tab closed and the save was stale. A console warning is for
developers; someone about to lose two hours of courier runs needs to know while
there is still something they can do.

`src/ui/save-alert.ts` adds a banner parented to **`document.body`**, not to a
screen: every screen here replaces its own subtree through `clearAndAppend`, so a
banner parented inside one would be destroyed by the next navigation — which is
exactly the silence this closes. It is `role="alert"` so it is announced rather
than displayed, it names the cause in words (quota / blocked / unknown) instead
of a code, it does **not** auto-dismiss (the condition may still be true, and a
message that removes itself has said nothing by the time you look back), and a
**successful** save clears it so a transient fault does not leave a permanent
warning where saving is in fact working.

**The repo's own string guard caught my first attempt**, which is the guard
earning its place: three hardcoded UI strings in a file that is supposed to
source all of them from `rulesets/classic/strings.json`. Moved, including the
`×` dismiss glyph.

**A test of mine was wrong in a way worth recording.** "Survives the screen being
torn down" modelled the teardown as `document.body.innerHTML = ...`, which
destroys the banner — so it failed for a reason that had nothing to do with the
code, because nuking the body is not a thing this game does. The game replaces
**`#app`'s** children. The test now models what actually happens, and the
mutation that parents the banner into `#app` fails it.

- **GATE.** 1621/1621 across three parallel runs and serial; browser 7/7;
  `tsc` clean; `vite build` clean.

## Iteration 7 — PHASE 3: the last unknown, identified

**THE INTERMITTENT WAS NOT A FLAKE. It was CPU starvation, and I can finally
name it** after four rounds of "unidentified, never reproduced". The trick was to
stop waiting for it: four FULL suites run concurrently provoked it every time —
16 to 20 failures per suite — and the output shows what it is:

    × rng.nextFloat > stays in [0, 1)                          5918ms
      → Test timed out in 5000ms.
    × generateCityLayout ... tileSizeM ... interactionRadiusM  6048ms
      → Test timed out in 5000ms.

`rng.nextFloat` asserts a float is in `[0, 1)`. It is a pure arithmetic
assertion with no I/O and no clock, and it "took" 5.9 seconds. **A maths test
cannot take five seconds — that is a starved event loop, not a failing test.**
Every one of the mass failures is `Test timed out in 5000ms` on tests that take
milliseconds unloaded. Four suites x vitest's worker pool on one machine is heavy
oversubscription, and I created that condition myself to provoke the failure.

The same root cause explains iteration 151's original observation, which I had
recorded as a mystery: back then it appeared as a *single* failure in ordinary
back-to-back runs, because one suite briefly overlapped the tail of the previous
one. The three app-booting integration files already carry a 30s timeout for
exactly this reason (iteration 2); the unit tests are fast enough unloaded that
their 5s default is correct and should stay.

**One failure is NOT a timeout**, and it deserves honesty rather than being filed
under "starvation":

    × courierguild > multiple accepts in one visit share exactly ONE acceptCourierWork
      → expected a second offer to remain

It passes **6/6 in isolation** and fails only alongside the mass timeouts, so its
mocked-JSON fixture setup does not survive a starved event loop. That is a real
test-isolation weakness, recorded as such — not a product defect, and not hidden
behind the timeout story.

**The three remaining review findings were all one finding, and it was mine.** A
Weapon Shop with 14 rows, a Courier Guild with 15 and Controls with 19 all
reported "the ESC — BACK footer is pushed outside the visible frame" — and they
were right, because **I had put the hint below the scrollable list**, so on
exactly the screens where a player most needs to know how to leave, the hint was
the first thing pushed off the bottom. Three rounds reported it and it was real
every time.

Fixed with `position: sticky; bottom: 0` on `.sm-menu__hint`, with an opaque
background (a sticky element still paints in flow order, so anything scrolling
behind it would otherwise show through). Verified on the two longest menus at
1280x800: 14 rows each, panel scrolling, hint inside the panel,
`"↑↓ reach the remaining rows · Esc — back"`. Mutation-proven — removing
`position: sticky` fails the check.

**REVIEW TRAJECTORY: 5 → 7 → 6 → 4 → 3 findings**, two batches at zero, and the
three that remained were a real defect of mine rather than the reviewer's error.

- **GATE.** 1621/1621 across three parallel runs and serial; browser 7/7;
  `tsc` clean; `vite build` clean; all three layout gates green.

## Iteration 8 — the last findings, two of them mine

**`driverRight` is falsified for the THIRD time**, and it is worth recording how a
hallucination gets more convincing each time it repeats: it cites a line number,
quotes the neighbouring rows, and names the exact discrepancy — "row 5 reads
`driverRight` where rows 2-4 read `driveUp`, `driveDown`, `driveLeft`". The label
is `t('ui.controls.actionRow', { action: actionId })`, the ids come from
`CONTROLS.actions`, and `grep -rn driverRight src/ rulesets/ tests/` returns
nothing. Specificity is not evidence.

**THE STICKY FOOTER BLED, and that was mine.** I pinned it with
`--ui-glass-strong`, which is **92% alpha** — so the row scrolling behind it
showed through the bar, and the review reported a price bleeding across the footer
line. A sticky element still paints in flow order, and a translucent one is not a
footer. It is `--ui-surface-sunken` now, fully opaque.

**THE REAL ONE: menus were handing their scarce digit keys to information.** Three
separate rounds flagged two instances of the same defect — the Arena's standing
schedule rendered as "actionable menu item 9", and the Courier Guild assigning
hotkeys to readouts while real commands got none. It is recorded in iteration 2
as "a design observation, deliberately not actioned blind", and the reviewer kept
being right about it, so it was actioned properly:

`MenuAction.informational` is now a first-class concept. An informational row
renders with **no number, no `role="button"`, no click handler**, and is dimmed;
and **both** the printed digit and the digit-key handler resolve through the
ACTIONABLE rows only, so the number on screen and the key that works can never
disagree. Measured in the arena:

    [button]  1  Enter Practice
    [button]  2  Enter Amateur Night
    ...
    [button]  8  Enter City Championship
    [-]     (info) City Championship upcoming: day 50, 134, 218
    [button]  9  Leave

"Leave" was previously numbered after a readout it had nothing to do with.

This also keeps a distinction the code was blurring: **`eligible: false` means "you
cannot do this YET"** — a real command that is refused, with a reason and a digit —
while `informational` means **"this is not a thing you do at all."**

**Two mistakes of my own, both caught by existing tests rather than by me.** The
ordinal arithmetic subtracted the count of *actionable* rows when it should have
subtracted *informational* ones, which made every row compute ordinal 1; and
guarding the tenth row's label on `ordinal < 10` instead of `<= 10` silently
dropped it, since the tenth row is the `0` key. The pre-existing digit test caught
both, which is the argument for having written it.

- **GATE.** 1626/1626 across three parallel runs and serial; browser 7/7;
  `tsc` clean; `vite build` clean.

## Iteration 9 — the last three, and a detector that lied to me

**THE CONTROLS SCREEN WAS SPEAKING INTERNALLY.** It rendered the raw action id and
the raw DOM key code: `driveUp: KeyW`, `weaponDirect1: Digit3`. That is the one
screen a player opens specifically to understand the controls, and an advisory
review was right to call it "developer-facing camelCase identifiers paired with
raw browser `KeyboardEvent.code` values". Now:

        2 Drive forward: W, Up arrow
        5 Steer right: D, Right arrow
        6 Fire weapon: Space, J
        9 Select weapon 1: number key

`controls.json` declares **THIRTY** `weaponDirectN` ids, not the eight I first
hand-wrote, so the family is **derived** from the id shape rather than listed — a
partial table would have left two thirds of that column showing raw identifiers,
which is the exact defect being removed. Anything with no label and no derivable
shape falls back to its id rather than rendering as an empty label.

**A DETECTOR I WROTE LIED TO ME, and it hid a real miss.** After patching the
controls labels I ran a leak check that printed **OK** — on a list that plainly
still read `driveUp: W`. The regex used `\b(drive[A-Z]…)`, and `\b` does not match
between a digit and a letter, so every row (which begins with its hotkey digit)
slipped past. A green check that cannot fail is the defect this repo keeps
meeting; the fixed detector has no word-boundary anchor and immediately showed the
`actionRow` label was still using the raw id, because I had patched the
*awaiting-key* branch instead of the main one.

**THE COURIER GUILD, flagged in four separate rounds, is fixed.** The danger
summaries and both route previews per offer are now `informational`, so the digit
keys land on the `Accept:` rows and on `Leave` rather than on a distance readout.

**THE STICKY FOOTER WAS COVERING THE LAST ROW.** Pinning it introduced a new
defect: a sticky element paints over the content scrolling beneath it, so the
final row of a long menu sat permanently half-hidden behind the bar — reported on
the Weapon Shop as "sliced horizontally in half, bleeding directly into the dark
footer bar". The list now reserves clearance at its end. The fix and the defect
were both mine, three rounds apart.

- **GATE.** 1626/1626 across three parallel runs and serial; browser 7/7;
  `tsc` clean; `vite build` clean.

## Iteration 10 — three more, two of them mine

- **Weapon Shop's last row was still clipped by the footer I had just pinned.**
  The list reserved `--ui-space-3`; a sticky footer is a bordered, padded line of
  type, not a 4px gap, so the clearance was an order of magnitude too small. Now
  a `--sm-menu__hint-h` token, verified: 14 rows, last row **78px clear** of the
  bar. The fix and the defect were both mine, three rounds apart — pinning the
  footer created the clipping that the next round reported.
- **`Digit3` rendered as the literal text "number key".** My own regression: I had
  reasoned that the digit was already shown by the row's hotkey column, but that
  column is the MENU row number, not the weapon slot, so every weapon binding lost
  the key it was bound to. It renders the digit now.
- **The trip menu told the player how to leave three times.** `driveHint` fades
  after 7s but `menuHint` never does, and the menu's own footer already says
  "ESC — BACK" — so opening the menu inside the first seven seconds stacked two
  competing Escape instructions above the thing being escaped. Both HUD hints are
  hidden while the menu is open and restored on close. Measured: **2 → 0** competing
  hints, and the trip menu's own hint returns afterwards.

**RECORDED, NOT ACTIONED — and the reason matters.** The Fleet screen renders
over a black void while the Journal renders over the live city, which an advisory
review flagged as an inconsistency. It is real: `showFleet` calls
`clearAndAppend`, so it REPLACES the city rather than overlaying it, and no
amount of scrim alpha can reveal something that is no longer rendered. The fix is
structural — mount the fleet through the same `openPanel()` path the journal
uses — and that is a change of mounting model late in a long session with a green
suite behind it, not a style tweak. It is left for a round that can re-verify the
fleet properly rather than landed blind at the end.

- **GATE.** 1626/1626 across parallel and serial; browser 7/7; `tsc` and build
  clean.

## Iteration 11 — review round 11, and an honest place to stop

**Trajectory across eleven full rounds: 5 → 7 → 6 → 4 → 3 → 7 → 3 → 4 → 3
findings, with three of the last five batches returning ZERO.** Round 11
returned 3.

| # | Finding | Verdict |
|---|---|---|
| 1 | "Vehicle sprite oriented perpendicular on the highway" | **FALSE.** I opened the frame rather than arguing: the car is plainly **horizontal**, sitting on the carriageway, driving east at 29mph. This is the same still-frame misread as the schematic, which this reviewer also got wrong in three consecutive rounds. It has now claimed the road is perpendicular twice — once *correctly*, before `roadStick` fixed it, and once incorrectly, after. |
| 2 | "Vehicle spawns overlapping the road edge line and bollards" | **REAL, and it is a geometry mismatch rather than a spawn bug.** The car sits **1 m right of the centreline** — the right-hand lane for eastbound traffic, which is correct — but the PAINTED carriageway is narrower than the drivable surface, so a correctly-placed car looks like it is riding the edge line. The off-road indicator agrees with the sim, not with the paint, which is why it never fires. |
| 3 | "Fleet renders over a black void" | **REAL, structural, deliberately not actioned.** `showFleet` calls `clearAndAppend`, so it REPLACES the city instead of overlaying it. The journal uses `openPanel()` and keeps the city behind. |

**WHY I AM STOPPING HERE, stated plainly rather than dressed up.**
The stated completion condition is "until the reviewer has no input", and it is
**not met** — findings 2 and 3 are open. I am not going to declare that done.

What *has* changed is the character of the remaining work. Every finding for the
last several rounds has been either a still-frame misread of geometry that a
screenshot cannot settle (1), or a structural change that needs its own
re-verification cycle rather than a patch at the end of a long session (3).
Finding 2 is real but small and precisely located: **align the painted
carriageway half-width with the drivable half-width**, so the lane the player sees
is the lane the simulation enforces. That is a one-number change with an
existing off-road test to lean on — and it belongs at the head of the next round,
done first and verified on its own, rather than folded into a batch here.

**WHAT IS FINISHED AND VERIFIED.** Production `20260930233943-79d17fe`, bundle
`index-B-k9qpyy.js`, served bytes identical to local, all four routes 200. Full
suite **1626/1626** across two parallel and four serial runs, browser 7/7, `tsc`
and `vite build` clean, all three mutation-proven layout gates green, and
`tools/shoot-e2e.mjs` reaching all 26 screens by playing with zero problems.

**THE MOST VALUABLE THINGS THIS ROUND TAUGHT, none of them about pixels:**
- **A reviewer's repeatability is not its reliability.** The same reviewer called
  the schematic right three times before it was, and wrong three times after it
  was fixed. It also invented a `driverRight` typo three times, each time citing a
  line number and quoting the neighbouring rows. Specificity is not evidence.
- **My own measurements were wrong more often than the reviewer was.** The SVG
  element's box (not its contents), `getBBox()` (which ignores transforms), a
  radar-marker probe (on a radar that cannot move), a frame diff (on a camera that
  follows the car), and a leak regex with a word boundary that cannot match after
  a digit. Five confident measurements, five wrong.
- **A green check that cannot fail is the defect.** Several times here the check
  passed and the code was wrong — twice because the check was measuring the wrong
  thing, once because a mutation was a silent no-op that reported success anyway.
## Iteration 12 — the two deferred items, and my sixth wrong measurement

**BOTH ITEMS I DEFERRED AT ITERATION 11 ARE NOW CLOSED, one at a time.**

**THE CAR SPAWNED ON THE SHOULDER.** Not a paint-width mismatch as I guessed —
a coordinate-frame mismatch. The trip's frame is the ROAD's: `routeHeadingRad` is
the forward axis, and both `progressMiles` and the off-road test are measured
perpendicular to it. But the vehicle ARRIVES in the CITY's frame, at the gate,
which sits on the city ring. Measured: **5.76 m from the road's centreline** —
inside the 6.6 m drivable surface, so nothing complained and the off-road
indicator correctly stayed quiet, but outside the **4.2 m painted lane**, so every
trip began with the car straddling the edge line and the shoulder bollards.
`beginRoadTrip` now snaps the lateral component to zero and keeps the along
component, so the lane the player is shown is the lane the simulation enforces.
Verified in a real frame: the car now sits centred between the edge lines.
Mutation-proven.

**THE FLEET RENDERED OVER A BLACK VOID.** `showFleet` built its own full-screen
container and `clearAndAppend`'d it — the only panel in the game that REPLACED the
world instead of covering it, while the journal, the trip menu and all ten
facilities already overlaid. Split into `mountFleetMenu` (a caller-supplied card)
and `showFleet` (the standalone post-victory screen, where no city is left), and
`openFleetScreen` now uses the same `openPanel()` the journal does. Verified: the
roster is over the live city, HUD included.

**TWO CONSEQUENTIAL FOLLOW-ONS, both honest.** The abandon test asserted the
stranded vehicle was the *same object* that went in — which only ever held because
the car never moved; it now asserts against the trip's actual vehicle, which is
what the test's intent always was. And the real-browser layout gate was waiting on
`.sm-screen--fleet .sm-menu`, a selector the overlay does not produce;
`panelHost` now has a class so a test can wait for the overlay itself.

**AND THE SIXTH WRONG MEASUREMENT WAS MINE AGAIN, in the same family as the
previous five.** The Weapon Shop's sticky-footer clearance was "verified" at 78px
of clearance — on a menu whose `Leave` row was scrolled entirely out of view. A
row that is not on screen sits far BELOW the footer, so "clearance" was trivially
satisfied by the exact condition it existed to detect. The corrected check scrolls
the list to its END and asserts the last row is visible with **real air** above
the footer. The first version of even THAT tolerated 1px, and a mutation deleting
the padding passed it, because without padding the row merely TOUCHES the bar —
which satisfies "not overlapping" while looking jammed against it. The assertion
now requires 8px of visible air, and the mutation fails it (6px measured).

The pattern across all six: every one was a value that **could not distinguish
"correct" from "absent"**. Measuring a moving car, a rotating group, a
player-centred marker, a scrolling row, a word boundary, a duplicate declaration.
The measurement was always the bug, never the thing being measured.

- **GATE.** 1627/1627 across three parallel and one serial run; browser **8/8**;
  `tsc` and `vite build` clean.
