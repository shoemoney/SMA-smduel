# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-final2 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T16:34:28.019Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked title, driver creation, input validation, ignition crank, and constructor build flow; layout, typography, controls, and legality logic are clean and fully functional.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon Shop menu items overflow past the footer and clip through the dialog border
- **Where:** Frame 10 (`10-facility-weaponshop.png`), bottom of the central facility modal.
- **What I see:** The weapon shop item list extends beyond the available height of the dialog. The footer line (`↑ ↓ REACH THE REMAINING ROWS · ESC — BACK`) renders above the final item (`Refill Ammo: Machine Gun (FRONT) — Costs $500, you have $5.`), which spills into the bottom frame and is vertically sliced in half by the modal border.
- **Why it matters:** The ammo refill row is obscured and difficult to read, and the visual overflow breaks the clean window framing seen across the other facilities.
- **Suggested fix:** Constrain the list container above the footer bar with `overflow: hidden` (or virtualized scrolling) so items cannot render below the footer or bleed across the bottom window border.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked all five facility panels (Medical Center, Assembly Plant, Courier Guild, Truck Stop, Federal Building); layout, styling, hotkeys, status justifications, and navigation hints are consistent and sound.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 0
NOTHING_TO_REPORT: Driving HUD, road presentation, trip menu, controls overlay, and city sub-modals (fleet, journal) are cleanly laid out, fully legible, and consistent with the retro-modern aesthetic.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked arena HUD layout, vehicle rendering, control prompts, weapon/armor readouts, radar tracking, and combat feedback; all elements are legible and sound.
```

---

**Total FINDINGS across batches: 1**
**At least one batch reported nothing to report.**