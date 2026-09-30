---
active: true
iteration: 0
maxIterations: 100
---

run the entire game e2e taking screenshots get advisorial reviews from gemini 4.0 on openrouter and take action on its findings making a plan, milestones,todos then execute and repeat until the reviewer has no input

## Log

Prior logs are archived, not deleted:
- `.opencode/ralph-loop.history-001-002.md` — the OpenDuel modernisation (2 rounds)
- `.opencode/ralph-loop.history-001-150.md` — 150 rounds of gameplay/art review

**Read the 150-round log before trusting any vision review.** For eighty-odd
iterations that loop handed a vision model DOWNSCALED STILLS of a live WebGPU
application, and the same false findings recurred dozens of times each: the radar
was "missing", the constructor schematic was "missing", the city wall was
"missing". All three were present at full resolution, every time. Raising capture
width from 900px to 1280px reduced the class and did not remove it, because a
still is the wrong instrument.

The corrective was `tools/review-codex.sh`, which gives the reviewer a real
browser. Captures here are full-resolution and the review prompt names the
false-finding class explicitly.

### Standing rules (carried forward, all learned expensively)

- `AGENTS.md` is mandatory. Read whole files before editing.
- Derive fixtures from production code and the ruleset — never hand-type a
  constant the code already holds.
- A passing test is not evidence. Mutation-prove every guard.
- Assert on the VALUE, never on presence.
- Locate elements by scanning, never from memory.
- Record what was NOT established.
- Measure before changing.
- Verify the served artefact, not the edited source.
- Deploy whole-site with a bundle-hash check.

### Task

1. Run the ENTIRE game end-to-end, capturing screenshots.
2. Get an advisory review from **Gemini 4.0 on OpenRouter**.
3. Triage its findings into a plan / milestones / todos.
4. Execute, deploy, and repeat.
5. Continue until the reviewer returns **no actionable input**.

### Entry state at iteration 0

- HEAD `198f6e0`, pushed, clean tree.
- Production `20260930173803-e87ca1e`, bundle `index-Bms_Wxds.js`, hash-matched.
- 1605/1605 tests, browser 7/7, `tsc` clean.
- Open unknown carried in: the road hint / message-feed collision is UNVERIFIED
  (the feed is `display:none` while empty, so a passing overlap check there
  measures an absent element).
- NOT YET CHECKED: whether `gemini-4.0` is the correct OpenRouter model id, and
  whether an OpenRouter key is configured. Verify both before planning around them.
