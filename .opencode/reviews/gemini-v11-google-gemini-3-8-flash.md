# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-v11 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T04:43:47.702Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked title, driver creation, ignition crank, error handling, and empty/built constructor screens; layout, contrast, UI controls, schematic, and validation flows are clear and defect-free.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: City map layout, navigation HUD, facility modals (Garage, Weapon Shop, Arena, Salvage Yard, Bar), and keyboard menu bindings are legible, consistent, and sound.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: All five facility menus (Medical Center, Assembly Plant, Courier Guild, Truck Stop, and Federal Building) render with consistent UI frames, clear numeric shortcut mapping, legible typography, and explicit feedback explaining disabled options.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 3

### 1. Vehicle sprite is oriented perpendicular to the direction of travel on the highway
- **Where:** Frame 22 (`22-road.png`) and Frame 23 (`23-road-driving.png`), center screen.
- **What I see:** The highway is laid out horizontally across the widescreen view (horizontal yellow dashed centerline, horizontal white edge markings, horizontal roadside markers). Scenery motion in Frame 23 is horizontal. However, the car sprite is oriented vertically (facing North / 0°), and the radar also displays a North-facing heading. When driving at 29 mph, the car travels horizontally while remaining pointed straight up toward the top edge of the screen.
- **Why it matters:** The car drives sideways down the road like a crab. Because vehicle weapons fire in the vehicle's facing direction (the HUD shows an upward arrow `^` for weapon 1), front-mounted weapons will fire off-road into empty terrain rather than along the road at oncoming enemies.
- **Suggested fix:** Rotate the vehicle sprite and heading by 90° so the car faces along the travel lane (East/West), or align the road layout with the car's heading.

### 2. Vehicle spawns directly overlapping the road edge line and shoulder bollards
- **Where:** Frame 22 (`22-road.png`) and Frame 23 (`23-road-driving.png`), center of screen along the lower road boundary.
- **What I see:** The vehicle is positioned directly on top of the bottom white solid fog line and the row of orange/white reflector bollards. In Frame 23, as the road scrolls, the bollards pass directly through the lower body of the car sprite.
- **Why it matters:** The player begins their trip clipping through roadside barrier posts instead of occupying a valid driving lane, which looks unpolished and causes visual collision artifacts with static road geometry.
- **Suggested fix:** Offset the vehicle's default vertical spawn position upward so it centers cleanly inside the driving lane between the yellow centerline and the bottom white shoulder line.

### 3. Fleet menu renders over an empty black background instead of the city scene
- **Where:** Frame 19 (`19-fleet.png`), full screen outside the center modal.
- **What I see:** In Frame 19, opening the Fleet menu displays the modal over a solid black void (`#020408`) with only the top-left Arcade button present. In Frame 20 (`20-journal.png`), opening the Journal menu in the same city location displays the identical modal style over the dimmed city map and HUD.
- **Why it matters:** Dropping into a pitch-black screen breaks visual continuity and makes the overlay appear like an unloaded screen or rendering failure compared to the Journal overlay.
- **Suggested fix:** Render the underlying city map and HUD with a dark scrim beneath the Fleet modal, matching the treatment seen in Frame 20.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked arena HUD layout, combat telemetry, radar tracking, message log positioning, and control legibility across both entry and active combat states; all elements are clear, responsive, and functional.
```

---

**Total FINDINGS across batches: 3**
**At least one batch reported nothing to report.**