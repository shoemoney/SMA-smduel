/**
 * @/sim/salvage: wreck persistence (via @/sim/road's already-tested
 * isWreckPresent) glued to searching (via @/sim/economy's already-tested
 * salvageRoll) into the one thing neither module does on its own — folding
 * a successful roll's ammo transfer + leftover cargo into a single updated
 * VehicleState, plus the "salvage is one cargo category, however many items"
 * accounting SPEC.md's Courier section relies on.
 *
 * The probability math itself (salvageChance, the ammo-cap arithmetic,
 * burned/already-searched short-circuits) is economy.test.ts's job and is
 * NOT re-derived here — every test below pins the roll with a forced Rng
 * and asserts only on what this module adds: the merge and the slot count.
 */
import { describe, expect, it, vi } from 'vitest';
import { canSearchWreck, payloadSlotsUsed, searchWreck } from '@/sim/salvage';
import { createWreck, type RoadWreck } from '@/sim/road';
import { economy, getPlant, getWeapon, skillsConfig } from '@/data/rulesets';
import * as economyModule from '@/sim/economy';
import type { Rng } from '@/util/rng';
import type { CargoState, DriverState, VehicleState, WeaponState } from '@/sim/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDriver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    name: 'Duelist',
    skills: { driving: 20, marksmanship: 20, mechanic: 20 },
    naturalHealth: skillsConfig().driver.naturalHealthDP,
    bodyArmor: 0,
    prestige: skillsConfig().driver.prestigeFloor,
    cash: economy().startingCash,
    cityId: skillsConfig().startingLocation,
    cloneCityId: null,
    cloneSkills: null,
    ...overrides,
  };
}

function makeWeaponState(weaponId: string, overrides: Partial<WeaponState> = {}): WeaponState {
  return {
    weaponId,
    facing: 'FRONT',
    ammo: 0,
    dp: 6,
    maxDP: 6,
    cooldownRemaining: 0,
    destroyed: false,
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: 'veh-1',
    ownerId: 'driver-1',
    design: {
      name: 'Salvage Test Rig',
      bodyId: 'van',
      chassisId: 'standard',
      suspensionId: 'light',
      plantId: 'large',
      tireId: 'solid',
      armor: { FRONT: 25, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 },
      weapons: [],
    },
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: 40,
    odometerMiles: 0,
    armorDP: { FRONT: 25, REAR: 20, LEFT: 20, RIGHT: 20, UNDERBODY: 0 },
    tireDP: [12, 12, 12, 12],
    plantDP: getPlant('large').maxDP,
    weapons: [],
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
    ...overrides,
  };
}

function makeCargo(kind: CargoState['kind'], id: string, overrides: Partial<CargoState> = {}): CargoState {
  return { id, kind, weightLb: 10, spaces: 1, integrity: 100, ...overrides };
}

/**
 * A minimal, fully-typed Rng that always resolves `.chance()` to `result`;
 * every other method throws if `searchWreck`'s implementation ever starts
 * using it. Copied from economy.test.ts's own `forcedRng` — pinning the
 * coin flip this way is that file's established way to test salvageRoll
 * deterministically, and this module reuses `salvageRoll` whole.
 */
function forcedRng(result: boolean): Rng {
  const unused = (): never => {
    throw new Error('forcedRng: unexpected method call');
  };
  return {
    nextU32: unused,
    nextFloat: unused,
    int: unused,
    roll: unused,
    pick: unused,
    chance: () => result,
    stream: unused,
    serialize: unused,
    restore: unused,
  };
}

const MAX_SKILL: number = skillsConfig().skillMax;

// ---------------------------------------------------------------------------
// canSearchWreck (persistence AND the searched flag, combined)
// ---------------------------------------------------------------------------

describe('canSearchWreck', () => {
  it('a fresh wreck is searchable the same day it was created', () => {
    const wreck = createWreck('w1', { x: 0, y: 0 }, 5, false);
    expect(canSearchWreck(wreck, 5)).toBe(true);
  });

  it('a wreck stripped overnight is no longer searchable, even though its own flag is still unsearched', () => {
    const wreck = createWreck('w1', { x: 0, y: 0 }, 5, false);
    expect(canSearchWreck(wreck, 5)).toBe(true); // same day: still true
    expect(canSearchWreck(wreck, 6)).toBe(false); // next day: gone, regardless of searched
  });

  it('an already-searched wreck is not searchable even on the day it was created', () => {
    const wreck: RoadWreck = { ...createWreck('w1', { x: 0, y: 0 }, 5, false), searched: true };
    expect(canSearchWreck(wreck, 5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// searchWreck: one roll, the searched flag, and the vehicle merge
// ---------------------------------------------------------------------------

describe('searchWreck', () => {
  it('one roll per wreck: a second attempt on an already-searched wreck refuses instead of rerolling', () => {
    const wreck = createWreck('w1', { x: 0, y: 0 }, 5, false);
    const vehicle = makeVehicle();
    const driver = makeDriver({ skills: { driving: 20, marksmanship: 20, mechanic: MAX_SKILL } });
    const rng = forcedRng(true);

    const first = searchWreck(vehicle, driver, wreck, 5, rng);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected the first search to succeed structurally');
    expect(first.wreck.searched).toBe(true);

    const reroll = searchWreck(vehicle, driver, first.wreck, 5, rng);
    expect(reroll).toEqual({ ok: false, reason: 'alreadySearched' });
  });

  it('a wreck the world has already stripped overnight refuses with notPresent, spending no roll and reading no skill - the presence guard lives inside the mutating function itself, not just the advisory canSearchWreck', () => {
    const wreck = createWreck('w9', { x: 0, y: 0 }, 5, false, [{ weaponId: 'antitankgun', ammo: 10 }]);
    const vehicle = makeVehicle();
    const driver = makeDriver({ skills: { driving: 20, marksmanship: 20, mechanic: MAX_SKILL } });
    expect(canSearchWreck(wreck, 99)).toBe(false); // sanity: the advisory check already agrees

    // forcedRng's every method but chance() throws - if searchWreck rolled
    // anyway (ignoring the day it's actually called on) this would blow up
    // instead of quietly returning the wrong thing.
    const result = searchWreck(vehicle, driver, wreck, 99, forcedRng(true));
    expect(result).toEqual({ ok: false, reason: 'notPresent' });
  });

  it('the same wreck is still searchable same-day, and only becomes notPresent the day after (wreckPersistsSameDay / strippedOvernight, both read live)', () => {
    const wreck = createWreck('w10', { x: 0, y: 0 }, 5, false);
    const vehicle = makeVehicle();
    const driver = makeDriver({ skills: { driving: 20, marksmanship: 20, mechanic: MAX_SKILL } });

    const sameDay = searchWreck(vehicle, driver, wreck, 5, forcedRng(true));
    expect(sameDay.ok).toBe(true);

    const nextDay = searchWreck(vehicle, driver, wreck, 6, forcedRng(true));
    expect(nextDay).toEqual({ ok: false, reason: 'notPresent' });
  });

  it("uses the searching driver's OWN mechanic skill to price the roll - never marksmanship/driving, and never a fixed number regardless of the driver handed in", () => {
    const vehicle = makeVehicle();
    const wreck = createWreck('w11', { x: 0, y: 0 }, 5, false);
    const spy = vi.spyOn(economyModule, 'salvageRoll');
    try {
      const lowMechanic = makeDriver({ skills: { driving: MAX_SKILL, marksmanship: MAX_SKILL, mechanic: 3 } });
      searchWreck(vehicle, lowMechanic, wreck, 5, forcedRng(true));
      expect(spy).toHaveBeenCalledTimes(1);
      const firstCall = spy.mock.calls[0];
      if (firstCall === undefined) throw new Error('expected salvageRoll to have been called');
      const [firstMechanic] = firstCall;
      expect(firstMechanic.skill).toBe(3); // the driver's mechanic skill, not their (much higher) driving/marksmanship
      spy.mockClear();

      const highMechanic = makeDriver({ skills: { driving: 3, marksmanship: 3, mechanic: 91 } });
      searchWreck(vehicle, highMechanic, wreck, 5, forcedRng(true));
      expect(spy).toHaveBeenCalledTimes(1);
      const secondCall = spy.mock.calls[0];
      if (secondCall === undefined) throw new Error('expected salvageRoll to have been called');
      const [secondMechanic] = secondCall;
      expect(secondMechanic.skill).toBe(91); // moved with the swapped driver's mechanic skill, not pinned to 0 or to the first driver's value
    } finally {
      spy.mockRestore();
    }
  });

  it('a burned wreck yields nothing regardless of Mechanic skill and never touches chance() at all, whether Mechanic is at rock bottom or maxed', () => {
    // Every method but the ones searchWreck's burned path is allowed to use
    // throws - if the implementation ever drew a chance() roll for a burned
    // wreck (ignoring `burnedYieldsNothing`), this fixture would blow up
    // instead of silently passing.
    const neverRolls: Rng = {
      nextU32: () => {
        throw new Error('unexpected nextU32 call on a burned wreck');
      },
      nextFloat: () => {
        throw new Error('unexpected nextFloat call on a burned wreck');
      },
      int: () => {
        throw new Error('unexpected int call on a burned wreck');
      },
      roll: () => {
        throw new Error('unexpected roll call on a burned wreck');
      },
      pick: () => {
        throw new Error('unexpected pick call on a burned wreck');
      },
      chance: () => {
        throw new Error('unexpected chance() call on a burned wreck - burned must short-circuit before any roll');
      },
      stream: () => {
        throw new Error('unexpected stream call on a burned wreck');
      },
      serialize: () => {
        throw new Error('unexpected serialize call on a burned wreck');
      },
      restore: () => {
        throw new Error('unexpected restore call on a burned wreck');
      },
    };
    const vehicle = makeVehicle();
    const wreck = createWreck('w2', { x: 0, y: 0 }, 5, true, [{ weaponId: 'laser', ammo: 0 }]);

    const zeroMechanic = makeDriver({ skills: { driving: 20, marksmanship: 20, mechanic: 0 } });
    const zeroResult = searchWreck(vehicle, zeroMechanic, wreck, 5, neverRolls);
    expect(zeroResult).toEqual({ ok: true, success: false, wreck: { ...wreck, searched: true }, vehicle });

    const maxMechanic = makeDriver({ skills: { driving: 20, marksmanship: 20, mechanic: MAX_SKILL } });
    const maxResult = searchWreck(vehicle, maxMechanic, wreck, 5, neverRolls);
    expect(maxResult).toEqual({ ok: true, success: false, wreck: { ...wreck, searched: true }, vehicle });
  });

  it('matching-weapon ammo transfers into the mounted gun up to magazine capacity; the leftover rounds plus the recovered gun body become salvage cargo appended onto whatever the vehicle already carried', () => {
    const antitank = getWeapon('antitankgun'); // ammoCapacity 20, weightLb 615, ammoWeightLb 10
    const existingPayload = makeCargo('payload', 'existing-payload');
    const vehicle = makeVehicle({
      weapons: [makeWeaponState('antitankgun', { ammo: 15 })],
      cargo: [existingPayload],
    });
    const driver = makeDriver({ skills: { driving: 20, marksmanship: 20, mechanic: MAX_SKILL } });
    const wreck = createWreck('w3', { x: 0, y: 0 }, 5, false, [{ weaponId: 'antitankgun', ammo: 10 }]);

    const result = searchWreck(vehicle, driver, wreck, 5, forcedRng(true));
    if (!result.ok || !result.success) throw new Error('expected a successful roll');
    expect(result.capacityExceeded).toBe(false);

    const mounted = result.vehicle.weapons.find((w) => w.weaponId === 'antitankgun');
    expect(mounted?.ammo).toBe(antitank.ammoCapacity); // 15 + min(room 5, found 10) = 20, capped

    // Appended, not replaced: the pre-existing payload is still there, in
    // place, and the new salvage entry comes after it.
    expect(result.vehicle.cargo).toHaveLength(2);
    expect(result.vehicle.cargo[0]).toEqual(existingPayload);
    const salvageEntry = result.vehicle.cargo[1];
    if (salvageEntry === undefined) throw new Error('expected a second cargo entry for the recovered gun');
    expect(salvageEntry.kind).toBe('salvage');
    expect(salvageEntry.weightLb).toBe(antitank.weightLb + 5 * antitank.ammoWeightLb); // gun body + 5 rounds that didn't fit
  });

  it('a non-matching weapon never transfers ammo into an unrelated mount, even when that mount already carries real ammo - it all becomes cargo instead', () => {
    const vehicle = makeVehicle({ weapons: [makeWeaponState('laser', { ammo: 7 })] });
    const driver = makeDriver({ skills: { driving: 20, marksmanship: 20, mechanic: MAX_SKILL } });
    const wreck = createWreck('w4', { x: 0, y: 0 }, 5, false, [{ weaponId: 'antitankgun', ammo: 10 }]);

    const result = searchWreck(vehicle, driver, wreck, 5, forcedRng(true));
    if (!result.ok || !result.success) throw new Error('expected a successful roll');

    const laser = result.vehicle.weapons.find((w) => w.weaponId === 'laser');
    expect(laser?.ammo).toBe(7); // unchanged from its real starting ammo: nothing mounted matches the found antitankgun
    expect(result.vehicle.cargo).toHaveLength(1);
    const onlyEntry = result.vehicle.cargo[0];
    if (onlyEntry === undefined) throw new Error('expected exactly one cargo entry');
    expect(onlyEntry.kind).toBe('salvage');
  });

  it('a successful search whose recovered cargo would not fit the vehicle spends the roll and still transfers ammo into mounts, but leaves the abstract cargo behind instead of silently overloading the vehicle', () => {
    // A vehicle already carrying an absurdly heavy/bulky payload has ~0 (in
    // fact deeply negative) remaining load/space capacity regardless of the
    // exact body/chassis numbers - computeBuild's maxLoadLb/spacesTotal are
    // fixed by body+chassis and don't grow with cargo, so this overflow is
    // guaranteed without hand-tuning any ruleset constant.
    const crushingPayload = makeCargo('payload', 'already-maxed-out', { weightLb: 999_999, spaces: 999 });
    const vehicle = makeVehicle({
      weapons: [makeWeaponState('antitankgun', { ammo: 0 })],
      cargo: [crushingPayload],
    });
    const driver = makeDriver({ skills: { driving: 20, marksmanship: 20, mechanic: MAX_SKILL } });
    const wreck = createWreck('w12', { x: 0, y: 0 }, 5, false, [{ weaponId: 'antitankgun', ammo: 10 }]);

    const result = searchWreck(vehicle, driver, wreck, 5, forcedRng(true));
    if (!result.ok || !result.success) throw new Error('expected a successful roll');

    expect(result.capacityExceeded).toBe(true);
    // The wreck's one roll is still spent - no free reroll for showing up full.
    expect(result.wreck.searched).toBe(true);
    // Ammo is a physical transfer into an existing mount, not cargo, so it still lands.
    const mounted = result.vehicle.weapons.find((w) => w.weaponId === 'antitankgun');
    expect(mounted?.ammo).toBe(10);
    // But the abstract salvage cargo (gun body) never gets appended - there was nowhere to put it.
    expect(result.vehicle.cargo).toEqual([crushingPayload]);
  });
});

// ---------------------------------------------------------------------------
// payloadSlotsUsed: salvage is one cargo category, however many items
// ---------------------------------------------------------------------------

describe('payloadSlotsUsed', () => {
  it('every payload item is its own slot, and any number of salvage items together cost at most one more', () => {
    const cargo: CargoState[] = [
      makeCargo('payload', 'p1'),
      makeCargo('payload', 'p2'),
      makeCargo('salvage', 's1'),
      makeCargo('salvage', 's2'),
      makeCargo('salvage', 's3'),
    ];
    // 2 payload slots + 1 shared salvage slot, NOT 2 + 3 = 5.
    expect(payloadSlotsUsed(cargo)).toBe(3);
  });

  it('a single payload item with no salvage alongside it still costs exactly one slot', () => {
    expect(payloadSlotsUsed([makeCargo('payload', 'p1')])).toBe(1);
  });

  it('a single salvage item still costs exactly one slot, same as ten of them', () => {
    const oneItem = payloadSlotsUsed([makeCargo('salvage', 's1')]);
    const tenItems = payloadSlotsUsed(Array.from({ length: 10 }, (_, i) => makeCargo('salvage', `s${i}`)));
    expect(oneItem).toBe(1);
    expect(tenItems).toBe(1);
  });

  it('mocked salvageOccupiesOneCategory=false makes each salvage item its OWN slot - proves the flag is actually read from the ruleset at call time, not a hardcoded true (deleting the read keeps the real-ruleset tests above green, since the real ruleset flag is true)', async () => {
    vi.resetModules();
    vi.doMock('@/sim/courier', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/sim/courier')>();
      return { ...actual, couriersConfig: () => ({ ...actual.couriersConfig(), salvageOccupiesOneCategory: false }) };
    });
    try {
      const { payloadSlotsUsed: mockedPayloadSlotsUsed } = await import('@/sim/salvage');
      const cargo: CargoState[] = [makeCargo('salvage', 's1'), makeCargo('salvage', 's2')];
      expect(mockedPayloadSlotsUsed(cargo)).toBe(2);
    } finally {
      vi.doUnmock('@/sim/courier');
      vi.resetModules();
    }
  });
});
