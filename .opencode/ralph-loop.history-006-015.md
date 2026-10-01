# Rounds 6–15 — the review loop, and what it actually found

> The live `.opencode/ralph-loop.local.md` is managed by the loop harness and is
> **gitignored**, so these rounds were recorded only in their commit messages.
> This file makes the record durable. Commit messages carry the full detail; what
> follows is the shape of it.

## The reviewer

The task asked for **Gemini 4.0**. `GET https://openrouter.ai/api/v1/models`
returns **no `gemini-4` of any kind** — measured, not assumed, and written down
rather than substituted quietly. The review ran on `google/gemini-3.8-flash`, the
newest Gemini the catalogue has, with `~google/gemini-pro-latest` available as the
Pro tier.

**Its true-positive rate across eleven rounds was roughly 20–25%**
(5 → 7 → 6 → 4 → 3 → 7 → 3 → 4 → 3 → 0 → 0 findings, with three of the last
five batches returning zero). Every finding was triaged against a measurement
before it was acted on, and the triage was recorded whether the finding survived
or not.

## The two defects that mattered

Both were invisible to every gate in the repo, including a green suite.

**The highway was undrivable with the accelerator.** `src/sim/driving.ts` is a
*direction-and-throttle* model: it computes `desiredHeadingRad =
atan2(dir.y, dir.x)` and steers the nose to **face the stick**. That is
documented, deliberate, and correct in an open arena. The road is a
one-dimensional corridor, and it was handing that model a **world-space** stick —
so `W` (stick `(0,1)`) asked for a heading of 90° regardless of which way the car
already pointed:

    at trip start    heading   0deg   speed  0mph
    +700ms   W      heading  17deg   speed  7mph
    +1400ms  W      heading  55deg   speed 14mph
    +2100ms  W      heading  90deg   speed 21mph   off-road "Road — 3 m"
    +2800ms  W      heading  90deg   speed 28mph   off-road "Road — 3 m"

Fixed with `roadStick`, which expresses the stick in the road's frame
(`desired = routeHeadingRad + atan2(moveX, moveY)`). Verified on **production**:
heading holds 0° across 4.8s at 48 mph with no off-road indicator.

**The autosave failed silently.** The write path ended in
`console.warn('smduel: autosave failed', error)`. Quota exhausted, storage
blocked, disk full — and the player was told **nothing**. The game looked exactly
as though progress were being kept, and the loss only surfaced when the tab
closed. Now a persistent, `role="alert"` banner parented to `document.body` (so no
screen change can wipe it), naming the cause in words, not auto-dismissing, and
cleared by a successful save.

## The other real findings

- **The constructor schematic ran 124 px off its panel** — `viewBox` x-origin was
  `w - h` where a quarter turn about the centre requires `(w - h) / 2`, exactly
  twice the correct offset.
- **Menus handed their scarce digit keys to information.** The Arena's schedule row
  and most of the Courier Guild's rows were readouts rendered as numbered
  commands. `MenuAction.informational` is now a first-class concept: no number, no
  `role="button"`, no click handler, and both the printed digit *and* the key
  handler resolve through actionable rows only.
- **Menus never said how to leave.** Digit keys reach ten rows; a fifteen-row menu
  said nothing about the rest, and nothing about Escape. Now a sticky footer that
  states both, with a real-browser gate.
- **The car spawned on the shoulder** — the trip's frame is the road's, but the
  vehicle arrives in the city's frame at the gate, 5.76 m off the centreline:
  legal, and outside the painted lane.
- **The Fleet rendered over a black void** while every other panel overlaid the
  live city.
- **The Controls screen printed `driveUp: KeyW`** — raw identifiers and DOM key
  codes on the one screen a player opens to learn the controls.
- **The game spoke two dialects** — `armor` and `armour` on adjacent HUD lines.
- **The road asphalt had a hard seam every 9 m** — the detail mask was
  `floor(worldPos / 9.0)`, piecewise constant, so the blend weight stepped.
- **Open panels were painted over by the city HUD** — nothing set a z-index, so
  overlays stacked on DOM order alone.

## The lesson, which is not about pixels

**A reviewer's repeatability is not its reliability, and my own measurements were
wrong more often than the reviewer was.**

This reviewer reported the constructor schematic as right-clipped in three
consecutive rounds and was **right** — after I twice "measured" the wrong thing
and dismissed it. It then invented a `driverRight` typo three times, each time
citing a line number and quoting the neighbouring rows, and claimed the radar
marker was static four times when the heading had been measured rotating four
times.

**Seven of my own measurements could not distinguish *correct* from *absent*:**

| Measurement | Why it could not |
|---|---|
| the SVG element's box | says nothing about what is drawn *inside* its viewBox |
| `getBBox()` | ignores ancestor transforms — compared a portrait car to a landscape box |
| the radar marker's position | the radar is player-centred, so the marker can never move |
| a frame diff | the camera follows the car, so the ROAD scrolls, not the car |
| a leak regex with `\b` | `\b` cannot match between a digit and a letter |
| an "unused variable" check | a referenced import is not a type error |
| a row-to-footer clearance | satisfied trivially by a row scrolled out of view |

Plus two harnesses that reported clean results over work that had not happened:
a review script that incremented a failure counter and never checked it, and an e2e
capture dying on a stale selector for a whole round.

**In every case the measurement was the bug, never the thing being measured.**

The habit that worked was the dullest one: **open the frame and look, or print the
value the game already reports.**

## Where it ended

Production `20261001010834-e9ed4fa`, bundle `index-DPnotiwa.js`, served bytes
identical to local, all four routes 200. **1629/1629** across parallel and serial
runs, browser **8/8**, `tsc` and `vite build` clean, both mutation-proven layout
gates green, and an e2e capture of all **26** screens reached by playing with zero
problems. The final review round answered **5 of 5 batches with no actionable
input** — a clean round that actually ran, which is the only kind worth having.
