# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-r3 (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T00:54:49.231Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 1

### 1. Vehicle schematic in constructor is shifted right and clipped by the screen edge
- **Where:** Frames 06 (`06-constructor-empty.png`) and 07 (`07-constructor-built.png`), right panel under `SUBCOMPACT — TOP VIEW`.
- **What I see:** The top-down vehicle schematic is offset heavily to the right. There is roughly 255px of empty padding on the left side of the container (between the left border at x≈1108 and the left bumper at x≈1365), whereas the right side of the vehicle body, the right wheel wells, and internal compartments run directly into and past the right panel border (x≈1918), clipping off the rightmost end of the car.
- **Why it matters:** The schematic is meant to give players a visual blueprint of their vehicle, armor distribution, and weapon mounts. Because the right side is truncated outside the viewport, players cannot see the right bumper or any components/armor indicators placed there.
- **Suggested fix:** Center the vehicle blueprint horizontally within the `SUBCOMPACT — TOP VIEW` container (e.g. `margin: 0 auto`, `justify-content: center`, or adjust the SVG viewBox/translation coordinates) so the 3.8 m vehicle displays fully with balanced margins on both sides.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon Shop menu overflows dialog boundary, clipping items and omitting Leave
- **Where:** Frame 10 (`10-facility-weaponshop.png`), center facility modal
- **What I see:** The weapon list exceeds the vertical height of the modal frame. Items below `0 Install Paint Sprayer` (`Install Oil Jet`, `Install Heavy Rocket`, and `Refill Ammo: Machine Gun`) have no shortcut keys assigned, `Refill Ammo` is bisected by the modal's bottom border, and both the standard `Leave` option and the `ESC — BACK` footer are pushed entirely out of view.
- **Why it matters:** Players cannot cleanly read or hotkey the lowest items, and without an on-screen `Leave` button or visible `ESC` hint, they may not know how to exit the facility if they rely on mouse or numeric navigation.
- **Suggested fix:** Implement scrolling or paginate the shop list (e.g., categorizing into Ballistic / Energy / Dropped / Ammo), assign hotkeys to all entries, and pin the `Leave` option and `ESC — BACK` footer inside the fixed dialog bounds.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 1

### 1. Courier Guild menu overflows dialog, mixes intel into action slots, and omits the Leave button
- **Where:** Frame 16 (`16-facility-courierguild.png`), Courier Guild modal dialog.
- **What I see:** 
  1. Non-actionable route danger and travel estimates ("Route to Albany: danger 1", "Quick route to Atlantic City...") are injected as numbered items (1–7), exhausting hotkeys 1 through 9 and 0 before the player can interact with all contracts.
  2. Entries below '0' ("Accept: bulk propellant...", "Quick route to Scranton...", etc.) have no hotkey numbers assigned.
  3. Unlike every other facility modal (Frames 14, 15, 17, 18), there is no numbered "Leave" option visible, and the bottom `ESC — BACK` hint has been pushed off or omitted due to content overflow against the bottom border.
- **Why it matters:** Players cannot tell actionable delivery contracts from static route intelligence. Keyboard selection breaks for entries past slot 0, and the absence of a visible "Leave" choice breaks modal UX consistency across the town facilities.
- **Suggested fix:** Group delivery offers by destination rather than dumping raw route intel lines into the main action list. Reserve hotkeys solely for actionable contracts/submenus, clamp modal height with a scroll area if needed, and guarantee that "Leave" (and the `ESC — BACK` footer) remains anchored at the bottom.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 2

### 1. Controls menu content overflows modal boundary and clips text
- **Where:** Frame: 21-controls.png, bottom of the central modal container.
- **What I see:** The keybinding list exceeds the vertical space of the modal card. The bottom border cuts directly through `weaponDirect9: Digit9`, any subsequent bindings or reset options are clipped out of view, and the `ESC — BACK` footer present on all other modal overlays (seen in frames 19, 20, and 24) is missing or pushed outside the bounding box. Additionally, numerical shortcut prefixes stop after `0` (for `weaponDirect2`), leaving subsequent rows unnumbered.
- **Why it matters:** Players cannot read or access the bottom controls, the interface looks unfinished, and there is no visual prompt indicating how to dismiss the menu.
- **Suggested fix:** Enable vertical scrolling within the modal body, compact the row spacing, and anchor the `ESC — BACK` footer to the bottom of the card frame.

### 2. Road trip pause menu displays stale city location in header
- **Where:** Frame: 24-road-trip-menu.png, central modal header line.
- **What I see:** The modal header reads `$5 | 2030-01-01 (DAY) — New York`, even though the player is actively driving on the highway, as indicated by the top progress bar (`En route to Albany · 30mi remaining`).
- **Why it matters:** Displaying "New York" in the trip menu misleads the player into thinking they are still in the city or that "Save and quit" / "Abandon trip" will interact with New York rather than the road travel state.
- **Suggested fix:** Dynamically update the header location string while traveling to reflect the road status (e.g., `$5 | 2030-01-01 (DAY) — En Route to Albany` or `On the Road`).
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 1

### 1. Player chevron on North-up radar does not rotate with vehicle heading
- **Where:** Frame 25 (`25-arena-entry.png`) and Frame 26 (`26-arena-combat.png`), bottom-left HUD, `RADAR` display.
- **What I see:** In Frame 25, the vehicle is oriented facing East (right). In Frame 26, the vehicle has turned and is traveling South (down) at 21 mph. In both frames, the teal player marker in the center of the North-up radar is a directional triangle pointing straight North (up).
- **Why it matters:** On a North-up radar, players rely on the player chevron to discern vehicle heading relative to enemy blips. In Frame 26, an opponent located directly South of the player is straight ahead of the car's windshield, but the radar chevron points North, falsely indicating that the target is behind the player.
- **Suggested fix:** Rotate the central player chevron to reflect the vehicle's current orientation angle (e.g., 90° in frame 25, 180° in frame 26), or change the player marker to an omnidirectional circle if heading is not intended to be shown on the radar.
```

---

**Total FINDINGS across batches: 6**
