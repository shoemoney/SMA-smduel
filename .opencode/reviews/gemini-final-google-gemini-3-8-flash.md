# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-final (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T02:54:07.209Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Verified tribute, title navigation, driver creation with validation, ignition state, and full constructor loop; UI hierarchy, contrast, schematic updates, and legality feedback are sound and functional.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon Shop menu overflows modal frame and clips content
- **Where:** Frame `10-facility-weaponshop.png`, central facility menu modal.
- **What I see:** The shop inventory exceeds the vertical bounds of the modal container. The final visible item (`Refill Ammo: Machine Gun (FRONT) — $500`) is cut in half horizontally by the modal's bottom border, any subsequent text is clipped out, and the `ESC — BACK` footer present on all other facility dialogs (e.g. Garage, Arena, Salvage, Bar) has been pushed outside the visible frame. Additionally, items listed after index 0 (`Install Oil Jet`, `Install Heavy Rocket`, `Refill Ammo`) lack numeric selection hotkeys.
- **Why it matters:** Players cannot cleanly read or interact with bottom items like ammo refills, keyboard navigation fails past 10 entries, and the clipped text breaks the presentation of an otherwise clean UI.
- **Suggested fix:** Implement a scrollable container with a fixed `max-height`, pin the modal header and `ESC — BACK` footer outside the scroll area, and either paginate long lists or support two-column layouts / letter hotkeys for lists with more than 10 entries.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 1

### 1. Courier Guild menu overflows, drops the Leave/Back controls, and leaves trailing entries unkeyed
- **Where:** Frame 16 (`16-facility-courierguild.png`), center facility modal.
- **What I see:** The modal lists route danger summaries (1–5) followed by expanded route info and contracts (6–0). After shortcut key `0`, three additional rows ("Accept: bulk propellant...", "Quick route to Scranton...", and "Safe route to Scranton...") appear without shortcut keys. Unlike all other facility modals (Medical Center has option 4, Assembly Plant has option 2, Truck Stop has option 0, Federal Building has option 2), there is no "Leave" option anywhere in the list, and the standard `ESC — BACK` footer is missing from the bottom border.
- **Why it matters:** Players cannot select the unkeyed contracts/routes at the bottom via keyboard, and a new player has no explicit on-screen "Leave" button or visible ESC hint to exit the facility dialog.
- **Suggested fix:** Paginate the Courier Guild board or split it into distinct tabs/sub-views (e.g., Select Destination -> View Routes & Contracts). Ensure every selectable item receives an input binding, retain an explicit "Leave" action, and include the standard `ESC — BACK` footer.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 1

### 1. Controls menu list overflows dialog container and truncates keybinds and footer
- **Where:** Frame `21-controls.png`, center modal dialog, bottom edge
- **What I see:** The keybinds list contains 17 items that exceed the vertical height of the modal dialog box. The last visible entry (`weaponDirect9: Digit9`) is cut in half horizontally by the card's bottom border. Additionally, the `ESC — BACK` navigation hint (present at the bottom of the card in frames 19, 20, and 24) is pushed entirely outside the card boundary, and there is no scrollbar or scroll hint.
- **Why it matters:** Players cannot cleanly read the lower bindings or know if further controls exist beyond digit 9. The missing `ESC — BACK` affordance makes it unclear how to dismiss the screen.
- **Suggested fix:** Add vertical scrolling with a scrollbar to the list container, or split the controls into categorized tabs (e.g., Driving vs. Combat), and ensure the `ESC — BACK` footer remains pinned inside the bottom of the modal container.
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Arena entry and combat HUD, controls banner, radar tracking, vehicle status readouts, and combat feedback are all clear, legible, and functional.
```

---

**Total FINDINGS across batches: 3**
**At least one batch reported nothing to report.**