# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-v13 (18 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T05:39:07.812Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked title, driver creation/validation, ignition crank transition, and empty/built constructor states; UI layout, contrast, input consistency, and the modern Autoduel loop are sound.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon shop modal overflows vertically, overlapping the top HUD and clipping the bottom menu row
- **Where:** Frame 10 (`10-facility-weaponshop.png`), center modal dialog.
- **What I see:** The Weapon Shop modal is taller than all other facility menus to accommodate its large catalog. As a result:
  1. The top border of the modal box extends upward to around `y ≈ 70px`, colliding with and overlapping the bottom area of the top HUD banner (`WASD/arrows move...`).
  2. The bottom row (`Refill Ammo: Machine Gun (FRONT) — Costs $500, you have...`) is sliced horizontally in half by the container's bottom border / footer divider bar (`↑ ↓ REACH THE REMAINING ROWS · ESC — BACK`).
- **Why it matters:** It breaks the polished visual presentation seen in the other facilities (Garage, Arena, Salvage, Bar), obscures the bottom item's text, and causes an awkward z-index collision with the top HUD bar.
- **Suggested fix:** Set a strict `max-height` on the modal dialog (e.g., `calc(100vh - 160px)` or `max-h-[75vh]`) with explicit top/bottom margins, and wrap the items in a dedicated scroll container with bottom padding so rows scroll smoothly without being sliced by the footer.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked all five facility modals (Medical, Assembly, Courier Guild, Truck Stop, Federal Building) for legibility, navigation hints, input styling, and HUD consistency; all five render cleanly with coherent state messaging.
```

---

**Total FINDINGS across batches: 1**
**At least one batch reported nothing to report.**