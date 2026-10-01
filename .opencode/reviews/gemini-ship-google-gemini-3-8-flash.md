# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-ship (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T03:22:49.605Z

## Batch 2 — the city and the first five facilities

```
FINDINGS: 2

### 1. Weapon shop list overflows and overlaps the modal footer
- **Where:** Frame `10-facility-weaponshop.png`, bottom edge of the central modal dialog.
- **What I see:** The 13th row (`Refill Ammo: Machine Gun (FRONT) — Costs $500, you have...`) is vertically truncated by the footer bar. Crucially, the text `$500` bleeds directly over the footer bar line immediately to the left of `↑ ↓ REACH THE REMAINING ROWS`.
- **Why it matters:** Text collisions and clipped rows look unfinished and make the ammo refill price and status difficult to read.
- **Suggested fix:** Add bottom padding or set a proper scroll container bounds (`overflow-y: auto` with margin/padding above the footer) so items scroll cleanly behind or above the footer without overlapping the text.

### 2. Arena informational schedule line is formatted as actionable menu item 9
- **Where:** Frame `11-facility-arena.png`, item 9 inside the facility menu.
- **What I see:** Row 9 is prefixed with the number hotkey `9` and styled as a menu row: `9  City Championship upcoming: day 50, 134, 218`. All other numbered rows (1–8 and 0) are actionable commands (`Enter ...`, `Leave`).
- **Why it matters:** Players pressing `9` or clicking this row will expect an action (e.g. view championship details or register), but it is merely informational schedule text.
- **Suggested fix:** Remove the hotkey number `9` and display upcoming championship dates either as supplementary subtext under option 8 (`Enter City Championship`) or as an unnumbered footer/status notice.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 2

### 1. Courier Guild menu text clips and overlaps the footer border
- **Where:** Frame `16-facility-courierguild.png`, bottom edge of the central modal window.
- **What I see:** The row `Safe route to Scranton: ~2.8 expected encounters, 1 day(s)` is drawn directly across the horizontal divider line and overlaps the footer element (`↑ ↓ REACH THE REMAINING ROWS · ESC — BACK`).
- **Why it matters:** Text rendered across container borders and footer controls looks visually broken and is difficult to read.
- **Suggested fix:** Add proper overflow clipping and bottom padding to the scrollable list container so text terminates cleanly above the footer border.

### 2. Courier Guild assigns hotkey numbers to informational text while action items lack keys
- **Where:** Frame `16-facility-courierguild.png`, inside the Courier Guild menu list.
- **What I see:** Numbers `1` through `0` are mapped sequentially down the list, assigning hotkeys to informational readouts (e.g., `1 Route to Albany: danger 1`, `6 Quick route to Atlantic City: 25 mi, 1 day(s)`), while subsequent actionable contracts further down (such as `Accept: bulk propellant to Providence`) receive no number key. Furthermore, unlike every other facility frame (14, 15, 17, 18), there is no teal selection highlight on any item.
- **Why it matters:** Players cannot tell what pressing keys 1–7 or 9–0 does (since those rows are route statistics, not actions), players relying on number keys cannot accept contracts that fall past row 10, and the absence of a focused selection box breaks navigation consistency with the rest of the facility menus.
- **Suggested fix:** Separate route info/danger statistics into an informational header or side panel, assign numbered action shortcuts exclusively to selectable contract items and a "Leave" option, and ensure the default active cursor highlight is rendered.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 3

### 1. Typo in controls menu ("driverRight")
- **Where:** Frame 21 (`21-controls.png`), row 5 of the keybinds list.
- **What I see:** Row 5 is labeled `driverRight: KeyD, ArrowRight`, whereas rows 2 through 4 are labeled `driveUp`, `driveDown`, and `driveLeft`.
- **Why it matters:** An accidental "driverRight" typo in the action identifier list looks unpolished.
- **Suggested fix:** Change the label/key from `driverRight` to `driveRight`.

### 2. Controls dialog list overflows across the bottom border
- **Where:** Frame 21 (`21-controls.png`), bottom edge of the dialog card.
- **What I see:** The 9th weapon hotkey row (`weaponDirect9: Digit9`) overflows beneath the navigation hint (`↑ ↓  REACH THE REMAINING ROWS · ESC — BACK`) and bleeds directly across the modal card's bottom border line.
- **Why it matters:** Unclipped text escaping modal boundaries and overlapping navigation hints creates visual collision and illegibility.
- **Suggested fix:** Apply `overflow: hidden` to the inner scroll container and ensure the list area ends cleanly above the footer border.

### 3. Radar heading indicator is rotated 90 degrees out of sync with vehicle facing
- **Where:** Frames 22–24 (`22-road.png`, `23-road-driving.png`, `24-road-trip-menu.png`), bottom-left RADAR widget.
- **What I see:** The radar is labeled `North-up`. The vehicle sprite in the center of the road viewport faces North (facing directly upwards). However, the green player heading triangle in the center of the radar points East (to the right).
- **Why it matters:** In a North-up radar display, the heading pip should reflect the vehicle's actual orientation. Pointing East while the vehicle faces North creates an erroneous 90-degree discrepancy that misleads the player during navigation.
- **Suggested fix:** Synchronize the radar indicator angle with the vehicle's visual orientation (offset by 90° / -π/2 so 0 rad points North instead of East).
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Arena entry and combat HUD (condition telemetry, radar, weapon status, speed tier gauge, combat messaging, and navigation controls) are legible, functional, and faithful to Autoduel.
```

---

**Total FINDINGS across batches: 7**
**At least one batch reported nothing to report.**