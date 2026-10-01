# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-v10 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T04:19:14.496Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Boot tribute, title navigation, driver creation flow, crank state, and constructor layout and schematic all render cleanly with sharp contrast and cohesive modern UI styling.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon shop item list overflows and clips into the modal footer
- **Where:** Frame `10-facility-weaponshop.png`, bottom of the central facility dialog modal.
- **What I see:** The shop menu content extends too far down. The bottom visible entry (`Refill Ammo: Machine Gun (FRONT) — Costs $500, you have...`) is vertically truncated along its baseline, and the footer navigation text (`↑ ↓ REACH THE REMAINING ROWS · ESC — BACK`) renders directly on top of the clipped list item rather than inside a distinct, opaque footer bar like the other facility menus (e.g., frames 09, 11, 12, 13).
- **Why it matters:** The bottom row's price/requirement text is cut in half and illegible, creating visual collision with the navigation prompt and appearing broken to the player.
- **Suggested fix:** Clip the scrollable list container strictly above the modal footer, give the footer bar an opaque background matching the other facility windows, and add bottom scroll padding so list items don't collide with the footer prompt.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: All five facility menus (Medical Center, Assembly Plant, Courier Guild, Truck Stop, Federal Building) present clear, consistent layouts, legible transaction rules and failure states, and uniform navigation controls.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 3

### 1. Trip menu does not hide the in-game driving HUD hint
- **Where:** Frame 24 (`24-road-trip-menu.png`), top-center directly above the trip menu modal.
- **What I see:** While the Trip Menu modal is active, the driving control reminder (`WASD / arrows to drive` and `Esc — trip menu`) remains rendered on screen directly above the menu box. At the same time, the bottom of the modal reads `ESC — BACK`.
- **Why it matters:** Displaying `Esc — trip menu` while the player is already inside the trip menu is redundant and conflicting, cluttering the screen and giving contradictory input guidance.
- **Suggested fix:** Hide the top driving control reminder panel whenever the trip menu overlay is open.

### 2. Fleet modal renders over a black void instead of the city backdrop
- **Where:** Frame 19 (`19-fleet.png`), screen background behind the modal.
- **What I see:** Opening the fleet menu (`F`) displays the modal over a solid black screen with no city environment or HUD visible (only the top-left Arcade button persists). In contrast, Frame 20 (`20-journal.png`) shows the journal modal (`J`) properly rendered over a dimmed view of the New York city map and city HUD.
- **Why it matters:** The sudden drop to pitch black makes the fleet screen feel disconnected or visually broken, as though the game world failed to render behind the overlay.
- **Suggested fix:** Render the city view behind the fleet modal using the same dimmed scrim used by the journal modal in Frame 20.

### 3. Controls screen displays generic "number key" placeholder for weapon bindings
- **Where:** Frame 21 (`21-controls.png`), rows 9, 0, and the unnumbered weapon select rows below them.
- **What I see:** All eight weapon selection bindings are listed with the literal text `number key` (e.g., `Select weapon 1: number key`, `Select weapon 2: number key`, up to `Select weapon 8: number key`) instead of displaying the actual bound key character.
- **Why it matters:** A player checking their controls cannot tell which specific key selects which weapon slot (e.g. `1`, `2`, `3`, etc.).
- **Suggested fix:** Format the binding labels to display the specific assigned key (e.g. `1`, `2`, `3` ... `8`) rather than the generic token string `number key`.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Arena entry and active combat HUD, radar, speedometer, controls hint, condition panel, and combat messaging are legible, correctly positioned without overlap, and sound.
```

---

**Total FINDINGS across batches: 4**
**At least one batch reported nothing to report.**