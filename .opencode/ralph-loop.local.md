---
active: true
iteration: 6
maxIterations: 100
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
