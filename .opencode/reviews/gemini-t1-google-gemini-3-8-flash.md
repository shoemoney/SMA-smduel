# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-final2 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T16:28:03.720Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Opening sequence, title navigation, driver generation error handling, and the vehicle constructor UI are polished, legible, and sound.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon Shop modal collides with the top city navigation banner
- **Where:** Frame 10 (`10-facility-weaponshop.png`), top center of the screen
- **What I see:** Because the Weapon Shop modal is taller than other facility dialogs, its top border extends upward to roughly `y ≈ 68px`. This places it directly over the bottom edge of the top navigation banner (`New York · Day 0...`). The modal's top border line cuts across the instruction text, and the orphaned wrapped word `"gate"` renders inside the modal container immediately above the header line (`$5 | 2030-01-01 (DAY) — New York`).
- **Why it matters:** The overlapping text creates visual clutter and reduces legibility right at the modal's header. Furthermore, the city navigation controls (`WASD/arrows move · G enter/exit car...`) are inactive while inside a facility menu, so displaying them behind the menu adds unnecessary noise.
- **Suggested fix:** Hide the top city guidance banner whenever any facility modal is active, or add a proper opaque scrim/backdrop behind the modal and enforce a minimum top margin so dialogs never clip into HUD banners.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked all five facility modals (Medical, Assembly, Courier Guild, Truck Stop, Federal Building); layout, numbering, rejection strings, and navigation are uniform and sound.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 0
NOTHING_TO_REPORT: Verified driving loop, road HUD overlays, city modals (fleet, journal), controls config, and trip menu; layout, styling, and legibility are sound and cohesive.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked arena HUD layout, radar tracking, condition and speed readouts, message logging, and combat rendering; all elements are legible and function cleanly.
```

---

**Total FINDINGS across batches: 1**
**At least one batch reported nothing to report.**