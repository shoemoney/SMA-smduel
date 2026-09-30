## Live game review

The most damaging observed defect is reversed vertical pedestrian movement in the city. Next are pervasive small text and a controls interaction that replaces movement bindings when the player tries to cancel.

Reviewed the deployed game on September 29, 2026, using seed `a11ce5ee`. All eight requested screens were captured and inspected. The findings below come from live interaction or rendered measurements. Local source was used afterward to corroborate behavior and identify fixes. No game code was changed.

[Open the interactive evidence gallery](gallery.html). It includes all eight screens, interaction evidence, measurement charts, favorites, comparison, and original-image downloads.

### 1. City walking reverses vertical movement

**Screen and location.** City world, while walking between the lower gate and buildings.

**What is wrong.** Down moves the pedestrian up the screen into town. Up moves the pedestrian down toward the lower gate. Down was used to reach the upper Dealership. Up from the interior moved toward the gate. The camera follows the pedestrian, so the parked car and fixed landmarks provide the reference.

**Why it matters.** The first navigation task fights the advertised WASD and arrow controls. Players make wrong turns before they reach a job or construction facility. This observation concerns pedestrian movement. It does not establish reversed vehicle steering.

**What I would do.** Code change. Make the city compass vectors use the renderer's Y-up world convention. North and its diagonals need positive Y; south and its diagonals need negative Y. Leave the input classifier and east/west vectors intact. Verify all eight walking directions against stationary landmarks.

**Evidence.** [Initial city](city.jpg), [Down reaches Dealership](city-after-down.jpg), [after leaving Dealership](city-after-leaving-shop.jpg), and [Up moves toward the lower gate](city-up-moves-down.jpg). Local corroboration is in `src/ui/input.ts:279`, `src/app.ts:4013`, and `src/sim/city.ts:172`.

### 2. Essential instructions and build values are too small

**Screen and location.** Constructor rows, Facing/Ammo subrows, bottom keyboard hint, and upper-right schematic caption. Also the Driver form and Title tagline.

**What is wrong.** Live computed CSS sizes are 12.19px for constructor labels and values, 11.25px for Facing/Ammo, 10.31px for the bottom hint, and 9.38px for the schematic caption. The Driver form uses 14.06px, and the Title tagline uses 16px. Constructor row line-height is only 14.02px. These are CSS pixels, not estimates from screenshot scaling.

**Why it matters.** Players must read ammunition, cost, legality, and navigation instructions at these sizes. The interface has substantial unused space but requires needless visual effort. Every listed value is below the requested 18px minimum.

**What I would do.** Code/CSS change. Use 20px for normal copy and controls, with an 18px floor for captions, labels, and hints. Increase row line-height, expand the panels, and permit scrolling or wrapping. Preserve all ten indexed weapon slots. Check the rendered result at desktop and mobile widths.

**Evidence.** [Constructor](constructor.jpg), [mounted weapon](constructor-mounted.jpg), [Driver](driver.jpg), and [Title](title.jpg). The gallery plots the measured text sizes against the 18px floor and 20px default.

### 3. Escape during rebinding removes the movement keys

**Screen and location.** Controls menu, `driveUp` row.

**What is wrong.** Selecting `driveUp: KeyW, ArrowUp` enters a “press any key…” state. Pressing Escape changes the row to `driveUp: Escape`. Both previous bindings are replaced. Escape normally serves as Back elsewhere in the menu.

**Why it matters.** A customary cancellation gesture takes away the player's upward movement keys and binds movement to the menu's Back key. The player must repair the controls to recover the previous behavior.

**What I would do.** Code change. Handle Escape before accepting a rebinding key. Cancel capture without changing the existing bindings. Change the prompt to “Press a key. Escape cancels.”

**Evidence.** [Original bindings](controls.jpg) and [after Escape](controls-escape.jpg). Local corroboration is in `src/app.ts:878-886`, `src/ui/input.ts:133-135`, and `src/ui/menu.ts:107`.

### 4. The constructor tells the player to press a key that does nothing

**Screen and location.** Constructor, lower-right LEGALITY panel.

**What is wrong.** The instruction says “Mount at least one weapon — press Enter on a Weapon row.” Selecting a Weapon row and pressing Enter repeatedly does not mount a weapon or open a selector. Right does mount a Machine Gun and reveals Facing and Ammo rows.

**Why it matters.** The first build tutorial directs the player into a dead end on a requirement for a usable car.

**What I would do.** Code/string change. Tell the player to select a Weapon row and use Left/Right to choose a weapon. Alternatively, make Enter open a visible weapon selector and retain the instruction. No new art is needed.

**Evidence.** [Initial constructor and LEGALITY instruction](constructor.jpg), [weapon mounted using Right](constructor-mounted.jpg). Local corroboration is in `src/ui/builder.ts:303-310`, `471-474`, and `494-500`.

### 5. City service markers leave destination selection to trial and error

**Screen and location.** City building entrances and the lower-right Fight/Build/Care/Jobs legend.

**What is wrong.** Three entrances use identical blue briefcases under the Jobs family. Entering the nearest Jobs marker produced the Federal Building's future-phase notice, rather than the Courier Guild. Orange tool markers likewise identify the Dealership, AutoDuel Shop, and Assembly Plant only after entry.

**Why it matters.** A player looking for a job or a place to build a car cannot choose the right facility from its marker. They spend time visiting the wrong service, including an unfinished one.

**What I would do.** Code overlay change. Show the facility name when approaching or targeting an entrance. Use “Courier Guild,” “Assembly Plant,” and “Federal Building — closed.” Add a destination selector with a map highlight if useful. Keep the desaturated building art and the family icons.

**Evidence.** [City markers](city.jpg), [Federal Building reached through Jobs marker](city-federal.jpg), and [normal Assembly build](city-real-build.jpg). Local corroboration is in `src/ui/city-view.ts:809`, `1195-1236`, and `src/app.ts:4221`.

### 6. Fleet offers an unaffordable switch and silently rejects it

**Screen and location.** Fleet centered menu, stored Duster row and cash header.

**What is wrong.** After a successful normal Assembly build, cash was $24. Fleet still offered “Duster — stored here — switch ($50)” as an enabled action. Clicking the row and selecting it by keyboard only redrew the same menu. The active car remained Review car, with no explanation.

**Why it matters.** The menu appears unresponsive. The player cannot tell whether money, location, or a broken interaction prevents the switch.

**What I would do.** Code change. Include affordability in action eligibility. Display “Costs $50. You have $24.” Surface the switch operation's returned failure reason instead of discarding it.

**Evidence.** [Fleet with $24 and $50 action](fleet-two-cars.jpg), [unchanged menu after rejected switch](fleet-switch-rejected.jpg). Local corroboration is in `src/app.ts:4064-4069`, `4088-4091`, and `src/sim/services.ts:301-303`.

### 7. The Driver screen's primary button has insufficient text contrast

**Screen and location.** Driver form, bottom Create Driver button.

**What is wrong.** Rendered text is `#d7e0ea` on a `#4fd6c4` button at 14.06px and full opacity. The calculated WCAG contrast is 1.34:1. Normal-sized text requires 4.5:1 for AA. The screenshot visibly shows the washed-out label.

**Why it matters.** The primary action is harder to read than adjacent form content, especially for players with low vision.

**What I would do.** Code/CSS change. Use dark `#101820` text on the mint background, which gives approximately 10.01:1, and use a 20px button label. No new art is needed.

**Evidence.** [Driver form](driver.jpg). Colors and font size were read from the live rendered form. Contrast was calculated using WCAG sRGB relative luminance.

### Separate review-entry defect

The direct constructor URL had a lower-priority fixture bug. Confirming a $1,984 Review car reduced cash to $16 but retained the Duster and marked it stored. It did not activate the confirmed build. **Normal Assembly construction was separately tested and succeeded**, creating the active Review car and storing the Duster.

Reuse the normal Assembly confirmation flow in the constructor deep-link callback. This is a code change. Evidence is [direct-entry result](city-after-build.jpg) and [successful normal construction](city-real-build.jpg). Local corroboration is in `src/app.ts:6152-6158` and `4341-4360`.

Late in the review, revisiting the supplied Controls and Road URLs opened the title screen. Controls remained reachable through the title menu. This late direct-entry behavior has no established cause and is not presented as a normal-gameplay defect. The earlier eight captures remain available in the gallery.

### Confirmed gap in the game as a whole

The Federal Building is unfinished content. Entering it explicitly displays “Federal Building isn't open for business yet — coming in a future phase.” The local `src/ui/buildings/stub.ts:30` corroborates that placeholder. This is one incomplete facility, not evidence that the jobs system is missing. The Courier Guild contains seeded job offers.

Implement the intended Federal service, or identify it as closed before the player walks there and exclude it from destinations presented as available Jobs services. This requires gameplay and UI code. No new art is necessary to communicate closure.

### Testing scope and capture limits

All eight requested screens were inspected. Constructor tests included row selection, body changes, mounting weapons, ammunition rows, and confirmation. City tests included walking, building entry, normal Assembly construction, entering the car, and short driving inputs. Fleet and control rebinding were exercised. Arena and Road received short driving inputs. No complete highway route or combat encounter was completed, so this review does not assess combat balance, route pacing, or progression completeness.

Saved browser screenshots are 1744 × 976 pixels. The viewport was 1744 × 976 CSS pixels at DPR 2, with a 3488 × 1952 canvas buffer. Native-DPR screenshot capture was denied by the browser permission check. No alternative capture was used to bypass that denial. The native-DPR portion of the requested screenshot workflow therefore could not be completed.

The gallery passed a JavaScript syntax check, and all referenced screenshots were checked for existence and dimensions. Its browser rendering and interactions could not be verified. The sandbox rejected a local HTTP server, and browser policy rejected the file URL. The ECharts library requires an internet connection to load from its CDN.

The pstack **Prove It Works** principle shaped the review by requiring live reproductions before source corroboration. **Model the Domain** shaped the evidence gallery by keeping screenshot metadata in one explicit list.
