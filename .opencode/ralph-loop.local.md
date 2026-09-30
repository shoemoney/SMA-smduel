---
active: true
iteration: 0
maxIterations: 100
---

 At the load of the game id like to display prompinatly against a blackbcakground.  Use a styled white font with the style of the game the words in Bold should be yellow.  You can have it scroll out then load the loading screen or fade our whatever you think looks best.

Inspired by a Childhood Classic
This game is a modern reimagining of Autoduel (1985).
Original game by Origin Systems, designed by Chuckles and Lord
British.
Thank you for the memories.


Another thing:

I really want to modernize this game.  At the first screen modernize that text input with a nicely styled button to the theme of the game maybe a start button like an ignition switch when click turns over and a car starts.

Really all input boxes need to be modernized.   Use icons and styled autoduel like fonts. You can use font awesome or assets from ~/gameassets.  

The place you improve your car armor and all the things please make them look good graphically and modern with icons and sections that are contextually accurate 

## Log

The previous 150-iteration improvement log is archived, not deleted, at
`.opencode/ralph-loop.history-001-150.md` (10,131 lines). Read it before
changing anything: it records which findings were false, which "fixes" were
reverted, and why. It is the reason this repo has working regression gates.

### Standing rules carried over from that log

- `AGENTS.md` is mandatory. Read whole files before editing. Derive fixtures
  from production helpers and the ruleset — never a hand-typed constant the
  code already holds.
- A test that passes is not evidence. Mutation-prove every new guard: change
  the code it guards, confirm the RIGHT test fails, then put it back.
- Assert on the VALUE, never on presence. A healthy-looking signal standing in
  for a fact is this repo's most repeated failure.
- Locate an element by scanning for it, never by remembering where it was.
  Three confident wrong measurements in the old log came from stale knowledge.
- Record what was NOT established. Partial checks and unreproduced flakes are
  worth more than a clean summary.
- Measure before changing. A design call with measured costs on both sides is a
  decision, not a defect.
- Verify the artefact the user sees, not the source edited: grep source, then
  the built assets, then the bundle the server actually serves.
- Deploy whole-site with a bundle-hash check. A 200 response is not proof the
  right build is live.

### Task (iteration 0)

1. **Title/loading screen.** Display prominently against a black background:
   - "Inspired by a Childhood Classic" (bold yellow)
   - "This game is a modern reimagining of Autoduel (1985)." (white)
   - "Original game by Origin Systems, designed by Chuckles and Lord British." (white)
   - "Thank you for the memories." (white)
   Styled white font in the game's own style, bold words yellow. Animate it out
   (scroll or fade) into the loading screen — best judgement encouraged.
2. **First screen inputs.** Modernise the text input with a themed button: an
   ignition switch that turns over and starts a car when clicked.
3. **All input boxes.** Modernised, with icons and Autoduel-styled fonts. Font
   Awesome or assets from `~/gameassets` are available.
4. **Car improvement screen.** Armour and everything else: graphically modern,
   with icons and contextually accurate sections.

### Entry state at iteration 0

- HEAD `38848aa`, pushed. Full suite 1559/1559, browser 7/7, tsc clean.
- Production release `20260930152221-40b2656`, bundle `index-BlROl5Lt.js`.
- **Open unknown carried in:** one unidentified test failure in 1 of 4 runs at
  iteration 151, never reproduced in 14 subsequent runs. Name unknown; treat as
  a live flake, not a fixed one.
- **Unverified from iteration 151:** whether the ROAD's hardcoded `top:88px`
  hint collides with the road message feed. The feed is `display:none` while
  empty and 9s of driving did not trigger a contact notice. Probe prints
  UNVERIFIED rather than "0 overlaps".
