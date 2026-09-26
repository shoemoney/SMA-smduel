/**
 * Instanced sprite renderer for the top-down world.
 *
 * ZERO GAMEPLAY LOGIC: this module consumes a read-only render snapshot
 * (`SpriteInstanceInput[]`) that some other layer has already derived from
 * simulation state; it never mutates world state, imports nothing from
 * sim/** or rulesets/**, and contains no RNG and no damage/hit/movement
 * math. It draws ONE instanced draw call per atlas per layer, expanding a
 * procedural unit quad per instance entirely in the vertex shader (see
 * sprite.wgsl / tile.wgsl) — no per-sprite vertex buffer is needed.
 *
 * Byte layout (must match the WGSL `Instance` struct in sprite.wgsl and
 * tile.wgsl exactly): 16 floats / 64 bytes per instance, laid out as four
 * vec4<f32> slots so every field lands on the 16-byte boundary WGSL struct
 * rules require:
 *
 *   float offset | field       | meaning
 *   ------------ | ----------- | -------------------------------------------
 *   0..3         | transform0  | xy = world position (m), z = rotation (rad), w = layer
 *   4..7         | transform1  | xy = size (m, full width/height), zw = reserved
 *   8..11        | uvRect      | x0,y0 = atlas UV top-left, z,w = atlas UV bottom-right
 *                |             | (tile.wgsl instead reads zw as a repeat count)
 *   12..15       | tint        | r,g,b,a multiply tint
 *
 * `layer` (transform0.w) is written into the packed buffer for shader-side
 * debugging/future use only — neither sprite.wgsl nor tile.wgsl reads it, and
 * this pipeline has no depth buffer. Cross-atlas z-order is instead decided
 * entirely on the CPU by `buildFrameInstanceBuffers`, which buckets visible
 * instances by ascending `layer` and emits one packed buffer per (layer,
 * atlas) pair in that order — a plain painter's algorithm. That is the
 * correct approach here regardless: the hazard layer blends with alpha, and
 * alpha blending is order-dependent, so a depth test alone could not replace
 * it even if one were added.
 */

export interface Vec2M {
  readonly x: number;
  readonly y: number;
}

/** Atlas UV rect: top-left (u0,v0) to bottom-right (u1,v1), in [0,1]. */
export interface UvRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export interface Tint {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** One renderable instance: a vehicle, wreck, prop, projectile, terrain tile, or hazard decal. */
export interface SpriteInstanceInput {
  /** Which atlas texture this instance samples from; instances are grouped and drawn one call per atlas. */
  readonly atlasId: string;
  /** World-space position in meters. For a tile, the centre of its quad. */
  readonly position: Vec2M;
  readonly rotationRad: number;
  /** Full width/height of the quad, in meters. */
  readonly sizeM: Vec2M;
  readonly uvRect: UvRect;
  readonly tint: Tint;
  /**
   * Draw-order bucket: `buildFrameInstanceBuffers` groups visible instances by
   * ascending `layer` and draws each bucket's atlases in that order, so a
   * higher `layer` always paints over a lower one regardless of position or
   * atlas (a CPU-side painter's algorithm — no depth buffer is involved).
   * Instances sharing one `layer` and `atlasId` draw in their relative input
   * order; nothing beyond that is guaranteed within a bucket.
   */
  readonly layer: number;
}

export const FLOATS_PER_INSTANCE = 16;
export const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

/** Float (not byte) offset of each field's first component within one packed instance. */
export const INSTANCE_FIELD_FLOAT_OFFSETS = {
  transform0: 0,
  transform1: 4,
  uvRect: 8,
  tint: 12,
} as const;

/**
 * Packs instances into the documented Float32Array layout, one call's worth
 * of instances at a time (typically all instances for one atlas in one
 * layer, per the one-draw-call-per-atlas-per-layer requirement).
 */
export function packInstances(instances: readonly SpriteInstanceInput[]): Float32Array<ArrayBuffer> {
  const out = new Float32Array(instances.length * FLOATS_PER_INSTANCE);
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i]!;
    const base = i * FLOATS_PER_INSTANCE;
    out[base + 0] = inst.position.x;
    out[base + 1] = inst.position.y;
    out[base + 2] = inst.rotationRad;
    out[base + 3] = inst.layer;
    out[base + 4] = inst.sizeM.x;
    out[base + 5] = inst.sizeM.y;
    out[base + 6] = 0;
    out[base + 7] = 0;
    out[base + 8] = inst.uvRect.u0;
    out[base + 9] = inst.uvRect.v0;
    out[base + 10] = inst.uvRect.u1;
    out[base + 11] = inst.uvRect.v1;
    out[base + 12] = inst.tint.r;
    out[base + 13] = inst.tint.g;
    out[base + 14] = inst.tint.b;
    out[base + 15] = inst.tint.a;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CPU-side culling.
// ---------------------------------------------------------------------------

export interface AabbM {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function boundingRadiusM(inst: SpriteInstanceInput): number {
  // Half-diagonal of the (possibly rotated) quad — a conservative bound that
  // never falsely culls a visible instance regardless of its rotation.
  return Math.hypot(inst.sizeM.x, inst.sizeM.y) / 2;
}

function instanceAabb(inst: SpriteInstanceInput): AabbM {
  const r = boundingRadiusM(inst);
  return {
    minX: inst.position.x - r,
    maxX: inst.position.x + r,
    minY: inst.position.y - r,
    maxY: inst.position.y + r,
  };
}

function aabbOverlaps(a: AabbM, b: AabbM): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export interface CullResult {
  readonly visible: readonly SpriteInstanceInput[];
  readonly visibleCount: number;
  readonly totalCount: number;
}

/**
 * Culls `instances` down to those whose AABB overlaps `bounds` (the
 * camera's visible world bounds), via a single linear scan that preserves
 * the surviving instances' relative order from `instances`.
 *
 * This used to be a uniform-grid spatial hash rebuilt from scratch on every
 * call. That is the wrong shape of optimization for a "build once, query
 * once per frame" call site: a fresh grid costs at least one hash-map insert
 * per instance-cell pair before a single query can run, so it can only ever
 * lose to the O(n) scan it was meant to beat — measured ~200x slower in this
 * repo's own benchmark (5000 sprites + 400 tiles: ~25ms for the grid path vs
 * ~0.1ms for this scan, against a 16.67ms/frame budget at 60Hz). A grid also
 * pathologically overallocates for any large instance: one 2000m tile at a
 * 16m cell size inserts into ~31,000 cells. A spatial index only earns its
 * keep when it is built once and queried MANY times per build; that is not
 * this function's contract, so it does not use one.
 */
export function cullInstances(instances: readonly SpriteInstanceInput[], bounds: AabbM): CullResult {
  const visible: SpriteInstanceInput[] = [];
  for (const inst of instances) {
    if (aabbOverlaps(instanceAabb(inst), bounds)) visible.push(inst);
  }
  return { visible, visibleCount: visible.length, totalCount: instances.length };
}

/** Groups instances by atlas so the caller can issue one instanced draw call per atlas, in insertion order of first appearance. */
export function groupByAtlas(instances: readonly SpriteInstanceInput[]): ReadonlyMap<string, SpriteInstanceInput[]> {
  const groups = new Map<string, SpriteInstanceInput[]>();
  for (const inst of instances) {
    const bucket = groups.get(inst.atlasId);
    if (bucket) bucket.push(inst);
    else groups.set(inst.atlasId, [inst]);
  }
  return groups;
}

export interface AtlasInstanceBuffer {
  readonly atlasId: string;
  /** The draw-order bucket this buffer belongs to; see `SpriteInstanceInput.layer`. */
  readonly layer: number;
  readonly data: Float32Array<ArrayBuffer>;
  readonly instanceCount: number;
}

export interface FrameInstanceBuffers {
  /**
   * One entry per (layer, atlasId) pair, ALREADY IN THE ORDER THE APP MUST
   * DRAW THEM to get correct z-order: ascending by `layer` first, then in
   * order of each atlas's first appearance within that layer. Draw this
   * array front-to-back exactly as given — do not re-sort or re-group it.
   */
  readonly atlases: readonly AtlasInstanceBuffer[];
  readonly visibleCount: number;
  readonly totalCount: number;
}

/**
 * Culls `instances` against `bounds`, buckets the survivors by ascending
 * `layer` (a stable sort, so instances sharing a layer keep their relative
 * input order), groups each layer's bucket by atlas, and packs every
 * (layer, atlas) group into the documented Float32Array layout.
 *
 * This is the one CPU-side entry point a frame loop needs before uploading
 * to the GPU and calling the per-layer encode functions below: off-screen
 * instances never reach a packed buffer, and the returned `atlases` order
 * IS the draw order — see `FrameInstanceBuffers.atlases`.
 */
export function buildFrameInstanceBuffers(instances: readonly SpriteInstanceInput[], bounds: AabbM): FrameInstanceBuffers {
  const culled = cullInstances(instances, bounds);
  // Array.prototype.sort is stable (guaranteed since ES2019): instances that
  // share a layer keep their relative order from `culled.visible`.
  const byLayer = [...culled.visible].sort((a, b) => a.layer - b.layer);

  const atlases: AtlasInstanceBuffer[] = [];
  let runStart = 0;
  for (let i = 0; i <= byLayer.length; i++) {
    const runEnds = i === byLayer.length || byLayer[i]!.layer !== byLayer[runStart]!.layer;
    if (!runEnds) continue;
    if (i > runStart) {
      const layer = byLayer[runStart]!.layer;
      const groups = groupByAtlas(byLayer.slice(runStart, i));
      for (const [atlasId, group] of groups) {
        atlases.push({ atlasId, layer, data: packInstances(group), instanceCount: group.length });
      }
    }
    runStart = i;
  }

  return { atlases, visibleCount: culled.visibleCount, totalCount: culled.totalCount };
}

// ---------------------------------------------------------------------------
// GPU resources and pipelines.
// ---------------------------------------------------------------------------

/** Creates (and immediately compiles) a `GPUShaderModule` from WGSL source text. */
export function createShaderModule(device: GPUDevice, label: string, source: string): GPUShaderModule {
  return device.createShaderModule({ label, code: source });
}

/** A `mat4x4<f32>` uniform buffer sized for `Camera.worldToClipMatrix()`. */
export function createCameraUniformBuffer(device: GPUDevice): GPUBuffer {
  return device.createBuffer({
    label: 'camera-uniform',
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

/**
 * Uploads a camera matrix (from `camera.worldToClipMatrix()`) into `buffer`.
 *
 * The parameter is deliberately typed as the bare (non-generic-pinned)
 * `Float32Array`, i.e. `Float32Array<ArrayBufferLike>`: that is exactly what
 * `Camera.worldToClipMatrix()` and `buildOrthoMatrix()` return (see
 * src/render/camera.ts). But `GPUQueue.writeBuffer` only accepts an
 * ArrayBuffer-backed view (`Float32Array<ArrayBuffer>`, never
 * `SharedArrayBuffer`-backed) — a real, meaningful distinction in
 * @webgpu/types, not one this function should paper over with a cast. So it
 * copies into a fresh `Float32Array<ArrayBuffer>` (a plain `new
 * Float32Array(matrix)` always allocates its own `ArrayBuffer`) before
 * writing — 16 floats, negligible, and it is what actually makes this
 * compose with `camera.worldToClipMatrix()` without a cast anywhere.
 */
export function writeCameraUniform(device: GPUDevice, buffer: GPUBuffer, matrix: Float32Array): void {
  device.queue.writeBuffer(buffer, 0, new Float32Array(matrix));
}

/** Creates a `GPUBuffer` sized to hold `capacityInstances` packed instances, as a read-only storage buffer. */
export function createInstanceStorageBuffer(device: GPUDevice, capacityInstances: number): GPUBuffer {
  const size = Math.max(1, capacityInstances) * BYTES_PER_INSTANCE;
  return device.createBuffer({
    label: 'sprite-instances',
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

/** Uploads a packed instance `data` array (from `packInstances`) into `buffer`. */
export function writeInstanceBuffer(device: GPUDevice, buffer: GPUBuffer, data: Float32Array<ArrayBuffer>): void {
  if (data.length === 0) return;
  device.queue.writeBuffer(buffer, 0, data);
}

/** Bind group layout for group(0): the camera uniform, visible to the vertex stage only. */
export function createCameraBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'camera-bind-group-layout',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
  });
}

export function createCameraBindGroup(device: GPUDevice, layout: GPUBindGroupLayout, cameraBuffer: GPUBuffer): GPUBindGroup {
  return device.createBindGroup({
    label: 'camera-bind-group',
    layout,
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
}

/** Bind group layout for group(1): the per-atlas instance storage buffer, sampler and texture. */
export function createAtlasBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'atlas-bind-group-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
}

export function createAtlasBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  instanceBuffer: GPUBuffer,
  sampler: GPUSampler,
  textureView: GPUTextureView,
): GPUBindGroup {
  return device.createBindGroup({
    label: 'atlas-bind-group',
    layout,
    entries: [
      { binding: 0, resource: { buffer: instanceBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: textureView },
    ],
  });
}

/** A sampler suitable for `sprite.wgsl` atlases: clamped, so adjacent atlas cells never bleed into each other. */
export function createAtlasSampler(device: GPUDevice): GPUSampler {
  return device.createSampler({
    label: 'atlas-sampler',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'nearest',
    minFilter: 'nearest',
  });
}

/** A sampler suitable for `tile.wgsl` textures: repeat addressing is what makes tiled UVs wrap seamlessly. */
export function createTileSampler(device: GPUDevice): GPUSampler {
  return device.createSampler({
    label: 'tile-sampler',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
  });
}

export type LayerBlendMode = 'opaque' | 'alpha-blend';

export interface LayerPipelineOptions {
  readonly device: GPUDevice;
  readonly shaderModule: GPUShaderModule;
  readonly targetFormat: GPUTextureFormat;
  readonly cameraLayout: GPUBindGroupLayout;
  readonly atlasLayout: GPUBindGroupLayout;
  readonly blendMode: LayerBlendMode;
  readonly label: string;
}

function blendStateForLayer(mode: LayerBlendMode): GPUBlendState | undefined {
  if (mode === 'opaque') return undefined;
  return {
    color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
    alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  };
}

/**
 * Builds a `GPURenderPipeline` for one instanced layer (terrain, sprites, or
 * hazards). All three share the same vertex/fragment entry points and
 * bind-group shape; only the shader module (sprite.wgsl vs tile.wgsl) and the
 * blend mode differ.
 */
export function createLayerPipeline(opts: LayerPipelineOptions): GPURenderPipeline {
  const pipelineLayout = opts.device.createPipelineLayout({
    label: `${opts.label}-pipeline-layout`,
    bindGroupLayouts: [opts.cameraLayout, opts.atlasLayout],
  });

  const blend = blendStateForLayer(opts.blendMode);
  const colorTarget: GPUColorTargetState = blend ? { format: opts.targetFormat, blend } : { format: opts.targetFormat };

  return opts.device.createRenderPipeline({
    label: opts.label,
    layout: pipelineLayout,
    vertex: { module: opts.shaderModule, entryPoint: 'vs_main' },
    fragment: {
      module: opts.shaderModule,
      entryPoint: 'fs_main',
      targets: [colorTarget],
    },
    primitive: { topology: 'triangle-list' },
  });
}

// ---------------------------------------------------------------------------
// Post/grade pass: a fullscreen triangle sampling the composited scene.
// Shares no bind-group shape with the instanced layers above, so it gets its
// own bind-group layout, sampler and pipeline factory (see
// src/render/shaders/post.wgsl for the shader itself).
// ---------------------------------------------------------------------------

/** Bind group layout for the post pass's group(0): the composited scene's sampler and texture. */
export function createPostBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'post-bind-group-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
}

export function createPostBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sampler: GPUSampler,
  sourceView: GPUTextureView,
): GPUBindGroup {
  return device.createBindGroup({
    label: 'post-bind-group',
    layout,
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: sourceView },
    ],
  });
}

/** A sampler suitable for reading the composited scene in the post pass: linear, clamped (there is nothing to tile). */
export function createPostSampler(device: GPUDevice): GPUSampler {
  return device.createSampler({
    label: 'post-sampler',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
  });
}

export interface PostPipelineOptions {
  readonly device: GPUDevice;
  readonly shaderModule: GPUShaderModule;
  readonly targetFormat: GPUTextureFormat;
  readonly sourceLayout: GPUBindGroupLayout;
  readonly label: string;
}

/** Builds the `GPURenderPipeline` for the post pass: one bind group, no vertex buffer, a 3-vertex fullscreen-triangle draw. */
export function createPostPipeline(opts: PostPipelineOptions): GPURenderPipeline {
  const pipelineLayout = opts.device.createPipelineLayout({
    label: `${opts.label}-pipeline-layout`,
    bindGroupLayouts: [opts.sourceLayout],
  });

  return opts.device.createRenderPipeline({
    label: opts.label,
    layout: pipelineLayout,
    vertex: { module: opts.shaderModule, entryPoint: 'vs_main' },
    fragment: {
      module: opts.shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format: opts.targetFormat }],
    },
    primitive: { topology: 'triangle-list' },
  });
}

// ---------------------------------------------------------------------------
// Encoder functions the app composes, one per render pass, in draw order:
// terrain tiles -> world sprites -> hazards -> optional post/grade pass.
// ---------------------------------------------------------------------------

/** One atlas's worth of already-uploaded GPU state, ready to draw. */
export interface AtlasDraw {
  readonly bindGroup: GPUBindGroup;
  readonly instanceCount: number;
}

function encodeInstancedLayer(
  pass: GPURenderPassEncoder,
  pipeline: GPURenderPipeline,
  cameraBindGroup: GPUBindGroup,
  atlases: readonly AtlasDraw[],
): void {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, cameraBindGroup);
  for (const atlas of atlases) {
    if (atlas.instanceCount === 0) continue;
    pass.setBindGroup(1, atlas.bindGroup);
    pass.draw(6, atlas.instanceCount);
  }
}

/** Draws the terrain-tile layer: one instanced draw call per tileable-texture atlas. */
export function encodeTerrainPass(
  pass: GPURenderPassEncoder,
  pipeline: GPURenderPipeline,
  cameraBindGroup: GPUBindGroup,
  atlases: readonly AtlasDraw[],
): void {
  encodeInstancedLayer(pass, pipeline, cameraBindGroup, atlases);
}

/** Draws the world-sprite layer (vehicles, wrecks, props, projectiles): one instanced draw call per atlas. */
export function encodeSpritePass(
  pass: GPURenderPassEncoder,
  pipeline: GPURenderPipeline,
  cameraBindGroup: GPUBindGroup,
  atlases: readonly AtlasDraw[],
): void {
  encodeInstancedLayer(pass, pipeline, cameraBindGroup, atlases);
}

/** Draws the hazard layer (smoke/paint/oil/mines/spikes) as alpha decals over terrain and sprites: one instanced draw call per atlas. */
export function encodeHazardPass(
  pass: GPURenderPassEncoder,
  pipeline: GPURenderPipeline,
  cameraBindGroup: GPUBindGroup,
  atlases: readonly AtlasDraw[],
): void {
  encodeInstancedLayer(pass, pipeline, cameraBindGroup, atlases);
}

/**
 * Draws the optional post/grade pass: a single fullscreen triangle sampling
 * whatever the previous passes rendered into (see post.wgsl,
 * createPostPipeline, createPostBindGroupLayout, createPostBindGroup and
 * createPostSampler above for how to build `pipeline`/`sourceBindGroup`).
 * Truly optional — when the app has no post pipeline configured for this
 * frame, `pipeline` is `undefined` and this is a no-op, leaving the
 * composited scene as final output.
 */
export function encodePostPass(pass: GPURenderPassEncoder, pipeline: GPURenderPipeline | undefined, sourceBindGroup: GPUBindGroup | undefined): void {
  if (!pipeline || !sourceBindGroup) return;
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, sourceBindGroup);
  pass.draw(3, 1);
}
