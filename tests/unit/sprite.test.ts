import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyMatrix, buildOrthoMatrix, createCamera } from '@/render/camera';
import {
  BYTES_PER_INSTANCE,
  FLOATS_PER_INSTANCE,
  INSTANCE_FIELD_FLOAT_OFFSETS,
  buildFrameInstanceBuffers,
  createAtlasBindGroup,
  createAtlasBindGroupLayout,
  createAtlasSampler,
  createCameraBindGroup,
  createCameraBindGroupLayout,
  createCameraUniformBuffer,
  createInstanceStorageBuffer,
  createLayerPipeline,
  createPostBindGroup,
  createPostBindGroupLayout,
  createPostPipeline,
  createPostSampler,
  createShaderModule,
  createTileSampler,
  cullInstances,
  encodeHazardPass,
  encodePostPass,
  encodeSpritePass,
  encodeTerrainPass,
  groupByAtlas,
  packInstances,
  writeCameraUniform,
  writeInstanceBuffer,
  type AtlasDraw,
  type SpriteInstanceInput,
} from '@/render/sprite';

// ---------------------------------------------------------------------------
// Fake GPU plumbing (mirrors the stub pattern in tests/unit/gpu.test.ts):
// plain vi.fn()-backed objects standing in for a real GPUDevice, tagging
// every created object with the descriptor it was built from so assertions
// can inspect exactly what each factory asked the device for.
// ---------------------------------------------------------------------------

// GPUShaderStage / GPUBufferUsage / GPUTextureUsage are ambient globals a
// real WebGPU environment (or the browser) provides; @webgpu/types is
// types-only, so under `environment: 'node'` they do not exist at runtime
// until stubbed. Real bit values per the WebGPU spec, so usage-flag OR'ing
// in the module under test behaves identically to a real device.
vi.stubGlobal('GPUShaderStage', { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 });
vi.stubGlobal('GPUBufferUsage', {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
});

function makeFakeDevice(): {
  device: GPUDevice;
  createBuffer: ReturnType<typeof vi.fn>;
  createBindGroupLayout: ReturnType<typeof vi.fn>;
  createBindGroup: ReturnType<typeof vi.fn>;
  createSampler: ReturnType<typeof vi.fn>;
  createShaderModule: ReturnType<typeof vi.fn>;
  createPipelineLayout: ReturnType<typeof vi.fn>;
  createRenderPipeline: ReturnType<typeof vi.fn>;
  writeBuffer: ReturnType<typeof vi.fn>;
} {
  const createBuffer = vi.fn((desc: object) => ({ ...desc, __kind: 'buffer' }));
  const createBindGroupLayout = vi.fn((desc: object) => ({ ...desc, __kind: 'bind-group-layout' }));
  const createBindGroup = vi.fn((desc: object) => ({ ...desc, __kind: 'bind-group' }));
  const createSampler = vi.fn((desc: object) => ({ ...desc, __kind: 'sampler' }));
  const createShaderModule = vi.fn((desc: object) => ({ ...desc, __kind: 'shader-module' }));
  const createPipelineLayout = vi.fn((desc: object) => ({ ...desc, __kind: 'pipeline-layout' }));
  const createRenderPipeline = vi.fn((desc: object) => ({ ...desc, __kind: 'pipeline' }));
  const writeBuffer = vi.fn();

  const device = {
    createBuffer,
    createBindGroupLayout,
    createBindGroup,
    createSampler,
    createShaderModule,
    createPipelineLayout,
    createRenderPipeline,
    queue: { writeBuffer },
  } as unknown as GPUDevice;

  return {
    device,
    createBuffer,
    createBindGroupLayout,
    createBindGroup,
    createSampler,
    createShaderModule,
    createPipelineLayout,
    createRenderPipeline,
    writeBuffer,
  };
}

function makeFakePassEncoder(): {
  pass: GPURenderPassEncoder;
  setPipeline: ReturnType<typeof vi.fn>;
  setBindGroup: ReturnType<typeof vi.fn>;
  draw: ReturnType<typeof vi.fn>;
} {
  const setPipeline = vi.fn();
  const setBindGroup = vi.fn();
  const draw = vi.fn();
  const pass = { setPipeline, setBindGroup, draw } as unknown as GPURenderPassEncoder;
  return { pass, setPipeline, setBindGroup, draw };
}

function instanceAt(atlasId: string, x: number, y: number, opts: Partial<SpriteInstanceInput> = {}): SpriteInstanceInput {
  return {
    atlasId,
    position: { x, y },
    rotationRad: 0,
    sizeM: { x: 2, y: 2 },
    uvRect: { u0: 0, v0: 0, u1: 1, v1: 1 },
    tint: { r: 1, g: 1, b: 1, a: 1 },
    layer: 0,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Instance buffer packer
// ---------------------------------------------------------------------------

describe('packInstances: documented byte layout', () => {
  it('packs one instance into the exact 16-float / 64-byte layout', () => {
    const instance: SpriteInstanceInput = {
      atlasId: 'vehicles',
      position: { x: 10, y: 20 },
      rotationRad: 0,
      sizeM: { x: 4, y: 2 },
      uvRect: { u0: 0, v0: 0, u1: 1, v1: 1 },
      tint: { r: 1, g: 0.5, b: 0.25, a: 1 },
      layer: 3,
    };

    const packed = packInstances([instance]);

    expect(FLOATS_PER_INSTANCE).toBe(16);
    expect(BYTES_PER_INSTANCE).toBe(64);
    expect(packed.byteLength).toBe(BYTES_PER_INSTANCE);
    expect(Array.from(packed)).toEqual([
      10, 20, 0, 3, // transform0: position.xy, rotation, layer
      4, 2, 0, 0, // transform1: size.xy, reserved, reserved
      0, 0, 1, 1, // uvRect: u0,v0,u1,v1
      1, 0.5, 0.25, 1, // tint: r,g,b,a
    ]);

    expect(INSTANCE_FIELD_FLOAT_OFFSETS).toEqual({ transform0: 0, transform1: 4, uvRect: 8, tint: 12 });
  });

  it('packs multiple instances back-to-back at stride FLOATS_PER_INSTANCE', () => {
    const a = instanceAt('vehicles', 0, 0);
    const b = instanceAt('vehicles', 5, 5, { rotationRad: Math.PI, layer: 7 });

    const packed = packInstances([a, b]);

    expect(packed.length).toBe(2 * FLOATS_PER_INSTANCE);
    expect(packed[FLOATS_PER_INSTANCE + INSTANCE_FIELD_FLOAT_OFFSETS.transform0 + 0]).toBe(5);
    expect(packed[FLOATS_PER_INSTANCE + INSTANCE_FIELD_FLOAT_OFFSETS.transform0 + 1]).toBe(5);
    // Float32Array truncates Math.PI's float64 precision, as it will on the GPU too.
    expect(packed[FLOATS_PER_INSTANCE + INSTANCE_FIELD_FLOAT_OFFSETS.transform0 + 2]).toBeCloseTo(Math.PI, 6);
    expect(packed[FLOATS_PER_INSTANCE + INSTANCE_FIELD_FLOAT_OFFSETS.transform0 + 3]).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

describe('camera: worldToClip matrix', () => {
  it('maps a known world point to the expected clip coordinate', () => {
    const camera = createCamera();
    camera.setDevicePixelRatio(2);
    camera.setZoom(32); // 32 CSS px per meter
    camera.setViewportPx(640, 480); // physical (already DPR-scaled) backing size
    camera.setCenter({ x: 100, y: 50 });

    // cssWidth = 640/2 = 320 -> 320/32 = 10m visible wide -> half = 5m
    // cssHeight = 480/2 = 240 -> 240/32 = 7.5m visible tall -> half = 3.75m
    expect(camera.getHalfExtentsM()).toEqual({ x: 5, y: 3.75 });

    const matrix = camera.worldToClipMatrix();
    expect(matrix.length).toBe(16);

    // The matrix is a Float32Array, so expect Float32-precision (~1e-6..1e-7), not float64 precision.
    const centerClip = applyMatrix(matrix, { x: 100, y: 50 });
    expect(centerClip.x).toBeCloseTo(0, 5);
    expect(centerClip.y).toBeCloseTo(0, 5);

    // 5m to the right of centre must land on the right clip edge.
    const rightEdge = applyMatrix(matrix, { x: 105, y: 50 });
    expect(rightEdge.x).toBeCloseTo(1, 5);
    expect(rightEdge.y).toBeCloseTo(0, 5);

    // 3.75m up from centre must land on the top clip edge.
    const topEdge = applyMatrix(matrix, { x: 100, y: 53.75 });
    expect(topEdge.x).toBeCloseTo(0, 5);
    expect(topEdge.y).toBeCloseTo(1, 5);
  });

  it('respects devicePixelRatio: doubling it at the same CSS size and zoom shows the same world extent', () => {
    const camera = createCamera();
    camera.setZoom(32);
    camera.setCenter({ x: 0, y: 0 });

    camera.setDevicePixelRatio(1);
    camera.setViewportPx(320, 240); // 320 CSS px wide at dpr 1
    const halfAtDpr1 = camera.getHalfExtentsM();

    camera.setDevicePixelRatio(2);
    camera.setViewportPx(640, 480); // same 320 CSS px wide, backing doubled for dpr 2
    const halfAtDpr2 = camera.getHalfExtentsM();

    expect(halfAtDpr2).toEqual(halfAtDpr1);
  });

  it('reports a visible-bounds AABB centred on the camera', () => {
    const camera = createCamera();
    camera.setDevicePixelRatio(2);
    camera.setZoom(32);
    camera.setViewportPx(640, 480);
    camera.setCenter({ x: 100, y: 50 });

    expect(camera.getVisibleBounds()).toEqual({ minX: 95, maxX: 105, minY: 46.25, maxY: 53.75 });
  });

  it('buildOrthoMatrix is the pure function backing worldToClipMatrix', () => {
    const matrix = buildOrthoMatrix(100, 50, { x: 5, y: 3.75 });
    const clip = applyMatrix(matrix, { x: 105, y: 50 });
    expect(clip.x).toBeCloseTo(1, 5);
    expect(clip.y).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// Culling
// ---------------------------------------------------------------------------

describe('cullInstances: drops off-screen instances, keeps on-screen ones', () => {
  it('keeps an instance inside the visible bounds and drops one far outside it', () => {
    const camera = createCamera();
    camera.setDevicePixelRatio(2);
    camera.setZoom(32);
    camera.setViewportPx(640, 480);
    camera.setCenter({ x: 100, y: 50 });
    const bounds = camera.getVisibleBounds();

    const onScreen = instanceAt('vehicles', 100, 50);
    const offScreen = instanceAt('vehicles', 100_000, 100_000);

    const result = cullInstances([onScreen, offScreen], bounds);

    expect(result.totalCount).toBe(2);
    expect(result.visibleCount).toBe(1);
    expect(result.visible).toEqual([onScreen]);
  });

  it('keeps an instance whose quad overlaps the bounds even though its centre sits just outside them', () => {
    const bounds = { minX: 0, maxX: 10, minY: 0, maxY: 10 };
    // Centre at x=11 is outside [0,10], but a 4m-wide quad reaches back to x=9.
    const straddling = instanceAt('vehicles', 11, 5, { sizeM: { x: 4, y: 4 } });

    const result = cullInstances([straddling], bounds);

    expect(result.visibleCount).toBe(1);
    expect(result.visible).toEqual([straddling]);
  });

  it('an empty instance list culls to nothing', () => {
    const result = cullInstances([], { minX: 0, maxX: 10, minY: 0, maxY: 10 });
    expect(result).toEqual({ visible: [], visibleCount: 0, totalCount: 0 });
  });

  it('preserves the surviving instances’ relative order from the input array, regardless of world position', () => {
    // Regression: a prior spatial-hash implementation returned survivors in
    // grid-iteration order, which silently reversed or shuffled callers'
    // expected draw order whenever instances landed in different cells.
    const bounds = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
    const first = instanceAt('vehicles', 100, 0);
    const second = instanceAt('vehicles', 0, 0);
    const third = instanceAt('vehicles', -100, 0);

    const result = cullInstances([first, second, third], bounds);

    expect(result.visible).toEqual([first, second, third]);
  });

  it('a large instance count culls correctly without a pathological cell-count blowup', () => {
    // A regression guard for the old grid: a handful of huge instances used
    // to insert into tens of thousands of cells each. This just asserts
    // correctness at scale; timing is intentionally not asserted here (flaky
    // in CI) but this used to take tens of milliseconds and now takes
    // fractions of one.
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    const instances: SpriteInstanceInput[] = [];
    for (let i = 0; i < 2000; i++) {
      instances.push(instanceAt('vehicles', (i * 37) % 4000, (i * 53) % 4000));
    }
    // One huge terrain-scale quad, the exact shape that blew up the old grid.
    instances.push(instanceAt('terrain', 50, 50, { sizeM: { x: 2000, y: 2000 } }));

    const result = cullInstances(instances, bounds);

    expect(result.totalCount).toBe(2001);
    // The huge quad always overlaps; count on-grid instances independently.
    const expectedOnGrid = instances
      .slice(0, 2000)
      .filter((inst) => inst.position.x >= -1 && inst.position.x <= 101 && inst.position.y >= -1 && inst.position.y <= 101).length;
    expect(result.visibleCount).toBe(expectedOnGrid + 1);
  });
});

describe('groupByAtlas: one packed group per atlasId', () => {
  it('groups instances by atlasId and packs each group separately', () => {
    const a = instanceAt('vehicles', 0, 0);
    const b = instanceAt('props', 1, 1);
    const c = instanceAt('vehicles', 2, 2);

    const groups = groupByAtlas([a, b, c]);
    expect(Array.from(groups.keys())).toEqual(['vehicles', 'props']);
    expect(groups.get('vehicles')).toEqual([a, c]);
    expect(groups.get('props')).toEqual([b]);
  });
});

describe('buildFrameInstanceBuffers: culls, then buckets by ascending layer, then by atlas', () => {
  it('excludes culled instances from every atlas buffer', () => {
    const bounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 };
    const nearVehicle = instanceAt('vehicles', 0, 0);
    const farVehicle = instanceAt('vehicles', 9999, 9999);
    const nearProp = instanceAt('props', 1, 1);

    const frame = buildFrameInstanceBuffers([nearVehicle, farVehicle, nearProp], bounds);

    expect(frame.totalCount).toBe(3);
    expect(frame.visibleCount).toBe(2);
    const vehicles = frame.atlases.find((a) => a.atlasId === 'vehicles');
    expect(vehicles?.instanceCount).toBe(1);
    expect(vehicles?.data.length).toBe(FLOATS_PER_INSTANCE);
    const props = frame.atlases.find((a) => a.atlasId === 'props');
    expect(props?.instanceCount).toBe(1);
  });

  it('emits one bucket per (layer, atlas) pair in ascending-layer order, even when the same atlas repeats at two layers', () => {
    // The exact scenario from the z-order regression: a wreck decal and a
    // vehicle share one atlas but sit at different layers; the higher layer
    // must be emitted (and therefore drawn) AFTER the lower one, regardless
    // of which one has the larger x (i.e. regardless of grid/insertion
    // order) — this is what makes the vehicle paint over the wreck.
    const bounds = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
    const vehicle = instanceAt('world', 100, 0, { layer: 99 });
    const wreck = instanceAt('world', 0, 0, { layer: 0 });

    const frame = buildFrameInstanceBuffers([vehicle, wreck], bounds);

    expect(frame.atlases.map((a) => ({ atlasId: a.atlasId, layer: a.layer, instanceCount: a.instanceCount }))).toEqual([
      { atlasId: 'world', layer: 0, instanceCount: 1 },
      { atlasId: 'world', layer: 99, instanceCount: 1 },
    ]);
    // And each bucket packed exactly its own instance, not the other one's.
    expect(Array.from(frame.atlases[0]!.data.slice(0, 2))).toEqual([0, 0]); // wreck's position
    expect(Array.from(frame.atlases[1]!.data.slice(0, 2))).toEqual([100, 0]); // vehicle's position
  });

  it('keeps atlases separate within one layer, and orders layers ascending across different atlases', () => {
    const bounds = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
    const terrainTile = instanceAt('terrain', 0, 0, { layer: 0 });
    const prop = instanceAt('props', 1, 1, { layer: 5 });
    const hazard = instanceAt('hazards', 2, 2, { layer: 10 });

    const frame = buildFrameInstanceBuffers([hazard, prop, terrainTile], bounds);

    expect(frame.atlases.map((a) => ({ atlasId: a.atlasId, layer: a.layer }))).toEqual([
      { atlasId: 'terrain', layer: 0 },
      { atlasId: 'props', layer: 5 },
      { atlasId: 'hazards', layer: 10 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// GPU resource factories
// ---------------------------------------------------------------------------

describe('createShaderModule', () => {
  it('compiles WGSL source via device.createShaderModule with the given label', () => {
    const { device, createShaderModule: createShaderModuleMock } = makeFakeDevice();
    const module = createShaderModule(device, 'sprite-shader', 'const x = 1;');
    expect(createShaderModuleMock).toHaveBeenCalledWith({ label: 'sprite-shader', code: 'const x = 1;' });
    expect(module).toEqual({ label: 'sprite-shader', code: 'const x = 1;', __kind: 'shader-module' });
  });
});

describe('camera uniform buffer', () => {
  it('createCameraUniformBuffer sizes a 64-byte (mat4x4<f32>) uniform buffer with UNIFORM|COPY_DST usage', () => {
    const { device, createBuffer } = makeFakeDevice();
    createCameraUniformBuffer(device);
    expect(createBuffer).toHaveBeenCalledWith({
      label: 'camera-uniform',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  });

  it('writeCameraUniform composes directly with camera.worldToClipMatrix() (no cast needed) and writes at offset 0', () => {
    const { device, writeBuffer } = makeFakeDevice();
    const buffer = createCameraUniformBuffer(device);
    const camera = createCamera();
    camera.setZoom(32);
    camera.setViewportPx(640, 480);

    // This is the module's own documented composition. If this line fails to
    // typecheck, `tsc --noEmit` catches it — no runtime assertion can.
    writeCameraUniform(device, buffer, camera.worldToClipMatrix());

    expect(writeBuffer).toHaveBeenCalledTimes(1);
    const call = writeBuffer.mock.calls[0] as unknown as [GPUBuffer, number, Float32Array];
    expect(call[0]).toBe(buffer);
    expect(call[1]).toBe(0);
    expect(call[2].length).toBe(16);
  });
});

describe('instance storage buffer', () => {
  it('createInstanceStorageBuffer sizes capacity * BYTES_PER_INSTANCE with STORAGE|COPY_DST usage', () => {
    const { device, createBuffer } = makeFakeDevice();
    createInstanceStorageBuffer(device, 10);
    expect(createBuffer).toHaveBeenCalledWith({
      label: 'sprite-instances',
      size: 10 * BYTES_PER_INSTANCE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  });

  it('createInstanceStorageBuffer clamps capacity 0 up to a 1-instance buffer (a zero-size GPUBuffer is invalid)', () => {
    const { device, createBuffer } = makeFakeDevice();
    createInstanceStorageBuffer(device, 0);
    expect(createBuffer).toHaveBeenCalledWith(expect.objectContaining({ size: BYTES_PER_INSTANCE }));
  });

  it('writeInstanceBuffer uploads packed data from packInstances at offset 0', () => {
    const { device, writeBuffer } = makeFakeDevice();
    const buffer = createInstanceStorageBuffer(device, 1);
    const data = packInstances([instanceAt('vehicles', 1, 2)]);

    writeInstanceBuffer(device, buffer, data);

    expect(writeBuffer).toHaveBeenCalledWith(buffer, 0, data);
  });

  it('writeInstanceBuffer is a no-op for an empty instance buffer (nothing to upload)', () => {
    const { device, writeBuffer } = makeFakeDevice();
    const buffer = createInstanceStorageBuffer(device, 1);

    writeInstanceBuffer(device, buffer, packInstances([]));

    expect(writeBuffer).not.toHaveBeenCalled();
  });
});

describe('bind group layouts and bind groups', () => {
  it('createCameraBindGroupLayout: binding 0 is a uniform buffer visible only to the vertex stage', () => {
    const { device, createBindGroupLayout } = makeFakeDevice();
    createCameraBindGroupLayout(device);
    expect(createBindGroupLayout).toHaveBeenCalledWith({
      label: 'camera-bind-group-layout',
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
  });

  it('createCameraBindGroup binds the camera buffer at binding 0 against the given layout', () => {
    const { device } = makeFakeDevice();
    const layout = createCameraBindGroupLayout(device);
    const cameraBuffer = createCameraUniformBuffer(device);

    const bindGroup = createCameraBindGroup(device, layout, cameraBuffer);

    expect(bindGroup).toEqual({
      label: 'camera-bind-group',
      layout,
      entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
      __kind: 'bind-group',
    });
  });

  it('createAtlasBindGroupLayout: instance storage (vertex, read-only) + sampler + texture (both fragment)', () => {
    const { device, createBindGroupLayout } = makeFakeDevice();
    createAtlasBindGroupLayout(device);
    expect(createBindGroupLayout).toHaveBeenCalledWith({
      label: 'atlas-bind-group-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
  });

  it('createAtlasBindGroup binds the instance buffer, sampler and texture view at bindings 0, 1, 2', () => {
    const { device } = makeFakeDevice();
    const layout = createAtlasBindGroupLayout(device);
    const instanceBuffer = createInstanceStorageBuffer(device, 4);
    const sampler = createAtlasSampler(device);
    const textureView = { __kind: 'texture-view' } as unknown as GPUTextureView;

    const bindGroup = createAtlasBindGroup(device, layout, instanceBuffer, sampler, textureView);

    expect(bindGroup).toEqual({
      label: 'atlas-bind-group',
      layout,
      entries: [
        { binding: 0, resource: { buffer: instanceBuffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: textureView },
      ],
      __kind: 'bind-group',
    });
  });
});

describe('samplers', () => {
  it('createAtlasSampler clamps to edge and uses nearest filtering (adjacent atlas cells must not bleed)', () => {
    const { device, createSampler } = makeFakeDevice();
    createAtlasSampler(device);
    expect(createSampler).toHaveBeenCalledWith({
      label: 'atlas-sampler',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'nearest',
      minFilter: 'nearest',
    });
  });

  it('createTileSampler repeats and uses linear filtering (this is what makes tile.wgsl wrap seamlessly)', () => {
    const { device, createSampler } = makeFakeDevice();
    createTileSampler(device);
    expect(createSampler).toHaveBeenCalledWith({
      label: 'tile-sampler',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
    });
  });
});

describe('createLayerPipeline', () => {
  it('opaque: no blend state on the color target', () => {
    const { device, createPipelineLayout, createRenderPipeline } = makeFakeDevice();
    const cameraLayout = createCameraBindGroupLayout(device);
    const atlasLayout = createAtlasBindGroupLayout(device);
    const shaderModule = createShaderModule(device, 'tile', 'code');

    createLayerPipeline({
      device,
      shaderModule,
      targetFormat: 'bgra8unorm',
      cameraLayout,
      atlasLayout,
      blendMode: 'opaque',
      label: 'terrain-pipeline',
    });

    expect(createPipelineLayout).toHaveBeenCalledWith({
      label: 'terrain-pipeline-pipeline-layout',
      bindGroupLayouts: [cameraLayout, atlasLayout],
    });
    expect(createRenderPipeline).toHaveBeenCalledWith({
      label: 'terrain-pipeline',
      layout: expect.objectContaining({ __kind: 'pipeline-layout' }),
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
  });

  it('alpha-blend: standard (non-premultiplied) src-alpha compositing on the color target', () => {
    const { device, createRenderPipeline } = makeFakeDevice();
    const cameraLayout = createCameraBindGroupLayout(device);
    const atlasLayout = createAtlasBindGroupLayout(device);
    const shaderModule = createShaderModule(device, 'sprite', 'code');

    createLayerPipeline({
      device,
      shaderModule,
      targetFormat: 'bgra8unorm',
      cameraLayout,
      atlasLayout,
      blendMode: 'alpha-blend',
      label: 'hazard-pipeline',
    });

    const call = createRenderPipeline.mock.calls[0]?.[0] as { fragment: { targets: readonly GPUColorTargetState[] } };
    expect(call.fragment.targets[0]).toEqual({
      format: 'bgra8unorm',
      blend: {
        color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Pass encoders
// ---------------------------------------------------------------------------

function atlasDraw(instanceCount: number): AtlasDraw {
  return { bindGroup: { __kind: 'bind-group' } as unknown as GPUBindGroup, instanceCount };
}

describe('encodeTerrainPass / encodeSpritePass / encodeHazardPass: one draw call per non-empty atlas', () => {
  for (const [name, encode] of [
    ['encodeTerrainPass', encodeTerrainPass],
    ['encodeSpritePass', encodeSpritePass],
    ['encodeHazardPass', encodeHazardPass],
  ] as const) {
    it(`${name} sets the pipeline once, the camera bind group once, then draws 6 vertices per non-empty atlas`, () => {
      const { pass, setPipeline, setBindGroup, draw } = makeFakePassEncoder();
      const pipeline = { __kind: 'pipeline' } as unknown as GPURenderPipeline;
      const cameraBindGroup = { __kind: 'bind-group', tag: 'camera' } as unknown as GPUBindGroup;
      const atlasA = atlasDraw(5);
      const atlasEmpty = atlasDraw(0);
      const atlasB = atlasDraw(3);

      encode(pass, pipeline, cameraBindGroup, [atlasA, atlasEmpty, atlasB]);

      expect(setPipeline).toHaveBeenCalledTimes(1);
      expect(setPipeline).toHaveBeenCalledWith(pipeline);
      // Camera bind group (group 0) is set once up front, before any atlas draw.
      expect(setBindGroup.mock.calls[0]).toEqual([0, cameraBindGroup]);
      // The zero-instance atlas contributes no bind-group(1) call and no draw.
      expect(setBindGroup).toHaveBeenCalledTimes(3); // camera + atlasA + atlasB
      expect(draw).toHaveBeenCalledTimes(2);
      expect(draw).toHaveBeenNthCalledWith(1, 6, 5);
      expect(draw).toHaveBeenNthCalledWith(2, 6, 3);
    });
  }

  it('draws nothing beyond pipeline/camera setup when every atlas is empty', () => {
    const { pass, setBindGroup, draw } = makeFakePassEncoder();
    encodeSpritePass(
      pass,
      { __kind: 'pipeline' } as unknown as GPURenderPipeline,
      { __kind: 'bind-group' } as unknown as GPUBindGroup,
      [atlasDraw(0), atlasDraw(0)],
    );
    expect(setBindGroup).toHaveBeenCalledTimes(1); // camera only
    expect(draw).not.toHaveBeenCalled();
  });
});

describe('encodePostPass', () => {
  it('is a no-op when the pipeline is undefined (no post effect configured this frame)', () => {
    const { pass, setPipeline, setBindGroup, draw } = makeFakePassEncoder();
    encodePostPass(pass, undefined, { __kind: 'bind-group' } as unknown as GPUBindGroup);
    expect(setPipeline).not.toHaveBeenCalled();
    expect(setBindGroup).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it('is a no-op when the source bind group is undefined', () => {
    const { pass, setPipeline, draw } = makeFakePassEncoder();
    encodePostPass(pass, { __kind: 'pipeline' } as unknown as GPURenderPipeline, undefined);
    expect(setPipeline).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it('draws a 3-vertex fullscreen triangle when both pipeline and bind group are provided', () => {
    const { pass, setPipeline, setBindGroup, draw } = makeFakePassEncoder();
    const pipeline = { __kind: 'pipeline' } as unknown as GPURenderPipeline;
    const bindGroup = { __kind: 'bind-group' } as unknown as GPUBindGroup;

    encodePostPass(pass, pipeline, bindGroup);

    expect(setPipeline).toHaveBeenCalledWith(pipeline);
    expect(setBindGroup).toHaveBeenCalledWith(0, bindGroup);
    expect(draw).toHaveBeenCalledWith(3, 1);
  });
});

describe('post pipeline factories: make encodePostPass actually reachable', () => {
  it('createPostBindGroupLayout: binding 0 sampler + binding 1 texture, both fragment-only', () => {
    const { device, createBindGroupLayout } = makeFakeDevice();
    createPostBindGroupLayout(device);
    expect(createBindGroupLayout).toHaveBeenCalledWith({
      label: 'post-bind-group-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
  });

  it('createPostSampler is clamped and linear-filtered', () => {
    const { device, createSampler } = makeFakeDevice();
    createPostSampler(device);
    expect(createSampler).toHaveBeenCalledWith({
      label: 'post-sampler',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });
  });

  it('createPostBindGroup binds the sampler and source view at bindings 0 and 1', () => {
    const { device } = makeFakeDevice();
    const layout = createPostBindGroupLayout(device);
    const sampler = createPostSampler(device);
    const sourceView = { __kind: 'texture-view' } as unknown as GPUTextureView;

    const bindGroup = createPostBindGroup(device, layout, sampler, sourceView);

    expect(bindGroup).toEqual({
      label: 'post-bind-group',
      layout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: sourceView },
      ],
      __kind: 'bind-group',
    });
  });

  it('createPostPipeline builds a single-bind-group, no-vertex-buffer pipeline from post.wgsl entry points', () => {
    const { device, createPipelineLayout, createRenderPipeline } = makeFakeDevice();
    const sourceLayout = createPostBindGroupLayout(device);
    const shaderModule = createShaderModule(device, 'post', 'code');

    createPostPipeline({ device, shaderModule, targetFormat: 'bgra8unorm', sourceLayout, label: 'post-pipeline' });

    expect(createPipelineLayout).toHaveBeenCalledWith({
      label: 'post-pipeline-pipeline-layout',
      bindGroupLayouts: [sourceLayout],
    });
    expect(createRenderPipeline).toHaveBeenCalledWith({
      label: 'post-pipeline',
      layout: expect.objectContaining({ __kind: 'pipeline-layout' }),
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
  });

  it('end-to-end: the factories above are sufficient to make encodePostPass actually draw', () => {
    const { device } = makeFakeDevice();
    const { pass, draw } = makeFakePassEncoder();
    const sourceLayout = createPostBindGroupLayout(device);
    const shaderModule = createShaderModule(device, 'post', readPostWgsl());
    const pipeline = createPostPipeline({ device, shaderModule, targetFormat: 'bgra8unorm', sourceLayout, label: 'post' });
    const sampler = createPostSampler(device);
    const sourceView = { __kind: 'texture-view' } as unknown as GPUTextureView;
    const bindGroup = createPostBindGroup(device, sourceLayout, sampler, sourceView);

    encodePostPass(pass, pipeline, bindGroup);

    expect(draw).toHaveBeenCalledWith(3, 1);
  });
});

// ---------------------------------------------------------------------------
// WGSL: parsed as text (comments stripped first) and, for the two formulas
// this module's report flagged as unverified, actually evaluated against
// independently-derived expected values — not grepped for a keyword.
// ---------------------------------------------------------------------------

const shadersDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/render/shaders');
const spriteWgsl = readFileSync(path.join(shadersDir, 'sprite.wgsl'), 'utf8');
const tileWgsl = readFileSync(path.join(shadersDir, 'tile.wgsl'), 'utf8');
const postWgsl = readFileSync(path.join(shadersDir, 'post.wgsl'), 'utf8');

function readPostWgsl(): string {
  return postWgsl;
}

/** Strips `//` line comments so a header comment can never satisfy an assertion meant for real code. */
function stripLineComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/** Extracts the balanced-brace body of the first `fn NAME(` found after `signaturePrefix`. */
function extractFunctionBody(source: string, signaturePrefix: string): string {
  const startIdx = source.indexOf(signaturePrefix);
  if (startIdx === -1) throw new Error(`function not found: ${signaturePrefix}`);
  const braceStart = source.indexOf('{', startIdx);
  if (braceStart === -1) throw new Error(`no opening brace found after ${signaturePrefix}`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  throw new Error(`unbalanced braces in body of ${signaturePrefix}`);
}

/** Finds the LAST `target = EXPR;` statement's EXPR text (a later assignment shadows an earlier one). */
function extractAssignmentExpr(body: string, target: string): string {
  const pattern = new RegExp(`${target}\\s*=\\s*([^;]+);`, 'g');
  let match: RegExpExecArray | null;
  let last: string | undefined;
  while ((match = pattern.exec(body)) !== null) last = match[1];
  if (last === undefined) throw new Error(`no assignment to ${target} found in body`);
  return last;
}

// --- A tiny, generic expression evaluator for exactly the WGSL subset this
// module's two vertex shaders use in their final `out.uv = ...;` line:
// identifiers, dotted member/swizzle access, `+ - * /`, and function calls.
// It is NOT a WGSL parser (no types, no statements, no control flow) — it
// exists to let a test independently execute the ACTUAL text of one real
// expression, instead of grepping for a substring that a header comment can
// also satisfy.

interface WgslVectorValue {
  readonly [component: string]: WgslValue;
}
type WgslValue = number | WgslVectorValue;

interface Token {
  readonly kind: 'num' | 'ident' | 'punct';
  readonly text: string;
}

function tokenize(src: string): readonly Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      tokens.push({ kind: 'ident', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      if (j < src.length && /[uf]/.test(src[j]!)) j++; // WGSL numeric-type suffix
      tokens.push({ kind: 'num', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('.(),+-*/%'.includes(ch)) {
      tokens.push({ kind: 'punct', text: ch });
      i++;
      continue;
    }
    throw new Error(`unexpected character '${ch}' in expression '${src}'`);
  }
  return tokens;
}

function isWgslRecord(value: WgslValue): value is Readonly<Record<string, WgslValue>> {
  return typeof value === 'object';
}

function memberAccess(value: WgslValue, name: string): WgslValue {
  if (!isWgslRecord(value)) throw new Error(`cannot access '.${name}' on a scalar`);
  // A direct field name (e.g. `.uvRect`, or a single swizzle letter like
  // `.x`) always wins over swizzle-parsing so named fields never get
  // misread as a run of swizzle letters.
  const direct = value[name];
  if (direct !== undefined) return direct;
  if (!/^[xyzw]{2,4}$/.test(name)) throw new Error(`unsupported member access '.${name}'`);
  const axisNames = ['x', 'y', 'z', 'w'] as const;
  const out: Record<string, WgslValue> = {};
  for (let i = 0; i < name.length; i++) {
    const srcAxis = name[i]!;
    const component = value[srcAxis];
    if (component === undefined) throw new Error(`value has no component '.${srcAxis}'`);
    out[axisNames[i]!] = component;
  }
  return out;
}

function applyScalar(op: '+' | '-' | '*' | '/' | '%', a: number, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case '%':
      return a % b;
  }
}

/** Component-wise for two matching-shaped vectors (recurses through nested records), scalar otherwise. */
function binaryOp(op: '+' | '-' | '*' | '/' | '%', a: WgslValue, b: WgslValue): WgslValue {
  if (typeof a === 'number' && typeof b === 'number') return applyScalar(op, a, b);
  if (isWgslRecord(a) && isWgslRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out: Record<string, WgslValue> = {};
    for (const key of keys) {
      const av = a[key];
      const bv = b[key];
      if (av === undefined || bv === undefined) throw new Error(`operand mismatch on component '${key}'`);
      out[key] = binaryOp(op, av, bv);
    }
    return out;
  }
  throw new Error('mixed scalar/vector operands are not supported by this minimal evaluator');
}

function mixFn(a: WgslValue, b: WgslValue, t: WgslValue): WgslValue {
  if (typeof a === 'number' && typeof b === 'number' && typeof t === 'number') return a + (b - a) * t;
  if (isWgslRecord(a) && isWgslRecord(b) && isWgslRecord(t)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(t)]);
    const out: Record<string, WgslValue> = {};
    for (const key of keys) {
      const av = a[key];
      const bv = b[key];
      const tv = t[key];
      if (av === undefined || bv === undefined || tv === undefined) throw new Error(`mix: missing component '${key}'`);
      out[key] = mixFn(av, bv, tv);
    }
    return out;
  }
  throw new Error('mix: mismatched operand shapes');
}

function callFunction(name: string, args: readonly WgslValue[]): WgslValue {
  if (name === 'mix') {
    const [a, b, t] = args;
    if (a === undefined || b === undefined || t === undefined) throw new Error('mix expects 3 arguments');
    return mixFn(a, b, t);
  }
  throw new Error(`unsupported function '${name}'`);
}

class ExprParser {
  private pos = 0;
  constructor(
    private readonly tokens: readonly Token[],
    private readonly scope: Readonly<Record<string, WgslValue>>,
  ) {}

  parse(): WgslValue {
    const value = this.parseAdditive();
    if (this.pos !== this.tokens.length) {
      throw new Error(`trailing tokens after expression (stopped at index ${this.pos})`);
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new Error('unexpected end of expression');
    this.pos++;
    return t;
  }

  private expectPunct(p: string): void {
    const t = this.next();
    if (t.kind !== 'punct' || t.text !== p) throw new Error(`expected '${p}', got '${t.text}'`);
  }

  private parseAdditive(): WgslValue {
    let value = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t && t.kind === 'punct' && (t.text === '+' || t.text === '-')) {
        this.next();
        value = binaryOp(t.text as '+' | '-', value, this.parseTerm());
      } else break;
    }
    return value;
  }

  private parseTerm(): WgslValue {
    let value = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t && t.kind === 'punct' && (t.text === '*' || t.text === '/' || t.text === '%')) {
        this.next();
        value = binaryOp(t.text as '*' | '/' | '%', value, this.parseUnary());
      } else break;
    }
    return value;
  }

  private parseUnary(): WgslValue {
    const t = this.peek();
    if (t && t.kind === 'punct' && t.text === '-') {
      this.next();
      const value = this.parseUnary();
      if (typeof value !== 'number') throw new Error('unary minus is only supported on scalars');
      return -value;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): WgslValue {
    let value = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t && t.kind === 'punct' && t.text === '.') {
        this.next();
        const member = this.next();
        if (member.kind !== 'ident') throw new Error('expected a member name after .');
        value = memberAccess(value, member.text);
      } else break;
    }
    return value;
  }

  private parsePrimary(): WgslValue {
    const t = this.next();
    if (t.kind === 'num') return Number.parseFloat(t.text);
    if (t.kind === 'ident') {
      const next = this.peek();
      if (next && next.kind === 'punct' && next.text === '(') {
        this.next();
        const args: WgslValue[] = [];
        const closed = this.peek();
        if (!(closed && closed.kind === 'punct' && closed.text === ')')) {
          args.push(this.parseAdditive());
          for (;;) {
            const comma = this.peek();
            if (comma && comma.kind === 'punct' && comma.text === ',') {
              this.next();
              args.push(this.parseAdditive());
            } else break;
          }
        }
        this.expectPunct(')');
        return callFunction(t.text, args);
      }
      const bound = this.scope[t.text];
      if (bound === undefined) throw new Error(`unbound identifier '${t.text}'`);
      return bound;
    }
    if (t.kind === 'punct' && t.text === '(') {
      const value = this.parseAdditive();
      this.expectPunct(')');
      return value;
    }
    throw new Error(`unexpected token '${t.text}'`);
  }
}

function evaluateWgslExpr(src: string, scope: Readonly<Record<string, WgslValue>>): WgslValue {
  return new ExprParser(tokenize(src), scope).parse();
}

describe('sprite.wgsl / tile.wgsl: instance struct matches the packer', () => {
  for (const [name, source] of [
    ['sprite.wgsl', spriteWgsl],
    ['tile.wgsl', tileWgsl],
  ] as const) {
    const clean = stripLineComments(source);

    it(`${name} declares the Instance struct fields the packer writes, in order (comments stripped first)`, () => {
      expect(clean).toContain('struct Instance {');
      expect(clean).toContain('transform0: vec4<f32>');
      expect(clean).toContain('transform1: vec4<f32>');
      expect(clean).toContain('uvRect: vec4<f32>');
      expect(clean).toContain('tint: vec4<f32>');

      // Field order must match INSTANCE_FIELD_FLOAT_OFFSETS (transform0 < transform1 < uvRect < tint).
      const iTransform0 = clean.indexOf('transform0: vec4<f32>');
      const iTransform1 = clean.indexOf('transform1: vec4<f32>');
      const iUvRect = clean.indexOf('uvRect: vec4<f32>');
      const iTint = clean.indexOf('tint: vec4<f32>');
      expect(iTransform0).toBeLessThan(iTransform1);
      expect(iTransform1).toBeLessThan(iUvRect);
      expect(iUvRect).toBeLessThan(iTint);
    });

    it(`${name} declares the camera uniform and both shader stages (comments stripped first)`, () => {
      expect(clean).toContain('struct Camera {');
      expect(clean).toContain('worldToClip: mat4x4<f32>');
      expect(clean).toContain('@vertex');
      expect(clean).toContain('fn vs_main(');
      expect(clean).toContain('@fragment');
      expect(clean).toContain('fn fs_main(');
      expect(clean).toContain('var<storage, read> instances: array<Instance>');
    });

    it(`${name} indexes its unit-quad corner/UV arrays with vertexIndex % 6u (matches a 2-triangle, 6-vertex, no-index-buffer draw)`, () => {
      const body = extractFunctionBody(clean, 'fn vs_main(');
      expect(body).toMatch(/\[\s*vertexIndex\s*%\s*6u\s*\]/);
    });
  }

  it('tile.wgsl derives uvOrigin/repeatCount from uvRect, and out.uv actually computes uvOrigin + localUv * repeatCount per-component', () => {
    const body = extractFunctionBody(stripLineComments(tileWgsl), 'fn vs_main(');

    // Structural: the two locals the final formula depends on must come from
    // the documented reinterpretation of uvRect (xy = origin, zw = repeat).
    expect(body).toMatch(/let\s+uvOrigin\s*=\s*inst\.uvRect\.xy\s*;/);
    expect(body).toMatch(/let\s+repeatCount\s*=\s*inst\.uvRect\.zw\s*;/);

    // Behavioral: evaluate the ACTUAL `out.uv = ...;` expression text found
    // in the file. If a mutation replaced it with e.g. `out.uv = localUv;`
    // (dropping the origin offset and the repeat scale entirely), `actual`
    // would equal `scope.localUv` (0.7, 0.4) instead of `expected` below —
    // this assertion is independently derived from the header comment's
    // documented rule, not copied from the implementation.
    const uvExpr = extractAssignmentExpr(body, 'out\\.uv');
    const scope: Record<string, WgslValue> = {
      uvOrigin: { x: 0.25, y: 0.1 },
      repeatCount: { x: 3, y: 2 },
      localUv: { x: 0.7, y: 0.4 },
    };
    const actual = evaluateWgslExpr(uvExpr, scope);
    const expected = { x: 0.25 + 0.7 * 3, y: 0.1 + 0.4 * 2 };
    expect(actual).toEqual(expected);
  });

  it('sprite.wgsl out.uv actually interpolates between uvRect’s top-left and bottom-right corners by localUv', () => {
    const body = extractFunctionBody(stripLineComments(spriteWgsl), 'fn vs_main(');
    const uvExpr = extractAssignmentExpr(body, 'out\\.uv');

    const scope: Record<string, WgslValue> = {
      inst: { uvRect: { x: 0.1, y: 0.2, z: 0.9, w: 0.8 } },
      localUv: { x: 0.25, y: 0.75 },
    };
    const actual = evaluateWgslExpr(uvExpr, scope);
    // Independently derived from the documented atlas-rect mapping: the
    // local unit-quad UV linearly interpolates between the rect's top-left
    // (u0,v0) and bottom-right (u1,v1) corners, per-component.
    const expected = {
      x: 0.1 + (0.9 - 0.1) * 0.25,
      y: 0.2 + (0.8 - 0.2) * 0.75,
    };
    expect(actual).toEqual(expected);
  });

  it('post.wgsl: a fullscreen triangle with no vertex buffer, sampling the source texture into the frame', () => {
    const clean = stripLineComments(postWgsl);
    expect(clean).toContain('@vertex');
    expect(clean).toContain('fn vs_main(');
    expect(clean).toContain('@fragment');
    expect(clean).toContain('fn fs_main(');
    expect(clean).toContain('var sourceTexture: texture_2d<f32>');
    const body = extractFunctionBody(clean, 'fn vs_main(');
    expect(body).toMatch(/\[\s*vertexIndex\s*%\s*3u\s*\]/);
  });
});
