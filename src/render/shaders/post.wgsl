// Post/grade pass: a fullscreen triangle reading the composited scene and
// writing a graded image to the swapchain.
//
// This used to be an identity pass that nothing ever compiled. It is now the
// single biggest contributor to how the game looks, because the scene itself is
// flat unshaded quads: the fragment shader in sprite.wgsl is literally
// `sampled * tint`, so there is no lighting, no falloff and no atmosphere
// anywhere in the scene. Everything that reads as "polished" rather than
// "untextured shapes on a plane" has to happen here.
//
// What it does, in order:
//   1. cheap bright-pass bloom (8 wide taps, thresholded) so muzzle flashes,
//      explosions and lit metal bleed light into their surroundings
//   2. filmic-ish tone curve + contrast S-curve
//   3. a warm/cool split-tone, which is what makes flat grey concrete and flat
//      tan dirt read as a graded scene rather than as a texture
//   4. saturation
//   5. vignette
//   6. animated grain, to break up large flat regions of ground
//
// The grade is parameterised through `PostUniforms` so a screen can dial its
// own look (the arena wants a harder vignette than the city) without a second
// pipeline or a shader recompile.

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

struct PostUniforms {
  // xy = composite size in DEVICE pixels, z = time seconds, w = vignette
  // strength. Note these are raw pixels, NOT a reciprocal: the aspect
  // correction and the grain both need real pixel counts. Anything that wants
  // a texel SIZE in UV space must take the reciprocal itself — see `texel`
  // in fs_main, which is exactly the bug this comment now exists to prevent.
  //
  // The comment above this field used to claim "xy = 1/resolution" while the
  // packer (packPostUniforms in src/render/sprite.ts) wrote raw pixels, and
  // `brightPass` was handed the field directly as a UV offset. At 2880x1800
  // that is a radius of (14400, 9000) in UV, which clamp-to-edge collapses to
  // the same border texel on all eight taps: bloom became a constant added to
  // every pixel, or — when the frame edge was dark — a silent no-op. A stale
  // comment about a unit was the whole bug.
  resolutionAndTime: vec4<f32>,
  // x = bloom strength, y = grain amount, z = saturation, w = contrast
  grade: vec4<f32>,
  // x = warm/cool split-tone amount, y = lift, z = global exposure, w = unused
  tone: vec4<f32>,
};

@group(0) @binding(0) var sourceSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PostUniforms;

// ---------------------------------------------------------------------------
// Vertex — fullscreen triangle, no vertex buffer
// ---------------------------------------------------------------------------

struct VertexOut {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  // Oversized triangle covering the whole viewport. Cheaper than a quad
  // (3 vertices, not 6) and free of the diagonal seam a two-triangle quad
  // has when the viewport is not square.
  var corners = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let corner = corners[vertexIndex % 3u];

  var out: VertexOut;
  out.clipPosition = vec4<f32>(corner, 0.0, 1.0);
  // Texture-space is top-left origin; clip space is bottom-left. Without this
  // flip the whole grade pass renders the scene upside down.
  out.uv = vec2<f32>((corner.x + 1.0) * 0.5, (1.0 - corner.y) * 0.5);
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Luminance in Rec.709 weights, which is what the saturation control needs. */
fn luma(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

/** Interleaved-gradient noise: cheap, stable per pixel, no texture needed. */
fn igNoise(pixel: vec2<f32>, frame: f32) -> f32 {
  let p = pixel + vec2<f32>(frame * 13.0, frame * 7.0);
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

/**
 * Cheap 8-tap bright-pass bloom.
 *
 * This is a single-pass approximation, not a real bloom: it samples a ring at
 * one radius and adds back what is above the threshold. A real bloom wants a
 * threshold pass plus a separable blur pyramid, which is three more passes and
 * three more render targets for a game with no HDR target. At the radii that
 * matter here (muzzle flashes and explosions are small and bright against dark
 * ground) one ring reads correctly and costs nine samples instead of dozens.
 */
fn brightPass(uv: vec2<f32>, texel: vec2<f32>) -> vec3<f32> {
  // `texel` is the reciprocal of the resolution, i.e. ONE texel expressed in
  // UV space, so multiplying it by a radius is a UV offset. See the note on
  // `PostUniforms.resolutionAndTime` for what went wrong when this was the
  // raw pixel size instead.
  let radius = texel * 5.0;
  var sum = vec3<f32>(0.0);
  var offsets = array<vec2<f32>, 8>(
    vec2<f32>(1.0, 0.0),
    vec2<f32>(-1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, -1.0),
    vec2<f32>(0.7071, 0.7071),
    vec2<f32>(-0.7071, 0.7071),
    vec2<f32>(0.7071, -0.7071),
    vec2<f32>(-0.7071, -0.7071),
  );
  for (var i = 0u; i < 8u; i = i + 1u) {
    let s = textureSampleLevel(sourceTexture, sourceSampler, uv + offsets[i] * radius, 0.0).rgb;
    // Threshold at roughly the top of the scene's diffuse range so only
    // genuinely bright things (flashes, fire, highlights on metal) bloom.
    let bright = max(s - vec3<f32>(0.62), vec3<f32>(0.0));
    sum = sum + bright;
  }
  return sum * 0.125;
}

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  // Reciprocal of the size in px, giving one texel in UV space. Everything that
  // offsets by a texel (the bloom ring) needs THIS; everything that needs a
  // real pixel count (aspect, grain) reads `.xy` directly and is unaffected.
  let texel = vec2<f32>(1.0) / max(params.resolutionAndTime.xy, vec2<f32>(1.0));
  var color = textureSampleLevel(sourceTexture, sourceSampler, in.uv, 0.0).rgb;

  // 1. bloom
  color = color + brightPass(in.uv, texel) * params.grade.x;

  // 2. exposure, then a filmic tone curve.
  //
  // This started as plain Reinhard (`c / (1 + c)`) and that was a real
  // mistake worth recording: Reinhard maps mid-grey 0.5 down to 0.35, so the
  // entire scene came out roughly a third too dark and every screenshot read as
  // night rather than daylight. The Narkowicz ACES approximation is used
  // instead: it rolls highlights off just as cleanly but keeps mid-tones
  // almost where they were (0.5 -> 0.62), which is what a game whose whole
  // scene is mid-grey concrete and dirt actually needs.
  let acesA = 2.51;
  let acesB = 0.03;
  let acesC = 2.43;
  let acesD = 0.59;
  let acesE = 0.14;
  color = clamp((color * (acesA * color + acesB)) / (color * (acesC * color + acesD) + acesE), vec3<f32>(0.0), vec3<f32>(1.0)) * params.tone.z;

  // 3. contrast S-curve around mid grey, kept gentle so the ground does not
  // crush to black in the shadows.
  color = mix(vec3<f32>(0.5), color, params.grade.w);

  // 4. split-tone: warm the shadows, cool the highlights. This is what stops
  // the scene reading as one flat colour. Strength is signed per channel and
  // weighted by how far the pixel sits from mid grey, so mid-tones are left
  // alone and only the extremes get tinted.
  let midness = 1.0 - abs(luma(color) - 0.5) * 2.0;
  let shadowTint = vec3<f32>(1.06, 0.99, 0.92);
  let highlightTint = vec3<f32>(0.97, 1.0, 1.05);
  color = color * mix(highlightTint, shadowTint, midness * params.tone.x);

  // 5. saturation about luma
  color = mix(vec3<f32>(luma(color)), color, params.grade.z);

  // 6. vignette. Radial, aspect-corrected so it stays circular on a wide
  // viewport instead of stretching into an ellipse, and eased so the centre
  // is genuinely untouched rather than merely dimmed.
  let centred = (in.uv - vec2<f32>(0.5)) * vec2<f32>(params.resolutionAndTime.x / max(params.resolutionAndTime.y, 1.0), 1.0);
  let r = length(centred);
  let vig = 1.0 - params.resolutionAndTime.w * smoothstep(0.32, 0.95, r);
  color = color * vig;

  // 7. grain. Applied last, in a luminance-weighted band so it is visible in
  // the mid-tones (where large flat ground lives) and not in the deep shadows
  // or blown highlights, where it would only read as noise.
  let n = igNoise(in.uv * params.resolutionAndTime.xy, floor(params.resolutionAndTime.z * 24.0)) - 0.5;
  let grainWeight = params.grade.y * (0.35 + 0.65 * (1.0 - abs(luma(color) - 0.5) * 2.0));
  color = color + vec3<f32>(n * grainWeight);

  return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
