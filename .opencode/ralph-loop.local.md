---
active: true
iteration: 25
maxIterations: 100
sessionId: ses_f14a7ff23ffeCvOeqyAPPjegV6
---

lets do a infiniate improving loop each time ask a random state of the art vision enabled flash model (gemini 3.8 flash, latest glm, etc) to find 5 things to improve with reasons and suggestions take all feedback create milestones phases and todos. ask for feedback on all key elements of this game from an advisorial reviewer. provide them with any items they need to conduct a detailed review.  execute the plan then restart the loop with a new reviewer until you have asked all the vision enabled latest models on open router.  do not stop until i tell you to. 

## Log

Reviewers asked (25 of 82 vision models):
1. google/gemini-3.8-flash      -> title wordmark, constructor (3 bugs incl. one I missed), city motorway-through-wall
2. openai/gpt-5.4-mini         -> radar instrument, condition dashboard, player/opponent contrast, title hierarchy
3. qwen/qwen3.5-122b-a10b      -> road lane markings (carried x2), preview/menu contrast, radar rings (claim WRONG - checked)
4. deepseek/deepseek-v4.1-flash -> car silhouette, empty-feed pill + route progress bar, radar weight
5. inclusionai/ling-3.0-flash-vl -> seed printed twice (FIXED); wall/radar/constructor claims WRONG at full res
                                  -> root cause: 900px review images. Raised to 1280px.
6. z-ai/glm-5.3-flash          -> unfitted armour shown GREEN (FIXED); LEGALITY pushed off-screen by MY
                                  iteration-2 preview growth (FIXED); ground blockiness (nearest sampler, recorded)

RECURRING FALSE-FINDING CLASS: radar rings/sweep, city wall, constructor preview
reported "missing/empty" - all PRESENT at full res. Cause: review-image downscale.
Fixed at source by raising review captures 900px -> 1280px.
A first radar fix (mask-image rim ticks) corrupted CSS and stripped chrome off
every HUD panel - caught in a screenshot, reverted, redone as weight-only.

7. bytedance-seed/seed-1.6-flash -> constructor onboarding copy too quiet (FIXED, 3 steps);
                                  banner "cut off" (WRONG - reads in full)
                                  city waypoint (EXECUTED iteration 8: beacon, 2 bugs found)

8. (no new reviewer - executed iteration 7 carry) -> CITY WAYPOINT beacon
   2 invisible bugs: layer 3 has no buffer (silently dropped); PNG writer set white RGB
   on transparent px so the keyer erased the subject. Capacity guard caught the
   missing count (95 > 94) - first live catch for that check.

9. qwen/qwen3-vl-235b-a22b-thinking -> ALL FIVE CHECKED, NONE HELD UP:
     - "critical text is dark maroon #8B0000, <2:1 contrast" -> WRONG. Token is
       #ff5570; measured 6.13:1 on the panel surface. Every status colour clears
       WCAG AA (ok 10.88, damaged 10.39, critical 8.08, destroyed 6.13).
     - "'(empty)' is #333 on black, 1.5:1" -> WRONG. .sm-builder__row-value sets
       no colour, so it inherits --ui-ink (#e9eff6, ~15:1).
     - "city road is disconnected white segments" -> WRONG. That is the perimeter
       WALL (prop-citywall), a segmented barrier, verified at full res.
     - "radar sweep and blips identical dark green" -> the practice arena has no
       contacts at all (correct); contacts use --ui-ink, not the sweep colour.
     - "menu box merges with the backdrop" -> it has a cyan border and the
       selected row is a bright accent fill over glass.
     This review estimated colours and contrast ratios instead of measuring
     them. Recorded, not acted on: the loop's value includes knowing when NOT
     to change things.

10. qwen/qwen3-vl-8b-instruct -> REAL: my "— not fitted" label wrapped to 2 lines in
     the 2-col grid and misaligned the rows (FIXED: label shortened to a dash,
     full meaning moved to aria-label). Rest: radar sweep (5th false report),
     road bar overlap, constructor selected-row indicator (all present).
     NOTE: first pick from a re-filtered pool - content-safety/classifier models
     were excluded; they answer safety questions, not design ones.

11. google/gemini-3.1-flash-lite-preview -> 2 REAL, both critiques of MY work:
     - beacon read as "oversized disconnected cyan arrow floating above the car",
       "jarring ... makes the objective feel like a UI overlay" (FIXED: smaller, sits
       low and close to the gate so it reads as a sign AT the building)
     - preview "lacks orientation markers on the actual chassis"; on a PRISTINE
       build no armour marks were drawn at all, so nothing showed where
       "Armor: Front" lives (FIXED: dashed ZONE outline always drawn, fill only
       where points were bought)
     This is the first reviewer in two rounds to score above zero, and both finds
     were regressions or mis-sjudgements of my own earlier iterations.

12. bytedance-seed/seed-2.0-code -> 1 REAL: tagline ~10-13px, too small to read at
     a glance (FIXED: 13-16px, brighter; hierarchy held by RELATIVE size against
     the 40-76px wordmark, not by making the tagline tiny - iteration 3 had
     overshot when it shrank the tagline to fix "three competing layers").
     Checked and FALSE: condition-panel section spacing (ARMOUR/TYRES/PLANT have
     rules and gaps), constructor row cramping (rows have clear rhythm).
     Radar sweep: 6th false report.

13. qwen/qwen3.6-35b-a3b -> 2 REAL:
     - speedometer secondary text (TIER/0.0 mi) tiny+dim (FIXED: one step larger,
       off the dimmest ink 4.61:1 -> 8.83:1, still subordinate to the speed figure)
     - "preview is just a blue rounded rectangle with a dotted line" -> claim
       WRONG at full res (wheels/cabin/bonnet/zones/nose all present) but the
       PERCEPTION was the finding: every part was a similar blue on a similar
       alpha so nothing separated. FIXED by darkening the hull so the parts
       contrast, rather than by adding more parts.
       THIS IS THE LOOP'S KEY LESSON, now twice: when a reviewer says a thing is
       absent, check at full res; when the check says present and they still
       could not see it, believe them about CONTRAST.
     Radar sweep: 7th false report.

14. qwen/qwen3.8-omni-flash -> 1 BIG REAL: MAGENTA FRINGE on every vehicle.
     "stray magenta mount tabs ... they look like debug hitboxes" - CONFIRMED, the
     most visible defect in the game. Root cause was NOT the keyer: chromaKey
     sets alpha=0 but leaves RGB at the key colour, and the per-kind ~10x
     downscale resamples NON-PREMULTIPLIED RGBA, so transparent magenta bleeds
     into every edge AFTER despill runs. Fix: zero RGB of near-invisible pixels
     before the resize. 4.12% -> 0.00% magenta on all three cars. Also widened
     despill to strong-cast opaque pixels (test updated to the new contract).
     Other findings: title-art palette mismatch, city street network, constructor
     row->diagram linking (all real, queued).

15. qwen/qwen3.5-flash-02-23 -> 2 REAL, 1 the sharpest UX criticism in the loop:
     - "The text 'CONFIRM' at the bottom left is styled identically to the
       adjacent stat labels (dim white text). It lacks any button treatment
       (border, background, highlight) and is easily mistaken for passive
       information ... players may hesitate or quit because the primary
       call-to-action is invisible." TRUE and the best of its kind: every other
       row on that pane is a VALUE and CONFIRM is the only thing the player can
       DO, yet it was rendered as another data row. It now carries the button
       treatment with --ui-accent used nowhere else in the pane, so the single
       saturated surface on the screen is the thing the screen exists to do.
     - tagline "extremely thin font weight ... loses definition" (FIXED: weight
       500 + tighter shadow. Size was fixed in iteration 12; WEIGHT is a
       separate lever and was never touched.)
     FALSE: "the player's vehicle sprite sits perfectly flat ... with no shadow
     or contact occlusion" - the car has a directional shadow in the shader and
     has had one since iteration 1. Radar: 8th false report.
     TOOLING (2 real fixes the failure exposed):
     - picked google/gemini-2.5-pro and got an EMPTY body with no error; the
       tool recorded nothing that would explain it. finish_reason is now saved
       so 'content_filter' is distinguishable from a harness bug.
     - this model burned 9000 tokens on preamble and was cut off mid-JSON, twice.
       max_tokens -> 16000 and the prompt now demands the reply START with "[".
     - the model picker also returned google/gemini-3-pro-image-preview, an
       image GENERATION model, because the exclusion pattern was `-image$` and
       that id ends in -preview. The pattern now matches the substring anywhere.

16. qwen/qwen3.5-plus-02-15 -> 1 REAL (the long-standing city-cohesion item):
     - "The building sprites appear to be photographic cutouts with varying
       lighting directions and perspectives, clashing with the flat, stylized
       car and map. It makes the world look like a collage of unrelated
       assets." CONFIRMED at full res - the buildings really were mixed-source
       art each carrying its own colour identity, scattered on a cool grey map.
       A multiply TINT cannot fix this: multiplying by a colour only darkens and
       shifts hue, and the mismatched SATURATION is exactly what survives. So
       there is now a real GRADED fragment path (SPRITE_KIND 3): desaturate,
       then pull toward the ground's cool slate AT THE SAME LUMINANCE, keeping
       each building's own light-to-dark modelling. Actors, the waypoint beacon
       and doormarkers stay ungraded so the orange car still reads as the focal
       point. 2 new tests pin the kind routing and the overloaded-slot packing.
     FALSE: "schematic lines very low contrast" - at full res the chassis is
       bright cyan on navy, which is the fix iteration 13 made. Perception class.
     Recorded: dashes on unfitted armour read as null data (a pristine build has
       no armour, so a dash is correct - an explicit caption would be clearer);
       the condition panel occupies road real estate (deliberate HUD choice).

TOOLING - the review harness got audited by its own failure this round:
     - the iteration-15 picker fix had been applied in an AD-HOC shell snippet,
       not in tools/review.mjs, so two copies of the filter already existed and
       had drifted. The filter now lives in ONE exported function that both
       --list and --pick call, and the tool marks what has been asked.
     - --pick's "already asked" set is parsed from the loop log, and the
       function THROWS if it cannot parse any ids. It shipped briefly as a
       try/catch returning [] around an unimported readFileSync, which reported
       "0 models asked" as if it were fact - the picker would then re-ask used
       models forever while looking perfectly healthy. The only safe response to
       "I do not know what has been asked" is to stop.
     - 75 models in the pool, 61 not yet asked.

17. qwen/qwen3.6-plus -> 2 REAL, one of them a REGRESSION I caused last round:
     - "The gray building sprites lack drop shadows or distinct outlines against
       the similar-toned blue-gray ground, making them look flat and hard to
       distinguish as obstacles." TRUE, and it is the bill for iteration 16: the
       grade fixed colour cohesion by pulling the buildings toward the ground's
       slate, and in doing so spent the VALUE separation the collage used to
       have. Measured on the real frame, the building/ground luminance gap was
       20 on one building and 4 on another - separation that depended on
       whatever value a given piece of source art happened to carry. Fixed at
       the source rather than per-asset: the contact shadow was already there
       but soft (0.8) and faint (0.42), so it never registered. Tightened to
       0.3/0.62 so EVERY building gets a consistent dark contact and legibility
       stops riding on the art. Grade tone 0.42 -> 0.5.
       THE LESSON: a visual fix that trades one axis for another will be caught
       by the NEXT reviewer. Grade cohesion, then re-measure separation - do
       not assume the two are independent.
     - "ten rows of text saying (empty) looks like a debug console or
       spreadsheet." Real, but the rows are ADDRESSED BY INDEX (selection is an
       index into the same array, and the hint tells the player to type 0-9), so
       collapsing them would break selection and mounting. Fixed without moving
       a row: a section edge above Weapon 1 makes the block read as one loadout
       with CAPACITY, and unfilled values now recede in dim italic so fitted
       weapons are what the eye lands on.
     FALSE: radar low contrast (9th report on the same element); logo kerning
       (the wordmark is uniform tracking); preview disconnected from the car
       (the schematic is the vehicle - zones, wheels, dimensions all shown).

18. qwen/qwen3.8-flash -> 2 REAL, both the biggest single-screen wins yet:
     - "The paved road and the off-road ground use the EXACT SAME mottled grey
       pixel-noise texture and the same brightness. The only thing separating
       drivable from not-drivable is two thin solid white lines ... at speed the
       player cannot pre-read the lane or the shoulder." TRUE, and measured: the
       two were 5.4 luma apart out of 255, and 5 luma is not a material, it is
       noise. Root cause was structural, not artistic - the road was ONE untinted
       ground quad, so the highway and the verge were LITERALLY the same surface
       and the paint was doing 100% of the work. groundQuad now takes a per-axis
       half-extent and a rotation, so the drivable surface is a rotated strip laid
       over the verge, with its own darker grade and a finer grain, plus a
       shoulder of verge tone either side of the paint. Now 81.5 vs 101.5 - a 20
       point gap, and in the honest direction (dark asphalt on pale ground).
     - "The banner mixes permanent status with ... a long run-on control string"
       and asks for "a transient tutorial hint that fades out". TRUE. 'WASD/
       arrows drive' was welded into a status line that is reassigned EVERY FRAME,
       so a control reminder the player learned in the first ten seconds sat in
       the middle of the objective for the whole run. It is now its own element
       that fades out once and stays gone (fill-mode forwards, or it would snap
       back - the same trap the scroll-driven entrance animations hit).
       It could NOT be a child of the status div: that element's textContent is
       rewritten every frame, so the hint would be destroyed and rebuilt ~60x a
       second and the fade would never run. Caught in a screenshot that it
       overlapped the progress bar, and moved clear of its 44..52px band.
     FALSE: "the car has no ground shadow" (3rd report; it has one, plainly
       visible); radar contrast (10th on the same element); CONFIRM clipped by the
       help line (both read cleanly at full res).
     Recorded: buildings still do not read as ENTERABLE (chevrons are small and
       static, interior ground matches exterior) - the next real city item.

19. bytedance-seed/seed-1.6 -> 2 REAL, one of them debug data in the UI:
     - "An unprompted debug-style text block ($9 | 2030-01-01 (DAY) - smduel) is
       placed over the primary menu ... makes the game look unfinished and
       confuses players about whether the text is intended UI or a glitch."
       CONFIRMED. The title screen has no run in progress, so it was printing a
       session header describing a session that does not exist: a $9 starting
       balance and a day-zero date. It read as a debug readout because that is
       effectively what it was. The menu header is now opt-out and the title
       hides it; the in-run menus keep it, where it is real status.
     - "Tiny yellow markers fail to contrast against the cracked gray terrain and
       lack visual weight." CONFIRMED - and this is the item iteration 18
       RECORDED for next, so two reviewers now agree on it independently.
       Entrance markers enlarged 50% (1.4x1.31m -> 2.1x1.97m). Deliberately left
       ungraded, the one prop that must stay saturated because it IS the
       objective.
     FALSE: radar has no sweep (11th report on the same element); replace
       (empty) with "Press Enter to Mount" (Enter is CONFIRM, not mount -
       mounting is done by typing a digit, so this would teach the wrong verb);
       red x is ambiguous (marginal, the x is labelled).
     THE GUARD CAUGHT A SECOND CONTRACT VIOLATION - second live catch for the
     instance-capacity check, after the invisible beacon in iteration 8. I also
     gave every doormarker a contact shadow (10 more instances). The city actor
     buffer is sized from cityInstanceCount(), which is EXACT: 95/95. Ten extra
     shadows pushed it to 105 and writeInstanceBuffer rejected the write, which
     renders the whole city screen BLANK rather than dropping the overflow. So
     the shadow - which was MY embellishment, not the reviewer's ask - is what
     went, and the enlargement stayed. cityInstanceCount() is the single contract
     for city prop instances; it already carries a comment about the first
     violation and the count is the thing to update when adding props.

20. qwen/qwen3.7-plus -> 2 REAL, both long-standing, one of them caught by a
     reviewer looking at a fix that had ALREADY shipped:
     - "Tiny yellow arrows that blend into the grey, cracked ground texture ...
       they lack visual weight." This was the THIRD report on the entrance
       markers and it was looking at the 50% enlargement from iteration 19. That
       is the useful part: a reviewer who has already seen the fix and still
       cannot find the thing is telling you the NUMBER was too small, not that
       the report was wrong. The loop lesson (believe them about weight and
       contrast) applied to a fix I had just made. Doubled overall, 1.4m ->
       2.8m. A size change costs no instances, so unlike the iteration-19 shadow
       attempt it fits the exactly-full city buffer without touching the contract.
     - "The menu box is a simple rectangle with a thin cyan border and plain text
       ... looks like a default HTML form or a debug overlay." THIRD report of
       this too. The selected-ROW treatment had been fixed long ago (accent wash
       plus a 3px edge), which is why the surviving complaint is about the PANEL:
       the fill was 78-80% glass, so the title art showed straight through a 1px
       outline and the whole thing read as a wireframe rectangle drawn on the
       picture. The surface now carries the weight - near-opaque body, a
       top-lit inner highlight for surface direction, stronger edge. Deliberately
       no size or padding change: a real-Chrome test pins menu item height at
       390x664, so this is a colour-weight fix only. Ran the browser gate
       (SMDUEL_TEST_BROWSER=1) rather than assuming it was unaffected.
     FALSE: radar (12th report on the same element); schematic is a "generic blue
       rounded rectangle" bearing no resemblance to the car (the schematic IS the
       vehicle and shows armour zones the sprite cannot; iteration 13 raised its
       contrast and this is the same class of claim, now for the third time -
       the remaining honest ask is tying it to the player's colour, queued);
       convert the weapon list to a 2-column grid (rows are index-addressed, and
       iteration 17 already applied the lighter fix that does not move a row).

21. bytedance-seed/seed-2-1-turbo -> 1 REAL, 1 FALSE, 1 built-and-measured-then-declined:
     - "All five armor facings show only -- with no numeric value, bar, or status
       indicator, unlike Tyres and Plant which use a dot + fraction format ... the
       section looks broken or unimplemented." REAL, and the THIRD report on this
       item. Every previous answer was "a dash is semantically correct" - and it
       is, which is exactly why the complaint never went away: a bare faint dash is
       correct AND unreadable, and the previous treatment made it WORSE by dimming
       it to 0.72 opacity on already-dim ink, so the empty value receded into the
       panel and the block read as an area that failed to render. The fix is to
       make the empty state LOUDER, not quieter: the dash now sits in a dashed
       chip at full opacity, so it is visibly a slot with nothing in it. Still
       not a number - "0 / 0" is a fraction of nothing, and a green dot on a zero
       is the exact bug this state exists to prevent. Built as ELEMENTS, not a
       markup string, because el() sets text through setText and a "<span>"
       string would have rendered as literal tag characters.
     - "The section header bar is vertically undersized so its text is partially
       clipped." FALSE - there is no header bar. What it found is the section
       RULE added in iteration 17 above Weapon 1, which renders as a thin
       horizontal line with no text in it and nothing clipped. First false report
       of this class (a described element that does not exist).
     - "The arena has no boundaries or spatial reference." Built three variants
       and MEASURED each rather than shipping the first plausible one:
         1. perimeter wall / barriers - declined without building; the arena is an
            unbounded field with no collision, so a painted wall lies and
            non-colliding props are things the player drives through;
         2. a ring at the REAL spawnRingRadiusM (45m) - honest but the camera
            shows ~24m, so it changed 0.54% of the frame;
         3. a 10m dotted circle + radial ticks - VISIBLE, and still wrong twice:
            world-fixed it was nearly off screen again (the player spawns away
            from the origin), and player-centred it travelled with the car, which
            destroys the whole point of a reference (a reference that moves with
            you says nothing about your motion).
       SHIPPED NONE. The arena already has world-fixed reference: the ground
       tiles by fract(worldPos), so its slab-joint lattice is anchored to the
       world. The real fix is a gameplay change - arena bounds with collision,
       or props that genuinely block - and faking either in the render layer to
       make a screenshot look finished is the wrong trade.
       WORTH RECORDING AS A PROCESS FAILURE: variant 3 first rendered ZERO
       pixels, and every check stayed green. The cause was that I wired the call
       into showArenaEvent while the capture is showArena - a real call, in the
       wrong function. Found only by diffing the frame against the baseline and
       noticing the pixel count was IDENTICAL to the unrelated armour-chip change.
     FALSE: radar (13th report on the same element); the tagline contrast, which
       already carries a two-layer shadow from iteration 15.

22. openai/o4-mini -> 1 REAL (the truncation that made a real feature look like a
     log line), 1 measured-and-already-satisfied, 3 FALSE:
     - "The instruction bars use small, light grey text ... long lines are
       truncated with an ellipsis, making controls and status messages
       unreadable." TRUE, and the cause is more specific than the review knew.
       The arena banner was ONE element carrying a mode label, three control
       hints and the session seed inside a max-width, so it rendered as
       "Practice arena - WASD/arrows drive, Space/J fire, Q/E cycle weapon. Seed
       a11ce5ee...". THE TRUNCATION IS WHAT MADE THE SEED LOOK LIKE DEBUG
       NOISE: a hash cut off mid-string reads as a log line, a complete labelled
       one reads as a feature. The seed is genuinely useful - it is what makes a
       practice run reproducible - so it is KEPT and given its own element that
       cannot ellipsize, rather than deleted the way iteration 19 deleted the
       title's phantom session header. Controls became a fading hint on the same
       keyframes as the road's, and the status line now says only what stays true.
       Positioned by screenshot twice: top-left collided with WEAPONS, top-right
       hid it behind CONDITION, so it tucks under WEAPONS.
     - "The progress bar fill is nearly the same shade as the track, making
       progress almost imperceptible." MEASURED FALSE. The fill is a teal-to-blue
       gradient (#4fd6c4 -> #63a8ff) on a near-black track, about 9:1, and the bar
       is already 8px - the review asked for "at least 8px". What it is seeing is
       scaleX(0) at the start of a 150-mile route: an empty bar is the honest
       report of 0 miles driven, and the miles are in the objective line one row
       above. A duplicate percentage readout would be the same clutter the
       drive-hint fix just removed.
     FALSE: radar (14th report on the same element); the selected menu row is
       ambiguous (it has an accent wash plus a 3px edge, and iteration 20
       strengthened the panel around it); the constructor is unstructured (it has
       a section edge, a distinct CONFIRM button, and a loadout group heading).

23. qwen/qwen3-vl-30b-a3b-instruct -> 1 REAL, and 4 that measurement contradicts:
     - "The LEGALITY section contains text that is small, unformatted, and
       blends into the background, with no clear visual separation." HALF TRUE,
       and the half that is wrong is the half the review led with. The panel has
       a border, a 3px accent left edge, a tinted background and a rule above it
       - it already has clear separation, and I did not add any. What was true is
       "small", and it was true in a way the review misdiagnosed: measured, the
       prompt line is 15.06:1 and the step list 7.79:1 on the panel, so nothing
       was blending. The problem was WEIGHT - the three steps are the entire
       onboarding and the only instruction the screen gives before the player
       touches anything, and they were set a size AND a colour step BELOW the
       summary line above them. The most important text was the quietest. Steps
       up one size and to full ink, still subordinate by size and weight. Same
       lesson as iteration 13: when the check says the contrast is fine and they
       still could not see it, believe them about WEIGHT.
     FALSE: "UI text and icons lack sufficient contrast and edge definition"
       (all screens) - the same misdiagnosis applied globally, on no measurement;
     - "the mission text is white on a dark textured background with low
       contrast" - it sits in an opaque pill, and every status colour in the UI
       was measured in iteration 9 at 6.13:1 or better;
     - "all buildings and icons are rendered at the same visual weight"
       (city) - the reviewer's own suggested fix is to "add color highlights ...
       (yellow for objectives, blue for buildings)", which is the collage
       problem iteration 16 spent a whole iteration UNDOING. Buildings are
       deliberately desaturated and tone-pulled to the ground's slate; measured
       mean saturation across the city is 0.096, which is the fix working.
       Restoring per-building colour would reverse it.
     Radar: 15th report on the same element. This model class (a 30B instruct VL)
       reports it in nearly every review, which is itself worth recording: the
       radar sweep, rings, crosshair and player marker have all been verified
       present at full resolution in 15 separate passes.

24. qwen/qwen3.5-27b -> 1 HALF-TRUE (fixed), 4 FALSE, one of which measurement
     directly contradicts:
     - "The top-centre text uses white text against a semi-transparent black
       background over the moving asphalt ... the transparency allows the road
       noise to bleed into the text area." Half a measurement, and the honest half
       is the part the review did not make. Composited against the measured road
       luma of 93.5, the 0.7-alpha pill lands at rgb(35,38,42) and #d7e0ea on it
       is 11.40:1 - already well past AA, so "insufficient contrast" is not
       what was wrong. But 0.7 was chosen to let the scene show through, and on
       this screen the scene under the pill is a MOVING HIGH-FREQUENCY asphalt
       texture: a ratio computed on the average pixel says nothing about the
       brightest aggregate that scrolls under the glyphs at speed. Pill to 0.86
       (13.20:1), still visibly transparent. This is the same shape as iteration
       9 and 23 - the claim is wrong, the perception is real, and the fix is the
       smaller one the perception implies.
     - "The arena floor ... looks identical to the Road and City textures ...
       players cannot distinguish the practice arena from the open world."
       MEASURED FALSE, and by a wide margin. Ground luma: arena 144, road 58,
       city 101. Mean saturation: arena 0.030, road 0.058, city 0.068. Pairwise
       difference of the ground region: arena-vs-road 87.9, arena-vs-city 42.9,
       road-vs-city 49.8. The three floors are the three most different things
       in the game, not the same thing. The arena is also the BRIGHTEST screen
       in the game by 48 luma over the next, and its suggested fix (an industrial
       grey or rust tint) would move it TOWARD the city it is being confused with.
     - "The radar is a static dark circle with a faint green sweep" - 16th report
       on the same element.
     - "The vehicle preview is a flat glowing blue wireframe while the rest of
       the game uses textured pixel art ... render the preview using the same
       textured assets used in gameplay." FOURTH report of this class. Declined
       again, and the reason is now worth stating once and for all: the
       schematic exists to show ARMOUR ZONES - where on the chassis the points you
       buy land - which is information the gameplay sprite physically cannot
       carry, because it is a top-down car and armour placement is a build-time
       abstraction. Replacing it with the sprite would delete the only thing the
       constructor is uniquely for. Iteration 11 and 13 both independently
       demanded the zone outline be visible, and it is.
     - "Interactive buildings ... are small grey squares that blend into the
       cracked pavement." This is the collage fix from iteration 16 again, from
       the opposite direction: the review wants the buildings to stop being grey,
       and iteration 16 spent an iteration making them grey ON PURPOSE so they
       read as one environment instead of a collage. Markers were enlarged twice
       (iterations 19 and 20) and are now the most saturated thing on the map.

25. openai/o4-mini-high -> 1 REAL (4th ask, reframed correctly), 4 FALSE:
     - "Each armor slot is depicted as an empty dashed box with no fill or
       values, making it look like a placeholder ... replace with filled
       horizontal bars scaled to current vs max." The FRAMING was wrong and the
       ASK was right, and that combination is worth separating. The framing: on a
       PRISTINE build every facing genuinely is unfitted, so a dashed box is the
       honest rendering - the review was describing iteration 21s fix as a missing
       feature, four reviews running. The ask: a bars LENGTH is the pre-attentive
       read that four numbers in a 2-column grid cannot give under pressure, and a
       damaged car is the case that matters in a combat arena. So fitted facings
       now carry a bar scaled to current/max, coloured by CURRENTCOLOR so the bar
       and the number can never disagree about health, and guarded against a
       zero/negative/over-max ratio (a NaN scaleX collapses the whole row, not just
       the bar - caught by writing the test before trusting it). Unfitted facings
       still get the chip, because a zero-length bar is 0/0 in a different
       costume. 2 tests: exact scales, and the clamp.
       WORTH RECORDING: the first test run produced FOUR NaN scales and the guard
       I had written was on the wrong side of the divide. The test fixture used
       lowercase facing keys while FACING_ORDER is UPPERCASE, so current was
       undefined and the clamp correctly turned NaN into 0 - the guard worked and
       the FIXTURE was wrong. Found it by printing the attributes, not by
       re-reading the guard.
     FALSE: "the selected menu item is indicated only by a 1px neon outline with
       no fill" - measured 34.26 vs 28.86 luma for selected vs unselected, and
       the row carries an accent wash plus a 3px left edge. This is the FOURTH
       report of this class on the title menu (iterations 16, 20, 22, 25) and the
       first that has never looked at the actual rendered row;
     - "the tagline has no outline or drop shadow" - it carries a two-layer
       shadow from iteration 15, and the band measures 9.10:1 against the
       brightest adjacent background (67.5 luma) and 10.99:1 against mid. The
       claim of NO shadow is simply false about the stylesheet;
     - "all rows are identical in weight and the editable row has no distinct
       background or cursor indicator" - the selected Name row has an accent wash,
       a border and a 3px left edge, verified in the frame;
     - radar, and its "Orientation: north-up" label being too small: 17th report
       on the same element.

DEFERRED (real, documented, not bugs):
- Ground blockiness: NEAREST sampler is REQUIRED (no atlas gutters, linear would
  bleed). Real fix = dedicated linear+repeat ground texture (load-time change).
- City daylight grade (my 0.6 ground tint is why it reads dim), street network,
  title-menu composition, 10 empty weapon rows.

Tooling: `node tools/review.mjs --list | --model <id> --shots <dir>`
Reviews: .opencode/reviews/