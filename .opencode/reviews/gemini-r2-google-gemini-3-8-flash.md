# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-r1 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T00:21:32.349Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 1

### 1. Vehicle schematic is clipped on the right edge of the constructor viewport
- **Where:** Frames `06-constructor-empty.png` and `07-constructor-built.png`, center-right panel (`SUBCOMPACT — TOP VIEW`).
- **What I see:** The vehicle blueprint is offset too far to the right. The front section of the subcompact—including the front wheels, hood compartment, and front bumper—is clipped by the right edge of the panel container, while significant empty space remains on the left side of the panel.
- **Why it matters:** The schematic is meant to display vehicle facing, armour layers, and mounted weapons. With the front ~30% cut off, the player cannot see the front bumper or inspect front-mounted equipment, and the UI looks misaligned.
- **Suggested fix:** Center the vehicle graphic within the `SUBCOMPACT — TOP VIEW` container (or adjust the SVG `viewBox` / padding) so the full vehicle profile fits cleanly inside the panel borders.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon shop menu overflows dialog box and cuts off items and the Leave option
- **Where:** Frame 10 (`10-facility-weaponshop.png`), central facility menu modal.
- **What I see:** The weapon shop's item list is taller than the modal container. Items past 0 ("Install Oil Jet", "Install Heavy Rocket", and "Refill Ammo: Machine Gun") lack shortcut digits, and "Refill Ammo: Machine Gun (FRONT) — $500" is cut in half horizontally by the modal's bottom border. The standard "Leave" option (seen in all other facility screens) is pushed entirely outside the visible container.
- **Why it matters:** A player cannot see the full inventory or the exit button, and the text collision with the container border breaks UI polish.
- **Suggested fix:** Make the option list scrollable (`overflow-y: auto`) or categorize the shop (e.g., Weapons / Droppers / Ammo), keep the "Leave" action pinned to a fixed modal footer or ensure Esc is clearly prompted, and handle keyboard shortcuts for lists exceeding 10 items.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 1

### 1. Courier Guild menu overflows keybindings and lacks an exit option
- **Where:** Frame 16 (`16-facility-courierguild.png`), Courier Guild central modal dialog.
- **What I see:** The modal lists options numbered 1 through 9 and 0, followed by three additional rows (`Accept: bulk propellant...`, `Quick route to Scranton...`, `Safe route to Scranton...`) that have no hotkey numbers. Furthermore, unlike every other facility screen (which explicitly provides a numbered "Leave" button), there is no "Leave" option anywhere in the dialog.
- **Why it matters:** Players relying on numeric keyboard controls cannot select the unnumbered contracts/routes, and there is no obvious, legible way to exit the building back to the city hub.
- **Suggested fix:** Reorganize the Courier Guild UI so contract details (route distance, danger, encounters) appear in an inspection/details pane rather than consuming main menu slots. Ensure all actionable items have proper inputs, and provide an explicit "Leave" action mapped to a standard key (e.g., `Esc` or a numbered slot like `0` or `L`).
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 2

### 1. Controls menu overflows viewport and clips keybindings / exit action
- **Where:** Frame 21-controls.png, bottom of the screen
- **What I see:** The Controls modal is taller than the viewport and extends past the bottom edge of the frame. The last visible line (`weaponDirect9: Digit9`) is cut in half horizontally by the screen boundary. There is no scrollbar, subsequent keybindings are cut off, and unlike the other modals (Fleet's "Leave", Journal's "Close Journal"), there is no visible "Close" or "Back" button.
- **Why it matters:** Players on standard display resolutions cannot read the full set of keybindings or access an explicit button to exit the menu.
- **Suggested fix:** Set a maximum height (`max-height: 80vh` or similar) with `overflow-y: auto`, and ensure an explicit "Close / Back" option remains pinned or visible within the modal.

### 2. Trip menu placed directly over the Radar HUD
- **Where:** Frame 24-road-trip-menu.png, bottom-left screen corner
- **What I see:** The in-drive Trip Menu is positioned in the lower-left corner instead of being centered, directly overlaying the Radar widget. The radar's title ("RADAR") and bottom label ("Orientation: north-up") are partially occluded behind the menu container.
- **Why it matters:** The placement is inconsistent with the other modal dialogues (Fleet and Journal are both cleanly centered) and unnecessarily collides with active HUD instrumentation while the rest of the screen is open.
- **Suggested fix:** Center the Trip Menu modal in the viewport to match the Journal and Fleet overlays, keeping the Radar HUD legible.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 2

### 1. Radar status label wraps with an awkward hyphen
- **Where:** Frame 25 and Frame 26, bottom-left Radar panel, bottom text.
- **What I see:** The status line reads `Orientation: north-` on the first line and `up` on the second line.
- **Why it matters:** The radar container is slightly too narrow for the 22-character string "Orientation: north-up", forcing an automatic hyphenated wrap that orphans "up" on its own line and degrades an otherwise crisp, modern HUD.
- **Suggested fix:** Either widen the radar container by a few pixels or shorten the label (e.g., `Radar: North-up` or `Heading: North-up`) so the full descriptor renders cleanly on one line.

### 2. Radar player marker does not reflect vehicle heading
- **Where:** Frame 25, center arena view vs. bottom-left Radar panel.
- **What I see:** In Frame 25, the player car is oriented East (facing 90° right), but the cyan player marker in the center of the radar is an upward-pointing triangle (facing 0° North). In Frame 26, when the vehicle faces North, the marker also points North.
- **Why it matters:** On a North-up tactical display, an arrow- or triangle-shaped player icon conveys heading. Pointing North while the vehicle is aimed East misleads the player regarding which way their vehicle and forward-mounted weapons (`^ Machine Gun`) are directed relative to surrounding radar contacts.
- **Suggested fix:** Bind the radar player icon's rotation transform directly to the player vehicle's facing angle so the marker reflects current heading even when stationary.
```

---

**Total FINDINGS across batches: 7**
