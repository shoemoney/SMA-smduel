---
active: true
iteration: 2
maxIterations: 100
---

run the entire game e2e taking screenshots get advisorial reviews from gemini 4.0 on gameplay, user experience, graphics, performance, and especially does this look like the 1986 game in a modern manner modern ui input and buttons on openrouter and take action on its findings making a plan, milestones,todos then execute and repeat until the reviewer has no input

## Log

Archived, not deleted: `.opencode/ralph-loop.history-001-002.md` (OpenDuel
modernisation), `.opencode/ralph-loop.history-001-150.md` (150 rounds of
gameplay/art review), `.opencode/ralph-loop.history-003.md` (this round's entry
state).

**READ THE 150-ROUND LOG BEFORE TRUSTING ANY VISION REVIEW.** For eighty-odd
iterations that loop handed a vision model DOWNSCALED STILLS of a live WebGPU
application, and three false findings recurred dozens of times each: the radar was
"missing", the constructor schematic was "missing", the city wall was "missing".
All three were present at full resolution, every time. Raising capture width from
900px to 1280px reduced the class and did not remove it, because a still is the
wrong instrument. `tools/review-codex.sh` (a real browser) is the corrective.

### MODEL AVAILABILITY — MEASURED, NOT ASSUMED

`GET https://openrouter.ai/api/v1/models` returns **no `gemini-4` model of any
kind**. The task asks for "gemini 4.0"; it does not exist on OpenRouter. The
catalogue's newest Gemini entries are:

| Model | Context | Note |
|---|---|---|
| `google/gemini-3.8-flash` | 1,048,576 | newest numbered; the model the 150-round log used |
| `~google/gemini-pro-latest` | 1,048,576 | the Pro tier, reachable only via this alias |
| `google/gemini-3.1-pro-preview` | 1,048,576 | older Pro |

So "Gemini 4.0" is being served by **the newest Gemini OpenRouter actually has**,
and that is stated here rather than silently substituted. Both a Flash and a Pro
opinion are collected per round, because a single vision model's recurring false
findings are this repo's single most documented failure mode.

### Review dimensions asked for

1. Gameplay
2. User experience
3. Graphics
4. Performance
4. **Especially: does this look like the 1986 game done in a modern manner —
   modern UI, modern inputs and buttons?**

### Standing rules (learned expensively, all of them)

- `AGENTS.md` is mandatory. Read whole files before editing.
- Derive fixtures from production code and the ruleset.
- A passing test is not evidence. Mutation-prove every guard.
- Assert on the VALUE, never on presence.
- Locate elements by scanning, never from memory.
- Record what was NOT established.
- Measure before changing.
- Verify the served artefact, not the edited source.
- Deploy whole-site with a bundle-hash check.

### Task

1. Run the ENTIRE game end-to-end, capturing full-resolution screenshots.
2. Get an advisory review from the newest available Gemini on OpenRouter.
3. Triage into a plan / milestones / todos.
4. Execute, deploy, repeat.
5. Continue until the reviewer returns **no actionable input**.

### Entry state at iteration 0

- HEAD `bfe24c1`, pushed, clean tree.
- Production `20260930173803-e87ca1e`, bundle `index-Bms_Wxds.js`, hash-matched.
- 1605/1605 tests, browser 7/7, `tsc` clean.
- Carried-in unknown: the road hint / message-feed collision is UNVERIFIED (the
  feed is `display:none` while empty, so a passing overlap check there measures an
  absent element).

## Iteration 1 — the first real review, and a 1-in-5 true-positive rate

**MODEL AVAILABILITY, measured rather than assumed.** `GET /api/v1/models`
returns **no `gemini-4` of any kind**. The task asks for "Gemini 4.0"; it does not
exist on OpenRouter. The newest Gemini the catalogue has is
`google/gemini-3.8-flash` (1M context), with `~google/gemini-pro-latest` as the
Pro tier, so both are collected per round and the substitution is written down
instead of made silently.

**THE HARNESS. `tools/shoot-e2e.mjs` plays the whole game and photographs it: 26
screens, every one reached by playing** — title, driver creation, the ignition
crank mid-animation, the constructor pristine AND built, the city, all TEN
facilities by walking in, fleet, journal, controls, the road, the trip menu, and a
real Division 5 match being fought. `shoot.mjs` boots `?screen=<name>` for eight
screens and never creates a driver, enters a building, drives or fights; this is
the difference between reviewing a set of screens and reviewing a game.

**FOUR BUGS IN THE HARNESS ITSELF, and two of my explanations were wrong.**

- **Five of the ten facilities were photographed under the WRONG name** — `arena`
  got the Garage, `federal` got the Bar, `truckstop` got Assembly — and nothing in
  the output said so. A capture of the wrong screen is worse than no capture,
  because the mistake is invisible in the artefact.
- **The dead-reckoned position ran at HALF SPEED.** A key held 484ms buys 1.07m at
  2.2 m/s; the caller credited itself the 0.5m it intended. Walks "arrived" at the
  map centre while the car was halfway across town. `stepOnce` now returns the
  distance the physics actually bought.
- **One stop radius served both legs**, and they failed in OPPOSITE directions:
  stopping 2.6m short of the centre made the next leg non-radial (`medical` opened
  the arena), while stopping 2.4m short of a doorway aim that is itself only 1.2m
  past the doorway left the player ~3.6m out — OUTSIDE the 3m trigger, so `bar`,
  `courierguild` and `federal` returned NO menu at all. Per-leg radii now: 0.4m
  and 0.9m.
- **The build was never road-legal and the caption claimed it was.** Enter does
  not mount a weapon (the row's `.sm-builder__row-cycle--inc` does), and 10 armour
  points plus a Machine Gun costs $2050 against a $2000 budget. The car had no
  weapon; the trip menu refused it four steps downstream with "not road-legal — a
  weapon", pointing at the wrong cause. The frame was captioned "armour on all
  five facings, a weapon mounted" — a claim nobody checked. Builds are now derived
  and then VERIFIED against the legality panel, one armour point at a time with
  rollback. A caption is now a measurement.

**TWO OF MY OWN HYPOTHESES WERE WRONG AND MEASUREMENT KILLED BOTH.** I blamed
tangent trigger circles; the neighbour chord is 6.00m minimum but spacing is
uneven (6.00–21.08m), and asking the sim directly showed a radial walk from the
gate triggers NOTHING. I then blamed the relay; the sim showed the relay was
always right and the time model was wrong. Both times the fix was to measure, not
to reason.

**WALK IDENTITY IS A GATE, with no hardcoded table.** Ten facilities must produce
ten DISTINCT menus — two matching means one walk landed next door, because no two
facilities serve the same rows. That catches the class without a per-facility
expectation list that would itself rot.

**THE REVIEW, TRIAGED. One finding in five was real.**

| # | Finding | Verdict |
|---|---|---|
| 1 | Vehicle schematic shifted right and truncated | **FALSE.** `overflowsRightBy: -9` AND `overflowsLeftBy: -9` — symmetric 9px margins, `scrollWidth === clientWidth`. Centred and complete. |
| 2 | Weapon shop's "Leave" missing/clipped | **FALSE.** The manifest lists 14 rows and `Leave` is row 14. The panel scrolls. |
| 3 | Controls list clipped, "no scrollbar" | **MISLEADING.** `.sm-menu-root` is already `overflow-y: auto; max-height: 80vh`; at 700px it scrolls 831px of content in a 630px panel, at 1000px it all fits. **The suggested fix was already implemented.** |
| 4 | Typo: `driverRight` should be `driveRight` | **FALSE.** `driverRight` occurs nowhere in the repo. Every site is `driveRight`. A hallucinated typo, quoted with a line number. |
| 5 | "Orientation: north-up" wraps after the hyphen | **TRUE.** Confirmed with `Range.getClientRects()`: TWO line boxes of [134px, 14px] — "up" orphaned — at every viewport (900x700 / 1280x800 / 1600x1000), because the radar panel's width is fixed in `hud-scale`. |

**THE ONE REAL FIX.** The label was 21 characters in a 154px button, so it broke at
the hyphen and left "up" alone on a line. `nowrap` alone would have overflowed, so
the label was shortened to "North-up" / "Heading-up" and the wrap made structurally
impossible; the full sentence survives as `aria-label` and `title`, so shortening
the pixels did not shorten what a screen-reader user is told. Gate:
`tools/verify-radar-orientation.mjs` asserts ONE line box and no clipping at four
viewports. Mutation-proven — restoring the long label fails all four with
[148, 134] and `clipped: true`.

**A CSS SYNTAX ERROR `tsc` CANNOT SEE.** The first version of that rule was
missing a closing brace. `tsc --noEmit` stayed green through it; only `vite build`
failed. A type checker is not a CSS checker, and a green typecheck says nothing
about a stylesheet.

- **GATE.** 1605/1605 across three parallel runs and serial; browser 7/7;
  `tsc` clean; `vite build` clean.
- **NOT ESTABLISHED.** Review batches 2 and 3 were TRUNCATED by the provider's
  image limit (6 of 11 frames, and 5 of 9). The reviewer therefore did not see
  every screen, and this round's "5 findings" is a floor, not a census. The next
  round must use smaller batches or downscaled frames for full coverage.

## Iteration 2 — round 2 of the review: 7 findings, and TWO of them real

Round 1's batches had been silently truncated (6 of 11 and 5 of 9 frames), so
round 2 re-split into five smaller batches and **reported any truncation loudly**
instead of letting a half-seen game print a confident total. All five batches ran
clean this time — full coverage of all 26 frames, 7 findings.

| # | Finding | Verdict |
|---|---|---|
| 1 | Constructor schematic clipped on the right | **FALSE, twice now.** `overflowsRightBy: -9` AND `overflowsLeftBy: -9` — symmetric margins, `scrollWidth === clientWidth`. |
| 2 | Weapon Shop "Leave" missing/clipped | **Partly real.** "Leave" IS row 14 of 14. But the menu has 14 rows and digits `1`-`0` reach 10. |
| 3 | Courier Guild has no "Leave" | **Partly real.** "Leave" IS row 15 of 15. Same digit-coverage gap. |
| 4 | Controls list clipped, no scrollbar, no Close | **Misleading.** The panel is `overflow-y:auto; max-height:80vh` and scrolls; the suggested fix already exists. But it does have no *visible* exit affordance. |
| 5 | Trip menu sits on top of the radar | **TRUE.** Its host was `left:clamp(16px,4vw,56px); bottom:clamp(20px,5vh,56px)` — exactly `.hud-panel--radar`'s corner. |
| 6 | "Orientation: north-up" wraps after the hyphen | **TRUE — and already fixed in iteration 1.** It reviewed pre-fix frames, so it independently confirms that measurement. |
| 7 | Radar player marker ignores vehicle heading | **FALSE.** Measured live: speed `0 → 12 → 24 mph` with the marker going `90° → 48.39° → 45.00°`. It tracks. `hud.css` consumes `--hud-radar-player-rot` via `rotate()`. |

**FINDINGS 2, 3 AND 4 ARE ONE FINDING, AND IT IS REAL: a menu with more rows than
the digit keys reach says nothing about it.** `1`-`9` then `0` covers ten rows —
deliberately, because labelling row 11 with `% 10` would repeat an earlier row's
own digit and fire the wrong action. But the Courier Guild serves **15 rows and
the Weapon Shop 14**, so **"Leave" is row 15 and row 14**, reachable only by
arrowing down, with no on-screen statement that arrows are needed and no visible
exit. A deliberate limit a screen never states is indistinguishable from a bug.

**THE FIX IS TO STATE THE CONSTRAINT, NOT REMOVE IT.** Every menu now renders one
hint line under its list: `↑↓ reach the remaining rows` **only** when the menu
exceeds ten rows, and `Esc — back` always. It sits outside the `<ol>` so it can
never become a selectable row or shift the digit numbering — which is the exact
bug the ten-row limit exists to prevent. Mutation-proven: moving the hint inside
the list fails the guard that names that risk.

**THE ROAD TRIP MENU IS NOW CENTRED**, matching every other modal in the game. The
bottom-left placement looked chosen to keep the road visible while paused, but the
trip FREEZES the road — there is a test named for exactly that — so there is no
moving scene to protect. **The title screen's menu host keeps its bottom-left
placement deliberately**: nothing occludes it there, it is the arcade convention,
and my first attempt at this change hit THAT host instead of the road's, because
the two shared a byte-identical style string and `replace(…, 1)` takes the first
match. Caught by re-reading the rendered frame rather than trusting the edit.

**VERDICT ON THE REVIEWER: 2 of 7 in round 2, 1 of 5 in round 1 — about a 22%
true-positive rate**, consistent with the 150-round log's documented false-finding
rate. Its *useful* output has consistently been the cases where it noticed a real
constraint the UI never states (rows past `0`, the radar collision), and its
consistent failure is geometry it reasons about wrongly (the schematic's
symmetric margins read as a right-shift, twice).

- **GATE.** 1608/1608 parallel and serial; browser 7/7; `tsc` clean; build clean.
- **NOT ESTABLISHED.** Reviewing the same 26 frames a second time can only find
  what the model sees in a still; it cannot drive the game. Three of the falsified
  findings are geometry claims that a single `getBoundingClientRect()` pair
  settles, and that is where the remaining effort should go rather than another
  round of stills.
