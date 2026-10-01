# OpenDuel advisory review — google/gemini-3.8-flash

- Frames: .shots/e2e-post (26 PNGs, 2560x1600)
- Model: `google/gemini-3.8-flash`
- Date: 2026-10-01T17:20:58.730Z

## Batch 1 — the opening and the build (title, driver creation, ignition crank, constructor)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked title flow, driver creation, error states, and vehicle constructor layouts across all frames; typography, visual hierarchy, input affordances, and schematic readouts are polished and sound.
```

## Batch 2 — the city and the first five facilities

```
FINDINGS: 1

### 1. Weapon Shop menu list vertically clips the last visible row against the footer
- **Where:** Frame 10 (`10-facility-weaponshop.png`), bottom edge of the modal dialog above the footer hint.
- **What I see:** The final visible row (`Refill Ammo: Machine Gun (FRONT) — Costs $500, you have...`) is sliced horizontally through the lower half of its glyphs by the footer container border.
- **Why it matters:** Truncating text mid-letter looks visually broken and unpolished. It makes the row hard to read and obscures whether further details or options lie beneath without scrolling.
- **Suggested fix:** Add bottom margin/padding to the scrollable list container (or adjust the modal window's height) so rows remain fully clear of the footer bar when scrolled to that position.
```

## Batch 3 — the remaining five facilities

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked all five facilities (Medical, Assembly, Courier Guild, Truck Stop, Federal Building); layout, affordances, hotkeys, and disabled states with explanatory text are consistent and legible.
```

## Batch 4 — driving (road, the trip menu, and the overlays)

```
FINDINGS: 2

### 1. Controls menu header displays incorrect cash balance ($0 instead of $5)
- **Where:** Frame 21 (`21-controls.png`), top header bar of the Controls modal.
- **What I see:** The header reads `$0 | 2030-01-01 (DAY) — Controls`. In the immediately preceding and succeeding frames (Frames 19, 20, and 24), the player's wallet balance is consistently `$5`.
- **Why it matters:** Displaying `$0` creates player panic that their money was lost or wiped when opening settings, caused by the Controls view not receiving the active player state and defaulting cash to zero. Furthermore, a settings/keybindings screen generally does not need in-game currency displayed in its header.
- **Suggested fix:** Pass the active player state into the Controls view header so it reflects the correct cash balance, or suppress the currency display in the header for system/configuration screens.

### 2. Informational empty-state lines in Journal are formatted as numbered interactive menu choices
- **Where:** Frame 20 (`20-journal.png`), center modal.
- **What I see:** The two status lines reading `"You aren't carrying any courier work right now."` and `"No campaign leads uncovered yet."` are assigned numeric prefixes `1` and `2`, identical to the numbered buttons used throughout the game for hotkey-driven menu options. The only selectable option is `3 Close Journal`.
- **Why it matters:** Players using number hotkeys (1-9) or scanning the UI will treat `1` and `2` as interactive courier or campaign entries, pressing them and expecting action rather than recognizing them as passive empty-state placeholders.
- **Suggested fix:** Remove numeric hotkey badges (`1`, `2`) from informational/empty-state text rows, styling them as dimmed non-interactive descriptions, and reserve numeric badges strictly for selectable actions (e.g., making `1 Close Journal`).
```

## Batch 5 — fighting (an arena match, entry and combat)

```
FINDINGS: 0
NOTHING_TO_REPORT: Checked arena HUD layout, combat messaging, radar blips, condition monitors, vehicle presentation, and control legibility across entry and combat; all elements are clear, properly aligned, and functional.
```

---

**Total FINDINGS across batches: 3**
**At least one batch reported nothing to report.**