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
Verified by direct inspection:

| sprite         | nose points | rotationOffsetDeg |
|----------------|-------------|-------------------|
| car-pickup     | UP          | 0                 |
| car-subcompact | DOWN        | 180               |
| car-midsized   | DOWN        | 180               |
| car-van        | DOWN        | 180               |
| car-kart       | DOWN        | 180               |
| (others)       | see sprite-meta.json                |

The renderer MUST apply `rotationOffsetDeg` from the atlas manifest per frame.
Identify the front by windshield/hood/grille/headlights — NOT by the gun, which is
mounted in varying places.

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
- `prop-chainlink-fence` — was isometric. Regenerated.
- `fx-explosion-sheet` — **superseded, marked `skip: true`.** Diffusion grid cells do not
  align reliably enough to slice into an animation. Replaced by five discrete frames,
  `fx-explosion-1` .. `fx-explosion-5`, listed in `sprite-meta.json.explosionFrames`.
- Added `prop-barricade`, `prop-fuel-drum`.

50 frames total, every one carrying metadata.
