// Instanced sprite shader for the top-down world (vehicles, wrecks, props,
// projectiles, and alpha-decal hazards all share this shader; only the
// pipeline's blend state and the atlas texture/bind group differ per pass).
//
// Instance layout MUST match FLOATS_PER_INSTANCE / INSTANCE_FIELD_FLOAT_OFFSETS
// in src/render/sprite.ts (16 floats / 64 bytes per instance, four vec4<f32>
// slots so every field lands on a 16-byte boundary):
//   transform0: vec4<f32>  xy = world position (m), z = rotation (rad), w = layer
//   transform1: vec4<f32>  xy = size (m, full width/height), zw = reserved
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
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let sampled = textureSample(atlasTexture, atlasSampler, in.uv);
  let color = sampled * in.tint;
  if (color.a <= 0.001) {
    discard;
  }
  return color;
}
