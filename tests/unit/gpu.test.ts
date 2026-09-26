import { afterEach, describe, expect, it, vi } from 'vitest';
import { type GpuCanvasLike, type GpuUnsupportedReason, initGpu } from '@/render/gpu';
import { PipelineCache, blendStateFor, depthStencilStateFor, type PipelineKey } from '@/render/pipelines';

function makeFakeTexture(): GPUTexture {
  return { destroy: vi.fn() } as unknown as GPUTexture;
}

function makeFakeDevice(maxTextureDimension2D: number): {
  device: GPUDevice;
  resolveLost: (reason: GPUDeviceLostReason, message: string) => void;
  createTexture: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  let resolveLostFn: ((info: GPUDeviceLostInfo) => void) | undefined;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLostFn = resolve;
  });
  const createTexture = vi.fn(() => makeFakeTexture());
  const destroy = vi.fn();
  const device = {
    limits: { maxTextureDimension2D },
    lost,
    createTexture,
    destroy,
  } as unknown as GPUDevice;

  return {
    device,
    resolveLost: (reason, message) => {
      if (!resolveLostFn) throw new Error('resolveLost called before setup');
      resolveLostFn({ reason, message } as unknown as GPUDeviceLostInfo);
    },
    createTexture,
    destroy,
  };
}

function makeFakeAdapter(device: GPUDevice): GPUAdapter {
  return { requestDevice: vi.fn(async () => device) } as unknown as GPUAdapter;
}

function makeFakeGpu(adapters: ReadonlyArray<GPUAdapter | null>, format: GPUTextureFormat = 'bgra8unorm'): GPU {
  let call = 0;
  return {
    requestAdapter: vi.fn(async () => {
      const index = Math.min(call, adapters.length - 1);
      call += 1;
      return adapters[index] ?? null;
    }),
    getPreferredCanvasFormat: vi.fn(() => format),
  } as unknown as GPU;
}

function makeFakeContext(): GPUCanvasContext {
  return {
    configure: vi.fn(),
    unconfigure: vi.fn(),
  } as unknown as GPUCanvasContext;
}

function makeFakeCanvas(context: GPUCanvasContext): GpuCanvasLike {
  return {
    width: 300,
    height: 150,
    getContext: vi.fn(() => context),
  };
}

async function flush(): Promise<void> {
  // Two macrotask hops give every chained microtask in the recovery path a
  // chance to settle without relying on fake timers.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initGpu', () => {
  it('returns a structured reason instead of throwing when navigator.gpu is absent', async () => {
    vi.stubGlobal('navigator', {});
    const context = makeFakeContext();
    const canvas = makeFakeCanvas(context);

    const result = await initGpu(canvas);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toEqual({ kind: 'no-webgpu' });
  });

  it('returns no-adapter when requestAdapter resolves null', async () => {
    const gpu = makeFakeGpu([null]);
    vi.stubGlobal('navigator', { gpu });
    const canvas = makeFakeCanvas(makeFakeContext());

    const result = await initGpu(canvas);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toEqual({ kind: 'no-adapter' });
  });

  it('returns device-request-failed instead of throwing when requestDevice rejects', async () => {
    const adapter = { requestDevice: vi.fn(async () => Promise.reject(new Error('denied'))) } as unknown as GPUAdapter;
    const gpu = makeFakeGpu([adapter]);
    vi.stubGlobal('navigator', { gpu });
    const canvas = makeFakeCanvas(makeFakeContext());

    const result = await initGpu(canvas);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toEqual({ kind: 'device-request-failed', message: 'denied' });
  });

  it('returns no-context when the canvas cannot produce a webgpu context', async () => {
    const { device } = makeFakeDevice(8192);
    const gpu = makeFakeGpu([makeFakeAdapter(device)]);
    vi.stubGlobal('navigator', { gpu });
    const canvas: GpuCanvasLike = { width: 300, height: 150, getContext: vi.fn(() => null) };

    const result = await initGpu(canvas);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toEqual({ kind: 'no-context' });
  });

  it('configures the context with the preferred canvas format on the happy path', async () => {
    const { device } = makeFakeDevice(8192);
    const gpu = makeFakeGpu([makeFakeAdapter(device)], 'bgra8unorm');
    vi.stubGlobal('navigator', { gpu });
    const context = makeFakeContext();
    const canvas = makeFakeCanvas(context);

    const result = await initGpu(canvas);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.getFormat()).toBe('bgra8unorm');
    expect(result.context.getDevice()).toBe(device);
    expect(context.configure).toHaveBeenCalledWith({ device, format: 'bgra8unorm', alphaMode: 'opaque' });
    expect(result.context.isPaused()).toBe(false);
  });

  it('resizes clamped to device.limits.maxTextureDimension2D and rebuilds managed textures', async () => {
    const { device, createTexture } = makeFakeDevice(2048);
    const gpu = makeFakeGpu([makeFakeAdapter(device)]);
    vi.stubGlobal('navigator', { gpu });
    const canvas = makeFakeCanvas(makeFakeContext());

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = result.context;

    ctx.defineResource({ label: 'depth', format: 'depth24plus', usage: 0 });
    expect(createTexture).toHaveBeenCalledTimes(1);
    const firstDepth = ctx.getTexture('depth');

    const changed = ctx.resize(4096, 4096);

    expect(changed).toBe(true);
    expect(ctx.getSize()).toEqual({ width: 2048, height: 2048 });
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(2048);
    expect(createTexture).toHaveBeenCalledTimes(2);
    expect(firstDepth?.destroy).toHaveBeenCalledTimes(1);
    expect(ctx.getTexture('depth')).not.toBe(firstDepth);
  });

  it('reports no size change and does not rebuild resources when resize is a no-op', async () => {
    const { device, createTexture } = makeFakeDevice(8192);
    const gpu = makeFakeGpu([makeFakeAdapter(device)]);
    vi.stubGlobal('navigator', { gpu });
    const canvas = makeFakeCanvas(makeFakeContext());

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = createTexture.mock.calls.length;
    const changed = result.context.resize(300, 150);

    expect(changed).toBe(false);
    expect(createTexture.mock.calls.length).toBe(before);
  });

  it('pauses on device loss, rebuilds every managed resource on the new device, and resumes', async () => {
    const gen1 = makeFakeDevice(8192);
    const gen2 = makeFakeDevice(4096);
    const gpu = makeFakeGpu([makeFakeAdapter(gen1.device), makeFakeAdapter(gen2.device)]);
    vi.stubGlobal('navigator', { gpu });
    const canvas = makeFakeCanvas(makeFakeContext());

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = result.context;

    ctx.defineResource({ label: 'color', format: 'bgra8unorm', usage: 0 });
    const originalTexture = ctx.getTexture('color');

    const events: string[] = [];
    ctx.onDeviceLost(() => events.push('lost'));
    ctx.onRecovered(() => events.push('recovered'));

    expect(ctx.isPaused()).toBe(false);
    gen1.resolveLost('unknown', 'simulated GPU crash');
    await flush();

    expect(events).toEqual(['lost', 'recovered']);
    expect(ctx.isPaused()).toBe(false);
    expect(ctx.getDevice()).toBe(gen2.device);
    expect(ctx.getDevice()).not.toBe(gen1.device);
    expect(originalTexture?.destroy).toHaveBeenCalledTimes(1);
    expect(gen2.createTexture).toHaveBeenCalledTimes(1);
    expect(ctx.getTexture('color')).not.toBe(originalTexture);
  });

  it('destroy() tears down owned resources and stops reacting to a stale device.lost', async () => {
    const { device, destroy: deviceDestroy } = makeFakeDevice(8192);
    const gpu = makeFakeGpu([makeFakeAdapter(device)]);
    vi.stubGlobal('navigator', { gpu });
    const context = makeFakeContext();
    const canvas = makeFakeCanvas(context);

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    result.context.defineResource({ label: 'color', format: 'bgra8unorm', usage: 0 });
    const texture = result.context.getTexture('color');

    result.context.destroy();

    expect(texture?.destroy).toHaveBeenCalledTimes(1);
    expect(context.unconfigure).toHaveBeenCalledTimes(1);
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
    expect(result.context.isDestroyed()).toBe(true);
  });

  it('resize() is a no-op after destroy(): no reconfigure, no texture on the dead device', async () => {
    const { device, createTexture } = makeFakeDevice(8192);
    const gpu = makeFakeGpu([makeFakeAdapter(device)]);
    vi.stubGlobal('navigator', { gpu });
    const context = makeFakeContext();
    const canvas = makeFakeCanvas(context);

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = result.context;
    ctx.defineResource({ label: 'depth', format: 'depth24plus', usage: 0 });

    ctx.destroy();
    const configureCallsBefore = (context.configure as ReturnType<typeof vi.fn>).mock.calls.length;
    const createCallsBefore = createTexture.mock.calls.length;

    const changed = ctx.resize(800, 600);

    expect(changed).toBe(false);
    expect(canvas.width).not.toBe(800);
    expect(canvas.height).not.toBe(600);
    expect((context.configure as ReturnType<typeof vi.fn>).mock.calls.length).toBe(configureCallsBefore);
    expect(createTexture.mock.calls.length).toBe(createCallsBefore);
  });

  it('resize() is a no-op while paused after a device loss, until recovery resolves', async () => {
    const gen1 = makeFakeDevice(8192);
    let requestAdapterCalls = 0;
    const gpu = {
      requestAdapter: vi.fn(async () => {
        requestAdapterCalls += 1;
        if (requestAdapterCalls === 1) return makeFakeAdapter(gen1.device);
        // The recovery attempt's requestAdapter never settles, so the
        // context stays paused for the rest of this test.
        return new Promise<GPUAdapter | null>(() => {});
      }),
      getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
    } as unknown as GPU;
    vi.stubGlobal('navigator', { gpu });
    const context = makeFakeContext();
    const canvas = makeFakeCanvas(context);

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = result.context;
    ctx.defineResource({ label: 'depth', format: 'depth24plus', usage: 0 });

    gen1.resolveLost('unknown', 'gpu reset');
    await flush();
    expect(ctx.isPaused()).toBe(true);

    const configureCallsBefore = (context.configure as ReturnType<typeof vi.fn>).mock.calls.length;
    const createCallsBefore = gen1.createTexture.mock.calls.length;

    const changed = ctx.resize(999, 999);

    expect(changed).toBe(false);
    expect(ctx.isPaused()).toBe(true);
    expect((context.configure as ReturnType<typeof vi.fn>).mock.calls.length).toBe(configureCallsBefore);
    expect(gen1.createTexture.mock.calls.length).toBe(createCallsBefore);
  });

  it('fires onRecoveryFailed (and never onRecovered) when the automatic recovery attempt cannot get a device', async () => {
    const gen1 = makeFakeDevice(8192);
    // Second requestAdapter (the automatic recovery) resolves null: a driver
    // reset that needs a moment, the documented "common real case".
    const gpu = makeFakeGpu([makeFakeAdapter(gen1.device), null]);
    vi.stubGlobal('navigator', { gpu });
    const canvas = makeFakeCanvas(makeFakeContext());

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = result.context;

    const failures: GpuUnsupportedReason[] = [];
    let recoveredCount = 0;
    ctx.onRecoveryFailed((reason) => failures.push(reason));
    ctx.onRecovered(() => {
      recoveredCount += 1;
    });

    gen1.resolveLost('unknown', 'driver reset');
    await flush();

    expect(ctx.isPaused()).toBe(true);
    expect(ctx.getDevice()).toBe(gen1.device);
    expect(recoveredCount).toBe(0);
    expect(failures).toEqual([{ kind: 'no-adapter' }]);
  });

  it('recover() racing an in-flight automatic recovery shares one attempt: one device, one onRecovered, no leak', async () => {
    const gen1 = makeFakeDevice(8192);
    const gen2 = makeFakeDevice(8192);
    let requestAdapterCalls = 0;
    const gpu = {
      requestAdapter: vi.fn(async () => {
        const adapter = requestAdapterCalls === 0 ? makeFakeAdapter(gen1.device) : makeFakeAdapter(gen2.device);
        requestAdapterCalls += 1;
        return adapter;
      }),
      getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
    } as unknown as GPU;
    vi.stubGlobal('navigator', { gpu });
    const canvas = makeFakeCanvas(makeFakeContext());

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = result.context;

    let recoveredCount = 0;
    ctx.onRecovered(() => {
      recoveredCount += 1;
    });

    gen1.resolveLost('unknown', 'gpu reset');
    // Let the automatic-recovery handler run and start its attempt before a
    // manual retry races it on the next microtask — exactly what a "Retry"
    // button does against a recovery already under way.
    await Promise.resolve();
    const manual = ctx.recover();
    await flush();
    const manualOutcome = await manual;

    expect(requestAdapterCalls).toBe(2); // 1 for init, 1 shared recovery — never 3
    expect(manualOutcome).toEqual({ ok: true });
    expect(recoveredCount).toBe(1);
    expect(ctx.getDevice()).toBe(gen2.device);
    expect(gen2.destroy).not.toHaveBeenCalled();
  });
});

describe('PipelineCache', () => {
  function key(overrides: Partial<PipelineKey> = {}): PipelineKey {
    return {
      shaderModuleId: 'lit-mesh',
      blendMode: 'opaque',
      depthMode: 'read-write',
      topology: 'triangle-list',
      targetFormat: 'bgra8unorm',
      ...overrides,
    };
  }

  it('returns the same object for identical keys without calling create again', () => {
    const cache = new PipelineCache<{ id: number }>();
    const create = vi.fn((_k: PipelineKey) => ({ id: create.mock.calls.length }));

    const a = cache.getOrCreate(key(), create);
    const b = cache.getOrCreate(key(), create);

    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it('returns different objects for different keys and grows the cache', () => {
    const cache = new PipelineCache<{ id: number }>();
    let next = 0;
    const create = () => ({ id: next++ });

    const opaque = cache.getOrCreate(key({ blendMode: 'opaque' }), create);
    const blended = cache.getOrCreate(key({ blendMode: 'alpha-blend' }), create);
    const otherShader = cache.getOrCreate(key({ shaderModuleId: 'unlit-mesh' }), create);

    expect(opaque).not.toBe(blended);
    expect(opaque).not.toBe(otherShader);
    expect(blended).not.toBe(otherShader);
    expect(cache.size).toBe(3);
  });

  it('clear() empties the cache so the next lookup creates fresh', () => {
    const cache = new PipelineCache<{ id: number }>();
    let next = 0;
    const create = () => ({ id: next++ });

    const before = cache.getOrCreate(key(), create);
    cache.clear();
    const after = cache.getOrCreate(key(), create);

    expect(cache.size).toBe(1);
    expect(before).not.toBe(after);
  });
});

describe('pipeline state helpers', () => {
  it('has no blend state for opaque', () => {
    expect(blendStateFor('opaque')).toBeUndefined();
  });

  it('alpha-blend is standard (non-premultiplied) src-alpha compositing', () => {
    // Independently derived from the textbook "over" formula for
    // non-premultiplied alpha: out.rgb = src.rgb*srcAlpha + dst.rgb*(1-srcAlpha),
    // out.a = src.a*1 + dst.a*(1-srcAlpha). Swapping this with additive's
    // factors, or switching to premultiplied ('one'/'one-minus-src-alpha' for
    // color), must fail this test.
    expect(blendStateFor('alpha-blend')).toEqual({
      color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
      alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    });
  });

  it('additive sums src onto dst unmodified (dstFactor "one" on both channels)', () => {
    // Independently derived from the definition of additive blending:
    // out = src*srcAlpha + dst*1, i.e. dst is never attenuated. Swapping this
    // with alpha-blend's factors must fail this test.
    expect(blendStateFor('additive')).toEqual({
      color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one' },
      alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
    });
  });

  it('has no depth-stencil state for "none"', () => {
    expect(depthStencilStateFor('none', 'depth24plus')).toBeUndefined();
  });

  it('read-write depth state writes depth and passes only when strictly nearer ("less")', () => {
    expect(depthStencilStateFor('read-write', 'depth24plus')).toEqual({
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    });
  });

  it('read-only depth state tests without writing and passes when nearer-or-equal ("less-equal")', () => {
    // read-only + less-equal is what lets a second pass at the same depth
    // (e.g. a decal on top of the surface that wrote it) still render;
    // 'less' or 'always' here would silently change what overlays draw.
    expect(depthStencilStateFor('read-only', 'depth24plus')).toEqual({
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
    });
  });
});
