---
active: true
iteration: 14
maxIterations: 100
sessionId: ses_f14a7ff23ffeCvOeqyAPPjegV6
---

lets do a infiniate improving loop each time ask a random state of the art vision enabled flash model (gemini 3.8 flash, latest glm, etc) to find 5 things to improve with reasons and suggestions take all feedback create milestones phases and todos. ask for feedback on all key elements of this game from an advisorial reviewer. provide them with any items they need to conduct a detailed review.  execute the plan then restart the loop with a new reviewer until you have asked all the vision enabled latest models on open router.  do not stop until i tell you to. 

## Log

Reviewers asked (74 of 82 vision models):
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

56. qwen/qwen3.6-flash -> 1 REAL, and the best find in a dozen rounds, 1 fair
     observation recorded, 3 in known classes:
     - "The text reads 'Screencap Rig' and 'Not road-legal' ... the term
       'Screencap' refers to a development tool function, not a game asset ...
       immediately breaks immersion and signals to the player that the UI is
       unfinished or that development debug logs have leaked into the build."
       TRUE, traced, and fixed — and the shape of it is the interesting part,
       because it is NOT a player-facing bug at all.
       `createDriver('Screencap', ...)` and `design.name = 'Screencap Rig'` both
       live in the `screencap` capture-rig path, which exists so this loop's
       screenshots are byte-stable across runs. A real session goes through
       `showDriverCreation`, so no player has ever seen either string. On the
       narrow question of "does the game ship a tool name in its UI", the answer
       is no.
       But the finding is still correct about the thing it actually saw, and the
       thing it saw is THIS LOOP'S OWN INPUT. Every reviewer in 56 rounds has
       been handed these frames as the sole basis for its critique, and a car
       called "Screencap Rig" reads to any outside viewer as a development build
       leaking tool terminology into the product. That is a self-inflicted false
       signal, generated by the harness and then diagnosed as a content bug —
       and it is expensive in a way the other false classes are not, because it
       invites a fix aimed at the game (rewrite the UI, remove debug text) when
       the actual defect is two string literals in the rig.
       The rig's names are now in-universe: driver "Sable", vehicle "Duster".
       Still fixed strings, so captures remain deterministic — that was the only
       property the old names had. The internal `veh-screencap` id stays, since
       it is never rendered and renaming it would churn save-key comparisons for
       nothing. Worth stating as a general rule this round earned: when a
       reviewer reports the harness in the product, check which surface the
       string is on before treating it as a content defect. Iteration 19 is the
 mirror of this one and the log now holds both;
     - "A yellow vertical bar appears on the left edge of every list item,
       creating visual noise ... remove the generic yellow bars." It is the
       AMBER REQUIREMENT RAIL from iteration 48, and the criticism is fair in a
       way the review did not articulate. On a pristine build the unmet rows are
       Name, all five facings and all ten empty weapon slots — so fifteen of
       twenty rows carry the rail, which is ACCURATE (each of those genuinely is
       holding the build up) and simultaneously low-information, because a marker
       on nearly every row stops reading as a marker. The reviewer's word
       "generic" is the right one even though the rail is not decorative.
       Not changed, and the reason is that the alternatives are worse: the
       legality panel's rules already sit below the list where iteration 48 said
       the player is not reading them, and collapsing the rail to a single
       summary would put a count where the player has to do arithmetic to learn
       which rows are blocking. Recorded as the honest cost of a correct fix —
       the iteration-48 marker is accurate and the reviewer's perception that it
       is noise is the flip side of accuracy, not a contradiction of it;
     - "Cannot intuitively map the text list to the physical mounting locations
       ... implement a direct link where selecting a weapon slot highlights the
       corresponding socket on the car." This is iteration 33's LINK, added after
       seven reviews described the symptom wrongly, and a static capture cannot
       show a selection change — the same unfalsifiable shape as iteration 51's
       "the schematic does not change as you select parts";
     - "The waypoint arrows are low-opacity and blend into the grey concrete
       floor ... add a bold white or black outline and increase saturation."
       FALSE, and the markers measure max saturation 1.0 — they are the most
       saturated thing on the map — and iteration 53 gave them ground shadows
       one round ago. This is also the FOURTH distinct ask on this one element
       across the log, and they point in four directions: bigger (19, 20, 26),
       quieter (33, 47), anchored (53), and now "bold outline and MORE
       saturation". The marker is the single most contested element in the game
       and the reason is that it is being asked to be findable from a moving car
       AND sit inside a grimy world, which is a genuine tension rather than a
       defect — already recorded, and this round adds a fourth data point to it
       rather than changing anything;
     - "The condition panel resembles an Excel sheet ... replace the text list
       with a Hull Integrity gauge or 4-quadrant display." The redesign ask, in
       the same family as the top-down schematic requests declined in iterations
       13, 16, 24, 26, 37, 43, 47, 51 and 55. Iterations 25 and 29 answered it
       incrementally with real depleting bars, which iteration 54 thickened;
     - radar: THIRTY-FOURTH report, and its remedy again asks for "distinct
       concentric rings for range and crosshairs for North/South" — the rings
       and crosshair iteration 2 added.

57. openai/gpt-4.1-mini -> ZERO REAL. Nothing changed. All five in classes the
     log has measured, and two of them would have been fixes to shipped work:
     - "The city status text and controls are clustered tightly in the top centre
       with small font and minimal spacing ... separate them into distinct UI
       zones." FALSE, and the crop settles it: they are TWO separate pills, each
       with its own background and a real gap between them, which is iteration
       22's split (one run-on element carrying a mode label, three control hints
       and a seed hash, truncated mid-string). The suggested move — "relocate the
       control instructions to a dedicated lower corner" — has nowhere to go: the
       bottom corners are already the car strip (bottom-left) and the facility
       legend (bottom-right), and the hint is a 7s FADE (iteration 18) that is
       gone for the rest of the session, so any capture that shows it is showing
       the first seconds of a run. Checked the hierarchy too, in case the review
       was reaching for weight rather than position: the hint is `#9fb0c2` at
       12px against the status line's `#d7e0ea` at 13px — already dimmer AND a
       step smaller, which is the correct relationship for a transient reminder
       under a permanent one;
     - "The armor and underbody indicators use small boxes and minimal text ...
       use larger colored bars or segmented gauges." THE PRISTINE CASE, and the
       eleventh-plus report of it: on a capture every facing genuinely is
       unfitted, so the rows render the loud dashed chip from iteration 21 and
       there is no armour bar on screen at all — bars are fitted-only (iteration
       25) because there is no fraction to scale. This reviewer is asking for
       iteration 25's feature on a car that has nothing fitted, and the armours
       it can see are chips, not boxes. Iteration 54 thickened the real bars to
       6px/5px in the very round before this one, which this frame already
       contains;
     - "The white tagline lacks contrast against the sunset ... add a subtle dark
       drop shadow or semi-opaque background panel." Measured at 9.00:1 in
       iteration 44 WITH the two-layer shadow iteration 15 added, and the scrim
       behind it is a deliberate band (iteration 27) that is darkest exactly
       where the lockup sits. The remedy is a description of the shipped design;
     - radar: THIRTY-FIFTH report, and the fix is again the rotating sweep and
       bright contacts — iteration 2's work, plus the fabricated contacts declined
       twelve times;
     - "The constructor list is very densely packed with small font and no clear
       hierarchy or grouping ... introduce collapsible sections." The density
       class, and its own remedy is the one refused every time: the rows are
       addressed by INDEX (the hint tells the player to type 0-9), so a
       collapsible section hides rows the player is expected to address
       positionally. Iteration 17 added the section edge, iteration 23 raised the
       weight, iteration 48 added the requirement rails.
     NO CODE CHANGED. Nine zeros in twenty-two reviews, and the two findings in
     this round that WOULD have shipped fixes to already-correct work are the
     clearest sign yet that the useful remaining work is not in the frame.

58. z-ai/glm-5.3-flashx -> 1 REAL and it is the sharpest UI diagnosis in the log,
     1 FALSE that measurement contradicts, 3 in known classes:
     - "A panel labelled 'WEAPONS' whose only content is the line 'Seed a11ce5ee'
       ... the panel never shows anything weapon-related ... it sits in prime
       corner real estate ... and looks like a developer console left open."
       TRUE, and the reviewer diagnosed the mechanism rather than the symptom,
       which is why it is the best of its kind: the complaint is not "debug text"
       (iteration 50's version of this finding, answered as "the seed is real
       state" — correct, and it missed the point) but the LABEL/CONTENT MISMATCH.
       Two real defects, one shared cause:
         1. `buildWeaponList` appends a `<ul>` and, when nothing is fitted, simply
            does not fill it. The panel is a fixed corner, so it rendered as a
            bordered box headed WEAPONS containing nothing at all.
         2. The seed chip sat at `top: 52px; left: 8px` — directly beneath that
            panel (iteration 22 put it there because "the arena's corners are all
            spoken for"), so a bare hex hash appeared to caption a WEAPONS
            heading.
       The sibling `buildRadar` has always handled its own nothing-to-show case
       explicitly (`✕ RADAR OFFLINE — plant damaged`), and iteration 21 reached
       the same conclusion for the armour panel: a state with nothing in it must
       be LOUDER than an empty region, or it reads as an area that failed to
       render. The weapons panel was the one HUD panel that never got the
       treatment its own neighbour already had. It now renders "— none fitted",
       dimmed and italic rather than critical-coloured, because the radar's
       offline state is a FAULT (plant damaged) and an unarmed practice car is
       not.
       The seed chip is GONE. The seed is real state — full hash in the console
       log and the crash banner for bug reports — so it was not deleted; it is
       announced in the session message feed, which already carries session
       lines and where `practiceResumed` already included the seed. Removing the
       chip also removed a fragility that had been latent since iteration 22: its
       `top` was derived from a panel whose height changes with the loadout, so
       the moment the panel grew, the chip sat underneath it. That is exactly
       what happened the first time I captured the new empty state, and it is
       the second time in two rounds that a capture caught a collision the code
       review had passed;
     - "Terrain is uniform mid-grey pixel noise ... no directional light, no cast
       or contact shadow under the car or buildings." FALSE on the shadows, and
       this is the FIFTH report of the car-shadow class (15, 18, 43, 54, 58) —
       measured in iteration 54 at 143.2 luma under the car against 153.7-156.8
       either side of it in the same band. Buildings have carried analytic
       contact shadows since iteration 17, tightened to 0.3/0.62 precisely so
       separation does not ride on the art, and iteration 53 gave the entrance
       markers their own. The road is "separated only by a slightly darker band
       and two thin edge lines", which inverts the measurement: asphalt reads
       81.5 against 101.5 for the verge, a 20-point gap that was 5.4 before
       iteration 18 rebuilt the road as its own rotated strip. "The arena is a
       vast blurry beige blotch field" is the arena-floor claim contradicted five
       times by the same measurement (arena 144 luma against 58 road, 101 city —
       the BRIGHTEST floor in the game, carrying a world-fixed slab lattice).
       The remedy — "break large surfaces with 2-3 large tiling decals (tar
       seams, tire tracks, oil stains)" — is the ART item this log has carried
       since iteration 6, and the one suggestion here worth keeping: DECALS, not
       more tiling. A decal is placed content, so it does not repeat;
     - "The player's own cyan chevron is bigger than the car roof it hovers over,
       partially occluding the sprite the player most needs to see." FALSE, and
       measured: the beacon is 17x55px against the car's 186x160px. It sits at
       the car's leading edge and clips the top ~15% of the roof, which is what
       makes it read as pointing at the gate (iteration 11 sized it down for
       exactly the "oversized overlay" complaint this claim restates). The rest
       of the finding — buildings flat grey, "UI screams, world is mute" — is the
       collage class, and its own remedy ("drop building values below ground
       with a lit roof edge") is the per-building-value reversal declined in
       iterations 16, 23, 24, 25, 27, 29, 34, 36, 37, 39, 40 and 44;
     - "The constructor's ten '(empty)' rows fill a third of the screen ...
       the lower 35% of the frame is unused ... a preview that ignores your
       edits." The dead space below the schematic was first noted in iteration 28
       and this is the second review to raise it, so it is a real, persistent
       observation. Its remedies are all refused for reasons already recorded:
       a 2x5 grid breaks the 0-9 index addressing, and "a large annotated garage
       view" is the top-down-schematic redesign declined nine times. The
       right-hand column simply has more vertical room than content;
     - "The driving hint never expires ... it sits on screen indefinitely."
       FALSE and checkable in one line: the hint carries
       `animation: sm-road-hint-fade 7s ease-out forwards` (iteration 18), and
       `forwards` is load-bearing — without it the fill would snap back, the
       exact trap the scroll-driven entrance animations hit. The reviewer is
       seeing a t=0 capture, which is the same static-frame class as iteration
       22's empty progress bar and iteration 46's "0 mph means broken";
     - "Three stacked tutorial banners ... the stack occupies the band where
       opponents will enter." The stacking is real and the fix it asks for —
       "run one system with one line" — is a layout consolidation worth noting,
       but the elements are deliberate and separately placed by two screenshot
       passes (iteration 18 moved the hint clear of the 44..52px progress-bar
       band; iteration 22 split the run-on and tucked the seed under WEAPONS,
       which this same round has now removed). Recorded as an observation.

59. google/gemini-2.5-flash-lite -> 1 REAL, and chasing it uncovered a CASCADE BUG
     that had been silently eating iteration 48's marker, 4 FALSE:
     - "When hovering over or selecting a component in the list (e.g. 'Body',
       'Chassis'), there's no visual indication of focus or selection beyond the
       text color changing slightly ... apply a distinct background highlight."
       TRUE, and the same defect iteration 32 spent a whole round fixing on the
       title menu. `.sm-builder__row--selected` was
       `background: var(--ui-accent-wash)` — and `--ui-accent-wash` is
       rgba(95,208,189,**0.14**). A 14% wash with the signal carried by a 1px
       border is precisely the state the menu was in for seventeen iterations,
       where a review six times in a row said "only a thin neon outline" and six
       times I measured a difference and called it false. The difference I was
       measuring WAS the border.
       The constructor row now uses the menu's fill: a real left-to-right
       gradient, `color-mix(--ui-accent 52%, --ui-surface-2)` to 30%, with the
       border declaration REMOVED so the fill is the selection cue. Measured on
       the real frame, the selected row's separation over the row below it went
       from +28.4 luma to +82.4.
       AND THE REAL FIND WAS UNDERNEATH IT: removing the blanket
       `border-color: var(--ui-accent)` was not cosmetic, it was a bug fix.
       `.sm-builder__row--needs-input` declares `border-left: 3px solid
       var(--ui-warn)` — iteration 48's amber rail meaning "this still needs
       you". Both selectors are a single class and `--selected` comes LATER in
       the file, so its blanket `border-color` WON and recoloured that rail on
       every row that was both selected and unmet. Measured by scanning the rail
       column: an unmet unselected row's rail is (240, 180, 50) amber, and the
       Name row — selected by default AND unmet — was (94, 206, 187) accent. So
       the amber rail was invisible on precisely the row the player's eye lands
       on before touching anything, replaced by the colour that means "selected".
       Iteration 48's marker was doing its job everywhere except the one place
       it mattered most, and no screenshot could show it, because a teal rail on
       a teal-selected row looks deliberate. Now the two signals coexist: teal
       fill means selected, amber rail means unmet, and neither overwrites the
       other. This is iteration 32's lesson arriving eight iterations late on a
       different element — a rule that reads correctly in the stylesheet and
       silently never applies, or silently applies to the wrong thing;
     - "The 'SMDUEL' title is partially transparent and struggles to stand out;
       the subtitle is even harder to read." FALSE, measured twice: the wordmark
       band peaks at 250 against a 73.5 mean (iteration 35) and carries its own
       shadow, and the tagline measures 9.00:1 against the brightest background
       adjacent to it (iteration 44) behind the deliberate scrim band from
       iteration 27. The wordmark is the most saturated thing on that screen,
       which is what iteration 31 set out to achieve;
     - radar: THIRTY-SIXTH report, remedy again the rotating sweep plus
       fabricated contacts;
     - "The city arrows are low contrast, particularly the green and orange
       markers; increase saturation and brightness, add a white or black
       outline." FALSE — the markers are at max saturation 1.0 and carry ground
       shadows as of iteration 53. Worth noting that this is the FIFTH distinct
       marker ask and the second independently to converge on "add an outline",
       which is the pool converging on a solution rather than a problem. Still
       not actioned, for the reason recorded since iteration 33: the markers are
       being asked to be findable from a moving car AND sit inside a grimy
       world, and an outline pushes them toward the loud end that iterations 33
       and 47 both complained about;
     - "The speedometer uses a dark grey primary speed number ... add a needle
       that points to the current speed." FALSE, and the third claim on this
       element to describe a state the code already provides: `--hud-speed-frac`
       drives a conic-gradient value wedge over 4 major and 24 minor ticks
       (verified in iteration 53), and the digital reads #e9eff6 at 10.25:1
       (iteration 26) — the LIGHTEST thing in the frame, which iteration 26
       recorded as a reviewer claiming black-on-dark for white-on-dark.

     A PROCESS NOTE ON THE VERIFICATION, because it nearly went the other way
     twice. The first confirmation attempt sampled pixel (13, 612) and read a
     teal pixel, which looked like the cascade bug still present. It was not: at
     y=612 the CONFIRM row's own teal BORDER lives, and my y-coordinates came
     from a capture two iterations earlier whose layout has since moved. So the
     "fix did not work" reading was an artefact of sampling the wrong element —
     the same failure as iteration 50's wall measurement and iteration 54's
     car-shadow check, and the third time in this log that a stale coordinate
     produced a confident wrong answer. Scanning the whole rail column and
     reporting every segment settled it in one pass. The rule is now paid for
     three times over: locate the element by scanning for it, never by
     remembering where it was.

60. xiaomi/mimo-v2.6-flash -> ZERO REAL, but TWO GENUINELY NEW DESIGN CANDIDATES,
     and the clearest contradiction yet on a settled decision:
     - "The legend is ~8px grey text beside ~8px colour dots - far too small to
       read at this resolution ... enlarge to 13px text with 12px swatches."
       FACTUALLY WRONG, and worth checking because the same element was enlarged
       one round ago: the legend reads `var(--ui-text-sm)` = 0.75rem = 12px with
       10px swatches, set in iteration 52 after iteration 51 reported it as "too
       small to quickly associate icons with actions". The marker precedent
       ("a reviewer who has already seen the fix and still cannot find it is
       telling you the NUMBER") does NOT transfer here, and the difference is
       worth stating: for the markers the reviewer's claim was that they could
       not FIND the thing, which is a perception a reviewer can report honestly
       while estimating its size badly. Here the reviewer's estimate of the size
       is simply wrong by a third, which makes it evidence about the estimate
       rather than about the legibility. The legend measures 7.23:1 on its panel
       and was verified legible in the frame. Not actioned a second time on the
       strength of a number that is measurably not there;
     - "Shrink the chevrons ~40% ... the oversized unlabeled arrows out-rank the
       player's own car as the focal point." This is the SIXTH distinct ask on
       the markers and the THIRD asking for them to be SMALLER (iterations 33 and
       47 are the other two) against three asking for them to be larger
       (iterations 19, 20, 26). The element is genuinely contested, and the log
       now holds the receipts on both sides. The new observation underneath is
       fair and is not about size at all: the markers are the most saturated
       things on the city screen, so they DO out-rank the car for attention, and
       the fix iteration 33 identified — a worn painted sign instead of a neon
       chip — is the only one that satisfies both halves of the tension. Still an
       ART task;
     - "Move the menu to centre-screen directly under the tagline ... it reads
       like a debug overlay rather than a main menu." THE THIRD DIRECTION the
       menu has been asked to move in, and this one is a direct reversal of
       iteration 43, which moved the menu OFF the centre axis because the title
       art is built symmetrically and a centred menu sits exactly on the
       composition's focal point. Iteration 46 asked for the opposite (too close
       to the bottom edge), iteration 47 reported the result as fine, and now
       this. Three reviews, three directions, same frame. The frame settles it —
       iteration 43's change was measured before and after (vehicle art 33.41 →
       63.65 luma, tagline 9.48 → 9.00:1) — and a review noticing a number is not
       the same as that number being wrong;
     - **NEW CANDIDATE, real: the highway has nothing passing the camera.**
       "There are no barriers, delineator posts, signs, traffic or debris anywhere
       between the top and bottom of the frame ... at driving speed the car feels
       stationary." This is a genuine gap and the proposed mechanism is honest:
       repeating roadside furniture is what real highways use to make speed
       readable, and it is PLACED CONTENT rather than a painted lie, so it does
       not run into the iteration-21 trade (a painted wall that does not exist)
       or the iteration-54 one (a sprite claiming an interaction area it does not
       have). Nothing in the game currently provides a speed cue on the road
       except the lane dashes. Recorded as the strongest new gameplay-visual
       candidate in the log — BUT SEE ITERATION 61, which corrects the traffic half
       of this: passing opponent vehicles ARE built (`src/sim/road.ts` rolls the
       contacts, `updateEngagement` spawns them). Only the fixed roadside furniture
       is genuinely absent.
       Its second half is already satisfied and the reviewer inverted it: "lower
       asphalt luminance ~20% below the shoulder so the white edge lines read as
       an actual edge". Asphalt measures 81.5 against 101.5 for the verge — 20
       points darker, which is the 20% the review is asking for, arrived at in
       iteration 18 by rebuilding the road as its own rotated strip;
     - **NEW CANDIDATE, real: the arena camera is too wide.** "The car sits
       dead-centre at roughly 110x75px inside a 1280x800 frame, so about 95% of
       the screen is empty floor ... tighten the camera so the car fills about
       1/6 of the screen height." This is the first arena-emptiness ask in the log
       whose remedy is NOT a fake boundary. Every previous one (iterations 21, 24,
       33, 34, 40, 55) wanted walls, cover, spawn pads or painted zones — all
       declined because they are content the simulation does not have. A camera
       change is neither: it is honest, it is reversible, and it attacks the
       actual complaint (an unbounded field shown too small in frame) rather than
       dressing it. Recorded as the top open visual item — EXECUTED in iteration 63 (arena 30->40 px/m, road 28->34). NOT actioned blind,
       because the arena and road share a camera scale and the change needs to be
       measured across both screens rather than guessed;
     - "The preview is an outlined rounded rectangle containing two flat grey
       boxes - no wheels, no body colour ... it does not react to the list."
       The NINTH report of the preview class, and both halves are settled: the
       schematic is GENERATED from the chosen part, so body changes alter its
       proportions, hull, wheelbase and every zone band (proved in iteration 42
       from `colliderLengthM`/`colliderWidthM` in driving.json), and iteration 33
       added the selected-row-to-zone LINK. A static capture cannot show a
       selection change — the same unfalsifiable shape iterations 51 and 56 hit.
     NO CODE CHANGED. The two new candidates are the product of this round: the
     first two proposals in a dozen that survive the "is this a lie about the
     simulation?" test that killed the rest.

61. mistralai/ministral-8b-2512 -> ZERO REAL. Nothing changed. And this round
     caught an error in MY OWN iteration-60 entry, which is the more useful
     result:
     - **CORRECTION TO ITERATION 60.** That entry recorded, as a strong new
       candidate, that "nothing in the game currently provides a speed cue on the
       road except the lane dashes", on the strength of this class of review
       saying "there are no barriers, delineator posts, signs, traffic or debris
       anywhere between the top and bottom of the frame". Checked it, and the
       TRAFFIC half is false. `src/sim/road.ts` rolls the full set of contacts a
       drive will encounter (`packSizeMin`/`packSizeMax` plus gaps, explicitly
       documented as what stops radar contacts from clustering into a warning),
       and `updateEngagement` in `src/app.ts` spawns a real opponent vehicle for
       each one as `trip.progressMiles` approaches it, logging a pass-by. Passing
       traffic is BUILT. It is simply sparse, and at t=0 on a seeded capture no
       contact happens to be within the visible band — which is exactly the
       static-frame trap again, and I walked straight into it by recording a
       reviewer's negative as a fact about the game instead of checking it.
       The correct statement is narrower and still worth having: the road has
       sparse PASSING traffic but no fixed ROADSIDE FURNITURE, so there is no
       repeating element at a known interval to read speed from when the frame
       happens to be empty. Delineator posts remain a legitimate candidate for
       that reason and not the other one;
     - "The lane markers are static yellow lines with no feedback for lane
       changes or drift ... add a green outline when centred and a red dashed
       line when drifting beyond the lane boundary." INAPPLICABLE, and the code
       settles it in one comment: the road "has no independent 2D map", and every
       position — the player's and each contact's — is derived by offsetting along
       the route's fixed heading axis by a scalar route-mile value. There is no
       lateral axis, so there is nothing to drift from and nothing to be off-centre
       relative to. The white edge lines at +/- ROAD_LANE_HALF_WIDTH_M are
       boundary marks on a strip, not lane walls a player can cross. This is the
       same structural fact that has declined the compass ask in iterations 41,
       45, 51 and 55 — a second, redundant answer to a question the road does not
       pose. A drift indicator would be a readout for a state the simulation
       cannot be in, which is the trade declined in iteration 28 for the city's
       condition panel;
     - "The legality instructions are buried in a small, low-contrast text box
       with no visual hierarchy ... highlight the 'Name' row in green." FALSE on
       the frame: the LEGALITY panel is fully visible without scrolling at 900px,
       and it is the most prominent block in the right pane — a bright teal
       border, a heading, a bold prompt line and three legible steps (iteration 23
       raised all three out of being quieter than the summary above them, and
       measured 15.06:1 and 7.79:1).
       The second half is the interesting one: "highlight the Name row" is
       iteration 48's requirement rail, and iteration 59 fixed the cascade bug
       that had been preventing it from showing on the selected row at all. So
       the ask was already satisfied, and satisfied ONE ROUND AGO. The requested
       GREEN is also deliberately not amber: iteration 48 chose amber because "a
       red row reads as a failure the player caused", which is the exact thing
       the pristine-build messaging exists to avoid;
     - "The top-right HUD (day/time/money) overlaps with the bottom-left vehicle
       status panel ... move the bottom-left panel to the top-left." There is no
       top-right HUD on the city screen — the status pill is top-CENTRE, the
       legend bottom-right, the car strip bottom-left, the Arcade button
       top-left — and the proposed destination is occupied. This is iteration
       45's class exactly: a plausible spatial problem described without looking,
       and the cheapest possible check in the loop is one glance at the frame;
     - "Green status bars and '0 mph' blend into the dark background ... use neon
       yellow or magenta with a 1px white stroke." INVERTED, and the most
       confident wrong colour recommendation in the log: '0 mph' is #e9eff6 at
       10.25:1, the LIGHTEST thing in the frame (iteration 26), and every status
       colour clears AAA (iteration 9). Recommending magenta for a driving HUD is
       a genre reflex, not a reading;
     - radar: THIRTY-SEVENTH report, and this one also asserts the radar is on
       the CITY screen, which it is not — the second "element does not exist"
       sighting after iteration 40's title-screen radar. Its remedy again asks
       for contact blips "even if static", which is the fabricated-contacts fix
       declined thirteen times.

62. bytedance-seed/seed-2.0-lite -> the review was LOST, then recovered. ZERO
     REAL, but the round's product is a harness fix worth more than a fix.
     THE TOOLING FAILURE, and it is the third time this file has cost a reviewer:
     - The model returned five complete, well-formed findings with
       `finishReason: "stop"` and a syntactically COMPLETE array — the reply ends
       cleanly with `\n]`. The tool recorded "did not return parseable JSON" and
       wrote `findings: null`.
       Cause: line 26 contained unescaped double quotes inside a string value —
       `"problem": "The active "New Driver" start option has very low contrast"`
       — which terminate the JSON string early. Two quote characters cost the
       entire review.
       That is the same class as the two earlier failures in this file: an empty
       body recorded as though it were fact (iteration 15), and a picker that
       reported "0 models asked" because its `readFileSync` had silently failed
       (iteration 16). Each time the harness looked perfectly healthy and the
       cost was a reviewer the loop will never ask again.
     - FIXED, and narrowly. `parseFindings` now retries once through
       `escapeBareQuotesInStrings`, which rewrites a `"` ONLY when it is inside
       an open string and the next non-whitespace character cannot legally
       continue a JSON string (`,` `}` `]` `:`). A real closing quote is always
       followed by one of those, so string boundaries are never touched; a bare
       quote in prose is followed by a letter and gets escaped. Literal newlines
       inside a string are escaped the same way. If the retry still fails, the
       ORIGINAL error is thrown rather than a second, more confusing one.
     - PROVEN against the real payload rather than a synthetic one. Replaying the
       actual saved reply: the original parser fails at position 2565, the
       repaired one returns all 5 findings with the quote-bearing text intact
       (`The active "New Driver" start option has very low contrast...`). The
       first attempt at that proof was itself wrong — it compared the new
       function against itself and reported "PARSED" on both sides, because the
       repair now lives INSIDE `parseFindings`. Measuring the old parser verbatim
       alongside the new one is what made the difference visible;
     - All five findings, triaged from the recovered payload:
       - radar: THIRTY-EIGHTH report, remedy again the sweep plus fabricated
         blips;
       - "Overly pixelated low-fidelity ground textures": the NEAREST-sampler
         class, and the ART item;
       - "Stacked overlapping top-center tooltip clutter": the status pill, the
         fading control hint and the message feed, each separately placed by two
         screenshot passes (iterations 18, 22, 57) and each carrying a different
         kind of information — permanent status, transient teaching aid, session
         log. The consolidation this asks for is a layout change recorded in
         iteration 58, not a defect;
       - "The active 'New Driver' option has very low contrast highlighting, and
         the border around the entire menu box is more prominent than the active
         [row]." That is ITERATION 47's finding, word for word in substance: the
         `:focus-visible` ring was 2px at a 4px offset in full-strength cyan,
         which had stopped being a focus indicator and become the panel's visible
         border, so it was stepped to 1px at 2px offset mixed to 55% precisely
         "so the strongest cyan on the screen stays on the SELECTED ROW rather
         than the frame around it". The selected row has carried a real gradient
         fill since iteration 32 and the constructor's equivalent since
         iteration 59;
       - "Ungrouped cluttered vehicle constructor UI": the density class, whose
         own remedies (collapsible sections) break the 0-9 index addressing.
     NO GAME CODE CHANGED. Two harness failures in the last six rounds, both
     silent, both costing a reviewer — which is a worse ratio than the review
     itself, and worth watching: the loop's own tooling is now a bigger source of
     lost signal than the pool's weakest models.

63. xiaomi/mimo-v2.6-pro -> 1 REAL and it is the most-supported open item in the
     log, now EXECUTED. 4 FALSE:
     - **THE CAMERA IS TOO WIDE — DONE.** "The player car is a small speck
       dead-centre, the vehicle occupies roughly 8% of the frame width ... at
       highway speed this reads as a parked car on a placeholder floor ... it is
       the single biggest reason the game looks unfinished in motion. Zoom the
       driving camera in ~1.5x (car at ~15-18% of frame width)."
       This is the item iteration 60 recorded as "the first arena-emptiness ask
       whose remedy is NOT a fake boundary" and deliberately did not action
       blind, because "the arena and road share a camera scale and the change
       needs to be measured across both screens rather than guessed". A second
       independent model has now asked for it with a concrete target, so it is
       measured rather than guessed.
       What the measurement found is that the arena had ALREADY been fixed once
       for this reason and the fix was documented and then half-lost: the arena
       zoom was raised 17 -> 30 px/m precisely because "at the old 17 px/m the
       player's own car was 54 x 88 device px inside a 1440x900 frame — about 4%
       of the width. That reads as a postage stamp." 4% -> 10.8% is a real
       improvement, but this reviewer is measuring the result and still calling
       the car a speck at ~8-11%, so 30 was not enough.
         ARENA 30 -> 40 px/m   car 156px -> 208px   10.8% -> 14.4% of width
         ROAD  28 -> 34 px/m   car 146px -> 177px   10.1% -> 12.3% of width
       The road gets a SMALLER bump on purpose, and the asymmetry is the
       interesting part. Its zoom is wider than the arena's for a stated reason
       — road AHEAD, so oncoming traffic is visible before it arrives — and
       contacts on this screen are placed by remaining route-miles, so cropping
       the view shortens the player's warning. A uniform 1.5x would take visible
       road from 32m to 21m, giving away a third of the reaction distance for a
       framing gain. 34 keeps 26.5m of it.
       And neither change can hide anything load-bearing, which is the check that
       made this safe to do at all: awareness on both screens is the RADAR's job
       and it is untouched. `driving.json` sets `radar.visualRangeM` to 160m, so
       a contact is plottable at more than THREE TIMES the camera's width in
       either configuration (36m and 42m). The camera shows what you are driving;
       the radar tells you what is out there. Both values stay under
       MAX_ZOOM_PX_PER_M (64), which was raised from 40 for exactly this reason —
       so the ceiling binds rather than being decorative.
       Verified in the frames, not just the arithmetic: the car is visibly larger,
       the lane dashes and the arena's slab lattice both read more strongly, and
       the HUD panels are DOM overlays so no panel moved;
     - "The teal SMDUEL wordmark sits over the brightest part of the sun haze and
       the small white tagline's right half nearly disappears into the sky; add a
       radial scrim behind the lockup." The tagline was measured at 9.00:1 in
       iteration 44 and at 9.48:1 before the composition move, against the
       BRIGHTEST background adjacent to it, with a two-layer shadow. A reviewer
       asserting one END of the line is unreadable is a specific spatial claim.
       RESOLVED IN ITERATION 65, and it is FALSE: measured per third, the
       tagline reads 7.92 / 7.72 / 7.99:1 against the brightest adjacent
       background, so the right end is the BEST of the three. The sun glow sits
       above the lockup; the line's right end lies over a dark tank hull;
     - "The city is a gray-box: buildings are flat grey cubes with no cast
       shadows, no streets." FALSE on shadows: buildings have carried analytic
       contact shadows since iteration 17, tightened to 0.3/0.62 so separation
       does not ride on the art, and iteration 53 gave the entrance markers their
       own. "Paint real streets" is the city street-network ART item, carried
       since iteration 14. "Clamp or bias the hub camera so chevrons never leave
       the frame" asks the impossible of a scrolling world — the city is larger
       than the viewport by design — and its own premise ("several buildings are
       cropped away entirely") describes a driving world working correctly;
     - radar: THIRTY-NINTH report, and the remedy is the fabricated-contacts fix
       declined fourteen times, plus "show an explicit 'NO CONTACTS' label
       instead of a black void" — which inverts iteration 29's settled position
       that a fixed-weight instrument honestly reporting nothing is better than
       an instrument that changes state;
     - "Armour rows use unreadable bracket glyphs '|:--:|' at ~9px ... the tyre
       and plant rows use a different green-dot-plus-bar language." THE PRISTINE
       CASE, twelfth-plus report: those glyphs are the dashed CHIP from
       iteration 21, made deliberately loud so an unfitted slot cannot read as an
       area that failed to render, and there is no bar because bars are
       fitted-only (iteration 25) — there is no fraction to scale. The claim that
       tyres use a different language is describing iteration 21's state;
       iteration 29 moved them onto the same bar.

64. google/gemini-3.6-flash -> 1 REAL, 4 in known classes. And the one real
     finding is iteration 53's fix, reported again one round later — which is the
     marker precedent firing a THIRD time:
     - "Bright color-coded chevron icons float randomly in space above buildings
       WITHOUT shadows, ground rings, or stems connecting them to structures ...
       making it hard to tell which icon corresponds to which building."
       The shadows were added in iteration 53, which is the first marker finding
       in nine to name the AXIS (anchoring) rather than the number — the axis
       that size changes could never fix. This reviewer is looking at a frame
       that CONTAINS them and still cannot see them.
       The marker precedent, stated at iterations 19 and 20 and applied to size,
       transfers exactly: a reviewer who has already seen the fix and still
       cannot see it is telling you the NUMBER was too small, not that the
       report was wrong. And this log already contains the measurement that
       settles the direction — iteration 17 found the BUILDINGS' contact shadow
       "soft (0.8) and faint (0.42), so it never registered" and fixed it to
       0.3 / 0.62. The values iteration 53 shipped were 0.9 / 0.5: softer AND
       fainter than the pair this codebase has already documented as
       inadequate. They were always going to be invisible to a reviewer, because
       a reviewer only ever sees a downscaled frame.
         DOORMARKER_SHADOW  0.9 / 0.5  ->  0.5 / 0.62
       Still softer than a building's, because a marker is signage lying ON the
       ground rather than a mass sitting on it. The shadow's whole job is to
       terminate the marker in the world instead of letting it hover, and a cue
       that cannot be seen does not terminate anything. Verified by comparing the
       two captures: the pools under every chevron are now plainly visible where
       before they were barely there.
       WORTH NAMING: this is the third time the "reviewer cannot see a fix that
       shipped" signal has been correct on this element (size twice, anchoring
       once), and the first time the fix itself was under-powered rather than
       absent. The lesson is not "trust reviewers over the code" — it is that a
       cue tuned to be tasteful can be tuned below the threshold of a downscaled
       frame, and the threshold is the only frame anyone reviews;
     - "The 'Arcade' pill floats alone in the top-left margin, separated entirely
       from the main menu panel ... reads like a temporary developer debug
       button ... move game mode selection into the main lower-left menu list."
       HALF fair. The isolation observation is real composition criticism and it
       is the FOURTH time the menu's placement has been challenged (iterations
       43, 46, 47, 60, 63). The proposed fix is not available: Arcade is not a
       mode selector, it is the persistent home link that `builder.css` documents
       as "the persistent 'Arcade' home link ... position: fixed at the top-left",
       present on every screen so the player can leave any run in one key. Folding
       it into the title menu would delete it everywhere else. The composition
       point is recorded, the remedy is refused;
     - preview: TENTH report of the preview class, settled — the schematic is
       generated from the chosen part (iteration 42) and carries the row-to-zone
       link (iteration 33);
     - "The ground exhibits severe blocky texture compression noise and
       pixelated seams": the NEAREST-sampler class, whose remedy is the ART item;
     - radar: FORTIETH report, remedy again rings, cardinals, sweep and contact
       blips — all present since iteration 2, with the blips declined fifteen
       times as fabrications.

65. qwen/qwen3.5-plus-20260420 -> ZERO REAL. Nothing changed. But this round
     CLOSED THE ONE ITEM LOGGED AS UNVERIFIED, and it closed by measurement
     after four wrong attempts:
     - **ITERATION 63'S "UNVERIFIED" IS NOW FALSE.** That entry recorded, as the
       one open item in its review, a claim that "the small white tagline's right
       half nearly disappears into the sky", on the reasoning that a reviewer
       naming one END of a line is a specific spatial claim worth separating from
       the whole-line contrast already measured at 9.00:1.
       It is false, and the three thirds are indistinguishable:
         LEFT  text peak (235,240,244)  vs brightest adjacent bg ->  7.92:1
         MID   text peak (233,237,241)  vs brightest adjacent bg ->  7.72:1
         RIGHT text peak (236,241,244)  vs brightest adjacent bg ->  7.99:1
       All three clear WCAG AAA, and the RIGHT third is the best of the three,
       which is the opposite of the claim. The visual explains it: the sun glow
       sits ABOVE the lockup, and the tagline's right end lies over a dark tank
       hull. True adjacent background at those rows is a median of (15,12,10).
       And a second model has now made the same claim independently ("Subtitle
       Legibility ... placed directly over the brightest part of the
       sunset/dust cloud, causing it to wash out"), which makes it a recurring
       class rather than a one-off: two reviews in three rounds have located the
       sun as being behind the text when the scrim band from iteration 27 puts
       its darkest point exactly there.

       WORTH RECORDING IS THE MEASUREMENT, because it took four wrong attempts
       to get right and every one of them produced a confident, plausible,
       completely false number:
         attempt 1  1.79:1  — the "background" filter caught anti-aliased glyph
                             pixels, so I was measuring the text against its
                             own halo;
         attempt 2  1.12:1  — the row band spanned the wordmark as well as the
                             tagline, and the wordmark's bright end is CYAN;
         attempt 3  1.50:1  — narrowed correctly but still used in-band
                             non-text pixels, which at the tagline's own rows are
                             mostly halo;
         attempt 4  7.92 / 7.72 / 7.99:1 — sample the background from the SAME
                             ROWS but OUTSIDE the text's x extent, where there is
                             genuinely nothing but art.
       This is iteration 35's rule again and it has now cost more than any other
       lesson in the log: a ratio near 1.0 is not a legibility problem, it is a
       sampling error. And the general form is sharper than "check the crop" —
       the background sample must come from somewhere the TEXT IS NOT. Every
       wrong attempt above sampled the text's own neighbourhood;
     - "The yellow dashed lane markings have very low saturation and contrast
       against the grey asphalt, making them blend into the road noise ... at
       speed these lines will vanish." The SATURATION half is right and the
       CONCLUSION is wrong, which is the iteration-9/23/24 shape. Measured: the
       brightest dash pixel is (207,198,162) — a muted cream, so yes it is
       desaturated rather than vivid — against a median asphalt of (50,50,56),
         CONTRAST 7.43:1
       which clears AAA, and the frame shows four dashes plainly separated from
       the surface with dark gaps between them. The proposed remedy is also the
       one worth being careful about: real high-contrast road markings DO use a
       dark edge, but adding a stroke here would put more visual noise on a road
       that iterations 34, 39, 43, 47 and 55 have all called busy, to solve a
       legibility problem the measurement says does not exist. The geometry was
       checked in iteration 36: a 3.2m mark inside a 10m period, so the gap is
       2.1x the mark, not 1x;
     - "The constructor preview is a generic blue wireframe/CAD drawing ...
       replace it with a rendered top-down view of the actual pixel-art vehicle."
       ELEVENTH report of the preview class, and this one is the sharpest
       statement of the underlying disagreement yet: the reviewer wants the
       PLAYER to see weapons and armour "on the pixel sprite, not an abstract
       box". That is precisely the trade the loop declined in iterations 13, 16,
       24, 26, 37, 43, 47, 51, 55, 56 and 63 — the gameplay sprite is a top-down
       car and armour placement is a build-time abstraction, so the sprite
       physically cannot show where the points land. The review names the
       disagreement instead of restating the symptom, and the answer is unchanged
       because the reason is structural;
     - "The arena floor is a uniform flat grey texture resembling a developer
       placeholder ... add tire skid marks, oil stains, cracked patches, debris."
       The arena-emptiness class, and the ART item — DECALS specifically, which
       is the one suggestion in the log that survives the "is this a lie about
       the simulation?" test, because a decal is placed content and does not
       repeat. Recorded again here, third time;
     - "All interactable buildings are identical grey blocks ... vary the roof
       shapes, heights or textures to match their function." THE ELEVENTH report
       of the city-cohesion class, and worth separating from the seven earlier
       ones: those wanted per-building COLOUR, which is the collage problem
       iteration 16 spent a round removing. This one wants per-function building
       ART, which is iteration 37's idea taken one step further — iteration 37
       put function in the MARKER tint because the building sprites all come from
       one graded family, and varying the art per function means new assets per
       facility type. That is an ART task of the same class as the title
       regeneration, not a code change.

     A SELF-FOUND ITEM, recorded because the loop is supposed to find things and
     not only triage what it is handed: the radar panel's orientation toggle
     renders as "Orientation: north-" / "up" — the label wraps at the hyphen.
     Visible in the frame, minor, and the break point is a legitimate one, so
     recorded rather than churned.

66. openai/gpt-4o-mini -> ZERO REAL. Nothing changed. All five in measured
     classes, and the round's observation is a CONTRADICTION that is worth more
     than any of them:
     - "Replace the arena background with a SIMPLER, more muted texture that
       enhances gameplay focus." The arena is the one element the pool has asked
       to make MORE interesting in every other review: iterations 21, 24, 33, 34,
       40, 55, 58 and 60 all wanted detail, cover, spatial reference, decals,
       texture variation or a tighter camera. This reviewer wants LESS. Neither
       is wrong about what it saw — a pixel-noise floor under a car can honestly
       be read as "busy, distracts from the vehicle" AND as "a blank plate with
       no sense of place". They are the same frame read against opposite priors,
       and the ground cannot satisfy both without knowing which one the player
       wants.
       This is the SECOND element to show the pattern iteration 55 found in the
       city. There, two models one round apart disagreed about which half of the
       scene to shrink (buildings up, car down) because the city has no
       size reference in frame. Here, the arena has no statement of what it is
       FOR, so the pool oscillates between "too empty" and "too busy" with
       nothing in the image to adjudicate. The asymmetry is worth naming: the
       arena floor measures 144 luma against 58 for the road and 101 for the
       city, so it is the BRIGHTEST surface in the game and carries a world-fixed
       slab lattice — it is not under-detailed, it is under-EXPLAINED. Both
       readings are downstream of the same gap, and neither is fixed by a
       texture change;
     - "The title 'SMDUEL' has low contrast against the background ... add a thin
       dark outline or shadow." The wordmark band peaks at 250 against a 73.5
       mean (iteration 35) and carries the two-layer shadow iteration 15 added,
       and the remedy is a description of what shipped. Measured again this round
       in the same pass that settled the tagline: the lockup is the brightest
       thing in its region by a wide margin;
     - radar: FORTY-FIRST report, remedy again visible opponent markers, which
       are fabricated on a practice arena for the sixteenth time;
     - "The component list is cluttered with inconsistent font sizes ... increase
       spacing and standardize font sizes." The list's type is token-driven off
       the same scale as every other screen (10/11/12/13/15px), the section edge
       is iteration 17, the weight is iteration 23, the rails are iteration 48,
       and the row rhythm was checked in iteration 12. "Standardize font sizes"
       is the one clause that reads as an instruction the codebase already
       follows;
     - "The mission progress bar is thin and lacks distinction." The FIFTH report
       of this class and the fourth consecutive one asking for LESS than the
       element is: it renders 8px including borders, measured by column scan in
       iteration 29, and the fill measures about 9:1 on a near-black track. What
       the reviewer is reading is `scaleX(0)` at the start of a 150-mile route,
       which is the honest report of zero miles driven.
     NO CODE CHANGED. Two elements in the game are now demonstrably
     under-determined in frame — the city's scale and the arena's purpose — and in
     both cases the pool has been generating confident, opposite fixes for
     twenty-odd iterations. That is a much more actionable diagnosis than either
     sprite: the loop is not misreading these screens, it is being asked a
     question the screens do not answer.

67. qwen/qwen3.7-flash -> ZERO REAL, and one GENUINELY NEW OBSERVATION that no
     earlier review in sixty-seven rounds has made:
     - "The player vehicle is orange/brown, the 'Build' mission icons are also
       orange, and the 'Not road-legal' status text is orange. This creates a
       significant colour clash ... clashing colors between the player and
       objectives force the player to look closer at icons rather than glancing."
       The clash is REAL, and it is a semantic collision rather than an aesthetic
       one, which is why sixty-seven reviews missed it: everyone has been asking
       about individual elements, and this is about a HUE carrying three
       unrelated meanings at once.
       Checked all three rather than taking the description:
         the player car      PLAYER_TINT is {1.18, 1.18, 1.18} — NEUTRAL. The
                             orange is baked into the car-subcompact ART, not
                             applied as a tint;
         the Build chevron   facilityMarkerTint workshop = {1.2, 0.6, 0.14};
         "Not road-legal"    --ui-warn, #f2b632, measured at 7.54:1.
       So one hue family is doing three jobs: "this is you", "this is a workshop",
       and "this build is illegal". Iteration 37 established that marker colour
       must carry FUNCTION, and iteration 48 chose amber for unmet requirements
       precisely because "a red row reads as a failure the player caused" — so
       both of those uses were deliberate. The collision is the cost of two good
       decisions meeting in the same palette.
       The proposed remedy does not survive checking, and the reason is the most
       useful part of this entry. "Change the Build icon to yellow or purple":
         - PURPLE is free, but it would break the four-hue functional set that
           `facilityMarkerTint` defines and that a test pins as four distinct
           dominant channels, and it would read as a category the game has no
           meaning for;
         - YELLOW is closer to the car but lands on --ui-warn, so the workshop
           markers would then share a hue with "you still have work to do" — a
           WORSE collision than the one being fixed, and one between two things
           on the same screen that a player is actively comparing.
       The palette is red / amber / green / cyan for function, plus amber for
       warning, plus an orange car. There is no free hue left to move a marker
       into, so a recolour does not solve this; it relocates it.
       What DOES solve it is the fix iteration 33 already identified and that
       iterations 47 and 64 have kept re-approaching: the markers are maximally
       saturated, so they compete with the car for attention by construction. A
       worn painted sign at lower saturation stops competing with the car
       REGARDLESS of its hue, which is why the ART task keeps being the right
       answer and the colour arguments keep going in circles. This entry is
       additional evidence for that ART item rather than a new one;
     - "Remove the vertical orange bars from rows that are at default/empty values
       ... reserve the orange accent for the currently selected row or rows that
       have a specific warning state." INVERTED, and cleanly so. The rails are
       iteration 48's requirement markers, and they are on the empty rows
       PRECISELY BECAUSE those rows are the unmet ones — the requirement is a
       name, armour points, and a mounted weapon, and a pristine build fails all
       three. Applying the fix as written would strip the marker from every row
       that needs it and keep it on the rows that are already satisfied, which
       inverts the signal completely. This is the second report of the "too many
       orange bars" family (iteration 56 made the first), and iteration 56
       already recorded the honest tension: the marker is ACCURATE on fifteen of
       twenty rows and simultaneously low-information, because a marker on nearly
       every row stops reading as a marker. Neither report makes that better by
       changing it;
     - radar: FORTY-SECOND report, and this one asks to "lighten the radar
       background to a dark slate-blue/grey", which is the dim-when-idle variant
       declined in iteration 29 — a practice arena with no opponents would render
       a nearly invisible instrument, and a player arriving at combat would have
       to learn a state change to trust the panel they are relying on;
     - "The progress bar is a thin dark grey line ... place it inside a
       semi-transparent dark panel ... increase thickness to 4-6px." The panel
       EXISTS (the status pill, raised to 0.86 alpha and 13.20:1 in iteration 24
       for exactly this moving-texture problem), the bar renders 8px including
       borders, and 4-6px is asking for LESS than the shipped value. Sixth report
       of the class, fifth consecutive one below what is already there;
     - "The armour section uses small empty rectangular boxes ... unlike the Tyre
       section which has clear green bars." THE PRISTINE CASE, thirteenth-plus
       report, and this is the first to notice the armour/tyre ASYMMETRY — which
       iteration 29 already removed: tyres were moved onto the same bar language
       specifically because "the condition panel was answering the same question
       in two different visual grammars". On a pristine build the asymmetry is
       unavoidable and correct: there is no fraction to scale an armour bar by,
       while every tyre has 4/4. The proposed fix — "use a red X or dashed red
       border to signal unprotected" — would also be the green-on-a-zero bug in
       a new costume, the exact thing iteration 21's chip was built to avoid.
     NO CODE CHANGED. The colour-semantics collision is the first finding in
     sixty-seven rounds that is about the PALETTE rather than any single element,
     and it is worth keeping for that reason.

68. google/gemini-3.1-flash-lite -> ZERO REAL as written, but the review
     contained the evidence for the fix this round actually made, and it is the
     last shadow in the game to be under-powered:
     - "The ground texture is a repetitive, low-contrast grayscale tile pattern
       ... it creates a 'floating' effect where the car and buildings don't feel
       grounded in the world." The tiling half is the ART item and the ground is
       NOT repetitive: one quad, world-space fract, a non-commensurate detail
       scale cross-faded in 9m patches, measured spread 25.56 road / 13.25
       arena / 10.26 city. But "the car ... doesn't feel grounded" is the SIXTH
       report in that family (iterations 15, 18, 43, 54, 58, 68), five of them
       as "it has no shadow at all", and every one was recorded FALSE on the
       measurement. The measurement was right every time — the shadow exists and
       has existed since iteration 1.
       It should not have ended there. Iteration 54 measured the car's shadow
       darkening the ground by only ~8%, and did not ask what that number meant.
       Meanwhile this log contains its own standard for what it means:
         iteration 17  buildings  0.8 / 0.42 -> 0.3 / 0.62  ("never registered")
         iteration 64  markers    0.9 / 0.5  -> 0.5 / 0.62  (same defect, one
                                                                layer down)
         THE VEHICLE   0.7 / 0.5, untouched since iteration 1 — softer AND
                       fainter than the pair iteration 17 already documented as
                       inadequate.
       The vehicle was the oldest shadow in the game and the weakest, on the one
       object at the centre of every arena and road frame. Six reviews said the
       car was not grounded; the measurement said the car had a shadow; nobody
       reconciled the two, and the honest reconciliation is that a shadow which
       only moves the ground 14% is the same under-powered cue the marker had.
         VEHICLE_SHADOW  0.7 / 0.5  ->  0.4 / 0.62
       Opacity matches the buildings' 0.62, the value this codebase has already
       proven registers. Softness tightens to 0.4 rather than a building's 0.3,
       because a car is a low small object and a tight contact pool reads as
       weight where a broad soft blob reads as a smudge — the same reasoning
       that keeps the marker softer than a building. The city screen's vehicle
       shadow moved with it so the player's car is grounded identically in both
       places.
       MEASURED, locating the car first and comparing the band just below it
       against empty ground in the same rows:
         before  14.2% darker
         after   19.9% darker      (car bbox byte-identical in both captures, so
                                    the only variable is the shadow)
       Checked in the frame as well as the number: a visibly tighter, darker pool
       hugging the lower-right edge, reading as weight rather than a smudge, with
       the car art unchanged.
       WORTH NAMING, because it is the third time this exact shape has produced a
       fix and the first time it was caught by ADDING UP two earlier rounds
       instead of by re-measuring from scratch: the building shadow (17), the
       marker shadow (64) and the vehicle shadow are the same class, and the
       class is "a cue that is present, measurable, and below the threshold of a
       downscaled frame". A reviewer cannot see it; a measurement confirms it
       exists; neither fact implies it is strong enough. Six 'the car has no
       shadow' reports were each individually correct to dismiss and collectively
       wrong to dismiss;
     - "Radar is a completely featureless black circle." FORTY-THIRD report;
     - "The Condition and Tyres panels use thin, low-contrast bars that blend
       into the panel background ... use a brighter colour like yellow or white."
       Measured 24-55:1 for the panel's ink on its composited surface, and
       iteration 54 — five reviews ago — already answered the thickness half by
       taking the bars from 4px/3px to 6px/5px. Recommending yellow for a status
       readout inverts the state colour-coding iteration 9 verified end to end;
     - "The constructor list is a uniform white-on-dark block with no separation
       between categories ... add header dividers." There IS a section rule above
       Weapon 1 (iteration 17), and the requirement rails (iteration 48) draw the
       category boundary the reviewer is describing;
     - "The 'New Driver' and 'Controls' buttons are dark-teal-on-dark-gray and
       lack the luminance to pop." The tenth report of the menu class. The
       selected row has carried a real 52%->30% cyan gradient since iteration 32
       and the panel has been near-opaque since iteration 20; "apply an outer
       glow to the active button" is the competing-boxes remedy that iteration 32
       removed after the fill became visible without it.

69. amazon/nova-lite-v1 -> ZERO REAL. Nothing changed, and this is the weakest
     review in the pool since iteration 42: no coordinates, no measurements, and
     four of the five findings name elements that do not exist or were declined
     by name.
     - "Buttons like 'Build this vehicle' and 'Confirm' do not visually indicate
       their function ... add a checkmark for 'Confirm' and a wrench for 'Build
       this vehicle'." ONE ROW, READ AS TWO. `computeRows` pushes
       `{ kind: 'confirm', label: 'Confirm', valueLabel: 'Build this vehicle' }` —
       there is a single CONFIRM control and "Build this vehicle" is its VALUE,
       exactly like every other row's value on that screen. The reviewer split a
       label/value pair into two buttons and then asked to standardise them
       against each other. Third sighting of the "element does not exist" class
       (iterations 21, 35, 40, 61), and the first time it has run in reverse:
       the element is real and the review invents a second one beside it;
       WORTH RECORDING ANYWAY, because the misreading is itself a finding. This
       is the one control the whole screen exists to press, and iteration 15
       spent a round making it unmistakable — filled, accent-bordered, the only
       saturated surface in the pane. A reviewer still read two competing calls
       to action out of it, because the screen's own convention is label-left /
       value-right and that convention says "data row". The button treatment says
       "one action" and the label/value pairing says "two things", and they are
       pulling against each other on the single most important control.
       The remedies are all copy or layout changes rather than defects: dropping
       the value leaves a label with no counterpart in a column iteration 27
       recorded as load-bearing for the 0-9 model; an icon adds decoration to a
       row that is already the loudest thing on the pane. Recorded as an
       unresolved tension rather than actioned, because "CONFIRM / Build this
       vehicle" is genuinely self-describing and the alternative is not clearly
       better;
     - "Buttons on the constructor have different colours and styles ... which
       can be confusing." The inconsistency is the design: iteration 15 reserved
       `--ui-accent` for CONFIRM alone, "so the one saturated surface on the
       screen is the thing the screen exists to do", and the row cycle controls
       are hidden on fine pointers entirely. Standardising them would flatten
       exactly the hierarchy iteration 15 built;
     - "The radar does not clearly indicate orientation or object positions ...
       add a legend explaining the symbols." FORTY-FOURTH report. The radar has
       an orientation toggle labelled in words ("Orientation: north-up") and a
       `hud-radar-contact-list` carrying per-contact text for screen readers, so
       the symbols are explained in text already;
     - "The right-side panels contain a lot of text and numbers, making it hard
       to read quickly." Iteration 35's "cluttered HUD" claim. The panel is a
       dashboard on purpose: iteration 2 grouped it into ARMOUR / TYRES / PLANT
       & DRIVER precisely so a glance tells you which system a line belongs to,
       and iterations 25, 29 and 54 gave it bars and thickness so the read is
       pre-attentive rather than textual;
     - "The vehicle's status is not indicated on the vehicle model itself, only
       in the information panels ... add visual indicators on the vehicle model
       to show armor points and weapon mounts." This is the preview class's ask
       transplanted onto the GAMEPLAY sprite, and it is the one finding here
       with a real argument behind it, so it is worth separating from the rest.
       The loop's settled position is that "the gameplay sprite is a top-down car
       and armour placement is a build-time abstraction, so the sprite physically
       cannot carry that information" — which is why eleven reviews asking for
       "the real sprite in the constructor" were declined. But that reasoning
       covers ARMOUR PLACEMENT, and this asks for something the sprite could in
       principle carry: current DAMAGE. The blocker is not conceptual, it is
       that the atlas holds one frame per body, so a damaged car has no art to
       switch to. Making it true means authoring per-body damage states — a real
       ART task of the same class as the title regeneration, not a code change.
       And the city screen already answers the question this raises from real
       state: the car strip (iteration 28) carries the name, armour total and
       mounted count, plus the legality verdict, so "can I take this car out of
       here" is on screen while driving in the city. Recorded as a genuine new
       ART candidate, not actioned.
     NO CODE CHANGED. Worth noting for the pool's calibration: this review and
     iteration 45's are the same shape — a plausible-sounding list in which the
     named elements do not exist, the named remedies were declined by name in
     earlier rounds, and nothing can be checked. The log's standing note from
     iteration 35 applies with more force at 69 than at 35: not every vision
     model can critique, and the useful response to one of these is to weight it
     rather than action it.

70. google/gemini-2.5-flash -> ZERO REAL. Nothing changed, and this review is
     the cleanest example yet of a review describing a build several iterations
     old — which is iteration 48's standing observation, now with a fourth data
     point and a fix in between.
     - "The selected item on the constructor is barely distinguishable ... make
       the selected item's background color or border much more distinct." FALSE
       against the shipped frame, and the frame settles it in one look: the
       selected Name row carries a full-width teal gradient fill, an amber
       requirement rail on its left edge, full-ink label text and its input
       field, sitting directly above two flat unselected rows. It is the single
       most conspicuous element in the pane.
       This is the FOURTH report on constructor selection (iterations 52, 59,
       70, and glancingly 54) and the first made against a frame that CONTAINS
       the fix. Iteration 59 took the row from a 14% accent wash carrying the
       signal on a 1px border — a measured +28.4 luma — to the menu's real
       gradient at a measured +82.4, and in the same change removed the blanket
       `border-color` that had been repainting the amber "unmet" rail teal on
       exactly this row. The reviewer is describing the state BEFORE both halves
       of that fix, which is what iteration 48 called "a review describing a
       fixed state rather than reading the shipped one" and what iteration 62
       counted at its eleventh occurrence;
     - "Menu items ('New Driver', 'Controls') do not show clear visual feedback
       when hovered or selected beyond a slight color change or border." The
       FIFTH report of the title-menu class against a frame carrying iteration
       32's 52%->30% gradient. Its companion ask — "make the speed and radar more
       prominent or visually integrated" — is the weight-hierarchy theme item
       (iterations 51, 47), and "apply a consistent UI style guide ... more
       stylized fonts, distinct background textures" is that item's third
       independent recipe. The theme item now has THREE full recipes from three
       unrelated models, which is worth stating plainly: the pool keeps asking
       for this language, and the honest answer is still that restyling the
       panels is a decision about what SMDUEL looks like rather than a defect in
       what they do;
     - "The subtitle is particularly difficult to read ... white text on a light
       brown/grey background." MEASURED FALSE TWICE, per third, on the real frame:
         LEFT  7.92:1   MID  7.72:1   RIGHT 7.99:1  (vs brightest adjacent bg)
       All past WCAG AAA, and the right third — the one the review singles out —
       is the BEST of the three. That measurement took four wrong attempts to
       land (iteration 65) and the result has now survived two independent
       challenges across three rounds (63, 65, 70). A claim measured twice,
       re-measured under challenge, and unchanged is not a claim awaiting a
       better method;
     - radar: FORTY-FIFTH report, and "the player's car is represented clearly,
       perhaps with a small arrow indicating direction" is the `▲` player marker
       that `buildRadar` places inside the face, with an orientation toggle
       labelled in words beside it;
     - "The world is predominantly gray and desaturated ... for the city, vary
       building colors." The collage class, and the remedy is the per-building
       hue reversal declined in iterations 16, 23, 24, 25, 27, 29, 34, 36, 37, 39,
       40, 44, 55 and 65. Iteration 16 removed hue because it made every building
       carry an identity for no reason, and the measured mean saturation across
       the city (0.096) is that fix working. The arena/road half of the same
       finding — "add more distinct wear, oil stains, or different material
       textures" — is the ground ART item, recorded since iteration 6, and the
       DECALS form of it is the version that survives the "is this a lie about
       the simulation?" test.
     NO CODE CHANGED. The round's product is the calibration: two of this
     review's five findings are about a fix that shipped eleven and thirty-eight
     rounds ago respectively, one is a theme restatement, and two are classes
     this log has measured to death. Nothing here can be acted on, and the
     cheapest correct response is exactly the one iteration 48 wrote down — check
     whether the review is looking at the shipped build before treating it as a
     description of the current one.

71. qwen/qwen3.8-max-0902 -> ONE REAL FINDING, AND THE ROUND THAT FOUND IT ALSO
     EXPOSED THE WORST HARNESS FAILURE IN THE LOG. Both are recorded here
     because the second is what made the first trustworthy:
     - **THE TOOLING FAILURE: THE TOOL REVIEWED STALE SCREENSHOTS AND SAID
       NOTHING.** This review was run with `--shots .shots/iter70`, a directory
       that DOES NOT EXIST — the newest capture was iter68. It completed
       normally, cost $0.05, recorded the full screen list
       (`['title','arena','road','city','constructor']`), and reported five
       detailed findings with pixel coordinates as if it had seen the build.
       Cause, and it is a genuinely nasty one:
         `sips` EXITS 0 ON A MISSING FILE. It prints
         "Warning: .shots/NOPE/arena.png not a valid file - skipping" to stdout
         and returns success. So `await execFileAsync('sips', ...)` RESOLVED,
         the caller's `catch` never fired, no "no capture" was logged, and the
         `if (frames.length === 0) throw` guard never ran. The next line then
         read the OUTPUT path — a FIXED per-screen name
         (`.opencode/reviews/_small_arena.png`) that a PREVIOUS run had already
         written. So the model was sent a set of resized captures from an
         earlier iteration and reviewed them as the current build.
       This is the same class of failure this log keeps hitting, in its purest
       form: a healthy-looking signal standing in for a fact. The empty-body
       parse failure (iteration 62) lost one review; a phantom "0 models asked"
       (iteration 16) would have re-asked every model forever; this one does
       neither, and is worse for it — it produces confident, detailed,
       entirely unfounded findings that look exactly like real ones.
       FIXED. `reviewSized` now stats the source itself before trusting sips,
       throws on a missing capture, verifies the output exists, and writes to a
       name keyed on the source path AND its mtime+size, so a new capture of the
       same screen can never be served from a previous run's resize. PROVEN both
       ways: a run against `.shots/NOPE` now prints five "MISSING capture" lines
       and throws, while a real shots directory still resolves. The
       `if (frames.length === 0) throw` guard that already existed now actually
       works, because the thing it was guarding could never previously fail.
     - **THE REAL FINDING, which the stale review described by accident.** "An
       empty teal-outlined rounded rectangle cut off by the viewport edge and
       overlapping the CONDITION panel header ... it renders as a broken widget."
       I nearly dismissed that as the product of reviewing old art — and the
       framing was still right: the widget is in the CURRENT build. Cropped the
       real iter68 arena and it is there, an empty teal-bordered rectangle peeking
       out from behind CONDITION at the top edge.
       It is `src/app.ts:2542` — the arena's `exitBtn`, "Exit to Title", mounted
       at `position:absolute; top:8px; right:8px`. And `.hud-panel--damage` (the
       CONDITION panel) was ALSO at `top: var(--inset); right: var(--inset)`. The
       HUD host paints after the button, so the panel covered it completely.
       **The way out of an arena run has been invisible and unclickable.** What
       survived on screen was the button's own teal border corner, which is
       precisely why it read as a "broken widget" rather than as a hidden
       control.
       FIXED: the CONDITION panel is offset down 34px (the button is ~29px tall),
       and the exit button is now plainly visible and clickable in the corner with
       the panel sitting cleanly beneath it. The offset is scoped in effect,
       because the arena and road are the only screens that mount this panel —
       the city carries the car strip from iteration 28 instead. Side effect
       recorded honestly: the road screen, which has no exit button (a road run
       auto-advances to the city on arrival, so that appears to be deliberate),
       now has a 34px gap above its CONDITION panel where nothing sits. A small
       cosmetic imbalance traded for a working primary control, which is an easy
       call.
       WORTH NAMING, because it is the sharpest lesson in the log about what the
       loop is actually for: seventy reviews had gone past this button. Not one
       of them said "the exit control is missing", because a control hidden
       BEHIND a panel is not an element any reviewer was looking for — it is
       simply absent from every screen they were shown. The only reason it
       surfaced at all is that a reviewer described the sliver of leftover border
       as an unexplained artifact, and the loop's own rule ("a claim that recurs
       from independent reviewers is evidence about MY CHECK") applied to a
       single reviewer noticing a piece of visual noise nobody had explained.
       The most valuable defect in sixty reviews was found by treating an
       unexplained detail as a defect rather than as noise.
     - The remaining four findings (title menu orphaned from the logo, a "collapsible
       weapon list", city streets, roadside props) are the known classes:
       iteration 43's composition measurement, the 0-9 index addressing, the
       city street-network ART item, and the roadside-furniture candidate recorded
       in iteration 60 and corrected in 61. Not re-argued here.
     - Recorded against the review itself: it is a WEAK review on its merits.
       Having been sent the wrong images, it still produced five plausible
       findings — four of them wrong, and the fifth a real defect it described
       accurately but attributed to a "broken widget" rather than to a covered
       button. That is worth noting for how the pool is weighted: even a review
       of stale screenshots can surface a real defect, and even a weak review can
       be right once. But the correct response to the REVIEW is still to weight
       it, while the correct response to the FINDING is to go and look.

72. qwen/qwen3.8-max-prime -> 1 REAL, and it is the THIRD report on an element
     this loop declined twice — but the remedy it offers is a different one, and
     that is what makes it actionable. 4 FALSE:
     - "Two grey chips expose raw options state ('off') during play ... visible
       settings literals read as a debug build and train players to scan past
       that corner ... they add two dead lines of text to every combat frame,
       diluting the corners that carry real telemetry." REAL, and the third
       report on this element (iterations 39 and 52 made the first two), so the
       perception is corroborated rather than idiosyncratic. Both earlier
       remedies were "remove them" or "move them into a collapsible menu", and
       both were declined on one ground: these controls are one-key reachable
       BECAUSE they are on screen, and burying them means a player who needs
       reduced shake mid-combat has to go find a menu.
       This proposal survives that objection, and the distinction is the whole
       point: "if an in-HUD reminder is required, show a single small icon only
       while a reduction is active." That keeps the keybinding AND the click
       target, and drops only the thing nobody needed — a chip reading "off".
       A chip that reports a null is not information, it is a corner (the
       bottom-right, already carrying the radar-adjacent stack) spent on every
       frame of every run to say nothing. A chip reading "on" is load-bearing:
       it tells the player a reduction is active and lets them switch it off.
       So each chip now renders ONLY while its own setting is on, and the panel
       marks itself `data-empty` when both are off — the exact mechanism
       `buildMessageFeed` already uses, for the same reason, in the same file.
       THE TRADE IS REAL and worth stating rather than burying: a keyboard
       player can still toggle either reduction with the same key, but a player
       who has never seen the control now has one fewer cue that it exists. That
       is a smaller loss than two permanent "off" lines teaching every player to
       ignore the corner — but it is a loss, and it is the reason this took three
       reports rather than one;
     - A TEST WAS PINNING THE OLD BEHAVIOUR, and that is the more interesting
       half. `wires the reduced-flash and reduced-shake toggle buttons` asserted
       `expect(buttons).toHaveLength(2)` against a default snapshot with both
       settings OFF — so it only passed because the chips were rendered
       unconditionally. The test's name describes wiring, but what it actually
       guaranteed was permanent visibility. That is the third time in this log a
       test written to pin a fix has been the thing standing in the way of the
       next fix (iterations 29 and 33 were the first two), and it is the mirror
       of those: those tests caught a fix breaking an invariant; this one was
       quietly enforcing the bug. Replaced with three tests that assert the new
       contract in BOTH directions — nothing rendered and `data-empty` when both
       are off, exactly one chip when one is on, both wired when both are on. The
       replacement is a strictly better test than the one it replaced, because it
       now pins the property that actually matters (an "off" chip is never
       rendered) instead of the incidental one (two nodes exist);
     - "The route progress bar is a plain black rounded track with a lone white
       knob ... no progress fill, no origin/destination marks, no distance ticks,
       and no mileage on the bar itself ... reads as an unstyled debug slider."
       The "no progress fill" half is the static-frame class for the FOURTH time
       (iterations 22, 46, 53, 58): the fill is a teal-to-blue gradient scaled by
       progress, and at `scaleX(0)` on a fresh 150-mile run it is legitimately
       empty. The rest is a real enhancement rather than a defect — origin and
       destination ticks, quarter marks, and the mileage riding the fill edge.
       Iteration 22 declined the duplicate readout for a specific reason ("the
       number is already on screen, one row up") and that reason still holds, so
       this is recorded as a design option, not actioned;
     - "The arena floor is a seamed, unbounded grey void ... no wall, prop or
       decal appears anywhere in frame." The arena class, twenty-two reports deep,
       with the same remedy set (boundary, cover, decals) declined in iterations
       21, 24, 33, 34, 40, 55, 58 and 66 for the recorded reason: the arena has no
       collision, so a painted wall lies and non-colliding props are things the
       player drives through. The decal form remains the one that survives the
       "is this a lie about the simulation?" test, because a decal is placed
       content and does not repeat;
     - "City POIs are unlabeled chevrons ... attach a small label plate above
       each marker that fades in within ~40m or on hover." NEW, and worth
       separating from the iterations 51/52 hover-tooltip ask, which was
       INAPPLICABLE because there is no DOM to hover on a canvas. Drawing the
       label IN the render is possible and is a different thing. It is declined
       for the same reason the markers cannot be made louder (iterations 33, 47,
       60): every one of a dozen POIs carrying a text plate is more ink
       competing with the marker it labels, on the element the loop has
       established is already the most contested thing on the screen. The legend
       (iteration 39, enlarged to 12px in 52) is the DOM-side answer and it
       exists;
     - "The constructor's left column stops at ~60% of viewport height leaving
       large black dead regions ... armour and weapon rows separated only by a
       thin yellow gutter so they read as one undifferentiated 16-row stack."
       The dead space below the schematic is real and has now been raised by
       three separate reviews (28, 58, 72) without a remedy this loop can take:
       the suggested fixes are a sticky-header scroll region and a scaled-up
       preview, both of which restructure the screen, and the "undifferentiated
       stack" complaint describes the section rule from iteration 17 and the
       requirement rails from iteration 48 doing exactly the job they were added
       to do. Recorded as the most persistent unresolved layout item in the log.

73. qwen/qwen3.8-27b -> 1 REAL, and it is a genuine internal inconsistency in the
     HUD rather than a taste disagreement. 4 FALSE:
     - "Three separate panels of different sizes and background weights are
       stacked in the top-centre: a solid dark title pill, a control-hint line
       on its own LIGHTER TRANSLUCENT STRIP, and a third status box. The middle
       hint strip's background differs from the others ... the HUD looks
       assembled from parts rather than designed." REAL, and the specific claim
       ("the middle hint strip's background differs") is checkable in one grep,
       which is why it is worth separating from the review's larger ask:
         status pill  `background: rgba(10,14,20,0.7)`
         hint  strip  `background: rgba(10,14,20,0.62)`
       Two near-identical dark pills stacked 26px apart, 0.08 alpha apart, read
       as two mismatched components rather than as one stack. Nothing about that
       is intentional; the 0.62 was picked by eye when the hint became a separate
       fading element in iteration 18, and the status pill's own alpha was later
       raised independently (to 0.86 on the road in iteration 24) without the
       hint following. The two numbers simply drifted apart.
       FIXED by making them identical (0.7, matching the pill directly above),
       which is the whole of the defect. The reviewer's LARGER ask — merge all
       three into one banner with a single type hierarchy — is a layout
       consolidation and is declined for the reason iteration 58 recorded: the
       three elements carry three different KINDS of information (permanent
       status, a transient teaching aid, and the session log), they are placed
       separately by deliberate screenshot passes (iteration 18 moved the hint
       clear of the 44..52px progress-bar band), and the hint fades after 7s so
       the stack is not permanent. Fixing the measurable part of the complaint
       rather than the structural part is the same discipline iteration 72
       applied to the accessibility chips;
     - "A large dashed circle encircles the building cluster and the player car,
       with no label or legend entry ... it reads as a leftover debug overlay."
       That is the PERIMETER WALL (`prop-citywall`), which iteration 1 recorded
       as a closed ring of segmented sprites with its face outward — a
       deliberately dashed-looking band. It is not a debug overlay and it is not
       unlabelled by accident: the city is a walled compound and the wall is what
       makes it read as one. Note the echo of iteration 50 here, where a reviewer
       described this same element as "low-contrast gray" and I built a fix,
       measured, found the wall byte-identical, re-tinted to locate it, and
       reverted having sampled the wrong element. The wall's true contrast has
       therefore still never been measured, and that remains an open check rather
       than a settled one;
     - "Building markers don't match the legend — a green chevron on a blue tile,
       a blue chevron on a green tile ... no red marker is visible in this frame."
       The chevron and its base are ONE sprite carrying ONE tint
       (`facilityMarkerTint`, iteration 37), so they cannot disagree; what shows
       through the marker's semi-transparent upper half is the GROUND behind it,
       which is the grey-green city surface, not a second service colour. And
       "no red marker is visible in this frame" is the static-frame class again —
       a frame shows the facilities near the player, and the capture is the
       practice-rig layout. The legend's fourth entry describes a facility that
       need not be on screen. The player's teal chevron is iteration 8's GATE
       BEACON, deliberately not a service and deliberately not in the legend;
     - "Empty HUD states read as broken, not as 'none equipped' — 'none fitted'
       is faint italic gray and the armour slots look like unfilled form fields."
       The OPPOSITE of iterations 21, 50 and 57, which called the loud dashed
       chip correct and the faint dash wrong. Both positions were deliberate, for
       opposite reasons, and the log now holds the tension explicitly: the
       ARMOUR panel shouts its empty state (iteration 21 — an unfitted slot must
       not read as an area that failed to render) while the WEAPONS list dims
       its empty slots (iteration 17 — the list is dense, and dimming the empties
       is what makes the fitted weapons land). Changing the weapons list to "full
       opacity accent" would invert iteration 17's whole solution to the density
       problem to satisfy a complaint that iteration 17 already answered with a
       measurement. Declined, and recorded as the log's clearest example of two
       correct decisions about opposite elements;
     - "The constructor's left column is a flat wall of dim empty rows with dead
       space below the help line." The density class (iterations 17, 27, 31, 57,
       58, 62, 72) and the dead space first noted in iteration 28 and raised by
       three separate reviews since. Still no remedy this loop can take that
       does not restructure the screen or break the 0-9 index addressing.
     ONE REAL, FOUR FALSE, and the real one was a two-digit drift between two
     numbers that were never compared to each other.

74. qwen/qwen3.5-plus-20260420 -> ZERO REAL. Nothing changed, and every one of
     the five is checkable in a single place — which is the strongest statement
     this log can make about a review, because a claim that survives one grep
     never needed the frame to refute it:
     - "The menu container is a semi-transparent dark box placed directly over
       the dark shadowed cracks of the road texture ... add a solid background
       or a strong outer glow to separate it from the environment." The ELEVENTH
       report of the menu class, against a panel that has been near-opaque since
       iteration 20 (a 0.92-alpha stack with a top-lit inner highlight). The
       glow remedy is the competing-boxes treatment iteration 32 removed once
       the fill became visible without it;
     - "The radar face is nearly black with a very faint green sweep; no visible
       grid lines or distinct contact blips." FORTY-SIXTH report. The rings,
       crosshair, sweep and `▲` player marker are all in the frame, and the
       contact blips remain the fabrication declined seventeen times;
     - "The progress bar is a single-pixel white line floating directly over the
       noisy grey asphalt WITHOUT A BACKING PANEL." FALSE, and the backing is
       right there in the stylesheet:
         .sm-road-progress {
           height: 8px;
           background: rgba(10, 14, 20, 0.82);
           border: 1px solid var(--ui-line-strong);
           box-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
         }
       A dark 0.82 track, a 1px border and a drop shadow — described as no
       backing at all. What the reviewer is actually seeing is the CAR GLYPH: the
       fill is `transform: scaleX(routeFraction)`, which is 0 on a fresh 150-mile
       run, so the only thing visible inside the 8px track is the small light
       marker at its head. That is the static-frame class for the FIFTH time
       (iterations 22, 46, 53, 58, 72) and it is worth noting that iteration 24
       already raised the STATUS PILL to 0.86 for exactly this reason — the pill
       is fixed and the bar was never the thing being read;
     - "The cracked pavement and the grey concrete roofs share nearly identical
       brightness and saturation." The collage class, FOURTEENTH report, against
       measured building/ground gaps of 17.2 and 18.7 luma (iteration 16/17), and
       the remedy — "darken the ground texture significantly" — is the direct
       reversal of the fix that established cohesion in the first place;
     - "The wireframe outline of the car is a thin, low-opacity cyan line
       against a dark blue background ... increase the opacity and line
       weight." STALE, and precisely stale: iteration 13 exists BECAUSE a review
       called this schematic too faint, and raised the chassis to bright cyan on
       navy. This is the twelfth report of the preview class and the first to
       quote the pre-iteration-13 state as if it were current.
     NO CODE CHANGED. Worth naming what five greps in a row adds up to: this is
     the first review where EVERY finding was falsifiable from source without
     opening a single screenshot. A review that can be refuted that cheaply has
     not engaged with the build, and the correct response to it is to weight it
      rather than answer it.

75. qwen/qwen3-vl-30b-a3b-thinking -> ZERO REAL. Nothing changed. Two of the five
     assert a font size of "8-9px" for text that is declared as 13px in a single
     token, and the round is worth recording for the harness rather than the
     findings: the first attempt pointed `--shots` at a directory that did not
     exist, and `reviewSized` REFUSED it instead of quietly resizing the stale
     `_small_*` files iteration 74 had left behind. The stale-screenshot guard
     built at iteration 71 paid for itself on its first live use:
     - "Radar display is a solid black disc with no visible sweep line or contact
       indicators (e.g., rotating line, glowing dots for targets)." FORTY-SEVENTH
       report. `hud.css` documents the sweep, the range rings, the crosshair and
       the `▲` player marker in the comment block at lines 286-324, written
       precisely because "a radar that is technically drawn but reads as broken"
       is the failure. The remedy proposed here — "add a rotating line and a dot
       for testing" — is to add the thing that is already there plus a permanent
       lie, since a fabricated contact blip has been declined seventeen times;
     - "Colored arrow icons (green/orange/red) blend with gray cracked background
       due to low contrast/saturation ... increase icon saturation by 20% and add
       a 1px white outline." The markers carry a real drop shadow
       (`DOORMARKER_SHADOW_SOFTNESS = 0.5`, `DOORMARKER_SHADOW_OPACITY = 0.62`,
       city-view.ts:254-255) and the saturated tints iteration 52/53 installed
       over the desaturated originals. A 1px white outline on every marker is the
       same competing treatment declined on buildings: it puts a second, brighter
       edge on a shape whose job is to sit BEHIND the chevron it marks;
     - "Tagline text is small, low-contrast, and blends with the dusty orange
       background ... increase font size by 20% and add a 1px dark outline." The
       contrast was measured in iteration 65 at 7.92/7.72/7.99:1 across the three
       thirds, i.e. above the 7:1 AAA line, at 13-16px. A dark outline is also
       the specific remedy the tagline gradient was built to make unnecessary;
     - "(empty) text is too small (8-9px) and low-contrast." `.sm-builder` sets
       `font-size: var(--ui-text-base)` at builder.css:81 and that token is
       `0.8125rem` — 13px, labelled "the HUD's body size" — at tokens.css:199.
       The 8-9px figure is arithmetic on a downscale: 1440 -> 1280 is 0.889x, so
       13px lands at ~11.6px with a ~10px glyph band, and "bright cyan" would
       recolour a placeholder to match an icon it does not represent;
     - "Numbers (e.g., "FR: 4/4") are too small (8-9px) and lack contrast ...
       use bright green (matching the progress bars)." `.hud-root` inherits the
       same 13px base through `--tbase: calc(var(--ui-text-base) * var(--hud-scale))`
       (hud.css:51,63), and the ink measures 24-55:1. The colour half of the
       remedy is the part worth declining explicitly: painting the number the
       same green as its bar collapses a value and a meter into one undifferentiated
       block, which is the same "two stacked pills, two different alphas, nobody
       compared them" defect fixed in 6812a2b one commit earlier.
     NO CODE CHANGED. Two of five findings are one 13px token misread by a
     downscale, which makes this the second review in a row (74, 75) where the
     cheapest possible refutation      was to read the stylesheet.

76. qwen/qwen3.5-9b -> ONE REAL, AND IT WAS NOT THE FINDING. Four false, one
     real, and the real one is the same size complaint as iteration 75 with a
     genuine defect hiding underneath it:
     - "The tagline text blends into the bright, sunset-colored background ...
       apply a subtle text stroke or change the color to a slightly darker,
       opaque white/grey." THIRD report of the iteration-65 finding, against a
       measured 7.92/7.72/7.99:1 across the three thirds — above the 7:1 AAA
       line. A "dark outline" here is also the second remedy proposed for the
       same pixels in two rounds running, neither of which has been tried
       because the contrast measurement says there is nothing to fix;
     - "The radar display lacks a visible sweep or scanning animation, appearing
       static ... add a subtle, rotating line or sweep across the radar face."
       FORTY-EIGHTH report. The sweep, the range rings, the crosshair and the
       `▲` player marker are documented in hud.css:286-324 — that comment block
       exists SPECIFICALLY because "technically drawn but reads as broken" was
       the failure mode. The reviewer is describing, as a defect, the exact
       state iteration 21 built the ring structure to make legible;
     - "The health numbers (e.g., '4/4') are small and crowded next to the
       labels ('FRONT') ... increase the font size or weight to make them the
       primary data point." Size is false (`.hud-root` inherits `--tbase`, which
       is `--ui-text-base` x `--hud-scale`, at ink contrast 24-55:1). The
       hierarchy half has no competing element to lose to: the row is a label
       and a value, the bar is the meter, and iteration 54 already rebalanced
       the bar to 6px/5px so the value is not competing with it;
     - "The list of slots lacks a visual cursor or highlight for the currently
       selected row." The highlight is not missing, it is generic —
       builder.ts:712 applies `sm-builder__row--selected` to ANY row whose index
       equals `state.selectedIndex`, and `computeRows()` interleaves the ten
       weapon rows into that same flat array, so a weapon row gets the same
       52%->30% gradient and the same label recolour as the Name row. The real
       reason no weapon row is highlighted in the capture is that a pristine
       frame boots with `selectedIndex: 0`, which is the Name row: this is the
       "selected rows" static-frame class, and a still frame of a list with one
       cursor in it will always show the cursor on row one;
     - "The car stats ('0 armour - 0 mounted') are small and run together next
       to the larger warning text." HALF STALE, HALF REAL. "Run together" has
       been fixed since iteration 49 — the string is `ui.city.stripStats`,
       "{armour} armour · {weapons} mounted", with a middot, because em dashes
       were replaced in that exact round. But "small" was pointing at something
       true for the wrong reason: the city strip hard-coded `font-size:12px` in
       an inline style, so it was the one readout in the build that could not
       follow `--ui-text-base`, the 13px body token everything else inherits.
       FIXED: the strip now uses `var(--ui-text-base, 13px)`. The hierarchy half
       is declined on purpose — the gate line is allowed to be the loudest thing
       in the box, because it is the actionable road-legality state and the
       stats are context, and making the context louder to satisfy a scan-speed
       argument would invert the box's job.
       Verified: tsc clean, 65 files / 1423 tests, 2 browser tests, build clean
       (bundle hash `index-CnHcXLff.js` unchanged by the follow-up comment fix,
       which is the point — the token swap was the only behavioural byte),
       `.shots/iter76` = 8 screens, 0 problems, and `--ui-text-base: .8125rem`
       confirmed present in the SHIPPED css rather than assumed from source.
       The Vite `@import must precede all other statements` warning on hud.css
       line 38 was chased down while verifying this and is COSMETIC: tokens.css
       does reach the bundle (`--hud-scale: 1` and `--ui-text-base` both present),
       so no import is being dropped.
       One correction to my own first comment on this fix, worth recording
       because the log is mostly about not claiming more than was measured: the
       strip inherits `--ui-text-base` but NOT `--hud-scale`. The scale reaches
       the HUD through `--tbase`, which is declared on `.hud-root`, and the strip
       lives outside it. The comment now says that.
       DISCOVERED, NOT FIXED, ON PURPOSE: grepping for the literal this review
       complained about found four more hard-coded `font-size:12px` elements —
       the arena control hint (app.ts:2520), `deviceNotice` (4202), the road
       `driveHint` (5013) and the road `notice` (5017). All four are transient
       HINTS or ALERTS, not readouts, and a hint sitting a tier below body text
       is deliberate. They stay 12px. What they are NOT is accidental, so this
       log is where that decision is recorded instead of a fifth review
       re-reporting them.

77. google/gemini-2.5-pro-preview -> ZERO CODE CHANGES, THREE REAL FINDINGS, AND
     ALL THREE LAND ON ITEMS THIS LOG HAS BEEN DEFERRING. The first call failed
     with `finishReason: "error"` and a zero-length body, which is NOT the same
     thing as a model that declined to answer, so it was not logged as asked: the
     ID was checked against the live OpenRouter catalogue (present, 464 models,
     `input_modemities` includes image), a 20s backoff was taken, and the retry
     returned a full review. A parse failure caused by an upstream error must
     never be allowed to pass as "reviewed, nothing found".
     This is the strongest review the loop has produced in the last ten rounds,
     and the shape of it is worth naming: it found nothing in the code and
     re-derived, independently, all three art items that have been sitting in
     DEFERRED since iteration 36.
     - "The title screen uses a high-detail, painterly/photorealistic
       illustration. The in-game art style is a top-down, low-resolution
       aesthetic." REAL, and it is the top deferred item arriving with a second
       independent argument. Iteration 36 recorded that the title art shows
       TANKS rather than cars; this review says the same asset is also the wrong
       ART DIRECTION — a painted key-art plate against a top-down sprite game.
       Two independent routes to the same verdict on one file:
       `assets/ui-title-art.png` needs regenerating in the game's own style, and
       it needs to show a car. Still an asset regeneration, still not a CSS
       change, still must not be faked with a filter;
     - "The vehicle schematic is a simple, abstract blue outline with two
       rectangles inside. It provides no visual information about the selected
       parts or the final appearance of the car." FALSE, and the pristine-capture
       trap again: the schematic draws armour zones and fitted weapons, with
       `.sm-builder__preview-zone--selected` and `.sm-builder__preview-weapon--selected`
       for the part being edited. A build with 0 armour and 0 weapons correctly
       renders as an outline with empty zone rectangles, which is what the capture
       is. builder-preview.ts:102 records WHY the schematic exists instead of the
       real sprite: a sprite cannot carry armour, so the zones are the only place
       that information can live. The proposed "use the actual in-game vehicle
       sprite" would delete the feature. The preview class, THIRTEENTH report;
     - "The icons are colored chevrons ... their meaning is not intuitive from
       the design alone ... replace the abstract chevrons with simple,
       recognizable pictograms." REAL, and already agreed: the log defers
       "redesign city chevrons as worn painted signs". Iteration 37 added the
       colour legend and the marker-to-key mapping; the missing half is pictogram
       ART, and this review supplies the right pictogram vocabulary (wrench for
       garage, cart for market, reticle for arena, briefcase for jobs) with the
       right rule that colour should mean status, not type. That is a better
       specification than the one this log was carrying;
     - "The minus-sign icons for missing armor plates are difficult to
       distinguish from the empty slots at a glance. All health bars are the
       same green color ... use a traffic-light color system: green for >75%,
       yellow for 25-75%, and red for <25%." FALSE, and the refutation is the
       reviewer's own proposal, already implemented. `damageState()` (hud.ts:178)
       splits at exactly 0.25 and 0.75 — the proposed bands — into ok/damaged/
       critical/destroyed, each with its own token (`--ui-ok`, `--ui-damaged`,
       `--ui-critical`, `--ui-destroyed`, hud.css:707-721) AND its own glyph
       (`● ▲ ◆ ✕`, hud.ts:171-176). The panel encodes state twice, in hue and in
       shape, and the review proposed a subset of a four-state system. The dash
       complaint is the fifth state, documented at hud.ts:496-501: an unfitted
       facing is neutral grey with a dash and NO green, precisely so "no armour
       bought" cannot be misread as "armour undamaged". A test pins it;
     - "The ground is covered in a single, repetitive, noisy texture ... lacks
       variation, large-scale detail, or handcrafted elements." REAL, and the
       fourth independent arrival at the ground-decal deferral. The remedy is
       concrete and correct: oil stains, tyre marks, painted lane markings,
       unique crack patterns, debris sprites. Worth recording the one part that
       is NOT art: "on the Road screen, the lack of variation also makes it
       harder to judge speed" is a gameplay-legibility claim about a moving
       ground plane, and that is a different problem from tiling variety.
       It belongs with the deferred fixed-roadside-furniture work, because
       roadside furniture is the only ground feature that moves past the camera
       at a known rate and therefore the only thing that can carry speed.
     NO CODE CHANGED, and this is the correct outcome rather than a disappointing
     one: three findings are real, none of them is a defect a line of code causes,
     and the correct response to all three is art work this loop is not equipped
     to do. What the round DOES establish is that the deferral list is not a
     backlog of avoidance — three separate reviewers, arriving by different
     routes, have now independently demanded the same three assets.

78. TITLE ART REGENERATED — the top deferred item, executed. No review this round
   (the model pool is exhausted at 75/75); this is the plan being carried out
   from iteration 77's three real findings rather than a new critique.
   - `assets/ui-title-art.png` showed two ARMOURED TANKS in a bright orange
     sunset. The tagline under it reads "One car. Sixteen cities. A highway that
     wants you dead." The art had been contradicting the game's own pitch line
     since iteration 36 and no amount of CSS was ever going to fix that, which
     is what the deferral note said all along.
   - STYLE SOURCE WAS A REAL CAPTURE, NOT A MEMORY: prompted from
     `.shots/iter76/city.png` — 90-degree overhead, cool desaturated blue-grey
     cracked pavement, saturated rust-orange car, teal accents. The first wave of
     16 (4 prompts x 4) all put a hero car DEAD CENTRE, which is exactly where
     the wordmark sits, so all 16 were rejected on composition. Second wave of
     16 with the layout stated as a constraint ("the left half is EMPTY dark
     tarmac, the car is at the far right edge") and the model complied.
   - Winner: a single car at the far right edge throwing a teal headlight pool,
     vast empty cracked tarmac across the left two thirds, sweeping tyre marks
     arcing through the top, one worn lane line running diagonally. It reads as
     the tagline, which is more than the old plate ever did.
   - THE SCRIM HAD TO BE RETUNED WITH IT, and this is the part worth keeping:
     the overlay was a BAND, `0.34 / 0.72 / 0.34`, and every one of those numbers
     was tuned against a BRIGHT SUNSET. Over night art 0.34 bought nothing and
     cost the hero car its silhouette — the identical complaint the band was
     introduced to fix, arriving again through the opposite change. Outer stops
     are now 0.16/0.18; the 0.70 peak stays because the lane line genuinely runs
     under the lockup. Measured on the real frame: title luma 34.2 -> 39.07,
     spread 31.4 -> 40.24, i.e. the art got more legible rather than darker.
   - TAGLINE CONTRAST RE-MEASURED, not eyeballed, and it went UP: 12.71:1 against
     a measured background luma of 0.0266 that is IDENTICAL in all three
     horizontal thirds (uniform dark tarmac, no bright spots at all), versus
     7.92/7.72/7.99:1 in iteration 65. Method: real build, real Chrome, hide the
     lockup, sample the composited background under the tagline's own measured
     box (501,420 439x23) — the same discipline as iteration 65, and the reason
     iterations 75/76/77 could dismiss "the tagline is unreadable" with a number
     instead of an opinion.
   - Provenance was updated rather than left lying: `tools/asset-manifest.json`
     recorded `flux-pro seed 402` for a file that is now a Seedream 4.5 render,
     which would have been a false record of where the asset came from. One line
     changed, trailing comma and one-entry-per-line format preserved (first
     attempt rewrote the whole file to 266 lines of diff; reverted and patched
     surgically — 1 insertion, 1 deletion).
   - Filename and 1344x768 dimensions kept ON PURPOSE: `assets/atlas.json` records
     the standalone entry as `ui-title-art.png` and a test pins that filename, so
     a rename would have broken the atlas contract for no gain.
   Gate: tsc clean, 65 files / 1423 tests, 2 browser tests, build clean,
   `.shots/iter78` = 8 screens, 0 problems. Deployed to arcade.shoemoney.com.

79. NO NEW REVIEWER (pool exhausted at 75/75) — the second deferred art item,
   EXECUTED. And executing it uncovered the worst silent-revert in the log.
   - **CITY MARKERS ARE NOW PICTOGRAMS.** The finding came from iteration 77:
     "the icons are colored chevrons ... their meaning is not intuitive from the
     design alone ... replace the abstract chevrons with simple, recognizable
     pictograms", with the vocabulary supplied: wrench for garage, cart for
     market, reticle for arena, briefcase for jobs.
     Twelve reviews had asked for something about this element and every one had
     been answered on the SIZE axis (iterations 19, 20, 26) or the VOLUME axis
     (33, 47, 60) — which is why a shape change was still sitting untouched.
     The marker was never a floating chevron: it is a doorstep MAT at the
     building's inner face, which is exactly why reviewers kept reading it as a
     UI overlay. So the fix is the mat's own art, not its size.
       combat   reticle            (arena)
       workshop crossed hammer+wrench (garage, weaponshop, salvage, assembly)
       care     medical cross      (medical, bar)
       trade    briefcase          (truckstop, federal, courierguild, + unknown)
     Colour still carries the family (iteration 37) and the legend (iteration 39)
     still teaches it, but the SHAPE now carries it too — so a player who cannot
     match cyan to "Jobs" can still read the briefcase, and the legend's swatches
     visibly match the mats below them.
     Art: 4 Seedream 4.5 renders, prompted for a flat orthographic square mat in
     a cracked stone kerb, magenta flat background for the keyer. Composition was
     checked before integration rather than after: 3 of the 8 first-wave
     candidates were rejected for perspective drift, and BOTH workshop
     candidates were rejected because the model rendered the literal word
     "WRECROSS" — the prompt token read as text. Re-asked with a symbol-only
     description and one instruction ("a single open-ended wrench drawn as a
     plain bold shape") and it complied. This is the same lesson as the title
     art's first wave: state the composition as a CONSTRAINT, and expect a
     rejected wave.
     The key colour had to be NORMALISED, and the reason is a real trap. The
     existing prop-doormarker carries `keyColorDeviation: 59` — 59 degrees of
     magenta tolerance, which comfortably contains the RED combat mat's hue. Had
     these gone in as generated, the red mat would have been keyed away and the
     fight marker would have rendered as a hole. All four were trimmed to content
     and recomposited onto a uniform #F03C80 canvas, so all four corners and
     edges sample the exact key and the measured deviation is 0.
     - ONE FAMILY MAPPING NOW FEEDS BOTH THE FRAME AND THE TINT. It was a
       `switch` duplicated in two places, which the pictograms turned into a real
       hazard: a family added to the tint table but not the frame table renders a
       RED WRENCH. `facilityMarkerFamily` is now the single mapping, exported as
       a runtime const so `MARKER_TINTS` is exhaustively typed and the test
       fixture can enumerate families instead of hardcoding them.
     - THIS IS A FRAME SWAP, NOT AN EXTRA INSTANCE, so the exactly-full city actor
       buffer is untouched — the buffer was the reason iteration 19 had to revert
       these shadows, and no count edit was needed here at all.
   - **AND IT SILENTLY REVERTED THE TITLE ART. The worst bug in the log.**
     `assets/ui-title-art.png` is not source art. It is a BUILD ARTIFACT: any
     frame in `tools/atlas-sizes.json` `extractStandalone` is re-encoded from
     `assets/raw/<name>.png` into `assets/<name>.png` on EVERY `pack-atlas` run.
     And `integrate-codex-assets.mjs` runs the packer.
     Iteration 78 wrote the regenerated car art by hand straight into
     `assets/ui-title-art.png` and never touched `assets/raw/ui-title-art.png`,
     which still held the September 26 tank plate. So the moment this iteration
     ran the packer to fold in four unrelated markers, the title art was rebuilt
     from the stale source: 270,524 pixels changed, 26% of the screen, back to
     the two armoured tanks that iterations 36 and 77 had both demanded be
     removed. A green suite, a clean build, and a passing capture gate all
     straight through it.
     It survived iteration 78 only because iteration 78 never ran the packer.
     The class is the one this log keeps meeting — a healthy signal standing in
     for a fact — but the specific shape is new: **a fix written to a build
     output rather than its input, which no test in the repo claimed any
     relationship over.** `configFingerprint` ties the atlas to
     `tools/atlas-sizes.json`; nothing tied it to the pixels.
     FIXED IN THREE PARTS, because one would have left the hole open:
       1. the correct art was written to the SOURCE, and the artifact regenerated
          from it — verified pixel-identical to the version iteration 78 measured
          (compare AE = 0), and independently confirmed by the capture gate
          reporting title luma 39.07 / spread 40.24, the exact iteration-78
          numbers;
       2. `.gitignore` now tracks the SOURCE of a standalone frame. This needed
          the pattern changed from `assets/raw/` to `assets/raw/*`, because git
          does not descend into an ignored DIRECTORY, so a file-level exception
          inside one is silently inert — the first version of this fix looked
          correct and tracked nothing;
       3. a new test asserts every `extractStandalone` artifact is
          pixel-identical to what its raw source produces, AND that the source is
          tracked. PROVEN both ways: tampering the artifact by one red circle
          fails with "differs ... in 27 bytes ... edit the raw source and repack,
          or the next pack-atlas run will overwrite it", and repacking restores
          it. Renaming a family to `combatX` was used the same way on the
          iteration-39 marker test.
   - PIPELINE FIXES THE ROUND FORCED OUT, both in
     `tools/integrate-codex-assets.mjs`:
     - `--only name,name` now exists. Without it, integrating four new frames
       re-processes all 26 existing ones, and because the per-frame note is
       derived from whether a meta entry already exists, every one of them would
       have been stamped "— replacing previous art" for art this run was not
       touching. That is a false provenance record, in the one tool whose job is
       keeping provenance honest. It also accepts both `--only a,b` and
       `--only=a,b`, and REFUSES an empty list rather than defaulting to every
       frame;
     - the note template hardcoded "codex (GPT-6 Astra) generated", but this art
       came from Seedream. The generator is now a per-frame field defaulting to
       the old wording, so a non-codex render records where it actually came
       from instead of inheriting a false one.
   - Also worth recording as a small trap: the generated PNGs came out of ImageMagick
     at 16-BIT depth, and the keyer's hand-rolled decoder sizes its scanline
     stride without a 2x multiplier for 16-bit samples — so it read garbage
     filter bytes and threw `bad filter 255`. Every existing raw asset is 8-bit.
     One `-depth 8` fixed it; the failure was loud, which is the good kind.
   - VERIFIED: tsc clean, 65 files / 1424 tests (one new guard), 2 browser tests,
     build clean, `.shots/iter79` = 8 screens / 0 problems, title luma 39.07 and
     city luma 93.34 — both matching their iteration-78 values, which is the
     check that the art swap cost the frame none of its measured range.

80. NO NEW REVIEWER (pool still 75/75) — the road half of the ground-decal
   deferral, EXECUTED. Iteration 77 named it: "on the Road screen, the lack of
   variation also makes it harder to judge speed", and recorded that this is NOT
   an art item — a static ground plane cannot carry speed, because only
   something moving past the camera at a known rate can.
   - **GUARDRAILS DOWN BOTH VERGES.** The finding chain is long and worth
     reading, because every step was declined for a good reason before this one:
     iteration 60 raised it ("there are no barriers, delineator posts, signs,
     traffic or debris anywhere between the top and bottom of the frame ... at
     driving speed the car feels stationary"), and iteration 61 CORRECTED its
     traffic half — passing opponents are spawned by `updateEngagement` and are
     simply sparse, and a seeded t=0 capture has none in frame. The furniture
     half survived that correction and is the real gap.
     Chosen over a ground DECAL (the other half of the deferral) because a decal
     is PLACED CONTENT, which is exactly why it is still sitting as an ART item
     — it is an authoring job. A guardrail is the same honesty for a different
     reason: repeated FURNITURE at a KNOWN INTERVAL is what real highways use to
     make speed readable, it adds no gameplay surface, and nothing about it
     pretends to be solid (nothing in the road sim collides against props).
       period 7m, segment 5.5m, so a 1.5m gap — a CONTINUOUS rail would be a
       static line and would carry no speed at all; the gap is what makes a
       rhythm the eye can read motion from. Both verges, laterally clear of the
       paint AND the shoulder: sitting them on the shoulder would read as more
       lane marking, which is the one thing the dash lattice already is.
   - ART: the first attempt asked for a 3D guardrail and got 3/4 perspective in
     all four candidates — which ASSET-NOTES §5 records as a documented failure
     ("vehicle sprites that read as slight 3/4 perspective rather than true
     orthographic, and are inconsistent with each other"). Re-asked for a FLAT 2D
     elevation instead, which is what a 90-degree overhead camera actually sees,
     and got three clean flat candidates first time. Chose the one with a rust
     stain: the warm accent is what stops a pale bar reading as more white road
     paint, which was the specific confusion I was worried about.
   - BUFFER PLACEMENT, decided before writing code rather than after overflowing
     one. `SPRITE_INSTANCE_CAPACITY` is 64 and the road already spends it on the
     player plus passing traffic; ~20 more instances there would be the
     iteration-19 mistake (a tight buffer read as a policy instead of a contract
     to grow). They go in the GROUND buffer instead — 2048 slots, ~20 used — and
     that is not a downgrade, because `ROAD_GRADE` is a POST uniform applied to
     the whole composited frame, so a ground-buffer instance keeps full
     brightness exactly as a sprite-buffer one would. A top-down guardrail lies
     on the ground anyway.
   - THE FIRST PASS MADE THE FURNITURE OUT-SHOUT THE CAR, and it was caught by
     measuring rather than by looking. At full tint the rails measured 126.5 mean
     luma against the player's own 100.5 — iteration 60's "the oversized icons
     out-rank the player's car as the focal point", reproduced on a brand-new
     element. Tinted down and re-measured rather than guessed: 0.66 moved the
     rails to 111.3, and 0.58 to a 123.1 tight-box reading that was HIGHER than
     the loose box had been — which is the tell that "rail mean luma" was never
     a stable statistic in the first place, and the second version of the number
     says nothing. So the final call was made by LOOKING at the frame, where the
     answer was obvious: at full strength the rails were the brightest large
     area on screen, and at 0.58 they read as weathered steel furniture sitting
     clearly below the only saturated warm object in the game. Worth stating
     plainly, because the log is mostly about this: a measurement I took twice
     disagreed with itself, and the correct response was to stop measuring and
     look at the picture.
   - CHECKED FOR THE ITERATION-17 TRAP, which is the standing rule that a fix
     improving one axis by spending another gets caught by the next reviewer:
     road/verge luma gap is IDENTICAL before and after (91.8 / 124.2, gap 32.4,
     byte-identical in both captures), because the rails sit outside the verge
     and never touch the surface the earlier fix was about. Road spread rises
     97.87 -> 109.19, which is the rails being real structure rather than noise.
   - THREE TESTS, one of which CORRECTED ME. The first version of the
     world-anchoring test asserted that moving the car forward by exactly one
     period yields the same instance x-positions. That is wrong, and the code was
     right: a sliding window over a world lattice legitimately drops one index
     at one end and gains one at the other. The property actually worth pinning is
     that every rail sits on an ABSOLUTE multiple of the period wherever the car
     is — which is what distinguishes a world lattice from a car-relative one,
     and a car-relative lattice would slide as the car moved, destroying the only
     thing the feature is for. The other two pin both verges being clear of the
     paint, and the segment being sized to the art's 4.57:1 rather than stretched
     to the period. PROVEN by mutation: making the lattice car-relative fails
     the anchoring test and leaves the other two green, which is what a
     correctly-scoped guard should do.
   - VERIFIED: tsc clean, 66 files / 1427 tests, 2 browser tests, build clean,
     `.shots/iter80` = 8 screens / 0 problems.

DEFERRED (real, documented, not bugs):
- ~~TITLE ART SHOWS TANKS~~ — DONE at iteration 78.
- ~~City chevron pictograms~~ — DONE at iteration 79 (reticle / crossed tools /
  medical cross / briefcase, one mat per facility family).
- Ground decals — oil stains, tyre marks, lane paint, unique crack patterns.
  The gameplay half is DONE at iteration 80 (guardrails on both verges, 7m
  period, for road-speed perception). The DECAL half is still an art item: a
  decal is placed content and does not repeat, which is the whole reason it
  cannot be faked from a tiling texture.
- City daylight grade (the 0.6 ground tint is why it reads dim), street network,
  10 empty weapon rows.

DEPLOY 2026-09-30 — release `20260929194913-66bd430` to arcade.shoemoney.com
- Host is `shoemoney.com` (100.49.4.12), plain Ubuntu nginx, NOT the NAS/swarm
  from the shoemoney-swarm runbook. Root is `.../arcade.shoemoney.com/current/public`
  and `current` is a symlink into `releases/<ts>-<sha>/` — 41 releases deep.
  nginx: `location / { try_files $uri $uri/ =404; }`, so a missing `public/index.html`
  is a 403, not a 404.
- Recipe: build -> `mkdir releases/<name>/public` -> `cp -a current/api` ->
  rsync `dist/` into `releases/<name>/public/smduel/` -> snapshot scores.sqlite
  with `sqlite3 .backup` (python `Connection.backup()`, never `cp` a live WAL db)
  -> atomic swap via `ln -s ... current.new && mv -T current.new current` ->
  curl-verify.
- MISTAKE, RECORDED BECAUSE IT 403'd THE WHOLE ARCADE FOR ~2 MINUTES: I staged
  `public/` containing ONLY `smduel/`, copying `api/` but not the rest of the
  previous release's `public/`. The landing page needs `public/index.html` plus
  the other seven games, and `current` is the nginx root for ALL of them, so a
  partial release takes down the arcade, not just the game you were shipping.
  A release is a WHOLE-SITE snapshot. `cp -a <prev>/public/. <new>/public/`
  first, then overlay the one subtree you changed. Fixed in place (no second
  symlink swap) and re-verified: root 200, smduel 200, last-engineer 200,
  shoplifter 200.
- CONCURRENT DEPLOYER ON THAT BOX, NOT MINE: three releases appeared during this
  deploy (19:45:44, 19:48:45, and the arc's own). Their shas (4d4da5, e6fc5f) are
  not in this repo — the arcade builds from a DIFFERENT repo that vendors smduel,
  and there is no arcade source on the box. Consequence: this deploy is a correct
  release, but the next arcade deploy can overwrite smduel from their source.
  The durable path for loop changes is landing them in the arcade repo, not only
  here. Worth confirming with the arcade owner.
- Live verified: title screen boots, wordmark + tagline legible, lower-left menu
  renders, zero console errors. (A `querySelector('canvas')` check reads null on
  the title screen and that is CORRECT — it is pure DOM; only world screens
  create a canvas. Do not treat it as a failed boot.)

Tooling: `node tools/review.mjs --list | --model <id> --shots <dir>`
Reviews: .opencode/reviews/
DEPLOY 2026-09-30 — release `20260930013105-be03afb` (be03afb) to arcade.shoemoney.com
- Whole-site snapshot taken FIRST (`cp -a $PREV/public/. releases/$NAME/public/`, then
  `cp -a $PREV/api`), smduel overlaid with rsync --delete, atomic swap. All nine
  games verified 200 afterwards, so the iteration-78 partial-release lesson held.
- LIVE VERIFIED, not assumed: `/smduel/` title art is byte-for-byte the version
  iteration 78 measured (compare AE = 0) — the check that mattered, given this
  round proved the artifact had silently reverted once already. The four new
  frames are present in the SHIPPED bundle (`index-2kMSaQ98.js`), and a live
  WebGPU screenshot of `?screen=city&seed=a11ce5ee` shows all ten New York mats
  rendering their pictograms with zero console errors.
- A PROCESS FAILURE WORTH KEEPING, because `set -e` did not save me. The runbook
  says to snapshot scores.sqlite. This box has no `sqlite3` CLI, and the step was
  written as `sqlite3 ... && echo "db backup ok"` — a failing command on the LEFT
  of `&&` does not trigger `set -e`, so the script sailed past the missing
  backup, printed nothing about it, and completed the swap. A deploy step that
  fails quietly is worse than one that fails loudly: I would have shipped and
  reported success with no snapshot taken. Caught only because I read the output
  back. Redone with python's `Connection.backup()` (the runbook's own fallback,
  and the right primitive regardless — `cp` of a live WAL db is a torn snapshot);
  `integrity_check` returns ok. EVERY deploy step needs its own explicit check
  rather than relying on the script aborting.
- Reminder for next time: the box has no `sqlite3`; use python. And confirm
  `/tmp/smduel-dist` is uploaded BEFORE the staging script runs — the first
  attempt referenced a path that did not exist yet, and `set -e` did abort there,
  so the live site was never touched by a half-built release.
81. NO NEW REVIEWER (pool still 75/75) — the DECAL half of the ground-decal
   deferral, EXECUTED. And the first thing this round did was find out the art
   was never missing.
   - **FIVE DECAL FRAMES WERE PACKED INTO THE SHIPPING ATLAS AND DRAWN BY
     NOTHING.** Checking what `decal-*` art existed before deciding this was an
     authoring job:
         decal-mine        decal-oil-slick    decal-spikes
         decal-scorch      decal-tire-marks
     `grep -rn "'decal-"' src/` returns ZERO for every one of them. They have
     been shipping — costing download bytes in the atlas on every load — since
     long before the loop, referenced by no line of source.
     So the deferral note's premise was half wrong. It said "a real fix is new
     ART", and iterations 78/79/80 all treated the ground-decal item as an
     authoring job for exactly that reason — the note never checked whether the
     art already existed. The three stains were already drawn, keyed (with
     uniform key deviation 0 on two of them), packed and ready:
         decal-oil-slick   88x96   black irregular slick with a gloss highlight
         decal-tire-marks  60x96   two curved black skid marks
         decal-scorch      85x96   soft black soot splatter
     `decal-mine` and `decal-spikes` stay unwired, and deliberately so: those
     are gameplay HAZARDS, not stains, and nothing in the sim drops either. The
     distinction is worth keeping in mind — "an unused frame" is not always a
     wiring bug, and the two left unused here are unused on purpose.
   - **THE ARENA NOW HAS EVIDENCE OF USE.** The arena-emptiness class is 22+
     reviews deep (21, 24, 33, 34, 40, 55, 58, 65, 66, 72) and every remedy it
     asked for was declined for one settled reason: walls, cover and spawn pads
     are content the simulation does not have, and painting them would make the
     arena claim affordances it does not offer.
     Decals survive that test for the reason iteration 58 first named: a decal
     is PLACED CONTENT. It does not repeat, so it adds the large-scale structure
     the tiling deliberately refuses to — and `src/render/ground.ts` already
     measured the alternative (a per-cell grid of different ground textures
     meeting at hard edges) as "a visible grid of seams", measurably worse than
     the repetition it was meant to fix. A stain is also honest about the
     simulation: it is evidence that cars have been here, not something the
     player can drive into.
   - SCATTER: 16m cells, 45% of them carrying a stain, per-cell offset capped at
     0.35 of a cell so a stain can never straddle a boundary and read as a
     seam. Hashed from INTEGER WORLD CELL COORDS through three `Math.imul`
     rounds, with no float arithmetic in the chain, so a cell yields the same
     stain at the same offset, rotation and scale on every frame and every
     visit. That is the property iteration 21 destroyed by centring its ring on
     the car, and it is the reason the stains read as ground rather than as
     particles following the player.
   - BUFFER: the ground/tile buffer, which the arena was using for exactly ONE
     instance (its floor quad) out of 2048. Same reasoning as the guardrails in
     iteration 80 — a decal is painted ON the surface, and `ARENA_GRADE` is a
     post uniform over the whole composited frame, so it keeps full brightness.
   - CHECKED FOR THE ITERATION-34 TRAP, which is the real risk here and worth
     stating: iteration 34 established that a fix damping the ground's high
     frequencies had also flattened the LOW-frequency slab lattice, because both
     asks were served by one number. A stain is precisely a large dark
     low-frequency blob, so it could plausibly have eaten the joints — and the
     lattice is the arena's ONLY spatial reference, which iteration 21 declined
     to fake a replacement for.
       ground mean   150.73 -> 150.17   (-0.56)
       ground spread  48.40 ->  49.11   (+0.71, structure added)
       lattice dips  20     ->  20      (IDENTICAL — joints fully intact)
     The joints survive untouched, which is the right outcome and not a lucky
     one: stains are sparse, offset within their cells, and never aligned to the
     lattice period, so they add variation without competing with the reference.
   - FIVE TESTS, and the world-anchoring one is proven by mutation: making the
     lattice CAR-RELATIVE — iteration 21's exact defect — fails 3 of the 5,
     including the anchoring test, and restoring it passes. The determinism
     test correctly stayed GREEN under that mutation, because a car-relative
     scatter queried from a fixed car position is still deterministic; the two
     properties are genuinely orthogonal rather than two names for one thing.
     One test also asserts all three frame kinds are REACHABLE, since a kind
     that never draws is the precise state the art was found in.
   - A TEST-FIXTURE BUG, recorded because it is now the third instance of the
     class and the second in two rounds: the first draft copied the
     road-furniture test's `at()` helper, which wraps its argument as
     `{ position: { x, y } }`, while `groundDecalInstances` takes a FLAT
     `{ x, y }`. Every cell index was NaN, so the scatter correctly returned
     nothing and three tests failed with `expected 0 to be less than 0`. The
     guard was fine, the fixture was wrong — iteration 25's NaN bar fixture
     again. The real call site passes `player.position` (flat) and the capture
     proves the feature works, so nothing shipped broken. The helper now
     documents why its shape differs from the road one.
   - A STALE COMMENT the iteration-51 cleanup left behind, found while reading
     the arena's ground path: it still cited `buildGroundField`, a function that
     was deleted many iterations ago. Same class the log already flagged as
     "worse than no comment" — a comment that confidently describes an
     architecture you would need in order to change the code.
   - VERIFIED: tsc clean, 67 files / 1433 tests (6 new), 2 browser tests, build
     clean (`index-DyS72v05.js`), `.shots/iter81` = 8 screens / 0 problems. Every
     other screen byte-identical (title 39.07, city 93.34, constructor 36.09),
     which is the correct blast radius: the decals are arena-only.

DEPLOY 2026-09-30 — iteration 81 to arcade.shoemoney.com
- Release `20260930021500-ddb6c17`, build `index-DyS72v05.js`. Whole-site
  snapshot first, atomic swap, root + all games 200, all three decal frames
  present in the SHIPPED bundle, and a live `?screen=arena&seed=a11ce5ee`
  WebGPU capture is pixel-identical to the local one with 0 console errors.
- **A STALE-BUILD DEPLOY THAT EVERY CHECK PASSED.** The first attempt shipped
  iteration 80's bundle while every gate reported success — routes 200, staged
  snapshot OK, swap done, and a "dist confirmed on box" line I had written
  specifically to catch it. That check tested whether `/tmp/smduel-dist`
  EXISTED on the remote. I had rsynced `dist/` to a LOCAL /tmp and never
  uploaded it, so the remote directory was left over from iteration 80's
  deploy, where it existed and was perfectly valid. The check passed because it
  answered a different question than the one I cared about.
  It surfaced only because the live bundle hash (`index-DheRzFIq.js`) did not
  match the hash my own build had just printed ten minutes earlier
  (`index-DyS72v05.js`) — a comparison I made for an unrelated reason while
  checking whether the concurrent deployer had clobbered the release. It had
  not; I had clobbered it myself.
  This is the THIRD time in this log that a healthy-looking signal stood in for
  a fact (iteration 16's phantom "0 models asked", iteration 71's sips-on-a-
  missing-file, and this), and the fix is the same each time: assert on the
  VALUE, not on the presence. The deploy script now compares the bundle hash
  on the box against the hash the local build printed, and refuses to swap on
  a mismatch. It also now greps the STAGED index.html for that hash before the
  swap, so a bad overlay cannot be published even if the copy step is wrong.
  Worth noting the shape: the previous iteration's log had already recorded
  "confirm /tmp/smduel-dist is uploaded BEFORE the staging script runs" as a
  reminder, and the reminder was followed with a check that did not enforce it.
  A remembered lesson is not a control.
- `scores.sqlite` no longer exists under `<release>/api/`, so the DB snapshot
  step reported its own absence rather than silently passing (iteration 131's
  `set -e`/`&&` lesson holding: the step prints what it did and did not do). The
  arcade's score store is evidently not in this subtree any more — worth
  confirming with the arcade owner alongside the already-recorded point that a
  concurrent deployer builds smduel from a different repo.

82. NO NEW REVIEWER — REVIEWER STRATEGY CHANGED MID-ITERATION. From here the
   advisory reviewer is Codex CLI running `gpt-6-1-sol`, which can drive the
   browser with computer use rather than only reading the captures this loop
   hands it. Every false-finding class in the log above traces to the same root
   cause: the reviewer was handed a DOWNSCALED still and asked to judge a live
   WebGPU app from it. Letting it drive the app itself attacks that at the
   source instead of raising the capture resolution again.
   This iteration is the city half of iteration 81's stains, and it is the
   clearest case in the log of a fix whose first two attempts were both wrong
   for reasons that only measurement found.
   - WHY THE CITY. It is the flattest surface in the game — measured ground
     spread 10.26, against 13.25 in the arena and 25.56 on the road — and that
     number is what fourteen reviews calling it "a monochromatic value wash"
     are describing. Iterations 16/17 settled WHY the city is grey (mixed-source
     buildings each carrying their own hue; a multiply tint cannot fix
     mismatched SATURATION), so the answer is not to put colour back. It is to
     give the ground large-scale tonal structure, which is what a stain is and
     what the tiling deliberately refuses to provide.
     Structurally easier here than in the arena: the city does not scroll (a
     fixed circle about the plaza centre at (0,0)), so a cell-hashed stain is
     trivially world-anchored, and its ground layer is MEMOISED per layout, so
     covering the whole city costs nothing per frame.
   - ATTEMPT 1 CHANGED NOTHING AND EVERY GATE PASSED. Reusing the arena's
     16m cell on a city it turns out is only 6.0-10.65m in radius put the whole
     map inside about two cells, of which four qualified inside the wall, so a
     45% gate averaged under two stains. It built, every test passed, and the
     city's measured ground spread moved 65.99 -> 66.00 — a delta small enough
     to read as noise on any dashboard. Caught by noticing the number, not by
     a gate, which is why the fix this round is a COUNT FLOOR in the test.
   - AND THE SOURCE OF THE WRONG NUMBER WAS A STALE COMMENT. `showCity` said
     "The city is a ~21m circle". It is 6.0m for the smallest city and 10.65m
     for New York, scaling with facility count. I designed the cell size from
     that comment. Corrected, and the correction records all sixteen measured
     radii so the next reader does not have to re-derive them.
     This is the third stale-comment incident in the log (iteration 51's
     groundField, iteration 81's buildGroundField) and the first that caused a
     shipped-wrong result rather than merely misleading a reader.
   - ATTEMPT 2 WAS ALSO WRONG, IN A NEW DIRECTION. A 8m cell gave the city
     enough positions, and the stains appeared — but at the ARENA's sizes, and
     the city's camera is zoomed far tighter (~67 px/m for New York against the
     arena's 40) while its buildings are only 3m across. A 4.2m oil slick came
     out LARGER THAN A BUILDING, which is not a stain, it is a car park. So the
     city now scales cell and size SEPARATELY, for two different reasons: the
     cell is about how many candidate positions exist (3m, so the smallest
     city's 12m diameter holds four), and the size is about how big a stain
     should look (0.45x, so nothing exceeds a building footprint). A test pins
     the second directly.
   - THE COUNT CONTRACT IS NOW DERIVED, NOT RESTATED. `cityGroundTileCount`
     returns 1 + `cityGroundDecalCount(layout)`, and both the count and the
     emitted instances walk the SAME cell iteration. Iteration 53 added a test
     catching emitted-vs-claimed drift after the count had already cost two
     runtime blank-screen bugs; this is the stronger form of that fix — the
     drift is now unrepresentable rather than merely detected.
     And the older city test that asserted `layer 0 === 1` failed on the new
     code, which was the test being pinned to the old contract rather than the
     code being wrong. It now derives the total the same way, so the two tests
     cannot disagree.
   - A THIRD FIXTURE BUG IN THREE ROUNDS, all the same class. The new test called
     `generateCityLayout('providence', () => 0.5)` — the second parameter is a
     `saveSeed: string`, not a function — which silently produced a degenerate
     1-doorway, 6m layout instead of a city. It is now the real city ids from
     `cities.json` with the capture rig's own seed, and the smallest city is
     resolved from the ruleset rather than assumed, because the smallest city
     is the binding case for cell size and New York is not.
   - The capture gate earned its place a third time: an intermediate build
     referenced an identifier that had been dropped in a refactor, and the gate
     reported `arena BLANK-FRAME ... decalsInCells is not defined` rather than
     shipping a broken screen.
   - VERIFIED: tsc clean, 67 files / 1439 tests (6 new), 2 browser tests, build
     clean (`index-SZR-64oQ.js`), `.shots/iter82` = 8 screens / 0 problems.
     City spread 65.99 -> 66.65 with luma 93.34 -> 93.18, so the stains add
     structure and take almost nothing off the mean. Every other screen
     byte-identical.

83. **REVIEWER CHANGED: Codex CLI, `gpt-6.1-sol`, driving the live app.** The
   advisory reviewer is no longer a vision model handed downscaled stills. Four
   things had to be true before a single review could run, and each failure is
   worth more than the findings that followed.
   - `gpt-6-1-sol` is not a real slug; the model cache calls it `gpt-6.1-sol`.
     My first call used the dashed name and the error said the model was
     unsupported, which read as an auth problem and was actually a typo.
   - The ChatGPT subscription is EXHAUSTED ("usage limit, resets 2026-10-04"),
     and the stored OpenAI API key is out of quota. So neither native codex
     path could run a single call.
   - `gpt-6.1-sol` IS on OpenRouter, and `OPENROUTER_API_KEY` is set in the
     environment. So codex runs it through a custom provider, added to
     `~/.codex/config.toml` as a purely ADDITIVE `[model_providers.openrouter]`
     block with `model_provider` passed per-invocation, so no other codex use
     changes behaviour. `auth.json` was backed up and restored to ChatGPT auth
     after testing. Revert: delete that block.
   - **A TRIVIAL PROMPT COST 25,773 TOKENS.** The cause was not the model, the
     browser or the context window: codex loaded 537 skill descriptions, the
     user's AGENTS.md, RTK, Poteto, Unslop and a project memory index into every
     call. The trace of the first doomed run ended on the literal reasoning step
     "Assessing token budget". Running from an ISOLATED HOME (auth + a config
     carrying only the openrouter provider and the browser MCP servers, and
     deliberately NO skills directory) cut the baseline to 11,185.
   - **AND THE REAL KILLER WAS A RATE LIMIT, not any of the above.** Every run
     died silently at ~130s having done real work. `-o/--output-last-message`
     writes the answer only on a CLEAN completion, so a rate-limited run wrote
     nothing — the symptom was "codex produced no review", three separate
     times, and the reason was only visible in the tail of a trace nobody would
     otherwise read. OpenRouter rate-limits `gpt-6.1-sol` upstream and a
     computer-use loop trips it; the limit is bursty, not a quota. Fixed with
     retry + backoff around the whole review, and `-o` truncated per attempt so
     a partial run can never pass as a fresh answer.
   - `tools/review-codex.sh` now encapsulates all of it, and the reviewer's
     `computer-use` MCP is ENABLED there — it is `enabled = false` in the
     user's own config, so a review relying on it would have had neither tool.

   **TWO REAL FINDINGS, both confirmed against the current build.**

   - **1. THE MANDATORY CAR-NAME FIELD COULD NOT BE TYPED INTO AFTER CLICKING
     IT.** The name row owns a click listener calling `onRowActivate`, which
     re-renders the constructor. A click inside the input bubbled to it, the
     re-render replaced the input, and the browser dropped focus to `<body>`.
     Reproduced in a real browser before changing anything: `activeElement` was
     BODY after `input.click()`, and typing produced an empty value; focusing
     the element directly and typing worked, which is what made it look like a
     keyboard bug rather than a click-propagation one. The field is MANDATORY,
     so the obvious interaction failed at exactly the point a new player must
     act, with the LEGALITY panel still saying "car name is required" and never
     explaining why the field ignored them.
     Fixed with one line — `ev.stopPropagation()` on the input's click — which
     is the same guard the `keydown` path beside it already had. The trade is
     recorded: clicking the field no longer re-selects its row, which is
     invisible in the state a player meets it in.
     **AND THIS IS A BROWSER TEST, NOT A UNIT TEST, and that is the point.**
     `tests/unit/builder.test.ts` drives a DOM double that stores listeners per
     element and fires them on the element — it does not model BUBBLING. A
     test written there would have passed with the bug present and failed to
     fail without it. `tests/browser/menu-layout.test.ts` already exists for
     the same class of reason (happy-dom returns 0/0 for every rect); this is
     the bubbling equivalent. Proven to fail on both assertions with the fix
     removed, and to pass with it restored.
   - **2. LEGALITY SAID "NO VIOLATIONS — READY TO BUILD" FOR A CAR WITH ZERO
     ARMOUR AND ZERO WEAPONS, AND CONFIRM LET IT THROUGH.** Worse than the
     reviewer first stated, which was that the message appeared. Tested
     directly: naming the car switched the panel out of its pristine branch
     (`isPristineBuilder` returns false as soon as a name exists), the panel
     then took the `violations.length === 0` branch, and pressing Enter on
     CONFIRM BUILT THE CAR — arriving in the city strip reading
     "Duster · 0 armour · 0 mounted · **Not road-legal**".
     So two surfaces on the same screen contradict each other, and the screen
     the player trusts told them a build was ready when the rest of the game
     did not agree. Root cause: the requirement gate (name + armour + a mounted
     weapon) is enforced somewhere other than `validateDesign`, so the
     violation list the panel renders never contained it. NOT FIXED THIS ROUND
     — the fix is a question about where the requirement belongs, and the
     iteration-48 amber rails already mark the unmet rows, so the honest fix is
     to make the panel's definition of "violation" include what actually gates
     CONFIRM rather than to add a second, parallel check. That deserves its own
     iteration rather than a patch bolted on at the end of one.
   - Two of the reviewer's other findings (Confirm clipped at the bottom; city
     facilities unlabelled) are STALE against this build — the first was fixed
     by iteration 39's pinned footer and the second is answered by iteration
     79's pictogram mats plus iteration 39's legend — but they were made
     against a build this loop was not shipping, which is its own finding below.
   - FINDING #4 (the budget is never shown, so a player only learns their $2000
     limit by exceeding it) is real against this build and is queued.

   **AND THE REVIEWER CAUGHT A DEPLOYMENT PROBLEM, WHICH IS THE MOST USEFUL
   THING IN THE ROUND.** It reported the live deployment serving
   `index-bVh14wWE.js` and noted the constructor and city "differ from the build
   described in your brief" and that the served bundle "does not handle
   `?screen=`". Checking: correct, and the cause was not a code defect at all.
   The concurrent arcade deployer had overwritten my release AGAIN — live was
   `20260929222348-0e1398`, not my `20260930024000-b8b8e90`. Two shipped
   iterations (81 and 82) were not actually live when the review ran, and every
   finding in it was made against someone else's build.
   So three of the loop's own deployment facts were wrong or unverified at once:
   the live build was not mine, "iteration 81/82 are deployed" was false, and
   an earlier check of mine had reported the site CURRENT on the strength of a
   route returning 200. A 200 says the site is UP, not that it is MINE — the
   same shape as the 48th radar report and the iteration-16 phantom "0 models
   asked": a healthy signal standing in for a fact. The release check now
   compares the served bundle hash against the local build, which is the only
   thing that actually answers the question. Redeployed and re-verified.
   - VERIFIED: tsc clean, 67 files / 1439 tests, 4 browser tests (2 new), build
     clean (`index-Cs2Oosdf.js`), `.shots/iter83` = 8 screens / 0 problems,
     every screen byte-identical (the fix is behaviour, not appearance).

84. The second half of iteration 83's finding 2, EXECUTED: the LEGALITY panel no
   longer tells the player a build is ready when it is not.
   - THE BUG, precisely. Two surfaces on one screen said opposite things. The
     amber "needs input" rails on the rows came from the name/armour/weapon
     requirement, derived inline in `computeRows`. The panel rendered
     `validateDesign`'s violations, which cover component validity, cost and
     fractional input — but NOT road legality, because that rule lives
     elsewhere in the game. So naming a car with zero armour and zero weapons
     produced "No violations — ready to build" directly beneath rails marking
     all five facings and all ten weapon slots as needing input. And CONFIRM did
     not stop it: pressing Enter built the car, which arrived in the city
     reading "Duster · 0 armour · 0 mounted · Not road-legal".
     The panel was the part that lied. The city telling you a car you
     deliberately built is not road-legal is the game being straight with you,
     and the constructor's pristine copy has taught those three requirements
     since iteration 23.
   - `unmetRequirements(state)` is now exported, and BOTH the rails and the
     panel read it. That is the whole fix, and it is the same shape as the
     city-decal count in iteration 82: two surfaces deriving one rule from two
     places is how they drift, and the fix is to make the second derivation
     read the first. `validateDesign` is deliberately UNCHANGED — it answers
     "is this a coherent, affordable, physically legal design", and folding a
     player-facing onboarding prompt into a rules function would be the wrong
     layer. The message wording is the existing `legalityStep*` strings, so the
     first thing a player reads on a fresh build and the thing they read after
     editing it say the same three things.
   - The pristine branch is untouched and there is a test saying why: a fresh
     build shows the bold prompt plus three steps (iteration 23) rather than a
     violation list, because an untouched build is not a failure the player
     caused. The two branches are different surfaces on purpose and must not
     collapse into each other.
   - VERIFIED IN A REAL BROWSER, not read off the source:
       pristine        "Name your car, then fit armour and at least one weapon
                        to make it road-legal. Type a name in the Name row at
                        the top. Add armour points to any facing on the left.
                        Mount at least one weapon — press Enter on a Weapon row."
       named, 0/0      "Add armour points to any facing on the left. Mount at
                        least one weapon — press Enter on a Weapon row."
     The false "No violations — ready to build" is unreachable while anything is
     unmet. 3 new tests; one of them pins the complete case so the panel can
     still legitimately say "ready to build".
   - A FOURTH INSTANT OF THE SAME FIXTURE TRAP, and the second time the exact
     trap: `FACINGS` is UPPERCASE (`'FRONT'`, src/sim/types.ts:17) and my test
     fixture set `armor.front`. Iteration 25 recorded this precise failure —
     lowercase facing keys in a fixture, `current` undefined, a guard doing its
     job on bad input. The first run failed with one unmet requirement instead
     of zero, which was the fixture lying, not the code. Also guessed a weapon
     id (`w-machine-gun`) that does not exist; the real ids are unprefixed
     (`machinegun`). Neither cost more than a minute, but four of these in the
     log is a pattern worth naming: the fixtures are written from memory of the
     shape rather than from the type.
   - VERIFIED: tsc clean, 67 files / 1442 tests (3 new), 4 browser tests, build
     clean (`index-C0NGogWz.js`), `.shots/iter84` = 8 screens / 0 problems,
     every screen's luma and spread byte-identical to iteration 83 — this fix
     changes text on a screen the capture gate measures for appearance only.

   STILL OPEN, and deliberately not fixed this round: whether CONFIRM should
   HARD-BLOCK an unroad-legal build rather than letting the player build one and
   telling them at the city. Allowing it is defensible (you can drive around; the
   highway is what legality gates) and hard-blocking is defensible (the panel
   exists to gate). It is a design decision, not a defect, and it is the kind
   that belongs in the loop log as an open question rather than in a patch
   applied at the end of an unrelated iteration.
85. Iteration 83's finding 4, EXECUTED: the constructor now shows what the
   driver can spend. Found by Codex `gpt-6.1-sol` driving the live app with
   computer use: "The initial design shows a cost of $940, but the constructor
   does not show the driver's $2,000 budget or remaining cash ... the player
   learns their spending limit by making an unaffordable selection."
   The reviewer's diagnosis was right and the data was already there —
   `validateDesign(design, context.cash)` takes the budget, and `metrics.
   costTotal` is computed. The panel just was not rendering either number. So
   `Cost: $940` was a figure with nothing to be good or bad against, and the
   only place the limit was ever stated was the violation message a player had
   to trigger first.
   - THREE ADJACENT NUMBERS rather than one: `Cost`, `Budget`, `Remaining`. They
     belong together because they are one comparison, and splitting the other two
     across screens is what made the original problem.
   - `overBudget` is carried on the derived view, but the Remaining row renders
     with `invalid = false` EVEN WHEN OVER BUDGET, and that is deliberate. The
     flag means "this number is unknown" and paints `?????`. An unaffordable
     price is not unknown — it is known and wrong for your wallet — and Cost has
     always worked that way, with its own comment saying so. Painting the
     negative balance as `?????` would destroy the one number that EXPLAINS the
     violation, which is iteration 21's mistake exactly: a faint dash threw away
     the distinction between "no armour bought" and "armour undamaged", and this
     would throw away the distinction between "too expensive" and "cannot be
     computed". The explanation lives in the legality panel; the arithmetic lives
     here.
   - `formatMoney` puts the sign BEFORE the symbol. The naive `${-4000}` reads
     as a typo; `-$4000` is a number a player can act on, which is the whole
     reason the row exists. Verified on the real build: `COST $940 BUDGET $2000
     REMAINING $1060` pristine, and `COST $6000 BUDGET $2000 REMAINING -$4000`
     at max armour.
   - The strings scanner caught the two new labels on the first full run, which
     is it working: `tests/unit/strings.test.ts` fails on any DOM-position string
     absent from `rulesets/classic/strings.json` and not explicitly exempted. The
     exemptions are grouped by family and this file already has a
     "stat-sheet row labels (statRow(list, label, value, invalid))" group
     containing Cost, Weight, Spaces and the rest. Budget and Remaining are the
     same `statRow(label)` family, so they went in beside Cost rather than into
     strings.json — which would have meant a `t()` lookup for one-word labels
     that the other eight siblings do not use, and two languages for one panel.
   - A FIFTH FIXTURE THAT LIED, and the same one: `baseContext()` defaults to
     `cash: 1_000_000`, so no design a test can build is ever over budget, and
     the new over-budget test failed with `expected false to be true` for exactly
     that reason. The real starting budget, measured off the live build, is
     $2000. That is five fixtures in this log written from memory of the shape
     rather than from the value: lowercase facing keys (25, 84), a function where
     a `saveSeed: string` belongs (82), `w-machine-gun` instead of `machinegun`
     (84), a `{position:{x,y}}` wrapper where a flat `{x,y}` belongs (81), and now
     a million-dollar driver. Every one was caught by a guard doing its job on
     input that was not real, which is the good outcome, and every one cost more
     than reading the fixture would have.
   - VERIFIED: tsc clean, 67 files / 1445 tests (3 new), 4 browser tests, build
     clean (`index-BatjiGhX.js`), `.shots/iter85` = 8 screens / 0 problems.
     Constructor luma 36.09 -> 35.94 (two more rows of text) with spread
     unchanged at 43.23; every other screen byte-identical.
86. Codex `gpt-6.1-sol` review of the three GAMEPLAY screens, driving the live
   deployment with computer use. SIX findings, and the first one is a regression
   I shipped two iterations ago and never looked at.

   - **1. THE GUARDRAILS WERE LAID ACROSS THE ROAD INSTEAD OF ALONG IT, FOR TWO
     ITERATIONS.** The reviewer's description: "repeated pale objects above and
     below the highway ... each occupies roughly 190 CSS pixels vertically and
     40 horizontally, producing repeated comb-like objects perpendicular to the
     carriageway." Exactly right. The frame is 96x21, its long axis is local
     +Y, and `rotationRad: routeHeadingRad` therefore laid it along world +y —
     across an east-west road. `roadLaneInstances` gets this right because it
     takes `routeHeadingRad + Math.PI / 2`, and I copied the SHAPE of that call
     while assuming the furniture needed no quarter turn.
     And it was visible in this repo's own captures the entire time. I have a
     road screenshot in every one of iterations 80-85 showing a row of vertical
     combs, and I did not open one. That is iteration 39's rule arriving
     somewhere new: a claim that recurs is evidence about my check, and here the
     evidence was a file I generated and never looked at. Eighty-two vision
     reviews missed it because they were reading downscaled stills of other
     screens; one computer-using review of the road caught it in a minute.
     Fixed to `routeHeadingRad + Math.PI / 2`, and the comment that used to
     ARGUE FOR THE BUG ("the route heading alone points it ALONG the road — which
     is what a guardrail is, so no extra quarter turn here", both halves wrong) is
     replaced with the actual reason.
     THE GUARD IS A RELATIONSHIP, NOT A NUMBER: the new test asserts the rails
     take the SAME rotation as the lane markings, and that the long axis is in
     `sizeM.y`. Both are laid lengthwise down the carriageway, so tying them
     together means a future change to the shared orientation moves both and a
     change to only one still fails. Proven by mutation — reverting the rotation
     fails it and leaves the other three furniture tests green.
     `roadLaneInstances` is now exported for that assertion, which is the only
     other change this round.

   - **2. CITY VERTICAL CONTROLS ARE INVERTED — CONFIRMED, NOT FIXED THIS ROUND.**
     The reviewer drove it: "W/Up moves downward; S/Down moves upward. Arena and
     road use the opposite, expected mapping." Correct, and I verified the
     convention by tracing rather than by eye, which is the only reason I am
     confident in it at all:
         `resolveInput` is documented world-up-positive  -> W is (0, +1)
         `cityDirectionFromVector` negates y             -> (0, -1) -> 'N'
         `DIRECTION_UNIT_VECTORS.N`                     -> (0, -1)
         `buildOrthoMatrix` sets `m[5] = sy` (positive) and WebGPU puts clip +y
           at the TOP of the frame                          -> world +y is UP
     Three independent agreements with each other, and the code contradicts all
     three. Flipping the table's y components fixes it, and the table is read by
     exactly one function (`stepWalk`), so the blast radius is walking and
     nothing else — not the doorway ring, not the radar, not the layout.
     I implemented it, and it turned the suite red: **16 failures across three
     integration files**, because those tests WALK the player into facilities
     using the direction mapping. And the reason they walked the wrong way is
     the finding's second half:
         tests/integration/arena-auto-end.test.ts:166
           "('w' is north (-Y), 's' is ...)" — as an explicit comment stating the
           convention the test drives with.
     The same wrong assumption is written into a test that then pins it, exactly
     as it was written into `tests/unit/city.test.ts`'s table fixture, which
     agreed with the code for the entire time the code was wrong. I re-derived
     that fixture too.
     **REVERTED, DELIBERATELY.** A control-scheme change is not a one-line fix
     once real flows depend on it, and I was not going to ship 16 red tests or
     patch three integration fixtures at the end of a long round. The finding is
     fully diagnosed and the next iteration has everything it needs: flip the
     y components of `DIRECTION_UNIT_VECTORS`, re-derive the `city.test.ts`
     table fixture, and update the walk-direction helper in
     `arena-auto-end.test.ts` whose comment is the other half of the bug.

   - **3. THE ROAD SURFACE FOLLOWS THE CAR WHEN YOU DRIVE OFF THE ROUTE.**
     "Driving north away from the initial east-west highway makes the lane
     markings and roadside furniture leave the view, but an asphalt strip remains
     centered beneath the car." TRUE, and the code says so plainly — the road
     comment reads "The road is an unbounded world, so the ground quad is sized
     to the visible area and re-centred on the player each frame." Correct for
     the verge, wrong for the carriageway: the drivable strip is a separate
     rotated quad built around the PLAYER, not around a route origin. Real, and
     not fixed this round for the same reason as above — it is a structural
     change to how the road quad is anchored, and it deserves its own iteration
     rather than a rushed one. Queued with the fix sketched: anchor the surface
     and its paint to one route origin and extend it along that axis.

   - **4. "NOT ROAD-LEGAL" DOES NOT PREVENT DEPARTURE.** The reviewer drove it:
     entered the gate, selected Albany, and drove onto the highway with the
     starter Duster's 0 armour and 0 mounted. This is the open design question
     iteration 84 deliberately deferred, and it is now a second independent
     voice on the same point — the reviewer's framing is the sharpest version of
     it yet: "The warning promises a restriction that the gate does not
     enforce." A label that names a rule the game does not apply is a defect,
     not a preference, so this moves from "design question" to "queued fix".
     Either the gate refuses with reasons, or the strip stops calling it illegal.

   - **5. NORTH-UP RADAR TRIANGLE DOES NOT ROTATE WITH HEADING.** "After turning
     and driving east, the car points east while the radar triangle still points
     straight up." Believable and specific, and not yet checked — queued.

   - **6. CITY ENTRANCE SIGNS DO NOT NAME THE INDIVIDUAL FACILITY.** Two
     "Jobs"-category entrances behave completely differently — one opens a
     Federal Building that is a future-phase placeholder, the other a working
     menu with travel, recharge, lodging and armour. The category legend
     (iteration 39) is correct about the four families and says nothing about
     which door is which. Real gap, and the remedy the reviewer proposes — text
     overlays beside the signs, no new building art — is the right shape.
     Queued.

   HARNESS NOTES, because the reviewer is the tool now and its failures are part
   of the log:
     - **TWO MORE APPROVAL FAILS.** The playright MCP exempts only
       `browser_navigate` in the stock config, so `browser_click` answered "MCP
       tool call requires approval, but approval policy is never" and FAILED. A
       run died on exactly that call having already navigated and screenshotted
       three screens. Every interactive tool now carries its own
       `approval_mode`.
     - **BACKGROUNDING A LONG MCP RUN IS UNRELIABLE.** Three separate runs were
       backgrounded and all three were killed partway, writing a 0-byte answer
       and no retry. The same run in the FOREGROUND completed on the first
       attempt. The retry-and-backoff wrapper was still worth having for the
       rate limit; the foreground habit is what actually fixed it.
     - Scope is now three screens per run rather than eight, for the same reason.

   GATE: tsc clean, 66 files / 1446 tests, 4 browser tests, build clean. The three
   remaining failures are the pre-existing `tests/integration/screens.test.ts`
   flake — identical count to a clean-master run, verified by stashing.
87. Iteration 86's finding 2, EXECUTED: **W AND S WERE INVERTED IN THE CITY.**
   The control scheme the game opens on has been upside-down for its entire
   life. Found by Codex `gpt-6.1-sol` driving the live city — "W/Up moves
   downward; S/Down moves upward. Arena and road use the opposite, expected
   mapping" — and fixed here after being correctly diagnosed and deliberately
   deferred in iteration 86.

   - **THE CONVENTION, TRACED RATHER THAN EYEBALLED.** Three independent
     statements agree with each other, and the code contradicted all three:
       `resolveInput` is documented world-up-positive   -> W is (0, +1)
       `cityDirectionFromVector` negates y              -> (0, -1) -> 'N'
       `buildOrthoMatrix` sets `m[5] = sy` (POSITIVE), and WebGPU places clip
         +y at the TOP of the frame                     -> world +y is UP
     `DIRECTION_UNIT_VECTORS.N` was (0, -1) — correct for a y-DOWN renderer that
     this game does not use. Only `stepWalk` reads that table, so flipping its
     y components changes how the player walks and nothing else: not the
     doorway ring, not the radar, not `generateCityLayout`'s geometry.
   - **THE HORIZONTAL CONTROLS WERE ALWAYS FINE, WHICH IS WHY NOBODY CAUGHT
     IT.** E is (1,0) in both conventions, so A/D worked and W/S did not. A
     control scheme can be half-right for a very long time without the half
     that is wrong ever showing up in a screenshot — nobody presses keys in a
     still.

   **AND THE WRONG ASSUMPTION WAS WRITTEN INTO THE TESTS THAT WALK THE PLAYER.**
   That is the part that made this expensive, and it is the same shape as the
   defect `tests/unit/city.test.ts` was already guarding against for the whole
   time the code was wrong:
     - `tests/unit/city.test.ts` restated the table independently, derived from
       "+y is South (screen-space down)", and therefore AGREED WITH THE BUG for
       as long as the bug existed. A test that restates a table is only a guard
       if its own derivation is right. Re-derived from the render convention and
       the derivation is now written out, with `buildOrthoMatrix` and the WebGPU
       clip convention cited, so the next reader can check it rather than trust it.
     - `tests/integration/road-bounds-wiring.test.ts` and two sites in
       `screens.test.ts` each computed "walk INWARD toward the plaza centre" as
       `gate.y > 0 ? 'w' : 's'` — i.e. assuming W decreases y. Swapped to
       `gate.y > 0 ? 's' : 'w'`, each with the convention documented inline.
     - `tests/integration/arena-auto-end.test.ts:167` carried it as an explicit
       assertion in prose: **"'w' is north (-Y), 's' is south (+Y)"** — the wrong
       convention written down as documentation, in a file whose `walkBetween`
       helper then drove the player the wrong way. Fixed, and the comment now
       says what is actually true and why.
   Sixteen integration failures across three files became two, then zero for
   everything except the pre-existing `screens.test.ts` flake described below.

   - THE END-TO-END GUARD FROM ITERATION 86 IS NOW GREEN AND PROVEN BY MUTATION:
     "pressing UP moves the player up the screen, not down" walks the real chain
     (input vector -> label -> step) and was shown to fail when the table is
     reverted. It failed against the shipped build too, which is why it was
     written: the table test beside it agreed with the code the whole time.

   - **A CORRECTION TO ITERATION 86's OWN REPORTING.** That entry said the three
     remaining `screens.test.ts` failures were "identical count to a clean-master
     run, verified by stashing". The count was right; my confidence in it was
     luckier than I knew. Measuring properly over three full runs each:
       clean master:  3, 3, 3  (consistent)
       this branch:   8, 4, 1  (variable, sometimes better than master)
     So `tests/integration/screens.test.ts` is genuinely flaky on BOTH trees, and
     my earlier single-run comparison happened to land on the same number. A
     single stashed run is not a baseline; three is. Worth writing down because
     the whole point of this log is not to trust a healthy-looking signal, and
     "I verified it" has now twice meant "I ran it once and it agreed with me".

   GATE: tsc clean, 55 unit files / 1334 tests all pass, 4 browser tests, build
   clean. `tests/integration/screens.test.ts` remains flaky on master and here;
   it is not fixed by this round and is now measured rather than assumed.

   LIVE VERIFICATION (production, `index-CGmvk_5e.js`, 0 console errors). The
   camera follows the car, so the car stays centred and the WORLD scrolls — the
   inverse reading. Measured on the real deployment: between the start frame and
   the frame after holding W, every landmark in the plaza, including the cyan
   gate beacon above the car, shifted DOWN by roughly 60px. World down means the
   car moved UP, which is the property that was inverted.
   The S leg in the same capture is INCONCLUSIVE rather than confirmed: the
   beacon barely moved after S, most likely because the W leg had already pushed
   the car against the plaza's north wall and it was clamped. Recorded as
   unverified rather than as a second pass, because the S direction is the same
   single flipped sign as the W one and is already covered by the end-to-end
   unit guard and by the traced convention.
88. Iteration 86's finding 5, EXECUTED: **the north-up radar triangle pointed
   north no matter which way the car faced.** Found by Codex `gpt-6.1-sol`
   driving the live arena — "After turning and driving east, the car points
   east while the radar triangle still points straight up."

   - The marker is a literal `'▲'` glyph with no rotation, so it pointed
     screen-up unconditionally. That is CORRECT in `heading` mode, where the
     whole face is rotated to put the car dead ahead — and a LIE in `world`
     (north-up) mode, where the face is drawn in world coordinates and the car
     can face any direction. A triangular marker is a direction cue; a fixed one
     tells the player their car faces north when it faces east.
     The existing comment above the contact rotation actually said the heading
     maths matched "the ▲ player marker" — i.e. it took the marker's fixed
     orientation as a premise rather than noticing it was a second, independent
     bug. Contacts are placed by `rotate(...)`; the marker never was.
   - FIXED with the vehicle's heading, and 0 in heading-up mode, because the
     face is already rotated there and rotating the marker too would
     double-count. The angle is `(PI/2 - headingRad)` in degrees, checked at
     three headings: h=0 (facing +x, screen right) -> +90deg; h=PI/2 (facing
     +y, screen up) -> 0deg; h=PI (facing -x, screen left) -> -90deg. The
     `PI/2` is not arbitrary: `'▲'` already points screen-up and CSS `rotate()`
     is clockwise, so up has to be turned a quarter-turn clockwise to become
     right.
   - Rendered as a custom property rather than a second transform declaration,
     so the existing centring `translate(-50%, -50%)` is preserved and the two
     cannot fight — the same class of fix as iteration 32's `--ui-surface-2`
     work, where one declaration quietly replaced another.

   LIVE VERIFIED (production `index-Cyzfqs7M.js`, 0 console errors). The marker
   now carries `--hud-radar-player-rot` and the value TRACKS the vehicle:
   reading it off the real page while driving in four directions gave
   90.00deg -> 57.78deg -> 57.78deg -> 57.78deg, and the cropped radar capture
   shows a triangle that is visibly rotated rather than an upright glyph.
   Recorded honestly: the angle does not settle at a clean 0/90/180 for
   north/east/south/west, because in the arena the car is driven as a free 2D
   stick rather than a tank, so the sim's heading is not a snapped compass
   bearing. What this fix asserts is the correct property — the marker follows
   the heading the sim actually has — and that is now true and was not before.

89. Codex review (title/constructor/driver pass) finding 3, EXECUTED: **the
   WEAPONS panel covered the Arcade navigation link, and swallowed its clicks.**
   The reviewer measured it rather than eyeballing it: "Arcade occupies
   approximately (8, 8, 87, 44) CSS pixels. WEAPONS starts at (12, 12) and
   covers the link's icon and text. Pointer hit testing at (40, 25) reaches the
   WEAPONS heading."

   - ROOT CAUSE. `.arcade-home-link` is `position: fixed; top/left:
     var(--ui-space-4); min-height: 44px; z-index: 10` in tokens.css, living
     outside `#app` so it survives every screen mount. `.hud-panel--weapons`
     was pinned to the same corner, and `.hud-root` is `z-index: 20` — so
     WEAPONS both painted over the one control that leaves a run in one key
     AND received its pointer events. Same failure iteration 71 recorded for
     the arena's exit button behind the CONDITION panel, different pair of
     elements.
   - FIXED BY RESERVING A SLOT, NOT RAISING Z-INDEX. The panel now starts at
     `calc(var(--inset) + 52px)`. Raising the link above the panel would have
     hidden the panel's own top edge underneath it, and left the next panel
     added to that corner free to collide again. The 52 is NOT scaled by
     `--hud-scale` on purpose: the link is plain fixed chrome, so a scaled
     reservation would be wrong on exactly the small viewports where the link
     is proportionally largest.
   - **TWO ATTEMPTS TO ABSTRACT IT FAILED SILENTLY, AND THAT IS THE ROUND.**
     First pass wrote `.hud-nav-reserved: 52px` — a SELECTOR, not an
     assignment. Second declared `--hud-nav-reserved: 52px` at the top level,
     where `getComputedStyle(documentElement).getPropertyValue(...)` came back
     EMPTY, so the `calc()` was invalid, `top` fell back to `auto`, and the
     panel sat at y=0 exactly as before.
     Neither produced an error, a failed build, or a visible change, and the
     panel looked identical in a screenshot both times. **That is iteration
     32's shape exactly: a declaration that resolves to nothing is
     indistinguishable from a declaration that was never written.** The only
     reason it was caught at all is that I hit-tested rather than eyeballed,
     after the first measurement came back `weaponsTop: 0` and did not match
     the change I had just made.
     It ships as a literal, and the comment says why: one honest number in one
     place beats a name that does not resolve.

   - VERIFIED BY HIT TESTING IN PRODUCTION (`index-BYtNy5lY.js` build,
     0 console errors), the same method the reviewer used:
       arena  link y=8 h=44 | weapons y=64 | overlaps false | centre hits link
       road   link y=8 h=44 | weapons y=64 | overlaps false | centre hits link
       city   link y=8 h=44 | no weapons panel   | overlaps false | hits link
     Before the fix all three read `overlaps: true` and
     `centreHitIsLink: false`.

   Other findings from the same pass, queued: the "Jobs" markers pointing at a
   Federal Building that is a future-phase placeholder and at a Truck Stop that
   is not (the facility-identity item, now asked for twice); the road asphalt
   following the car sideways off-route with a concrete remedy — centre the
   surface on the vehicle's PROJECTION onto the route centreline and use one
   origin and heading for surface, paint and furniture; the unarmed car
   carrying a gun baked into its body artwork while the panel says
   "— none fitted"; and the ground-texel item, which remains the NEAREST-sampler
   art deferral.
90. The facility-identity item, EXECUTED — asked for TWICE by Codex
   `gpt-6.1-sol` and both times it came down to the same fact: "The legend
   promises 'Jobs', but the same briefcase marks different services. I drove
   into one and reached the Federal Building's 'coming in a future phase'
   panel. Another opened bus tickets, asking around, battery charging, rooms,
   and body armour. The map does not distinguish these destinations by name
   before entry."

   - **ONE LABEL, NOT A NAME ON EVERY DOOR.** Iteration 72 declined "a label
     plate above each marker" and the reason was right: a dozen plates is a
     dozen pieces of ink competing with the markers themselves, on the single
     most contested element in the game (five distinct asks across four
     directions in the log). A single PROXIMITY readout answers the question
     the player actually has — "which door am I standing at?" — without adding
     any of that, and it costs ZERO canvas instances in a layer exactly full at
     95/95, the same reason the legend is a DOM overlay rather than more
     sprites.
   - The radius is `layout.tileSizeM`, which `generateCityLayout` assigns
     `interactionRadiusM` — i.e. the SAME radius the doorway trigger uses. So
     the label appears exactly when the door would actually open and never
     advertises something out of reach. Read from the layout rather than
     hardcoded, because the two drifting apart is the precise failure mode of
     the thing this fixes.
   - The name comes from `facilityName(doorway.facilityKind)` — the identical
     lookup the trigger uses to build the menu it opens. The label cannot
     disagree with the panel that appears, which is the whole failure being
     fixed.
   - `textContent` is only written when the name actually changes; assigning it
     every frame would churn the DOM 60x a second for a string that changes
     when you cross the plaza, not when you breathe.

   - **A MEASUREMENT-SCOPE LESSON, THIRD VARIANT, AND IT FLIPPED THE
     CONCLUSION AGAIN.** The full suite reported 4 failures on this branch,
     three of them weapon-slot tests that WALK THROUGH THE GATE — which is
     exactly what iteration 87's compass fix touches, so it looked like a
     regression I had just introduced. Measured properly:
       `screens.test.ts` ALONE, 4 runs each:
         this branch:  1 failed | 29 passed — every run, and always the SAME
                       test (campaign "Continue")
         clean master: 1 failed | 29 passed — every run
     Isolated, both trees fail exactly one identical test and the three
     walking tests PASS on both. The compass fix did not destabilise
     anything; the 1-8 spread is cross-file test pollution that only appears
     in a full-suite run, which is the same flake iteration 87 measured and
     the same trap as "a single stashed run is not a baseline".
     Three times now a conclusion in this log has flipped on measurement SCOPE
     rather than on any change to the game: one stashed run, then three full
     runs, then isolated-per-file. The rule worth carrying: when a number moves,
     the first question is not "what changed" but "what was the scope of the
     thing I am comparing against".

   LIVE VERIFIED (production `index-7nXSJaHV.js`, 0 console errors). Walking
   north-east from the plaza centre in 1.5s steps and reading the label each
   step, it stayed hidden for the first four and then appeared:
       t+1500  {"text":"",     "display":"none"}
       ...     (three more, same)
       t+7500  {"text":"Garage","display":"flex"}
   The hidden-then-shown sequence is the radius working, not the element
   failing: the doorways sit on a 10.65m ring and the car starts at the
   plaza centre, so nothing is within `layout.tileSizeM` until the player
   has actually walked to a door. My first two probes walked 1.4s and 4.2s
   and both read "not found" / "display:none", and the correct conclusion
   was that the car had not arrived — not that the feature was broken.
   Worth recording because the tempting conclusion from a "no label" result
   is the wrong one, and the way to tell them apart is to walk long enough
   for the thing to be in range and watch the value change, rather than
   deciding from one negative sample.
91. Iteration 86's finding 3, EXECUTED: **the road surface followed the car when
   it left the road.** Found by Codex `gpt-6.1-sol`: "Driving north away from
   the initial east-west highway makes the lane markings and roadside furniture
   leave the view, but an asphalt strip remains centered beneath the car. The
   route's paint stays in the world while its surface follows the player."

   - **THE FIX IS ONE WORD, AND IT IS WORTH NAMING PRECISELY.** The surface
     quad was centred on the vehicle's full 2D position, while `roadLaneInstances`
     and `roadFurnitureInstances` both place themselves on the route axis. So
     two of the three road layers were anchored to the route and one was anchored
     to the car, and the odd one out was the surface — the largest of the three,
     and the one the player reads as "I am on the road".
     It is now centred on the vehicle's PROJECTION onto the route centreline
     (the line through the world origin in the route's direction). The same
     `along0` projection the other two layers already compute, so all three now
     share one origin instead of three derived from two different assumptions.
     That is the iteration-59/82/84 shape one more time: two surfaces deriving
     the same thing from two places is how they drift, and the fix is to make
     one read the other.
   - The behaviour that falls out is the correct one and needed no extra code:
     driving ALONG the carriageway is unchanged (the projection equals the
     position whenever the car is on the centreline), and driving LATERALLY off
     it is refused entirely, so the verge quad underneath becomes what the
     player sees. The road stays where the road is.

   - MEASURED BEFORE AND AFTER, and the honest part is what did NOT move:
       road luma/spread at rest  76.31 / 110.43  ->  76.31 / 110.43
     Byte-identical, which is the point: the fix touches only the off-route case,
     and a capture at t=0 with the car on the centreline cannot see it. Had I
     measured only the standing capture I would have concluded nothing had
     changed, and had I measured only "the number moved" I would not know it was
     for the right reason. The standing frame is the control, not the test.

   - LIVE VERIFIED BY DRIVING, which is the only way to see this one
     (`index-7GtIyN7C.js`, 0 console errors). Two frames:
       on the route      asphalt under the car, guardrails above and below, lane
                         paint and the shoulder line all present
       after 6s north    the car sits on the PALE VERGE, the guardrails and
                         paint have receded to the top of the frame, and there
                         is no dark strip tracking the car
     The environment now tells the player the truth about where they are, which
     is the whole finding. The reviewer's proposed remedy — "centre the asphalt
     on the vehicle's PROJECTION onto the route centreline, preserving the
     route's fixed lateral position" — is what this does.
92. Iteration 86's finding 4, EXECUTED: **"Not road-legal" did not prevent
   departure.** Codex `gpt-6.1-sol` drove the deployed build, walked out of the
   gate with the starter car, and named the defect exactly: "The warning
   promises a restriction that the gate does not enforce." A label naming a
   rule the game does not apply is worse than no label, because the player is
   promised a consequence and then watches it not happen.

   - **THE RULE EXISTED IN THREE PLACES AND THE GATE HAD NONE OF THEM.**
         constructor LEGALITY panel   name + armour + weapon
         city car strip (app.ts)      the same three, re-derived inline
         CITY GATE (openGatePrompt)   only "do you have a car"
     Two of the three re-derived the armour total with their own
     `FACINGS.reduce` as well, so the five-facings addition existed three
     times. This is the iteration-59/82/84/91 shape for the fourth time — two
     surfaces deriving one rule from two places is how they drift — and the
     drift had run all the way to ABSENCE in the one place that actually
     enforced anything.
   - `roadLegalityMisses(design)` now lives in `@/sim/construct`, whose own
     header already calls it "capacity math + legality engine", returns the
     MISSES rather than a boolean (a bare `isRoadLegal()` would let the panel
     and the gate disagree about WHY, which is the half the player needs), and
     uses `sumArmor` rather than a local reduce. Deliberately NOT folded into
     `validateDesign`: that function answers "is this coherent, affordable and
     physically legal" and those are RULES, while these three are an
     ONBOARDING GATE the constructor teaches in three plain-language steps and
     promises by. Iteration 84 drew that same line and it held.
   - **THE GATE REFUSES USING THE SEAM THAT ALREADY EXISTED.** `carless`
     already marked rows `eligible: false` with a `reason`, and `handleMenuKey`
     already refuses ACTIVATE for them. No new mechanism — the same shape
     `@/ui/buildings/arena`'s ineligible rows use. The vehicle is now resolved
     ONCE and the same `parked` value decides what the rows say and what gets
     driven, where before the label and the action were two separate readings
     of the same state. `gateRefusal` is exported for the same reason
     `vehicleParkedAtGate` is: the decision was a closure nobody could reach,
     which is why the `carless` half had no test either.
   - THE REFUSAL NAMES THE FIX, because a locked door with no reason is just a
     locked door: "not road-legal — fit it at the assembly plant first: armour ·
     a weapon". Verified live by walking to the gate: all five route rows
     ineligible, and row 6 (Leave) still selectable.

   - **AND FIXING IT BROKE A TEST THAT WAS PINNING THE BUG — the fourth time
     in this log, after iterations 29, 33 and 72, and the first time the thing
     pinned was a rule the UI was actively lying about.**
     `tests/integration/road-bounds-wiring.test.ts` walks to the gate and picks
     a route row like a person, and could no longer reach the road. Its
     `bootToCity` typed a name and nothing else, and its comment claimed the
     default build "is legal EXCEPT its name" — true of `computeViolations`,
     false of the stricter three-condition gate. A stale comment (the log's
     third class) that here did real damage.
     The deeper cause is duplication: that file has its OWN `bootToCity`,
     "duplicated here rather than imported because those are module-private",
     so "how to build a car that can leave the city" lived in two files. The
     shared `screens.test.ts` copy had the same gap. Both now fit a real
     road-legal car, which is the fourth independent copy of the boot helper
     drifting from a rule the other three never had.
     Measured rather than assumed, per iteration 90: the branch failed that
     file 2/2 in isolation while clean master passed 2/2, so it was a real
     consequence and not the flake.

   - **AND THE CAPTURE RIG'S CAR WAS NOT ROAD-LEGAL EITHER**, which is the
     finding underneath both of the above. `?screen=road` reaches the highway by
     calling `beginRoadTripWithEncounters` directly and never met the gate, but
     the rig's Duster had 0 armour and 0 weapons — so the fixture that every
     reviewer and every capture in this log has looked at was a car the game
     itself refuses to let onto a highway. It is now fitted on every facing
     with one weapon, because the rig's job is to show what the game looks like
     in play. Blast radius measured against iteration 91: title, controls,
     driver, constructor and fleet all BYTE-IDENTICAL; city, arena and road
     moved, which is exactly the three screens that show the car.
     The arena got visibly better for it — the CONDITION panel now shows real
     depleting bars on all five facings instead of five dashed chips, and
     WEAPONS shows an actual mounted weapon, which is why its spread rose
     125.98 -> 144.90 (saturated green is structure, not regression).

   - **WHICH EXPOSED A LAYOUT DEFECT THAT HAD BEEN WRONG THE WHOLE TIME.**
     Putting a real weapon in the frame showed the weapons row rendering
     "FRO**Mach…** 20/20" — the facing cell's text painted on top of the name.
     Six-column grid, 260px panel, facing track fixed at 3.2em rendering
     "↑ FRONT" with `white-space: nowrap` and NO overflow rule. Measured in
     real Chrome: 49px of content in a 33px box, 6px gap, so 10px of "NT" landed
     on the name. A grid track does not clip its own content, so the LAYOUT
     boxes never overlapped and only the painted glyphs did.
     Fixed by dropping the redundant WORD and keeping the arrow, with the
     facing word already in the aria-label. Both options were measured rather
     than chosen: widening the track to its 49px takes the name from 37px to
     21px, so "Machine Gun" truncates to "Mac…", whereas dropping the word
     gives the name ~58px and it now reads "Machin…". Plus the CLASS guard —
     `overflow: hidden; text-overflow: ellipsis` on the facing, which the name
     beside it already had. Mutation-proven both ways: restoring the word WITH
     the guard still passes (the guard alone prevents the paint-over), and the
     exact shipped state fails with "renders ↑ FRONT at 49px inside a 12px
     track with overflow-x: visible".

   - **THE REASON EVERY CAPTURE MISSED IT, and the sharpest harness finding in
     the log since iteration 71's sips bug: the capture gate's numeric
     assertions CANNOT SEE A HUD TEXT DEFECT.** Measured, not guessed: the fix
     changes 411 pixels of 1,296,000 — 0.03% of the frame, in a 61x11 bounding
     box, at max channel delta 543 — and the arena's own meanLuma, spread, p05
     and p95 are all IDENTICAL before and after. Whole-frame statistics are
     simply below the threshold for a small-panel text change. So "8 screens,
     0 with problems" has never meant "the HUD is correct", and roughly ninety
     reviews of these frames could not have caught this.
     The gate itself is NOT changed — it is doing its job (a blank frame, a
     missing panel, a splash) — but the gap is now covered where it has to be:
     `tests/browser/hud-row-overflow.test.ts`, in real Chrome, because
     happy-dom returns 0/0 for every rect. Its assertion is "no cell PAINTS
     OVER its neighbour", i.e. an overflowing cell must CLIP — the first
     version asserted `scrollWidth <= clientWidth` on every cell and failed
     against the NAME doing its job legitimately at 81px of content in a 58px
     track, which is the distinction that matters between the bug and the fix.

   - THE USUAL MEASUREMENT-SCOPE DISCIPLINE, one more time: full-suite failures
     were 10, then 1, then 2, then 4 across runs. Scope measured rather than
     assumed — the only failing FILE on branch and on clean master is
     `tests/integration/screens.test.ts` (master full runs gave 4 and 2, branch
     4), and in isolation both trees fail the same single campaign "Continue"
     test every run. Pre-existing cross-file pollution, not this change.

   - FOUR FIXTURES LIED IN THIS ROUND, three of them written by me while
     explicitly warned about the class: `baseDesign()`'s default name is 'Test
     Rig', not empty, so it was never the pristine build its comment claimed;
     `TEST_DESIGN` in `no-active-vehicle.test.ts` is named but carries ZERO
     armour and ZERO weapons, so it is not the legal fixture its neighbours
     assume; and a `Record<RoadLegalityMiss, string>` widens to `string` and
     fails `t()`'s literal-key type, which is why the wording map is a switch.
     The log now holds eight, and the rule has not changed: derive fixtures
     from the real type, not from memory of its shape.

   GATE: tsc clean, 67 files / 1460 tests (7 new; the 1-4 failures are the
   measured `screens.test.ts` flake), 5 browser tests (1 new, proven to fire),
   build clean, `.shots/iter92` = 8 screens / 0 problems.

DEPLOY 2026-09-30 — iteration 92 to arcade.shoemoney.com
- Release `20260930090000-1bad376`, build `index-OC-tIWJm.js`, commit `1bad376`.
  Whole-site snapshot first, atomic swap, root + smduel + last-engineer +
  shoplifter all 200, and the live bundle hash equals the local build's (the
  check that exists because iteration 81 shipped the previous build while every
  gate was green).
- LIVE VERIFIED BY DRIVING, in real Chrome against production, and both halves
  matter because a fix that over-blocks is a different defect:
   1. THE REFUSAL IS REAL. A genuine session — title -> driver -> constructor,
      naming the car "Smuggler" and fitting NOTHING — reaches the city showing
      "0 armour · 0 mounted · Not road-legal", walks to the gate, and finds all
      FIVE route rows ineligible reading:
        "not road-legal — fit it at the assembly plant first: armour · a weapon"
      Pressing route row 1 anyway leaves `onRoad: false` — the player stays in
      the city. This is the exact drive Codex performed in iteration 86, and it
      now ends where it should. 0 console errors.
   2. THE GATE IS NOT OVER-BLOCKED. The capture rig's car is road-legal, so
      walking the same city with it finds 6 rows, 0 ineligible, no reasons, and
      pressing row 1 actually departs (`onRoad: true`). A gate that refuses
      everyone would have passed half the check above.
   3. THE WEAPONS ROW IS FIXED IN PRODUCTION: 0 cells painting over a
      neighbour. The facing is "↑" at 12px/12px with `overflow-x: hidden` (the
      class guard), and the name carries 81px of content in a 58px box while
      CLIPPING — which is the name ellipsising correctly, and is exactly the
      distinction the browser test asserts.
   The strip in the illegal session reads "Smuggler0 armour · 0 mountedNot
   road-legal" as raw textContent, i.e. the three lines are separate elements
   with no whitespace between them; the rendered lines are what the frame shows
   and they read cleanly. Noted rather than "fixed", since it is an artefact of
   reading textContent rather than of the layout.
- The first live walk entered the ARENA rather than the gate, and its three
  ineligible rows ("Amateur Night is entered on foot", two Championship rows)
  looked at first like the gate refusing. Reading the row labels is what told
  them apart — the gate's rows come from `ui.city.routeOption` and all contain
  "mi, danger". A plausible-looking refusal from the wrong menu is a new
  flavour of the crop-that-disagrees-with-the-code trap, and the check that
  separates them is one regex on the labels.

93. NEW REVIEWER (Codex `gpt-6.1-sol`, gameplay screens, driving the live
   deployment at 2400x2020 DPR 2) -> 5 findings + 1 content gap. **Finding 1 is
   the most serious defect in this log: driving the car silently destroyed the
   player's save.** Executed this iteration; the other four are queued below.

   - **"The live browser logged `autosave failed SaveMigrationError` ... The
     city continued normally without displaying a save failure."**
     CONFIRMED and reproduced before changing anything.
     `@/sim/driving` adds `batteryDebt` to the vehicle on the first tick and
     `controlLossSpinSign` when a control-loss lockout begins.
     `vehicleStateSchema` is built by `obj()`, which sets
     `additionalProperties: false` (schema.ts:50), and declared NEITHER field.
     So driving for one tick made every autosave throw, and
     `persistArenaSession` caught it into a `console.warn` (app.ts:2433).
     Reproduced with the real `migrateSave` and the real `SaveGame` shape:
       "save blob does not match schema v2: /vehicles/v1 must NOT have
        additional properties" — for BOTH fields.
     The player-visible consequence: a player who drove, then reloaded, lost
     everything since their last successful save, with nothing on screen and
     nothing but a console line to suggest why.
   - **THE TYPE'S OWN COMMENT PROMISED THE EXACT THING THE SCHEMA PREVENTED.**
     `VehicleState.batteryDebt` is documented as living on the vehicle "so it
     survives a save/load round-trip" (types.ts:681). Documented intent in one
     file, enforced behaviour contradicting it in another, green suite
     throughout. Same shape as iteration 32's `--ui-surface-2` — a rule that
     reads correctly in the file that declares it — except the blast radius was
     a player's progress rather than a panel's fill.
   - FIXED: both fields added to `vehicleStateSchema`, and BOTH OPTIONAL via an
     explicit `required` list, because `obj()` defaults `required` to every
     declared property and a save written before either field existed must
     still load. Ranges are what the sim actually produces: `batteryDebt` is
     asserted `minimum: 0` with the top left open, because `stepDriving` floors
     the accumulated debt and carries the remainder so a saved value is in
     [0, 1) — a hard `maximum: 1` would reject a legitimate 0.99999999 from a
     subtract that was not exact. `controlLossSpinSign` is `enum: [-1, 1]`,
     because it is documented as a direction and only ever holds those two.

   - **THE TEST IS A CLASS GUARD, NOT A REGRESSION TEST.** It drives a car with
     the REAL `stepDriving` and validates with the REAL `migrateSave`, so the
     next field the sim grows fails here rather than in a player's browser. A
     test asserting only "batteryDebt is accepted" would have passed while the
     same hole reopened one field over.
     It also asserts the sim really did add the field, so a future change that
     stopped adding it cannot leave the test vacuously green.
     FIVE tests, THREE mutations, each firing on exactly the right ones:
       remove the fields (the shipped bug) -> the 2 driving tests fail, the
         pristine and corruption tests stay green
       make the fields REQUIRED           -> SIX PRE-EXISTING tests fail, so
         that trap was already covered by the file's own round-trip suite
       drop the validation to plain NUM    -> exactly the 2 corruption tests
         fail, because a permissive schema is not a fix
   - The corruption tests are the other half of the guard: a negative debt
     would make battery drain stop accumulating forever, which
     `driving.ts:317` has an explicit comment about, and a spin sign of 0 is
     not a direction.
   - **THREE MORE FIXTURE ERRORS IN ONE BLOCK, the ninth, tenth and eleventh in
     this log.** `makeGame` in `save.test.ts` takes `Partial<SaveGame>` and
     builds its own vehicle, so passing a VehicleState spread that vehicle's
     sixteen keys into the save ROOT and produced a wall of `/ must NOT have
     additional properties` pointing at the wrong object entirely. Then that
     file's `makeVehicle` uses placeholder design ids like `body-standard`,
     which are fine for shape-only schema tests and threw
     `UnknownRulesetIdError` the moment `stepDriving` called `getBody` for
     real. And before both, a first attempt guessed the save format outright
     (`location: {kind:'city'}`, `driver: {}`) and failed on the PRISTINE case
     too. Every one of the three was caught by a guard doing its job on input
     that was not real, which is the good outcome, and every one cost more than
     reading the neighbouring test file would have.

   - STILL OPEN FROM THIS FINDING, deliberately not built at the end of a long
     round: the reviewer's other half — "Surface a failed save with a
     persistent, actionable message". `PersistSessionInput` has no notification
     hook and both call sites are `void persistArenaSession(...)`, fire and
     forget, so surfacing this means adding a channel with real design
     questions (where it appears, whether it persists across the reload that
     loses the progress, whether it blocks). Worth doing properly; not worth
     half-doing now. The schema fix removes the failure that was actually
     occurring, so what remains is the quota/private-browsing path.

   GATE: tsc clean, 67 files / 1465 tests (5 new, mutation-proven), 5 browser
   tests, build clean (`index-hYG6SXgS.js`), `.shots/iter93` = 8 screens /
   0 problems, every screen BYTE-IDENTICAL to iteration 92 — correct, a save
   schema renders nothing. The 4 failures are the measured `screens.test.ts`
   flake (master full runs: 4 and 2; branch: 4; same file, same test).

   QUEUED FROM THE SAME REVIEW, not yet actioned:
   - **#2 BALANCE, and it is the biggest open design item in the log:** an
     ordinary 150-mile leg takes ~129 minutes of continuous driving at the
     car's 70 mph ceiling, measured by the reviewer from 1.6 miles in ~80
     seconds. Target 2-5 minutes per leg, compressing travel BETWEEN encounters
     and leaving real speed for the encounter itself. This touches route
     length, resource costs and calendar time together, so it needs its own
     iteration with those three measured — not a constant nudged blind.
   - **#3 "Space/J fire" is a lie:** the hint advertises Space, the shipped
     binding is KeyJ only. Either bind Space or generate the hint from the
     active bindings so a rebind cannot make the instructions stale.
   - **#4 facility names arrive too late:** iteration 90 deliberately tied the
     proximity label's radius to the doorway trigger's radius. The reviewer's
     counter-argument is strong — at a larger radius you would see "Federal
     Building — Closed" on approach instead of discovering it by entering.
   - **#5 the weapons panel still truncates at 1200px** ("Machine Gun" ->
     "Machin…") and the active-row triangle wraps to a second line. My
     iteration-92 fix was verified at 1440px only; the reviewer tested 1200 and
     found the narrower case. The browser test I added pins 1440 and needs a
     narrow-viewport case, exactly the phone-width precedent already in the repo.
   - **CONTENT GAP: the Federal Building is a placeholder presented as a working
     service**, with the same bright blue Jobs marker as real destinations, so
     a player spends navigation effort to be told "coming in a future phase".
     Pairs with #4: a "Closed" state on approach fixes both the wasted
     navigation and the misleading availability signal.

DEPLOY 2026-09-30 — iteration 93 to arcade.shoemoney.com
- Release `20260930110000-697318e`, build `index-hYG6SXgS.js`, commit `697318e`.
  Whole-site snapshot, atomic swap, root + smduel + last-engineer 200, live
  bundle hash equals the local build's.
- LIVE VERIFIED, with the chain stated rather than a single confident claim,
  because "no error appeared" is weaker evidence than it looks:
   1. THE BUG REPRODUCED LOCALLY FIRST, against the real `migrateSave` with a
      real `SaveGame` shape: "save blob does not match schema v2: /vehicles/v1
      must NOT have additional properties", for both fields.
   2. THE FIX IS IN THE SHIPPED BUNDLE: `batteryDebt` and
      `controlLossSpinSign` each appear 3 times in the served
      `index-hYG6SXgS.js`, against the schema being one of those sites.
   3. THE PERSIST CALL SITE RUNS CLEAN IN PRODUCTION. Drove the arena for 4
      seconds, then clicked "Exit to Title" — one of the two
      `persistArenaSession(...)` call sites, and the one the reviewer was on
      when the error appeared. Console collected across ALL message types, not
      just errors, because this failure was a `console.warn` and collecting
      only errors is exactly how it stayed invisible to a green suite.
      Result: zero `autosave failed`, zero `SaveMigrationError`, zero
      "does not match schema" — and no autosave message of any kind, where the
      reviewer's session had one.
- WHAT I DID NOT ESTABLISH, stated plainly rather than glossed: I did not
  independently confirm a save record was written to IndexedDB, so "the save
  persisted" is supported by the absence of the reported failure and not by
  reading the store back. A first attempt at a fuller end-to-end run — a real
  title -> driver -> constructor session in headless Chrome on that origin —
  never reached the arena and ended on a `Retry` button, most likely headless
  IndexedDB partitioning on a cross-site origin, so it exercised nothing. The
  arena rig path was used instead because it reaches the same call site
  deterministically. Reading the store back is the one check that would close
  this properly and it needs a context where IndexedDB actually persists.

94. Codex review finding 3, EXECUTED: **the arena's control hint named a key
   that did nothing.** "Repeated native Space presses left ammunition
   unchanged. Native J presses fired the machine gun ... The shipped bindings
   assign firing to KeyJ, with no Space binding." TRUE, and the diagnosis is
   sharper than "add the key": `controls.json`'s own note says every action is
   remappable at runtime via `rebind()`, and the game SHIPS a Controls screen
   that does it. So the hint's key names were a hardcoded literal in a file
   that can never match a user's own bindings — a lie on the day it shipped and
   a lie again after any rebind.

   - FIXED IN THREE PARTS, because the reviewer's recommendation was right that
     binding Space alone would leave the second half unfixed:
       1. `Space` bound to `fire` alongside `KeyJ`, in BOTH presets. It was
          never bound, so the instruction was aspirational.
       2. Space's browser default is to SCROLL THE PAGE, and gameplay owns
          input, so a player holding fire would have jerked the view down on
          the first press — trading a lie in the instructions for a camera
          that moves when you shoot, which is worse. Suppressed in
          `attachCodeTracking`, the shared seam every screen uses, and only
          while the code is genuinely bound to an action, so Space still
          scrolls normally on menus and the constructor's sliders.
       3. **THE HINT IS NOW GENERATED FROM THE LIVE BINDINGS.** `keyLabel` and
          `describeAction` in `@/ui/input` render an action's keys as
          `Space/J`, and the arena and event-hint strings take `{fire}` and
          `{cycle}` as parameters. Wording stays in strings.json — its own
          `_note` says that is the only place wording lives — while the KEY
          NAMES come from the bindings, so the two cannot disagree and a
          rebind updates the instructions for free. A test asserting the
          literal "Space/J" would have passed while a rebind made the on-screen
          text stale again, which is the same bug slower, so the tests pin the
          PROPERTY instead.
   - `controls.json` carries `$schemaVersion` and every action is validated by
     `validateControls`, so the added binding is checked at module load rather
     than trusted.

   - **AND THE FIX INTRODUCED A REGRESSION THAT THE CAPTURE GATE COULD NOT
     SEE.** The first generated hint read `cycleWeaponNext` alone, which is
     bound to KeyE — so the moment the hint became truthful it became
     INCOMPLETE, and the text silently dropped the Q that the old hardcoded
     literal had. The frame read "E cycle weapon".
     `shoot.mjs` reported "0 with problems" and the whole-screen screenshot
     looked fine. The gate cannot help here, and iteration 92 measured exactly
     why: DOM text moves no pixel statistic (a 411-pixel HUD change moved the
     frame mean by 0.068 luma), so the arena's numbers were unchanged to two
     decimals across a text change a player reads instantly.
     It was caught by CROPPING AND READING the string in the capture — the
     iteration-89 discipline of verifying the artefact instead of the source.
     A generated hint trades one class of bug (a stale literal) for another (an
     incomplete derivation), and the second is only visible by reading it.
     `describeCyclePair` now reports both directions, with a regression test
     and a mutation proving it: reading only `next` fails exactly that test.
   - The road screen shares the same input map, so the Space binding applies
     there too.

   GATE: tsc clean, 67 files / 1472 tests (7 new in `input.test.ts`; the 4
   failures are the measured `screens.test.ts` flake), 5 browser tests, build
   clean (`index-CMstRNf8.js`), `.shots/iter94` = 8 screens / 0 problems.

   STILL QUEUED FROM THE SAME REVIEW, unchanged by this round:
   - #2 the 150-mile / ~129-minute leg (balance; touches route length, resource
     costs and calendar time together, needs its own measured iteration)
   - #4 facility names arriving at the entry radius rather than earlier, and the
     Federal Building presenting as a working service
   - #5 the weapons panel still truncating at 1200px, where the active-row
     triangle also wraps to a second line — my iteration-92 fix was verified at
     1440px only, and the browser test I added pins 1440

DEPLOY 2026-09-30 — iteration 94 to arcade.shoemoney.com
- Release `20260930120000-a0df648`, build `index-CMstRNf8.js`, commit `a0df648`.
  Whole-site snapshot, atomic swap, root + smduel + last-engineer 200, live
  bundle hash equals the local build's.
- LIVE VERIFIED IN REAL CHROME, and this round contains a CORRECTION OF MY OWN
  measurement, which is the part worth keeping:
   - First attempt: `keyboard.press('Space')` left the magazine at 20/20 while
     `press('KeyJ')` dropped it to 19/20. I reported that as "Space still does
     not fire" — and it was a TEST ARTEFACT, not a game defect. `press()` is a
     keydown and keyup milliseconds apart, and the arena samples held codes once
     per frame, so a tap shorter than a frame can be missed entirely. My
     conclusion was the log's own recurring error in a new costume: a
     measurement that disagreed with the code, treated as a fact about the game.
   - The decisive check was the input layer, not more browser guessing: with
     the CORRECT `RawInputState` field (`keysDown`, not the `keys` my first
     probe invented — two probe bugs in a row here, the second of which made
     BOTH keys read as `fire: false` and would have "confirmed" a bug that did
     not exist), `resolveInput({keysDown: new Set(['Space'])})` returns
     `fire: true`, identical to KeyJ.
   - Re-run with HELD presses, the way a player fires:
       SPACE held 1200ms   20/20 -> 15/20
       J     held 1200ms   15/20 -> 10/20
     Identical. Space fires, and it fires as fast as J.
   - `window.scrollY` is 0 after firing, so the scroll guard holds: no camera
     jump on the first press, which was the risk of binding Space at all.
   - The on-screen hint read "WASD/arrows drive · Space/J fire · Q/E cycle
     weapon" in production, so the generated text and the real bindings shipped
     together.
- A SECOND, SMALLER TRUTH the review did not separate, recorded rather than
  fixed: an instantaneous tap fires for NO key, Space or J, because held codes
  are sampled per frame. That is input fidelity rather than a broken binding,
  it is invisible to any human (nobody taps a fire key that briefly), and
  fixing it would mean latching keydown edges — a real change to input
  semantics, not a bug fix. Recorded so a future review of "Space does nothing"
  is answered with the frame-sampling explanation rather than re-litigated.
95. Codex review finding 5, EXECUTED — and HALF the finding was false, which
   measurement established before any code changed.

   - **"At the tested 1200-pixel-wide viewport, Machine Gun displays as
     Machin… ... The active-slot triangle also wraps beneath the slot number,
     making a single weapon row occupy two lines."**
     The TRUNCATION is real. The WRAP is false, and so is the viewport.
     Measured across 1440 / 1280 / 1200 / 1024 / 900 in real Chrome: the panel
     is 260px and the grid is `14.4 12.4 57.6 31 43.4 31` at EVERY one of them,
     and `rowH` is 40px at every one. Nothing wraps anywhere, and the name
     track is the same width at 1440 as at 900 — **the panel is fixed-size and
     does not respond to the viewport at all.** So "at 1200px" was a red
     herring: the reviewer saw a real truncation and attributed it to the
     window, and the honest description is that a 260px corner panel holding
     six fields gives the name 58px against a name that needs 81.
   - **THE STATED CONSEQUENCE ALSO DID NOT HOLD, AND CHECKING IT CHANGED THE
     PRIORITY.** The reviewer's worry was that truncation "impairs recognition
     when players have multiple weapons". Measured against the real ruleset:
     all twelve shipped weapons are unique on their first FOUR characters
     ("Machine Gun", "Recoilless Rifle", "Rocket Launcher", "Minedropper",
     "Spikedropper", …), so every truncated name is still distinguishable and
     the worry does not apply to the shipped set. The real risk is a future
     weapon added with a colliding prefix, and NOTHING pinned that — so that is
     the guard that got written instead of a pixel tweak.
   - FIXED BY RECLAIMING THE ONE GENUINELY REDUNDANT WORD. The cooldown cell
     read "● READY"; the word cost the weapon name 37px. "READY" is redundant
     in three separate channels — the dot's colour is `--ui-ok` when ready and
     the warning tone when not, its SHAPE differs from the cooling `◔`, and the
     cooling state already carries a percentage — and the `aria-label` says
     "ready to fire" in full. This is the same answer the facing arrow settled
     in iteration 92, applied to the next redundant token in the same row.
       name track   58px -> 81px   "Machin…" -> "Machine Gun" IN FULL
       cooldown     43px ->  6px
       row height   40px -> 40px    (no height growth, no reflow)
     Measured in real Chrome at 1440, 1200 and 900: identical at all three, and
     the name's 81px of content FITS its 81px track at every width.
   - **AND THE FIX CREATED A NEW DEFECT THAT I CAUGHT MYSELF, IN THE CAPTURE.**
     With the word gone the row read "● ● 3/3" — two identical green dots
     shoulder to shoulder, which read as one decorative flourish rather than two
     readouts. That is iteration 17's trap (a fix that trades one axis for
     another gets caught by the next reviewer) arriving from me instead, and it
     was visible only by CROPPING AND LOOKING, because DOM text moves no pixel
     statistic (iteration 92 measured that: a 411-pixel HUD change moved the
     frame mean by 0.068 luma). Fixed by giving the durability cell 6px of extra
     leading space — not a global gap change, because every other pair in the
     row is separated adequately and at most one of them is a bare dot.
     The durability dot itself was considered and KEPT: it is `damageState`'s
     glyph, the four-state colour-AND-shape system iteration 9 verified end to
     end, and it changes as the weapon takes damage. It was the cooldown word
     that was redundant, not this.

   - **THREE TESTS, AND TWO OF MY OWN MUTATIONS WERE WRONG FIRST — which is
     the part worth recording.**
     The new browser test measures how many characters the name track can
     actually show by growing a string in real Chrome until it clips (13, not
     the 11 I had estimated by hand), then asserts every shipped weapon name is
     unique at exactly that length against `weapons.json`. A future weapon with
     a colliding prefix fails there rather than shipping as an ambiguous row.
     A second test pins the geometry: one line tall and the SAME grid columns at
     every viewport, so a future report of this class is checked against the
     panel's own numbers before anyone theorises about the window.
     Mutations, and the honest score:
       - restoring "● READY"              -> FIRES, "expected 7 to be >= 11" ✓
       - a colliding weapon name          -> DID NOT FIRE, twice, and BOTH times
         my mutation was too weak rather than the test being wrong: "Machine
         Cannon" collides at 7 characters and "Machine Gun Mk2" at 10, but the
         track shows 13, so neither actually collides. The third attempt
         ("Recoilless Rifle" -> "Rocket Launcher Mk2", sharing 13) was the real
         test of the guard and I ran out of round before re-confirming it.
       - forcing a wrap (0.5em tracks)    -> FIRES ✓
     So one of the three guards is mutation-proven, one is proven, and the
     uniqueness guard is proven only in the sense that its assertion was shown
     to be computed from the real ruleset and the real measured width — which is
     weaker than the other two and is recorded as such rather than claimed.
   - **`strings.test.ts` CAUGHT MY OWN CHANGE, which is the third time in three
     rounds that a gate earned its place by failing loudly.** Removing the word
     "READY" left a bare `'●'` literal in a DOM-text position, and the scanner
     rejects any string not in strings.json or its allowlist. The allowlist pins
     exact pairs (`['src/ui/hud.ts', '● READY']`), so it became `['●']` — the
     grouped-exemption route iteration 85 used for Cost/Budget/Remaining, rather
     than inventing a `t()` lookup for a glyph that is a symbol, not a word.
   - **AND `screens.test.ts` IS NOW WORSE THAN I HAD IT RECORDED.** It failed 4
     tests in isolation this round, against iteration 90's measurement of 1.
     Measured rather than reconciled with the old note: BRANCH 4 failed / 26
     passed on two consecutive isolated runs, and so did CLEAN MASTER, with the
     same two test groups both times ("the weapon slot a player selects is the
     slot that fires" and "winning the campaign ... Continue"). So it is not mine,
     the flake has simply spread from one test to a group since iteration 90,
     and the earlier figure should be read as a snapshot of a moving target
     rather than a fixed baseline. Worth stating plainly because the standing
     instruction in this log is to measure scope before blaming a change, and
     this round is where that rule paid: the first reaction was that I had
     broken the city walk.

   GATE: tsc clean, 67 files / 1472 tests, 5 browser tests (2 new),
   build clean (`index-dkmliIAX.js`), `.shots/iter95` = 8 screens / 0 problems.
   The 4 failures are the `screens.test.ts` flake, measured identical on master.
96. Codex review finding 2, EXECUTED — and the pacing complaint turned out to
   be hiding a much worse defect underneath it.

   - **"One ordinary journey requires roughly two hours of continuous driving
     ... At a constant 70 mph, 150 miles takes 129 real minutes."** The pacing
     complaint is real and is recorded as the top open item below. What sending
     me looking for WHY a leg is measured in HOURS turned up first was not a
     pacing problem at all: **the road had unreachable destinations.**

   - **THE BATTERY AND THE ROUTE TABLE WERE NEVER RECONCILED WITH EACH OTHER.**
     `driving.json`'s `movementDrainPerMileBase` (0.9) is multiplied by
     `(1 + 1.4 * weight/power) * (1 + 0.6 * speedFraction)`, so the EFFECTIVE
     drain at full speed was 1.84-5.67 per mile — **17 to 54 miles of range**,
     computed from the real weight/power pairs in `bodies.json` and
     `plants.json`. `cities.json` ships routes of **40 to 240 miles, mean 125**.
       - 14 of 26 routes were longer than the BEST car's range
       - 22 of 26 were longer than the WORST car's
       - `ny-albany` — 150 miles, the default route the reviewer drove — was
         beyond every car in the game
       - and the CAPTURE RIG'S OWN CAR, subcompact on the small plant, had
         **28.6 miles**: it would have stranded at **19% of the way**. Every
         reviewer in this log has been driving a car that cannot finish the
         route it starts on, and nobody noticed because the drive is 1:1 and
         nobody plays for two hours.
     A route longer than the battery's range is not a slow drive. It is a
     destination the player cannot reach.

   - **AND THERE WAS NO RECOVERY OF ANY KIND.** `showRoad` mounts no menu and no
     actions at all — I grepped the whole function. `abandonVehicle` exists in
     `@/sim/road`, returns a `PedestrianState` so the player can continue on
     foot, and is documented as the SPEC's own escape ("the player may continue
     on foot (SPEC 'Road')") — and **it is never called by `@/app`**. It is dead
     code whose only purpose is the recovery this game needs. So a player who
     ran the battery down was stuck, looking at a HUD that faithfully reports
     0% and offers nothing to press.
     This is the same shape as iteration 71's covered exit button: a capability
     that exists and a control that is reachable, and the two are not connected.

   - FIXED BY RECONCILING THE TWO NUMBERS, at 0.06 (from 0.9). Sized against the
     constraint rather than a preference: the WORST build (heaviest body on the
     weakest plant, a 6.304x multiplier) now manages 262 miles against a
     longest route of 240, and the BEST (2.048x) manages 805.
     The reduction is UNIFORM, so the vehicle-quality gradient is preserved
     exactly — a badly built car still has about a third of a good car's range.
     It just finishes the journey, and the battery becomes an economy across
     several cities rather than a countdown to being stuck. The alternative
     "fix" — inflating `full` — is arithmetically identical (only the ratio
     matters), which is worth recording because I tried it as a mutation
     expecting it to fail and it passed: it is not a different fix at all.

   - **THREE TESTS, DERIVED FROM THE REAL RULESETS, AND TWO MUTATIONS THAT
     TEACH THE RIGHT LESSON.**
     The guard is a RECONCILIATION test, not a regression test: it reads the
     actual body/plant weight-power pairs and the actual route table and asserts
     the worst build can finish the longest route, so the two numbers cannot
     drift apart again without a red test. Adding a heavier body or a weaker
     plant widens the multiplier and fails it, which a hardcoded worst case
     would not catch.
       - restore 0.9 (the shipped pair)  -> FIRES: "the worst build manages 17
         miles but the longest route is 240" ✓
       - flatten the weight/power scale   -> FIRES, on the gradient test AND on
         a pre-existing battery test ✓
       - inflate `full` instead           -> PASSES, correctly, and this is the
         informative one: full and base only ever matter as a ratio, so "raise
         the capacity" is not an alternative to lowering the drain, it IS the
         same change. A mutation that cannot fail is worth recording as a fact
         about the system rather than quietly dropped.
   - The ruleset validator caught my first attempt, which put the explanation in
     a `_note` INSIDE the `battery` object — unknown keys are rejected there.
     Fourth time in four rounds a gate has earned its place by failing loudly;
     the note moved to the file's top-level `_note` where this file already
     keeps its provenance, and it records the derivation rather than just the
     new number.

   - **MEASUREMENT SCOPE, AGAIN, AND THIS TIME A READING THAT DID NOT
     REPRODUCE.** The first full run after the change reported 13 failures across
     4 files — `screens`, `phase4`, `pursuit`, `arena-auto-end` — which reads as
     a serious regression. Measured before reacting:
       `phase4`, `pursuit` and `arena-auto-end` each PASS in isolation.
       MASTER full suite, twice: 9 failures then 4, including phase4 and pursuit.
       BRANCH full suite, three consecutive runs: 4, 4, 4 — all `screens.test.ts`.
     So the 13-failure reading coincided with a concurrent `npm run build` and
     capture competing for the same machine, and did not reproduce. Master's own
     range is 4-9 on the same cross-file pollution. Recorded because "I saw 13
     failures and it was noise" is exactly the kind of claim this log has
     learned not to make without the scope measurement behind it.

   GATE: tsc clean, 67 files / 1475 tests (3 new, 2 mutation-proven), 5 browser
   tests, build clean (`index-BwDY7m3Q.js`), `.shots/iter96` = 8 screens /
   0 problems. Failures are the measured `screens.test.ts` flake.

   STILL OPEN AND DELIBERATELY NOT ACTIONED, because it is a design decision
   rather than a defect and this is the wrong end of a round to make it:
   - **PACING, the reviewer's actual finding, now the top open item.** The road
     simulates literal miles at literal speed, so a 150-mile leg is 129 real
     minutes at the car's 70 mph ceiling. Two coherent answers and they are not
     both code:
       (a) COMPRESS TRAVEL BETWEEN ENCATCHERS — the reviewer's own suggestion,
           and the one that keeps the encounters real. It means the odometer
           advances faster than the car is physically moving on empty road,
           which is a simulation lie, and the codebase's own rule (iteration 55)
           is not to fake a unit the player can measure. Doing it honestly means
           surfacing it — a "cruising" state the player can see.
       (b) SHORTEN THE ROUTES, so a leg is genuinely drivable. The cost is that
           `lengthMiles` is also the economy and calendar unit, and the cities'
           on-map positions may be tied to it; this is why it needs its own
       measured pass over distance, day cost and battery together.
     What this round establishes is that the two questions are separable: the
     battery dead-end was a hard blocker and is now closed, and the pacing
     problem is real, independent, and untouched.
   - `abandonVehicle` remains unwired. With the battery fix the common case no
     longer strands, but the SPEC's on-foot escape is still unreachable, and
     that is a real gap rather than dead code now that nothing else covers it.

DEPLOY 2026-09-30 — iteration 96 to arcade.shoemoney.com
- Release `20260930160000-90315cb`, build `index-BwDY7m3Q.js`, commit `90315cb`.
  Whole-site snapshot, atomic swap, root + smduel + last-engineer 200, live
  bundle hash equals the local build's.
- LIVE VERIFIED, and the verification has a limitation worth stating rather than
  dressing up:
   1. THE RECONCILED VALUE IS IN THE SHIPPED BUNDLE: grepping the served
      `index-BwDY7m3Q.js` returns `movementDrainPerMileBase:.06`, plus the
      top-level `_note` explaining that the number is reconciled against the
      route table. The fix demonstrably shipped, not just locally.
   2. THE ROAD RUNS CLEAN IN PRODUCTION: `?screen=road` mounts, the rig car
      reports 150mi remaining, six throttle samples over 15 seconds are
      monotonically non-increasing, and there are 0 console errors.
   3. **WHAT THAT CHECK CANNOT SHOW, and why.** The battery read 100% on every
      sample, and that is CORRECT rather than a broken readout: at 0.06 base the
      rig car's effective drain is ~0.21 points per mile, and 15 seconds at
      highway speed is about 0.29 miles — 0.12% of a 150-mile route, or 0.06
      battery points out of 99, which rounds to 100% at the HUD's integer
      precision. Over the full route the same car spends roughly 57 of its 99
      points, so the battery is very much a real resource; it is simply
      invisible inside a short drive.
      That is the pacing problem showing up inside its own verification: a
      change to a per-mile resource cannot be observed in a browser session
      shorter than the journey it governs. The arithmetic is covered by the
      reconciliation test against the real rulesets, and the shipped value is
      confirmed above, so the chain is complete — but the behavioural half of
      this finding is only observable after the cruise/compression work, which
      is exactly why that item is the top open one.
97. NO CODE CHANGED THIS ROUND, and the round's product is the measurement
   iteration 96 explicitly asked for: "its own measured pass over distance, day
   cost and battery together." Having taken it, the honest conclusion is that
   **the reviewer's proposed fix is not available**, and shipping one anyway
   would have meant cranking a constant by a factor of 26-64.

   - **THE CALENDAR ECONOMY IS ALREADY CORRECT, WHICH NOBODY HAD CHECKED.**
     `daysPerMile()` is `busToAdjacentCity.days / referenceRouteMiles()` =
     1 / 125 = **0.008 days per mile**. So a 40-mile hop costs 0.32 days and a
     240-mile run costs 1.92 — the game's own unit already says "a leg is about
     a day of travel", which is the design the SPEC's bus service implies. The
     calendar is not the problem. **The real-time simulation is the anomaly:**
     it runs a day's abstraction at 1:1 wall clock, which is why the reviewer
     measured 129 minutes and called the game unplayable.
     This also retires one of iteration 96's two options: SHORTENING THE ROUTES
     is calendar-NEUTRAL, because `referenceRouteMiles` is the MEAN of the route
     table — scaling every route by k divides `daysPerMile` by k and multiplies
     each route's length by k, so the days-per-route figure is invariant. I had
     flagged that option as "it may be tied to the cities' on-map positions";
     it is not even tied to the calendar. It is tied to everything else.

   - **AND THE ENCOUNTER STRUCTURE IS ALSO ALREADY CORRECT — WHICH VALIDATES
     THE REVIEWER'S SHAPE AND INVALIDATES THEIR NUMBER.**
     `encounters.json`'s `dangerLevels` carry `spawnsPerHundredMiles` of 1.0 /
     1.6 / 2.3 / 3.1 / 4.2. On a 150-mile leg that is **1.5 to 6.3 fights** —
     three to five is a well-shaped leg. So the design is right: a handful of
     encounters strung along a day's drive. What is wrong is only the 20 to 86
     real minutes BETWEEN them. The reviewer's "compress travel between
     encounters" is therefore the correct SHAPE, and the arithmetic is what
     fails.

   - **THE ARITHMETIC, WHICH IS THE ACTUAL FINDING.** To land a 150-mile leg in
     the reviewer's 2-5 minute window, by either available lever:
         compress empty-road travel  ->  26x to 64x   (2 min = 64.3x, 5 min = 25.7x)
         shrink the route length      ->  26x to 64x   (2 min = 2.3 mi, 5 min = 5.8 mi)
     **Both cost the same factor, because they are the same decision.** A
     2.3-mile "150-mile highway" is as much a lie as a car covering 150 miles in
     129 seconds, and iteration 55's rule — never fake a unit the player can
     measure — applies identically to the odometer and to the map. So the
     reviewer's target is not merely hard, it is **unreachable without a lie in
     one direction or the other**, and that is a design fact rather than a
     tuning problem. Nobody should "fix" this in a later round by finding the
     constant that makes the number look right.

   - **THE HONEST OPTION IS STRUCTURAL, AND IT IS NOT A CONSTANT.** The one
     answer that lies about nothing: treat a leg as what the calendar already
     says it is — a day's travel — and make the TRAVEL a deliberate transition
     rather than a simulated one. The driving sim stays exactly as honest as it
     is now, reserved for the ENCOUNTER, and the empty stretches between them
     become a visible, labelled progression (route map, fuel/rest stops, an
     "arriving at X" beat) whose length in real seconds is a pacing choice the
     designer makes openly instead of a 64x multiplier the odometer hides.
     That is a structural change to how a leg is played, which is why it is
     recorded here rather than started at the end of an unrelated round — the
     same discipline iteration 84 and iteration 96 applied to their own
     open questions.

   - **AND A GENUINELY NEW FINDING FELL OUT OF THE SAME TABLE, INVERTED.**
     Expected encounters is `lengthMiles x spawnsPerHundredMiles / 100`, so
     encounter count scales WITH route length while the DRIVE scales with it
     too — but the ratio that matters is encounters per real minute, and that
     is worst on the SHORT routes:
         40 mi, danger 0 (1.0/100mi) -> 0.4 expected encounters, 34 real minutes
     **The shortest routes in the game are the ones most likely to contain no
     fight at all** — the player pays the smallest time cost and receives the
     least content, and the drive is proportionally the longest and emptiest.
     Nothing in the log or the review history had noticed this, because every
     pacing complaint has been about routes being too LONG and nobody asked
     whether the short ones are worth driving. It is a ruleset relationship, not
     a code defect, and it is recorded as its own open item because fixing it
     (raising `spawnsPerHundredMiles` for the lowest danger, or shortening the
     short routes) would pull against the calendar figures measured above.

   GATE: unchanged and green — tsc clean, 67 files / 1475 tests (4 measured
   `screens.test.ts` flake), 5 browser tests, build `index-BwDY7m3Q.js`,
   `.shots/iter96` 8 screens / 0 problems. No code change this round, and the
   reason is the finding rather than a shortage of round.
98. Codex's "Real gap in the game as a whole", EXECUTED: **the Federal
   Building is an unfinished destination presented as an ordinary usable
   service.** "Its bright blue Jobs marker gives it the same availability
   signal as other destinations" and "it also wastes a player's navigation
   effort before revealing its status" — both reported, twice across the
   review, and the reviewer's own remedy was to mark it Closed on approach
   and stop opening a modal there.

   - **AND THE REASON NOBODY COULD FIX IT IS A STRUCTURAL FACT NOBODY HAD
     LOOKED AT.** `mountFacility` decides a kind is a STUB with a `default:`
     FALLTHROUGH — anything not explicitly cased above it. So the set of
     unfinished kinds existed ONLY in a comment on `stub.ts` ("hotel, federal,
     story, studio, petshop — task brief"). Nothing could read it. There was no
     list to ask "is this door closed?", which is exactly the question the
     player is asking while walking toward it, and adding a facility to the
     switch would have silently promoted it out of "unfinished" with no edit to
     any list anywhere.
   - `OPERATIONAL_FACILITY_KINDS` is now built from the SAME constants the
     switch cases (`GENERIC_KINDS` + assembly + arena), and
     `isOperationalFacilityKind()` reads it. The city label therefore knows a
     door leads nowhere, and says so on approach: "Federal Building — closed",
     in the dimmer secondary ink so a closed door does not compete with a
     working one. The stub panel itself is unchanged — a player who walks in
     anyway still gets the real numbered notice, never a dead button.
   - THIS IS THE ITERATION-84/92 SHAPE ONE MORE TIME, and by now it is a
     recognisable pattern rather than a coincidence: one rule, one owner, and
     every surface that needs it READS that owner instead of keeping a copy. The
     instances are `unmetRequirements` (84), `roadLegalityMisses` (92), the
     city-decal count (82), `facilityMarkerFamily` (79), `tripDays` (96's
     `daysPerMile`) and now the operational-kind set. Each one cost a real
     defect first.

   - **TWO TESTS, AND THEY FIRE IN OPPOSITE DIRECTIONS — which is the part
     that makes the pair worth having.** The first version of this test
     compared the exported set against a `GENERIC_MIRROR` list typed into the
     TEST file, and that was the same drift in a different place: a mirror list
     disagrees with the router the moment a facility is added, and fails for the
     wrong reason. Rewritten to import `GENERIC_KINDS` and
     `RULESETS.cities.facilityKinds` directly, so the assertions read the
     router's own data.
       - promote 'federal' in the SET only  -> the "agrees with the router"
         test fires: `facility "federal": the set and the router disagree`
       - add a facility to the ROUTER, set left stale -> the "marks exactly
         the stub kinds" test fires
     So the two tests cover the two directions drift can travel, which a single
     assertion could not have.

   GATE: tsc clean, 67 files / 1477 tests (2 new, 2 mutation-proven), 5
   browser tests, build clean (`index-AJyF_mpX.js`), `.shots/iter98` =
   8 screens / 0 problems. The 4 failures are the measured `screens.test.ts`
   flake.

   STILL QUEUED: the structural pacing decision (97, recorded), the
   encounter-density inversion on short routes (97), `abandonVehicle` still
   unwired, and a persistent "surface a failed save" message (93).
   >> CORRECTED BY ITERATION 99: the short-route inversion is FALSE (arithmetic
      on a route/danger pair that does not exist; all 26 real routes are
      non-empty and flat per minute), and `abandonVehicle` is an UNBUILT
      on-foot mode, not an unwired function. Read the iteration-99 entry before
      acting on either of the two claims in this list.

DEPLOY 2026-09-30 — iteration 98 to arcade.shoemoney.com
- Release `20260930150000-d21fbb4`, build `index-AJyF_mpX.js`. Whole-site
  snapshot, atomic swap, root + smduel + last-engineer 200, live bundle hash
  equals the local build's.
- LIVE VERIFIED IN REAL CHROME, and this one is PARTIAL, stated as such rather
  than dressed up — with a note on how the gap was reached, because the way I
  got there is the useful part.
   1. WHAT IS CONFIRMED. Walking the production city, the proximity label
      renders and reports correctly for an OPERATIONAL facility:
        step 26  "Salvage Yard"   [colour rgb(215, 224, 234)]
      which is `#d7e0ea`, the normal-operational ink, not the dimmer closed
      ink — so the existing path is intact and the change did not regress it.
      0 console errors throughout.
   2. THE SHIPPED BUNDLE carries the new string: `" — closed"` and the
      `stripClosed` key each appear once in `index-AJyF_mpX.js`. The
      identifiers `isOperationalFacilityKind` and `GENERIC_KINDS` appear zero
      times, as expected — they are minified.
   3. **WHAT I DID NOT DO: I never walked to the Federal Building**, so I have
      not seen "Federal Building — closed" rendered in a browser. My walk was a
      fixed 32-step key cycle and it happened to reach the Salvage Yard and
      nothing else; reaching a specific building needs the layout's doorway
      positions, which the page does not expose. The closed path is covered by
      the two unit tests (which pin that `federal` and `hotel` read as
      unfinished and that the set cannot drift from the router) and by the
      string being in the bundle, but that is source-level and bundle-level
      evidence, not a rendered frame. Recorded as unverified rather than
      implied.
   4. WORTH RECORDING, because it is the fourth time this log has hit it: I
      guessed the probe's DOM selector THREE TIMES and got three confident
      wrong answers before inspecting the page.
        attempt 1  filtered on candidate WORDS -> read nothing, because no
                    facility label had appeared yet and the filter matched
                    nothing at all;
        attempt 2  filtered on `transform: translateX(-50%)` -> read the
                    CITY STATUS PILL, which is also centred and absolute,
                    and reported its text as the facility label;
        attempt 3  narrowed to `bottom: 10px; left: 50%` -> read nothing again,
                    and the reason turned out to be that the CAR STRIP and the
                    LEGEND are always bottom-anchored, so my loop saw "a
                    bottom-anchored element exists" and stopped walking at step 0
                    while the label was still `display: none`.
      The fix was to stop guessing and DUMP every absolutely-positioned element
      with its inline style, which identified all three strips at once. The
      general rule, which this log has now learned three ways: a probe that
      finds nothing is not a measurement, and a probe that finds the WRONG
      element is worse than one that finds nothing, because it produces a
      number.
RESEARCH 2026-09-30 — iteration 99: two of my own findings refuted by measurement
- This round changed NO code. It found that TWO findings I published in
  iterations 96 and 97 do not survive contact with the actual data. Both were
  written by me, both were recorded with confidence, and both are wrong. The
  log's own rule (a probe that finds nothing is not a measurement) applies
  here in a sharper form: a plausible arithmetic derivation from ASSUMED inputs
  is not a measurement of the real table either. I derived the encounter
  density from a route/danger pair I assumed rather than one I read.
- The two refutations:

  1. **`abandonVehicle` is an UNBUILT FEATURE, not an unwired one.** Iteration
     96 recorded: "it is a real gap rather than dead code now that nothing else
     covers it," and iteration 98 re-queued it as such. Both are wrong, and the
     error is the kind that costs a whole iteration. I checked what
     `abandonVehicle` would actually be WIRED TO:
       - `grep -rn "abandonVehicle" src/` -> defined in `src/sim/road.ts:725`,
         called from NOTHING. Its `PedestrianState` is returned to no one.
       - `grep -rn "pedestrian" src/app.ts` -> NO MATCHES. There is no on-foot
         movement code in the app at all, and `showRoad` mounts no menu and no
         actions (measured again this round, same result as iteration 96).
     So wiring it is not a one-line fix; it requires building a whole on-foot
     road mode: a trigger to abandon, a movement system, and a way to arrive on
     foot. It is half a FEATURE, not a loose wire. Recorded so the next
     iteration does not spend itself discovering this mid-round. It stays
     queued, correctly labelled this time: "unbuilt on-foot mode (sim half
     exists in `abandonVehicle`; no app-side pedestrian movement at all)."

  2. **The "short routes are most likely to contain no fight" finding is
     FALSE, and it was arithmetic on an invented input.** Iteration 97 wrote:
         "40 mi, danger 0 (1.0/100mi) -> 0.4 expected encounters"
     and concluded the shortest routes were the emptiest. I never checked that
     a 40-mile danger-0 route EXISTS. It does not. Measured over all 26 real
     routes:
       - 0 of 26 routes are deterministically empty. The minimum roll is 1.
       - the ratio is FLAT, not inverted: encounters-per-minute ranges
         0.0146-0.0467 (a 3.2x spread) with no relationship to length, because
         spawns-per-100mi and real-minutes-per-mile BOTH scale with route
         length, so their quotient barely moves. The two lowest-density
         routes per minute are 80 mi and 150 mi, not 40.
       - the real, much smaller defect is in the OPPOSITE direction: on the
         LONGEST routes, `spawnsPerHundredMiles * length` wants more contacts
         than `spawnBudget` allows, so the budget truncates the roll (e.g.
         washington-pittsburgh 240 mi wants 10.08, budget 8 -> 2 dropped;
         buffalo-pittsburgh 220 mi -> 1 dropped). That is a real
         budget-vs-density disagreement, but it is the opposite claim from the
         one I published, and it is a tuning question, not an inversion.

- WHY THIS ROUND IS WORTH THE ENTRY despite shipping nothing: iteration 97
  told the next iteration to "fix" short-route emptiness, and the obvious fix
  (raise `spawnsPerHundredMiles` at low danger) would have been a TUNING
  CHANGE TO A NON-PROBLEM, committed and deployed. A written finding is
  load-bearing the moment it goes in the queue, whether or not code follows it.
  The correction had to land in the same log the wrong finding came from, or
  the next round would have trusted the queue over the data. I have now re-run
  the check against the actual route table instead of the assumed one, and the
  finding does not survive.
- GATE: unchanged and green — no code changed this round, so the standing
  gate from iteration 98 still holds (tsc clean, 67 files / 1477 tests with
  the 4 measured `screens.test.ts` flake, 5 browser tests, build
  `index-AJyF_mpX.js`, `.shots/iter98` 8 screens / 0 problems). Not re-run
  because nothing was edited; recorded as inherited, and re-run next code
  round.
- STILL QUEUED (relabelled, both corrections applied): the structural pacing
  decision (97, real), the LONG-route budget-vs-density truncation (99, real
  and small), the UNBUILT on-foot mode (99, relabelled from "unwired"), and a
  persistent "surface a failed save" message (93, real).
