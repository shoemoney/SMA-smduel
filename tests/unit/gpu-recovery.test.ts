import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecoveryOrchestrator, type RecoveryState, type RenderLoopController } from '@/ui/gpu-recovery';
import { type GpuCanvasLike, type GpuUnsupportedReason, initGpu } from '@/render/gpu';

// ---------------------------------------------------------------------------
// A hand-built fake GpuContext: the orchestrator only ever touches the
// public GpuContext surface, so most transitions can be driven directly by
// invoking the handler it registered, without a real device/adapter/canvas.
// ---------------------------------------------------------------------------

interface FakeGpuContext {
  isPaused: ReturnType<typeof vi.fn>;
  getDevice: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  recover: ReturnType<typeof vi.fn>;
  onDeviceLost: ReturnType<typeof vi.fn>;
  onRecovered: ReturnType<typeof vi.fn>;
  onRecoveryFailed: ReturnType<typeof vi.fn>;
  fireLost: () => void;
  fireRecovered: () => void;
  fireFailed: (reason: GpuUnsupportedReason) => void;
  lostUnsub: ReturnType<typeof vi.fn>;
  recoveredUnsub: ReturnType<typeof vi.fn>;
  failedUnsub: ReturnType<typeof vi.fn>;
}

function makeFakeGpuContext(opts: { paused?: boolean; maxTextureDimension2D?: number } = {}): FakeGpuContext {
  let lostHandler: (() => void) | undefined;
  let recoveredHandler: (() => void) | undefined;
  let failedHandler: ((reason: GpuUnsupportedReason) => void) | undefined;
  const lostUnsub = vi.fn();
  const recoveredUnsub = vi.fn();
  const failedUnsub = vi.fn();

  return {
    isPaused: vi.fn(() => opts.paused ?? false),
    getDevice: vi.fn(() => ({ limits: { maxTextureDimension2D: opts.maxTextureDimension2D ?? 8192 } })),
    resize: vi.fn(() => true),
    recover: vi.fn(async () => ({ ok: true }) as const),
    onDeviceLost: vi.fn((handler: () => void) => {
      lostHandler = handler;
      return lostUnsub;
    }),
    onRecovered: vi.fn((handler: () => void) => {
      recoveredHandler = handler;
      return recoveredUnsub;
    }),
    onRecoveryFailed: vi.fn((handler: (reason: GpuUnsupportedReason) => void) => {
      failedHandler = handler;
      return failedUnsub;
    }),
    fireLost: () => lostHandler?.(),
    fireRecovered: () => recoveredHandler?.(),
    fireFailed: (reason: GpuUnsupportedReason) => failedHandler?.(reason),
    lostUnsub,
    recoveredUnsub,
    failedUnsub,
  };
}

function makeLoop(): RenderLoopController & { pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> } {
  return { pause: vi.fn(), resume: vi.fn() };
}

describe('createRecoveryOrchestrator (mocked GpuContext)', () => {
  it('starts RUNNING when the gpu context is not paused, without touching the loop or recovering anything', () => {
    const gpu = makeFakeGpuContext({ paused: false });
    const loop = makeLoop();

    const orch = createRecoveryOrchestrator(gpu as never, loop);

    expect(orch.getState()).toBe('running');
    expect(orch.getLastFailureReason()).toBeUndefined();
    // A construction-time false positive here (e.g. always pausing the loop
    // regardless of the context's actual paused state) would only ever show
    // up as an imbalanced resume() later — assert the ctor itself is inert.
    expect(loop.pause).not.toHaveBeenCalled();
    expect(loop.resume).not.toHaveBeenCalled();
    expect(gpu.recover).not.toHaveBeenCalled();
  });

  it('starts RECOVERING when attached to an already-paused context', () => {
    const gpu = makeFakeGpuContext({ paused: true });
    const loop = makeLoop();

    const orch = createRecoveryOrchestrator(gpu as never, loop);

    expect(orch.getState()).toBe('recovering');
  });

  it('an already-paused context at attach time is never resumed by this orchestrator: it never paused it', () => {
    // Mirrors gpu.ts attaching to a context whose device was already lost
    // before recovery.ts subscribed (see the docblock at createRecoveryOrchestrator's
    // definition) — there is no matching loop.pause() call for onRecovered to balance.
    const gpu = makeFakeGpuContext({ paused: true });
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);
    expect(orch.getState()).toBe('recovering');

    gpu.fireRecovered();

    expect(orch.getState()).toBe('running');
    expect(loop.pause).not.toHaveBeenCalled();
    expect(loop.resume).not.toHaveBeenCalled();
  });

  it('drives every transition: RUNNING -> LOST -> RECOVERING -> RUNNING, pausing then resuming the loop', () => {
    const gpu = makeFakeGpuContext();
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);
    const seen: RecoveryState[] = [];
    orch.onStateChange((state) => seen.push(state));

    gpu.fireLost();
    expect(loop.pause).toHaveBeenCalledTimes(1);
    expect(loop.resume).not.toHaveBeenCalled();
    expect(seen).toEqual(['lost', 'recovering']);
    expect(orch.getState()).toBe('recovering');

    gpu.fireRecovered();
    expect(seen).toEqual(['lost', 'recovering', 'running']);
    expect(orch.getState()).toBe('running');
    expect(loop.resume).toHaveBeenCalledTimes(1);
    expect(orch.getLastFailureReason()).toBeUndefined();
  });

  it('drives the FAILED transition and leaves the loop paused (never resumed) until a retry succeeds', () => {
    const gpu = makeFakeGpuContext();
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);
    const seen: RecoveryState[] = [];
    orch.onStateChange((state) => seen.push(state));

    gpu.fireLost();
    gpu.fireFailed({ kind: 'no-adapter' });

    expect(seen).toEqual(['lost', 'recovering', 'failed']);
    expect(orch.getState()).toBe('failed');
    expect(orch.getLastFailureReason()).toEqual({ kind: 'no-adapter' });
    expect(loop.resume).not.toHaveBeenCalled();

    gpu.fireRecovered();
    expect(seen).toEqual(['lost', 'recovering', 'failed', 'running']);
    expect(orch.getLastFailureReason()).toBeUndefined();
    expect(loop.resume).toHaveBeenCalledTimes(1);
  });

  it('onStateChange guards same-state no-ops: retrying while already RECOVERING does not notify subscribers', () => {
    // Starts RECOVERING (attached to an already-paused context), so retry()'s
    // own `setState('recovering')` is a same-state transition — exactly the
    // no-op setState()'s `if (next === state) return;` guard exists for.
    const gpu = makeFakeGpuContext({ paused: true });
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);
    expect(orch.getState()).toBe('recovering');
    const seen: RecoveryState[] = [];
    orch.onStateChange((state) => seen.push(state));

    void orch.retry();

    // If the guard were removed, this same-state re-entry into 'recovering'
    // would notify subscribers with a state they were already told about.
    expect(seen).toEqual([]);
  });

  it('an unsubscribed handler never fires again, even for a genuine later transition', () => {
    const gpu = makeFakeGpuContext();
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);
    const seen: RecoveryState[] = [];
    const unsubscribe = orch.onStateChange((state) => seen.push(state));

    gpu.fireLost();
    unsubscribe();
    gpu.fireRecovered();

    expect(seen).toEqual(['lost', 'recovering']);
    expect(orch.getState()).toBe('running'); // the orchestrator itself still transitioned
  });

  it('retry() delegates to gpu.recover() and is a state no-op when not paused', async () => {
    const gpu = makeFakeGpuContext({ paused: false });
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);
    const seen: RecoveryState[] = [];
    orch.onStateChange((state) => seen.push(state));

    const outcome = await orch.retry();

    expect(outcome).toEqual({ ok: true });
    expect(gpu.recover).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]); // never announced RECOVERING for a call that did no new work
  });

  it('retry() while already RECOVERING (an automatic attempt in flight) does not re-announce RECOVERING', () => {
    const gpu = makeFakeGpuContext({ paused: true });
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);
    expect(orch.getState()).toBe('recovering');
    const seen: RecoveryState[] = [];
    orch.onStateChange((state) => seen.push(state));

    void orch.retry();

    expect(seen).toEqual([]);
    expect(gpu.recover).toHaveBeenCalledTimes(1);
  });

  it('retry() while FAILED announces RECOVERING before delegating', () => {
    const gpu = makeFakeGpuContext();
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);
    gpu.fireLost();
    gpu.fireFailed({ kind: 'no-adapter' });
    gpu.isPaused = vi.fn(() => true);
    const seen: RecoveryState[] = [];
    orch.onStateChange((state) => seen.push(state));

    void orch.retry();

    expect(seen).toEqual(['recovering']);
  });

  it('retry() transitions to FAILED when gpu.recover() resolves ok:false WITHOUT the onRecoveryFailed hook having fired', async () => {
    // gpu.ts's own recover() can bail out early (e.g. the context was
    // destroyed mid-recovery) and resolve `{ ok: false }` without ever
    // running the attempt that would normally fire onRecoveryFailed — retry()
    // must not rely solely on that hook, or the orchestrator is stuck
    // RECOVERING forever with no failure reason and no way out.
    const gpu = makeFakeGpuContext({ paused: true });
    gpu.recover = vi.fn(async () => ({ ok: false, reason: { kind: 'no-context' } }) as const);
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);
    expect(orch.getState()).toBe('recovering');

    const outcome = await orch.retry();

    expect(outcome).toEqual({ ok: false, reason: { kind: 'no-context' } });
    expect(orch.getState()).toBe('failed');
    expect(orch.getLastFailureReason()).toEqual({ kind: 'no-context' });
    expect(loop.resume).not.toHaveBeenCalled();
  });

  it('resize(): DPR-scales the CSS size, clamps to device.limits.maxTextureDimension2D, and forwards clamped pixels', () => {
    const gpu = makeFakeGpuContext({ maxTextureDimension2D: 2048 });
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);

    // 1200 * 2 = 2400, clamped down to the 2048 device limit.
    const changed = orch.resize(1200, 800, 2);

    expect(changed).toBe(true);
    expect(gpu.resize).toHaveBeenCalledWith(2048, 1600);
  });

  it('resize(): a non-finite or non-positive devicePixelRatio is treated as 1', () => {
    const gpu = makeFakeGpuContext({ maxTextureDimension2D: 8192 });
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);

    orch.resize(400, 300, Number.NaN);
    expect(gpu.resize).toHaveBeenLastCalledWith(400, 300);

    orch.resize(400, 300, -1);
    expect(gpu.resize).toHaveBeenLastCalledWith(400, 300);

    orch.resize(400, 300, 0);
    expect(gpu.resize).toHaveBeenLastCalledWith(400, 300);
  });

  it('resize(): a devicePixelRatio above 2 is capped at 2, matching gpu.ts\'s own resize path', () => {
    const gpu = makeFakeGpuContext({ maxTextureDimension2D: 16384 });
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);

    // 1000 * 3 = 3000 uncapped; capped to dpr 2 first, so 1000*2 = 2000.
    orch.resize(1000, 500, 3);
    expect(gpu.resize).toHaveBeenCalledWith(2000, 1000);
  });

  it('destroy() unsubscribes from every gpu hook exactly once', () => {
    const gpu = makeFakeGpuContext();
    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(gpu as never, loop);

    orch.destroy();

    expect(gpu.lostUnsub).toHaveBeenCalledTimes(1);
    expect(gpu.recoveredUnsub).toHaveBeenCalledTimes(1);
    expect(gpu.failedUnsub).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end tests against the REAL gpu.ts, with a fake GPU/adapter/device/
// canvas (no real GPU available in this test environment) — these prove the
// orchestrator's wiring holds against the actual recovery implementation,
// not just against a hand-built stand-in for its interface.
// ---------------------------------------------------------------------------

function makeFakeTexture(): GPUTexture {
  return { destroy: vi.fn() } as unknown as GPUTexture;
}

function makeFakeDevice(maxTextureDimension2D: number): {
  device: GPUDevice;
  resolveLost: (reason: GPUDeviceLostReason, message: string) => void;
  createTexture: ReturnType<typeof vi.fn>;
} {
  let resolveLostFn: ((info: GPUDeviceLostInfo) => void) | undefined;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLostFn = resolve;
  });
  const createTexture = vi.fn(() => makeFakeTexture());
  const device = {
    limits: { maxTextureDimension2D },
    lost,
    createTexture,
    destroy: vi.fn(),
  } as unknown as GPUDevice;

  return {
    device,
    resolveLost: (reason, message) => {
      if (!resolveLostFn) throw new Error('resolveLost called before setup');
      resolveLostFn({ reason, message } as unknown as GPUDeviceLostInfo);
    },
    createTexture,
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
  return { configure: vi.fn(), unconfigure: vi.fn() } as unknown as GPUCanvasContext;
}

function makeFakeCanvas(context: GPUCanvasContext): GpuCanvasLike {
  return { width: 300, height: 150, getContext: vi.fn(() => context) };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createRecoveryOrchestrator (real gpu.ts, fake device)', () => {
  it('end to end: device loss pauses the loop, automatic recovery rebuilds resources, RUNNING resumes it', async () => {
    const gen1 = makeFakeDevice(8192);
    const gen2 = makeFakeDevice(8192);
    const gpu = makeFakeGpu([makeFakeAdapter(gen1.device), makeFakeAdapter(gen2.device)]);
    vi.stubGlobal('navigator', { gpu });
    const canvas = makeFakeCanvas(makeFakeContext());

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.context.defineResource({ label: 'color', format: 'bgra8unorm', usage: 0 });
    const before = result.context.getTexture('color');

    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(result.context, loop);
    const seen: RecoveryState[] = [];
    orch.onStateChange((state) => seen.push(state));

    gen1.resolveLost('unknown', 'simulated GPU crash');
    await flush();

    expect(seen).toEqual(['lost', 'recovering', 'running']);
    expect(orch.getState()).toBe('running');
    expect(loop.pause).toHaveBeenCalledTimes(1);
    expect(loop.resume).toHaveBeenCalledTimes(1);
    expect(before?.destroy).toHaveBeenCalledTimes(1);
    expect(result.context.getTexture('color')).not.toBe(before);
    expect(result.context.getDevice()).toBe(gen2.device);
  });

  it('end to end: automatic recovery failure -> FAILED, loop stays paused; a later retry() succeeds', async () => {
    const gen1 = makeFakeDevice(8192);
    const gen2 = makeFakeDevice(8192);
    // requestAdapter: init succeeds, automatic recovery resolves null (a
    // driver reset still settling), a later manual retry succeeds.
    const gpu = makeFakeGpu([makeFakeAdapter(gen1.device), null, makeFakeAdapter(gen2.device)]);
    vi.stubGlobal('navigator', { gpu });
    const canvas = makeFakeCanvas(makeFakeContext());

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(result.context, loop);
    const seen: RecoveryState[] = [];
    orch.onStateChange((state) => seen.push(state));

    gen1.resolveLost('unknown', 'driver reset');
    await flush();

    expect(seen).toEqual(['lost', 'recovering', 'failed']);
    expect(orch.getState()).toBe('failed');
    expect(orch.getLastFailureReason()).toEqual({ kind: 'no-adapter' });
    expect(loop.resume).not.toHaveBeenCalled();

    const outcome = await orch.retry();
    await flush();

    expect(outcome).toEqual({ ok: true });
    expect(seen).toEqual(['lost', 'recovering', 'failed', 'recovering', 'running']);
    expect(orch.getState()).toBe('running');
    expect(loop.resume).toHaveBeenCalledTimes(1);
    expect(result.context.getDevice()).toBe(gen2.device);
  });

  it('a loss during recovery (manual retry racing the automatic attempt) is handled ONCE: one device, one RUNNING, no double rebuild', async () => {
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
    result.context.defineResource({ label: 'color', format: 'bgra8unorm', usage: 0 });

    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(result.context, loop);
    const seen: RecoveryState[] = [];
    orch.onStateChange((state) => seen.push(state));

    gen1.resolveLost('unknown', 'gpu reset');
    // Let the automatic-recovery path start its attempt before a manual
    // retry races it on the next microtask, mirroring exactly what a
    // "Retry" button does against a recovery already under way.
    await Promise.resolve();
    const manual = orch.retry();
    await flush();
    const manualOutcome = await manual;

    // init (1) + one shared recovery attempt (1) — never a second, racing
    // requestAdapter for the manual retry.
    expect(requestAdapterCalls).toBe(2);
    expect(manualOutcome).toEqual({ ok: true });
    expect(seen).toEqual(['lost', 'recovering', 'running']);
    expect(loop.pause).toHaveBeenCalledTimes(1);
    expect(loop.resume).toHaveBeenCalledTimes(1);
    expect(result.context.getDevice()).toBe(gen2.device);
    expect(gen2.createTexture).toHaveBeenCalledTimes(1); // rebuilt once, not twice
  });

  it('resize(): reconfigures the context and recreates managed textures, clamped to the device limit, DPR-scaled', async () => {
    const { device, createTexture } = makeFakeDevice(2048);
    const gpu = makeFakeGpu([makeFakeAdapter(device)]);
    vi.stubGlobal('navigator', { gpu });
    const context = makeFakeContext();
    const canvas = makeFakeCanvas(context);

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.context.defineResource({ label: 'depth', format: 'depth24plus', usage: 0 });
    const before = result.context.getTexture('depth');

    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(result.context, loop);

    // CSS 1200x1200 at 2x DPR = 2400x2400, clamped to the 2048 device limit.
    const changed = orch.resize(1200, 1200, 2);

    expect(changed).toBe(true);
    expect(result.context.getSize()).toEqual({ width: 2048, height: 2048 });
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(2048);
    expect(before?.destroy).toHaveBeenCalledTimes(1);
    expect(result.context.getTexture('depth')).not.toBe(before);
    expect(createTexture).toHaveBeenCalledTimes(2); // once on define, once on resize rebuild
  });

  it('resize() while paused (device lost, recovery pending) is a no-op — matches gpu.resize()', async () => {
    const gen1 = makeFakeDevice(8192);
    const gpu = {
      requestAdapter: vi.fn(async () => {
        // The very first call resolves the init adapter; every later call
        // (the automatic recovery attempt) never settles, keeping the
        // context paused for the rest of this test.
        return makeFakeAdapter(gen1.device);
      }),
      getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
    } as unknown as GPU;
    let first = true;
    const realRequestAdapter = gpu.requestAdapter;
    gpu.requestAdapter = vi.fn(async () => {
      if (first) {
        first = false;
        return realRequestAdapter();
      }
      return new Promise<GPUAdapter | null>(() => {});
    });
    vi.stubGlobal('navigator', { gpu });
    const context = makeFakeContext();
    const canvas = makeFakeCanvas(context);

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(result.context, loop);

    gen1.resolveLost('unknown', 'gpu reset');
    await flush();
    expect(result.context.isPaused()).toBe(true);

    // `changed === false` alone is satisfied just as well by recovery.resize()
    // never calling gpu.resize() at all as by it forwarding to a gpu.resize()
    // that itself no-ops because paused — spy on the real gpu.resize() to
    // pin down which one actually happened: it must still be CALLED (with the
    // already-DPR-scaled, clamped pixel size), just not producing a new
    // reconfigure/rebuild because the underlying context is paused.
    const resizeSpy = vi.spyOn(result.context, 'resize');
    const configureCallsBefore = (context.configure as ReturnType<typeof vi.fn>).mock.calls.length;
    const changed = orch.resize(999, 999, 1);

    expect(resizeSpy).toHaveBeenCalledWith(999, 999);
    expect(changed).toBe(resizeSpy.mock.results[0]?.value);
    expect(changed).toBe(false);
    expect((context.configure as ReturnType<typeof vi.fn>).mock.calls.length).toBe(configureCallsBefore);
  });

  it('retry() reaches FAILED (not stuck RECOVERING forever) when the context is destroyed mid-recovery', async () => {
    const gen1 = makeFakeDevice(8192);
    const gpu = {
      requestAdapter: vi.fn(async () => makeFakeAdapter(gen1.device)),
      getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
    } as unknown as GPU;
    let first = true;
    const realRequestAdapter = gpu.requestAdapter;
    gpu.requestAdapter = vi.fn(async () => {
      if (first) {
        first = false;
        return realRequestAdapter();
      }
      // The automatic recovery attempt's requestAdapter never settles.
      return new Promise<GPUAdapter | null>(() => {});
    });
    vi.stubGlobal('navigator', { gpu });
    const canvas = makeFakeCanvas(makeFakeContext());

    const result = await initGpu(canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const loop = makeLoop();
    const orch = createRecoveryOrchestrator(result.context, loop);

    gen1.resolveLost('unknown', 'crash');
    await flush();
    expect(result.context.isPaused()).toBe(true);
    expect(orch.getState()).toBe('recovering');

    // The app tears the whole context down while a recovery is still
    // pending — gpu.ts's recover() then bails out with `no-context` WITHOUT
    // ever running attemptRecovery, so onRecoveryFailed never fires.
    result.context.destroy();
    const outcome = await orch.retry();

    expect(outcome).toEqual({ ok: false, reason: { kind: 'no-context' } });
    expect(orch.getState()).toBe('failed');
    expect(orch.getLastFailureReason()).toEqual({ kind: 'no-context' });
    expect(loop.resume).not.toHaveBeenCalled();
  });
});
