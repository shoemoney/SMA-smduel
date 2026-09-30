/**
 * An arena autopilot: a scripted driver that plays an arena match the way a
 * competent player does.
 *
 * WHY THIS IS PRODUCTION CODE AND NOT TEST FIXTURE. It began life inside
 * `tests/integration/arena-victory.test.ts`, where it was the only thing that
 * could clear amateur-night's roster, and it was duplicated in spirit into
 * `tests/integration/arena-auto-end.test.ts` as a much cruder key-schedule
 * driver that could not. Two copies of "how a competent player aims" is the
 * same duplication shape that produced the 90-degree body-frame bug (iteration
 * 120), where five copies of one convention disagreed and the defect lived
 * only in the gaps between them. One owner, every surface reads it.
 *
 * The steering itself is not new either: it calls `computeAlignmentInput` from
 * `@/sim/ai`, the exact function `engageWeaponNode` uses to bring a mount to
 * bear. So the autopilot aims the way the game's own AI aims, which is what
 * makes it a player-shaped driver rather than a developer shortcut into the sim
 * — it produces an `InputFrame` and nothing else, sampled through the real
 * `loop.sampleInput -> step` pipeline.
 *
 * THE TWO POLICIES DIFFER IN EXACTLY ONE THING, and that difference is the
 * whole balance lesson. `naive` holds mount 0 until the match ends, so it stops
 * being able to hurt anyone the moment that magazine is dry. `competent` moves
 * to a loaded mount — the same habit as the arena screen's own weapon cycle.
 * Amateur-night costs more rounds than any single mount holds, so that one
 * habit is what separates a win from an escape.
 */
import { computeAlignmentInput } from '@/sim/ai';
import { defaultInputFrame, type InputFrame } from '@/sim/loop';
import type { VehicleState } from '@/sim/types';
import type { World } from '@/sim/world';

export type ArenaAutopilotPolicy = 'naive' | 'competent';

function findPlayerVehicle(world: World, playerVehicleId: string): VehicleState | undefined {
  return world.entities.vehicles.find((vehicle) => vehicle.id === playerVehicleId);
}

export interface ArenaAutopilot {
  /** The `InputFrame` for this tick. Fed straight into `createGameLoop`. */
  sample(): InputFrame;
  /** The opponent currently locked on to, or null. Exposed for diagnostics. */
  readonly lockedTargetId: string | null;
}

/**
 * Builds an autopilot bound to one world and one player vehicle id.
 *
 * The lock is sticky: the driver keeps working the same opponent until it is
 * destroyed, which is what a player does and what a nearest-target-per-tick
 * policy fails to do (it flip-flops between two equidistant opponents and
 * never finishes either).
 */
export function createArenaAutopilot(
  world: World,
  playerVehicleId: string,
  policy: ArenaAutopilotPolicy = 'competent',
): ArenaAutopilot {
  let locked: string | null = null;

  function sample(): InputFrame {
    const player = findPlayerVehicle(world, playerVehicleId);
    if (player === undefined || player.destroyed) return defaultInputFrame();

    const live = world.entities.vehicles.filter((vehicle) => vehicle.id !== player.id && !vehicle.destroyed);
    if (live.length === 0) return defaultInputFrame();

    let target = live.find((vehicle) => vehicle.id === locked);
    if (target === undefined) {
      let bestDistance = Infinity;
      for (const candidate of live) {
        const distance = Math.hypot(candidate.position.x - player.position.x, candidate.position.y - player.position.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          target = candidate;
        }
      }
      locked = target?.id ?? null;
    }
    if (target === undefined) return defaultInputFrame();

    const bearingRad = Math.atan2(target.position.y - player.position.y, target.position.x - player.position.x);
    const { moveX, moveY } = computeAlignmentInput(bearingRad, 'FRONT', player.headingRad);
    const weaponSlot =
      policy === 'naive' ? 0 : Math.max(0, player.weapons.findIndex((weapon) => !weapon.destroyed && weapon.ammo > 0));
    return { moveX, moveY, fire: true, weaponSlot };
  }

  return {
    sample,
    get lockedTargetId() {
      return locked;
    },
  };
}
