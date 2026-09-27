# Asset pipeline findings — measured, not assumed

Generated 43 assets via Replicate flux-schnell / flux-1.1-pro (tools/asset-manifest.json).
43/43 succeeded. Raw output: 1024x1024 PNG, ~56 MB total in assets/raw/.

## 1. The chroma key color is NOT #FF00FF

Sprites were prompted with "flat solid pure magenta background". Flux rendered a
DIFFERENT flat color in every image — observed range spans crimson (~#D8394A) through
hot pink (~#F5157B) to near-magenta (~#E8129E).

**Therefore: the key color MUST be sampled per-image from the corner pixels.**
A packer that hardcodes #FF00FF will key nothing and pass the full pink background
through to the atlas. Ground truth lives in `assets/sprite-meta.json` (keyColor per frame).

Despill is mandatory: the sprite edges carry a pink halo that will glow against
dark asphalt if only alpha-keyed.

## 2. Vehicle sprite orientation is inconsistent

Every sprite was prompted "nose pointing UP" and Flux ignored it for most of them.
Verified by direct inspection of `assets/raw/*.png` (2026-09-27 re-verification, after a
shipped bug where every vehicle rendered 90 degrees off — see the `rotationOffsetDeg`
convention below, which the values before that date got wrong):

| sprite           | nose points   | rotationOffsetDeg |
|-------------------|--------------|-------------------|
| car-pickup        | UP           | 270               |
| car-compact       | UP           | 270               |
| cycle-topdown     | UP           | 270               |
| car-subcompact    | DOWN         | 90                |
| car-midsized      | DOWN         | 90                |
| car-van           | DOWN         | 90                |
| car-luxury        | DOWN         | 90                |
| car-kart          | DOWN         | 90                |
| car-stationwagon  | LEFT (landscape frame) | 180     |

`rotationOffsetDeg` is degrees ADDED to the vehicle's simulation heading (0 rad == world
+X, `src/sim/driving.ts`'s forward vector) to get the sprite's render rotation
(`src/app.ts`'s `vehicleSpriteInstance`, `src/ui/city-view.ts`'s player/vehicle
instances). It must rotate the drawn ART so its nose lands on the frame's local +X:
nose art at local +Y (top of frame) needs 270, local -Y (bottom) needs 90, local -X
(left) needs 180, local +X (right) needs 0 — derive this per frame, do not assume "nose
UP means offset 0", which is the bug that shipped every car sideways.

The renderer MUST apply `rotationOffsetDeg` from the atlas manifest per frame.
Identify the front by windshield/wipers/hood/grille/headlights — NOT by the gun, which
is mounted in varying places, and not by a roof panel alone (rear hatch glass and roof
vents can look similar to a windshield; wipers only ever sit at a windshield's base).

## 3. tile-* textures are NOT seamless

Flux does not produce tileable output. `tile-asphalt-cracked` has cracks that run off
the edge and do not wrap; tiling it raw produces a visible grid.

Fix in the packer, pick one and record which:
- 4-way mirror the tile (deterministic, cheap; slight symmetry artifact, acceptable for
  ground texture viewed at speed), or
- offset 50% and heal the seam cross.

## 4. Size budget

56 MB raw vs a 25 MB initial-download budget. Downscale before packing:
tiles 512, vehicles/props 256, fx/decals 256, UI keep larger. Atlas max 4096, 2px padding.

## 5. Quality notes

- `ui-title-art` — excellent, ships as-is, no text baked in as required.
- `ui-hud-frame` — verify no letterforms leaked in; the prompt forbade text but diffusion
  often hallucinates glyphs on instrument panels.
- Vehicle sprites read as slight 3/4 perspective rather than true orthographic. Acceptable
  at 48px game scale, but they are inconsistent with each other — revisit if they clash.

---

## 6. Key by HUE, not by RGB distance (measured, second wave)

Three assets were regenerated on `flux-dev` with much stronger "bird's eye view"
prompting, which fixed the geometry but introduced a new problem: despite the prompt
explicitly forbidding both, flux added **a hard drop shadow and a background gradient**.

Measured corner deviation on the regenerated files:

| frame | maxDeviation | cause |
|---|---|---|
| prop-chainlink-fence | 69 | gradient + shadow |
| cycle-topdown | 59 | gradient + shadow |
| prop-fuel-drum | 55 | gradient + shadow |
| decal-oil-slick | 25 | soft shadow bleed near the puddle |
| (flat sprites) | 2-8 | fine |

An RGB-distance key tight enough to preserve dark vehicle detail will **leave the shadow
in** as a dark halo; loose enough to remove the shadow and it eats black armour plating.

**So: key in HSV by hue band (magenta/pink) with a saturation floor and a value floor.**
Background pixels are high-saturation pink at any lightness; vehicle blacks and greys are
low-saturation at any lightness. That separates them cleanly where RGB distance cannot.
Then despill the remaining edge fringe.

`assets/sprite-meta.json` carries `keyColor` per frame as the hue anchor, plus
`keyColorDeviation` so the packer can widen tolerance per image.

## 7. Regenerated / superseded

- `cycle-topdown` — was a front elevation. Regenerated, now true overhead, nose UP (rot 0).
- `prop-chainlink-fence` — was isometric. Regenerated on `flux-dev` — but the regenerate is
  **still broken, now marked `skip: true`** (measured 2026-09-26): the "chainlink fence" is a
  single bare fence post on a pink background, no mesh anywhere in frame. Chroma-key + auto-crop
  at native 1024x1024 (no downscale involved) bboxes it to 36x1024 — 3.5% of the source width —
  confirming this is the source generation itself having nothing to key out, not a keying
  tolerance problem. Needs a real regenerate; until then it's excluded from the packed atlas the
  same way `fx-explosion-sheet` is.
- `fx-explosion-sheet` — **superseded, marked `skip: true`.** Diffusion grid cells do not
  align reliably enough to slice into an animation. Replaced by five discrete frames,
  `fx-explosion-1` .. `fx-explosion-5`, listed in `sprite-meta.json.explosionFrames`.
- Added `prop-barricade`, `prop-fuel-drum`.

50 frames total carrying metadata; 48 actually packed (`fx-explosion-sheet` and
`prop-chainlink-fence` are `skip: true`).

## 8. Resolved (packer fixes)

- **Section 3 seam choice: 4-way mirror**, not offset+heal. `tools/pack-atlas.mjs`
  downscales every `tile-*` source to a 256px quadrant, then mirrors it into quadrants
  (original / h-flip / v-flip / both) to build the final **512px** tile — this hits the
  section 4 "tiles 512" budget AND makes the tile self-seamless (opposite edges are
  pixel-identical), so a ground shader can `fract()`-wrap the atlas sub-rect directly and
  never needs hardware `GL_REPEAT` or a standalone unshared texture. Verified in
  `tests/unit/atlas.test.ts` (`mirrorQuadrantToSeamlessTile`).
- **Section 6 hue-band key** is now implemented (`chromaKeyToAlpha` in HSV, saturation
  floor + value floor), replacing the RGB-distance key this file originally measured and
  rejected.
- **Section 4 size budget**: vehicles/props/fx/decals now downscale (area/box filter,
  never upscale) to fit 256px on their longest edge post-crop; `ui-*` is left at native
  resolution. That first pass shipped a single 4096x4096 sheet at ~17MB (was 3 sheets, 66MB) —
  still over a sane download budget, so it was tightened again (section 9).
- `rotationOffsetDeg` (section 2) is now carried into `atlas.json` and into
  `AtlasFrameEntry`/`FrameInfo` in `src/render/atlas.ts`.

## 9. Current size budget: 6 MiB, per-kind targets in `tools/atlas-sizes.json`

Every target pixel size in this pipeline lives in `tools/atlas-sizes.json`, not as a literal in
`tools/pack-atlas.mjs` (`loadSizeConfig` reads and validates it; `tests/unit/atlas.test.ts`'s
`loadSizeConfig` describe block exercises every validation branch). Current shipped values, all
downscaled with an area/box filter and never upscaled:

| kind | target | meaning |
|---|---|---|
| `tile` | `quadrantPx: 128` | pre-mirror quadrant; final seamless tile is 256x256 (`TILE_FINAL_PX = quadrantPx * 2`) |
| `car` / `wreck` / `cycle` / `prop` / `fx` / `decal` | `maxPx: 128` | longest edge post-crop |
| `ui` | `maxPx: 128` | longest edge post-crop, **except** `ui.keepNative` (`ui-hud-frame`, `ui-title-art`) which stay at native resolution — full-screen art, not small HUD gauges |

Going from the section-8 256px regime to this 128px regime is the actual downscale that produced
the current shipped atlas: **`assets/atlas-0.png` is a single 4096x4096 sheet, 5,894,855 bytes
(5.62 MiB)** as of 2026-09-26 (48 packed frames — see section 7 for the 2 that are `skip: true`),
comfortably inside a 6 MiB budget.

Two independent guards keep it there:

- **`tests/unit/atlas.test.ts`'s "atlas byte budget" describe block** `statSync`s the actual
  committed `assets/atlas-0.png` (and any sibling sheets `atlas.json` lists) and fails if their
  total exceeds 6 MiB. This is the test that would have caught the 512px-quadrant / 1024px-maxPx
  regression a verifier reintroduced into `tools/atlas-sizes.json` on 2026-09-26 — a ~4x linear
  blowup back to the section-8 ~17MB regime — which the pre-existing tests (asserting
  `TILE_FINAL_PX`/`SPRITE_MAX_PX`, both *sourced from* the same config file) could never catch,
  because they're tautological against whatever the config says.
- **`loadSizeConfig`'s `MAX_CONFIGURABLE_PX` (256) ceiling** in `tools/pack-atlas.mjs` rejects any
  `quadrantPx`/`maxPx` above it the moment the config loads, before anything is repacked. It's
  deliberately coarser than the byte budget — 256px-everywhere passes this ceiling but still packs
  to ~13.8MB (measured), well over 6 MiB — so it catches gross edits (like the 512/1024
  regression) without pretending to guarantee the byte budget on its own; only the on-disk
  byte-budget test does that.

## 10. Phase-4 headroom pass (2026-09-26): four levers combined, target not fully reached

Before Phase 4 (16 city maps + building interiors), section 9's single 4096x4096
`assets/atlas-0.png` sat at **5,930,340 bytes (94.3% of the 6 MiB gate, 353 KB headroom)** — not
enough margin to survive Phase 4's asset growth. Four measurement passes each looked at one lever;
this section is the integration of the ones that actually compose, plus the real repack.

**Levers measured, and the integration decision:**

| lever | verdict | why |
|---|---|---|
| Adaptive per-scanline PNG filtering + `Z_BEST_COMPRESSION` (`encodePNG`) | **kept, composes with everything** | lossless, free (same pixels out), strictly reduces bytes on every sheet regardless of what else runs. No conflict with anything else. |
| Content-group sheet splitting (`CONTENT_GROUPS` / `packFramesByContentGroup`) | **kept** | `tile` (photographic, uniform-height) and everything else (flat-shaded, chroma-keyed, mostly-transparent, variable size) were sharing one shelf-packed sheet; splitting them lets each group's packer converge on its own smallest power-of-two canvas — measured 4096x4096 (16.78M px) down to two 2048x2048 sheets (8.39M px combined). `src/render/atlas.ts` needed no change: it already resolves a frame's UVs against its own sheet's width/height via `manifest.atlases[entry.atlas]`. |
| Per-sheet lossless indexed-PNG fallback (`encodeAtlasSheet`, backed by `tools/quantize.mjs`) | **kept, but measured no-op on the current asset set** | applies automatically per sheet, after the sheet split, and only overrides truecolor when it's a byte-for-byte-identical repaint that comes out smaller — so it cannot conflict with the split, only ride on top of it. Real run: both `atlas-0.png` (40,268 distinct colors) and `atlas-1.png` (387,349 distinct colors, even after the maxPx drop below) are far over PNG's 256-color indexed ceiling, so both sheets fall back to truecolor. Only 1 of 50 frames (`tile-sand`, 220 colors) is indexable in isolation, and PNG's indexed color type is whole-file, not per-frame, so one qualifying frame sharing a sheet with 33+ over-256-color frames buys nothing. Left wired in for future assets that might qualify — it's a correct, zero-cost fallback, not dead weight. |
| `car`/`wreck`/`cycle`/`prop`/`decal` `maxPx` 128 → 96 (`tools/atlas-sizes.json`, measured by `tools/size-report.mjs`) | **kept** | these kinds render 48–96 CSS px on screen (`FLOOR_TILE_SIZE_M=10 * PIXELS_PER_METER_CSS=14` in `src/app.ts`, cross-checked against typical vehicle/prop world size), so every packed frame's longest edge sat ~1.33x above its own display ceiling — genuine, measured waste. `fx`, `ui.maxPx`, and `tile.quadrantPx` were deliberately left alone (see `tools/atlas-sizes.json`'s `_sizingNotes`): `fx` has no sim/render wiring yet to measure a real display size against, `tile` is already close to its on-screen size, and the two `ui.keepNative` frames are full-screen art that isn't oversized for the viewport. |

**Real repack, real measurement** (`node tools/pack-atlas.mjs`, then `stat` on the output — not
estimated):

| sheet | content | frames | bytes |
|---|---|---|---|
| `atlas-0.png` | `tile-*` (terrain) | 16 | 1,828,012 |
| `atlas-1.png` | `car`/`wreck`/`cycle`/`prop`/`fx`/`decal`/`ui` (sprites) | 34 | 3,741,507 |
| **total** | | **50** (+1 `skip: true`, unchanged — see section 7) | **5,569,519** |

| | bytes | % of 6 MiB gate | headroom |
|---|---|---|---|
| before (section 9, single sheet) | 5,930,340 | 94.3% | 353 KB (5.7%) |
| **after (this pass)** | **5,569,519** | **88.5%** | **704 KB (11.5%)** |
| task target | ≤ 3,774,873 | ≤ 60% | ≥ 40% |

Verified alongside the repack: all 50 packable frames still pack (1 `skip: true`,
`fx-explosion-sheet`, unchanged), every frame keeps a numeric `rotationOffsetDeg`, and
`atlas.json`'s `configFingerprint` matches a fresh `fingerprintSizeConfig(loadSizeConfig())`.

**Target not reached. What stands in the way, measured, not guessed:**

`tools/size-report.mjs`'s per-kind rollup (isolated-per-frame compression estimate, calibrated
~2.8x over the real shared-stream sheet — see its printed calibration line) puts `ui-hud-frame` +
`ui-title-art` at **58.4% of estimated sheet bytes on their own**. Both are already correctly
un-shrinkable: `ui.keepNative` full-screen art at native 1344x768, not oversized for a
>=1344px-wide viewport, opaque (no chroma-key transparency to help the indexed-PNG fallback), and
already lossless-encoded via the same `encodePNG` path as everything else. `tile` is the other
31.2%, and it's a 256px final tile against a measured ~140 CSS px/tile display size at zoom 1 (more
at devicePixelRatio > 1) — shrinking it further would visibly soften ground texture, not trim
waste that isn't there.

The one remaining lever that would move the real number — packing `ui-hud-frame` and
`ui-title-art` as two standalone PNGs outside `atlas.json`'s `atlases[]` list, since they're never
frame-batched with sprites and atlasing buys them nothing — requires changing
`tools/pack-atlas.mjs`'s packing loop **and** `src/render/atlas.ts`'s frame resolution. `src/**` is
out of scope for this pass (hard rule), so it is a recommendation, not a change made here.

**Recommendation on the gate:** raising the 6 MiB gate is not needed to unblock Phase 4 today —
this pass alone recovered 704 KB of headroom (2x the pre-pass margin), and Phase 4's 16 city maps
are gameplay/route data (`rulesets/classic/cities.json`), not atlas pixels, so they don't consume
this budget directly. Building-interior *art*, if it adds new `tile`/`prop`/`ui` frames, would.
No page-load cost measurement was taken for a larger gate (out of scope for this pass, and
premature without a concrete interiors asset list to measure against) — that measurement, plus the
`ui-hud-frame`/`ui-title-art` standalone-file change above, is the real next lever if 11.5%
headroom turns out not to be enough once interiors art lands.

---

## 8. The atlas is 60% two images that should not be in it (measured 2026-09-26)

Packed-area share of the single sheet:

| frame | packed | share |
|---|---|---:|
| ui-hud-frame | 1344x768 | 30.4% |
| ui-title-art | 1344x768 | 30.4% |
| all 48 other frames | — | 39.3% |

By kind: ui 61.3%, tile 30.8%, fx 3.3%, car 1.6%, prop 1.2%, decal 1.0%, wreck 0.4%, cycle 0.1%.

**These two are full-screen art and are never batched with sprites.** They are drawn
once, alone, on the title screen and around the combat viewport. An atlas exists to let
many small sprites share one draw call; a full-screen background gains nothing from that
and forces every gameplay frame to load 3.5 MB it will not use.

**THE FIX: take them out of the atlas** and load them as standalone images, on demand —
title art only on the title screen, HUD frame only in combat. Expected result: atlas drops
from ~5.7 MB to ~2.2 MB (35% of budget, ~4 MB headroom), and the two big images load
lazily instead of blocking first paint.

This needs a loader change in src/render/atlas.ts or src/app.ts, which is why it is not
done here — src/ was owned by a concurrent workflow. Do it as a standalone pass.

**Do NOT "fix" this by capping their size instead.** They are the two images a player looks
at longest and least briefly; softening them to save bytes trades visible quality for a
problem that has a free structural answer.

## 9. Why the sheet split was reverted

Splitting terrain from sprites saved 151,218 bytes and shipped a broken game.

src/app.ts fetches only `assets/atlas-0.png` (line ~903), creates one texture, and binds
that single textureView to BOTH the tile and sprite bind groups (~594-596). The split moved
34 of 50 frames onto atlas-1.png, which nothing fetches and which `vite build` did not even
emit. The sprite pass would have sampled the terrain sheet.

tsc, vitest and vite build were ALL GREEN while the game could render 16 of its 50 frames.
The multi-sheet code in tools/pack-atlas.mjs is correct and tested — the missing half is
runtime. Re-splitting requires a texture and bind group per `manifest.atlases` entry, plus a
test asserting every listed sheet is actually fetched.

**Current state: one sheet, 5,726,330 bytes, 91.0% of the 6 MiB budget.** The 128->96 size
audit is kept (204,010 bytes, justified by measured display scale). Compression and paletting
were measured and contributed nothing — adaptive scanline filtering and Z_BEST_COMPRESSION
were already in the baseline, and both sheets have far too many colours to palette
(40,268 and 387,349).
