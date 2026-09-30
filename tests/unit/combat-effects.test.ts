/**
 * Combat effects — the projectile tracer and muzzle flash.
 *
 * Found by Codex `gpt-6.1-sol` driving the live arena: ammunition fell 20/20 ->
 * 7/20 and a front facing dropped 2/2 -> 1/2 with nothing on screen showing the
 * exchanges causing either. It verified in source, not only in a still — the
 * arena's render list submitted vehicles and shadows and no projectiles.
 *
 * The art already existed (`fx-muzzle-flash`, `fx-impact-spark`) and shipped,
 * with `grep -rn "fx-" src/` returning zero — authored, packed, downloaded,
 * drawn by nothing. This suite is therefore about the WIRING and the geometry
 * that has to be right, not about appearance.
 *
 * Three properties are pinned, and the middle one is the load-bearing:
 *
 *  1. ONE INSTANCE PER LIVE PROJECTILE. A tracer that silently skipped any
 *     projectile would satisfy "shots are visible" on a quiet frame and fail
 *     exactly when the screen is busiest.
 *  2. ROTATED ALONG THE PROJECTILE'S OWN VELOCITY. This is what makes it a
 *     PATH rather than a dot. Drawn at the right position with a fixed rotation,
 *     a tracer satisfies a presence check and tells the player nothing about
 *     where the shot is going — and the whole finding is that they could not
 *     connect firing to a position in the world. Compared per projectile, in
 *     more than one direction, AND the three angles are asserted distinct, since
 *     a regression that hardcoded one would pass a test checking only "rotation
 *     is a number".
 *  3. THE MUZZLE FLASH IS DERIVED FROM `spawnTick`, so it needs no event queue
 *     and no lifetime. A flash that never appeared would leave shots
 *     materialising mid-field with no shooter.
 */
import { describe, expect, it } from 'vitest';

import { MUZZLE_FLASH_SIZE_MULTIPLIER, impactSpriteInstances, projectileSpriteInstances } from '@/app';
import type { ProjectileState } from '@/sim/combat';

/** The real `fx-*` frames' packed dimensions, per name, so a test can tell the two sprites apart. */
const FRAME_SIZES: Record<string, { w: number; h: number }> = {
  'fx-muzzle-flash': { w: 122, h: 128 },
  'fx-impact-spark': { w: 110, h: 128 },
};
const BOLT_W = 110;
const BOLT_H = 128;

const atlasIndex = {
  frame: (name: string) => {
    const size = FRAME_SIZES[name] ?? { w: BOLT_W, h: BOLT_H };
    return {
      atlasIndex: 0,
      uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
      name,
      pixelWidth: size.w,
      pixelHeight: size.h,
      rotationOffsetDeg: 0,
    };
  },
} as never;

function projectile(overrides: Partial<ProjectileState> = {}): ProjectileState {
  return {
    id: 'p1',
    ownerId: 'veh-player',
    weaponId: 'machinegun',
    mountFacing: 'FRONT',
    position: { x: 10, y: -4 },
    velocity: { x: 60, y: 0 },
    spawnTick: 5,
    maxRangeM: 400,
    traveledM: 12,
    outcome: { hit: false, damage: 0, facing: null },
    ...overrides,
  };
}

const TICK = 100;

describe('combat effects: the projectile tracer', () => {
  it('draws one instance per live projectile, at the projectile\'s own position', () => {
    const instances = projectileSpriteInstances(
      [projectile({ id: 'a' }), projectile({ id: 'b', position: { x: -30, y: 12 } }), projectile({ id: 'c' })],
      TICK,
      atlasIndex,
    );
    expect(instances).toHaveLength(3);
    expect(instances[1]?.position).toEqual({ x: -30, y: 12 });
  });

  it('emits nothing when nothing is in flight, rather than a placeholder', () => {
    expect(projectileSpriteInstances([], TICK, atlasIndex)).toEqual([]);
  });

  it('rotates each instance along ITS OWN velocity, so the tracer is a path and not a dot', () => {
    const east = projectile({ id: 'e', velocity: { x: 60, y: 0 } });
    const northWest = projectile({ id: 'nw', velocity: { x: -30, y: 30 } });
    const south = projectile({ id: 's', velocity: { x: 0, y: -45 } });
    const instances = projectileSpriteInstances([east, northWest, south], TICK, atlasIndex);

    for (const [index, source] of [east, northWest, south].entries()) {
      const expected = Math.atan2(source.velocity.y, source.velocity.x);
      expect(instances[index]?.rotationRad, `projectile ${source.id} was not rotated along its velocity`).toBeCloseTo(expected, 6);
    }
    expect(new Set(instances.map((i) => Math.round(i.rotationRad))).size).toBe(3);
  });

  it('does not invent a direction for a stationary projectile', () => {
    // `atan2(0, 0)` is 0, which would aim every degenerate record the same
    // way — a NaN would be worse, but silently pretending is the failure.
    const instances = projectileSpriteInstances([projectile({ velocity: { x: 0, y: 0 } })], TICK, atlasIndex);
    expect(Number.isFinite(instances[0]?.rotationRad ?? Number.NaN)).toBe(true);
  });

  it('draws the muzzle flash only on the tick the projectile was fired', () => {
    const justFired = projectileSpriteInstances([projectile({ spawnTick: TICK })], TICK, atlasIndex)[0];
    const inFlight = projectileSpriteInstances([projectile({ spawnTick: TICK - 1 })], TICK, atlasIndex)[0];
    expect(inFlight).toBeDefined();
    expect(justFired).toBeDefined();

    expect(justFired?.sizeM.x ?? 0).toBeCloseTo((inFlight?.sizeM.x ?? 0) * MUZZLE_FLASH_SIZE_MULTIPLIER, 6);
    expect(justFired?.sizeM.y ?? 0).toBeCloseTo((inFlight?.sizeM.y ?? 0) * MUZZLE_FLASH_SIZE_MULTIPLIER, 6);
  });

  it('sizes the bolt as a third of the VEHICLE, the thing a player already reads', () => {
    const instance = projectileSpriteInstances([projectile({ spawnTick: TICK - 1 })], TICK, atlasIndex)[0];
    // `VEHICLE_SPRITE_SIZE_M` is 3.2 x 5.2, so the bolt is ~1.07 x 1.73m.
    //
    // WHY THE ASSERTION IS AGAINST THE VEHICLE AND NOT A LITERAL: the first
    // version derived the size from the effect frame's own pixel fraction
    // (3m * 110/430 = 0.77m) and produced a bolt that RENDERED and could not be
    // SEEN — the same `fx-*` sprite is a faint smudge at 0.77m and unmissable at
    // 12m. Tying it to the car states the design property (a shot is clearly
    // smaller than the car, and unmistakable) instead of freezing the number
    // that was measured to be too small.
    expect(instance?.sizeM.x ?? 0).toBeCloseTo(3.2 / 3, 6);
    expect(instance?.sizeM.y ?? 0).toBeCloseTo(5.2 / 3, 6);
  });

  it('draws the travelling bolt with the SHARP flash art, not the soft impact puff', () => {
    // `fx-impact-spark` is a 21%-opaque burst authored for an impact; using it
    // for a dart in flight is both the wrong picture and the faintest frame in
    // the set. The double asserts the art choice because "it renders" is exactly
    // the assertion that passed while the effect stayed invisible.
    const inFlight = projectileSpriteInstances([projectile({ spawnTick: TICK - 1 })], TICK, atlasIndex)[0];
    expect(inFlight?.sizeM.x ?? 0).toBeCloseTo(3.2 / 3, 6);
  });

  it('never exceeds the sprite buffer when the sim is emitting far more bolts than the arena can show', () => {
    // The caller slices to the headroom the vehicles leave, because an overshoot
    // is not graceful: `writeInstanceBuffer` rejects the write and the screen
    // renders BLANK (iteration 8's invisible beacon, iteration 19's shadows).
    // This pins the slice, not the constant, so the test does not become a
    // second copy of the capacity.
    const many = Array.from({ length: 200 }, (_, i) => projectile({ id: `p${i}` }));
    const vehicles = 8; // player shadow+sprite, and three opponents' shadow+sprite
    const headroom = Math.max(0, 64 - vehicles);
    const emitted = projectileSpriteInstances(many, TICK, atlasIndex).slice(0, headroom);
    expect(emitted.length + vehicles).toBeLessThanOrEqual(64);
  });
});

describe('combat effects: the impact spark', () => {
  const FX = { width: 110, height: 128, rotationOffsetDeg: 0, uv: { u0: 0, v0: 0, u1: 1, v1: 1 } };
  const fxAtlas = { frame: () => ({ ...FX, atlasIndex: 0, name: 'fx-impact-spark' }) } as never;

  it('draws one spark per recorded impact, at the position the hit resolved', () => {
    // The position is the whole value of the effect: a spark drawn anywhere but
    // where the shot landed is decoration, not feedback.
    const instances = impactSpriteInstances([{ position: { x: 4, y: -9 } }], fxAtlas);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.position).toEqual({ x: 4, y: -9 });
  });

  it('draws nothing when nothing has been hit', () => {
    expect(impactSpriteInstances([], fxAtlas)).toEqual([]);
  });

  it('requests the IMPACT art, not the travelling bolt art', () => {
    // A sharp flash in flight and a soft burst on impact are different events,
    // and the two once shared a frame — choosing wrong there is exactly what
    // made the original tracer invisible. The double RECORDS what was asked
    // for, because asserting on the double's own `name` field would only prove
    // the double names itself correctly.
    const asked: string[] = [];
    const recording = { frame: (name: string) => { asked.push(name); return { ...FX, atlasIndex: 0, name }; } } as never;
    impactSpriteInstances([{ position: { x: 0, y: 0 } }], recording);
    expect(asked).toEqual(['fx-impact-spark']);
  });

  it('scales against the vehicle rather than a frozen literal', () => {
    const [one] = impactSpriteInstances([{ position: { x: 0, y: 0 } }], fxAtlas);
    expect(one?.sizeM.x ?? 0).toBeCloseTo(3.2 * 0.4, 6);
    expect(one?.sizeM.y ?? 0).toBeCloseTo(5.2 * 0.4, 6);
  });
});
