/**
 * Orthographic top-down camera, working entirely in METERS.
 *
 * ZERO GAMEPLAY LOGIC: this module holds a viewport size, a zoom and a
 * centre point, and turns those into a world-to-clip matrix plus a visible
 * AABB for culling. It never decides where the camera SHOULD point (that is
 * the app's job, driven by wherever the player vehicle actually is each
 * frame) and never touches sim/** or rulesets/**.
 *
 * World convention: X right, Y up (math convention), matching WebGPU's NDC
 * (x right, y up), so `worldToClip` needs no vertical flip.
 */

export interface Vec2M {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned world-space bounds, in meters. */
export interface AabbM {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface Camera {
  /**
   * Sets the GPU canvas's physical (already devicePixelRatio-scaled) backing
   * size in pixels. This is the same size passed to `GpuContext.resize`.
   */
  setViewportPx(widthPx: number, heightPx: number): void;
  /** Moves the camera's centre to `worldMeters`. Called every frame to keep the player near screen centre. */
  setCenter(worldMeters: Vec2M): void;
  getCenter(): Vec2M;
  /**
   * Sets zoom in CSS pixels-per-meter (i.e. independent of devicePixelRatio):
   * doubling devicePixelRatio with the same zoom and the same CSS viewport
   * size shows the same amount of the world, just at higher backing resolution.
   */
  setZoom(pixelsPerMeterCss: number): void;
  getZoom(): number;
  setDevicePixelRatio(dpr: number): void;
  getDevicePixelRatio(): number;

  /** Half-extents of the world currently visible, in meters. */
  getHalfExtentsM(): Vec2M;
  /** The visible world-space AABB, in meters, for CPU-side culling. */
  getVisibleBounds(): AabbM;

  /**
   * Column-major mat4x4<f32>, ready to upload into a `mat4x4<f32>` uniform
   * exactly as returned (WGSL uniform buffers expect column-major storage).
   * Maps a world-space point (meters, z=0) to clip space.
   */
  worldToClipMatrix(): Float32Array;
}

interface CameraState {
  viewportWidthPx: number;
  viewportHeightPx: number;
  centerX: number;
  centerY: number;
  pixelsPerMeterCss: number;
  devicePixelRatio: number;
}

function halfExtentsOf(state: CameraState): Vec2M {
  const cssWidth = state.viewportWidthPx / state.devicePixelRatio;
  const cssHeight = state.viewportHeightPx / state.devicePixelRatio;
  return {
    x: cssWidth / state.pixelsPerMeterCss / 2,
    y: cssHeight / state.pixelsPerMeterCss / 2,
  };
}

/**
 * Builds the column-major mat4x4<f32> for an axis-aligned orthographic
 * projection centred on (centerX, centerY) with the given world-space
 * half-extents. Pure function so it is directly testable without a `Camera`.
 */
export function buildOrthoMatrix(centerX: number, centerY: number, halfExtents: Vec2M): Float32Array {
  const sx = 1 / halfExtents.x;
  const sy = 1 / halfExtents.y;
  // Column-major: matrix[col * 4 + row].
  const m = new Float32Array(16);
  m[0] = sx;
  m[5] = sy;
  m[10] = 1;
  m[12] = -centerX * sx;
  m[13] = -centerY * sy;
  m[15] = 1;
  return m;
}

/** Applies a column-major mat4x4<f32> (as produced by `buildOrthoMatrix`) to a world point (z=0, w=1). Pure math, used by tests and by any CPU-side clip-space check. */
export function applyMatrix(matrix: Float32Array, point: Vec2M): Vec2M {
  const x = matrix[0]! * point.x + matrix[4]! * point.y + matrix[12]!;
  const y = matrix[1]! * point.x + matrix[5]! * point.y + matrix[13]!;
  return { x, y };
}

/** Creates a top-down orthographic camera. `pixelsPerMeterCss` and `devicePixelRatio` both default to 1; call `setZoom`/`setDevicePixelRatio` before first use. */
export function createCamera(): Camera {
  const state: CameraState = {
    viewportWidthPx: 1,
    viewportHeightPx: 1,
    centerX: 0,
    centerY: 0,
    pixelsPerMeterCss: 1,
    devicePixelRatio: 1,
  };

  return {
    setViewportPx(widthPx: number, heightPx: number): void {
      state.viewportWidthPx = Math.max(1, widthPx);
      state.viewportHeightPx = Math.max(1, heightPx);
    },
    setCenter(worldMeters: Vec2M): void {
      state.centerX = worldMeters.x;
      state.centerY = worldMeters.y;
    },
    getCenter(): Vec2M {
      return { x: state.centerX, y: state.centerY };
    },
    setZoom(pixelsPerMeterCss: number): void {
      state.pixelsPerMeterCss = Math.max(1e-6, pixelsPerMeterCss);
    },
    getZoom(): number {
      return state.pixelsPerMeterCss;
    },
    setDevicePixelRatio(dpr: number): void {
      state.devicePixelRatio = Math.max(1e-6, dpr);
    },
    getDevicePixelRatio(): number {
      return state.devicePixelRatio;
    },
    getHalfExtentsM(): Vec2M {
      return halfExtentsOf(state);
    },
    getVisibleBounds(): AabbM {
      const half = halfExtentsOf(state);
      return {
        minX: state.centerX - half.x,
        maxX: state.centerX + half.x,
        minY: state.centerY - half.y,
        maxY: state.centerY + half.y,
      };
    },
    worldToClipMatrix(): Float32Array {
      return buildOrthoMatrix(state.centerX, state.centerY, halfExtentsOf(state));
    },
  };
}
