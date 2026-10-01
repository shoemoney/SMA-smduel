# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-final2 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T10:08:26.995Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked boot tribute, title screen, driver creation and validation flow, and constructor UI layout, schematic, and legality feedback; all elements are clear, properly aligned, and sound.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon Shop modal overlaps the top HUD instruction banner
- **Where:** Frame 10 (`10-facility-weaponshop.png`), top-center.
- **What I see:** The Weapon Shop modal is taller than the other facility menus, and its top border and header (`$5 | 2030-01-01 (DAY) — New York`) extend up to roughly Y=70px, physically overlapping the bottom edge and background card of the persistent city HUD banner (`WASD/arrows move · G enter/exit car... or the gate`).
- **Why it matters:** The collision between the modal border and the top HUD card creates an unpolished visual clash. Additionally, displaying city movement prompts (`WASD/arrows move`, `G enter/exit car`) behind an open modal is redundant and visually distracting while keyboard input is captured by the shop.
- **Suggested fix:** Hide or fade the city HUD banner whenever a full-screen facility modal is open, or enforce a `max-height` / top margin constraint on the modal container so it stays clear below the header area.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 1

### 1. Courier Guild modal overlaps and clips the top city HUD banner
- **Where:** Frame 16 (`16-facility-courierguild.png`), top-center of the screen.
- **What I see:** The Courier Guild modal expands to ~864px tall to fit all the route intel and job listings. Because it is vertically centered, its top border extends to `y ≈ 68px`, crossing into the top HUD banner (which extends down to `y = 88px`). The modal's top glowing cyan border line slices directly through the word `gate` on the third line of the city control hints.
- **Why it matters:** Two primary UI elements collide and render text over borders, making the screen look unpolished and breaking UI hierarchy while inside a facility dialogue.
- **Suggested fix:** Either constrain facility modals with a `max-height` (e.g., `calc(100vh - 200px)`) and an internal scroll container for long job lists, or hide/suppress the top city instruction banner whenever a facility modal is open.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 0
NOTHING_TO_REPORT: Driving HUD, road presentation, trip menu, and overlays (fleet, journal, controls) were inspected and verified clear, legible, and properly aligned.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Arena entry and combat HUD elements are clear, legible, and properly layered, with collision-free telemetry, working radar tracking, and responsive combat/speed feedback.
```

---

**Total FINDINGS across batches: 2**
**At least one batch reported nothing to report.**