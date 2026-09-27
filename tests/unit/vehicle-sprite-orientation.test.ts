/**
 * Regression suite for the "every vehicle renders 90 degrees off" bug: every
 * `car-*`/`cycle-topdown` sprite drove sideways in the live game because
 * assets/sprite-meta.json's `rotationOffsetDeg` values assumed the wrong
 * convention ("nose UP == offset 0"). The real convention, derived from
 * src/sim/driving.ts's forward vector (heading 0 == world +X), the shader's
 * rotation matrix (src/render/shaders/sprite.wgsl), and the atlas UV mapping
 * (local +Y == top of the frame): `rotationOffsetDeg` is added to heading,
 * and it must rotate the drawn art so its nose lands on local +X. See
 * assets/ASSET-NOTES.md section 2 and src/render/atlas.ts's
 * `AtlasFrameEntry.rotationOffsetDeg` doc.
 *
 * Two things are pinned here:
 *  - the convention itself, via the REAL `vehicleSpriteInstance` composition
 *    (src/app.ts) — not a parallel reimplementation of that formula;
 *  - the actual shipped per-frame values, so a ninth car added with a
 *    guessed offset fails this suite by name instead of shipping sideways.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PLAYER_ID, vehicleSpriteInstance, vehicleStateFromDesign } from '@/app';
import { loadAtlasIndex, type AssetKind } from '@/render/atlas';
import type { VehicleDesign } from '@/sim/types';

const DESIGN: VehicleDesign = {
  name: 'Orientation Test Rig',
  bodyId: 'test-fixture',
  chassisId: 'standard',
  suspensionId: 'light',
  plantId: 'small',
  tireId: 'standard',
  armor: { FRONT: 0, REAR: 0, LEFT: 0, RIGHT: 0, UNDERBODY: 0 },
  weapons: [],
};

/** A one-frame synthetic atlas whose only frame is `car-test-fixture`, so `vehicleSpriteInstance` resolves it via `car-${bodyId}` without touching the real (concurrently-editable) assets/atlas.json. */
function fixtureAtlasIndex(rotationOffsetDeg: number) {
  return loadAtlasIndex({
    atlases: [{ file: 'fixture.png', width: 8, height: 8 }],
    frames: {
      'car-test-fixture': {
        atlas: 0,
        x: 0,
        y: 0,
        w: 8,
        h: 8,
        trimX: 0,
        trimY: 0,
        srcW: 8,
        srcH: 8,
        kind: 'car',
        rotationOffsetDeg,
      },
    },
  });
}

/** Rotates a local-space point by `rotationRad` using the exact rotation matrix src/render/shaders/sprite.wgsl's `vs_main` applies to a sprite's unit-quad corners — the fixed, well-known 2D rotation the shader composes `rotationRad` INTO, distinct from the `headingRad + rotationOffsetDeg` composition under test. */
function rotate(local: { x: number; y: number }, rotationRad: number): { x: number; y: number } {
  const cosR = Math.cos(rotationRad);
  const sinR = Math.sin(rotationRad);
  return { x: local.x * cosR - local.y * sinR, y: local.x * sinR + local.y * cosR };
}

describe('vehicleSpriteInstance: rotationOffsetDeg convention (assets/ASSET-NOTES.md section 2)', () => {
  const CASES: Array<{ label: string; localNose: { x: number; y: number }; offsetDeg: number }> = [
    { label: 'nose art at local +Y (top of frame)', localNose: { x: 0, y: 1 }, offsetDeg: 270 },
    { label: 'nose art at local -Y (bottom of frame)', localNose: { x: 0, y: -1 }, offsetDeg: 90 },
    { label: 'nose art at local -X (left of frame)', localNose: { x: -1, y: 0 }, offsetDeg: 180 },
    { label: 'nose art at local +X (right of frame)', localNose: { x: 1, y: 0 }, offsetDeg: 0 },
  ];

  for (const { label, localNose, offsetDeg } of CASES) {
    it(`${label}: rotationOffsetDeg ${offsetDeg} points the nose along world +X at heading 0`, () => {
      const atlasIndex = fixtureAtlasIndex(offsetDeg);
      const vehicle = vehicleStateFromDesign(DESIGN, 'veh-orientation-test', PLAYER_ID, { x: 0, y: 0 }, 0);
      const instance = vehicleSpriteInstance(vehicle, atlasIndex);

      const worldNose = rotate(localNose, instance.rotationRad);
      // "Heading 0 must render the car pointing RIGHT": positive X, ~zero Y.
      expect(worldNose.x).toBeGreaterThan(0.99);
      expect(worldNose.y).toBeCloseTo(0, 9);
    });
  }

  it('composes with a non-zero heading too, not just the offset alone (heading 90deg turns a nose-up frame to face world +Y)', () => {
    const atlasIndex = fixtureAtlasIndex(270); // nose art at local +Y
    const headingRad = Math.PI / 2; // forward == world +Y, per src/sim/driving.ts
    const vehicle = vehicleStateFromDesign(DESIGN, 'veh-orientation-test', PLAYER_ID, { x: 0, y: 0 }, headingRad);
    const instance = vehicleSpriteInstance(vehicle, atlasIndex);

    const worldNose = rotate({ x: 0, y: 1 }, instance.rotationRad);
    expect(worldNose.x).toBeCloseTo(0, 9);
    expect(worldNose.y).toBeGreaterThan(0.99);
  });
});

describe('every shipped car/cycle frame has a rotationOffsetDeg matching its ACTUAL art (assets/raw/*.png), not a guess', () => {
  // Hand-verified against assets/raw/<name>.png on 2026-09-27 — see
  // assets/ASSET-NOTES.md section 2 for how each direction was identified
  // (windshield + wipers, headlights/grille, exhaust/tow-hook, roof gun
  // mount, kart nose cone vs. seatback, handlebars vs. rear fender).
  const EXPECTED_ROTATION_OFFSET_DEG: Record<string, number> = {
    'car-compact': 270, // nose UP
    'car-kart': 90, // nose DOWN
    'car-luxury': 90, // nose DOWN
    'car-midsized': 90, // nose DOWN
    'car-pickup': 270, // nose UP
    'car-stationwagon': 180, // landscape frame, nose LEFT
    'car-subcompact': 90, // nose DOWN
    'car-van': 90, // nose DOWN
    'cycle-topdown': 270, // nose UP
  };

  const ASSETS_DIR = fileURLToPath(new URL('../../assets/', import.meta.url));
  const manifest = JSON.parse(readFileSync(resolve(ASSETS_DIR, 'atlas.json'), 'utf8')) as {
    frames: Record<string, { kind: AssetKind; rotationOffsetDeg: number }>;
  };
  const vehicleFrameNames = Object.entries(manifest.frames)
    .filter(([, frame]) => frame.kind === 'car' || frame.kind === 'cycle')
    .map(([name]) => name)
    .sort();

  it('the shipped atlas actually packed every frame this suite expects (sanity check on the fixture list itself)', () => {
    expect(vehicleFrameNames).toEqual(Object.keys(EXPECTED_ROTATION_OFFSET_DEG).sort());
  });

  for (const name of vehicleFrameNames) {
    it(`${name}: rotationOffsetDeg is ${EXPECTED_ROTATION_OFFSET_DEG[name]} (matches its visually-verified nose direction)`, () => {
      const expected = EXPECTED_ROTATION_OFFSET_DEG[name];
      if (expected === undefined) {
        throw new Error(
          `"${name}" was packed into assets/atlas.json but has no entry in this test's EXPECTED_ROTATION_OFFSET_DEG table. ` +
            `Look at assets/raw/${name}.png, identify the front by windshield/wipers/hood/grille/headlights, and add it.`,
        );
      }
      const frame = manifest.frames[name];
      expect(frame).toBeDefined();
      expect(frame?.rotationOffsetDeg).toBe(expected);
    });
  }
});
