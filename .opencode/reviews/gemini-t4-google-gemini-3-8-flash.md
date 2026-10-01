# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-final2 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T16:38:38.665Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked title, driver creation, ignition crank, and constructor flow; UI hierarchy, legibility, and modern Autoduel adaptation are completely sound.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon Shop item list overflows and clips into footer divider
- **Where:** Frame 10 (`10-facility-weaponshop.png`), bottom edge of the central modal dialog.
- **What I see:** The 13th menu item (`Refill Ammo: Machine Gun (FRONT) — Costs $500, you have...`) is cut off horizontally and vertically, with letter descenders overlapping the divider line directly above `↑ ↓ REACH THE REMAINING ROWS · ESC — BACK`.
- **Why it matters:** Text bleeding directly into a separator border looks unpolished and partially truncates readable item information.
- **Suggested fix:** Constrain the scrollable list container with `overflow: hidden` and ensure row heights or container padding prevent half-rendered rows from bleeding over the footer separator.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: Reviewed all five remaining facilities (Medical Center, Assembly Plant, Courier Guild, Truck Stop, Federal Building); dialog layouts, disabled-state rationale, inputs, and styling are consistent, legible, and sound.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 0
NOTHING_TO_REPORT: Driving phase, overlays (Fleet, Journal, Controls, Trip Menu), and road combat HUD are legible, consistent with the design system, and faithfully modernize the Autoduel road travel loop.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked arena HUD layout, vehicle rotation, weapon/condition readouts, radar tracking, and combat messaging; all elements are legible, responsive, and render cleanly without conflict.
```

---

**Total FINDINGS across batches: 1**
**At least one batch reported nothing to report.**