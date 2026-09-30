---
active: true
iteration: 1
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

## Iteration 1 — the Autoduel tribute card, an ignition switch, and one control system

**The four asks, and what each one actually turned into.**

1. **Tribute card on black at boot.** Inlined in `index.html` (the splash must
   paint before the module graph, so JS-created markup arrives too late to be the
   first thing anyone sees). Pure `#000`, monospace body in the game's own
   `--ui-ink`, and **one rule for all four lines** —
   `.sm-boot__tribute-line strong { color: #ffd23f }` — so the heading and the
   three proper nouns cannot drift apart about what "bold is yellow" means. It
   holds 2600ms, then scrolls up and out into the existing splash, which keeps
   its real progress bar throughout.
2. **The ignition switch.** The key turns a quarter turn, overshoots, settles,
   and only then is a driver built. The deferral is the feature, not decoration:
   the callback advances a screen, so firing on `click` would let a double-click
   run it twice.
3. **Every input modernised.** There were four hand-built `<input>`s, each with
   its own inline `cssText`, none with a focus ring. They now come from one
   `field()` and one stylesheet, so the driver's name and the arcade score name
   are the same box by construction.
4. **The constructor.** Sectioned (Identity / Powertrain / Armour / Weapons /
   Build) with a glyph per row, and a chevron rotated to the facing each armour
   row protects.

- **FOUR BUGS, and every one of them was invisible to a green suite.**
  - `animation: ... both` pinned the card at `opacity: 1`, and **a filled
    animation outranks a plain declaration** — so the handover class could never
    fade it. The card and the loading chrome rendered on top of each other, the
    progress bar lying across the credit. `backwards` fills only *before* an
    animation starts, which is all a staggered delay needs.
  - `dismiss()` waited `MIN_DISPLAY_MS` (1100) while the card held to 2600, so a
    warm-cache boot (~380ms) cut the credit off about one line in.
  - **The big one.** `dismiss()` also called `handOverToLoading()` "so the wait
    could never expire on a card still covering the chrome". Boot finishes in
    ~380ms, so that defensive call fired the handover immediately and cancelled
    the entire hold. A live `MutationObserver` timeline caught it where nothing
    else could — handover logged at **538ms**, while the card's own entrance was
    still running to 900ms:

        169ms  first-paint   card=0     bar=hidden  loading=false
        391ms  poll          card=0.79  bar=hidden  loading=false   <- card alone
        538ms  class-changed card=0.93  bar=VISIBLE loading=true    <- handover
       1051ms  poll          card=1.0   bar=visible  loading=true

    A guard added for a problem that could not occur, cancelling the feature it
    was guarding. After the fix, live: card alone on black from 88ms to 2798ms,
    handover at 2900ms.
  - The reduced-motion branch handed over **immediately**, reasoning that a static
    card need not be waited for. "No animation" is not "no content" — those
    players saw four lines of credit for one frame. The hold is now
    unconditional; the media query removes the motion and leaves the timing.

- **TWO MORE FOUND BY COUNTING, WHICH THE SCREENSHOTS COULD NOT SEE.**
  Every armour row drew a chevron and **two shields** (`facingIcons` returns the
  shield; the renderer appended the generic row icon as well). Three small glyphs
  in a row read as "a busy icon", not as a defect — it took counting SVGs in a
  browser. And UNDERBODY had a direction chevron, asserting a direction that does
  not exist. Both now pinned by EXACT counts, which is the version of the
  assertion the duplicate-shoulder's `toContain` would have sailed past.

- **A REDUNDANT LOCK, REMOVED AFTER A MUTATION PASSED.** The ignition carried both
  a `cranking` flag and `disabled`. Deleting the flag **passed every test**,
  because a disabled button dispatches no clicks at all — DOM-level — so the flag
  was unreachable protection sitting under a comment that called it load-bearing.
  `disabled` is now the only lock, and removing it fails two tests.

- **THE TEST SEAM THAT WAS NOT A SEAM.** Shortening the crank duration was not
  enough: `setTimeout(fn, 0)` is still a **macrotask**, so eleven boot-through
  tests were one tick early and failed. A zero duration now means no deferral at
  all, and the deferral is proven at a real 30ms.

- **THE GUARD WAS EXTENDED, NOT WEAKENED.** The undeclared-token check failed on
  `--ui-font-display`, which is genuinely declared — in `index.html`, because that
  inline `<style>` is the only thing that can style the first paint. The check now
  scans `index.html` too, since a declaration the scan cannot see is
  indistinguishable from no declaration. Verified it still bites by removing
  `--inset` from `hud.css` (fails, naming the file).
  **And a lesson about my own mutations:** the first two "undeclare a token"
  attempts both reported success and changed nothing — `--ui-accent-wash` and
  `--ui-surface-2` are each declared TWICE (dark and light themes) — and my script
  printed "MUTATION APPLIED" regardless, because the print was unconditional and
  the replace was a silent no-op. A mutation that does not mutate is worse than no
  mutation: it reports that a guard bites when nothing was tested. The third
  attempt verified the declaration was actually absent before reporting.

- **THE ICONS ARE DRAWN, NOT IMPORTED.** Hand-authored inline SVG rather than
  Font Awesome: a webfont on the critical path, `currentColor` for free theming,
  and no flat-cartoon set pasted onto a game that draws its own art. The shapes
  are **data built with `createElementNS`**, not markup assigned through
  `innerHTML` — which renders in a browser and comes back EMPTY under happy-dom,
  so every DOM test would have missed them. That also forced two honest fixes in
  `builder.test.ts`'s double: `setAttribute` now reflects `class` (real DOM does)
  and there is a `style` object (the icons write a computed `transform`).

- **GATE.** 1587/1587, three parallel runs and serial, browser 7/7, `tsc` clean,
  14 consecutive clean runs after the last change. Every new guard
  mutation-proven. Deployed `20260930170704-fde3029`, bundle `index-DBYssXqW.js`,
  whole site 200 on all four routes, served hash equals local. The tribute card
  verified **on production**: `#000` background, every bold element exactly
  `rgb(255,210,63)`, body `rgb(242,246,250)`, title face `Arial Narrow`.

- **NOT ESTABLISHED, and it is the most important line here.** One unidentified
  test failure appeared in 1 of 3 runs, and again in 1 of 3 later — both times as
  the FIRST run immediately after files changed, and neither reproduced in the 14
  clean runs after. **No output was captured either time, so the test is unknown.**
  The pattern (twice, both as the first run after a change) is suggestive of
  something about first-run state, and suggestive is not evidence. It is recorded
  as an open intermittent, not as a fixed flake.
