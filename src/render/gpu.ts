/**
 * WebGPU device/context lifecycle core.
 *
 * This module owns GPU plumbing ONLY: capability negotiation, adapter/device
 * acquisition, canvas configuration, resize, and device-loss recovery.
 *
 * ZERO GAMEPLAY LOGIC: no damage, no movement, no RNG, no ruleset imports, and
 * NO game state of any kind is held here. Every piece of mutable state below
 * (`MutableGpuState`) describes GPU objects and their declarative rebuild
 * recipes — nothing about the simulated world. Device-loss recovery therefore
 * has nothing to "preserve": the caller's CPU-side game state lives entirely
 * outside this module (src/sim/**) and is untouched by a device loss.
 */

/** Why `initGpu` (or a recovery attempt) could not produce a usable device. */
export type GpuUnsupportedReason =
  | { readonly kind: 'no-webgpu' }
  | { readonly kind: 'no-adapter' }
  | { readonly kind: 'no-context' }
  | { readonly kind: 'device-request-failed'; readonly message: string };

/** Result of `initGpu`. Never thrown — always returned. */
export type GpuInitResult =
  | { readonly ok: true; readonly context: GpuContext }
  | { readonly ok: false; readonly reason: GpuUnsupportedReason };

/** Result of an explicit or automatic recovery attempt. */
export type RecoverOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: GpuUnsupportedReason };

/**
 * The minimal surface `initGpu` needs from a canvas. A real HTMLCanvasElement
 * satisfies this structurally; tests can pass a plain fake without touching
 * the DOM.
 */
export interface GpuCanvasLike {
  width: number;
  height: number;
  getContext(contextId: 'webgpu'): GPUCanvasContext | null;
  getBoundingClientRect?: () => { readonly width: number; readonly height: number };
}

/**
 * Declarative description of one size-dependent GPU texture (a render
 * target, a depth buffer, an MSAA target, ...). The app registers these via
 * `GpuContext.defineResource`; this module owns creating, destroying and
 * recreating the matching `GPUTexture` on resize and on device-loss recovery.
 */
export interface ManagedTextureDescriptor {
  readonly label: string;
  readonly format: GPUTextureFormat;
  readonly usage: GPUTextureUsageFlags;
  readonly sampleCount?: number;
}

export type DeviceLostHandler = (info: GPUDeviceLostInfo) => void;
export type RecoveredHandler = () => void;
/** Fires when a recovery attempt (automatic or via `recover()`) fails to produce a usable device. */
export type RecoveryFailedHandler = (reason: GpuUnsupportedReason) => void;

export interface GpuContext {
  readonly canvas: GpuCanvasLike;
  getDevice(): GPUDevice;
  getContext(): GPUCanvasContext;
  getFormat(): GPUTextureFormat;
  getSize(): Readonly<{ width: number; height: number }>;
  isPaused(): boolean;
  isDestroyed(): boolean;

  /** Registers (or replaces) a size-dependent texture and creates it immediately. */
  defineResource(desc: ManagedTextureDescriptor): void;
  getTexture(label: string): GPUTexture | undefined;

  /** Fires whenever the underlying device is lost, before recovery is attempted. */
  onDeviceLost(handler: DeviceLostHandler): () => void;
  /** Fires after a lost device has been successfully replaced and resources rebuilt. */
  onRecovered(handler: RecoveredHandler): () => void;
  /**
   * Fires when a recovery attempt (automatic, right after a device loss, or
   * a manual `recover()` retry) finishes without producing a usable device.
   * The context is left `paused` and `getDevice()` keeps returning the lost
   * device; call `recover()` again (e.g. from a "Retry" button) to try once
   * more. This is the only way to learn a recovery failed short of polling
   * `isPaused()` forever.
   */
  onRecoveryFailed(handler: RecoveryFailedHandler): () => void;

  /**
   * Drives (or retries) recovery from a lost device: acquires a fresh
   * adapter/device, reconfigures the canvas context, and rebuilds every
   * registered managed texture. Safe to call even when not currently paused
   * (it is then a no-op that resolves `{ ok: true }`). Safe to call while a
   * recovery (automatic or manual) is already in flight: every concurrent
   * caller shares and awaits that same attempt instead of racing a second
   * `requestAdapter`/`requestDevice`, which would otherwise leak a device
   * and double-fire `onRecovered`.
   */
  recover(): Promise<RecoverOutcome>;

  /**
   * Applies a target backing-store size (already DPR-scaled pixels),
   * clamped to `device.limits.maxTextureDimension2D`, reconfigures the
   * context, and recreates size-dependent render targets. Returns whether
   * the size actually changed. This is what the internal ResizeObserver
   * calls, and what a test drives directly to simulate a resize.
   *
   * A no-op (returns `false`) once `destroy()` has been called, and while
   * the context is `paused` after a device loss — there is no live device
   * to configure or create textures on until `recover()` resolves `ok: true`.
   */
  resize(targetWidth: number, targetHeight: number): boolean;

  /** Tears down owned GPU resources, observers and the device, in order. */
  destroy(): void;
}

interface MutableGpuState {
  readonly canvas: GpuCanvasLike;
  readonly gpu: GPU;
  readonly format: GPUTextureFormat;
  device: GPUDevice;
  context: GPUCanvasContext;
  size: { width: number; height: number };
  paused: boolean;
  destroyed: boolean;
  readonly resourceDescriptors: Map<string, ManagedTextureDescriptor>;
  readonly textures: Map<string, GPUTexture>;
  readonly lostHandlers: Set<DeviceLostHandler>;
  readonly recoveredHandlers: Set<RecoveredHandler>;
  readonly recoveryFailedHandlers: Set<RecoveryFailedHandler>;
  /** The single shared in-flight recovery attempt, if one is under way. */
  recoveryInFlight: Promise<RecoverOutcome> | undefined;
  resizeObserver: ResizeObserver | undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampDimension(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.min(max, Math.round(value)));
}

type Acquired = { readonly adapter: GPUAdapter; readonly device: GPUDevice };
type AcquireFailure = { readonly error: GpuUnsupportedReason };

async function acquireAdapterAndDevice(gpu: GPU): Promise<Acquired | AcquireFailure> {
  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    return { error: { kind: 'device-request-failed', message: messageOf(error) } };
  }
  if (!adapter) return { error: { kind: 'no-adapter' } };

  try {
    const device = await adapter.requestDevice();
    return { adapter, device };
  } catch (error) {
    return { error: { kind: 'device-request-failed', message: messageOf(error) } };
  }
}

function configureContext(context: GPUCanvasContext, device: GPUDevice, format: GPUTextureFormat): void {
  context.configure({ device, format, alphaMode: 'opaque' });
}

function createManagedTexture(state: MutableGpuState, desc: ManagedTextureDescriptor): GPUTexture {
  return state.device.createTexture({
    label: desc.label,
    size: { width: state.size.width, height: state.size.height, depthOrArrayLayers: 1 },
    format: desc.format,
    usage: desc.usage,
    sampleCount: desc.sampleCount ?? 1,
  });
}

function recreateManagedTextures(state: MutableGpuState): void {
  for (const texture of state.textures.values()) texture.destroy();
  state.textures.clear();
  for (const desc of state.resourceDescriptors.values()) {
    state.textures.set(desc.label, createManagedTexture(state, desc));
  }
}

function attachLostHandler(state: MutableGpuState, device: GPUDevice): void {
  void device.lost.then((info) => {
    // A deliberate destroy() (our own teardown, or the discarded device from
    // a completed recovery) reports 'destroyed'; that is not a loss to react to.
    if (state.destroyed || device !== state.device) return;
    if (info.reason === 'destroyed') return;

    state.paused = true;
    for (const handler of state.lostHandlers) handler(info);
    void performRecover(state);
  });
}

/** The actual one-shot recovery attempt. Never called directly — only through `performRecover`'s latch. */
async function attemptRecovery(state: MutableGpuState): Promise<RecoverOutcome> {
  const acquired = await acquireAdapterAndDevice(state.gpu);
  if (state.destroyed) return { ok: false, reason: { kind: 'no-context' } };
  if ('error' in acquired) return { ok: false, reason: acquired.error };

  const newContext = state.canvas.getContext('webgpu');
  if (!newContext) return { ok: false, reason: { kind: 'no-context' } };

  configureContext(newContext, acquired.device, state.format);

  const maxDim = acquired.device.limits.maxTextureDimension2D;
  state.size = {
    width: clampDimension(state.size.width, maxDim),
    height: clampDimension(state.size.height, maxDim),
  };
  state.canvas.width = state.size.width;
  state.canvas.height = state.size.height;

  state.device = acquired.device;
  state.context = newContext;
  recreateManagedTextures(state);
  attachLostHandler(state, acquired.device);

  state.paused = false;
  for (const handler of state.recoveredHandlers) handler();
  return { ok: true };
}

async function performRecover(state: MutableGpuState): Promise<RecoverOutcome> {
  if (state.destroyed) return { ok: false, reason: { kind: 'no-context' } };
  if (!state.paused) return { ok: true };
  // A recovery is already under way (automatic, or a previous manual retry):
  // share it instead of racing a second requestAdapter/requestDevice, which
  // would otherwise leak the loser's device and double-fire onRecovered.
  if (state.recoveryInFlight) return state.recoveryInFlight;

  const attempt = attemptRecovery(state);
  state.recoveryInFlight = attempt;
  try {
    const outcome = await attempt;
    if (!outcome.ok) {
      for (const handler of state.recoveryFailedHandlers) handler(outcome.reason);
    }
    return outcome;
  } finally {
    state.recoveryInFlight = undefined;
  }
}

function performResize(state: MutableGpuState, targetWidth: number, targetHeight: number): boolean {
  // No live, configured device to resize onto: after destroy() the device is
  // gone, and while paused (device lost, recovery pending or failed) the
  // held device is the dead one — configuring it or creating textures on it
  // would be a validation error against a real GPUDevice.
  if (state.destroyed || state.paused) return false;

  const maxDim = state.device.limits.maxTextureDimension2D;
  const width = clampDimension(targetWidth, maxDim);
  const height = clampDimension(targetHeight, maxDim);
  if (width === state.size.width && height === state.size.height) return false;

  state.size = { width, height };
  state.canvas.width = width;
  state.canvas.height = height;
  configureContext(state.context, state.device, state.format);
  recreateManagedTextures(state);
  return true;
}

function readDevicePixelRatio(): number {
  const raw = (globalThis as { devicePixelRatio?: unknown }).devicePixelRatio;
  const dpr = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 1;
  return Math.min(dpr, 2);
}

function setupResizeObserver(state: MutableGpuState): ResizeObserver | undefined {
  if (typeof ResizeObserver === 'undefined') return undefined;

  const observer = new ResizeObserver(() => {
    if (state.destroyed) return;
    const rectFn = state.canvas.getBoundingClientRect;
    if (!rectFn) return;
    const rect = rectFn.call(state.canvas);
    const dpr = readDevicePixelRatio();
    performResize(state, rect.width * dpr, rect.height * dpr);
  });

  try {
    observer.observe(state.canvas as unknown as Element);
  } catch {
    observer.disconnect();
    return undefined;
  }
  return observer;
}

function buildGpuContext(state: MutableGpuState): GpuContext {
  return {
    canvas: state.canvas,
    getDevice: () => state.device,
    getContext: () => state.context,
    getFormat: () => state.format,
    getSize: () => ({ width: state.size.width, height: state.size.height }),
    isPaused: () => state.paused,
    isDestroyed: () => state.destroyed,

    defineResource(desc: ManagedTextureDescriptor): void {
      if (state.destroyed) return;
      state.resourceDescriptors.set(desc.label, desc);
      const existing = state.textures.get(desc.label);
      if (existing) existing.destroy();
      state.textures.set(desc.label, createManagedTexture(state, desc));
    },
    getTexture: (label: string) => state.textures.get(label),

    onDeviceLost(handler: DeviceLostHandler): () => void {
      state.lostHandlers.add(handler);
      return () => state.lostHandlers.delete(handler);
    },
    onRecovered(handler: RecoveredHandler): () => void {
      state.recoveredHandlers.add(handler);
      return () => state.recoveredHandlers.delete(handler);
    },
    onRecoveryFailed(handler: RecoveryFailedHandler): () => void {
      state.recoveryFailedHandlers.add(handler);
      return () => state.recoveryFailedHandlers.delete(handler);
    },

    recover: () => performRecover(state),
    resize: (targetWidth: number, targetHeight: number) => performResize(state, targetWidth, targetHeight),

    destroy(): void {
      if (state.destroyed) return;
      state.destroyed = true;
      state.resizeObserver?.disconnect();
      for (const texture of state.textures.values()) texture.destroy();
      state.textures.clear();
      state.context.unconfigure();
      state.device.destroy();
    },
  };
}

/**
 * Acquires a WebGPU device for `canvas` and configures it for presentation.
 * Never throws: every failure path (missing `navigator.gpu`, no adapter, a
 * rejected `requestDevice`, a null canvas context) is returned as a
 * structured `UnsupportedReason` instead. Callers must treat `ok: false` as
 * "no WebGPU here" and must not fall back to a different renderer from
 * within this module.
 */
export async function initGpu(canvas: GpuCanvasLike): Promise<GpuInitResult> {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      return { ok: false, reason: { kind: 'no-webgpu' } };
    }
    const gpu = navigator.gpu;

    const acquired = await acquireAdapterAndDevice(gpu);
    if ('error' in acquired) return { ok: false, reason: acquired.error };

    const context = canvas.getContext('webgpu');
    if (!context) return { ok: false, reason: { kind: 'no-context' } };

    const format = gpu.getPreferredCanvasFormat();
    configureContext(context, acquired.device, format);

    const maxDim = acquired.device.limits.maxTextureDimension2D;
    const state: MutableGpuState = {
      canvas,
      gpu,
      format,
      device: acquired.device,
      context,
      size: { width: clampDimension(canvas.width, maxDim), height: clampDimension(canvas.height, maxDim) },
      paused: false,
      destroyed: false,
      resourceDescriptors: new Map(),
      textures: new Map(),
      lostHandlers: new Set(),
      recoveredHandlers: new Set(),
      recoveryFailedHandlers: new Set(),
      recoveryInFlight: undefined,
      resizeObserver: undefined,
    };
    canvas.width = state.size.width;
    canvas.height = state.size.height;

    attachLostHandler(state, acquired.device);
    state.resizeObserver = setupResizeObserver(state);

    return { ok: true, context: buildGpuContext(state) };
  } catch (error) {
    return { ok: false, reason: { kind: 'device-request-failed', message: messageOf(error) } };
  }
}
