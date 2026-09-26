// Instanced terrain-tile shader for the top-down world. Shares the exact
// instance layout of sprite.wgsl (see src/render/sprite.ts,
// FLOATS_PER_INSTANCE / INSTANCE_FIELD_FLOAT_OFFSETS), but reinterprets the
// uvRect slot as an origin + repeat count so a tileable texture repeats
// seamlessly across a large terrain quad instead of stretching one atlas cell:
//   transform0: vec4<f32>  xy = world position (m) of the tile quad centre, z = rotation (rad, normally 0), w = layer
//   transform1: vec4<f32>  xy = size (m, full width/height of the tile quad), zw = reserved
//   uvRect:     vec4<f32>  xy = uv origin (normally 0,0), zw = repeat count (world size / texture world size)
//   tint:       vec4<f32>  r,g,b,a multiply tint (normally 1,1,1,1)
//
// IMPORTANT: atlasSampler must be created with addressModeU/V = "repeat".
// The local UV is scaled by the repeat count BEFORE sampling, so once it
// exceeds [0,1] the repeat address mode wraps it — that wrap is what makes
// the texture tile without a seam at the tile-quad edges.

struct Instance {
  transform0: vec4<f32>,
  transform1: vec4<f32>,
  uvRect: vec4<f32>,
  tint: vec4<f32>,
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

  // Tiles never rotate in practice, but honor transform0.z anyway so the
  // vertex path is identical in shape to sprite.wgsl.
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
  let uvOrigin = inst.uvRect.xy;
  let repeatCount = inst.uvRect.zw;
  out.uv = uvOrigin + localUv * repeatCount;
  out.tint = inst.tint;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let sampled = textureSample(atlasTexture, atlasSampler, in.uv);
  return sampled * in.tint;
}
