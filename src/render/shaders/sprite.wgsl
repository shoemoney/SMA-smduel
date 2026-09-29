// Instanced sprite shader for the top-down world (vehicles, wrecks, props,
// projectiles, and alpha-decal hazards all share this shader; only the
// pipeline's blend state and the atlas texture/bind group differ per pass).
//
// Instance layout MUST match FLOATS_PER_INSTANCE / INSTANCE_FIELD_FLOAT_OFFSETS
// in src/render/sprite.ts (16 floats / 64 bytes per instance, four vec4<f32>
// slots so every field lands on a 16-byte boundary):
//   transform0: vec4<f32>  xy = world position (m), z = rotation (rad), w = layer
//   transform1: vec4<f32>  xy = size (m, full width/height),
//                            z = shadow softness (0 = not a shadow),
//                            w = shadow opacity multiplier
//   uvRect:     vec4<f32>  x0,y0 = atlas UV top-left, z,w = atlas UV bottom-right
//   tint:       vec4<f32>  r,g,b,a multiply tint
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
  // The instance's atlas UV rect, un-interpolated. The ground path needs the
  // RECT (to wrap inside it with fract()), not the interpolated uv — passing
  // the interpolated value is a real bug: it varies per pixel, so `rect.zw -
  // rect.xy` is a per-pixel delta and every ground pixel samples somewhere
  // arbitrary in the sheet.
  @location(4) uvRect: vec4<f32>,
  // The instance's kind tag, un-interpolated. `transform1.zw` is overloaded
  // between a shadow's (softness, opacity) and a ground quad's (tileMetres,
  // detailScale), so the fragment stage cannot tell them apart by value — a
  // ground quad with a detail scale above 1.0 reads as a shadow. The tag is
  // the only reliable discriminator.
  @location(5) kind: f32,
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
    let falloff = pow(clamp(1.0 - d, 0.0, 1.0), 1.0 + in.params.z * 3.0);
    color = vec4<f32>(0.0, 0.0, 0.0, falloff * in.params.w);
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
    let wuv = in.worldPos / max(in.params.z, 0.001);

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
      // Blend in patches several tiles across rather than per pixel, which
      // would only read as noise. The mask is quantised coarsely on purpose:
      // a fine mask interleaves the two scales at a scale the eye reads as
      // vertical banding, which looked like rain on the road. Coarse patches
      // read as genuinely different ground.
      let cell = floor(wuv * 0.11);
      let m = fract(sin(dot(cell, vec2<f32>(12.9898, 78.233))) * 43758.5453);
      g = mix(g, d, smoothstep(0.30, 0.70, m) * 0.6);
    }
    color = vec4<f32>(g, in.tint.a);
  }

  if (color.a <= 0.001) {
    discard;
  }
  return color;
}
