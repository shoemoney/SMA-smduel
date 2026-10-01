# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-post (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T17:07:56.152Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked title, driver creation flow, validation states, and constructor layout and schematic; all elements, controls, and readouts are clear, responsive, and sound.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Shop menu items overflow and clip into modal footer
- **Where:** `10-facility-weaponshop.png`, bottom of the central modal window.
- **What I see:** The last visible list entry (`Refill Ammo: Machine Gun (FRONT) — Costs $500, you have...`) overflows the list container and directly collides with the footer bar containing `↑ ↓ REACH THE REMAINING ROWS · ESC — BACK`. The lower half of the text row is clipped and obscured by the footer container.
- **Why it matters:** Weapon shops have more items than can fit in a single static view. Because the scrollable list container does not reserve padding or clip cleanly above the footer, ammo refill options and pricing are obscured and difficult to read.
- **Suggested fix:** Constrain the list view with a `max-height` and explicit `overflow: hidden` / `overflow-y: auto` bounded above the footer bar, and add bottom padding to the scrollable area so that scrolled items clear the footer cleanly.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: All five facility menus (Medical Center, Assembly Plant, Courier Guild, Truck Stop, Federal Building) present clear action costs, legible requirements, consistent HUD elements, and modern keyboard-driven navigation.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 1

### 1. Controls menu header displays incorrect cash balance ($0 instead of $5)
- **Where:** Frame 21 (`21-controls.png`), header bar of the Controls modal.
- **What I see:** The modal title bar displays `$0 | 2030-01-01 (DAY) — Controls`. Across the surrounding screens (Frame 19, Frame 20, and Frame 24), the player's cash balance is consistently `$5`.
- **Why it matters:** Opening the controls screen temporarily shows the player having zero dollars, which can alarm the user into thinking their funds were reset or state was lost. Furthermore, displaying wallet currency in a system/controls rebinding menu is out of place.
- **Suggested fix:** Omit the currency counter from system/controls dialog headers, or pass the active driver's actual wallet balance (`$5`) rather than a default `$0`.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Arena entry and active combat HUD, radar tracking, vehicle orientation, condition gauges, and weapon firing feedback are clean, legible, and properly aligned.
```

---

**Total FINDINGS across batches: 2**
**At least one batch reported nothing to report.**