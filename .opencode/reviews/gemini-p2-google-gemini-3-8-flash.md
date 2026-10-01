# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-post (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T17:10:31.973Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Reviewed boot tribute, title screen, driver creation flow, input validation, and vehicle constructor layouts; typography, contrast, alignment, and navigation hints are clean and cohesive with modern UI standards.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked city navigation, legend/HUD legibility, and all five facility menus (Garage, Weapon Shop, Arena, Salvage Yard, Bar); all interactions, budget checks, and layout scaling are sound.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked all five facility modals (Medical Center, Assembly Plant, Courier Guild, Truck Stop, Federal Building); dialog layout, route intel, disabled-action feedback, keyboard indexing, and visual hierarchy are consistent and sound.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked road travel, HUD readouts (armor, tires, plant, weapons, radar, speedometer), trip menu, controls, fleet, and journal overlays; all systems, layouts, and data displays are coherent and sound.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 1

### 1. Radar player marker does not rotate to reflect vehicle heading in North-up mode
- **Where:** Frame 25 and Frame 26, bottom-left radar HUD element.
- **What I see:** The radar is labeled "North-up". In Frame 25, the player's vehicle is facing East (~90°), and in Frame 26, the player's vehicle has turned to face South (~180°). However, in both frames, the teal player triangle at the center of the radar remains completely static and points directly North (straight up).
- **Why it matters:** In vehicular combat with a North-up tactical display, players rely on the direction of their marker to orient forward-facing weapons toward enemy pips. Because the triangle always points North regardless of car heading, it falsely communicates that the car is facing upward, causing severe spatial disorientation while maneuvering against targets.
- **Suggested fix:** Bind the rotation of the radar's player triangle icon to the vehicle's heading angle in radians/degrees so that it points in the true direction the car is facing.
```

---

**Total FINDINGS across batches: 1**
**At least one batch reported nothing to report.**