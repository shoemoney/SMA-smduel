/**
 * Typed loader for the asset atlas manifest produced by tools/pack-atlas.mjs
 * (assets/atlas.json). This module owns turning that manifest's pixel-space
 * frame rects into normalized UV rects plus metadata; it holds no GPU state
 * and does no I/O, and it never computes anything about damage, movement or
 * RNG — src/render/** stays render-only per house rule.
 */

/**
 * Frame kinds this loader accepts.
 *
 * MUST stay in step with tools/pack-atlas.mjs's own ASSET_KINDS. They are two
 * separate lists on purpose - src/render/** keeps ZERO imports by design, so it
 * cannot share a constant with a build-time tool - and on 2026-09-26 they
 * drifted: 'building' was added to the packer, the real atlas.json was packed
 * with 16 building frames, and this list rejected every one of them. The city
 * screen threw MalformedAtlasManifestError on load, in production, while 1248
 * tests passed.
 *
 * Nothing caught it because no test parsed the REAL assets/atlas.json through
 * this parser - tests/unit/city.test.ts deliberately uses a synthetic manifest.
 * The guard for that now lives in tests/unit/atlas.test.ts ("the REAL shipped
 * manifest parses"), which is the test that makes this comment enforceable
 * rather than aspirational.
 */
export const ASSET_KINDS = ['tile', 'building', 'prop', 'car', 'wreck', 'cycle', 'fx', 'decal', 'ui'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === 'string' && (ASSET_KINDS as readonly string[]).includes(value);
}

export interface AtlasFileEntry {
  readonly file: string;
  readonly width: number;
  readonly height: number;
}

export interface AtlasFrameEntry {
  readonly atlas: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly trimX: number;
  readonly trimY: number;
  readonly srcW: number;
  readonly srcH: number;
  readonly kind: AssetKind;
  /** Degrees to rotate this frame so its nose/front points up (-Y) at world rotation 0. The renderer MUST apply this per frame (assets/ASSET-NOTES.md section 2). */
  readonly rotationOffsetDeg: number;
}

export interface AtlasManifest {
  readonly atlases: readonly AtlasFileEntry[];
  readonly frames: Readonly<Record<string, AtlasFrameEntry>>;
}

/** A frame's UV rect in normalized 0..1 texture space (top-left origin, matching the atlas PNG's pixel space). */
export interface UVRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** Everything a renderer needs to draw one frame: which atlas, its UVs, and the trim geometry to place it back at its original size. */
export interface FrameInfo {
  readonly name: string;
  readonly kind: AssetKind;
  readonly atlasIndex: number;
  readonly atlasFile: string;
  readonly uv: UVRect;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Offset (in the original, pre-crop source image) of this frame's top-left corner, for un-trimming back to `srcWidth x srcHeight`. */
  readonly trimX: number;
  readonly trimY: number;
  readonly srcWidth: number;
  readonly srcHeight: number;
  /** Degrees to rotate this frame so its nose/front points up (-Y) at world rotation 0. */
  readonly rotationOffsetDeg: number;
}

export class UnknownAtlasFrameError extends Error {
  override readonly name = 'UnknownAtlasFrameError';
  constructor(readonly frameName: string) {
    super(`unknown atlas frame "${frameName}"`);
  }
}

export class MalformedAtlasManifestError extends Error {
  override readonly name = 'MalformedAtlasManifestError';
}

// ---------------------------------------------------------------------------
// Manifest parsing / validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function requireNumber(where: string, key: string, value: unknown): number {
  if (!isFiniteNumber(value)) throw new MalformedAtlasManifestError(`${where}.${key}: expected a finite number`);
  return value;
}

function parseAtlasFileEntry(value: unknown, where: string): AtlasFileEntry {
  if (!isRecord(value)) throw new MalformedAtlasManifestError(`${where}: expected an object`);
  const file = value['file'];
  if (typeof file !== 'string' || file.length === 0) {
    throw new MalformedAtlasManifestError(`${where}.file: expected a non-empty string`);
  }
  const width = requireNumber(where, 'width', value['width']);
  const height = requireNumber(where, 'height', value['height']);
  if (width <= 0 || height <= 0) throw new MalformedAtlasManifestError(`${where}: width/height must be positive`);
  return { file, width, height };
}

function parseAtlasFrameEntry(value: unknown, where: string, atlasCount: number): AtlasFrameEntry {
  if (!isRecord(value)) throw new MalformedAtlasManifestError(`${where}: expected an object`);
  const kind = value['kind'];
  if (!isAssetKind(kind)) {
    throw new MalformedAtlasManifestError(`${where}.kind: expected one of ${ASSET_KINDS.join(', ')}, got ${String(kind)}`);
  }
  const atlas = requireNumber(where, 'atlas', value['atlas']);
  if (!Number.isInteger(atlas) || atlas < 0 || atlas >= atlasCount) {
    throw new MalformedAtlasManifestError(`${where}.atlas: index ${atlas} out of range (${atlasCount} atlas(es))`);
  }
  return {
    atlas,
    x: requireNumber(where, 'x', value['x']),
    y: requireNumber(where, 'y', value['y']),
    w: requireNumber(where, 'w', value['w']),
    h: requireNumber(where, 'h', value['h']),
    trimX: requireNumber(where, 'trimX', value['trimX']),
    trimY: requireNumber(where, 'trimY', value['trimY']),
    srcW: requireNumber(where, 'srcW', value['srcW']),
    srcH: requireNumber(where, 'srcH', value['srcH']),
    kind,
    rotationOffsetDeg: requireNumber(where, 'rotationOffsetDeg', value['rotationOffsetDeg']),
  };
}

/** Parses and validates a raw `atlas.json` payload. Throws `MalformedAtlasManifestError` on any shape mismatch. */
export function parseAtlasManifest(raw: unknown): AtlasManifest {
  if (!isRecord(raw)) throw new MalformedAtlasManifestError('manifest: expected an object');

  const rawAtlases = raw['atlases'];
  if (!Array.isArray(rawAtlases)) throw new MalformedAtlasManifestError('manifest.atlases: expected an array');
  const atlases = rawAtlases.map((entry, i) => parseAtlasFileEntry(entry, `atlases[${i}]`));

  const rawFrames = raw['frames'];
  if (!isRecord(rawFrames)) throw new MalformedAtlasManifestError('manifest.frames: expected an object');
  const frames: Record<string, AtlasFrameEntry> = {};
  for (const [name, entry] of Object.entries(rawFrames)) {
    frames[name] = parseAtlasFrameEntry(entry, `frames.${name}`, atlases.length);
  }

  return { atlases, frames };
}

// ---------------------------------------------------------------------------
// Queryable index
// ---------------------------------------------------------------------------

function frameInfoOf(name: string, entry: AtlasFrameEntry, atlasFile: AtlasFileEntry): FrameInfo {
  return {
    name,
    kind: entry.kind,
    atlasIndex: entry.atlas,
    atlasFile: atlasFile.file,
    uv: {
      u0: entry.x / atlasFile.width,
      v0: entry.y / atlasFile.height,
      u1: (entry.x + entry.w) / atlasFile.width,
      v1: (entry.y + entry.h) / atlasFile.height,
    },
    pixelWidth: entry.w,
    pixelHeight: entry.h,
    trimX: entry.trimX,
    trimY: entry.trimY,
    srcWidth: entry.srcW,
    srcHeight: entry.srcH,
    rotationOffsetDeg: entry.rotationOffsetDeg,
  };
}

/**
 * Typed, queryable view over a parsed atlas manifest. Construct once with
 * the loaded `atlas.json` and keep it for the app's lifetime; `frame()` is
 * the only way render code should turn a name into UVs.
 */
export class AtlasIndex {
  private readonly manifest: AtlasManifest;
  private readonly cache = new Map<string, FrameInfo>();

  constructor(manifest: AtlasManifest) {
    this.manifest = manifest;
  }

  /** The pixel-space + normalized-UV info for `name`. Throws `UnknownAtlasFrameError` if `name` is not in the manifest. */
  frame(name: string): FrameInfo {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;

    const entry = this.manifest.frames[name];
    if (entry === undefined) throw new UnknownAtlasFrameError(name);
    const atlasFile = this.manifest.atlases[entry.atlas];
    if (atlasFile === undefined) throw new UnknownAtlasFrameError(name);

    const info = frameInfoOf(name, entry, atlasFile);
    this.cache.set(name, info);
    return info;
  }

  hasFrame(name: string): boolean {
    return Object.hasOwn(this.manifest.frames, name);
  }

  /** Every frame name present in the manifest. */
  frameNames(): readonly string[] {
    return Object.keys(this.manifest.frames);
  }

  /** Every frame whose `kind` matches `kind`, sorted by name for a stable listing. */
  framesOfKind(kind: AssetKind): readonly FrameInfo[] {
    return this.frameNames()
      .filter((name) => this.manifest.frames[name]?.kind === kind)
      .sort()
      .map((name) => this.frame(name));
  }

  /** The atlas files this manifest references (index-aligned with each frame's `atlasIndex`). */
  atlasFiles(): readonly AtlasFileEntry[] {
    return this.manifest.atlases;
  }
}

/** Parses `raw` and constructs an `AtlasIndex` in one call. */
export function loadAtlasIndex(raw: unknown): AtlasIndex {
  return new AtlasIndex(parseAtlasManifest(raw));
}
