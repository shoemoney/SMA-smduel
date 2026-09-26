/**
 * Fixed-tick simulation loop: an accumulator that drains real frame time in
 * fixed `dtSeconds` steps, a buffered input frame (never read from the DOM
 * inside a tick), and an explicit, testable systems registry. This is the
 * only place ticks happen — every other sim module plugs a system into it.
 *
 * Execution order is FIXED, not registration order — that's what makes two
 * runs fed the same input stream produce identical hash sequences:
 *
 *   driving -> weapons -> projectiles -> deployables -> damage -> ai -> cleanup
 *
 * Why this order: driving must resolve position/heading before weapons
 * decide what they're aiming from; weapons must spawn projectiles before
 * projectiles move this tick (not next); projectiles and deployables must
 * land before damage resolves who got hit this tick; ai reacts to the
 * tick's already-resolved positions and damage; cleanup runs last so
 * nothing is removed out from under an earlier system in the same tick.
 */
import type { World } from '@/sim/world';

// ---------------------------------------------------------------------------
// Buffered input
// ---------------------------------------------------------------------------

export interface InputFrame {
  moveX: number;
  moveY: number;
  fire: boolean;
  weaponSlot: number;
}

export function defaultInputFrame(): InputFrame {
  return { moveX: 0, moveY: 0, fire: false, weaponSlot: 0 };
}

// ---------------------------------------------------------------------------
// Systems registry
// ---------------------------------------------------------------------------

export const SYSTEM_ORDER = ['driving', 'weapons', 'projectiles', 'deployables', 'damage', 'ai', 'cleanup'] as const;
export type SystemName = (typeof SYSTEM_ORDER)[number];

export type SystemFn = (world: World, input: InputFrame, dtSeconds: number) => void;

export interface SystemsRegistry {
  register(name: SystemName, system: SystemFn): void;
  unregister(name: SystemName): void;
  get(name: SystemName): SystemFn | undefined;
  readonly order: readonly SystemName[];
}

/** A registry where `order` is always SYSTEM_ORDER, regardless of the order systems were registered in. */
export function createSystemsRegistry(): SystemsRegistry {
  const systems = new Map<SystemName, SystemFn>();
  return {
    register(name, system) {
      systems.set(name, system);
    },
    unregister(name) {
      systems.delete(name);
    },
    get(name) {
      return systems.get(name);
    },
    order: SYSTEM_ORDER,
  };
}

// ---------------------------------------------------------------------------
// The loop itself
// ---------------------------------------------------------------------------

/** 250ms real-frame clamp, per the accumulator spec — an engine safety constant, not a ruleset gameplay number. */
const DEFAULT_MAX_FRAME_DELTA_SECONDS = 0.25;

export function dtSecondsFromTickRate(tickRateHz: number): number {
  return 1 / tickRateHz;
}

export interface GameLoopOptions {
  world: World;
  /** Fixed timestep in seconds. Callers derive this from driving.json's tickRateHz via dtSecondsFromTickRate(). */
  dtSeconds: number;
  systems: SystemsRegistry;
  /** Where a buffered InputFrame comes from — DOM, a scripted test stream, a replay, whatever. Never read from step(). */
  sampleInput: () => InputFrame;
  maxFrameDeltaSeconds?: number;
}

export interface GameLoop {
  /** One fixed tick, driven by the already-buffered input. Pure w.r.t. wall clock: no time argument, never reads a clock. */
  step(): void;
  /** Samples the buffered InputFrame for the next step(). Called once per tick, always before step(), never from inside it. */
  sampleInput(): void;
  /**
   * Feeds a real frame delta (seconds) into the accumulator and runs
   * `sampleInput(); step();` for as many fixed ticks as it now covers.
   * `frameDeltaSeconds` is clamped to `maxFrameDeltaSeconds` before being
   * added, so a stall or debugger pause produces a bounded catch-up, never
   * a spiral. Returns how many ticks ran.
   *
   * Throws RangeError for a non-finite (NaN/±Infinity) or negative
   * `frameDeltaSeconds`: a NaN would poison the accumulator forever (every
   * later `advance()` also reads NaN and runs zero ticks), and a negative
   * value would make `alpha` go negative, breaking the documented `[0, 1)`
   * contract below and stalling the loop instead of surfacing the bad input.
   */
  advance(frameDeltaSeconds: number): number;
  /** Render interpolation factor in [0, 1): accumulator / dtSeconds, as of the last advance(). */
  readonly alpha: number;
  readonly dtSeconds: number;
  readonly tickRateHz: number;
}

export function createGameLoop(options: GameLoopOptions): GameLoop {
  const { world, dtSeconds, systems, sampleInput: sampler } = options;
  const maxFrameDeltaSeconds = options.maxFrameDeltaSeconds ?? DEFAULT_MAX_FRAME_DELTA_SECONDS;
  let accumulator = 0;
  let inputBuffer: InputFrame = defaultInputFrame();

  function sampleInput(): void {
    inputBuffer = sampler();
  }

  function step(): void {
    for (const name of SYSTEM_ORDER) {
      const system = systems.get(name);
      if (system !== undefined) system(world, inputBuffer, dtSeconds);
    }
    world.tick += 1;
  }

  function advance(frameDeltaSeconds: number): number {
    if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds < 0) {
      throw new RangeError(
        `GameLoop.advance: frameDeltaSeconds must be a finite number >= 0, got ${frameDeltaSeconds}`,
      );
    }
    accumulator += Math.min(frameDeltaSeconds, maxFrameDeltaSeconds);
    let ticksRun = 0;
    while (accumulator >= dtSeconds) {
      sampleInput();
      step();
      accumulator -= dtSeconds;
      ticksRun += 1;
    }
    return ticksRun;
  }

  return {
    step,
    sampleInput,
    advance,
    get alpha(): number {
      return accumulator / dtSeconds;
    },
    dtSeconds,
    tickRateHz: 1 / dtSeconds,
  };
}
