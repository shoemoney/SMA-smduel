# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-final2 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T16:42:35.605Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked title sequence, driver creation states, validation errors, and constructor flow; layout, contrast, and modern UI controls are clean and sound throughout.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon Shop modal overlaps and clips the city HUD banner text
- **Where:** Frame `10-facility-weaponshop.png`, top-center screen.
- **What I see:** The Weapon Shop modal is significantly taller than the other facility dialogs (due to its 13-item list). Because it is centered vertically, its top cyan border and header panel extend upward into the semi-transparent city HUD banner, clipping and obscuring the word "gate" from the banner's navigation prompt (`...head into a building or the gate`).
- **Why it matters:** Text collisions between UI layers make the interface feel unpolished and create visual clutter behind the active dialog header.
- **Suggested fix:** Reduce the modal's `max-height` so it scrolls earlier, or hide the city movement instruction banner entirely while a facility modal is active.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: All five facility interfaces (Medical, Assembly, Courier Guild, Truck Stop, Federal Building) are legible, visually consistent, correctly gated by player funds/stats, and operate cleanly.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 0
NOTHING_TO_REPORT: Driving HUD, road scrolling presentation, telemetry clusters, and modal menus (fleet, journal, controls, trip pause) are clean, highly legible, and faithfully modernize Autoduel's highway travel.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked arena match entry and combat HUD (controls hint, condition readouts, weapons status, speedometer, radar tracking, and vehicle rendering); all elements are clear, properly aligned, and functionally sound.
```

---

**Total FINDINGS across batches: 1**
**At least one batch reported nothing to report.**