/**
 * The single owner of "how to drive the Constructor screen to a road-legal
 * car", shared by every integration test that boots into the city.
 *
 * WHY THIS IS A MODULE AND NOT A LOCAL HELPER. It was four copies. Three of
 * them (`screens`, `road-bounds-wiring`, `road-trip-menu`) each carried their
 * own row indexes and their own keystroke sequence, and the two newer ones
 * re-implemented what `screens`'s helpers already did. That is the
 * "one owner, every surface reads it" shape this repo has been bitten by nine
 * times in production code — `unmetRequirements` (84), `roadLegalityMisses`
 * (92), the city-decal count (82), `facilityMarkerFamily` (79), `daysPerMile`
 * (96), the operational-kind set (98), `VEHICLE_LOCAL_FACING` (120-138),
 * `roadContactPlacement` (142) — and it has already cost a round in the test
 * harness: iteration 92 found `road-bounds-wiring` building a car the gate
 * REFUSES, which was only visible because that one file happened to walk to the
 * gate. A second copy drifting the same way would have failed with a message
 * about the city gate refusing an illegal car rather than about the fixture.
 *
 * `arena-auto-end` is deliberately NOT a user of this module: it boots with
 * its own raf stub, seed and search, and it builds a car that is NOT
 * road-legal on purpose. See the note on its own `bootToCity`.
 */

export function dispatchKey(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

/**
 * Row offsets into `@/ui/builder`'s `computeRows`: name, 5 components, 5 armor
 * facings, then the weapon slots, then the pinned confirm footer.
 *
 * These are a restatement of production's row ORDER, and iteration 143 showed
 * that is a claim about production rather than a constant. `builder.test.ts`
 * asserts both of these still name the rows they mean, against the real
 * `computeRows`, and its failure message names the row that moved.
 */
export const ARMOR_FACING_0_ROW = 6;
export const WEAPON_SLOT_0_ROW = 11;

/**
 * Moves the selected row back to the top of the list.
 *
 * Both helpers below navigate by pressing ArrowDown a fixed number of times,
 * which silently means "from row 0" — so the order they are called in is part
 * of their contract, and the first version of this pair was called with armour
 * already fitted and armed nothing, because it counted from wherever it landed.
 * `clampSelected` pins at both ends, so an overshoot is free and this makes the
 * helpers order-independent rather than order-sensitive by accident.
 */
function selectTopRow(constructorScreen: Element): void {
  for (let i = 0; i < 40; i++) dispatchKey(constructorScreen, { key: 'ArrowUp' });
}

export function selectRow(constructorScreen: Element, index: number): void {
  selectTopRow(constructorScreen);
  for (let i = 0; i < index; i++) dispatchKey(constructorScreen, { key: 'ArrowDown' });
}

export function mountArmorInConstructor(constructorScreen: Element, facing: number, points: number): void {
  selectRow(constructorScreen, ARMOR_FACING_0_ROW + facing);
  // `applyCycle` steps an armour row by one per press, clamped at 0, so the
  // overshoot lands on exactly `points` and cannot run away.
  for (let i = 0; i < points; i++) dispatchKey(constructorScreen, { key: 'ArrowRight' });
}

/**
 * Mounts `count` weapons on the Constructor screen, on consecutive slots,
 * purely with the arrow keys a player has. Each `ArrowRight` on a weapon row
 * advances that slot through `weaponChoiceIds()` and CLAMPS at the last entry
 * (`@/ui/builder`'s `cycleWeaponChoice` uses `Math.min`, not a wrap), so a
 * deliberately-overshooting press count lands on whatever weapons.json's LAST
 * weapon happens to be without this test naming it or counting entries. That
 * matters twice over: the cheapest-per-mount weapon is what keeps two mounts
 * inside a fresh driver's starting cash (`computeBuild`'s `OVER_BUDGET` would
 * otherwise refuse the build and `Enter` on confirm would silently do
 * nothing), and `firstAllowedFacing` gives every mount a legal facing, so no
 * facing row needs touching either.
 *
 * Mounting one slot expands its row into three (weapon/facing/ammo), which is
 * why the step to the next slot's weapon row is exactly 3 `ArrowDown`s.
 */
export function mountWeaponsInConstructor(constructorScreen: Element, count: number): void {
  selectRow(constructorScreen, WEAPON_SLOT_0_ROW);
  for (let slot = 0; slot < count; slot++) {
    if (slot > 0) for (let i = 0; i < 3; i++) dispatchKey(constructorScreen, { key: 'ArrowDown' });
    for (let i = 0; i < 40; i++) dispatchKey(constructorScreen, { key: 'ArrowRight' });
  }
}

/**
 * Fits the car the city gate will actually let out onto a highway, and confirms
 * the build. This is the function the three city-walking suites share.
 *
 * `roadLegalityMisses` (`@/sim/construct`) requires THREE things — a name, some
 * armour, and a mounted weapon — and the gate refuses anything less. Armour
 * goes on the FRONT facing only, so the condition panel shows one real
 * depleting bar next to four unfitted chips: the mixed state that represents
 * actual play best, and the one that exercises both of iteration 21's and
 * iteration 25's treatments at once.
 *
 * Selects from the top before each row rather than counting relative presses,
 * so the two mounts cannot silently depend on the order they are called in.
 */
export function buildRoadLegalCar(
  constructorScreen: Element,
  name: string,
  options: { readonly weaponMounts?: number } = {},
): void {
  for (const ch of name) dispatchKey(constructorScreen, { key: ch });
  mountArmorInConstructor(constructorScreen, 0, 2);
  mountWeaponsInConstructor(constructorScreen, options.weaponMounts ?? 1);
  for (let i = 0; i < 40; i++) dispatchKey(constructorScreen, { key: 'ArrowDown' });
  dispatchKey(constructorScreen, { key: 'Enter' });
}
