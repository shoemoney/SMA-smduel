# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-v14 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T05:45:41.512Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 1

### 1. Inconsistent spelling of "Armor" / "Armour" across the constructor screen
- **Where:** Frames 06-constructor-empty.png and 07-constructor-built.png, left column and right column.
- **What I see:** The left column section header is spelled `ARMOUR` (British), while the five rows directly underneath it are labeled `Armor: Front`, `Armor: Rear`, `Armor: Left`, `Armor: Right`, and `Armor: Underbody` (American). On the right column, the summary stat is labeled `ARMOR TOTAL` (American), but the vehicle schematic caption reads `0 armour` / `5 armour` (British) and the legality guidance box instructs to `fit armour` and `Add armour points` (British).
- **Why it matters:** Alternating between US and UK spelling variants across adjacent headers, rows, and readouts looks uncoordinated and diminishes interface polish.
- **Suggested fix:** Standardize on a single spelling variant across all constructor labels, stats, captions, and help text (e.g., standardizing on `Armor` or `Armour`).
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 2

### 1. Weapon Shop modal overlaps city exploration banner
- **Where:** Frame 10 (`10-facility-weaponshop.png`), top-center region ($y \approx 68\text{--}90\text{ px}$).
- **What I see:** The Weapon Shop modal extends upward into the city HUD banner. Its top border line directly intersects and cuts through the word "gate" from the exploration prompt (`...head into a building or the gate`).
- **Why it matters:** Text and container borders visibly collide, creating an unpolished look. Furthermore, the city navigation controls (`WASD/arrows move · G enter/exit car...`) displayed in that banner are inactive and irrelevant while interacting with facility menus.
- **Suggested fix:** Hide the city exploration prompt banner while any facility modal is open. In addition, constrain modal dialogs with a proper top margin and `max-height` to prevent vertical overflow.

### 2. Bottom row in Weapon Shop menu is horizontally clipped
- **Where:** Frame 10 (`10-facility-weaponshop.png`), bottom of the menu item list ($y \approx 895\text{--}915\text{ px}$).
- **What I see:** The last visible row (`Refill Ammo: Machine Gun (FRONT) — Costs $500, you have...`) is sliced horizontally along its baseline. Only the top half of the text glyphs is visible directly above the `↑ ↓ REACH THE REMAINING ROWS · ESC — BACK` footer.
- **Why it matters:** Truncating text glyphs mid-character looks like a CSS overflow defect and makes the bottom item difficult to read.
- **Suggested fix:** Adjust the scroll container's height or bottom padding so that rows snap to full line heights or scroll cleanly without slicing characters in half against the footer border.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: All five facility menus (Medical Center, Assembly Plant, Courier Guild, Truck Stop, Federal Building) present consistent, clear modern modal layouts with explicit disabled-state explanations and clean navigation.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 2

### 1. Mixed British and American English spelling in the Condition panel
- **Where:** Frames 22, 23, and 24, top-right HUD panel (`CONDITION`).
- **What I see:** The panel uses British English for section headers (`ARMOUR`, `TYRES`) and in Frame 19's vehicle card (`5 armour`), but switches to American English in the driver sub-section: `Body armor: x 0/3`.
- **Why it matters:** Mixing `ARMOUR` and `armor` within the exact same HUD card creates an unpolished, inconsistent impression in the primary combat HUD.
- **Suggested fix:** Standardise on British English by changing the line to `Body armour: x 0/3` (or, if en-US is the intended project standard, adopt `ARMOR` and `TIRES`).

---

### 2. Visible vertical tile seams across the road surface
- **Where:** Frames 22, 23, and 24, lower half of the roadway (below the barrier line, notably near x ≈ 480, x ≈ 950, and x ≈ 1420).
- **What I see:** The asphalt surface displays sharp vertical boundary lines running from the barrier curb down to the bottom edge. Adjacent chunks have mismatched luminance/shading, producing a visible rectangular block artifact.
- **Why it matters:** The hard-edged seams break visual continuity on the main gameplay surface and read as an asset tiling or chunk blending bug.
- **Suggested fix:** Match the base luminance and border pixel values across road texture chunks so horizontal repetitions tile seamlessly.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 1

### 1. Radar player heading indicator does not rotate with vehicle in North-up mode
- **Where:** Frame 25-arena-entry.png, bottom-left Radar panel.
- **What I see:** The arena vehicle is oriented facing East (towards the right edge of the screen), but the cyan triangle representing the player in the center of the radar points straight North (up). In Frame 26, when the vehicle turns to face North, the indicator still points North.
- **Why it matters:** The radar is operating in "North-up" mode (where radar blips stay fixed to world coordinates rather than rotating around the player's forward view). In this mode, the player's icon must rotate to reflect the car's actual facing direction. When the arrow stays permanently pointed North regardless of car heading, players cannot tell which way they are facing relative to incoming radar contacts.
- **Suggested fix:** Bind the rotation of the cyan player indicator on the radar canvas/element to the player vehicle's current heading angle.
```

---

**Total FINDINGS across batches: 6**
**At least one batch reported nothing to report.**