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
 * Byte layout (must match the WGSL `Instance` struct in sprite.wgsl exactly):
 * 20 floats / 80 bytes per instance, laid out as four vec4<f32> slots plus a
 * fifth, so every field lands on the 16-byte boundary WGSL struct rules
 * require:
 *
 *   float offset | field       | meaning
 *   ------------ | ----------- | -------------------------------------------
 *   0..3         | transform0  | xy = world position (m), z = rotation (rad), w = layer
 *   4..7         | transform1  | xy = size (m, full width/height),
 *                |             |     zw = OVERLOADED, see below
 *   8..11        | uvRect      | x0,y0 = atlas UV top-left, z,w = atlas UV bottom-right
 *   12..15       | tint        | r,g,b,a multiply tint
 *   16..19       | extra       | x = SPRITE_KIND tag, yzw = reserved (zero)
 *
 * `transform1.zw` is overloaded because both consumers fit in two floats, and
 * which one is present is decided by `extra.x` — the authoritative tag. That
 * tag is not decoration: shadow and ground both read `transform1.zw`, and
 * inferring which from the *value* (e.g. "non-zero means shadow") is what made
 * ground quads render as black shadows. `resolveSpriteKind` writes it.
 *
 *   kind 0 PLAIN  : zw unused
 *   kind 1 SHADOW : z = softness, w = opacity
 *   kind 2 GROUND : z = tile metres, w = detail scale
 *
 * NOTE: `tile.wgsl` is DEAD and is not part of any pipeline. The field table
 * above describes sprite.wgsl only; sprite.wgsl grew the ground branch that
 * tile.wgsl used to model, so the tiled-ground path is not a second shader.
 *
 * `layer` (transform0.w) is written into the packed buffer for shader-side
 * debugging/future use only — sprite.wgsl does not read it, and this pipeline
 * has no depth buffer. Cross-atlas z-order is instead decided entirely on the
 * CPU by `buildFrameInstanceBuffers`, which buckets visible instances by
 * ascending `layer` and emits one packed buffer per (layer, atlas) pair in
 * that order — a plain painter's algorithm. That is the correct approach here
 * regardless: the hazard layer blends with alpha, and alpha blending is
 * order-dependent, so a depth test alone could not replace it even if one were
 * added.
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
  /**
   * Contact-shadow parameters, packed into `transform1.zw` (previously two
   * reserved floats that were hard-zeroed and never read — see the field table
   * above). Optional so ordinary sprites are unchanged.
   *
   * The scene has no lighting at all, so an unshadowed vehicle reads as a
   * sticker on the ground. A shadow instance draws no new art: `sprite.wgsl`
   * computes a radial falloff from the quad's local position whenever
   * `shadowSoftness > 0`, which is why the slot is a flag rather than a frame
   * name — it works for any sprite, any size, with no atlas frame.
   */
  readonly shadowSoftness?: number;
  /** Peak shadow alpha. 0 is invisible, ~0.45 reads as a daylight contact shadow. */
  readonly shadowOpacity?: number;
  /**
   * Ground only: world size in metres that one tile of `uvRect` should cover.
   *
   * Non-zero marks the instance as tiled ground, which makes `sprite.wgsl`
   * derive its UVs from world position with `fract()` instead of from the quad
   * — see the ground branch in the fragment shader. Mutually exclusive with
   * the two shadow fields, which is why the fragment shader gates on
   * `shadowOpacity` first.
   */
  readonly uvRepeatMetres?: number;
  /** Ground only: second sampling scale, as a multiple of `uvRepeatMetres`. 0 disables the blend. */
  readonly uvDetailScale?: number;
}

/**
 * Which fragment path this instance takes. Defaults to {@link SPRITE_KIND.PLAIN}
 * and is derived from the shadow/ground fields when not given explicitly, so
 * callers do not have to keep two things in sync.
 */
export function resolveSpriteKind(inst: SpriteInstanceInput): SpriteKind {
  if (inst.uvRepeatMetres !== undefined && inst.uvRepeatMetres > 0) return SPRITE_KIND.GROUND;
  if (inst.shadowOpacity !== undefined && inst.shadowOpacity > 0) return SPRITE_KIND.SHADOW;
  return SPRITE_KIND.PLAIN;
}

/**
 * Which of the fragment shader's special paths an instance takes.
 *
 * Written into `extra.x` rather than inferred from the instance's values — see
 * the field-table note above for the concrete bug that forced the field.
 */
export const SPRITE_KIND = {
  /** Ordinary textured sprite: `sampled * tint`. */
  PLAIN: 0,
  /** Analytic radial contact shadow, no texture read. */
  SHADOW: 1,
  /** World-space `fract()`-tiled ground quad with a second detail scale. */
  GROUND: 2,
} as const;

export type SpriteKind = (typeof SPRITE_KIND)[keyof typeof SPRITE_KIND];

export const FLOATS_PER_INSTANCE = 20;
export const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

/** Float (not byte) offset of each field's first component within one packed instance. */
export const INSTANCE_FIELD_FLOAT_OFFSETS = {
  transform0: 0,
  transform1: 4,
  uvRect: 8,
  tint: 12,
  extra: 16,
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
    // transform1.zw is overloaded: a shadow carries (softness, opacity), a
    // ground quad carries (tileMetres, detailScale). `extra.x` is the
    // authoritative tag saying which — see resolveSpriteKind.
    const kind = resolveSpriteKind(inst);
    const isGround = kind === SPRITE_KIND.GROUND;
    out[base + 6] = isGround ? (inst.uvRepeatMetres ?? 0) : (inst.shadowSoftness ?? 0);
    out[base + 7] = isGround ? (inst.uvDetailScale ?? 0) : (inst.shadowOpacity ?? 0);
    out[base + 8] = inst.uvRect.u0;
    out[base + 9] = inst.uvRect.v0;
    out[base + 10] = inst.uvRect.u1;
    out[base + 11] = inst.uvRect.v1;
    out[base + 12] = inst.tint.r;
    out[base + 13] = inst.tint.g;
    out[base + 14] = inst.tint.b;
    out[base + 15] = inst.tint.a;
    out[base + 16] = resolveSpriteKind(inst);
    out[base + 17] = 0;
    out[base + 18] = 0;
    out[base + 19] = 0;
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
/**
 * Writes packed instances into a storage buffer, refusing to overrun it.
 *
 * ## Why the capacity check exists
 *
 * `queue.writeBuffer` past the end of a buffer is a WebGPU VALIDATION ERROR and
 * the write is DROPPED — it does not clamp, and it does not throw. The symptom
 * is therefore a frame that silently renders with stale or zero instance data:
 * a missing car, a ground quad in the wrong place, or an empty screen, with
 * nothing in the console unless something is listening for validation errors.
 * That is precisely the failure the capacity constants exist to prevent, so
 * the guard belongs at the one place every write passes through.
 *
 * A silent overrun is a data bug, so this throws rather than truncating. A
 * truncated write would keep rendering, just wrongly, and would hide the cause.
 */
export function writeInstanceBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  data: Float32Array<ArrayBuffer>,
  capacityInstances?: number,
): void {
  if (data.length === 0) return;
  if (capacityInstances !== undefined) {
    const count = data.length / FLOATS_PER_INSTANCE;
    if (count > capacityInstances) {
      throw new RangeError(
        `writeInstanceBuffer: ${count} instances exceeds capacity ${capacityInstances} ` +
          `(${data.length} floats into a ${capacityInstances * FLOATS_PER_INSTANCE}-float buffer)`,
      );
    }
  }
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

/**
 * A sampler suitable for `sprite.wgsl` atlases: clamped, so adjacent atlas cells never bleed into each other.
 *
 * ## Why NEAREST, given the ground is the biggest thing on screen
 *
 * It is tempting to make this linear because the ground — one quad filling the
 * whole frame — is sampled through this same sampler, and nearest filtering
 * makes its `fract()` wraps read as hard texel steps. Linear is the wrong fix
 * here for a structural reason: the ground samples INSIDE an atlas sub-rect
 * (`rect.xy + fract(wuv) * (rect.zw - rect.xy)`), and the atlas has no gutters.
 * With linear filtering, any fragment near a tile's edge blends with the
 * NEIGHBOURING cell's texels, so every ground tile would carry a coloured
 * fringe from whatever is packed next to it. That is strictly worse than a
 * slightly blocky wrap, and it would look like a rendering bug rather than a
 * tuning choice.
 *
 * Doing it properly means giving the ground its OWN texture with linear +
 * repeat addressing, sampled through a second binding. That is a real change
 * (a new texture, a new bind group entry, repacking) and it is the right
 * follow-up, but it is not a one-line edit and it is not what is done here.
 */
export function createAtlasSampler(device: GPUDevice): GPUSampler {
  return device.createSampler({
    label: 'atlas-sampler',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'nearest',
    minFilter: 'nearest',
  });
}

/**
 * A LINEAR + REPEAT sampler, for a standalone tiling texture.
 *
 * ## UNUSED BY PRODUCTION CODE — kept only because a test asserts its shape
 *
 * `tile.wgsl` is dead (see the file header), and the live ground path samples
 * through {@link createAtlasSampler} because it reads inside an atlas sub-rect,
 * where linear filtering would bleed the neighbouring cell. So nothing in
 * `src/` calls this.
 *
 * It is left in place rather than deleted because it documents the correct
 * answer to "what sampler should the ground use", which is the open question
 * {@link createAtlasSampler}'s own comment raises. When the ground is given its
 * own texture — the real fix for the blocky wrap — this is the sampler to use.
 *
 * The alternative was deleting it and losing the only written-down answer.
 */
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

/**
 * The post pass's grade parameters, uploaded once per frame.
 *
 * Field order and count are load-bearing and shared with `PostUniforms` in
 * `src/render/shaders/post.wgsl` — 3 x vec4 = 48 bytes, 16-byte aligned, no
 * padding. A screen sets these per frame to dial its own look (the arena runs
 * a harder vignette than the city) without a second pipeline or a recompile.
 */
export interface PostUniformValues {
  /** Width and height of the composited scene, in device pixels. Drives the bloom tap radius and the aspect-corrected vignette. */
  readonly width: number;
  readonly height: number;
  /** Seconds since boot. Drives the animated grain so it does not sit frozen on a still frame. */
  readonly timeSeconds: number;
  /** 0 disables the vignette, ~0.5 is heavy. */
  readonly vignette: number;
  /** 0 disables bloom. */
  readonly bloom: number;
  /** 0 disables grain. */
  readonly grain: number;
  /** 0 is greyscale, 1 is unchanged, >1 pushes colour. */
  readonly saturation: number;
  /** 1 is unchanged; <1 flattens toward mid grey, >1 adds contrast. */
  readonly contrast: number;
  /** Strength of the warm-shadow / cool-highlight split tone. 0 is a no-op. */
  readonly splitTone: number;
  /** Global multiplicative exposure applied before the tone curve. */
  readonly exposure: number;
}

/** Bytes in the post uniform block: 3 x vec4<f32>. Must match `PostUniforms` in post.wgsl. */
export const POST_UNIFORM_BYTES = 48;

export function packPostUniforms(v: PostUniformValues): Float32Array<ArrayBuffer> {
  return new Float32Array([
    v.width,
    v.height,
    v.timeSeconds,
    v.vignette,
    v.bloom,
    v.grain,
    v.saturation,
    v.contrast,
    v.splitTone,
    0, // reserved
    v.exposure,
    0, // reserved
  ]);
}

/** A `GPUBuffer` sized for {@link POST_UNIFORM_BYTES}, in `UNIFORM | COPY_DST` usage. */
export function createPostUniformBuffer(device: GPUDevice): GPUBuffer {
  return device.createBuffer({
    label: 'post-uniforms',
    size: POST_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

/**
 * Bind group layout for the post pass's group(0): the composited scene's
 * sampler, its texture, and the grade uniform block.
 *
 * The uniform at binding 2 is new. The pass was originally a pure copy with no
 * parameters, which is why it could be a literal identity; once it grades, the
 * grade has to come from somewhere, and a uniform beats recompiling the shader
 * per screen or hardcoding a single look.
 */
export function createPostBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'post-bind-group-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
}

export function createPostBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sampler: GPUSampler,
  sourceView: GPUTextureView,
  uniformBuffer: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    label: 'post-bind-group',
    layout,
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: sourceView },
      { binding: 2, resource: { buffer: uniformBuffer } },
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
