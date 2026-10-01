---
active: true
iteration: 3
maxIterations: 100
---

run the entire game e2e taking screenshots get advisorial reviews from gemini 4.0 on gameplay, user experience, graphics, performance, and especially does this look like the 1986 game in a modern manner modern ui input and buttons on openrouter and take action on its findings making a plan, milestones,todos then execute and repeat until the reviewer has no input

## Log

Archived, not deleted: `.opencode/ralph-loop.history-001-002.md` (OpenDuel
modernisation), `.opencode/ralph-loop.history-001-150.md` (150 rounds of
gameplay/art review), `.opencode/ralph-loop.history-003.md`,
`.opencode/ralph-loop.history-004.md` (this round).

**THE REVIEWER IS NOT GEMINI 4.0, AND CANNOT BE.** `GET /api/v1/models` on
OpenRouter returns **no `gemini-4` of any kind**. Measured, not assumed. The
newest Gemini the catalogue has is `google/gemini-3.8-flash` (1M context); the Pro
tier is reachable only as `~google/gemini-pro-latest`. Both are collected per
round.

**THE FALSE-FINDING RATE IS THE HEADLINE.** Two rounds of full review so far:
round 1 returned 5 findings, **1 real**. Round 2 returned 7, **2 real**. That is
~22%, consistent with the 150-round archive, where three present elements were
each reported "missing" dozens of times. So every finding is triaged against a
measurement before it is acted on, and the triage is recorded whether the finding
survives or not.

**WHAT THE REVIEWER IS CONSISTENTLY GOOD AT:** noticing a real *constraint the UI
never states* — rows past `0` having no digit key, a modal occluding the radar.
**WHAT IT IS CONSISTENTLY BAD AT:** geometry it reasons about wrongly. It has now
reported the constructor schematic as right-clipped in BOTH rounds, and the
measurement is symmetric: `overflowsRightBy: -9` AND `overflowsLeftBy: -9`.

### Standing rules (learned expensively, all of them)

- `AGENTS.md` is mandatory. Read whole files before editing.
- Derive fixtures from production code and the ruleset.
- A passing test is not evidence. Mutation-prove every guard.
- Assert on the VALUE, never on presence.
- Locate elements by scanning, never from memory.
- **Measure before acting on a surprising claim — including one that looks
  obvious.** Three of my own hypotheses were wrong and measurement killed all three.
- Record what was NOT established.
- Verify the served artefact, not the edited source.
- Deploy whole-site with a bundle-hash check.
- **`tsc` does not parse CSS.** A missing brace stayed green through `tsc` and was
  caught only by `vite build`.

### State at iteration 2

- HEAD `190b50a`, pushed, clean tree.
- 1608/1608 tests, browser 7/7, `tsc` and build clean.
- `tools/shoot-e2e.mjs` plays the whole game and photographs 26 screens, every
  one reached by playing. It found four bugs in ITSELF, including photographing
  five of ten facilities under the wrong name.
- **NOT YET DEPLOYED.** Production still runs `20260930173803-e87ca1e` /
  `index-Bms_Wxds.js`, which predates the iteration-1 and iteration-2 fixes.
- Round 3's review is on disk and untriaged:
  `.opencode/reviews/gemini-r3-google-gemini-3-8-flash.md`, 6 findings.
EOF
echo "state file restored" && echo "=== round 3 findings ===" && grep -E "^### [0-9]+\.|^\- \*\*What I see" .opencode/reviews/gemini-r3-google-gemini-3-8-flash.md | head -24
## Iteration 3 — the schematic was real in round 3, and I had refused it twice

Round 3: 6 findings, full coverage, no truncation.

**THE SCHEMATIC. The reviewer said it in round 1, round 2 AND round 3, and I
dismissed it twice on the strength of a measurement. The reviewer was right and
both measurements were wrong.** What was actually true, measured in screen space:

| | before | after |
|---|---|---|
| empty space, left | **161 px (31% of the panel)** | 29 px |
| overflow, right | **124 px** | 8 px |
| top / bottom | 29 / 29 | 29 / 29 |
| hull balance | L161 R103 | **L29 R29, imbalance 0** |

Cause: the rotated viewBox's x origin was `w - h` where a quarter turn about the
CENTRE requires `(w - h) / 2` — exactly twice the correct offset, pushing the car
right until it ran off the panel.

**The two wrong measurements, which are the point of this entry.** The claim is
about where the car sits INSIDE the viewBox, and both of my checks asked about
something else:

1. **The SVG ELEMENT's box against its parent's.** Symmetric, -9px on both sides,
   and completely true — and it says nothing about the viewBox contents. The
   element is sized by CSS; the drawing inside it is sized by the viewBox. I
   measured the box and called it the content.
2. **`getBBox()` against the viewBox.** `getBBox()` ignores ancestor transforms,
   and the car is drawn portrait then rotated a quarter turn, so this compared a
   118x294 portrait bbox against a 317x154 landscape viewBox and reported "57%
   empty" and content overflowing both edges — numbers so wrong they should have
   stopped me.

The measurement that settles it puts both sides in ONE coordinate system:
`getBoundingClientRect()` on the drawn children (every ancestor transform
applied) against the same call on the `<svg>`. That gave 161/(-124) with
symmetric 29/29 vertically, which located the fault to the x origin alone.

**Three consistent reports were not three coincidences.** They were one finding
surviving two refutations built on measurements that could not have detected it.
A claim that repeats identically deserves a better measurement, not a firmer
dismissal. Gate: `tools/verify-schematic-centring.mjs` measures hull BALANCE and
all-shape OVERFLOW separately — conflating them produces a gate that cannot
pass, because the nose marker is a direction indicator drawn deliberately PROUD
of the hull and is ~4% right-heavy by design. Mutation-proven: restoring `(w-h)`
fails both states and reproduces the reviewer's 161/(-124) exactly.

**THE OTHER REAL FINDING: the trip menu showed a stale place.** Its header was
hard-coded to `cityName(trip.resolved.originCityId)` — always the city you LEFT.
Pausing halfway to Albany read "New York", which says nothing about where you
are going. It now reads `New York → Albany`.

**Falsified, with the measurement recorded:**
- **The radar player marker ignores heading** (third round). Live: speed
  `0 → 12 → 24 mph` with the marker going `90° → 48.39° → 45.00°`. It tracks.
  The first probe read it frozen at 90° because the car was at a standstill and
  this sim will not steer a stationary vehicle — a probe mistake, not a bug.
- **Weapon Shop / Courier Guild omit "Leave"** — both have it (row 14 of 14,
  row 15 of 15). Their digit-key gap is real and was fixed in iteration 2.
- **Controls list clipped, no scrollbar** — the panel is `overflow-y:auto;
  max-height:80vh` and scrolls. The suggested fix already existed.

- **GATE.** 1608/1608 parallel and serial; browser 7/7; `tsc` and build clean.
- **NOT ESTABLISHED.** The remaining suggestion — the Courier Guild mixing
  informational rows ("Quick route to…", "Safe route to…") into the same flat
  list as actionable ones ("Accept: …") — is a real design observation about
  information architecture, not a measured defect. It is recorded as the next
  candidate rather than actioned blind, because a layout change to a 15-row menu
  needs its own measurement, not a reviewer's opinion.
