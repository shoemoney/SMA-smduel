# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-final2 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T16:30:49.628Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: The opening sequence, driver creation flow, error handling, and vehicle constructor UI are polished, legible, and correctly implement all layout, stat calculations, and schematic visualisations.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked city map navigation and the first five facility menus (Garage, Weapon Shop, Arena, Salvage Yard, Bar); layouts, text contrast, numbered inputs, and Autoduel-faithful design are sound.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 1

### 1. Courier Guild modal overlaps the top navigation banner
- **Where:** Frame 16 (`16-facility-courierguild.png`), top center
- **What I see:** The Courier Guild dialog window is tall enough that its top border extends upward to roughly y ≈ 68px, directly overlapping the bottom edge of the top navigation banner (`WASD/arrows move...`). The word "gate" on the third line of the banner is partially cut off and obscured by the modal's top border.
- **Why it matters:** UI element collision degrades visual polish, and the city navigation prompt ("WASD/arrows move · G enter/exit car...") is both non-functional and distracting while inside an active modal dialog.
- **Suggested fix:** Hide the top navigation banner while inside facility dialogs, or clamp/scroll the Courier Guild modal so its frame remains below the banner with adequate breathing room.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 0
NOTHING_TO_REPORT: Verified road driving HUD, trip progress bar, speedometer, condition panels, and overlay menus (fleet, journal, controls, trip pause); all layouts, legibility, and modern Autoduel design elements are sound.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 1

### 1. Radar player marker does not reflect vehicle heading in North-up mode
- **Where:** Frame 25 (and 26), bottom-left radar panel (`RADAR`).
- **What I see:** In Frame 25, the vehicle sprite in the arena is facing due East (facing right), but the cyan player marker at the center of the radar is an upward-pointing (North) triangle. In Frame 26, when the vehicle turns to face North, the marker remains pointing straight up.
- **Why it matters:** The radar explicitly states `North-up` at the bottom. In a fixed North-up radar, the map orientation remains static while the player's icon must rotate to show heading. Displaying a static North-pointing arrowhead regardless of actual vehicle heading misleads the player about their orientation relative to approaching enemy blips.
- **Suggested fix:** Bind the rotation of the cyan player icon to the vehicle's heading angle so that it points in the direction the car is facing, or use an omnidirectional circle if vehicle heading is not intended to be tracked on radar.
```

---

**Total FINDINGS across batches: 2**
**At least one batch reported nothing to report.**