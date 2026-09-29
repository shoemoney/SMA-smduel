// Instanced sprite shader for the top-down world (vehicles, wrecks, props,
// projectiles, and alpha-decal hazards all share this shader; only the
// pipeline's blend state and the atlas texture/bind group differ per pass).
//
// Instance layout MUST match FLOATS_PER_INSTANCE / INSTANCE_FIELD_FLOAT_OFFSETS
// in src/render/sprite.ts (20 floats / 80 bytes per instance, five vec4<f32>
// slots so every field lands on a 16-byte boundary):
//   transform0: vec4<f32>  xy = world position (m), z = rotation (rad), w = layer
//   transform1: vec4<f32>  xy = size (m, full width/height),
//                            zw = OVERLOADED, see `extra.x`
//   uvRect:     vec4<f32>  x0,y0 = atlas UV top-left, z,w = atlas UV bottom-right
//   tint:       vec4<f32>  r,g,b,a multiply tint
//   extra:      vec4<f32>  x = SPRITE_KIND tag, yzw = reserved (zero)
//
// `transform1.zw` is overloaded because both consumers fit in two floats, and
// which one is present is decided by `extra.x` — the authoritative tag:
//   kind 0 PLAIN  : zw unused
//   kind 1 SHADOW : z = softness, w = opacity
//   kind 2 GROUND : z = tile metres, w = detail scale
//
// This header said "16 floats / 64 bytes, four slots" and never mentioned
// `extra` at all, while the struct below it had been five slots for some time.
// The field table is the cross-file contract; a stale one silently misleads
// anyone porting between the packer and the shader.
//
// The unit quad (-0.5..0.5 in local space) is expanded procedurally from
// @builtin(vertex_index) — no vertex buffer is bound for this pipeline.

struct Instance {
  transform0: vec4<f32>,
  transform1: vec4<f32>,
  uvRect: vec4<f32>,
  tint: vec4<f32>,
  // x = kind tag (0 plain, 1 shadow, 2 ground), yzw reserved.
  extra: vec4<f32>,
}

struct Camera {
  worldToClip: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(1) var atlasSampler: sampler;
@group(1) @binding(2) var atlasTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) tint: vec4<f32>,
  // xy = the quad's local position in -0.5..0.5, z,w = per-instance extras
  // (see the `params` note in fs_main).
  @location(2) params: vec4<f32>,
  // World-space position, in metres. Only the ground path needs it, but a
  // varying is close to free and it keeps the ground out of the instance
  // format entirely.
  @location(3) worldPos: vec2<f32>,
  // The instance's atlas UV rect. MUST be flat-interpolated: the ground path
  // needs the RECT (to wrap inside it with fract()), not the interpolated uv —
  // passing the interpolated value is a real bug: it varies per pixel, so
  // `rect.zw - rect.xy` becomes a per-pixel delta and every ground pixel
  // samples somewhere arbitrary in the sheet.
  //
  // `@interpolate(flat)` is not an optimisation here, it is a correctness
  // requirement. All three vertices happen to carry the same value, so a
  // smooth interpolation would reproduce it today — but nothing in the
  // language or the pipeline enforces that, and reduced-precision interpolation
  // of a vec4 delta is enough to put the ground's tile UVs slightly wrong.
  @location(4) @interpolate(flat) uvRect: vec4<f32>,
  // The instance's kind tag. `transform1.zw` is overloaded between a shadow's
  // (softness, opacity) and a ground quad's (tileMetres, detailScale), so the
  // fragment stage cannot tell them apart by value — a ground quad with a
  // detail scale above 1.0 reads as a shadow. The tag is the only reliable
  // discriminator, and `fs_main` branches on it by EXACT float equality
  // (`kind == 1.0`, `kind == 2.0`), which only holds if the value is delivered
  // un-interpolated. A tag that drifted off 1.0/2.0 would fall through to the
  // plain-sprite path and draw a ground quad as a raw atlas sub-rect, with no
  // error anywhere.
  @location(5) @interpolate(flat) kind: f32,
}

const UNIT_QUAD_CORNERS = array<vec2<f32>, 6>(
  vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(-0.5, 0.5),
  vec2<f32>(-0.5, 0.5), vec2<f32>(0.5, -0.5), vec2<f32>(0.5, 0.5),
);

const UNIT_QUAD_LOCAL_UV = array<vec2<f32>, 6>(
  vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
  vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let inst = instances[instanceIndex];
  let corner = UNIT_QUAD_CORNERS[vertexIndex % 6u];
  let localUv = UNIT_QUAD_LOCAL_UV[vertexIndex % 6u];

  let rotation = inst.transform0.z;
  let cosR = cos(rotation);
  let sinR = sin(rotation);
  let size = inst.transform1.xy;
  let scaled = corner * size;
  let rotated = vec2<f32>(
    scaled.x * cosR - scaled.y * sinR,
    scaled.x * sinR + scaled.y * cosR,
  );
  let worldPos = inst.transform0.xy + rotated;

  var out: VertexOut;
  out.clipPosition = camera.worldToClip * vec4<f32>(worldPos, 0.0, 1.0);
  out.uv = mix(inst.uvRect.xy, inst.uvRect.zw, localUv);
  out.tint = inst.tint;
  out.params = vec4<f32>(corner, inst.transform1.z, inst.transform1.w);
  out.worldPos = worldPos;
  out.uvRect = inst.uvRect;
  out.kind = inst.extra.x;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let sampled = textureSample(atlasTexture, atlasSampler, in.uv);
  var color = sampled * in.tint;

  // `in.kind` selects the path; `params.zw` carries that path's parameters:
  //
  //   kind 1 (shadow): zw = (softness, opacity)   -- analytic, no texture read
  //   kind 2 (ground): zw = (tileMetres, detailScale)
  //   kind 0 (plain):  sampled * tint
//   kind 3 (graded): zw = (desaturate, tone)  -- unify a mismatched art set
  if (in.kind == 1.0) {
    // --- contact shadow -----------------------------------------------------
    // The scene has no lighting of any kind - this shader is the entire
    // lighting model - so an unshadowed vehicle is a sticker on the ground and
    // reads as a flat blob no matter how good the sprite is. A top-down
    // orthographic camera makes the fix cheap: the shadow is one more
    // alpha-blended quad and its falloff is computed rather than drawn, so it
    // costs no new art and no extra draw call.
    //
    // The texture is deliberately NOT sampled: the falloff is analytic, so a
    // shadow can reuse any frame's UV rect.
    let d = length(in.params.xy) * 2.0;
    // z = 0 is a hard-edged disc, 1 a very soft blob.
    //
    // The BASE is clamped to [0,1] (the classic missing-clamp-before-pow trap);
    // the EXPONENT is not, and it comes straight off an optional public field
    // (`SpriteInstanceInput.shadowSoftness`) with no documented range. Below
    // -1/3 the exponent goes negative and `pow(0.0, negative)` is
    // indeterminate in WGSL, which yields NaN — and NaN fails the `color.a <=
    // 0.001` discard below, because every comparison against NaN is false. The
    // result is a fragment written with a NaN alpha instead of being dropped.
    // Clamping the softness at zero makes the exponent always >= 1.
    let falloff = pow(clamp(1.0 - d, 0.0, 1.0), 1.0 + max(in.params.z, 0.0) * 3.0);
    color = vec4<f32>(0.0, 0.0, 0.0, falloff * max(in.params.w, 0.0));
  } else if (in.kind == 3.0) {
    // --- palette grade -------------------------------------------------------
    // Desaturate, then pull toward the scene's cool slate at the SAME
    // luminance, so the sprite keeps its own light-to-dark modelling and only
    // loses the hue that made it look like it came from somewhere else.
    //
    // This exists because a multiply tint cannot do it. A review of the city
    // said the buildings "look like a collage of unrelated assets" with
    // "varying lighting directions and perspectives", and the suggested fix was
    // exactly this: "apply a unified color grade ... to match the cool, neutral
    // lighting of the ground plane". Multiplying by a cool colour only darkens
    // and shifts; the mismatched saturation survives, because that is the part
    // a multiply cannot touch.
    let lum = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let grey = vec3<f32>(lum);
    color = vec4<f32>(mix(color.rgb, grey, clamp(in.params.z, 0.0, 1.0)), color.a);
    let slate = vec3<f32>(0.44, 0.49, 0.57) * lum;
    color = vec4<f32>(mix(color.rgb, slate, clamp(in.params.w, 0.0, 1.0)), color.a);
  } else if (in.kind == 2.0) {
    // NOTE: every texture read in this branch must be `textureSampleLevel`.
    // `textureSample` requires uniform control flow, and the branch condition
    // is a varying — using it here fails shader validation, which surfaces as
    // an INVALID pipeline and a black screen rather than as a compile error.
    // Level 0 is correct: the atlas has no mip chain (see createAtlasSampler).
    // --- tiled ground -------------------------------------------------------
    // The ground is ONE quad covering the visible area, not a grid of cells.
    // That is the whole fix for the ground reading as tiled wallpaper: with a
    // grid, every cell boundary is a seam, and any per-cell variation - a
    // different texture, a brightness offset - turns that grid visible again.
    // One quad with world-space UVs has no interior boundary at all.
    //
    // `fract()` inside the frame's atlas sub-rect does the wrapping, which is
    // why no repeat sampler is needed: the atlas has no gutters, so a repeat
    // sampler would bleed neighbouring cells into this one.
    let rect = in.uvRect;
    let size = rect.zw - rect.xy;
    // Y is NEGATED here, and that is load-bearing rather than cosmetic.
    //
    // The world convention is X right / Y up (see src/render/camera.ts: world
    // +Y is screen-up), but a UvRect's v axis runs the other way: v1 > v0
    // means increasing `v` walks DOWN the image. So feeding world Y straight
    // into `v` mirrors the ground vertically. Every current GROUND_POOLS frame
    // is deliberately featureless (the pool docs reject `ground-arena-a`
    // precisely because its painted circle is a FEATURE, not a texture), and a
    // mirrored featureless tile is indistinguishable from an unmirrored one —
    // so this has been latent so far. The first ground frame with a lane
    // marking, a drain or a kerb would have come out mirrored.
    //
    // post.wgsl already handles the identical flip for the whole scene
    // ("without this the grade pass renders the scene upside down"), which is
    // why nobody caught it here.
    let wuv = vec2<f32>(in.worldPos.x, -in.worldPos.y) / max(in.params.z, 0.001);

    let base = rect.xy + fract(wuv) * size;
    var g = textureSampleLevel(atlasTexture, atlasSampler, base, 0.0).rgb;

    // Break the repeat by sampling the SAME tile at a second, deliberately
    // non-integer scale and cross-fading on a low-frequency hash. Two scales
    // that do not share a period beat against each other, so the eye stops
    // reading the tile as a grid - and because both samples are world-space
    // `fract()`s there is still no boundary anywhere.
    if (in.params.w > 0.0) {
      let detail = rect.xy + fract(wuv * in.params.w) * size;
      let d = textureSampleLevel(atlasTexture, atlasSampler, detail, 0.0).rgb;
      // Blend in PATCHES rather than per pixel, which would only read as noise.
      //
      // The patch grid is sized in METRES off `worldPos`, not off `wuv`. The
      // previous code used `floor(wuv * 0.11)`, and `wuv` is in TILE units, so
      // each mask cell spanned 1/0.11 = 9.09 tiles — 272m at the arena's 30m
      // tile. A 1440px frame at 30 px/m is only 48m wide, so the whole visible
      // ground covered 0.18 of a mask cell: the mask never changed value on
      // screen, the cross-fade weight was effectively constant, and the
      // "patches" this comment describes simply did not happen. It still looked
      // acceptable because a fixed mix of two non-commensurate scales does break
      // the grid — which is why the bug survived a screenshot review.
      //
      // 9m gives ~5 patches across that same 48m view: coarse enough to read as
      // genuinely different ground, fine enough to be visible without turning
      // into a checkerboard.
      let cell = floor(in.worldPos / 9.0);
      let m = fract(sin(dot(cell, vec2<f32>(12.9898, 78.233))) * 43758.5453);
      g = mix(g, d, smoothstep(0.30, 0.70, m) * 0.6);

    // --- base value ----------------------------------------------------------
    //
    // A review called the ground "harsh, high-contrast pixel noise (a
    // salt-and-pepper effect) ... lacking a solid mid-tone base, creating visual
    // vibration that competes with the vehicle and lane dividers", and asked to
    // "overlay a dark, semi-transparent solid colour to establish a base value".
    //
    // The cause is the SAMPLER, and it cannot be swapped: the ground reads inside
    // an atlas sub-rect, where linear filtering would bleed the neighbouring
    // cell, so it must stay NEAREST (see createAtlasSampler). At the ground's
    // tile scale that means every texel edge is a hard magnified edge, and the
    // eye reads the result as vibration rather than as surface.
    //
    // So the fix is a base value rather than a different filter: compressing the
    // sample toward a mid-grey pulls the extremes in without touching the
    // structure, the tiling, or the sampler. The texture still reads as the same
    // cracked concrete; it simply stops competing with the car for attention,
    // which was the actual complaint. Measured on the captured frames, this is a
    // ~30% reduction in ground luma spread.
    g = mix(vec3<f32>(0.40, 0.42, 0.46), g, 0.70);
    }
    // The ground takes the tint's RGB too. It used to keep only `tint.a`, which
    // silently dropped any tint the caller supplied — dormant only because
    // every current ground caller passes white, which is the same failure shape
    // as the `extra.x` tag that was added to stop ground quads being mistaken
    // for shadows: an input the public type declares and the shader ignores.
    // A night grade, a capture-zone tint, or a desaturation all read as "no
    // effect" until someone debugs the shader.
    color = vec4<f32>(g * in.tint.rgb, in.tint.a);
  }

  if (color.a <= 0.001) {
    discard;
  }
  return color;
}
