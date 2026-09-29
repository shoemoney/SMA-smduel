---
active: true
iteration: 55
maxIterations: 100
sessionId: ses_f14a7ff23ffeCvOeqyAPPjegV6
---

lets do a infiniate improving loop each time ask a random state of the art vision enabled flash model (gemini 3.8 flash, latest glm, etc) to find 5 things to improve with reasons and suggestions take all feedback create milestones phases and todos. ask for feedback on all key elements of this game from an advisorial reviewer. provide them with any items they need to conduct a detailed review.  execute the plan then restart the loop with a new reviewer until you have asked all the vision enabled latest models on open router.  do not stop until i tell you to. 

## Log

Reviewers asked (55 of 82 vision models):
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

26. mistralai/ministral-14b-2512 -> ZERO REAL. All five checked and measured;
     nothing changed. Recording it because a zero is a result, not a non-event:
         - "Speedometer black text on a dark gray background is illegible."
           INVERTED, not merely wrong. Measured: panel 85.16, glyph maxima 238.2,
           and #e9eff6 on the measured panel is 10.25:1. The text is the LIGHTEST
           thing in the frame. A reviewer that cannot tell white from black on a
           readout has not read the readout;
         - "The preview lacks clear visual indicators for armour placement or
           weapon mounting slots." FIFTH report of this class, and at full res
           the crop shows a bright cyan hull, a dashed ZONE outline, two zone
           boxes (one filled, one outlined), a nose marker and the dimension
           line. Iterations 11 and 13 each independently demanded these;
         - "The New Driver button lacks visual emphasis compared to Controls."
           FIFTH report of this class on the title menu. Measured 34.26 vs 28.86
           luma selected-vs-unselected, plus the accent wash and 3px edge;
         - "Yellow arrows are too small ... increase by 50%." This reviewer is
           looking at markers ALREADY DOUBLED in iteration 20, and the crop shows
           them saturated at max_sat 1.0, unmistakably the most colourful thing
           on the map. Second reviewer in a row to ask for a further 50% on top of
           a doubling, which is the clearest signal yet that this specific ask has
           saturated - the marks are now large enough that a 14B model can find
           them instantly and still describe them as too small;
         - radar: 18th report on the same element.
     NO CODE CHANGED THIS ITERATION. The 26th review in a row is the first to
     return nothing actionable, and the value of recording that is the same as
     the value of recording a fix: it is the evidence that the loop has actually
     moved the floor rather than endlessly re-raising the same five complaints.

27. qwen/qwen3.6-27b -> 1 BIG REAL (the title art, finally), 3 FALSE that
     measurement contradicts, 1 marginal:
     - "The background render is heavily crushed, muddy and desaturated ... the
       foreground vehicles are merely silhouettes and the background city is lost
       in the gloom ... use a lighter, cleaner vignette overlay so the cars
       remain the focal point." REAL, and the cause was a single number nobody
       had questioned in 27 iterations: the title art has sat under a
       linear-gradient(rgba(5,7,10,0.55), rgba(5,7,10,0.82)) scrim since it
       shipped, so by the bottom of the frame only 18% of the art survived. The
       reviewer asked for a lighter overlay and was right.
       The obvious fix was WRONG and measurement caught it: a flat 0.40 -> 0.66
       ramp lifted the art but dropped the tagline from 9.10:1 to 5.56:1 against
       the brightest background adjacent to it. The scrim exists to make the
       wordmark and tagline legible; lightening it globally trades away the only
       job it has.
       So the scrim became a BAND instead of a ramp - 0.34 at the top and bottom
       where the vehicles actually are, 0.72 at 42% which is the wordmark/tagline
       band. Result, measured on the real frame: vehicle art 33.41 -> 63.65 luma
       (91% brighter, and the skyline and cracked ground are now visible at all),
       and the tagline IMPROVED to 9.48:1 from 9.10:1. Both axes at once, which
       is the whole reason to measure instead of adjusting a number until a
       screenshot looks nicer.
       THE LONGEST-RUNNING DEFERRED ITEM IN THE LOG, now closed: "title-art
       palette mismatch", carried since iteration 14.
     - "The buildings, the road, and the cracked ground share the EXACT same
       brightness value and colour." FALSE. Measured: building 119.8 vs ground
       102.2 (gap 17.6), second building 110.3 vs ground 102.4 (gap 7.9). The
       suggestion - "darken the ground and significantly brighten the building
       materials" - would reverse iterations 16 and 17 outright, one of which
       built the grade and the other rebuilt the separation it cost.
     - "The asphalt blends too closely with the off-road pavement ... very little
       vertical contrast." FALSE, and it is describing the fix from iteration 18
       as a defect: measured 81.55 asphalt vs 101.46 verge, a gap of 19.9 where
       it was 5.4 before that iteration. The suggested fix ("darken the asphalt",
       "brighten the lane markers") would push a surface that is ALREADY 20
       points darker than its neighbour further from it.
     - "The arena floor is a flat beige noise texture ... it feels like an empty
       dirt patch or a missing texture." FALSE: arena ground measures 144 luma
       against 58 for the road and 101 for the city - it is the BRIGHTEST floor
       in the game by 43, and it carries a world-fixed slab lattice. This is the
       third arena-floor claim contradicted by the same measurement.
     - "The component list is incredibly dense ... thin, small grey text."
       Partly addressed in iteration 17 (section edge, dim-italic unfilled rows);
       the remaining ask is a bolder weight, which would fight the value/name
       column alignment the 0-9 typing depends on. Recorded, not changed.

28. deepseek/deepseek-v4-flash-vision-exp -> 1 REAL (a genuine consistency gap,
     fixed with LESS than asked and for a reason), 4 FALSE:
     - "The city screen shows no condition panel, radar, or speedometer, unlike
       the road and arena screens ... the player is still driving in the city, so
       the absence of critical car status creates an inconsistent UI." The
       INCONSISTENCY is real and the fix is deliberately NOT the full HUD.
       CityRunState.vehicle is right there and the render simply ignored it, but
       the city has no speed in its player state, no contacts, no weapon
       selection and no damage source. A condition panel mounted there would draw
       armour and tyre bars that can NEVER move - a static decoration dressed as
       a live instrument, which is the same trade refused in iteration 21
       (painting walls that do not exist) and iteration 24 (a road line that was
       already correct). A radar with no contacts and a speedo with no speed
       would be worse than nothing, because both would teach the player to trust
       instruments that are not reporting.
       What the city genuinely raises is "can I take THIS car out of here", and
       that is answered by real state. So the strip carries the car's name, its
       armour total and mounted count, and whether it clears the legality gate
       the constructor already teaches - and nothing else. Hidden when the driver
       is on foot, because then there is no car to describe.
     FALSE: "the buildings are light gray on a gray cracked ground, so they blend
       together ... increase contrast between buildings and ground." THIRD
       review to make this exact ask after iterations 16/17 deliberately spent two
       rounds establishing that separation (measured 17.6 and 7.9 gaps) and
       iteration 23 got the same suggestion again. The "make the arrows larger"
       half is the FOURTH ask on markers already doubled once;
     - "condition panel shows labels but no visible values" - the pristine-build
       case again, now with dashed chips and, for any fitted facing, a real bar;
     - "the constructor preview is a tiny dark rectangle ... it doesn't show
       armor, weapons, or wheels" - the 6th report of the preview class, and the
       crop shows hull, dashed zone outline, zone boxes, nose marker and the
       dimension line. There IS a real void BELOW the schematic, noted by an
       earlier review, but filling it is a layout change and the ask here is
       about content that is present;
     - radar: 19th report on the same element.

29. z-ai/glm-5v-turbo -> 1 REAL (and it was the panel speaking two languages at
     once), 1 FALSE by a factor of four, 3 in known classes:
     - "Critical status indicators are represented by tiny colored dots (approx
       4px) that are difficult to distinguish from one another or read quickly
       while the vehicle is moving ... replace the dot indicators with wider
       horizontal bars (health bars) that visibly deplete." REAL, and the sharpest
       framing of this ask yet, because it identified the actual defect: iteration
       25 put bars on ARMOUR and left TYRES on dots, so the condition panel was
       answering the same question - how much of this system is left - in two
       different visual grammars depending on which group you looked at. A tyre
       wears down gradually and is almost never in the unfitted state, which makes
       it the best candidate in the whole panel for the pre-attentive read a 4px
       dot cannot give. Tyre rows now carry the same bar, the same
       currentColor fill, and the same guarded ratio.
       Worth recording as a process note: the iteration-25 test that counts
       armour bars immediately started counting TYRE bars too, because both used
       one shared fill class. The test caught it - that is the second time a test
       written to pin a fix has caught the NEXT change breaking that pin - so the
       tyre fill now carries its own modifier class and the armour query filters
       it out explicitly.
     - "The progress bar is a thin 1-2px black line ... near-zero contrast ... it
       looks like a scratch on the camera lens." FALSE by a factor of four on the
       measurement: scanning a column through the bar, the dark track spans y=46
       to y=50 with its border at 45 and 51, so the rendered bar is 8px including
       both borders. The 0%-fill perception was already measured and recorded in
       iteration 22 as the honest report of zero miles driven.
     - "The city is a narrow band of mid-tone greys ... no lighting model or
       shadow to define edges." FOURTH report of this class. There IS a lighting
       model - buildings have analytic contact shadows, tightened in iteration 17
       precisely so separation does not ride on the art (measured gaps 17.6 and
       7.9), and iteration 24 measured the three floors at 144/58/101 luma.
     - "The radar is a large opaque black disc ... visually identical to a hole
       punched in the UI layer." 20th report on the same element. The suggested
       fix - dim the widget to 30-40% when no contacts are present - is a new one
       and is DECLINED on the same reasoning as iteration 28: a practice arena with
       no opponents would render a nearly invisible instrument, and a player
       arriving at combat would have to learn a state change to trust the panel
       they are relying on. Standing by at a fixed weight is the honest read of
       "this is an instrument, and right now it is reporting nothing".
     - "Collapse the ten weapon rows into a summary." Fifth/sixth report of this
       class; the rows are addressed by index and 0-9 typing, so collapsing them
       would break selection and mounting.

30. qwen/qwen3-vl-32b-instruct -> 2 REAL, one of them a first-impression
     critique of a panel I shipped ONE ITERATION AGO, 3 FALSE:
     - "The bottom-left vehicle status box blends into the cracked ground texture
       with no clear border or elevation." That box is the city car strip added in
       iteration 28, and the critique is fair and immediate - it had a border and an
       accent edge but sat FLAT on the ground with no lift, so it read as a decal
       rather than a panel. Drop shadow plus an inset top highlight, which is what
       every other panel in the game already had. The fastest possible turnaround
       on a review of my own work, and the most useful kind: a reviewer looking at
       a fresh element and immediately seeing what it is missing.
     - "The Name input is a plain rectangle with no cursor, placeholder text, or
       active state indicator - it looks like a disabled or empty label." REAL.
       The row's own value label says "(unnamed)", but that renders as the row's
       VALUE, not inside the input, so the box the player is being invited to type
       into was genuinely empty and genuinely looked inert. It now carries a
       placeholder, set as an ATTRIBUTE and never as a value - a placeholder must
       never be submitted as a name, and this input is the one place a stray
       default could silently become the car's name. Styled dimmer than real text
       AND italic, so an untouched build cannot be misread as a car actually
       called "Name your car".
       WORTH RECORDING AS A NEAR-MISS: after adding it, a 260px crop showed the
       input still empty and it was tempting to conclude the fix had not worked.
       The input is full-width and RIGHT-aligned (text-align: right), so the
       placeholder renders at its far edge and a narrow crop simply cannot see it.
       Re-cropped wide, it is there. That is the third time a crop has nearly
       misled me in this loop, and the rule that falls out of all three is the
       same: a crop that disagrees with the code is evidence about the CROP until
       proven otherwise.
     FALSE: the title menu is low contrast against the background (SIXTH report of
       that class; the panel fill has been near-opaque since iteration 20 and the
       selected row measured 34.26 vs 28.86 luma in iteration 26);
     - "the road progress bar is extremely thin" - THIRD report, measured twice
       now at 8px including borders;
     - radar: 21st report on the same element.

31. z-ai/glm-4.5v -> 2 REAL, and the first is THE LONGEST-STANDING DEFERRED ITEM
     IN THE LOG - ground blockiness, recorded since iteration 6 - finally closed
     with a lever that does not require replacing the atlas:
     - "The ground texture is composed of harsh, high-contrast pixel noise (a
       salt-and-pepper effect). It lacks a solid mid-tone base, creating visual
       vibration that competes with the vehicle and lane dividers ... overlay a
       dark, semi-transparent solid colour to establish a base value." REAL, and
       the diagnosis is exactly right where my own note had been stuck. The cause
       is the SAMPLER: the ground reads inside an atlas sub-rect, so it must stay
       NEAREST (linear would bleed the neighbouring cell) and every texel edge
       becomes a hard magnified edge. The deferred note had assumed the only fix
       was a dedicated linear+repeat texture and a load-time change; the review
       found the cheaper and better lever.
       So the ground now has a BASE VALUE: the sample is compressed toward a
       mid-grey (mix(vec3(0.40,0.42,0.46), g, 0.70)). Structure, tiling and the
       sampler are all untouched - the texture still reads as the same cracked
       concrete, it just stops competing with the car.
       MEASURED, and checked for the iteration-17 trap specifically - a fix that
       improves one axis by spending another will be caught by the next reviewer,
       so the road/verge separation was re-measured rather than assumed:
         ground luma spread  city 10.95 -> 8.91, arena 14.02 -> 12.56, road 26.58 -> 24.44
         road vs verge gap    19.9   -> 26.5   (WIDER, not narrower)
         city building/ground 116.3 vs 97.7 (gap 18.7, was 17.6)
       The verge sat closer to the base value than the asphalt did, so converging
       toward mid-grey pushed them APART rather than together. Two fixes that
       would have cancelled out turned out to reinforce each other.
     - "The SMDUEL logo and the menu container border share the exact same neon
       cyan hue and similar luminance. They vibrate against each other, flattening
       the depth between the branding and the interactive interface." REAL, and
       measured differently than the review described: the PANEL border is already
       slate (--ui-line-strong), so the clash is the SELECTED ROW - a full-strength
       accent border plus a 45% inset ring, putting two bright cyan edges directly
       below a bright cyan logotype. The accent WASH is what actually makes the row
       read as selected, so the border and ring step down to a supporting weight
       and the logotype is unambiguously the most saturated cyan on the screen.
       Selection legibility was re-checked in the frame rather than assumed from a
       measurement taken under the OLD title scrim, which iteration 27 replaced.
     Recorded, not changed: the constructor list is uniform monospace with no
     zebra striping. Changing the label face would fight the terminal aesthetic
     the rest of the UI commits to, and iteration 27 already established that a
     reviewer who cannot see a distinction will call it a weight problem when it
     is a grouping one - the section edge added in iteration 17 is the grouping.

32. google/gemini-3.5-flash-lite -> 1 REAL, AND IT UNCOVERED A SEVENTEEN-ITERATION
     BUG THAT MADE SIX REVIEWERS RIGHT AND ME WRONG:
     - "The outer selection boundary box for New Driver and Controls overlaps
       and clashes with the tight internal border styling of the options list ...
       fill the active row with a solid translucent cyan highlight bar instead of
       drawing competing bounding boxes." The diagnosis was right and the
       proposed remedy did not work - and finding out why is the whole
       iteration.
       Removing the outline and pushing the existing accent wash from 26% to 40%
       made the selection render INVISIBLE. That is not a tuning problem: the
       wash is a color-mix() against --ui-surface-2, AND --ui-surface-2 HAS NEVER
       EXISTED. A color-mix() containing an unresolvable var() is an INVALID
       colour, so the entire background declaration was invalid at computed-value
       time and computed to transparent. The selected row's accent fill has been
       rendering NOTHING since iteration 15.
       WHY NOBODY CAUGHT IT, INCLUDING ME, SIX TIMES: selection was ALSO carried
       by a border, so the row still looked highlighted and every screenshot
       looked correct. Six reviews in a row reported that the selected item was
       "only a thin neon outline" - literally, exactly true - and six times I
       sampled a luma average, saw a difference, and logged the claim FALSE. The
       difference I was measuring WAS the border. A green suite, a clean build, a
       passing capture gate and six contradicting expert reviews, all at once.
       The comment above that rule has been asserting "separates by FILL as well
       as by outline" for seventeen iterations. The fill half was a no-op.
       FIXED: --ui-surface-2 and --ui-surface-3 are now declared (surface-3 is
       the bar TRACK, referenced since iteration 25 with a fallback that was
       masking the same problem). The fill is a real left-to-right cyan gradient,
       52% to 30%, and it is now the ONLY selection cue - one box for the panel,
       one filled row for the selection.
       THE GUARD FOR THE CLASS, not the instance: a new test walks every
       stylesheet, collects every declared custom property, adds the ones set at
       RUNTIME (--hud-radar-x/y via inline style, --sm-touch-radius via
       setProperty - a test that demanded those would fail on correct code), and
       fails on any var() reference that resolves to neither. A reference that
       supplies its own fallback is exempt, because var(--x, red) is safe; what is
       not safe is a bare reference. PROVEN to fire, not assumed: injecting a
       bogus var(--ui-bogus-token) into hud.css fails the test, and removing it
       passes. Writing the test is not the same as knowing it works.
     Recorded: tutorial banners are "stark flat dark rectangles ... unstyled HTML
       debugging elements". A real critique with a real remedy (corner brackets,
       amber tint) that no reviewer has yet made concrete enough to act on
       without it becoming decoration.
     FALSE: low-contrast HUD over textured ground (the status pill measured
       11.40:1 in iteration 24 and is now 13.20:1); the constructor list is dim
       grey (iteration 23 raised the weight, and iteration 31 recorded that the
       remaining ask is grouping rather than weight); the condition panel uses
       "muted dashed outlines" for damaged facings (the dash is the UNFITTED
       state, and iteration 21 deliberately made it LOUDER - a fitted facing has
       a real depleting bar).

33. nex-agi/nex-n2.5-mini -> 1 REAL, and it is the item queued since iteration 14
     and circled by SEVEN previous reviews - finally stated correctly:
     - "The car preview is a small blue outline with two unlabeled rectangles,
       while the left list has many part rows; nothing shows which rectangle is
       selected or how armor and weapons attach." Every earlier version of this
       complaint was wrong about WHY. Six of them said the preview was an abstract
       wireframe and asked for the gameplay sprite, which iteration 24 declined for
       a settled reason: the schematic exists to show ARMOUR ZONES, which the
       sprite physically cannot carry. This reviewer names a defect none of them
       did - the zones were always drawn, correctly, for every facing; what was
       missing was the LINK.
       Selecting "Armor: Front" now lights the front band on the diagram, and a
       weapon row lights its mount. A builder whose entire job is "where do these
       points go" was not answering that question where the player asked it.
       The half that is easy to get wrong is the one the test pins: a row with NO
       region on the car - Name, Body, Chassis, Plant, Tyres, Confirm - must
       highlight NOTHING. An arrow pointing at the bonnet because you selected the
       tyre would teach the player the diagram lies.
     - "The city yellow chevrons are visually noisy ... a field of roadwork signs
       rather than a destination." Genuinely new angle on an element three reviews
       have asked to make BIGGER, and it is fair: the marker art reads as
       construction barrier, so enlarging it (iterations 19 and 20) made the
       clutter worse, not better. Recorded with the tension stated plainly - the
       two asks pull opposite ways and both reviewers were reasoning from the same
       frame. Needs a marker REDRAW, not a size change, and that is an art task.
     - "The condition panel is too dense to read while driving." The pristine
       case again: on a capture every facing is unfitted, so the block is five
       dashed chips. A fitted facing has a real fraction AND a real bar since
       iteration 25;
     - "The road progress bar is too abstract." FOURTH report of this class,
       measured 8px twice with a vehicle glyph and a teal-to-blue fill;
     - "The practice arena feels like an empty placeholder ... no cover blocks,
       spawn points, obstacles." Fourth arena-floor claim. The floor measures
       144 luma against 58 for the road and carries a world-fixed lattice; the
       CONTENT ask (cover, spawn pads) is a gameplay build, and iteration 21
       already recorded why faking it in the render layer is the wrong trade.
     TWO TEST-DOUBLE LESSONS, both worth more than the feature:
       - the file's class is set as a STRING via setAttribute, matching every
         other element there, rather than through classList, which its own DOM
         double does not model;
       - and the class is COMPUTED and written ONCE rather than read back and
         appended to. Two test doubles drive this file and only the richer one
         models getAttribute, so reading an attribute back is a crash waiting for
         a different caller. The first version of this passed the preview test
         and crashed builder.test.ts on exactly that.

34. qwen/qwen3.5-397b-a17b -> 1 REAL, and it is a REGRESSION I CAUSED LAST ROUND -
     the iteration-17 lesson firing for the third time:
     - "The floor is a flat low-contrast grey with extremely faint grid lines
       that barely register against the texture ... it is difficult to judge speed
       and distance, causing the car to feel like it is floating in a void." TRUE,
       and caused by iteration 31. That iteration added the ground base value -
       and it compressed the FINISHED ground value, which is UNIFORM contrast
       reduction, so it flattened the world-fixed SLAB LATTICE along with the
       high-frequency noise it was meant to damp. Measured: arena ground spread
       14.02 -> 12.56. The slab joints are the arena's only spatial reference, and
       iteration 21 recorded exactly that when declining to fake boundary
       markings. My own fix had eaten the cue the earlier decision depended on.
       THE FIX IS TO SEPARATE THE TWO ASKS, which is what treating them as one
       number prevented: vibration lives in the HIGH frequencies (the per-texel
       salt-and-pepper the NEAREST sampler produces) and the spatial reference
       lives in the LOW ones. The compression now applies to the DETAIL sample
       where it is declared, not to the blended result:
         arena ground spread  12.56 -> 13.25   (original 14.02 - mostly recovered)
         road ground spread   24.44 -> 25.56   (original 26.58 - still damped)
         city ground spread    8.91 -> 10.26   (original 10.95)
         road/verge gap  26.5 -> 19.1, i.e. back to its honest 19.9 baseline
       Both reviewers' asks are now better served than either uniform version.
       A WORTHWHILE PROCESS NOTE: the first attempt referenced the detail sample
       from outside the block it is declared in, so the shader failed to compile,
       every ground quad vanished, and THREE SCREENS captured with spread 0. The
       capture gate caught it immediately - which is the second time in this loop
       that a gate earned its place by failing loudly rather than by passing.
     - "Add distinct roof colours (rusted metal, blue tarps) to lift the buildings
       off the ground." FIFTH review to make this ask, and the suggested fix is a
       direct reversal of iteration 16: per-building colour IS the collage problem
       that iteration spent a whole round undoing. Measured building/ground gaps
       are 17.2 and 18.7 - the buildings do separate, via the analytic contact
       shadows tightened in iteration 17, not via hue;
     - "The menu box is a thin semi-transparent rectangle." SEVENTH report of
       this class. The panel has been near-opaque since iteration 20 (a
       0.92-alpha stack) and its selected row now carries a real fill since
       iteration 32;
     - "Replace the weapon list with a visual grid." Seventh report; the rows are
       addressed by index and by 0-9 typing;
     - radar: 22nd report on the same element.

35. openai/gpt-4o-mini-2024-07-18 -> ZERO REAL. All five checked; nothing changed.
     The second zero in the loop, and a useful one to pair with iteration 26:
         - "The title SMDUEL lacks contrast against the background." FALSE.
           Measured on the real frame: the wordmark band peaks at 250 against a
           73.5 mean, and the wordmark carries its own shadow. It is the most
           saturated thing on that screen by a wide margin - which is what
           iteration 31 set out to achieve;
         - "The instruction text is small and uses a colour that blends with the
           background, making it hard to read." FALSE, and I nearly logged it
           TRUE on a bad measurement. A 300x16 sample of the legality steps
           returned 72.8 against a 74.4 panel - a ratio of essentially 1.0, which
           would have been invisible. A WIDER crop of the same block shows a bold
           prompt line and three clearly legible steps. The sample box had landed
           on empty panel. That is the FOURTH time in this loop a crop has nearly
           misled me (iterations 12, 30, 33, 35) and the rule is unchanged and now
           well earned: a crop that disagrees with the code is evidence about the
           CROP until proven otherwise. A suspiciously exact number is the tell -
           1.0:1 is not a legibility problem, it is a sampling error;
         - "The icons and text for weapon selection are too small and lack
           distinction" at the arena's top left. There is no such element there:
           the crop shows the WEAPONS button and the seed tag, both added by
           iterations 8 and 22. First sighting of the "element does not exist"
           class since iteration 21;
         - "The road HUD combines multiple readings that appear cluttered." The
           condition panel is a dashboard on purpose - iteration 2 grouped it into
           ARMOUR / TYRES / PLANT & DRIVER precisely so a glance tells you which
           system a line belongs to;
         - "City indicators lack differentiation from the background." Sixth
           report of that class, and the markers measure max saturation 1.0.
     NO CODE CHANGED. This review is also the weakest of the pool so far: no
     coordinates, no measurements, and every finding is a generic "increase
     contrast / increase size" that would apply to any game ever made. Worth
     recording as its own kind of evidence - not every vision model can critique,
     and the pool contains models whose output should be weighted accordingly
     rather than actioned.

36. xiaomi/mimo-v2.5 -> 1 REAL (an art finding no reviewer has stated this
     bluntly, and it needs an asset task rather than code), 4 FALSE:
     - "The title screen shows tanks, not cars ... the background artwork depicts
       two military tanks with turret-mounted cannons facing each other, while all
       gameplay screenshots show a small civilian-style car. The mismatch creates
       immediate cognitive dissonance and may attract the wrong audience while
       repelling the right one." TRUE, and it is the sharpest art-direction
       criticism in the log because nobody had put it that plainly. Four reviews
       have now described the title as "crushed" or "muddy" and every one of them
       was treating the SYMPTOM (too dark) as the disease; the actual disease is
       that the art is the wrong subject, and lightening a scrim was never going
       to fix a tank in a car game. It survived 36 iterations partly because
       iteration 27's scrim fix made the art look BETTER, which made it easier
       to stop looking.
       This is an ASSET task, not a code task: ui-title-art.png is a single
       committed raster that has to be regenerated to show a welded-armour car
       rather than a tank. Recorded as the top art item rather than faked with a
       crop, a filter, or a caption that admits the mismatch.
     - "The lane markings are separate short rectangles with gaps as wide as the
       marks themselves, making them look like floating debris." FALSE on the
       measurement, and precisely: the dash is ROAD_DASH_LENGTH_M 3.2 inside a
       ROAD_DASH_PERIOD_M of 10, so the gap is 6.8m - 2.1x the mark, not 1x. The
       perception of floating debris is worth keeping in mind, but the stated
       cause is wrong. The second half of the ask is also already built: the
       "faint white shoulder line along both road edges" is `decal-road-edge`,
       which draws the two white lines bounding the road in every capture;
     - "The city is a monochromatic wash with no value or hue contrast." SEVENTH
       review of this class, and the suggested fix - "darken the ground 20-30%,
       raise the buildings 10-15%" - is iteration 16 and 17 run backwards.
       Measured ground luma is 102, buildings 119.4 and 110.3 (gaps of 17.2 and
       7.9) on the city, 78 on the road and 125 in the arena;
     - "The radar is a dark disc with faint crosshairs and a tiny triangle."
       23rd report on the same element. The reviewer's own fix - "add a bright
       rotating sweep arc, visible concentric range rings, a brighter player
       arrow" - describes what iteration 2 added and every capture since has
       shown;
     - "The status panel has no scan path ... reduce it to two rows." A redesign
       of something iterations 2, 21, 25 and 29 each changed deliberately: it is
       a dashboard, it is grouped, and it now answers the same question the same
       way for armour and tyres. A silhouette view is a plausible alternative
       design, not a defect.
     NO CODE CHANGED. The log's standing note is worth repeating here though:
     a symptom that has been "fixed" several times without the disease being
     named is a signal to stop fixing the symptom.

37. minimax/minimax-m3 -> 1 REAL, and it is the eighth report of its class
     that finally asked for the RIGHT thing:
     - "Every building is a near-identical flat grey block ... none carry
       signage, colour, or a clear icon that tells the player what they do
       (garage, shop, mission board, arena entrance) ... give each building a
       colour-coded floating icon above it (wrench for garage, dollar sign for
       shop, exclamation for mission, crossed swords for arena)." The ASK is
       right and the CLASS has been wrong seven times.
       Seven earlier reviews wanted per-BUILDING COLOUR, which is the collage
       problem iteration 16 spent a whole round undoing and which iteration 34
       was asked to reverse for the fifth time. This one wanted colour that
       carries FUNCTION. Those are opposite intents wearing the same paint, and
       the difference is the whole fix: iteration 16 removed hue because it made
       every building carry an identity for no reason; grouping the ten facility
       kinds by what they are FOR tells the player something true, and tells it
       without driving up to each door.
       The ten facility kinds group into four: arena (combat, red), garage /
       weaponshop / salvage / assembly (workshop, amber), medical / bar (care,
       green), and truckstop / federal / courierguild (trade, cyan, also the
       fallback for an unknown kind so a new facility never renders white).
       It lands on the entrance MARKER, not the building, so the building
       sprites keep the single slate grade from iteration 16 and the collage fix
       is fully intact. It also adds ZERO instances, which matters: the city
       actor buffer is exactly full at 95/95, and iteration 19's marker shadows
       had to be reverted for precisely that reason.
       A test pins the four tints are distinct, that each reads as its OWN hue
       (dominant channel differs, not merely "a different number"), that the
       workshop family shares one tint, and that an unknown kind falls back to
       trade rather than rendering white.
     - "The title screen shows tanks, not cars." SECOND report of iteration 36's
       finding, from a different model, which is what makes it a fact rather
       than an opinion. Still an asset regeneration, still not faked with CSS;
     - "The constructor preview shows no mounted weapons regardless of which row
       is selected ... selecting 'Armor: Front' or 'Weapon 1' produces zero
       visual feedback on the car itself." FALSE about the link, which iteration
       33 added four reviews ago: a static capture cannot show what happens when
       a row is selected, and this capture has the NAME row selected, which
       correctly highlights nothing. The first half - no armour, no weapons
       drawn - is the PRISTINE case again, and it is the honest rendering of a
       car with nothing fitted;
     - "All five armour facings show the same dashed-outline empty box ... no
       fill, no number." Fifth report of this class, and the specific ask -
       "print the numeric value inside the box, and keep the empty/dashed look
       only when armour is genuinely zero" - is a description of what iterations
       21 and 25 built. A fitted facing has carried a number and a depleting bar
       for a dozen reviews now;
     - radar: 24th report on the same element, and the reviewer's own suggested
       fix - a rotating sweep arc, range rings, a heading chevron - describes
       what iteration 2 added.

38. z-ai/glm-4.6v -> ZERO REAL. All five measured; nothing changed. The third
     zero, and the first whose two substantive claims are about work the loop
     shipped in the last eight iterations:
         - "The Name field placeholder is light gray, blending with the dark
           input background." FALSE. Measured on the real frame: the placeholder
           peaks at 182.6 against an input background of 34.1 - 7.89:1, which
           clears WCAG AA and AAA. It is dimmed ON PURPOSE: iteration 30 styled it
           dimmer than the real text and italic precisely so an untouched build
           cannot be misread as a car actually called "Name your car". The
           reviewer's fix - make it a brighter, more saturated colour - would
           walk that back toward looking like a value;
         - "The orange 'Not road-legal' text is small and low contrast." FALSE,
           and measurably: it peaks at 189.0 against a 43.0 strip background,
           7.54:1, also past AAA. The crop confirms it is the most prominent line
           in the panel, set in bold amber under two quieter rows - which is the
           intended hierarchy, since it is the one line that blocks the player
           from taking the car anywhere;
         - "'0 mph' is white but low contrast against the dark speedometer."
           Measured at 10.25:1 in iteration 26, and the reviewer's own fix - pure
           #FFFFFF with a border - would make it louder still for no gain;
         - "The unselected 'Controls' option is in a dark bar with low contrast
           ... use a lighter gray background for unselected menu items." The fix
           is backwards: it would make UNSELECTED rows more prominent than the
           selected one, which is the exact defect iteration 32 spent itself
           fixing when the selection became a fill rather than an outline;
         - radar: 25th report on the same element, and the requested fix - "a
           thin white sweep line ... and small white dots for visible contacts" -
           describes the rings, crosshair, sweep and player marker iteration 2
           added, which every capture has shown since.
     NO CODE CHANGED. Three zeros in thirty-eight reviews is the clearest
     evidence yet that the pool's remaining models have less to add than the
     first twenty did - the five complaints that used to recur every round have
     either been fixed or, more often, turned out to be measurements I had
     already taken and should have kept in front of me.

39. google/gemini-3.7-flash -> 2 REAL, and the first is a bug TWO REVIEWERS WERE
     RIGHT ABOUT AND I LOGGED AS FALSE TWICE:
     - "The configuration list overflows its bottom container boundary and
       partially clips the 'CONFIRM' action text ... clipped UI elements look
       visibly broken." TRUE, and it is the third reviewer to report it —
       iteration 18 said "CONFIRM clipped by the help line" and iteration 21
       said "the section header bar is vertically undersized, showing only the
       top edges of characters". I recorded BOTH as false. The first I waved off
       without looking closely enough; the second I dismissed by concluding no
       such element existed, because I was looking at the section RULE from
       iteration 17 rather than at the confirm row.
       Root cause, once actually looked at: `.sm-builder__rows` is
       `max-height: 60vh; overflow-y: auto`, and on a 900px viewport the list is
       exactly tall enough that the confirm row STRADDLES the container's bottom
       edge. The control that ends the entire screen was rendering as a sliced
       sliver that has to be scrolled to find. CONFIRM now renders into a pinned
       footer outside the scroll region, so it cannot be scrolled away however
       long the loadout gets. The row keeps its index in `computeRows`, so
       selection, the 0-9 typing model and the whole index space are untouched —
       only its container changed.
       THE LESSON, and it is the sharpest one in this log: I dismissed two
       correct reports using two DIFFERENT bad methods — one by not looking, one
       by looking at the wrong element. A claim that recurs from independent
       reviewers is evidence about MY CHECK, not about the claim. "I checked and
       it was fine" has to mean "I looked at the thing they named".
     - "Every building entrance is marked by a generic saturated chevron in raw
       primary colours with no semantic labels or icons to explain what each
       structure does." TRUE, and it is aimed squarely at iteration 37's work,
       which is exactly right: colour that carries information is only
       information once the mapping is discoverable, and a player driving past a
       cyan chevron had no way to know cyan means "job" rather than "clinic".
       Four saturated colours and nothing to learn them from is just four
       saturated colours. The city now carries a key — Fight / Build / Care /
       Jobs — whose swatches read `facilityMarkerTint` itself, so the legend and
       the map cannot drift apart. It adds no instances, which matters in a
       buffer that is exactly full at 95/95.
     FALSE: the ground shows "severe macro-pixelation and harsh square tile
       seams" — the documented NEAREST-sampler consequence, damped in iterations
       31 and 34 by separating the high-frequency and low-frequency asks;
     - "The city is a monochromatic value wash ... zero depth hierarchy." NINTH
       review of that class. Measured building/ground gaps are 17.2 and 18.7, and
       the suggested fix — "darken the ground, add strong directional contact
       shadows" — is iterations 16 and 17 run backwards;
     - "Accessibility toggles pinned permanently to viewport corners." A fair
       observation and a genuine design tradeoff, recorded rather than acted on:
       those toggles are one-key reachable precisely because they are on screen,
       and hiding them behind a menu removes access for the players who need them
       mid-run. Corner placement with a panel background is the compromise already
       in place;
     - "Replace the flat rounded rectangle with a top-down vehicle rendering."
       The same ask as iterations 13, 16, 24, 26 and 37, declined for the settled
       reason: the schematic exists to show armour zones the sprite cannot carry.

40. qwen/qwen3.5-35b-a3b -> ZERO REAL, and the first finding is the most
     confidently wrong claim in the log:
     - "Broken Radar Visualization — TITLE SCREEN (top-left) ... the radar is a
       dark, empty disc with no active scanning animation ... fix: add a
       rotating, animated cyan sweep line and inject 1-2 faint white 'blips' on
       the screen edge to simulate active scanning of distant enemies."
       THERE IS NO RADAR ON THE TITLE SCREEN. The crop shows an "Arcade" button
       and title art; the radar is a HUD element on the arena and road screens
       only, and it has been reported missing 25 times. This is the second
       sighting of the "element does not exist" class and the worst instance,
       because the proposed fix is not a no-op: it would add a scanning
       instrument to a MENU, complete with fabricated enemy contacts, purely to
       satisfy a screenshot reading. That is the same trade this loop has
       declined five times - a fake instrument that teaches the player to trust
       a readout reporting nothing - except here it would ship on the first
       screen the player ever sees, before any gameplay exists to report on. The
       radar is 26th on the list of "missing" things that are present;
     - "The player's orange vehicle is surrounded by an active selection box, but
       there is no visible cursor ... fix: overlay a high-contrast yellow arrow
       directly above the selected vehicle." That "selection box" is the teal
       waypoint BEACON from iteration 8, which is already exactly the arrow the
       review is asking for, in the game's objective colour, sized down in
       iteration 11 after a reviewer called it oversized. It is not a selection
       box and the player is not selecting anything;
     - "The vehicle obscures the lane marker completely." The car is centred on
       the road by design and the dashes continue ahead of and behind it; this
       is the standard consequence of a top-down camera on a vehicle that
       occupies the lane it is driving down;
     - "All buildings and obstacles look identical in colour and texture ...
       gates in bright red, buildings in muted blue." TENTH report of that class.
       Measured building/ground gaps are 17.2 and 18.7, iteration 37 grouped the
       ten facility kinds into four functional colours with a legend, and
       "gates in bright red, buildings in muted blue" is the per-building-hue
       collage fix iteration 16 spent a round removing, restated;
     - "Key stats and options are rendered in low-contrast text ... fix:
       undefined." The model returned no fix at all for its own finding. The
       constructor's primary action carries the accent-bordered treatment from
       iteration 15 and the onboarding steps carry full ink from iteration 23,
       and the premise is that a low-contrast PRIMARY ACTION is exactly the
       defect iteration 15 set out to remove.
     NO CODE CHANGED. Worth recording alongside this one: the "radar is missing"
     claim has now been made 26 times, and this is the first time it was made
     about a screen that does not have one. A finding that recurs 26 times
     without ever being right about WHERE it is has stopped being evidence.

41. qwen/qwen3-vl-235b-a22b-instruct -> ZERO REAL. Nothing changed. Two of the
     five were worth the checking anyway, and one of those is now a standing
     rule:
     - "All status bars (tyres, plant, driver) use the same green colour even at
       critical levels ... critical systems look no different from full ones."
       FALSE, and this one I checked rather than waved off, because it is the
       EXACT shape of the iteration-32 bug: a rule that looks present in the
       stylesheet and silently never applies. So I traced the whole chain rather
       than reading one line of it:
         row carries data-state  ->  .hud-root [data-state='critical']
         ->  var(--ui-critical)  ->  DECLARED at tokens.css:168 (#ff8a3d)
       and the panel really is a descendant of `.hud-root`
       (`root.appendChild(buildDamageFacings(...))`, with `root` carrying the
       class), so the selector matches. Iteration 9 measured those four tokens at
       10.88 / 10.39 / 8.08 / 6.13:1. The state colouring is wired end to end.
       What the reviewer is seeing is the PRISTINE case: on a capture every
       system genuinely IS ok, so every row genuinely IS green. That is correct
       reporting, and it is the mirror image of the iteration-21 bug — green on a
       zero — which is precisely why it was worth verifying instead of assuming;
     - "'New Driver' and 'Controls' are visually identical: same font, colour,
       size, and no selection highlight. No clear primary action." SIXTH report
       of this class, and false since iteration 32: the selected row carries a
       real cyan gradient fill (52% -> 30%) and is the only filled row on the
       panel. The reviewer describes the state that existed before the
       `--ui-surface-2` fix, and has now described it six times;
     - radar: 27th report on the same element;
     - "The road lacks directional feedback ... add a compass rose." A feature
       request rather than a defect, and recorded as one. The road is a
       one-dimensional route with a fixed heading: the car drives forward along
       the lane and the progress bar reports distance, so "which way" is
       answered by driving. A compass would add a second, redundant answer;
     - "Replace '(empty)' with a plus icon ... tooltip: 'Press Enter to mount
       weapon'." EIGHTH report of this class, and the proposed copy is wrong
       again: Enter is CONFIRM, not mount — mounting is done by typing a digit,
       which is what the hint line under the list already says. A tooltip
       teaching the wrong verb is worse than no tooltip.
     NO CODE CHANGED. The transferable rule from this round, written down because
     it nearly went the other way: a claim that a rule "is not applying" is the
     one claim in this log where reading the stylesheet is NOT enough. Check the
     selector matches the actual DOM ancestry, then check the token is declared.
     Iteration 32 proved that a rule can look perfect and render nothing, and
     "I read the CSS and it looked right" is exactly the check that missed it.

42. minimax/minimax-01 -> ZERO REAL, and the weakest review of the pool along
     with iteration 35's. No coordinates, no measurements, and every finding is
     a genre observation that would apply to any game ever made: "add more
     environmental details", "use colour coding and size differentiation",
     "implement clearer navigation markers and a mini-map", "add visual and
     auditory feedback". Nothing here names a specific element, a location, or a
     measurable defect. Not actioned, and not worth enumerating claim by claim
     the way the substantive reviews have been — there is nothing to check.
     NO CODE CHANGED.

     CLOSED A QUEUED ITEM WITH EVIDENCE. Iteration 20 recorded, as the honest
     remainder of the preview class: "the remaining ask is tying it to the
     player's colour, queued". Several reviews since have gestured at the same
     thing — the schematic does not resemble the car you will drive. I checked
     whether that gap is real, and it is not:

       buildVehiclePreviewParts reads getBody(state.bodyId) and takes
       colliderLengthM / colliderWidthM — the SAME numbers driving.json and the
       simulation use, not a hardcoded schematic size:

         subcompact 3.8 x 1.6      luxury 5.3 x 1.9
         compact    4.3 x 1.7      stationwagon 5.0 x 1.85
         midsized   4.8 x 1.8

     So choosing a different body already changes the schematic's proportions,
     hull, wheelbase and every zone band, because the diagram is generated from
     the chosen part rather than drawn once. The item is closed rather than
     carried again, which is the point of writing a queue down: an item that
     turns out to already be satisfied should be retired, not re-raised every
     few rounds with a new reviewer's name attached.

     What remains genuinely open on the schematic, and is NOT this: the reason
     six reviews wanted "the actual vehicle sprite" is that the schematic reads
     as a diagram where they expected a car. That is a design difference, not a
     defect — the diagram answers "where do my armour points land", which is the
     only question this screen can answer, and iteration 33 added the link from
     the selected row to the zone (itself found after seven reviews described the
     symptom wrongly).

43. xiaomi/mimo-v2.6-pro-ultraspeed -> 1 BIG REAL (the title composition, the item
     deferred since iteration 14), 1 FALSE that would have BROKEN correct code if
     I had believed it, 3 in known classes:
     - "The dark menu box is dead-centre and its top edge slices across both hero
       vehicles' hulls and the crack line in the foreground, occluding the two
       machines the whole image is built around ... the UI blocks the art instead
       of sitting on it." TRUE, and it is the sharpest composition note in the log.
       The art is built symmetrically — two vehicles flanking a centre axis with
       the foreground crack leading up through it — so a CENTRED menu sits exactly
       on the one thing the composition is pointing at.
       The lockup is now absolutely centred and the MENU is pinned to the
       lower-left third, which clears the whole centre: both vehicles, the
       skyline, the crack line and the wordmark all keep the frame, and the menu
       reads as a deliberate corner plate rather than a dialog dropped on the
       picture. Both children are absolutely positioned rather than laid out by
       the flex column, because a flex row cannot put one child on the centre
       axis and another in a corner.
       This is the best the title screen has looked in forty-three iterations, and
       it is the last item on the deferred list that could be executed in code —
       the tanks themselves remain an asset regeneration, not a CSS change;
     - "The car sprite is drawn nose-up while the road markings run
       left-to-right ... the vehicle sits perpendicular to its own lane markings,
       as if it were crossing the road sideways." FALSE, and the fix it proposes
       would have introduced a real bug. The crop shows the car nose-LEFT, parallel
       to the road, driving along it: the road strip is rotated to the route
       heading and the car sprite is rotated to `vehicle.headingRad`, so the two
       agree. The suggested remedy — "rotate the vehicle sprite with its heading
       (camera stays north-up)" — describes what the renderer already does, and
       the reviewer's own framing ("nose-up in every gameplay frame") is simply
       not what the frame shows. Believing this one would have decoupled the car
       from the road it is driving on;
     - "Objects share the ground's value — no contact shadows or separation ...
       nothing has a drop shadow, outline or darkened ground patch under it."
       FALSE. Every vehicle has carried an analytic contact shadow since
       iteration 1, visible in this very crop, and city buildings have had theirs
       tightened in iteration 17 to 0.3/0.62 precisely so separation does not
       ride on the art. Measured building/ground gaps are 17.2 and 18.7;
     - "The armour readout is a stub: '--' values and empty dashed boxes ... the
       panel is visibly half-built." SIXTH report of this class, and it is the
       pristine case: on a capture every facing genuinely is unfitted, so the
       dashed chip is the honest rendering iteration 21 deliberately made
       LOUDER, and a fitted facing has carried a real number and a real depleting
       bar since iteration 25;
     - "Hard vertical tile boundaries ... reads as compression artefacts." The
       documented NEAREST-sampler consequence — the ground reads inside an atlas
       sub-rect, so linear filtering would bleed the neighbouring cell. Iterations
       31 and 34 damped the high frequencies without touching the low-frequency
       lattice, and the two-scale blend is what breaks the repeat the reviewer is
       reading as a seam.

44. bytedance-seed/seed-2.0-mini -> ZERO REAL. Nothing changed. Two of the
     five are claims about work this loop shipped in the last twenty-two
     iterations, and both measured clean, which is the useful part:
     - "The white tagline text overlaps with the bright yellow sun glow, making
       parts of it faded and less readable ... add a dark drop shadow and shift
       it away from the sun's centre." FALSE, and it is worth measuring rather
       than asserting because iteration 43 MOVED that lockup. Composited
       against the brightest background adjacent to the tagline, the text peaks
       at 240.15 on a 64.7 background — 9.00:1, against the 9.48:1 measured
       before the move. The scrim is at its darkest at 42% of the frame and
       the lockup now sits at 38%, so the two are still stacked by design; the
       move cost 0.5 of a ratio point and bought a title screen that shows the
       art. The sun glow is off to the side of the text, not under it;
     - "Two key messages (controls and arena status) are stacked with no
       spacing, creating dense, hard-to-read text." FALSE, and the frame is the
       clearest possible rebuttal: three SEPARATE panels, each with its own
       background, at 8px / 34px / and the message feed below — "Practice
       arena" as the status pill, the controls as a fading hint, and "Practice
       arena entered — free run, no opponents." as the feed. That is precisely
       the layout iteration 22 built, when the single run-on element carrying a
       mode label, three control hints and a seed hash was split apart. A review
       describing the pre-iteration-22 layout as a current defect is the
       six-times-reported "only a thin neon outline" pattern again: describing a
       fixed state rather than reading the shipped one;
     - "Add a thin rotating cyan sweep line and placeholder contact blips to the
       radar to confirm it is active." TWENTY-EIGHTH report on that element, and
       the fix is the one this loop has declined seven times, for the same
       reason: a practice arena with no opponents would gain FABRICATED contacts
       whose only purpose is to make an empty readout look busy. An instrument
       that invents signals to look functional is worse than a quiet one;
     - "Divide the progress bar into 10 equal segments." Fifth report of this
       class. The bar is a continuous fill with a vehicle glyph at its head and
       the remaining miles in the objective line directly above it. A segmented
       bar is a legitimate alternative design, and iteration 22 declined the
       duplicate readout for the same reason this declines it: the number is
       already on screen, one row up;
     - "Add a numeric value and a colour-coded micro-bar next to each armour
       facing." Seventh report of this class, and it describes exactly what
       iterations 21 and 25 built — a loud dashed chip when nothing is fitted,
       and a real number plus a real depleting bar when something is. On a
       pristine capture every facing genuinely IS unfitted, so every chip
       genuinely IS empty.
     NO CODE CHANGED. The tagline measurement is the one worth keeping: the
     composition change cost 0.5 of a contrast point and the art is visible for
     the first time, which is a trade this loop should make knowingly rather than
     discover later — and now that it is written down, it is known.

45. amazon/nova-2-lite-v1 -> ZERO REAL. Nothing changed. The first finding is a
     spatial claim that is checkable in one glance, and it is wrong:
     - "The condition panel overlaps the radar and health display, creating
       visual clutter." FALSE, and the frame settles it: the four corners hold
       four DISTINCT instruments — CONDITION top-right, RADAR bottom-left, the
       speedometer bottom-centre, the accessibility toggles bottom-right — with
       the centre of the frame left entirely clear for the car. The status pill
       and control hints sit top-centre, the WEAPONS button and seed top-left.
       Nothing overlaps anything. This is the fourth distinct false claim class
       to appear in a row (radar missing, tagline sun-glow, stacked messages,
       overlapping panels) and they share a shape: the reviewer describes a
       plausible layout problem and never checks whether the layout has it;
     - "The orange sunset makes the white title text hard to read." Measured in
       iteration 44 at 9.00:1 against the brightest background adjacent to the
       tagline, with a two-layer shadow underneath. "Especially on lower-end
       displays" is a claim about hardware this loop cannot measure and has no
       evidence for;
     - "Add a compass or arrow indicating next turn direction." THIRD report of
       this class, declined on the same reasoning both times: the road is a
       one-dimensional route with a fixed heading. You drive forward. A compass
       would be a second answer to a question the road already answers by being
       straight;
     - "City road markings are faint and lack clear lane divisions." FOURTH
       report of this class. The city is a walled compound with a perimeter ring
       and facility doors, not a multi-lane carriageway, and the entrance
       markers are the most saturated thing on the map at max_sat 1.0;
     - "Empty weapon slots lack visual differentiation from filled slots." NINTH
       report of this class. Iteration 17 gave unfilled slots dim ITALIC `(empty)`
       against a section rule, while a fitted slot shows the weapon's NAME in
       full ink — the two are as different as two states of the same row can be,
       and the reviewer's own suggested fix (a distinct outline) is a third
       treatment where two already work.
     NO CODE CHANGED. The overlap claim is the one worth remembering: it is the
     cheapest possible check in the whole loop — one look at the frame answers it
     — and it is exactly the kind of claim that gets actioned anyway when a
     review is long and confident.

46. mistralai/ministral-3b-2512 -> ZERO REAL. Nothing changed. The first finding
     is aimed squarely at iteration 43's own change, three reviews after it, and
     is wrong:
     - "The small UI panel (New Driver/Controls) is positioned too close to the
       bottom edge, making it hard to read due to cropping and lack of contrast."
       FALSE on both counts, and the crop settles it. The menu is pinned at
       `bottom: clamp(20px, 5vh, 56px)` — 45px clear of the edge at this
       viewport, with the panel's whole bottom border and rounded corner visible
       and well clear of the frame. Nothing is cropped. And it is not low
       contrast: near-opaque body (0.92-alpha stack since iteration 20), a
       top-lit inner highlight, a slate border, and the selected row carrying a
       teal fill that measured 34.26 against 28.86 luma in iteration 26. The
       text is crisp at 1:1.
       Worth recording as a pattern: three reviews after moving the menu out of
       the centre, a reviewer has now reported a problem with the move itself
       without evidence for it. The move was measured against the frame then
       (the art became visible for the first time) and re-measured after
       (tagline 9.48:1 -> 9.00:1, bought knowingly). A later reviewer noticing
       a number is not the same as that number being wrong;
     - "Speedometer reads 0 mph in all screenshots, making it appear broken."
       Every capture in this loop is a static frame of a vehicle at REST, and
       0 mph is the honest reading of a car that is not moving. The gauge has
       reported 0.0 mi on every capture since iteration 1, and the alternative
       this asks for — a spinning needle while the vehicle is stationary — is
       decoration that contradicts the simulation;
     - "Radar sweep indicator ... no visible sweep arc." TWENTY-NINTH report on
       that element. The sweep, the concentric rings, the crosshair and the
       player marker are all in the capture, and the suggested remedy is the
       placeholder-contact fabrication declined eight times;
     - "Armour stats are all 0/0 with no visual distinction." EIGHTH report.
       Two errors in one sentence: the panel does not print 0/0 for an unfitted
       facing, it prints a dash inside a dashed chip — iteration 21 made that
       state deliberately LOUDER precisely because a faint dash read as missing
       data; and the two states ARE distinguished, by that chip against a real
       number and a real depleting bar;
     - "All armour slots are empty with no visual indication of where to place
       armour points or what they represent." NINTH report, and it describes
       three separate features that exist: the dashed ZONE outline for every
       facing regardless of points bought (iteration 11), the brightness
       increase (iteration 13), and the selected-row-to-zone LINK (iteration 33),
       which is exactly "a cursor highlight on the armour slot you are editing".
     NO CODE CHANGED. Five zero-real reviews in the last twelve is the shape of
     the curve now: the defects worth finding were found in the first twenty
     iterations, and the pool has been re-reporting the same five solved
     complaints ever since. The most useful thing left to do with a review is
     check whether it is looking at the shipped build.

47. google/gemini-3.5-flash -> 1 REAL (a precise critique of iteration 43's own
     change), 1 REAL-but-declined tension, 3 in known classes:
     - "The menu box is surrounded by an overly thick, bright cyan outline with
       asymmetric padding around the raw list elements, leaving a massive empty
       dark-teal block below the second option." BOTH halves true, and both are
       consequences of the iteration-43 move, which is exactly the kind of thing a
       later review of my own change is for.
       The outline is `:focus-visible` — and because the menu is focused the
       instant the title screen mounts, that ring is on screen PERMANENTLY. A 2px
       cyan ring at a 4px offset therefore stopped being a focus indicator and
       became the panel's visible border, which is precisely the "unstyled HTML
       div" complaint three earlier reviews had already raised. It is still the
       only thing telling a keyboard player where they are, so it is stepped down
       rather than removed: 1px, 2px offset, and mixed to 55% so the strongest cyan
       on the screen stays on the SELECTED ROW rather than the frame around it.
       The dead space was real too — the panel's padding was sized for the taller
       in-run menus, so a two-row title menu carried a band of unexplained dark
       teal below its last option. Padding tightened for the short case;
     - "The building markers are flat, highly-saturated neon chevrons clashing
       with the desaturated grungy background ... style them as holographic
       projections or rusted physical signposts." This is the OPPOSITE ask to the
       one that created them. Iterations 19, 20 and 26 each asked for these
       markers to be BIGGER and more visible because they were being lost against
       the ground; iteration 37 gave them function and a legend; now the complaint
       is that they are too loud. That is not a contradiction in the game — it is
       the marker being asked to do two opposite jobs at once, be findable from a
       moving car AND sit inside a grimy world. The honest resolution is a marker
       that reads as a worn painted sign rather than a neon UI chip, which is an
       ART task and not a CSS one, exactly as iteration 33 recorded for the same
       element. Recorded with the tension stated rather than acted on by swinging
       the value back, which would simply re-open the iteration-20 problem;
     - "Ground textures display severe blocky pixelation and harsh unblended
       tile edges." FOURTH report of this class. The cause is the NEAREST sampler,
       which is required because the ground reads inside an atlas sub-rect where
       linear filtering would bleed the neighbouring cell. The suggested remedy
       (anisotropic filtering, a multi-texture blend shader) is the load-time
       change this loop's own deferred note predicted, and iterations 31/34 got
       most of the perceptual benefit without it by damping only the high
       frequencies;
     - "The preview is a primitive flat-shaded blue rounded rectangle with two
       plain squares." SEVENTH report of the preview class, declined for the
       settled reason: the schematic exists to show ARMOUR ZONES, which the
       gameplay sprite cannot carry. Note that this reviewer asks for the OPPOSITE
       of iteration 43's — there it wanted the real sprite, here it wants
       "line-art illustration of the actual subcompact chassis" — and both are
       the same request to make a diagram into a picture, which is not what the
       screen is for;
     - "The speedometer and radar are flat opaque dark-gray boxes with raw
       monospaced text ... add scanlines, bevels, segment digits." This is the
       item iteration 32 recorded as needing concreteness before acting, and this
       is the concreteness — an explicit recipe. Still not actioned: the panels
       are legible, grouped and consistent, and restyling them is a theme decision
       rather than a defect, so it belongs to whoever is choosing the game's
       visual language rather than to a defect list.

48. openai/gpt-5-mini -> 1 REAL (buried in a review that got two other things
     wrong), 4 in known classes:
     - "Constructor controls lack affordance ... the Confirm area looks like
       another row ... mark required rows with a yellow badge until satisfied."
       Two of the sub-claims are STALE and worth recording as such: the Confirm
       area has been a filled, accent-bordered primary button since iteration 15
       (and was given a pinned footer outside the scroll region in iteration 39),
       and the Name field has carried a placeholder since iteration 30. This
       reviewer is describing the constructor as it was fifteen iterations ago.
       But the LAST ask is new and it is the good one: nothing on the row list
       itself marked which legal requirements were still unmet. The legality panel
       states all three rules in a paragraph BELOW the list, which is the thing
       the player is not reading while they are editing.
       Rows that are holding the build up now carry an amber left rail and a
       faint amber wash: Name, all five armour facings, and every empty weapon
       slot. Component rows (Body, Chassis, Suspension, Power Plant, Tires) stay
       clean, because they are chosen for the player and are satisfied by
       construction.
       Two deliberate choices: amber rather than RED, because a red row reads as
       a failure the player caused, which is exactly what the pristine-build
       messaging exists to avoid (`isPristineBuilder`); and a LEFT rail rather
       than a right-hand badge, because the right edge of the list is the VALUE
       column and a badge there would compete with the number being read.
       The flag is derived from the same fields the violations come from (name,
       total armour, mounted weapons) rather than by reading `validateDesign`, so
       the marker cannot drift from the rule that actually gates CONFIRM. Test
       pins both directions: every unmet row marked on a fresh build, and zero
       marks once name, armour and a weapon are all present;
     - "The title and subtitle sit directly on a high-contrast busy background
       ... place them on a solid backing to guarantee contrast." Measured in
       iteration 44 at 9.00:1 against the brightest background adjacent to the
       tagline, with a two-layer shadow. The scrim IS the backing — iteration 27
       turned it from a blackout into a band, dark at 42% where the text sits and
       light elsewhere precisely so the art shows;
     - "The radar is a circular disc with a single static triangle and no visible
       sweep, blips or distance rings." TWENTY-SECOND report on that element.
       The rings, crosshair, sweep and player marker are all present; this is the
       same pre-iteration-2 description the pool keeps re-issuing;
     - "The condition panel lacks quick-read hierarchy ... armour faces are tiny
       dashed boxes with no numeric readout." TENTH report, and it is describing
       iteration 21's state: a fitted facing has carried a real number and a real
       depleting bar since iteration 25, and an unfitted one carries a
       deliberately LOUD dashed chip rather than the faint dash that read as
       missing data;
     - "Background texture noise competes with gameplay ... add a vignette, reduce
       pixelation scale." The NEAREST-sampler consequence again, fifth report,
       and the vignette half is a restatement of the arena-content item declined
       in iteration 21.
     WORTH RECORDING: this is the second review in a row to describe a screen
     accurately, name one genuine gap inside it, and get two of its three
     supporting observations from a build several iterations old. A review is not
     a unit of truth — it is three observations of different vintages, and the
     useful move is to check each against the frame rather than accept or reject
     the review as a whole.

49. qwen/qwen3-vl-8b-thinking -> 1 REAL (small, and only after separating the
     claim from its stated cause), 4 FALSE:
     - "The progress banner uses dashes to split text, causing awkward line
       breaks ... text is hard to parse quickly." The STATED CAUSE is false and
       the frame settles it in one look: the banner is a single line with no wrap
       at all, at 1280px and at the narrow widths this loop also captures. There
       are no line breaks to be awkward.
       The OBSERVATION underneath it is still worth something, though, and it is
       the kind of thing that only shows up when someone reads a line closely
       rather than scanning it: these are three FIELDS — destination, distance,
       day — and an em dash is a sentence break, not a field delimiter. A player
       reading this at speed parses "Albany — 150mi" as a phrase with an aside
       rather than as two adjacent values. The road and city status lines now
       separate fields with a middot, which is what the menu header has always
       used for the same job.
       Worth recording as a pattern: a wrong reason attached to a real
       observation is still a real observation. The reflex to discard a finding
       because its diagnosis is wrong throws away the half that was right — which
       is the mirror of iteration 25, where a wrong claim about the CONDITION
       panel was really a right claim about WEIGHT;
     - "Radar is a static black disc with no visible sweep or contact markers."
       THIRTIETH report on that element, and the suggested fix is the fabricated
       placeholder contacts declined nine times;
     - "'Not road-legal' is too small and hard to read." Measured at 7.54:1 in
       iteration 38 — past AAA — and it is set in BOLD amber as the most
       prominent line in a three-line panel, because it is the one line that
       blocks the player from taking the car anywhere. The "minimum 16px" ask
       would enlarge the least-scannable element of the panel;
     - "Weapon slot '(empty)' has low contrast against the dark background ...
       set it to white at 90% opacity." INVERTED. Iteration 17 dimmed the
       unfilled slots — dim AND italic — precisely so the eye lands on what is
       actually fitted. Making all ten empty slots near-white would put the
       loudest thing on the screen in the state the player is trying to move out
       of;
     - "The tagline is too light ... increase to bold." Measured at 9.00:1 in
       iteration 44, and iteration 12 established the hierarchy the weight
       protects: the tagline must stay subordinate to a 40-76px wordmark, and
       bolding the smaller line inverts exactly that.

50. stepfun/step-3.7-flash -> ZERO REAL. Nothing changed. Every claim was
   checked, and one of them sent me building a fix for an element I had not
   actually found:
     - "Debug Seed Text Leak ... 'Seed alice5ee' beneath the weapons UI ...
       remove it from production builds." FALSE, and it is the second review to
       call the seed a debug leak (iteration 19 made the SAME call about the
       title's phantom session header, and that one was right for a reason that
       does not apply here). The title screen had no run in progress, so a
       session header there described a session that did not exist. The arena
       seed is the opposite case: it is the hash of the run the player is
       standing in, and it is what makes a practice arena reproducible. The
       test for "is this debug data" is not how it looks, it is whether the
       state it describes exists — and deleting it would remove a feature to
       satisfy a screenshot reading. The reviewer's alternative ("replace with
       the active weapon name") would trade a real, unique value for a
       duplicated one, and would be wrong on the no-weapon case too;
     - "The radar is a nearly black disc with no visible sweep line, contact
       dots, or grid lines." THIRTY-FIRST report on that element, and the
       suggested remedy is still the fabricated contacts declined ten times;
     - "The circular boundary wall is rendered in low-contrast gray against
       the cracked earth texture ... increase boundary wall opacity to 80-100%
       with a bright white or cyan color." FALSE on the wall, and this is the
       finding that cost the most and returned the least, so it is worth
       recording in full.
       The wall is plainly legible in the frame — a segmented band running the
       full width of the capture, one of the most distinct things on the city
       screen. So I measured it anyway: I sampled two bands and got a 14-point
       gap, which is lower than the 17-19 the buildings get, and 14 is low
       enough to sound like a real finding. I built a fix — a value-only wall
       tint, on the reasoning that buildings separate by contact shadow and the
       wall has none, so it is the only prop relying on the grade alone, and
       the grade is luminance-preserving (`slate * lum`) so tone can never
       darken it. That reasoning is sound and the change is small.
       Then I measured the result and the wall was BYTE-IDENTICAL, and the
       capture's luma had moved 93.38 -> 93.17, so something had changed
       somewhere. Rather than keep adjusting numbers, I re-tinted the wall
       unmistakable green to find out where it actually draws. It drew on 279
       pixels in a small patch near the top of the frame — the entrance
       MARKERS, not the wall — which means the arc I had been sampling is not
       `prop-citywall` at all, and therefore the 14-point gap was a measurement
       of the wrong element entirely.
       So: reverted. The finding was false, the "gap 14" was an artefact of
       sampling, and the fix was aimed at a target I had never located. It is
       the FIFTH time in this log a sample box has nearly misled me (iterations
       12, 30, 33, 35, and now 50) and the rule has now cost real work rather
       than just time. The sharpened version, learned the expensive way: a
       measurement is only evidence if you have confirmed you are measuring the
       thing you claim. The tell was available before I built anything — a 0.86
       multiply that changed NOTHING is not a tuning result, it is a signal
       that the target is not where you think it is;
     - "All armour zones display '0/0' in red, which communicates damaged or
       destroyed rather than unarmoured." FALSE on all three counts, and the
       frame settles it: the ARMOUR block shows FRONT/REAR/LEFT/RIGHT/
       UNDERBODY each as a NEUTRAL dash inside a DASHED CHIP. Not red, not
       "0/0", and the dashed border is the thing the review asks to "add". It
       is iteration 21's fix, unchanged since, and iteration 9 traced the same
       chain that killed this exact claim for iteration 41. Worth noting the
       reviewer's own remedy is a description of the shipped design, which is
       the eleventh time that has happened and is the strongest available
       signal that a claim is stale rather than new;
     - "Weapon rows display '(empty)' in low-contrast muted text ... increase
       contrast to bright cyan or white." The NINTH report of this class and the
       second in consecutive iterations asking for exactly the opposite of
       iteration 17. Dim-and-italic on the unfilled slots is the whole point:
       the eye has to land on what is fitted. A tenth bright "(empty)" would
       put the loudest thing on the constructor in the state the player is
       trying to leave, and the reviewer's "add a left border to signal
       interactivity" is the amber requirement rail added in iteration 48,
       which exists precisely to mark unmet weapon slots.
     NO CODE CHANGED. Seven zero-real reviews in the last sixteen. The honest
     summary of where the loop has got to: the remaining models are re-issuing
     five solved complaints with fresh wording, and the most valuable output of
     a late round is the evidence that there is nothing left to fix — plus, this
     round, a much better way to tell a real finding from a bad measurement.

51. google/gemini-2.5-pro -> ZERO REAL, and the review that finally got an
   answer from the model that returned an EMPTY body in iteration 15. The
   harness fix held: 16000 max_tokens plus a prompt that demands the reply START
   with "[". Worth stating plainly, because "this model is broken" would have
   been a reasonable conclusion from iteration 15 and would have cost a real
   reviewer for the rest of the run.
     This is also the first review in the pool to arrive with a coherent THEME
     rather than five element-level defects, and all five of its findings are
     the same three positions, so it is worth taking as a whole:
     - "The UI is flat, opaque, dark rectangles with clean modern fonts ... it
       clashes with the textured, gritty pixel-art style ... use a distressed
       font, worn metal or cracked-CRT textures, bolted frames, scanlines."
     - "The title menu is a basic, dark, semi-transparent rectangle with plain
       white text ... frame it to look like a rusty metal plate, add a
       scanline flicker."
     - "Replace the condition list with a top-down vehicle schematic
       colour-coded green to red."
     These are the same two asks the loop has already declined on stated
     grounds — the menu is the EIGHTH report of "generic rectangle" (near-opaque
     since iteration 20, real fill on the selected row since 32) and the
     schematic is the seventh-plus report of "make the diagram a picture"
     (declined because the diagram exists to show armour zones the gameplay
       sprite cannot carry). The THIRD position is new, and it is the honest
       top-down "damage the parts" condition display, which iterations 25 and 29
       answered incrementally with real depleting bars rather than by rebuilding
       the panel around a picture.
       What this round changes is the STATUS of the theme item, not the item
       itself. Iteration 32 recorded that the scanline/bevel ask "needs
       concreteness before acting"; iteration 47 supplied a recipe and it was
       still held back as a theme decision; this model supplies a second,
       independent, full recipe. Two concrete recipes from two unrelated models
       is the point at which "we are choosing a visual language" becomes "the
       pool keeps asking for this language" — and the honest note is that the
       two are different questions. The panels are legible, grouped and
       consistent today. Restyling them is a decision about what SMDUEL looks
       like, it is not a defect, and it belongs to whoever is art-directing
       rather than to a defect list. Recorded as the top THEME candidate with
       both recipes attached, which is a materially better place for it to sit
       than the 49th repetition of "the menu is a plain box";
     - "The ground is a small, obviously repeating tile texture ... break up the
       repetition, use a texture atlas or shader blending to mix in variations."
       FALSE as a description and the proposed remedy is the one this codebase
       already TRIED and MEASURED as worse. `src/render/ground.ts` argues exactly
       that in its own header: a per-cell grid of different textures meeting at
       hard edges produces "a visible grid of seams — measurably worse than the
       repetition it was meant to fix", and the current design is one quad with
       world-space `fract()` UVs so there is no interior boundary for a variation
       to show along. Repetition is already broken the seam-free way: a second
       non-commensurate detail scale cross-faded in 9m patches, plus the post
       pass's grain. Every pool names exactly ONE base frame, deliberately, and
       the module says so. Measured ground spread is 25.56 (road), 13.25 (arena),
       10.26 (city) — the city is the flattest, which is a fair reading, and the
       city's usable second frame does not exist: `tile-citypave` and
       `ground-arena-a` are both rejected in place, for good reasons (a manhole
       and a painted circle are FEATURES, and a strong feature in a tile that
       repeats every few metres stamps itself across the whole map). A real fix
       is new ART, not a code change, and is recorded as such;
     - "The constructor schematic is a static, abstract line drawing that does
       not visually change as the player selects or adds parts." FALSE, twice
       over, and the second half was proved in iteration 42: the schematic is
       GENERATED from the chosen part, so changing body already changes its
       proportions, hull, wheelbase and every zone band, and iteration 33 added
       the selected-row-to-zone LINK. A static capture cannot show what happens
       on selection, which is the same limitation that has made this claim
       unfalsifiable for eight reviews.

     ONE REAL FINDING, and it is documentation rather than pixels. Chasing the
     repetition claim led to the one place in the repo that explains WHY the
     ground is a single quad — and it no longer matches the code. Four
     comments across three files still describe a per-cell grid architecture
     that was deleted:
       - `src/render/ground.ts` credits the seam-free de-repetition to
         "`valueJitter`, a per-cell brightness offset (see `groundField`)".
         Neither `valueJitter` nor `groundField` exists anywhere in the repo;
       - the same file's argument for one-frame pools leaned on a mechanism
         that had been removed, so the strongest comment in the module was
         citing a phantom;
       - `src/app.ts` sized ground capacity "see `groundFieldCellCount`" and
         described the ground as "a varied field whose extent is whatever covers
         the visible area" — there is no field, and no such function;
       - and `cityGroundTileCount`'s own docblock claimed it was "the exact
         ground-cell count `groundField` emits ... delegates to
         `groundFieldCellCount`", TWO LINES BELOW a constant stating the city
         ground is "a single quad ... so its layer-0 capacity is 1". A comment
         that contradicts the line above it is worse than no comment.
     All four now describe what the code does: one quad, no cells, and the real
     seam-free levers (the non-commensurate detail scale, the post-pass grain).
     This is worth doing on its own merits, but the reason it came up is the
     finding: a reviewer proposed changing how the ground varies, and the file
     you would open to do that confidently described an architecture that had
     been gone for many iterations. Stale docs do not fail a build, and this
     review is the second in a row to propose work in this exact area.

52. openai/gpt-5.1-codex-mini -> 1 REAL (small, and the same signal the entrance
     markers gave twice), 4 FALSE or inapplicable:
     - "The colored arrows have no on-screen labels ... the tiny corner legend is
       too small to quickly associate icons with actions. Enlarge it, add hover
       tooltips on each icon."
       HALF REAL, and the half that survives is the size, on exactly the
       reasoning that has already fired twice in this log for this element.
       Iterations 19 and 20 both enlarged the entrance markers because a
       reviewer who had ALREADY seen the enlargement still could not find them,
       and the rule that came out of it — believe the NUMBER, not the report —
       applies here without modification: this reviewer is looking at the legend
       added in iteration 39, eleven reviews ago, and still calls it too small.
       Checked the contrast first rather than assuming: the legend's #9fb0c2 on
       its 0.78-alpha panel measures 7.23:1 over average city ground (6.68:1
       over the brightest plausible ground), which clears AAA. Iteration 13's
       speedometer fix was a real 4.61:1, so this is not that case and the
       colour was left alone — this is a legibility nudge, not a contrast fix.
       What WAS wrong, and it is a better find than the size: the legend's 11px
       was HARDCODED. Every other piece of UI in the game reads a token off the
       scale (10px panel titles / 11px secondary / 12px hints, reasons, stats /
       13px HUD body / 15px menus and prose), and this one element — built as a
       bare inline cssText block, which is why it had no stylesheet to be held
       to — sat a step below where its role puts it. A KEY is a stats line, not
       a secondary label. It now reads `var(--ui-text-sm)` and its swatch goes
       9px -> 10px, which also means the one element teaching the city's colour
       language can no longer drift off the scale again.
       One step, deliberately. The markers were DOUBLED because they were being
       lost against the ground; this is already legible, so doubling it would be
       an over-correction dressed as responsiveness;
     - "Add hover tooltips on each icon." INAPPLICABLE, and worth naming as a
       category rather than a mistake: this is a WebGPU canvas. The city map, the
       markers and the car are all drawn into a single <canvas> and there is no
       DOM element to hover and no hit-testing to attach a tooltip to. The
       remedy the review asks for cannot be built without a UI the game does not
       have. The legend is the DOM-side answer to the same need, and it exists;
     - "The 'Reduced flash' / 'Reduced shake' toggles are always visible,
       crowding the HUD with debug information ... remove them or move them into
       a collapsible menu." FALSE on the "debug" framing, and the second report
       of this class after iteration 39 recorded the same thing. These are
       labelled accessibility controls, not a debug readout — the test the loop
       already applied to the title's phantom session header is whether the
       state they describe exists, and reduced-flash and reduced-shake are real
       settings a real player may need mid-run. The suggested fix is also the
       exact trade iteration 39 declined: hiding them behind a menu means a
       player who needs reduced shake has to find a menu mid-combat, which is
       the access the on-screen placement exists to guarantee. They sit in a
       corner, in a panel, and they are not crowding anything — the frame shows
       them clear of the radar, the speedometer and the centre;
     - "Increase the bar's thickness to at least 4px." FALSE, and the first
       time a reviewer has asked for LESS than the element already is. The
       rendered bar including both borders is 8px, measured by scanning a column
       through it in iteration 29 (dark track y=46..50, borders at 45 and 51).
       "At least 4px" is half the shipped value, and "add a darker outline or
       background track" describes a track that is already near-black with a
       border. The teal-to-blue fill on that track measures about 9:1, and the
       zero-fill state it is reading is the honest report of zero miles driven;
     - "The constructor rows are tightly packed with no separators ... struggle
       to see which row is selected ... highlight the active row with a
       contrasting fill." FALSE, and this one was worth measuring because "you
       cannot see the selection" is the exact shape of the iteration-32 bug,
       where a rule looked correct and rendered nothing. Traced it rather than
       reading the CSS: the selected row uses `var(--ui-accent-wash)`, which IS
       declared (tokens.css:160, rgba(95,208,189,0.14)) — so unlike iteration 32
       this declaration is not silently invalid. Measured the real frame: the
       selected row's interior luma is 61.2 against 37.6-39.6 for unselected
       rows, a ~22-point separation plus a full accent border. It is the most
       visible row on the screen. The separators are also not missing — there is
       a section rule above Weapon 1 (iteration 17) and the unmet-requirement
       rails (iteration 48) — and this reviewer's own screenshot shows the Name
       field with its placeholder, which is iteration 30's work.

53. google/gemini-3.1-pro-preview -> 1 REAL, and it reopened a decision this
     loop got wrong thirty-four iterations ago. 4 FALSE, three of them the
     static-frame classes:
     - "The navigation chevrons are flat, 2D vectors layered directly over gritty
       3D structures without any grounding visual elements ... they appear
       completely disconnected from the world space (like graphical glitches),
       making it difficult to judge exactly which physical building they are
       anchored to. Add a dark, soft drop-shadow on the ground directly beneath
       each chevron."
       TRUE, and the sharpest description of the marker problem in the log,
       because it is the first one to name the AXIS rather than the number.
       Nine reviews have now said something about these markers and they split
       cleanly into two unrelated complaints: "too small / lost against the
       ground" (iterations 19, 20, 26) and "too loud / a field of roadwork
       signs" (iterations 33, 47). Both were answered on the SIZE axis, twice
       each, and neither could fix this one, because size and anchoring are
       orthogonal. A bigger flat chevron is MORE disconnected, not less. This is
       also the same objection iteration 11 raised about the waypoint beacon —
       a thing that reads as an overlay rather than as part of the world.
       So the markers now carry a ground shadow, soft (0.9) and moderate (0.5)
       rather than a building's 0.3/0.62: a building is a solid mass casting a
       tight contact shadow, while the marker is flat signage lying ON the
       ground and wants a diffuse pool. City luma and spread are unchanged
       (93.16/63.14 against 93.17/63.99), so the anchoring cost the frame none
       of its measured range — which matters, because the complaint in
       iteration 47 was that the markers were too loud.

       AND THIS REOPENS ITERATION 19, which was decided wrong.
       Iteration 19 added these same shadows, overshot the buffer, and concluded:
       "growing a GPU buffer budget to fit a nice-to-have shadow is the wrong
       trade, so the shadow is what goes." There is no fixed budget to grow.
       `95/95` appears in this codebase ONLY inside comments — the capacity is
       derived by `cityLayer1InstanceCount`, and `buildCityRenderResources`
       allocates the buffer from it. The contract was never "no shadows", it was
       "move the count with them", which is the entire purpose of that function
       and what its own comment instructs. The overshoot was a failure to update
       a count, and it was read as a POLICY about shadows instead.
       The difference between then and now is that a shadow was a nice-to-have
       and a review has now made it the actual ask — but the decision was wrong
       then and would have been wrong for any reason. A real improvement was
       reverted for thirty-four iterations on the strength of a misreading, and
       the only thing that unblocked it was a reviewer describing the symptom
       correctly instead of the loop re-deriving the cause correctly.

       THE GUARD FOR THE CLASS, since I was about to hand-edit a count again:
       nothing in the test suite compared emitted instances to the claimed count.
       The only check was the runtime `writeInstanceBuffer` bounds test, which
       does not degrade gracefully — an overshoot is a WebGPU validation error
       that renders the whole city screen BLANK. That has now caught two real
       bugs at runtime (the invisible beacon in iteration 8, these shadows in
       iteration 19) and never in a test. There is now a test comparing
       emitted-to-claimed across both city sizes, and it is PROVEN to fire: it
       was written, then the count was deliberately walked back from 4 to 3 and
       it failed with "layer-1 count drifted for providence: expected 60 to be
       59", and restoring the count made it pass. Writing the test is not the
       same as knowing it works, and this loop has been bitten by that
       difference before.
     - "The radar is a flat dark circle with a single center triangle, lacking
       range rings, sweep lines, or any grid markers." THIRTY-SECOND report, from
       a model in the Gemini family that has now produced it eleven times
       (iterations 1, 5, 7, 11, 12, 15, 16, 17, 18, 22, 23, 24, 25, 26, 27, 28,
       29, 30, 33, 34, 35, 36, 38, 40, 41, 43, 44, 45, 46, 47, 48, 49, 50, 51,
       52, 53 — and its own suggested fix is again the fabricated contacts
       declined eleven times);
     - "The progress bar is a 1-pixel thin white line ... lacking an opaque
       container ... increase thickness." FALSE, and now the THIRD consecutive
       review to ask for less than the element already is: 4px here, 4px last
       round, and it renders 8px including borders (measured by column scan in
       iteration 29). The "opaque container" also exists — it is the status pill,
       raised to 0.86 alpha and 13.20:1 in iteration 24 for exactly the
       moving-texture-behind-it problem this describes;
     - "The speedometer dial has only dark grey tick marks, no needle or active
       fill ... add a needle that sweeps as speed changes." FALSE, and checked in
       the code rather than the frame because this is the exact class of claim
       that hides a wiring bug (iteration 41's rule: trace the chain, don't read
       one line). `hud.ts` sets `--hud-speed-frac` from
       `mph / maxTopSpeedMph` and `hud.css` consumes it as a conic-gradient
       value wedge running clockwise from 12 o'clock, over 4 major and 24 minor
       ticks, with a track, a border and a hub. The instrument is complete and
       driven. It reads as empty for the same reason the progress bar does: the
       capture is a vehicle AT REST, so the wedge is legitimately 0 degrees.
       Third instance of the static-frame class after iteration 22's empty bar
       and iteration 46's "0 mph means broken";
     - "The constructor stat labels are far-left while values are far-right,
       creating a massive gap of empty dark space ... risks reading the wrong
       row." The gap is REAL and I measured it, and both of the offered remedies
       are worse. The right-aligned value column is deliberate: it is what makes
       the block scannable as a table, and iteration 27 recorded the alignment
       as load-bearing for the 0-9 typing model, where every row's value has to
       sit in the same column. "Tighter columns" abandons that. "Dotted leader
       lines" is a print-table device that would push the block toward the
       spreadsheet look iteration 17 explicitly moved away from when ten
       "(empty)" rows were described as "a debug console or spreadsheet". The
       width itself is the screen's grid (`minmax(240px, 1fr)` of a 2.3fr
       two-pane layout), not a stats-specific choice, so capping it would just
       move the empty space. Recorded as a design observation rather than
       changed — the same category as the preview "make it a picture" asks, and
       the first reviewer to frame the stats block's alignment at all.

54. google/gemini-3-flash-preview -> 1 REAL (half a finding), 1 half-real that is
     a lie about gameplay, 3 FALSE:
     - "The armor and tyre status use thin green bars ... the thin green lines
       are too delicate to read at a glance ... increase the thickness of the
       status bars." REAL, and the second time this has been asked in this
       shape. Iteration 29 was told the condition indicators were "tiny colored
       dots (approx 4px) ... difficult to distinguish" and the bars were the
       answer; the bars then landed at 4px for armour and 3px for tyres, which
       undercuts the reason they exist. A bar exists so that LENGTH is the
       pre-attentive read, and 3px is thin for that job in a combat panel the
       player is supposed to read in a fraction of a second. Now 6px and 5px.
       Deliberately the ONLY change in the panel, because the rest of the same
       finding is false by a wide margin: "semi-transparent dark background ...
       the text bleeds into the ground textures ... add a solid high-opacity
       backing plate." The glass tokens are 0.78/0.80 alpha, but the panel also
       carries `backdrop-filter: blur(6px)`, and that blur is the part that
       answers this specific complaint — it removes the high-frequency ground
       detail that the iteration-24 status-pill argument was about. Measured,
       #e9eff6 on the composited result is 24-55:1 against the brightest
       plausible arena ground. Raising the opacity would spend legibility the
       panel does not need, so colour and contrast are untouched and only the
       bar grows;
     - "The vehicle lacks a contact shadow or ambient occlusion bake underneath
       it, making it appear to float above the tiling textures." FOURTH report
       of this class (iterations 15, 18, 43) and the first one I have been able
       to settle with a MEASUREMENT rather than a code citation, which is the
       right way round. Sampled the arena: ground directly beneath the car reads
       143.2 luma against 153.7-156.8 in the same band either side of it and
       153.2 further away — a consistent ~8% darkening under the car and
       nowhere else, which is the analytic contact shadow the shader has carried
       since iteration 1. Worth noting the two earlier attempts at this check
       sampled INSIDE the car's own bounding box and read the orange body as
       "ground", which is the sampling error from iteration 50 in a new costume:
       the fix there was to confirm what you are measuring before you trust the
       number, and it applies to a measurement as much as to a crop;
     - "The building sprites are disproportionately small compared to the
       vehicle and the vast empty ground ... increase the scale of building
       clusters by 1.5x." DECLINED, and the first reviewer to name a
       consequence for this one. `layout.tileSizeM` is assigned
       `interactionRadiusM` in `generateCityLayout` and `buildingInstances`
       sizes every facility sprite at exactly that: a building's drawn footprint
       IS the ground in which the player can interact with it. Scaling the art
       1.5x would make each building claim 2.25x the area it actually responds
       to, so the player would drive toward a door that turns out to be out of
       range. That is the same trade declined in iteration 21 (painting walls
       that do not exist) and iteration 28 (drawing instruments that can never
       move): a visual that misreports a real affordance is worse than a plain
       one. The eleventh-plus report of the city feeling empty, and the first to
       identify the emptiness as a SIZE problem — which it cannot be, for this
       reason;
     - "Add secondary decorative 'rubble' or 'sidewalk' sprites around the base
       of interactive buildings to ground them." The right instinct and blocked
       by geometry rather than principle: the facility ring already TILES
       EDGE-TO-EDGE at `tileSizeM` (documented at `buildingInstances`), so there
       is no ground between buildings for a sidewalk to occupy — any dressing
       would overlap a neighbour. Making room means changing the ring spacing,
       which is a layout change and not a decoration. Recorded, not faked. Note
       that iteration 53's count-drift test is what makes this tractable at all:
       dressing would add instances, and before that test the only guard was a
       runtime bounds check that blanks the whole city screen;
     - "Dim the '(empty)' text to 30% opacity to highlight active components."
       ALREADY DIMMED, and this is the tenth report of this class with the
       requests now running in BOTH directions — iterations 49 and 52 asked for
       it BRIGHTER, this one asks for it dimmer, and iteration 17 set it to
       `--ui-ink-dim` + italic specifically so fitted weapons are what the eye
       lands on. The two asks cannot both be satisfied, and the settled answer
       is the one that keeps the fitted state loud;
     - "Reduce the contrast of the ground texture noise and add a subtle
       vignette or 'speed blur'." The first half is iteration 31 (base value)
       and iteration 34 (high-frequency-only compression), both measured. The
       vignette is a post-pass effect and a theme decision rather than a defect,
       recorded alongside the HUD-restyle theme item with the same status.

55. google/gemini-3.1-pro-preview-customtools -> ZERO REAL. Nothing changed.
     The finding worth the round is not one of the five: it CONTRADICTS the
     reviewer before it on the same axis, one round apart.
     - "The player's car sprite is visually larger than the surrounding
       industrial buildings ... scale the car down to roughly 15% of its current
       size so it fits realistically alongside the building assets." LAST ROUND,
       a different model, said the opposite about the same frame: "the building
       sprites are disproportionately small compared to the vehicle ... increase
       the scale of building clusters by 1.5x." One says the car is too big, the
       other says the buildings are too small, and they are reasoning from the
       SAME capture. Both cannot be satisfied, and the reason is that BOTH sides
       are pinned to real units:
         the car's drawn size is its collider dimensions from driving.json
           (subcompact 3.8m, midsized 4.8m, luxury 5.3m);
         a building's drawn size is `layout.tileSizeM`, which `generateCityLayout`
           assigns `interactionRadiusM` — the ground in which the player can
           actually interact with it.
       So shrinking the car 15% would make it stop matching its own collision
       box and the road it drives on, and growing the buildings 1.5x would make
       them claim 2.25x the area they respond to (which is why last round's ask
       was declined). Neither is a styling knob; both are a lie about an
       affordance. That is the trade declined in iterations 21 and 28, and this
       pair of reviews is the clearest evidence yet that the CITY SCALE is
       under-determined in the frame: the player has no reference for real size
       there, so the pool reads the same picture as "too big" or "too small"
       depending on which object it starts from.
       The fix is a REFERENCE, not a rescale — the same shape of answer as the
       arena's declined boundary markings and the road's declined compass. That
       is a layout and gameplay question, not a review finding, and it is
       recorded as the top open design item rather than actioned;
     - "The ground textures are heavily pixelated and blurry while the car
       sprite and UI are crisp at a much higher resolution ... it shatters
       visual cohesion." The observation is fair and it is the NEAREST-sampler
       class arriving with its best framing yet: not "the ground is ugly" but
       "the ground and the focal object are at different resolutions". The cause
       is unchanged and documented — the ground reads inside an atlas sub-rect,
       so linear filtering would bleed the neighbouring cell. The first remedy
       (match the ground's texel density to the car) is the dedicated
       linear+repeat texture this log has deferred since iteration 6 and it is
       an ART task, not a code one. The second remedy — "apply a pixelation
       shader to the car to unify the style" — is declined outright, because the
       car is the focal object of every frame and degrading it to match its own
       background is the wrong direction to unify in;
     - "'Body armor' is rendered in a dark, saturated red against a dark gray
       background ... nearly invisible ... fails baseline contrast." FALSE, and
       worth the measurement: the plant and driver rows render in
       (90, 212, 111) — GREEN — at 9.76:1 against the panel's (16, 20, 24). The
       most saturated red anywhere in that region is (255, 85, 112) at 5.98:1,
       which is `--ui-critical` and clears AA. There is no dark saturated red
       and nothing nearly invisible. Iteration 23 made the same global
       "insufficient contrast" claim, iteration 38 measured `--ui-critical` at
       8.08:1, and iteration 41 traced this exact chain after suspecting the
       iteration-32 silent-CSS shape. It is worth being blunt about the pattern:
       a review that names a specific string and a specific colour is still
       describing a colour it did not sample;
     - "The radar is a near-black, featureless disc with very faint concentric
       rings and no sweep line, crosshair, or prominent grid." THIRTY-THIRD
       report, and this one asks for "brighten the concentric grid lines, add an
       intersecting crosshair for the center axis" — describing the rings and
       crosshair that iteration 2 added, which every capture since has shown;
     - "Every piece of text uses the exact same monospace size and weight ...
       CONFIRM blends in completely." FALSE, and it is the ELEVENTH report of
       the CONFIRM class. It is a filled accent-bordered primary button
       (iteration 15) in a pinned footer outside the scroll region (iteration
       39), inside a type scale running 10/11/12/13/15px with distinct section
       weights. Its companion ask — "drop the opacity of all non-actionable
       '(empty)' text to 40%" — is the ELEVENTH report of that class too, and
       now the third in three rounds to ask for the OPPOSITE direction:
       iterations 49 and 52 wanted the empty slots brighter, this one wants them
       dimmer, and iteration 17 settled it at `--ui-ink-dim` + italic so the
       fitted state stays loud.
     NO CODE CHANGED. And the round's real product is the contradiction itself:
     two reviewers, one frame apart, disagreeing about which half of the city to
     shrink. That is a more useful signal than either finding alone, because it
     locates the problem in a missing reference rather than in either sprite.

DEFERRED (real, documented, not bugs):
- TITLE ART SHOWS TANKS, NOT CARS (iteration 36) - the top art item. It is an
  asset regeneration, not a CSS change, and it must not be faked with a filter.
- City daylight grade (my 0.6 ground tint is why it reads dim), street network,
  10 empty weapon rows.

Tooling: `node tools/review.mjs --list | --model <id> --shots <dir>`
Reviews: .opencode/reviews/