/**
 * PERFORMANCE BUDGETS (docs/SPEC.md "Release gates" #3):
 *   sim <=4 ms/tick · render prep <=3 ms/frame · GPU <=10 ms @1080p
 *   <=150 draw calls typical · <=25 MB initial download
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *
 * It does not assert the budgets tightly. A perf assertion whose discriminating
 * signal and failure threshold are the same order of magnitude is a flake
 * generator: this machine runs large agent fan-outs, and earlier today an
 * unrelated test that passes in 1s timed out at 29s purely because the box was
 * busy. A test that goes red when something ELSE is running teaches you to
 * ignore red.
 *
 * So the ceilings here are REGRESSION ceilings, set at ~10x the real budget.
 * They catch "someone made the tick loop quadratic", not "the laptop is warm".
 * The precise numbers are printed on every run, so the real budget is checked by
 * READING them, which is the honest way to use a number this environment-
 * sensitive.
 *
 * NOT MEASURABLE HERE, stated rather than silently skipped:
 *   - GPU frame time @1080p: needs a real adapter. vitest runs in node with no
 *     WebGPU device. Measure in a browser with a frame-timing capture.
 *   - Draw calls: the renderer batches one instanced draw per atlas per layer,
 *     so the count is a property of the pass structure rather than of a
 *     measurable run here. See tests/unit/sprite.test.ts for the batching
 *     invariant it rests on.
 * Claiming either of those is covered would be worse than leaving them out.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createArenaWorld,
  makeArenaAISystem,
  makeArenaDamageSystem,
  makeArenaDrivingSystem,
  makeArenaWeaponsSystem,
  spawnArenaOpponents,
  vehicleStateFromDesign,
  PLAYER_ID,
} from '@/app';
import { getArenaEvent, houseKartDesign } from '@/sim/arena';
import { createDriver } from '@/sim/driver';
import { createGameLoop, createSystemsRegistry, dtSecondsFromTickRate, type InputFrame } from '@/sim/loop';
import { drivingConfig } from '@/data/rulesets';
import { packInstances } from '@/render/sprite';

/** The real budgets from docs/SPEC.md, kept here so the printout can compare against them. */
const BUDGET_SIM_MS_PER_TICK = 4;
const BUDGET_RENDER_PREP_MS = 3;
/** Regression ceilings: ~10x budget. See the header for why these are loose on purpose. */
const CEILING_SIM_MS_PER_TICK = BUDGET_SIM_MS_PER_TICK * 10;
const CEILING_RENDER_PREP_MS = BUDGET_RENDER_PREP_MS * 10;

const TICKS = 600; // 10 seconds of simulated play at 60Hz

function report(label: string, measured: number, budget: number, ceiling: number): void {
  const verdict = measured <= budget ? 'within budget' : measured <= ceiling ? 'OVER BUDGET (under regression ceiling)' : 'REGRESSION';
  // eslint-disable-next-line no-console
  console.log(`  perf: ${label} = ${measured.toFixed(3)} ms  (budget ${budget}, ceiling ${ceiling}) -> ${verdict}`);
}

describe('performance budgets (measured, reported, loosely gated)', () => {
  it('simulation tick cost over a real arena match', () => {
    const driverResult = createDriver('Perf', { driving: 20, marksmanship: 20, mechanic: 10 });
    if (!driverResult.ok) throw new Error('fixture: expected a legal skill split');
    const driverRef = { current: driverResult.driver };

    const event = getArenaEvent('amateur-night');
    const playerVehicle = vehicleStateFromDesign(houseKartDesign(), 'veh-player', PLAYER_ID);
    const world = createArenaWorld('perf-seed', playerVehicle);
    const opponents = spawnArenaOpponents(world, event);

    const aiInputs = new Map<string, InputFrame>();
    const projectileTargets = new Map<string, string>();
    const spawnCounter = { current: 0 };
    const noop = (): void => {};
    const matchStateRef = { current: { opponentsDefeated: 0, opponentsTotal: opponents.size } as never };

    const systems = createSystemsRegistry();
    systems.register('driving', makeArenaDrivingSystem(driverRef, playerVehicle.id, opponents, aiInputs));
    systems.register('weapons', makeArenaWeaponsSystem(driverRef, playerVehicle.id, opponents, aiInputs, projectileTargets, spawnCounter, noop));
    systems.register('damage', makeArenaDamageSystem(playerVehicle.id, driverRef, opponents, projectileTargets, matchStateRef, noop));
    systems.register('ai', makeArenaAISystem(playerVehicle.id, opponents, aiInputs));

    const loop = createGameLoop({
      world,
      dtSeconds: dtSecondsFromTickRate(drivingConfig().tickRateHz),
      systems,
      sampleInput: () => ({ moveX: 1, moveY: 0, fire: true, weaponSlot: 0 }),
    });

    // Warm up so the first run's JIT cost is not reported as steady-state.
    for (let i = 0; i < 60; i++) { loop.sampleInput(); loop.step(); }

    const start = performance.now();
    for (let i = 0; i < TICKS; i++) { loop.sampleInput(); loop.step(); }
    const perTick = (performance.now() - start) / TICKS;

    report(`sim tick (${opponents.size} opponents)`, perTick, BUDGET_SIM_MS_PER_TICK, CEILING_SIM_MS_PER_TICK);
    expect(perTick).toBeLessThan(CEILING_SIM_MS_PER_TICK);
  });

  it('render-prep cost for a full 500-instance frame', () => {
    // The budget's "typical" load. packInstances is the whole CPU-side render
    // prep: everything else in the frame is a GPU submit.
    const instances = Array.from({ length: 500 }, (_, i) => ({
      atlasId: 'atlas-0',
      position: { x: i * 1.5, y: (i % 40) * 2 },
      rotationRad: i * 0.01,
      sizeM: { x: 2, y: 4 },
      uvRect: { u0: 0, v0: 0, u1: 0.1, v1: 0.1 },
      tint: { r: 1, g: 1, b: 1, a: 1 },
      layer: i % 3,
    })) as unknown as Parameters<typeof packInstances>[0];

    for (let i = 0; i < 20; i++) packInstances(instances); // warm up

    const start = performance.now();
    const FRAMES = 200;
    for (let i = 0; i < FRAMES; i++) packInstances(instances);
    const perFrame = (performance.now() - start) / FRAMES;

    report('render prep (500 instances)', perFrame, BUDGET_RENDER_PREP_MS, CEILING_RENDER_PREP_MS);
    expect(perFrame).toBeLessThan(CEILING_RENDER_PREP_MS);
  });

  it('initial download stays under the 25 MB budget (skips if dist/ has not been built)', () => {
    const dist = fileURLToPath(new URL('../../dist/assets/', import.meta.url));
    if (!existsSync(dist)) {
      // eslint-disable-next-line no-console
      console.log('  perf: dist/ absent — run `npx vite build` to measure the download budget');
      return;
    }
    const BUDGET_BYTES = 25 * 1024 * 1024;
    let total = 0;
    const parts: Array<[string, number]> = [];
    for (const f of readdirSync(dist)) {
      const bytes = statSync(resolve(dist, f)).size;
      total += bytes;
      parts.push([f, bytes]);
    }
    parts.sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line no-console
    console.log(`  perf: initial download = ${(total / 1024 / 1024).toFixed(2)} MB of ${BUDGET_BYTES / 1024 / 1024} MB budget`);
    for (const [name, bytes] of parts.slice(0, 3)) {
      // eslint-disable-next-line no-console
      console.log(`         ${name}: ${(bytes / 1024).toFixed(0)} kB`);
    }
    expect(total).toBeLessThan(BUDGET_BYTES);
  });
});
