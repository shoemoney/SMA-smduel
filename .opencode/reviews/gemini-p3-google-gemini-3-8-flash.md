# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-post (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T17:15:51.380Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked title sequence, driver creation/validation, and constructor states; UI layout, contrast, input hints, and vehicle build flow are polished and fully functional.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 2

### 1. Weapon Shop item list overflows and collides with the modal footer
- **Where:** Frame 10 (`10-facility-weaponshop.png`), bottom of the central modal window.
- **What I see:** The 13th row (`Refill Ammo: Machine Gun (FRONT)`) visually collides with the footer container (`↑ ↓ REACH THE REMAINING ROWS · ESC — BACK`). Its right-hand status string is cut off (`Costs $500, you have` without displaying the `$5.` shown on preceding rows), and the baseline of the text intersects the top border of the footer bar.
- **Why it matters:** List items bleed into the navigation footer, obscuring text and truncating item cost details. It looks like an unconstrained scroll container defect rather than finished UI.
- **Suggested fix:** Add bottom margin/padding and strict `overflow: hidden` to the scrollable row container so list items scroll cleanly behind or above the footer, and allocate enough width to prevent the price text from wrapping or truncating.

### 2. Facility modal header omits the facility name
- **Where:** Frames 09 through 13 (`09-facility-garage.png` through `13-facility-bar.png`), top bar of the central modal window.
- **What I see:** Every facility modal displays the identical header `$5 | 2030-01-01 (DAY) — New York`. The facility's own identity (Garage, Weapon Shop, Arena, Salvage Yard, Bar) is completely absent from the modal window itself. The only indicator is a small, low-contrast HUD pill detached at the very bottom border of the screen.
- **Why it matters:** When a player enters a facility, their attention is focused on the central modal. Without the facility title in the modal header, players have to look away to the screen margin or infer the location from the menu choices to verify where they are.
- **Suggested fix:** Include the facility name directly in the modal header (e.g., `Weapon Shop — New York | $5 | 2030-01-01 (DAY)`).
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked all five facility interiors (Medical, Assembly, Courier Guild, Truck Stop, Federal Building); dialog layouts, disabled option explanations, hotkeys, and facility HUD indicators are clean and consistent.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked road travel, trip menu, HUD overlays (radar, speedometer, condition, weapons), controls reference, fleet, and journal screens; all rendering, layout, and gameplay HUD elements are sound and legible.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked arena entry and active combat HUDs across both frames (vehicle orientation correctly synced with radar blip heading, condition/armor readouts, speed gauge, message stacking, and control hints); all elements are cleanly styled, legible, and structurally sound.
```

---

**Total FINDINGS across batches: 2**
**At least one batch reported nothing to report.**