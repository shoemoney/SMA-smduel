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
