# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-v9 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T03:57:59.828Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Verified the boot tribute, title screen, driver creation/validation flows, and constructor interface (both initial empty state with guidance instructions and completed legal build state); all layouts, modern UI controls, schematic visualizers, and state transitions are legible, functional, and visually sound.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon shop list item is clipped and overlaps the footer bar
- **Where:** Frame 10 (`10-facility-weaponshop.png`), bottom edge of the Weapon Shop modal dialog.
- **What I see:** The bottom visible entry (`Refill Ammo: Machine Gun (FRONT) — Costs $500, you have...`) is sliced horizontally in half, bleeding directly into the dark footer bar (`↑ ↓ REACH THE REMAINING ROWS · ESC — BACK`).
- **Why it matters:** Text is partially obscured and collides with the footer action bar, hurting readability for ammunition refills and giving the shop menu an unpolished, broken appearance.
- **Suggested fix:** Constrain the scrollable list container with proper bottom padding and bounds so menu entries do not overlap or get clipped by the footer bar.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 2

### 1. Courier Guild assigns menu shortcut numbers to static informational text instead of contracts
- **Where:** Frame 16 (`16-facility-courierguild.png`), central Courier Guild modal dialog.
- **What I see:** Number shortcuts (1 through 7, 9, and 0) are assigned to informational text lines ("Route to Albany: danger 1", "Quick route to Atlantic City: 25 mi...", etc.). Meanwhile, actual actionable contracts (such as "Accept: bulk propellant to Providence...") receive no hotkey number.
- **Why it matters:** Players using keyboard shortcuts cannot accept jobs directly because the available number keys are consumed by inert route descriptions. It also creates confusion about what in the list is an actionable choice versus descriptive background data.
- **Suggested fix:** Restructure each delivery job as a unified card/row with its route details nested inside, and assign shortcut numbers exclusively to actionable contract selections rather than raw lines of text.

### 2. Courier Guild list content overflows the dialog container and collides with the footer
- **Where:** Frame 16 (`16-facility-courierguild.png`), bottom edge of the Courier Guild modal.
- **What I see:** The bottom-most item line ("Safe route to Scranton: ~2.8 expected encounters, 1 day(s)") extends beyond the list area, rendering partially clipped directly underneath the footer bar (`↑ ↓ REACH THE REMAINING ROWS · ESC — BACK`).
- **Why it matters:** The bottom row of route text is partially obscured and unreadable, breaking visual polish and making the modal appear uncontained.
- **Suggested fix:** Confine the list to a scrollable container with an explicit `max-height` and bottom padding so list items cleanly scroll behind or above the footer controls without overlapping.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 1

### 1. Controls menu displays raw internal variable names and DOM key codes
- **Where:** Frame 21 (`21-controls.png`), center controls modal list items 2 through 0 and scrollable rows below.
- **What I see:** The controls binding list displays developer-facing camelCase identifiers (`driveUp`, `driveDown`, `driveLeft`, `driveRight`, `fire`, `cycleWeaponNext`, `cycleWeaponPrev`, `weaponDirect1` through `weaponDirect8`) paired with raw browser `KeyboardEvent.code` values (`KeyW`, `ArrowUp`, `KeyS`, `ArrowDown`, `KeyA`, `ArrowLeft`, `KeyD`, `ArrowRight`, `Space`, `KeyJ`, `KeyE`, `KeyQ`, `Digit1` through `Digit8`).
- **Why it matters:** Exposing raw internal code identifiers and DOM strings instead of localized player-facing labels looks like an unstyled debug menu, breaks immersion, and makes scanning and remapping controls awkward (e.g. reading `KeyE` instead of `E`, or `weaponDirect1` instead of `Weapon Slot 1`).
- **Suggested fix:** Map action IDs to human-readable labels (e.g., `driveUp` → "Accelerate / Up", `cycleWeaponNext` → "Next Weapon", `weaponDirect1` → "Select Weapon 1") and format key display strings by trimming technical prefixes (`KeyW` → "W", `Digit1` → "1", `ArrowUp` → "↑" or "Up Arrow").
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked arena entry and combat HUD layout, vehicle orientation tracking on radar, condition monitors, and combat message positioning; all elements render cleanly without overlap or defects.
```

---

**Total FINDINGS across batches: 4**
**At least one batch reported nothing to report.**