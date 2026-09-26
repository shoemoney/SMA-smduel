/**
 * Render pipeline cache.
 *
 * ZERO GAMEPLAY LOGIC: this file only memoizes `GPURenderPipeline` creation
 * by a structural key. It never decides damage, movement, or RNG, and it
 * imports nothing from rulesets or sim.
 */

export type BlendMode = 'opaque' | 'alpha-blend' | 'additive';
export type DepthMode = 'none' | 'read-write' | 'read-only';

/** The pipeline cache key: identical keys must always reuse one pipeline. */
export interface PipelineKey {
  /** Caller-assigned id for a compiled `GPUShaderModule` (see `ShaderModuleCache`). */
  readonly shaderModuleId: string;
  readonly blendMode: BlendMode;
  readonly depthMode: DepthMode;
  readonly topology: GPUPrimitiveTopology;
  readonly targetFormat: GPUTextureFormat;
}

function encodeKey(key: PipelineKey): string {
  return `${key.shaderModuleId}|${key.blendMode}|${key.depthMode}|${key.topology}|${key.targetFormat}`;
}

/** The `GPUBlendState` (or `undefined` for opaque, no blending) for a `BlendMode`. */
export function blendStateFor(mode: BlendMode): GPUBlendState | undefined {
  switch (mode) {
    case 'opaque':
      return undefined;
    case 'alpha-blend':
      return {
        color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      };
    case 'additive':
      return {
        color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one' },
        alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
      };
  }
}

/** The `GPUDepthStencilState` (or `undefined` for no depth test) for a `DepthMode`. */
export function depthStencilStateFor(mode: DepthMode, depthFormat: GPUTextureFormat): GPUDepthStencilState | undefined {
  switch (mode) {
    case 'none':
      return undefined;
    case 'read-write':
      return { format: depthFormat, depthWriteEnabled: true, depthCompare: 'less' };
    case 'read-only':
      return { format: depthFormat, depthWriteEnabled: false, depthCompare: 'less-equal' };
  }
}

/**
 * A cache of arbitrary pipeline-like values (normally `GPURenderPipeline`),
 * keyed by `(shaderModuleId, blendMode, depthMode, topology, targetFormat)`.
 * Pipeline creation itself is injected via `create`, so this stays testable
 * without a real `GPUDevice`: an identical key always returns the SAME
 * cached value instead of calling `create` again.
 */
export class PipelineCache<T = GPURenderPipeline> {
  private readonly cache = new Map<string, T>();

  /** Number of distinct pipelines currently cached. */
  get size(): number {
    return this.cache.size;
  }

  has(key: PipelineKey): boolean {
    return this.cache.has(encodeKey(key));
  }

  /** Returns the cached value for `key`, calling `create(key)` only on a miss. */
  getOrCreate(key: PipelineKey, create: (key: PipelineKey) => T): T {
    const cacheKey = encodeKey(key);
    const existing = this.cache.get(cacheKey);
    if (existing !== undefined) return existing;
    const created = create(key);
    this.cache.set(cacheKey, created);
    return created;
  }

  /** Drops every cached pipeline, e.g. after a device-loss rebuild. */
  clear(): void {
    this.cache.clear();
  }
}
