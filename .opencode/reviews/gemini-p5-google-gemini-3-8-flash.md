# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-post (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T17:23:52.432Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: The opening flow (boot tribute, title screen, driver creation with error states, and ignition sequence) and car constructor layout, schematics, legality validation, and input styling are coherent, fully functional, and cleanly modernize Autoduel's classic vehicle-building loop.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked city navigation, facility modals (Garage, Weapon Shop, Arena, Salvage Yard, Bar), keyboard shortcuts, disabled state explanations, and HUD consistency; all systems are fully legible, properly aligned, and sound.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: All five facility dialogs (Medical, Assembly Plant, Courier Guild, Truck Stop, Federal Building) display consistent modal styling, clear state messaging, legible disabled reasons, unified hotkey cues, and stable HUD anchoring.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 0
NOTHING_TO_REPORT: Driving HUD, road scrolling, trip progress bar, controls overlay, and city/trip modals were checked and found legible, consistent, and mechanically sound.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 1

### 1. North-up radar player marker does not reflect initial vehicle heading
- **Where:** Frame `25-arena-entry.png`, bottom-left RADAR panel vs center viewport.
- **What I see:** The player's car spawns facing East (roughly 90°, headlights and front bumper pointing right). However, the cyan player triangle at the center of the radar points straight North (0° / 12 o'clock). In frame 26, after the player steers North, the car and radar triangle both face North.
- **Why it matters:** In "North-up" radar mode, the map orientation is fixed, so the player pip's rotation is the only indicator of vehicle heading relative to arena blips. Showing a North-facing arrow when the car is pointing East gives false navigational information right at match start.
- **Suggested fix:** Bind the radar player icon's rotation to the vehicle's actual orientation angle immediately upon spawn, rather than defaulting to 0°/North until manual steering occurs.
```

---

**Total FINDINGS across batches: 1**
**At least one batch reported nothing to report.**