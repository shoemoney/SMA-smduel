/**
 * The playable app shell: title -> driver creation -> constructor -> practice
 * arena. Wires the already-built subsystems (sim/**, render/**, ui/**)
 * together; it owns none of their gameplay math itself.
 *
 * Screen flow mirrors docs/SPEC.md's game states, scoped to what a boot
 * needs to prove end-to-end: Title -> Driver creation -> Constructor ->
 * Arena (the `practice` event, which has zero opponents per
 * rulesets/classic/arenas.json — a solo firing-range lap, not a placeholder).
 *
 * Rendering is WebGPU via `@/render/**`; when `navigator.gpu` is absent (or
 * device acquisition fails), the arena screen falls back to a text notice
 * and keeps running the CPU simulation + HUD with no canvas draw — the sim
 * is CPU-authoritative regardless of whether anything can render it.
 */
import '@/ui/builder.css';
import '@/ui/hud.css';

import { citiesConfig, drivingConfig, getPlant, getTire, getWeapon, skillsConfig, RAW_RULESETS } from '@/data/rulesets';
import { validateRulesets } from '@/data/schema';
import {
  beginArenaMatch,
  getArenaEvent,
  resolveArenaExit,
  type ArenaExitMode,
  type ArenaMatchState,
  type ArenaResolution,
} from '@/sim/arena';
import { advanceDays, initialClock, type Clock } from '@/sim/calendar';
import {
  advanceProjectile,
  fire,
  facingWorldDirection,
  projectileExpired,
  tickCooldowns,
  type FireCommand,
} from '@/sim/combat';
import { computeBuild } from '@/sim/construct';
import {
  createCityPlayerState,
  generateCityLayout,
  stepWalk,
  toggleVehicle,
  type CityDirection,
  type CityLayout,
  type CityPlayerState,
  type CityTrigger,
} from '@/sim/city';
import type { AcceptedJob } from '@/sim/courier';
import { createDriver, getSkill } from '@/sim/driver';
import { stepDriving, isRadarDisabled, type DriveInput } from '@/sim/driving';
import {
  createGameLoop,
  createSystemsRegistry,
  dtSecondsFromTickRate,
  type InputFrame,
  type SystemFn,
} from '@/sim/loop';
import {
  beginRoadTrip,
  crossDestinationGate,
  resolveRoute,
  stepRoadTrip,
  type ResolvedRoute,
  type RoadTripState,
} from '@/sim/road';
import type { DriverState, RouteDef, SkillName, VehicleState } from '@/sim/types';
import { createWorld, type World } from '@/sim/world';
import { createRng, type Rng } from '@/util/rng';
import { hashState } from '@/util/hash';
import { CURRENT_SCHEMA_VERSION } from '@/persist/migrate';
import { openSaveDatabase, save, load, type LoadResult, type SaveGame } from '@/persist/save';

import {
  renderHud,
  type HudElement,
  type HudDocument,
  type HudMessage,
  type HudMessageKind,
  type HudSettings,
  type HudSnapshot,
} from '@/ui/hud';
import { mountBuilder, type BuilderConfirmedBuild } from '@/ui/builder';
import { mountFacility, type ArenaEntryResult, type BuildingContext, type MountedFacility } from '@/ui/buildings';
import { leaveAction, LEAVE_ACTION_ID, type RumorId } from '@/ui/buildings/shared';
import { buildCityInstances, type CityVehicleView, type CityViewSnapshot } from '@/ui/city-view';
import { mountMenu, type MenuAction } from '@/ui/menu';
import { cityName, t } from '@/ui/strings';

import { initGpu, type GpuContext } from '@/render/gpu';
import { loadAtlasIndex, type AtlasIndex, type FrameInfo } from '@/render/atlas';
import { createCamera, type Camera } from '@/render/camera';
import {
  createAtlasBindGroup,
  createAtlasBindGroupLayout,
  createAtlasSampler,
  createCameraBindGroup,
  createCameraBindGroupLayout,
  createCameraUniformBuffer,
  createInstanceStorageBuffer,
  createLayerPipeline,
  createShaderModule,
  encodeSpritePass,
  packInstances,
  writeCameraUniform,
  writeInstanceBuffer,
  type SpriteInstanceInput,
} from '@/render/sprite';

import atlasManifestRaw from '../assets/atlas.json';

// ---------------------------------------------------------------------------
// Fail fast on a malformed ruleset table, exactly once, before anything else
// runs. `@/data/rulesets` already does this at its own module init time; this
// call is what `tests/integration/boot.test.ts` asserts against directly.
// ---------------------------------------------------------------------------
export function validateAllRulesets(): void {
  validateRulesets(RAW_RULESETS);
}

export const PLAYER_ID = 'player';
export const ARENA_EVENT_ID = 'practice';

// Render-only cosmetic constants — never gameplay numbers. A vehicle's real
// dimensions aren't in any ruleset table (bodies.json prices/weighs/spaces a
// hull, it never measures one), so the on-screen footprint is a fixed,
// visual-only size, same as HUD's own MAX_WEAPON_ROWS/TIRE_LABELS constants.
const VEHICLE_SPRITE_SIZE_M = { x: 3.2, y: 5.2 };
const FLOOR_TILE_SIZE_M = 10;
const FLOOR_TILES_PER_SIDE = 9;
const PIXELS_PER_METER_CSS = 14;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function clearAndAppend(root: HTMLElement, child: HTMLElement): void {
  root.innerHTML = '';
  root.appendChild(child);
}

/**
 * A real-DOM `HudElement`, so `renderHud`'s root can be an element already
 * attached under the page (`hudContainer`) instead of a detached node
 * `@/ui/hud`'s own `createBrowserHudDocument` would create internally with
 * no way to hand its real `Node` back out. Mirrors that module's private
 * `DomHudElement` one-for-one against the same public interface.
 */
class DomHudElement implements HudElement {
  constructor(private readonly node: Element) {}
  get tagName(): string {
    return this.node.tagName;
  }
  setAttribute(name: string, value: string): void {
    this.node.setAttribute(name, value);
  }
  appendChild(child: HudElement): void {
    if (child instanceof DomHudElement) this.node.appendChild(child.node);
  }
  clearChildren(): void {
    while (this.node.firstChild) this.node.removeChild(this.node.firstChild);
  }
  setText(text: string): void {
    this.node.textContent = text;
  }
  addEventListener(type: string, handler: () => void): void {
    this.node.addEventListener(type, handler);
  }
}

class DomHudDocument implements HudDocument {
  createElement(tag: string): HudElement {
    return new DomHudElement(document.createElement(tag));
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// Session seed resolution
// ---------------------------------------------------------------------------
//
// A played session must be reproducible after the fact (a bug report or a
// replay needs the exact seed that drove it), which the clock can never
// give: Date.now() is low-entropy (two tabs booted in the same millisecond
// collide) and misleading about intent (a clock value looks like it means
// something when it's really just "whenever this happened to run"). So the
// seed is resolved from, in priority order:
//   1. an explicit ?seed= URL override, for reproducing one specific bug
//   2. the seed already recorded on a save in progress, so resuming one
//      never silently swaps in a different stream
//   3. a freshly generated seed from crypto.getRandomValues, for a brand
//      new session with nothing to restore
// and then never touched again for the session's lifetime - see
// `showArena`'s `restoreWorld` branch below, which reuses a resumed World's
// `rngState` verbatim instead of re-deriving it from the seed.

/** Reads `?seed=` from a location.search-style string. A missing or blank value yields null so callers fall through to the next source. */
export function seedOverrideFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get('seed');
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A genuinely random session seed, sourced from crypto.getRandomValues -
 * never Date.now(). Encoded as a stable lowercase hex string (128 bits of
 * entropy) so it prints cleanly in a bug report and round-trips
 * byte-for-byte through JSON/IndexedDB.
 */
export function randomSessionSeed(randomSource: Pick<Crypto, 'getRandomValues'> = crypto): string {
  const words = new Uint32Array(4);
  randomSource.getRandomValues(words);
  return Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('');
}

/** The one seed this session's world RNG derives from, chosen exactly once at new-game time (see the section doc comment above for the priority order). */
export function resolveSessionSeed(options: {
  readonly search: string;
  readonly savedSeed?: string | null;
  readonly randomSeed?: () => string;
}): string {
  const override = seedOverrideFromSearch(options.search);
  if (override !== null) return override;
  if (options.savedSeed !== undefined && options.savedSeed !== null) return options.savedSeed;
  return (options.randomSeed ?? randomSessionSeed)();
}

/** Recovers the plain seed string from an `RngState.seedKey` ("s:<seed>" / "n:<seed>") for display - the inverse of `@/util/rng`'s own (unexported) prefixing, computed locally since that internal isn't exported. */
function seedKeyToDisplaySeed(seedKey: string): string {
  const colonIndex = seedKey.indexOf(':');
  return colonIndex === -1 ? seedKey : seedKey.slice(colonIndex + 1);
}

/**
 * Resolves the session seed used to RESUME an in-progress save: reads the
 * seed already recorded on the restored World's own `rngState.seedKey`
 * (never re-derived) and routes it through `resolveSessionSeed`'s same
 * priority order, so an explicit `?seed=` override still wins even on a
 * resume. Extracted out of `boot()`'s `resumeSession` closure (which isn't
 * itself reachable headlessly - it goes straight on to call `showArena`) as
 * its own seam, so a test can drive this exact call - the saved-seed lookup
 * AND the `resolveSessionSeed` call together - directly.
 */
export function resolveResumeSessionSeed(world: World, options: { readonly search: string; readonly randomSeed?: () => string }): string {
  const savedSeed = seedKeyToDisplaySeed(world.rngState.seedKey);
  return resolveSessionSeed(
    options.randomSeed !== undefined
      ? { search: options.search, savedSeed, randomSeed: options.randomSeed }
      : { search: options.search, savedSeed },
  );
}

/** Stable 32-bit fingerprint of a string seed, for the legacy numeric `SaveGame.seed` field. The actual reproducible state lives in `world.rngState` (a string `seedKey` plus the 4 xoshiro words), which round-trips through JSON exactly; this fingerprint is display/bookkeeping metadata only. */
function seedFingerprint(seed: string): number {
  return Number.parseInt(hashState(seed).slice(0, 8), 16);
}

/** The most recently resolved or restored session seed, so a fatal-crash banner (see `main.ts`) can still report it even if the arena screen never got the chance to show its own status line. */
let lastSessionSeed: string | null = null;
export function currentSessionSeed(): string | null {
  return lastSessionSeed;
}

// ---------------------------------------------------------------------------
// Screen 1: Title
// ---------------------------------------------------------------------------

function showTitle(root: HTMLElement, titleOptions: { onNewDriver: () => void; onContinue?: () => void }): void {
  const container = el('div', 'sm-screen sm-screen--title');
  container.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
  const menuHost = el('div');
  menuHost.style.cssText = 'width:min(420px,90vw);';
  container.appendChild(menuHost);
  clearAndAppend(root, container);

  const clock = initialClock();
  const actions: MenuAction[] = [{ id: 'new-driver', label: t('ui.title.newDriver'), eligible: true }];
  if (titleOptions.onContinue !== undefined) {
    actions.unshift({ id: 'continue', label: t('ui.title.continue'), eligible: true });
  }
  mountMenu({
    container: menuHost,
    header: { cash: 0, dayIndex: clock.dayIndex, phase: clock.phase, cityName: t('ui.title.appName') },
    actions,
    onActivate: (id) => {
      if (id === 'continue' && titleOptions.onContinue !== undefined) {
        titleOptions.onContinue();
        return;
      }
      titleOptions.onNewDriver();
    },
    onBack: () => {
      /* nothing above Title to back out to */
    },
  });
}

// ---------------------------------------------------------------------------
// Screen 2: Driver creation
// ---------------------------------------------------------------------------

function showDriverCreation(root: HTMLElement, onCreated: (driver: DriverState) => void): void {
  const cfg = skillsConfig();
  const container = el('div', 'sm-screen sm-screen--driver');
  container.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#d7e0ea;font-family:system-ui,sans-serif;';

  const card = el('div');
  card.style.cssText = 'width:min(420px,90vw);background:#161d27;border:1px solid #2a3444;border-radius:8px;padding:24px;';
  const title = el('h2', undefined, t('ui.driverCreation.title'));
  title.style.cssText = 'margin:0 0 16px;';
  card.appendChild(title);

  const nameLabel = el('label', undefined, t('ui.driverCreation.nameLabel'));
  nameLabel.style.cssText = 'display:block;margin-bottom:4px;';
  card.appendChild(nameLabel);
  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.maxLength = cfg.driver.nameMaxLength;
  nameInput.value = 'Driver';
  nameInput.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:16px;padding:6px;';
  card.appendChild(nameInput);

  const base = Math.floor(cfg.startingSkillPool / cfg.skills.length);
  const remainder = cfg.startingSkillPool - base * cfg.skills.length;
  const skillInputs = new Map<SkillName, HTMLInputElement>();
  const remainingLabel = el('div');
  remainingLabel.style.cssText = 'margin:8px 0;color:#8a97a8;';

  function currentTotal(): number {
    let total = 0;
    for (const input of skillInputs.values()) total += Number.parseInt(input.value, 10) || 0;
    return total;
  }
  function refreshRemaining(): void {
    remainingLabel.textContent = t('ui.driverCreation.pointsRemaining', {
      count: cfg.startingSkillPool - currentTotal(),
    });
  }

  cfg.skills.forEach((skillName, index) => {
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    const label = el('span', undefined, skillName);
    const input = el('input');
    input.type = 'number';
    input.min = String(cfg.skillMin);
    input.max = String(cfg.skillMax);
    input.value = String(base + (index === cfg.skills.length - 1 ? remainder : 0));
    input.style.cssText = 'width:80px;padding:4px;';
    input.addEventListener('input', refreshRemaining);
    row.appendChild(label);
    row.appendChild(input);
    card.appendChild(row);
    skillInputs.set(skillName, input);
  });
  card.appendChild(remainingLabel);
  refreshRemaining();

  const message = el('div');
  message.style.cssText = 'color:#ff6b6b;min-height:20px;margin:8px 0;';
  card.appendChild(message);

  const submit = el('button', undefined, t('ui.driverCreation.title'));
  submit.style.cssText = 'width:100%;padding:10px;background:#4fd6c4;border:none;border-radius:4px;cursor:pointer;font-weight:600;';
  submit.addEventListener('click', () => {
    const skills = {} as Record<SkillName, number>;
    for (const [skillName, input] of skillInputs) {
      skills[skillName] = Number.parseInt(input.value, 10) || 0;
    }
    const result = createDriver(nameInput.value.trim(), skills);
    if (!result.ok) {
      message.textContent = result.reason;
      return;
    }
    onCreated(result.driver);
  });
  card.appendChild(submit);

  container.appendChild(card);
  clearAndAppend(root, container);
  nameInput.focus();
}

// ---------------------------------------------------------------------------
// Screen 3: Constructor
// ---------------------------------------------------------------------------

function showConstructor(
  root: HTMLElement,
  driver: DriverState,
  onBuilt: (driver: DriverState, confirmed: BuilderConfirmedBuild) => void,
  onCancel: () => void,
  existingCarNames: readonly string[] = [],
  ownedCarCount = 0,
): void {
  const container = el('div', 'sm-screen sm-screen--constructor');
  container.style.cssText = 'position:absolute;inset:0;';
  clearAndAppend(root, container);

  mountBuilder({
    container,
    context: { cash: driver.cash, existingCarNames, ownedCarCount },
    onBuilt: (confirmed) => {
      const chargedDriver: DriverState = { ...driver, cash: driver.cash - confirmed.costTotal };
      onBuilt(chargedDriver, confirmed);
    },
    onCancel,
  });
}

// ---------------------------------------------------------------------------
// Vehicle construction: BuilderConfirmedBuild -> a real runtime VehicleState
// ---------------------------------------------------------------------------

export function vehicleStateFromConfirmedBuild(confirmed: BuilderConfirmedBuild, ownerId: string): VehicleState {
  const design = confirmed.design;
  const tire = getTire(design.tireId);
  const plant = getPlant(design.plantId);

  return {
    id: `veh-${ownerId}`,
    ownerId,
    design,
    position: { x: 0, y: 0 },
    headingRad: 0,
    speedMps: 0,
    battery: drivingConfig().battery.full,
    odometerMiles: 0,
    armorDP: { ...design.armor },
    tireDP: [tire.maxDP, tire.maxDP, tire.maxDP, tire.maxDP],
    plantDP: plant.maxDP,
    weapons: design.weapons.map((mounted) => {
      const def = getWeapon(mounted.weaponId);
      return {
        weaponId: mounted.weaponId,
        facing: mounted.facing,
        ammo: mounted.ammo,
        dp: def.maxDP,
        maxDP: def.maxDP,
        cooldownRemaining: 0,
        destroyed: false,
      };
    }),
    cargo: [],
    controlStress: 0,
    controlLossTicks: 0,
    statusEffects: [],
    destroyed: false,
  };
}

export function replaceVehicle(world: World, vehicle: VehicleState): void {
  const index = world.entities.vehicles.findIndex((candidate) => candidate.id === vehicle.id);
  if (index >= 0) world.entities.vehicles[index] = vehicle;
}

export function findPlayer(world: World): VehicleState | undefined {
  return world.entities.vehicles.find((vehicle) => vehicle.ownerId === PLAYER_ID);
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

/** Restores a throwaway Rng from the world's serialized state, hands it to `fn`, then serializes the advanced state back — the same restore/draw/serialize convention `@/sim/world`'s RngState round-trip requires. */
export function withWorldRng<T>(world: World, fn: (rng: ReturnType<typeof createRng>) => T): T {
  const rng = createRng(0);
  rng.restore(world.rngState);
  const result = fn(rng);
  world.rngState = rng.serialize();
  return result;
}

export function makeDrivingSystem(driverRef: { current: DriverState }): SystemFn {
  return (world, input, dtSeconds) => {
    const player = findPlayer(world);
    if (player === undefined || player.destroyed) return;
    const driveInput: DriveInput = { stick: { x: input.moveX, y: input.moveY } };
    const drivingSkill = getSkill(driverRef.current, 'driving');
    const nextVehicle = withWorldRng(world, (rng) =>
      stepDriving({
        vehicle: player,
        input: driveInput,
        dtSeconds,
        rng: { next: () => rng.nextFloat() },
        drivingSkill,
        surface: 'normal',
      }),
    ).vehicle;
    replaceVehicle(world, nextVehicle);
  };
}

export function makeWeaponsSystem(driverRef: { current: DriverState }, spawnCounter: { current: number }, log: (kind: HudMessageKind, text: string) => void): SystemFn {
  return (world, input) => {
    const player = findPlayer(world);
    if (player === undefined || player.destroyed) return;

    const cooled = tickCooldowns(player, 1);
    replaceVehicle(world, cooled);
    if (!input.fire) return;

    const weapon = cooled.weapons[input.weaponSlot];
    if (weapon === undefined || weapon.facing === 'UNDERBODY') return;

    const weaponDef = getWeapon(weapon.weaponId);
    const direction = facingWorldDirection(cooled.headingRad, weapon.facing);
    const targetPosition = {
      x: cooled.position.x + direction.x * weaponDef.rangeM,
      y: cooled.position.y + direction.y * weaponDef.rangeM,
    };
    const marksmanshipSkill = getSkill(driverRef.current, 'marksmanship');
    const spawnedEntityId = `proj-${world.tick}-${spawnCounter.current}`;
    spawnCounter.current += 1;

    const result = withWorldRng(world, (rng) => {
      const command: FireCommand = {
        vehicle: cooled,
        weaponSlotIndex: input.weaponSlot,
        target: { position: targetPosition, headingRad: cooled.headingRad },
        ctx: {
          rng,
          marksmanshipSkill,
          rangePenaltyPercent: 0,
          relativeMotionPenaltyPercent: 0,
          smokePenaltyPercent: 0,
          paintPenaltyPercent: 0,
        },
        tick: world.tick,
        spawnedEntityId,
        deployDropOffsetM: 2,
      };
      return fire(command);
    });
    replaceVehicle(world, result.vehicle);
    if (!result.ok) {
      if (result.reason === 'NO_AMMO') log('info', t('ui.weapon.outOfAmmo', { weapon: weaponDef.name }));
      return;
    }
    if (result.spawn?.kind === 'PROJECTILE') {
      world.entities.projectiles.push(result.spawn.projectile);
      log('hit', t('ui.weapon.fired', { weapon: weaponDef.name }));
    }
  };
}

export const projectilesSystem: SystemFn = (world, _input, dtSeconds) => {
  world.entities.projectiles = world.entities.projectiles.map((projectile) => advanceProjectile(projectile, dtSeconds));
};

export const cleanupSystem: SystemFn = (world) => {
  world.entities.projectiles = world.entities.projectiles.filter((projectile) => !projectileExpired(projectile));
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface RenderResources {
  readonly pipeline: GPURenderPipeline;
  readonly cameraBuffer: GPUBuffer;
  readonly cameraBindGroup: GPUBindGroup;
  readonly tileInstanceBuffer: GPUBuffer;
  readonly tileBindGroup: GPUBindGroup;
  readonly spriteInstanceBuffer: GPUBuffer;
  readonly spriteBindGroup: GPUBindGroup;
  readonly texture: GPUTexture;
}

const TILE_INSTANCE_CAPACITY = FLOOR_TILES_PER_SIDE * FLOOR_TILES_PER_SIDE;
const SPRITE_INSTANCE_CAPACITY = 16;

async function buildRenderResources(
  gpuCtx: GpuContext,
  atlasBitmap: ImageBitmap,
  spriteShaderSource: string,
): Promise<RenderResources> {
  const device = gpuCtx.getDevice();
  const format = gpuCtx.getFormat();

  const shaderModule = createShaderModule(device, 'sprite-shader', spriteShaderSource);
  const cameraLayout = createCameraBindGroupLayout(device);
  const atlasLayout = createAtlasBindGroupLayout(device);
  const pipeline = createLayerPipeline({
    device,
    shaderModule,
    targetFormat: format,
    cameraLayout,
    atlasLayout,
    blendMode: 'alpha-blend',
    label: 'world-sprites',
  });

  const cameraBuffer = createCameraUniformBuffer(device);
  const cameraBindGroup = createCameraBindGroup(device, cameraLayout, cameraBuffer);

  const texture = device.createTexture({
    label: 'atlas-0',
    size: { width: atlasBitmap.width, height: atlasBitmap.height, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: atlasBitmap }, { texture }, {
    width: atlasBitmap.width,
    height: atlasBitmap.height,
  });
  const textureView = texture.createView();
  const sampler = createAtlasSampler(device);

  const tileInstanceBuffer = createInstanceStorageBuffer(device, TILE_INSTANCE_CAPACITY);
  const tileBindGroup = createAtlasBindGroup(device, atlasLayout, tileInstanceBuffer, sampler, textureView);
  const spriteInstanceBuffer = createInstanceStorageBuffer(device, SPRITE_INSTANCE_CAPACITY);
  const spriteBindGroup = createAtlasBindGroup(device, atlasLayout, spriteInstanceBuffer, sampler, textureView);

  return { pipeline, cameraBuffer, cameraBindGroup, tileInstanceBuffer, tileBindGroup, spriteInstanceBuffer, spriteBindGroup, texture };
}

function buildFloorInstances(atlasIndex: AtlasIndex): SpriteInstanceInput[] {
  const frame: FrameInfo = atlasIndex.frame('tile-concrete-arena');
  const uv = frame.uv;
  const half = (FLOOR_TILES_PER_SIDE * FLOOR_TILE_SIZE_M) / 2;
  const instances: SpriteInstanceInput[] = [];
  for (let row = 0; row < FLOOR_TILES_PER_SIDE; row++) {
    for (let col = 0; col < FLOOR_TILES_PER_SIDE; col++) {
      instances.push({
        atlasId: '0',
        position: {
          x: col * FLOOR_TILE_SIZE_M - half + FLOOR_TILE_SIZE_M / 2,
          y: row * FLOOR_TILE_SIZE_M - half + FLOOR_TILE_SIZE_M / 2,
        },
        rotationRad: 0,
        sizeM: { x: FLOOR_TILE_SIZE_M, y: FLOOR_TILE_SIZE_M },
        uvRect: uv,
        tint: { r: 1, g: 1, b: 1, a: 1 },
        layer: 0,
      });
    }
  }
  return instances;
}

function vehicleSpriteInstance(vehicle: VehicleState, atlasIndex: AtlasIndex): SpriteInstanceInput {
  const frame = atlasIndex.frame(`car-${vehicle.design.bodyId}`);
  return {
    atlasId: '0',
    position: { ...vehicle.position },
    rotationRad: vehicle.headingRad + degToRad(frame.rotationOffsetDeg),
    sizeM: VEHICLE_SPRITE_SIZE_M,
    uvRect: frame.uv,
    tint: { r: 1, g: 1, b: 1, a: 1 },
    layer: 1,
  };
}

// ---------------------------------------------------------------------------
// Screen 4: Arena
// ---------------------------------------------------------------------------

/** Best-effort autosave on exit: two-phase-commits a `SaveGame` (via `@/persist/save`) capturing the live `World` — rngState (tick position included), entities and all — so `boot()`'s next "Continue" restores it verbatim instead of ever re-deriving a seed. Failure (private browsing blocking IndexedDB, etc.) is logged and swallowed — never something the player should lose their run over. */
async function persistArenaSession(
  openDb: () => Promise<IDBDatabase>,
  driverState: DriverState,
  world: World,
): Promise<void> {
  const vehicle = findPlayer(world);
  if (vehicle === undefined) return;
  const seed = seedKeyToDisplaySeed(world.rngState.seedKey);
  const clock = world.clock;
  const vehicles: Record<string, VehicleState> = { [vehicle.id]: vehicle };
  const game: SaveGame = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rulesetVersion: 'classic-1',
    seed: seedFingerprint(seed),
    currentDay: clock.dayIndex,
    phase: clock.phase,
    location: ARENA_EVENT_ID,
    driver: driverState,
    activeVehicleId: vehicle.id,
    vehicles,
    jobs: [],
    quests: [],
    world,
    // Driver-level stream (jobs/quests/economy - none of which this practice
    // shell has yet) - a substream of the same session seed, independent of
    // the world's own draws, per `@/persist/save`'s `SaveGame.rngState` doc.
    rngState: createRng(seed).stream('driver').serialize(),
    lastSafeCitySnapshot: {
      day: clock.dayIndex,
      phase: clock.phase,
      location: ARENA_EVENT_ID,
      driver: driverState,
      vehicles,
      activeVehicleId: vehicle.id,
    },
  };
  try {
    const db = await openDb();
    await save(db, game);
  } catch (error) {
    console.warn('smduel: autosave failed', error);
  }
}

/**
 * Builds a fresh new-game arena `World`, seeded from the resolved session
 * seed - never re-derived, never the clock. Exported (not inlined in
 * `showArena`) as a seam: it's the exact production code the session seed's
 * reproducibility contract depends on, so a test can drive THIS function
 * directly instead of a parallel reimplementation that could silently drift
 * from it (and, as a copy, would never notice this line getting mutated).
 */
export function createArenaWorld(sessionSeed: string, playerVehicle: VehicleState): World {
  const world = createWorld({
    rngSeed: 0, // placeholder - replaced immediately below by the real session-seeded RNG state
    arena: { id: ARENA_EVENT_ID, kind: 'arena' },
    entities: { vehicles: [playerVehicle] },
  });
  world.rngState = createRng(sessionSeed).serialize();
  return world;
}

export interface ArenaSession {
  /** The seed driving this world's RNG - resolved once at new-game time, or recovered from a restored save. Never re-derived mid-session. */
  readonly sessionSeed: string;
  /** A restored save's live World, reused verbatim (rngState, tick position and all) instead of building a fresh one. Absent for a brand-new session. */
  readonly restoreWorld?: World;
  readonly openDb: () => Promise<IDBDatabase>;
}

/** What `resolveArenaWorld` hands back: either the World + driver `showArena` should run with, or a human-readable refusal (e.g. can't afford the practice fee) for the caller to display instead of entering the arena. */
export type ArenaWorldResolution =
  | { readonly ok: true; readonly chargedDriver: DriverState; readonly world: World }
  | { readonly ok: false; readonly reason: string };

/**
 * Decides, and builds, the World + driver `showArena` runs with - the exact
 * branch between reusing a restored save's live World verbatim and charging
 * the practice fee then building a brand-new one from `session.sessionSeed`
 * via `createArenaWorld`. Extracted out of `showArena` (which also owns a
 * live `root`/canvas and can't be driven headlessly) as its own DOM-free
 * seam, so a test can drive this exact decision directly - including the
 * `createArenaWorld(session.sessionSeed, playerVehicle)` call site - instead
 * of only the `createArenaWorld` half of it.
 */
export function resolveArenaWorld(driver: DriverState, playerVehicle: VehicleState, session: ArenaSession): ArenaWorldResolution {
  if (session.restoreWorld !== undefined) {
    // Resuming a save: the practice fee was already charged (and the match
    // already begun) the first time this session entered the arena, so
    // `driver` here IS that already-charged state - beginArenaMatch must not
    // run a second time and charge it again. `world` is the exact restored
    // World - rngState (tick position included), entities and all - never
    // rebuilt and never reseeded.
    return { ok: true, chargedDriver: driver, world: session.restoreWorld };
  }
  const matchResult = beginArenaMatch(driver, { design: playerVehicle.design, destroyed: false }, ARENA_EVENT_ID);
  if (!matchResult.ok) return { ok: false, reason: matchResult.reason };
  return { ok: true, chargedDriver: matchResult.driver, world: createArenaWorld(session.sessionSeed, playerVehicle) };
}

function showArena(
  root: HTMLElement,
  driver: DriverState,
  playerVehicle: VehicleState,
  session: ArenaSession,
  onExit: () => void,
): void {
  const container = el('div', 'sm-screen sm-screen--arena');
  container.style.cssText = 'position:absolute;inset:0;background:#05070a;';
  const canvas = el('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  const hudHost = el('div');
  hudHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  const status = el('div');
  status.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);color:#d7e0ea;font-family:system-ui,sans-serif;font-size:13px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;';
  const exitBtn = el('button', undefined, t('ui.arena.exitToTitle'));
  exitBtn.style.cssText =
    'position:absolute;top:8px;right:8px;pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';
  container.appendChild(canvas);
  container.appendChild(hudHost);
  container.appendChild(status);
  container.appendChild(exitBtn);
  clearAndAppend(root, container);

  lastSessionSeed = session.sessionSeed;
  const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);

  const resolution = resolveArenaWorld(driver, playerVehicle, session);
  if (!resolution.ok) {
    status.textContent = t('ui.arena.cannotEnterPractice', { reason: resolution.reason });
    exitBtn.addEventListener('click', onExit, { once: true });
    return;
  }
  const { chargedDriver, world } = resolution;

  const driverRef = { current: chargedDriver };
  const spawnCounter = { current: 0 };
  const messages: HudMessage[] = [];
  let messageCounter = 0;
  function logMessage(kind: HudMessageKind, text: string): void {
    messages.push({ id: `msg-${messageCounter}`, kind, text, tick: world.tick });
    messageCounter += 1;
    if (messages.length > 20) messages.shift();
  }
  console.info(`smduel: session seed ${session.sessionSeed}`);
  logMessage(
    'info',
    session.restoreWorld !== undefined
      ? t('ui.arena.practiceResumed', { seed: session.sessionSeed })
      : t('ui.arena.practiceEntered', { seed: session.sessionSeed }),
  );

  const systems = createSystemsRegistry();
  systems.register('driving', makeDrivingSystem(driverRef));
  systems.register('weapons', makeWeaponsSystem(driverRef, spawnCounter, logMessage));
  systems.register('projectiles', projectilesSystem);
  systems.register('cleanup', cleanupSystem);

  // --- input --------------------------------------------------------------
  const heldKeys = new Set<string>();
  let activeWeaponIndex: number | null = playerVehicle.weapons.length > 0 ? 0 : null;
  function onKeyDown(ev: KeyboardEvent): void {
    heldKeys.add(ev.key.toLowerCase());
    if (ev.key === 'q' || ev.key === 'Q') cycleWeapon(-1);
    if (ev.key === 'e' || ev.key === 'E') cycleWeapon(1);
  }
  function onKeyUp(ev: KeyboardEvent): void {
    heldKeys.delete(ev.key.toLowerCase());
  }
  function cycleWeapon(delta: number): void {
    const player = findPlayer(world);
    const count = player?.weapons.length ?? 0;
    if (count === 0) {
      activeWeaponIndex = null;
      return;
    }
    const base = activeWeaponIndex ?? 0;
    activeWeaponIndex = (((base + delta) % count) + count) % count;
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function sampleInput(): InputFrame {
    let moveX = 0;
    let moveY = 0;
    if (heldKeys.has('arrowleft') || heldKeys.has('a')) moveX -= 1;
    if (heldKeys.has('arrowright') || heldKeys.has('d')) moveX += 1;
    if (heldKeys.has('arrowup') || heldKeys.has('w')) moveY += 1;
    if (heldKeys.has('arrowdown') || heldKeys.has('s')) moveY -= 1;
    const fire = heldKeys.has(' ') || heldKeys.has('j');
    return { moveX, moveY, fire, weaponSlot: activeWeaponIndex ?? 0 };
  }

  const loop = createGameLoop({ world, dtSeconds, systems, sampleInput });

  // --- HUD ------------------------------------------------------------------
  const hudContainer = document.createElement('div');
  hudContainer.style.pointerEvents = 'auto';
  hudHost.appendChild(hudContainer);
  const hudDoc = new DomHudDocument();
  const hudRoot = new DomHudElement(hudContainer);
  let hudSettings: HudSettings = { scale: 1, radarOrientation: 'world', reducedFlash: false, reducedShake: false };

  function renderHudFrame(): void {
    const player = findPlayer(world);
    if (player === undefined) return;
    const plant = getPlant(player.design.plantId);
    const accelMphPerSec = computeBuild(player.design).accelMphPerSec;
    const snapshot: HudSnapshot = {
      vehicle: player,
      activeWeaponIndex,
      accelMphPerSec,
      radar: { enabled: !isRadarDisabled(player.plantDP, plant.radarFailureThreshold), contacts: [] },
      driver: { naturalHealth: driverRef.current.naturalHealth, bodyArmor: driverRef.current.bodyArmor },
      messages,
      settings: hudSettings,
    };
    renderHud(hudDoc, hudRoot, snapshot, {
      onToggleRadarOrientation: () => {
        hudSettings = { ...hudSettings, radarOrientation: hudSettings.radarOrientation === 'world' ? 'heading' : 'world' };
        renderHudFrame();
      },
      onToggleReducedFlash: () => {
        hudSettings = { ...hudSettings, reducedFlash: !hudSettings.reducedFlash };
        renderHudFrame();
      },
      onToggleReducedShake: () => {
        hudSettings = { ...hudSettings, reducedShake: !hudSettings.reducedShake };
        renderHudFrame();
      },
    });
  }

  // --- WebGPU ---------------------------------------------------------------
  let gpuCtx: GpuContext | undefined;
  let resources: RenderResources | undefined;
  let atlasIndex: AtlasIndex | undefined;
  let floorInstances: SpriteInstanceInput[] = [];
  const camera: Camera = createCamera();
  camera.setZoom(PIXELS_PER_METER_CSS);

  async function initRenderer(): Promise<void> {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const init = await initGpu(canvas);
    if (!init.ok) {
      status.textContent = t('ui.arena.webgpuUnavailable', { reason: init.reason.kind });
      return;
    }
    gpuCtx = init.context;
    status.textContent = t('ui.arena.practiceHint', { seed: session.sessionSeed });

    atlasIndex = loadAtlasIndex(atlasManifestRaw);
    floorInstances = buildFloorInstances(atlasIndex);

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    resources = await buildRenderResources(gpuCtx, atlasBitmap, spriteShaderSource);

    gpuCtx.onRecovered(() => {
      void buildRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource).then((rebuilt) => {
        resources = rebuilt;
      });
    });
    gpuCtx.onRecoveryFailed((reason) => {
      status.textContent = t('ui.arena.webgpuDeviceLost', { reason: reason.kind });
      resources = undefined;
    });
  }

  function renderFrame(): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;
    const player = findPlayer(world);
    if (player === undefined) return;

    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setCenter(player.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    const spriteInstances = [vehicleSpriteInstance(player, atlasIndex)];
    writeInstanceBuffer(gpuCtx.getDevice(), resources.tileInstanceBuffer, packInstances(floorInstances));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.spriteInstanceBuffer, packInstances(spriteInstances));

    const encoder = gpuCtx.getDevice().createCommandEncoder({ label: 'frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpuCtx.getContext().getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.tileBindGroup, instanceCount: floorInstances.length },
    ]);
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.spriteBindGroup, instanceCount: spriteInstances.length },
    ]);
    pass.end();
    gpuCtx.getDevice().queue.submit([encoder.finish()]);
  }

  // --- main loop --------------------------------------------------------------
  let rafHandle = 0;
  let lastTimeMs = performance.now();
  let stopped = false;
  function frame(nowMs: number): void {
    if (stopped) return;
    // Clamped to >= 0: a `requestAnimationFrame` timestamp reflects when the
    // frame started, which can land before a `performance.now()` sampled
    // after an intervening `await` (e.g. `initRenderer()`'s fetches) —
    // measured going negative (~-7ms) on the very first frame after asset
    // load, which `loop.advance` rejects outright (see its own RangeError).
    const deltaSeconds = Math.max(0, Math.min((nowMs - lastTimeMs) / 1000, 0.25));
    lastTimeMs = nowMs;
    loop.advance(deltaSeconds);
    renderFrame();
    renderHudFrame();
    rafHandle = window.requestAnimationFrame(frame);
  }

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    gpuCtx?.destroy();
  }

  exitBtn.addEventListener('click', () => {
    stop();
    void persistArenaSession(session.openDb, chargedDriver, world);
    onExit();
  });

  void initRenderer().finally(() => {
    lastTimeMs = performance.now();
    rafHandle = window.requestAnimationFrame(frame);
  });
}


// ---------------------------------------------------------------------------
// Session state threaded between City / Building / Road / Arena screens
// ---------------------------------------------------------------------------

/**
 * Everything the city/road loop carries from screen to screen after the
 * constructor. Modeled on `@/sim/economy`'s single-active-vehicle
 * `EconomyWorld` (the same shape `@/ui/buildings/garage` already reads/
 * writes through `BuildingContext`) rather than `@/sim/services`'s separate
 * multi-car `Fleet` - a full garaged-fleet UI (retrieving a DIFFERENT
 * stored car) is out of this integration pass's scope; `fleetSize` is
 * fixed at 1 (the one active vehicle) so `@/ui/buildings/assembly`'s
 * fleet-cap gate still works honestly off a real number.
 */
interface CityRunState {
  readonly driver: DriverState;
  readonly vehicle: VehicleState;
  readonly vehicleStored: boolean;
  readonly clock: Clock;
  readonly cityId: string;
  readonly sessionSeed: string;
  readonly openDb: () => Promise<IDBDatabase>;
  /** One seeded stream for the whole session's non-arena, non-road draws (courier offers, casino, mechanic lessons, illicit-sale consequences) plus road-trip encounter rolls - advances as it's drawn from, same convention `@/sim/world`'s `rngState` uses. */
  readonly rng: Rng;
  readonly rumorsHeardToday: ReadonlyMap<string, RumorId>;
  readonly activeCourierJobs: readonly AcceptedJob[];
}

function buildingContextFrom(state: CityRunState): BuildingContext {
  return {
    driver: state.driver,
    clock: state.clock,
    cityId: state.cityId,
    vehicle: state.vehicle,
    vehicleStored: state.vehicleStored,
    fleetSize: 1,
    existingCarNames: [state.vehicle.design.name],
    rng: state.rng,
    rumorsHeardToday: state.rumorsHeardToday,
    activeCourierJobs: state.activeCourierJobs,
  };
}

/** Applies a `BuildingContext` a panel handed back on exit onto `state` - every field a building can actually change, nothing else. `ctx.vehicle` is defensively kept non-null (see `BuildingContext`'s doc comment: none of the currently-wired building panels null it out - `@/sim/economy`'s storeCar only flips `vehicleStored`). */
function applyBuildingContext(state: CityRunState, ctx: BuildingContext): CityRunState {
  return {
    ...state,
    driver: ctx.driver,
    clock: ctx.clock,
    cityId: ctx.cityId,
    vehicle: ctx.vehicle ?? state.vehicle,
    vehicleStored: ctx.vehicleStored,
    rumorsHeardToday: ctx.rumorsHeardToday,
    activeCourierJobs: ctx.activeCourierJobs,
  };
}

// ---------------------------------------------------------------------------
// Screen 4b: Arena, entered from a city's arena building
// ---------------------------------------------------------------------------
//
// Reuses the exact rendering/input/HUD helpers `showArena` (the boot-time
// practice screen below `resolveArenaWorld`) already built - real driving,
// real weapon fire, real projectiles, real HUD. `mountArenaBuilding`
// (`@/ui/buildings/arena`) already ran the real `beginArenaMatch` before
// this screen ever mounts, so eligibility and the entry fee are exactly as
// real as the boot-time path.
//
// SCOPE LIMIT (documented, not silently papered over): opponent vehicles
// are not yet spawned or AI-driven in this integration pass - wiring
// `@/sim/ai`'s real `decideAI` against real opponent `VehicleState`s needs a
// projectile/vehicle collision radius that no ruleset file defines yet (a
// new tunable this pass has no authority to invent - see the file header's
// "no gameplay constant literal" hard rule), so it is left for a follow-up
// that adds that field to a ruleset table first. Every event is still
// enterable and fairly charges/resolves through the real
// `beginArenaMatch`/`resolveArenaExit` pipeline: an event with real
// opponents can currently only be exited as an ESCAPE (prestige penalty,
// car kept, matching `resolveArenaExit`'s own honest behavior when
// `opponentsDefeated` never reaches `opponentsTotal`), while `practice`
// (0 opponents) still resolves a real VICTORY exactly as it always has.
function showArenaEvent(
  root: HTMLElement,
  chargedDriver: DriverState,
  playerVehicle: VehicleState,
  matchState: ArenaMatchState,
  clock: Clock,
  cityState: CityRunState,
  onComplete: (nextState: CityRunState) => void,
): void {
  const event = getArenaEvent(matchState.eventId);
  const container = el('div', 'sm-screen sm-screen--arena');
  container.style.cssText = 'position:absolute;inset:0;background:#05070a;';
  const canvas = el('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  const hudHost = el('div');
  hudHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  const status = el('div');
  status.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);color:#d7e0ea;font-family:system-ui,sans-serif;font-size:13px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;';
  const exitBtn = el('button', undefined, t('ui.arena.exitToTitle'));
  exitBtn.style.cssText =
    'position:absolute;top:8px;right:8px;pointer-events:auto;padding:6px 10px;background:#2a3444;color:#d7e0ea;border:1px solid #4fd6c4;border-radius:4px;cursor:pointer;';
  container.appendChild(canvas);
  container.appendChild(hudHost);
  container.appendChild(status);
  container.appendChild(exitBtn);
  clearAndAppend(root, container);

  lastSessionSeed = cityState.sessionSeed;
  const dtSeconds = dtSecondsFromTickRate(drivingConfig().tickRateHz);

  const world = createArenaWorld(cityState.sessionSeed, playerVehicle);
  world.clock = clock;

  const driverRef = { current: chargedDriver };
  const spawnCounter = { current: 0 };
  const messages: HudMessage[] = [];
  let messageCounter = 0;
  function logMessage(kind: HudMessageKind, text: string): void {
    messages.push({ id: `msg-${messageCounter}`, kind, text, tick: world.tick });
    messageCounter += 1;
    if (messages.length > 20) messages.shift();
  }
  logMessage('info', t('ui.arena.eventEntered', { event: event.name, count: matchState.opponentsTotal }));

  const systems = createSystemsRegistry();
  systems.register('driving', makeDrivingSystem(driverRef));
  systems.register('weapons', makeWeaponsSystem(driverRef, spawnCounter, logMessage));
  systems.register('projectiles', projectilesSystem);
  systems.register('cleanup', cleanupSystem);

  const heldKeys = new Set<string>();
  let activeWeaponIndex: number | null = playerVehicle.weapons.length > 0 ? 0 : null;
  function onKeyDown(ev: KeyboardEvent): void {
    heldKeys.add(ev.key.toLowerCase());
    if (ev.key === 'q' || ev.key === 'Q') cycleWeapon(-1);
    if (ev.key === 'e' || ev.key === 'E') cycleWeapon(1);
  }
  function onKeyUp(ev: KeyboardEvent): void {
    heldKeys.delete(ev.key.toLowerCase());
  }
  function cycleWeapon(delta: number): void {
    const player = findPlayer(world);
    const count = player?.weapons.length ?? 0;
    if (count === 0) {
      activeWeaponIndex = null;
      return;
    }
    const base = activeWeaponIndex ?? 0;
    activeWeaponIndex = (((base + delta) % count) + count) % count;
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function sampleInput(): InputFrame {
    let moveX = 0;
    let moveY = 0;
    if (heldKeys.has('arrowleft') || heldKeys.has('a')) moveX -= 1;
    if (heldKeys.has('arrowright') || heldKeys.has('d')) moveX += 1;
    if (heldKeys.has('arrowup') || heldKeys.has('w')) moveY += 1;
    if (heldKeys.has('arrowdown') || heldKeys.has('s')) moveY -= 1;
    const fire = heldKeys.has(' ') || heldKeys.has('j');
    return { moveX, moveY, fire, weaponSlot: activeWeaponIndex ?? 0 };
  }

  const loop = createGameLoop({ world, dtSeconds, systems, sampleInput });

  const hudContainer = document.createElement('div');
  hudContainer.style.pointerEvents = 'auto';
  hudHost.appendChild(hudContainer);
  const hudDoc = new DomHudDocument();
  const hudRoot = new DomHudElement(hudContainer);
  let hudSettings: HudSettings = { scale: 1, radarOrientation: 'world', reducedFlash: false, reducedShake: false };

  function renderHudFrame(): void {
    const player = findPlayer(world);
    if (player === undefined) return;
    const plant = getPlant(player.design.plantId);
    const accelMphPerSec = computeBuild(player.design).accelMphPerSec;
    const snapshot: HudSnapshot = {
      vehicle: player,
      activeWeaponIndex,
      accelMphPerSec,
      radar: { enabled: !isRadarDisabled(player.plantDP, plant.radarFailureThreshold), contacts: [] },
      driver: { naturalHealth: driverRef.current.naturalHealth, bodyArmor: driverRef.current.bodyArmor },
      messages,
      settings: hudSettings,
    };
    renderHud(hudDoc, hudRoot, snapshot, {
      onToggleRadarOrientation: () => {
        hudSettings = { ...hudSettings, radarOrientation: hudSettings.radarOrientation === 'world' ? 'heading' : 'world' };
        renderHudFrame();
      },
      onToggleReducedFlash: () => {
        hudSettings = { ...hudSettings, reducedFlash: !hudSettings.reducedFlash };
        renderHudFrame();
      },
      onToggleReducedShake: () => {
        hudSettings = { ...hudSettings, reducedShake: !hudSettings.reducedShake };
        renderHudFrame();
      },
    });
  }

  let gpuCtx: GpuContext | undefined;
  let resources: RenderResources | undefined;
  let atlasIndex: AtlasIndex | undefined;
  let floorInstances: SpriteInstanceInput[] = [];
  const camera: Camera = createCamera();
  camera.setZoom(PIXELS_PER_METER_CSS);

  async function initRenderer(): Promise<void> {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const init = await initGpu(canvas);
    if (!init.ok) {
      status.textContent = t('ui.arena.webgpuUnavailable', { reason: init.reason.kind });
      return;
    }
    gpuCtx = init.context;
    status.textContent = t('ui.arena.eventHint', { event: event.name });

    atlasIndex = loadAtlasIndex(atlasManifestRaw);
    floorInstances = buildFloorInstances(atlasIndex);

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    resources = await buildRenderResources(gpuCtx, atlasBitmap, spriteShaderSource);

    gpuCtx.onRecovered(() => {
      void buildRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource).then((rebuilt) => {
        resources = rebuilt;
      });
    });
    gpuCtx.onRecoveryFailed((reason) => {
      status.textContent = t('ui.arena.webgpuDeviceLost', { reason: reason.kind });
      resources = undefined;
    });
  }

  function renderFrame(): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;
    const player = findPlayer(world);
    if (player === undefined) return;

    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setCenter(player.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    const spriteInstances = [vehicleSpriteInstance(player, atlasIndex)];
    writeInstanceBuffer(gpuCtx.getDevice(), resources.tileInstanceBuffer, packInstances(floorInstances));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.spriteInstanceBuffer, packInstances(spriteInstances));

    const encoder = gpuCtx.getDevice().createCommandEncoder({ label: 'arena-event-frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpuCtx.getContext().getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.tileBindGroup, instanceCount: floorInstances.length },
    ]);
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.spriteBindGroup, instanceCount: spriteInstances.length },
    ]);
    pass.end();
    gpuCtx.getDevice().queue.submit([encoder.finish()]);
  }

  let rafHandle = 0;
  let lastTimeMs = performance.now();
  let stopped = false;
  function frame(nowMs: number): void {
    if (stopped) return;
    const deltaSeconds = Math.max(0, Math.min((nowMs - lastTimeMs) / 1000, 0.25));
    lastTimeMs = nowMs;
    loop.advance(deltaSeconds);
    renderFrame();
    renderHudFrame();
    rafHandle = window.requestAnimationFrame(frame);
  }

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    gpuCtx?.destroy();
  }

  exitBtn.addEventListener('click', () => {
    stop();
    const player = findPlayer(world);
    const exitMode: ArenaExitMode = player?.destroyed === true ? 'ON_FOOT' : 'UNDER_POWER';
    const resolution: ArenaResolution = resolveArenaExit(matchState, driverRef.current, exitMode);
    const nextClock = advanceDays(world.clock, resolution.daysConsumed);
    const nextVehicle = player ?? playerVehicle;
    onComplete({ ...cityState, driver: resolution.driver, vehicle: nextVehicle, clock: nextClock });
  });

  void initRenderer().finally(() => {
    lastTimeMs = performance.now();
    rafHandle = window.requestAnimationFrame(frame);
  });
}

// ---------------------------------------------------------------------------
// Screen 5: City
// ---------------------------------------------------------------------------

interface CityRenderResources {
  readonly pipeline: GPURenderPipeline;
  readonly cameraBuffer: GPUBuffer;
  readonly cameraBindGroup: GPUBindGroup;
  readonly groundInstanceBuffer: GPUBuffer;
  readonly groundBindGroup: GPUBindGroup;
  readonly buildingInstanceBuffer: GPUBuffer;
  readonly buildingBindGroup: GPUBindGroup;
  readonly actorInstanceBuffer: GPUBuffer;
  readonly actorBindGroup: GPUBindGroup;
  readonly texture: GPUTexture;
}

/** The player on foot plus, at most, one parked-or-ridden car - the two actor-layer instances `@/ui/city-view`'s `buildCityInstances` can ever emit in one frame. */
const CITY_ACTOR_INSTANCE_CAPACITY = 2;

/** Exact tile count `@/ui/city-view`'s own `groundInstances` loop emits for `layout` - mirrors that loop's bounds precisely so the GPU buffer is neither wastefully oversized nor (worse) too small to hold a real frame. */
function cityGroundTileCount(layout: CityLayout): number {
  const half = layout.boundsRadiusM + layout.tileSizeM;
  const steps = Math.floor((2 * half) / layout.tileSizeM) + 1;
  return steps * steps;
}

async function buildCityRenderResources(
  gpuCtx: GpuContext,
  atlasBitmap: ImageBitmap,
  spriteShaderSource: string,
  groundCapacity: number,
  buildingCapacity: number,
): Promise<CityRenderResources> {
  const device = gpuCtx.getDevice();
  const format = gpuCtx.getFormat();

  const shaderModule = createShaderModule(device, 'city-sprite-shader', spriteShaderSource);
  const cameraLayout = createCameraBindGroupLayout(device);
  const atlasLayout = createAtlasBindGroupLayout(device);
  const pipeline = createLayerPipeline({
    device,
    shaderModule,
    targetFormat: format,
    cameraLayout,
    atlasLayout,
    blendMode: 'alpha-blend',
    label: 'city-sprites',
  });

  const cameraBuffer = createCameraUniformBuffer(device);
  const cameraBindGroup = createCameraBindGroup(device, cameraLayout, cameraBuffer);

  const texture = device.createTexture({
    label: 'city-atlas-0',
    size: { width: atlasBitmap.width, height: atlasBitmap.height, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: atlasBitmap }, { texture }, {
    width: atlasBitmap.width,
    height: atlasBitmap.height,
  });
  const textureView = texture.createView();
  const sampler = createAtlasSampler(device);

  const groundInstanceBuffer = createInstanceStorageBuffer(device, groundCapacity);
  const groundBindGroup = createAtlasBindGroup(device, atlasLayout, groundInstanceBuffer, sampler, textureView);
  const buildingInstanceBuffer = createInstanceStorageBuffer(device, buildingCapacity);
  const buildingBindGroup = createAtlasBindGroup(device, atlasLayout, buildingInstanceBuffer, sampler, textureView);
  const actorInstanceBuffer = createInstanceStorageBuffer(device, CITY_ACTOR_INSTANCE_CAPACITY);
  const actorBindGroup = createAtlasBindGroup(device, atlasLayout, actorInstanceBuffer, sampler, textureView);

  return {
    pipeline,
    cameraBuffer,
    cameraBindGroup,
    groundInstanceBuffer,
    groundBindGroup,
    buildingInstanceBuffer,
    buildingBindGroup,
    actorInstanceBuffer,
    actorBindGroup,
    texture,
  };
}

/** cities.json's routes touching `cityId`, resolved to the neighbor city id - the gate's route-choice prompt needs this same shape `@/sim/courier`'s own (private) `routeNeighborsOf` computes internally for offer generation. */
function cityRouteNeighbors(cityId: string): { route: RouteDef; neighborCityId: string }[] {
  const neighbors: { route: RouteDef; neighborCityId: string }[] = [];
  for (const route of citiesConfig().routes) {
    if (route.a === cityId) neighbors.push({ route, neighborCityId: route.b });
    else if (route.b === cityId) neighbors.push({ route, neighborCityId: route.a });
  }
  return neighbors;
}

/** WASD/arrows -> one of `@/sim/city`'s eight compass `CityDirection`s, or null for centered/no input - the 8-way convention `stepWalk` expects (not the arena/road screens' free 2D stick vector). */
function cityDirectionFromKeys(heldKeys: ReadonlySet<string>): CityDirection | null {
  let x = 0;
  let y = 0;
  if (heldKeys.has('arrowleft') || heldKeys.has('a')) x -= 1;
  if (heldKeys.has('arrowright') || heldKeys.has('d')) x += 1;
  if (heldKeys.has('arrowup') || heldKeys.has('w')) y -= 1;
  if (heldKeys.has('arrowdown') || heldKeys.has('s')) y += 1;
  if (x === 0 && y === 0) return null;
  if (x === 0) return y < 0 ? 'N' : 'S';
  if (y === 0) return x < 0 ? 'W' : 'E';
  if (x < 0) return y < 0 ? 'NW' : 'SW';
  return y < 0 ? 'NE' : 'SE';
}

/**
 * The walkable town: doorways into every facility, a gate onto the road,
 * and the player's own parked/ridden car - `@/sim/city` + `@/ui/city-view`
 * do all the real work here, this function only wires them to real
 * keyboard input, a live WebGPU frame (falling back to a text-only status
 * line exactly like the arena screen does when `navigator.gpu` is absent),
 * and the building/gate transitions into `@/ui/buildings`, the constructor,
 * an arena match, or a road trip.
 */
function showCity(root: HTMLElement, state: CityRunState): void {
  const container = el('div', 'sm-screen sm-screen--city');
  container.style.cssText = 'position:absolute;inset:0;background:#05070a;';
  const canvas = el('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  const status = el('div');
  status.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);color:#d7e0ea;font-family:system-ui,sans-serif;font-size:13px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;text-align:center;white-space:pre;';
  const panelHost = el('div');
  panelHost.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,7,10,0.55);';
  container.appendChild(canvas);
  container.appendChild(status);
  container.appendChild(panelHost);
  clearAndAppend(root, container);

  lastSessionSeed = state.sessionSeed;

  const layout: CityLayout = generateCityLayout(state.cityId, state.sessionSeed);
  // Road and city coordinates are different spaces (see `@/sim/road`'s own
  // 1D route-progress model) - entering a city (fresh build, road arrival,
  // or returning from the constructor/an arena match) always parks the car
  // at THIS city's gate, never at whatever position it happened to hold in
  // the screen the player was just on.
  let runState: CityRunState = {
    ...state,
    vehicle: { ...state.vehicle, position: { ...layout.gate.position }, headingRad: 0 },
  };
  let player: CityPlayerState = createCityPlayerState({ ...layout.gate.position });
  let paused = false;

  function citySnapshot(): CityViewSnapshot {
    const vehicleView: CityVehicleView = {
      position: runState.vehicle.position,
      headingRad: runState.vehicle.headingRad,
      bodyId: runState.vehicle.design.bodyId,
    };
    return { layout, player, vehicle: runState.vehicleStored ? null : vehicleView };
  }

  function updateStatus(): void {
    status.textContent = t('ui.city.status', {
      city: cityName(runState.cityId),
      day: runState.clock.dayIndex,
      phase: runState.clock.phase,
      cash: runState.driver.cash,
    });
  }

  function openPanel(): HTMLElement {
    paused = true;
    panelHost.innerHTML = '';
    panelHost.style.display = 'flex';
    const card = el('div');
    card.style.cssText = 'width:min(480px,92vw);max-height:86vh;overflow:auto;';
    panelHost.appendChild(card);
    return card;
  }

  function closePanel(): void {
    panelHost.style.display = 'none';
    panelHost.innerHTML = '';
    paused = false;
  }

  function openFacility(kind: string): void {
    const card = openPanel();
    let mounted: MountedFacility | undefined;
    mounted = mountFacility({
      container: card,
      kind,
      context: buildingContextFrom(runState),
      onExit: (ctx) => {
        runState = applyBuildingContext(runState, ctx);
        mounted?.destroy();
        closePanel();
      },
      onOpenConstructor: () => {
        mounted?.destroy();
        stop();
        showConstructor(
          root,
          runState.driver,
          (chargedDriver, confirmed) => {
            const newVehicle = vehicleStateFromConfirmedBuild(confirmed, PLAYER_ID);
            runState = { ...runState, driver: chargedDriver, vehicle: newVehicle, vehicleStored: false };
            showCity(root, runState);
          },
          () => showCity(root, runState),
          [runState.vehicle.design.name],
          1,
        );
      },
      onEnterArena: (result: ArenaEntryResult) => {
        mounted?.destroy();
        stop();
        showArenaEvent(root, result.driver, runState.vehicle, result.matchState, runState.clock, runState, (nextState) => {
          runState = nextState;
          showCity(root, runState);
        });
      },
    });
  }

  function openGatePrompt(): void {
    if (runState.vehicleStored) {
      // Can't drive out without retrieving the car from the garage first -
      // just resume walking instead of stranding the player on a dead menu.
      return;
    }
    const card = openPanel();
    const neighbors = cityRouteNeighbors(runState.cityId);
    const actions: MenuAction[] = neighbors.map((n) => ({
      id: `route-${n.route.id}`,
      label: t('ui.city.routeOption', { city: cityName(n.neighborCityId), miles: n.route.lengthMiles, danger: n.route.danger }),
      eligible: true,
    }));
    actions.push(leaveAction());

    const mounted = mountMenu({
      container: card,
      header: { cash: runState.driver.cash, dayIndex: runState.clock.dayIndex, phase: runState.clock.phase, cityName: cityName(runState.cityId) },
      actions,
      onActivate: (id) => {
        mounted.destroy();
        if (id === LEAVE_ACTION_ID) {
          closePanel();
          return;
        }
        const routeId = id.slice('route-'.length);
        const found = neighbors.find((n) => n.route.id === routeId);
        if (found === undefined) {
          closePanel();
          return;
        }
        closePanel();
        stop();
        const resolved: ResolvedRoute = resolveRoute(runState.cityId, found.neighborCityId);
        const trip = beginRoadTrip(resolved, runState.vehicle, runState.clock, runState.rng);
        showRoad(root, runState, trip, (nextState) => showCity(root, nextState));
      },
      onBack: () => {
        mounted.destroy();
        closePanel();
      },
    });
  }

  function handleTrigger(trigger: CityTrigger): void {
    if (trigger.kind === 'gate') openGatePrompt();
    else if (trigger.kind === 'facility') openFacility(trigger.facilityKind);
  }

  // --- input --------------------------------------------------------------
  const heldKeys = new Set<string>();
  function onKeyDown(ev: KeyboardEvent): void {
    heldKeys.add(ev.key.toLowerCase());
    if ((ev.key === 'g' || ev.key === 'G') && !paused) {
      const toggled = toggleVehicle(player, runState.vehicle.position);
      if (toggled.ok) player = toggled.player;
    }
  }
  function onKeyUp(ev: KeyboardEvent): void {
    heldKeys.delete(ev.key.toLowerCase());
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // --- WebGPU ---------------------------------------------------------------
  let gpuCtx: GpuContext | undefined;
  let resources: CityRenderResources | undefined;
  let atlasIndex: AtlasIndex | undefined;
  const camera: Camera = createCamera();
  camera.setZoom(PIXELS_PER_METER_CSS);

  async function initRenderer(): Promise<void> {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const init = await initGpu(canvas);
    if (!init.ok) return; // text-only status line still runs the real game below.
    gpuCtx = init.context;

    atlasIndex = loadAtlasIndex(atlasManifestRaw);

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    const groundCapacity = cityGroundTileCount(layout);
    const buildingCapacity = layout.doorways.length + 1;
    resources = await buildCityRenderResources(gpuCtx, atlasBitmap, spriteShaderSource, groundCapacity, buildingCapacity);

    gpuCtx.onRecovered(() => {
      void buildCityRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource, groundCapacity, buildingCapacity).then((rebuilt) => {
        resources = rebuilt;
      });
    });
    gpuCtx.onRecoveryFailed(() => {
      resources = undefined;
    });
  }

  function renderFrame(): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;

    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setCenter(player.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    const instances = buildCityInstances(citySnapshot(), atlasIndex);
    // @/ui/city-view's own layer scheme: 0 = ground, 1 = building/gate, 2 = actor (player/vehicle).
    const ground = instances.filter((i) => i.layer === 0);
    const buildings = instances.filter((i) => i.layer === 1);
    const actors = instances.filter((i) => i.layer === 2);
    writeInstanceBuffer(gpuCtx.getDevice(), resources.groundInstanceBuffer, packInstances(ground));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.buildingInstanceBuffer, packInstances(buildings));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.actorInstanceBuffer, packInstances(actors));

    const encoder = gpuCtx.getDevice().createCommandEncoder({ label: 'city-frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpuCtx.getContext().getCurrentTexture().createView(),
          clearValue: { r: 0.05, g: 0.07, b: 0.06, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [{ bindGroup: resources.groundBindGroup, instanceCount: ground.length }]);
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.buildingBindGroup, instanceCount: buildings.length },
    ]);
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [{ bindGroup: resources.actorBindGroup, instanceCount: actors.length }]);
    pass.end();
    gpuCtx.getDevice().queue.submit([encoder.finish()]);
  }

  // --- main loop --------------------------------------------------------------
  let rafHandle = 0;
  let lastTimeMs = performance.now();
  let stopped = false;
  function frame(nowMs: number): void {
    if (stopped) return;
    const dtSeconds = Math.max(0, Math.min((nowMs - lastTimeMs) / 1000, 0.25));
    lastTimeMs = nowMs;
    if (!paused) {
      const direction = cityDirectionFromKeys(heldKeys);
      const step = stepWalk({ player, layout, direction, dtSeconds, clock: runState.clock });
      player = step.player;
      runState = { ...runState, clock: step.clock };
      if (step.trigger.kind !== 'none') handleTrigger(step.trigger);
    }
    updateStatus();
    renderFrame();
    rafHandle = window.requestAnimationFrame(frame);
  }

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    gpuCtx?.destroy();
  }

  updateStatus();
  void initRenderer().finally(() => {
    lastTimeMs = performance.now();
    rafHandle = window.requestAnimationFrame(frame);
  });
}

// ---------------------------------------------------------------------------
// Screen 6: Road
// ---------------------------------------------------------------------------

/**
 * Real-time driving of `initialTrip`'s route (`@/sim/road`'s own
 * `stepRoadTrip`, which itself drives the vehicle through
 * `@/sim/driving`'s `stepDriving` - the exact same movement model the
 * arena and city screens use) until the odometer crosses the route's
 * length, then hands the arrived vehicle/clock and the destination city id
 * back to `onArrive`.
 */
function showRoad(root: HTMLElement, state: CityRunState, initialTrip: RoadTripState, onArrive: (nextState: CityRunState) => void): void {
  const container = el('div', 'sm-screen sm-screen--road');
  container.style.cssText = 'position:absolute;inset:0;background:#05070a;';
  const canvas = el('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  const status = el('div');
  status.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);color:#d7e0ea;font-family:system-ui,sans-serif;font-size:13px;background:rgba(10,14,20,0.7);padding:4px 10px;border-radius:4px;text-align:center;';
  container.appendChild(canvas);
  container.appendChild(status);
  clearAndAppend(root, container);

  lastSessionSeed = state.sessionSeed;

  let trip = initialTrip;
  const drivingSkill = getSkill(state.driver, 'driving');

  const heldKeys = new Set<string>();
  function onKeyDown(ev: KeyboardEvent): void {
    heldKeys.add(ev.key.toLowerCase());
  }
  function onKeyUp(ev: KeyboardEvent): void {
    heldKeys.delete(ev.key.toLowerCase());
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function sampleStick(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (heldKeys.has('arrowleft') || heldKeys.has('a')) x -= 1;
    if (heldKeys.has('arrowright') || heldKeys.has('d')) x += 1;
    if (heldKeys.has('arrowup') || heldKeys.has('w')) y += 1;
    if (heldKeys.has('arrowdown') || heldKeys.has('s')) y -= 1;
    return { x, y };
  }

  let gpuCtx: GpuContext | undefined;
  let resources: RenderResources | undefined;
  let atlasIndex: AtlasIndex | undefined;
  let floorInstances: SpriteInstanceInput[] = [];
  const camera: Camera = createCamera();
  camera.setZoom(PIXELS_PER_METER_CSS);

  async function initRenderer(): Promise<void> {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const init = await initGpu(canvas);
    if (!init.ok) return;
    gpuCtx = init.context;

    atlasIndex = loadAtlasIndex(atlasManifestRaw);
    floorInstances = buildFloorInstances(atlasIndex);

    const atlasImageUrl = new URL('../assets/atlas-0.png', import.meta.url).href;
    const spriteShaderUrl = new URL('./render/shaders/sprite.wgsl', import.meta.url);
    const [atlasBlob, spriteShaderSource] = await Promise.all([
      fetch(atlasImageUrl).then((response) => response.blob()),
      fetch(spriteShaderUrl).then((response) => response.text()),
    ]);
    const atlasBitmap = await createImageBitmap(atlasBlob);
    resources = await buildRenderResources(gpuCtx, atlasBitmap, spriteShaderSource);

    gpuCtx.onRecovered(() => {
      void buildRenderResources(gpuCtx as GpuContext, atlasBitmap, spriteShaderSource).then((rebuilt) => {
        resources = rebuilt;
      });
    });
    gpuCtx.onRecoveryFailed(() => {
      resources = undefined;
    });
  }

  function renderFrame(): void {
    if (gpuCtx === undefined || resources === undefined || atlasIndex === undefined || gpuCtx.isPaused()) return;
    const size = gpuCtx.getSize();
    camera.setViewportPx(size.width, size.height);
    camera.setDevicePixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.setCenter(trip.vehicle.position);
    writeCameraUniform(gpuCtx.getDevice(), resources.cameraBuffer, camera.worldToClipMatrix());

    const spriteInstances = [vehicleSpriteInstance(trip.vehicle, atlasIndex)];
    writeInstanceBuffer(gpuCtx.getDevice(), resources.tileInstanceBuffer, packInstances(floorInstances));
    writeInstanceBuffer(gpuCtx.getDevice(), resources.spriteInstanceBuffer, packInstances(spriteInstances));

    const encoder = gpuCtx.getDevice().createCommandEncoder({ label: 'road-frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpuCtx.getContext().getCurrentTexture().createView(),
          clearValue: { r: 0.03, g: 0.04, b: 0.03, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.tileBindGroup, instanceCount: floorInstances.length },
    ]);
    encodeSpritePass(pass, resources.pipeline, resources.cameraBindGroup, [
      { bindGroup: resources.spriteBindGroup, instanceCount: spriteInstances.length },
    ]);
    pass.end();
    gpuCtx.getDevice().queue.submit([encoder.finish()]);
  }

  let rafHandle = 0;
  let lastTimeMs = performance.now();
  let stopped = false;

  function stop(): void {
    stopped = true;
    window.cancelAnimationFrame(rafHandle);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    gpuCtx?.destroy();
  }

  function finish(): void {
    stop();
    const crossing = crossDestinationGate(trip);
    const destinationCityId = crossing?.cityId ?? state.cityId;
    const arrivedVehicle = crossing?.vehicle ?? trip.vehicle;
    onArrive({ ...state, vehicle: arrivedVehicle, cityId: destinationCityId, clock: trip.clock });
  }

  function frame(nowMs: number): void {
    if (stopped) return;
    const dtSeconds = Math.max(0, Math.min((nowMs - lastTimeMs) / 1000, 0.25));
    lastTimeMs = nowMs;
    const stick = sampleStick();
    const result = stepRoadTrip(trip, { stick }, dtSeconds, state.rng, drivingSkill, 'normal');
    trip = result.state;
    const remainingMiles = Math.max(0, Math.round(trip.resolved.route.lengthMiles - trip.progressMiles));
    status.textContent = t('ui.road.status', {
      city: cityName(trip.resolved.destinationCityId),
      miles: remainingMiles,
      day: trip.clock.dayIndex,
      phase: trip.clock.phase,
    });
    renderFrame();
    if (result.arrived) {
      finish();
      return;
    }
    rafHandle = window.requestAnimationFrame(frame);
  }

  void initRenderer().finally(() => {
    lastTimeMs = performance.now();
    rafHandle = window.requestAnimationFrame(frame);
  });
}

// ---------------------------------------------------------------------------
// Boot entry point
// ---------------------------------------------------------------------------

export interface BootOptions {
  /** Defaults to `window.location.search`. Overridable for testing without a DOM `location`. */
  readonly search?: string;
  /** Defaults to `randomSessionSeed` (real crypto). Overridable for deterministic tests. */
  readonly randomSeed?: () => string;
  /** Defaults to opening the real IndexedDB save database. Overridable for testing. */
  readonly openDb?: () => Promise<IDBDatabase>;
}

export async function boot(root: HTMLElement, bootOptions: BootOptions = {}): Promise<void> {
  validateAllRulesets();

  const search = bootOptions.search ?? window.location.search;
  const openDb = bootOptions.openDb ?? (() => openSaveDatabase());
  const seedOverride = seedOverrideFromSearch(search);
  const randomSeed = bootOptions.randomSeed ?? randomSessionSeed;

  async function loadExistingSave(): Promise<LoadResult | null> {
    // An explicit ?seed= override always starts a brand-new session for
    // reproducing one specific bug report - it must never silently resume
    // whatever was already mid-session in IndexedDB instead.
    if (seedOverride !== null) return null;
    try {
      const db = await openDb();
      return await load(db);
    } catch {
      // Nothing saved yet (SaveNotFoundError), or IndexedDB unavailable
      // (private browsing, etc.) - either way, fall through to New Driver.
      return null;
    }
  }

  function startNewSession(): void {
    const sessionSeed = resolveSessionSeed({ search, randomSeed });
    lastSessionSeed = sessionSeed;
    console.info(`smduel: new session, seed ${sessionSeed}`);
    showDriverCreation(root, (driver) => {
      function openConstructor(): void {
        showConstructor(
          root,
          driver,
          (chargedDriver, confirmed) => {
            const vehicle = vehicleStateFromConfirmedBuild(confirmed, PLAYER_ID);
            const cityState: CityRunState = {
              driver: chargedDriver,
              vehicle,
              vehicleStored: false,
              clock: initialClock(),
              cityId: chargedDriver.cityId,
              sessionSeed,
              openDb,
              rng: createRng(sessionSeed).stream('driver'),
              rumorsHeardToday: new Map(),
              activeCourierJobs: [],
            };
            showCity(root, cityState);
          },
          // Escape just restarts the constructor with a fresh (still legal,
          // still affordable) default build rather than stranding the
          // player with no way forward - there is no screen above this one
          // to cancel back to yet.
          openConstructor,
        );
      }
      openConstructor();
    });
  }

  function resumeSession(existing: LoadResult): void {
    const vehicleId = existing.game.activeVehicleId ?? Object.keys(existing.game.vehicles)[0];
    const vehicle = vehicleId !== undefined ? existing.game.vehicles[vehicleId] : undefined;
    if (vehicle === undefined || existing.game.world === null) {
      // Nothing resumable (saved between screens with no live arena) - a
      // fresh session is the only option, same as if no save existed.
      startNewSession();
      return;
    }
    // Routed through `resolveResumeSessionSeed` (not just read off the save
    // directly) so the resume path honors the same documented priority
    // order as a new session - in practice this always resolves to the
    // save's own seed, since `loadExistingSave` above already refuses to
    // resume at all when `?seed=` is present, but it's the seam that keeps
    // this call itself exercised instead of dead code no test can reach.
    const sessionSeed = resolveResumeSessionSeed(existing.game.world, { search, randomSeed });
    lastSessionSeed = sessionSeed;
    console.info(`smduel: resumed session, seed ${sessionSeed}`);
    showArena(root, existing.game.driver, vehicle, { sessionSeed, restoreWorld: existing.game.world, openDb }, () => void start());
  }

  async function start(): Promise<void> {
    const existing = await loadExistingSave();
    showTitle(root, {
      onNewDriver: () => startNewSession(),
      ...(existing !== null ? { onContinue: () => resumeSession(existing) } : {}),
    });
  }

  await start();
}
