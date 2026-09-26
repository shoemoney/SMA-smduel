/**
 * Device-loss / resize orchestration, built ONLY on top of `@/render/gpu`'s
 * public surface (`onDeviceLost` / `onRecovered` / `onRecoveryFailed` /
 * `recover` / `resize` / `isPaused` / `getDevice`). `gpu.ts` already owns
 * acquiring a fresh device, reconfiguring the context and rebuilding every
 * declared managed texture on loss; this module owns everything that sits
 * ABOVE that:
 *
 *   - a small state machine (RUNNING | LOST | RECOVERING | FAILED) the app
 *     can render something honest from instead of a frozen canvas
 *   - pausing/resuming the app's render loop across a loss/recovery cycle
 *   - a DPR-aware resize entrypoint that turns a CSS size + devicePixelRatio
 *     into clamped backing-store pixels before handing them to `gpu.resize()`
 *   - a manual `retry()` for a "Retry" button shown while FAILED
 *
 * ZERO GAME STATE: this file's only inputs are a `GpuContext` and a
 * `RenderLoopController` (a pause/resume pair the app supplies over its own
 * render loop) — `createRecoveryOrchestrator`'s signature holds no reference
 * to the simulated world, so there is nothing here for a device loss to lose;
 * that is a property of the type signature, not something a runtime test can
 * add anything to.
 */
import type { GpuContext, GpuUnsupportedReason, RecoverOutcome } from '@/render/gpu';

export type RecoveryState = 'running' | 'lost' | 'recovering' | 'failed';

/** The app's render loop, seen only as a pause/resume pair — never the loop's contents. */
export interface RenderLoopController {
  pause(): void;
  resume(): void;
}

export type RecoveryStateHandler = (state: RecoveryState, previous: RecoveryState) => void;

export interface RecoveryOrchestrator {
  getState(): RecoveryState;
  /** The reason the most recent recovery attempt failed, if the last transition was into FAILED. Cleared on the next successful recovery. */
  getLastFailureReason(): GpuUnsupportedReason | undefined;
  /** Fires on every state transition, with the new and previous state. */
  onStateChange(handler: RecoveryStateHandler): () => void;
  /**
   * Manually retries recovery — e.g. a "Retry" button shown while FAILED.
   * Safe to call any time: a no-op that resolves `{ ok: true }` when not
   * currently paused, and shares an already-in-flight attempt (automatic or
   * a previous manual retry) rather than racing a second one — see
   * `@/render/gpu`'s `recover()` contract, which this delegates to.
   */
  retry(): Promise<RecoverOutcome>;
  /**
   * DPR-aware resize entrypoint: turns a CSS size and the current
   * `devicePixelRatio` into a target backing-store size, clamps it to
   * `device.limits.maxTextureDimension2D`, and forwards the already-clamped
   * pixel size to `gpu.resize()` (which reconfigures the context and
   * recreates every size-dependent managed texture). Returns whether the
   * size actually changed. A non-finite or non-positive `devicePixelRatio`
   * is treated as `1`.
   */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): boolean;
  /** Unsubscribes from every `gpu` hook. Does not touch `gpu` or the render loop otherwise. */
  destroy(): void;
}

function clampDimension(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.min(max, Math.round(value)));
}

// Matches gpu.ts's own ResizeObserver-driven resize path (`readDevicePixelRatio`),
// which caps at 2 before ever reaching `gpu.resize()`. Without the same cap here,
// this manual resize entrypoint and that automatic one would size the backing
// store differently for the identical CSS size on any display above 2x, each
// fighting the other's reconfigure/texture-rebuild on every resize event.
const MAX_DEVICE_PIXEL_RATIO = 2;

function normalizeDpr(devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, MAX_DEVICE_PIXEL_RATIO);
}

/**
 * Wires a `GpuContext`'s device-loss/recovery hooks to a small observable
 * state machine and the app's render-loop pause/resume. Call once per
 * `GpuContext` (right after `initGpu` resolves `ok: true`); call the
 * returned `destroy()` when the context itself is torn down, to avoid
 * leaking the subscriptions.
 */
export function createRecoveryOrchestrator(gpu: GpuContext, loop: RenderLoopController): RecoveryOrchestrator {
  // gpu.isPaused() can already be true here if the caller wires this up
  // against a context that lost its device before recovery.ts was attached;
  // start in the state that matches reality instead of assuming RUNNING.
  let state: RecoveryState = gpu.isPaused() ? 'recovering' : 'running';
  let lastFailureReason: GpuUnsupportedReason | undefined;
  const handlers = new Set<RecoveryStateHandler>();
  // Tracks whether THIS orchestrator is the one holding the loop paused, so
  // `onRecovered` only ever resumes a loop it (not some earlier attach, and
  // not the app itself via a pause menu or a hidden tab) actually paused.
  // Attaching to a context that is already paused (see the ctor above) must
  // not flip this true — there is no matching `loop.pause()` call to balance.
  let pausedByUs = false;

  function setState(next: RecoveryState): void {
    if (next === state) return;
    const previous = state;
    state = next;
    for (const handler of handlers) handler(next, previous);
  }

  const unsubLost = gpu.onDeviceLost(() => {
    setState('lost');
    loop.pause();
    pausedByUs = true;
    // gpu.ts fires this hook and THEN kicks off its own automatic recovery
    // attempt (fire-and-forget) before this handler returns — there is no
    // real window where the device is lost but nothing is being rebuilt.
    // Reflect that immediately so a caller never observes a stale LOST
    // state while a rebuild is already under way.
    setState('recovering');
  });
  const unsubRecovered = gpu.onRecovered(() => {
    lastFailureReason = undefined;
    setState('running');
    if (pausedByUs) {
      loop.resume();
      pausedByUs = false;
    }
  });
  const unsubFailed = gpu.onRecoveryFailed((reason) => {
    lastFailureReason = reason;
    setState('failed');
    // Loop stays paused: gpu.ts leaves the dead device in place on failure,
    // so there is nothing to render onto until a retry succeeds.
  });

  return {
    getState: () => state,
    getLastFailureReason: () => lastFailureReason,

    onStateChange(handler: RecoveryStateHandler): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },

    async retry(): Promise<RecoverOutcome> {
      // Only announce RECOVERING when there is a device to recover: if gpu
      // is not paused, recover() is documented as a no-op `{ ok: true }`.
      // setState()'s own same-state guard is what keeps a retry that only
      // joins an already-in-flight attempt (automatic, or a previous manual
      // retry racing this one) from re-announcing RECOVERING.
      if (gpu.isPaused()) setState('recovering');
      const outcome = await gpu.recover();
      // gpu.ts fires `onRecoveryFailed` for a failed attempt it actually ran
      // — but a `recover()` call that bails out early (e.g. the context was
      // torn down mid-recovery) can resolve `{ ok: false }` WITHOUT ever
      // running an attempt, so without this the orchestrator would sit in
      // RECOVERING forever: no `failed` state, no failure reason, no way for
      // a "Retry" button to know there is anything left to retry. Setting it
      // here too is safe either way — `setState`'s same-state guard makes it
      // a no-op on the path where the hook already fired.
      if (!outcome.ok) {
        lastFailureReason = outcome.reason;
        setState('failed');
      }
      return outcome;
    },

    resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): boolean {
      const dpr = normalizeDpr(devicePixelRatio);
      const maxDim = gpu.getDevice().limits.maxTextureDimension2D;
      const targetWidth = clampDimension(cssWidth * dpr, maxDim);
      const targetHeight = clampDimension(cssHeight * dpr, maxDim);
      return gpu.resize(targetWidth, targetHeight);
    },

    destroy(): void {
      unsubLost();
      unsubRecovered();
      unsubFailed();
    },
  };
}
