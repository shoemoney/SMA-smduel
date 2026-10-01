# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-r1 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-09-30T23:55:58.244Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 1

### 1. Vehicle schematic is shifted right and truncated at the container boundary
- **Where:** Frame 06 (`06-constructor-empty.png`) and Frame 07 (`07-constructor-built.png`), right panel, inside the `SUBCOMPACT — TOP VIEW` schematic container.
- **What I see:** The top-down vehicle wireframe is horizontally misaligned. There is substantial empty margin on the left side of the container, while the right side of the car extends past the container's right border and is clipped. As a result, the entire front of the car—including the front bumper/nose, front armor outline, and the forward portion of both front wheel wells—is cut off and invisible.
- **Why it matters:** The constructor schematic is the player's primary visual feedback when customizing a vehicle. Because the front quarter of the car is clipped off-screen, players cannot see front armor allocations or front-mounted weaponry, making the constructor UI look broken.
- **Suggested fix:** Center the vehicle schematic asset within the schematic container (adjusting the canvas/SVG `viewBox` or centering transform) so the entire chassis—from front bumper to rear bumper—fits comfortably within the card's borders.
```

## Batch 2 — the city and all ten facilities

```
FINDINGS: 1

### 1. Weapon Shop menu overflows modal dialog, clipping items and cutting off "Leave"
- **Where:** Frame `10-facility-weaponshop.png`, bottom of the center modal dialog.
- **What I see:** The item list exceeds the fixed height of the modal window. Items past key `0` ("Install Oil Jet", "Install Heavy Rocket") lack numeric shortcuts, and the final item ("Refill Ammo: Machine Gun (FRONT) — $500") is visually bisected and clipped by the bottom border of the frame. The standard "Leave" option present in all other facility menus (e.g. Garage, Arena, Salvage, Bar) is missing or pushed entirely outside the visible container.
- **Why it matters:** Players cannot cleanly read ammo refill costs or see how to exit the Weapon Shop menu cleanly without guessing keybinds (e.g., ESC or scrolling). If a user relies on keyboard shortcuts, items beyond `0` have no designated hotkey visible.
- **Suggested fix:** Add internal vertical scrolling (or paginate weapon purchases into categories such as Ballistic / Energy / Droppers / Ammo) and ensure the "Leave" action remains pinned or visible at the bottom with a defined shortcut.
```

## Batch 3 — driving and fighting (road, trip menu, arena match, plus the overlays)

```
FINDINGS: 3

### 1. Controls menu content overflows modal container and is clipped
- **Where:** Frame 21-controls.png, bottom edge of the central modal.
- **What I see:** The keybinding list extends past the bottom border of the dialog box. Row `weaponDirect9: Digit9` is sliced in half by the container's bottom border, and any subsequent key entries are completely hidden with no scrollbar.
- **Why it matters:** Players cannot read or configure bindings located at the bottom of the list.
- **Suggested fix:** Add `overflow-y: auto` with a themed scrollbar or expand the modal's max-height to fit the complete binding list.

### 2. Typo in control binding label ("driverRight")
- **Where:** Frame 21-controls.png, line item 5 in the controls list.
- **What I see:** The row label reads `driverRight: KeyD, ArrowRight`, whereas lines 2, 3, and 4 read `driveUp`, `driveDown`, and `driveLeft`.
- **Why it matters:** The extraneous 'r' is an obvious typo that disrupts the naming convention of the primary movement keys.
- **Suggested fix:** Rename `driverRight` to `driveRight`.

### 3. Radar orientation text awkwardly wraps across lines
- **Where:** Frame 22-road.png, bottom-left RADAR HUD widget.
- **What I see:** The orientation status at the bottom of the panel wraps after the hyphen: line 1 displays `Orientation: north-` and line 2 displays `up`.
- **Why it matters:** An awkward two-line split of a single compound descriptor looks unpolished on an otherwise clean HUD.
- **Suggested fix:** Change the text to `Orientation: North-Up` with `white-space: nowrap`, or widen the card padding slightly so the full phrase fits on one line.
```

---

**Total FINDINGS across batches: 5**
