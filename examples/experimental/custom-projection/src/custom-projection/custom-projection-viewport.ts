import type { Viewport } from "@deck.gl/core";
import { OrthographicViewport } from "@deck.gl/core";
import type { CRSDescriptor } from "@math.gl/geospatial/projection/core";
import { pixelsToWorld } from "@math.gl/web-mercator";

type OrthographicViewportOptions = NonNullable<
  ConstructorParameters<typeof OrthographicViewport>[0]
>;

/**
 * Options for {@link CustomProjectionViewport}. Mirrors upstream deck.gl's
 * `CustomProjectionViewportOptions` (v10.0.0-alpha.1), minus `pitch`,
 * `bearing` and `orthographic`, which this shim does not support.
 */
export type CustomProjectionViewportOptions = Omit<
  OrthographicViewportOptions,
  "target" | "flipY" | "zoom" | "zoomX" | "zoomY"
> & {
  /** The resolved target CRS. Must be projected, with axes in meters. */
  crs: CRSDescriptor;
  /** Zoom level; each increment doubles the scale. Matches `MapView` zoom. */
  zoom?: number;
  /**
   * Shim-internal. `OrthographicController` keeps its zoom in `zoomX` /
   * `zoomY`, and while it applies a zoom anchor, `zoom` is stale and these
   * hold the new value, so they win over `zoom`. Independent per-axis zoom is
   * not supported.
   */
  zoomX?: number;
  /** Shim-internal; see `zoomX`. */
  zoomY?: number;
  /** Camera center in WGS84 longitude/latitude. Defaults to `[0, 0, 0]`. */
  center?: number[];
  /**
   * Camera center in map meters. Shim-internal: the controller writes it so
   * that panning outside the projection's invertible area keeps working.
   * Takes precedence over `center`.
   */
  target?: [number, number, number] | [number, number];
  /**
   * Subdivision intervals around the Earth, as upstream. Part of
   * `projectionSignature`; otherwise unused by the shim, whose vector layers
   * are projected on the CPU.
   */
  resolution?: number;
};

/** Earth circumference in meters, as used by upstream deck.gl. */
const EC = 40075016.6855;

/**
 * Common-space units per meter. Identical to upstream's
 * `NORMALIZATION_SCALE`, which makes zoom levels match `MapView`: at zoom `z`
 * there are `512 * 2 ** z` pixels per Earth circumference.
 */
export const NORMALIZATION_SCALE = 512 / EC;

/**
 * Largest distance, in common units, between a map position and its inverse
 * projected forward again, for the inverse to count as valid.
 */
const ROUND_TRIP_TOLERANCE = 1e-5;

/**
 * Interim stand-in for upstream deck.gl's experimental
 * `_CustomProjectionViewport` (v10.0.0-alpha.1), built on
 * `OrthographicViewport`.
 *
 * World units are map meters in `crs`; common space is map meters scaled by
 * {@link NORMALIZATION_SCALE}, exactly as upstream. Differences from
 * upstream:
 *
 * - Top-down orthographic camera only: no pitch or bearing.
 * - Meter-based CRSs only. Upstream also scales other linear units.
 * - `project`/`unproject`, `projectPosition` and `getBounds` work in map
 *   meters, not WGS84. Convert with `crs.converter.WGS84`.
 * - Layers are never preprojected: positions must be supplied in map meters
 *   with `coordinateSystem: "cartesian"` (which upstream supports too).
 *
 * The members shared with upstream (`crs`, `projectFlat`, `unprojectFlat`,
 * `projectionSignature`) have upstream's semantics, so code written against
 * them works with both.
 */
export class CustomProjectionViewport extends OrthographicViewport {
  static override displayName = "CustomProjectionViewport";

  /** The target CRS. `crs.converter.WGS84` converts to and from map meters. */
  readonly crs: CRSDescriptor;
  private readonly signature: string;

  constructor(opts: CustomProjectionViewportOptions) {
    const { crs, resolution = 0, center = [0, 0, 0] } = opts;
    if (!Number.isFinite(resolution) || resolution < 0) {
      throw new Error(
        "CustomProjectionViewport requires finite, non-negative resolution",
      );
    }
    assertMeterAxes(crs);

    let target = opts.target ?? projectCenter(crs, center);
    if (!Number.isFinite(target[0]) || !Number.isFinite(target[1])) {
      // A center the projection can't handle would make every matrix NaN.
      target = [0, 0, 0];
    }
    const zoom = opts.zoomX ?? opts.zoom ?? 0;

    super({
      ...opts,
      target: [target[0]!, target[1]!, 0],
      zoom,
      zoomX: zoom,
      zoomY: zoom,
      // Map Y points up, like every projected CRS.
      flipY: false,
    });

    // `OrthographicViewport` always passes its own (undefined) distance scales
    // to the base class, so set ours afterwards. The shader's
    // `commonUnitsPerWorldUnit` reads these, scaling map meters into common
    // space consistently with `projectFlat` below.
    this.distanceScales = {
      unitsPerMeter: [
        NORMALIZATION_SCALE,
        NORMALIZATION_SCALE,
        NORMALIZATION_SCALE,
      ],
      metersPerUnit: [
        1 / NORMALIZATION_SCALE,
        1 / NORMALIZATION_SCALE,
        1 / NORMALIZATION_SCALE,
      ],
    };

    this.crs = crs;
    this.signature = JSON.stringify([crs.signature, resolution]);
  }

  /**
   * An opaque signature of the CRS and `resolution`. Layers use it to
   * invalidate projected positions.
   */
  get projectionSignature(): string {
    return this.signature;
  }

  /** Converts XY in map meters to common-space XY (fixed linear scale). */
  override projectFlat(xyz: number[]): [number, number] {
    return [xyz[0]! * NORMALIZATION_SCALE, xyz[1]! * NORMALIZATION_SCALE];
  }

  /** Converts common-space XY back to map meters (fixed linear scale). */
  override unprojectFlat(xyz: number[]): [number, number] {
    return [xyz[0]! / NORMALIZATION_SCALE, xyz[1]! / NORMALIZATION_SCALE];
  }

  /**
   * Camera center in WGS84, normalized into the projection's rendering
   * extent, or `null` where the inverse projection fails.
   */
  getCenterInWorld(): [number, number, number] | null {
    const world = unprojectToWorld(this.crs, [this.target[0], this.target[1]]);
    if (!world) {
      return null;
    }
    const normalized = this.crs.converter.WGS84.normalize([...world]);
    return [normalized[0]!, normalized[1]!, 0];
  }

  /**
   * Also compares the projection: deck.gl skips tile traversal when the
   * viewport is unchanged, which must not happen when only the projection
   * changed.
   */
  override equals(viewport: Viewport): boolean {
    return (
      super.equals(viewport) &&
      (viewport as CustomProjectionViewport).projectionSignature ===
        this.signature
    );
  }
}

/**
 * Convert a screen pixel to WGS84, or `null` where the inverse projection
 * fails.
 *
 * Written against members that upstream's `_CustomProjectionViewport` shares
 * with the shim, so it works with both.
 */
export function pixelToWorld(
  viewport: Viewport & { crs: CRSDescriptor },
  pixel: [number, number],
): number[] | null {
  const common = pixelsToWorld(pixel, viewport.pixelUnprojectionMatrix, 0);
  return unprojectToWorld(viewport.crs, viewport.unprojectFlat(common));
}

/**
 * Throw unless every axis of `crs` is in meters. deck.gl's base `Viewport`
 * calls `projectFlat` from its constructor, before a per-CRS scale could be
 * stored, so the shim's scale is a constant.
 */
function assertMeterAxes(crs: CRSDescriptor): void {
  const metersPerUnit = [crs.xUnit, crs.yUnit, crs.zUnit].map(
    (unit) => unit.metersPerUnit,
  );
  if (!metersPerUnit.every((value) => value === 1)) {
    throw new Error(
      "CustomProjectionViewport requires linear CRS axes in meters",
    );
  }
}

/**
 * The camera target in map meters for a WGS84 center, normalized into the
 * projection's rendering extent first. NaN when the center can't be
 * projected.
 */
function projectCenter(crs: CRSDescriptor, center: number[]): number[] {
  const { WGS84 } = crs.converter;
  try {
    return WGS84.from(WGS84.normalize([center[0]!, center[1]!, 0]));
  } catch {
    // math.gl rejects non-finite coordinates; the caller falls back.
    return [Number.NaN, Number.NaN];
  }
}

/**
 * Map meters to WGS84, or `null` where the inverse fails. math.gl throws for
 * some coordinates outside a projection's domain, and beside the map it can
 * return a wrapped longitude instead, which doesn't project back to where it
 * came from.
 */
function unprojectToWorld(
  crs: CRSDescriptor,
  mapMeters: number[],
): [number, number, number] | null {
  const { WGS84 } = crs.converter;
  try {
    const world = WGS84.to([mapMeters[0]!, mapMeters[1]!, 0]);
    if (!Number.isFinite(world[0]) || !Number.isFinite(world[1])) {
      return null;
    }
    const roundTrip = WGS84.from(world);
    const error =
      Math.hypot(roundTrip[0]! - mapMeters[0]!, roundTrip[1]! - mapMeters[1]!) *
      NORMALIZATION_SCALE;
    return error <= ROUND_TRIP_TOLERANCE ? [world[0]!, world[1]!, 0] : null;
  } catch {
    return null;
  }
}
