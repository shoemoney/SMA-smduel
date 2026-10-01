---
active: true
iteration: 4
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

- [ ] Determine the car's rendered orientation numerically, by diffing two frames
      and taking the centroid of the changed pixels — that gives the car's
      on-screen DIRECTION OF TRAVEL, which is independent of how the sprite is
      drawn and is therefore the one comparison that settles it.
- [ ] Either fix the rotation/road-axis mismatch, or record a measured proof
      that the render is correct and the reviewer's read was wrong.

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
