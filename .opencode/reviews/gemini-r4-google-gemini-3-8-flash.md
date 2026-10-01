# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-r4 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T01:27:12.557Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Boot tribute, title navigation, driver creation with validation states, and constructor build workflow are visually polished, legible, and mechanically sound.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon shop facility menu overflows modal frame and clips content
- **Where:** Frame `10-facility-weaponshop.png`, central modal window.
- **What I see:** The weapon shop item list exceeds the vertical space of the modal dialog. The final item ("Refill Ammo: Machine Gun (FRONT)") has its cost text (`$500` / `Costs $500, you have $5.`) sliced horizontally in half by the modal's bottom border. Additionally, the items beyond item 0 lack numeric hotkey assignments, and the `ESC — BACK` footer navigation hint (present at the base of the dialog in Frames 09, 11, 12, and 13) has been pushed out of the frame or occluded.
- **Why it matters:** Content clipping through window borders looks unfinished. Truncating the final action hides cost/status details, removes the keyboard shortcut scheme used across the rest of the menu, and obscures the back/exit prompt.
- **Suggested fix:** Constrain the menu content area with a scrollable container (or sub-tabs for Weapons vs. Ammo/Accessories) with internal overflow clipping, while anchoring the `ESC — BACK` footer securely above the bottom border.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 1

### 1. Courier Guild menu overflows panel, clips footer, and runs out of hotkeys
- **Where:** Frame 16 (`16-facility-courierguild.png`), central Courier Guild modal dialog.
- **What I see:** The modal lists 13 separate text entries. Key bindings count from `1` through `9` and `0` (Safe route to Providence). The three items below `0` (`Accept: bulk propellant...`, `Quick route to Scranton...`, and `Safe route to Scranton...`) have no assigned number key or cursor selector. Additionally, the list overflows the container: the text collides with the bottom border, and the `ESC — BACK` footer / dedicated `Leave` menu item present on every other facility screen (Frames 14, 15, 17, 18) is completely pushed out or missing.
- **Why it matters:** Players cannot select jobs or routes below option `0` via number keys, and the lack of a visible `Leave` action or `ESC — BACK` affordance makes the menu feel broken and trap-like compared to all other facilities.
- **Suggested fix:** Paginate the job board, add a scroll container with scrollbar, or split Courier Guild into distinct submenus (e.g., "Review Route Intel" vs "Available Courier Contracts"). Ensure every entry has a valid selector and that the bottom padding, `Leave` option, and `ESC — BACK` prompt remain visible.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 2

### 1. Controls menu content overflows modal boundary and clips exit footer
- **Where:** Frame 21 (`21-controls.png`), bottom of the central modal dialog.
- **What I see:** The keybinding list exceeds the vertical bounds of the dialog card. The entry `weaponDirect9: Digit9` is cut in half horizontally by the card's bottom border, and the standard navigation footer (`ESC — BACK`, present on frames 19, 20, and 24) is completely clipped outside the frame.
- **Why it matters:** Players cannot read the full keybind mapping or see the standard exit prompt, making the controls screen look broken and trapped.
- **Suggested fix:** Make the keybind container scrollable or paginate it, and anchor the `ESC — BACK` footer to the bottom of the modal card outside the scroll area.

### 2. Vehicle spawns perpendicular to the highway orientation
- **Where:** Frame 22 (`22-road.png`) and Frame 23 (`23-road-driving.png`), center screen.
- **What I see:** The highway is laid out horizontally East-to-West (solid white fog lines, yellow dashed center line, and shoulder bollards all run horizontally). However, the car spawns facing 0° North (perpendicular to traffic). When the player presses the forward key (`W` / Up arrow), the vehicle immediately drives straight off the road into the ditch, triggering the off-road penalty warning (`▼ Road — 4 m` in Frame 23) while registering 0.0 miles of travel.
- **Why it matters:** New players following the on-screen prompt (`WASD / arrows to drive`) intuitively accelerate forward and immediately run off the road, incurring penalties or confusion before their journey begins.
- **Suggested fix:** Align the car's initial heading with the roadway (facing East / along the travel lane) upon spawning into road transit.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Arena entry and combat HUD, controls hint, radar tracking, condition panel, and message stacking were reviewed and found sound.
```

---

**Total FINDINGS across batches: 4**
**At least one batch reported nothing to report.**