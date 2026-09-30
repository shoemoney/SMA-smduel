---
active: true
iteration: 0
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
