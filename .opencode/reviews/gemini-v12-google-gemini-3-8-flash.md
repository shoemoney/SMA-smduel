# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-v12 (18 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T05:20:13.081Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked title, driver creation, validation, ignition crank, and constructor layouts; all UI elements, inputs, legality checks, and schematic facings are clear, functional, and visually sound.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 2

### 1. Weapon Shop modal overflows container, vertically bisecting text and hiding the "Leave" option
- **Where:** Frame `10-facility-weaponshop.png`, bottom of the center modal dialog (just above `↑ ↓ REACH THE REMAINING ROWS · ESC — BACK`).
- **What I see:** The shop menu contains more entries than can fit in the modal's viewport. The bottom visible entry (`Refill Ammo: Machine Gun (FRONT) — Costs $500, you have`) is clipped horizontally through the lower half of its characters by the container bounds. Furthermore, the explicit numbered `Leave` option—present as a standard exit row in every other facility menu (Garage, Arena, Salvage Yard, Bar)—is pushed completely out of view off the bottom.
- **Why it matters:** Truncated text looks unpolished and broken. Players scanning the menu visually for the standard numbered `Leave` option will not see it, forcing them to rely solely on `ESC` or realize the list scrolls.
- **Suggested fix:** Constrain the list view with a proper scroll container that provides sufficient bottom padding, ensure rows do not clip mid-line, or pin the `Leave` action and footer controls outside the scrollable item list so the exit path is always visible.

### 2. Weapon Shop modal overlaps the persistent city HUD banner
- **Where:** Frame `10-facility-weaponshop.png`, top center of the screen.
- **What I see:** Unlike the other facility modals which are vertically centered with clear margins (e.g. frames 09, 11, 12, 13), the Weapon Shop modal expands vertically to ~930px. Its top border extends to roughly y=70px, directly overlapping the bottom edge of the top city status bar (`WASD/arrows move ... head into a building or the gate`, which extends down to ~90px).
- **Why it matters:** The two translucent dark containers collide, creating visually messy overlapping borders and text proximity that undermines the clean UI presentation seen in the rest of the game.
- **Suggested fix:** Set an explicit `max-height` or top margin on facility modals so they never intrude into the top HUD area, requiring the internal list container to scroll rather than expanding the dialog frame into persistent HUD elements.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: All five facility interfaces (Medical, Assembly, Courier Guild, Truck Stop, Federal Building) present clean layouts, consistent keyboard controls, clear requirement feedback, and faithful Autoduel service loops.
```

---

**Total FINDINGS across batches: 2**
**At least one batch reported nothing to report.**