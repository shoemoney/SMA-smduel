// Fullscreen-triangle post/grade pass. Draws exactly 3 vertices with no
// vertex buffer and no instancing, sampling whatever the sprite/terrain/
// hazard passes composited into `sourceTexture` and writing it back out
// unmodified. This is the identity pass the render loop can always run;
// a future color-grade effect replaces fs_main's body without touching the
// vertex stage, the bind-group shape, or any caller in sprite.ts.
//
// The triangle is oversized on purpose: its three corners sit at (-1,-1),
// (3,-1) and (-1,3) in clip space, so the single triangle fully covers the
// [-1,1]x[-1,1] viewport without a second triangle or a seam down the
// diagonal. UV is derived from clip position with a top-left origin
// (v=1 at the bottom, v=0 at the top), matching sprite.wgsl / tile.wgsl's
// own UV convention.

@group(0) @binding(0) var sourceSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

const FULLSCREEN_TRIANGLE_POSITIONS = array<vec2<f32>, 3>(
  vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let position = FULLSCREEN_TRIANGLE_POSITIONS[vertexIndex % 3u];

  var out: VertexOut;
  out.clipPosition = vec4<f32>(position, 0.0, 1.0);
  out.uv = vec2<f32>((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return textureSample(sourceTexture, sourceSampler, in.uv);
}
