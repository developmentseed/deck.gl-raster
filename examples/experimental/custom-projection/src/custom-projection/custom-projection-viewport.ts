import type { Viewport } from "@deck.gl/core";
import { OrthographicViewport } from "@deck.gl/core";
import { pixelsToWorld } from "@math.gl/web-mercator";

/**
 * A planar map converter, compatible with proj4js converters targeting a
 * meter-based CRS. Same shape as upstream deck.gl's `ProjectionConverter`.
 */
export type ProjectionConverter = {
  /** Converts world XYZ (`fromCrs`) to map meters (`toCrs`). */
  forward: (position: number[]) => number[];
  /** Converts map-meter XYZ back to world coordinates, or `null` outside its domain. */
  inverse: (position: number[]) => number[] | null;
};

/** `[minX, minY, maxX, maxY]` in world coordinates (`fromCrs`). */
export type FromBounds = [number, number, number, number];

type OrthographicViewportOptions = NonNullable<
  ConstructorParameters<typeof OrthographicViewport>[0]
>;

/**
 * Options for {@link CustomProjectionViewport}. Mirrors upstream deck.gl's
 * `CustomProjectionViewportOptions`, minus `pitch`, `bearing`,
 * `getDistanceScale` and `orthographic`, which this shim does not support.
 */
export type CustomProjectionViewportOptions = Omit<
  OrthographicViewportOptions,
  "target" | "flipY" | "zoom" | "zoomX" | "zoomY"
> & {
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
  /** Converts world XYZ in `fromCrs` to planar map-meter XYZ in `toCrs`, and back. */
  projection: ProjectionConverter;
  /** World-coordinate CRS name or PROJ string. Defaults to `"WGS84"`. */
  fromCrs?: string;
  /** Planar, meter-based map CRS name or PROJ string. */
  toCrs?: string;
  /**
   * The projection's valid domain in `fromCrs`. Positions are clamped to it
   * before being projected.
   */
  fromBounds?: FromBounds;
  /** Camera center in `fromCrs` world coordinates. Defaults to `[0, 0, 0]`. */
  center?: number[];
  /**
   * Camera center in map meters. Shim-internal: the controller writes it so
   * that panning outside the projection's invertible area keeps working.
   * Takes precedence over `center`.
   */
  target?: [number, number, number] | [number, number];
  /**
   * Accepted for API parity with upstream (path subdivision). Unused by the
   * shim: vector layers in this example are preprojected on the CPU.
   */
  resolution?: number;
};

/** Earth circumference in meters, as used by upstream deck.gl. */
const EC = 40075016.6855;

/**
 * Common-space units per map meter. Identical to upstream's
 * `NORMALIZATION_SCALE`, which makes zoom levels match `MapView`: at zoom `z`
 * there are `512 * 2 ** z` pixels per Earth circumference.
 */
export const NORMALIZATION_SCALE = 512 / EC;

/**
 * Interim stand-in for upstream deck.gl's experimental
 * `_CustomProjectionViewport` (visgl/deck.gl#10741, unreleased as of deck.gl
 * 9.4), built on `OrthographicViewport`.
 *
 * World units are map meters in `toCrs`; common space is map meters scaled by
 * {@link NORMALIZATION_SCALE}, exactly as upstream. Differences from upstream:
 *
 * - Top-down orthographic camera only: no pitch or bearing.
 * - `project`/`unproject` and `getBounds` work in map meters, not `fromCrs`.
 *   Use {@link CustomProjectionViewport.preproject} /
 *   {@link CustomProjectionViewport.postUnproject} to convert.
 * - Layers are never preprojected: positions must be supplied in map meters
 *   with `coordinateSystem: "cartesian"` (which upstream supports too).
 *
 * The properties shared with upstream — `preproject`, `postUnproject`,
 * `projectFlat`, `unprojectFlat`, `projectionSignature` — have upstream's
 * semantics, so code written against them works with both.
 */
export class CustomProjectionViewport extends OrthographicViewport {
  static override displayName = "CustomProjectionViewport";

  /** The converter from `fromCrs` world coordinates to map meters. */
  readonly projection: ProjectionConverter;
  /** World-coordinate CRS name. */
  readonly fromCrs: string;
  /** Map CRS name. */
  readonly toCrs: string | undefined;
  /**
   * The projection's valid domain in `fromCrs`. Shim-only: upstream's
   * viewport keeps it private, so code that must also run on upstream should
   * take the bounds explicitly (as `ProjectedCOGLayer`'s `fromBounds` prop
   * does).
   */
  readonly fromBounds: FromBounds | undefined;
  private readonly signature: string;

  constructor(opts: CustomProjectionViewportOptions) {
    const {
      projection,
      fromBounds,
      fromCrs = "WGS84",
      toCrs,
      resolution = 0,
      center = [0, 0, 0],
    } = opts;
    if (!Number.isFinite(resolution) || resolution < 0) {
      throw new Error(
        "CustomProjectionViewport requires finite, non-negative resolution",
      );
    }
    if (
      fromBounds &&
      (!fromBounds.every(Number.isFinite) ||
        fromBounds[2] <= fromBounds[0] ||
        fromBounds[3] <= fromBounds[1])
    ) {
      throw new Error(
        "CustomProjectionViewport requires finite, increasing fromBounds",
      );
    }

    let target =
      opts.target ?? projectWith(projection, fromBounds, [...center]);
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

    this.projection = projection;
    this.fromCrs = fromCrs;
    this.toCrs = toCrs;
    this.fromBounds = fromBounds;
    this.signature = JSON.stringify([fromCrs, toCrs, resolution]);
  }

  /**
   * An opaque signature based only on `fromCrs`, `toCrs` and `resolution`.
   * Layers use it to invalidate projected positions.
   */
  get projectionSignature(): string {
    return this.signature;
  }

  /**
   * Converts world coordinates (`fromCrs`) to XYZ in map meters, clamping to
   * `fromBounds` first. Independent of the camera.
   */
  preproject(position: number[]): [number, number, number] {
    return projectWith(this.projection, this.fromBounds, position);
  }

  /**
   * Converts map-meter XYZ back to world coordinates (`fromCrs`). Returns
   * `null` when the inverse throws, returns non-finite values, or fails a
   * forward round-trip check (some converters extrapolate outside their
   * domain).
   */
  postUnproject(position: number[]): [number, number, number] | null {
    const projected = [position[0]!, position[1]!, position[2] ?? 0];
    try {
      const input = this.projection.inverse(projected.slice());
      if (!input || input.length < 2 || !input.every(Number.isFinite)) {
        return null;
      }
      const roundTrip = this.projection.forward(input.slice());
      if (
        !Number.isFinite(roundTrip[0]) ||
        !Number.isFinite(roundTrip[1]) ||
        Math.hypot(
          roundTrip[0]! - projected[0]!,
          roundTrip[1]! - projected[1]!,
        ) *
          NORMALIZATION_SCALE >
          1e-5
      ) {
        return null;
      }
      const bounded = clampToBounds(input, this.fromBounds);
      return [bounded[0]!, bounded[1]!, bounded[2] ?? projected[2]!];
    } catch {
      return null;
    }
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
   * Camera center in world coordinates (`fromCrs`), or `null` when the map
   * center lies outside the projection's invertible area.
   */
  getCenterInWorld(): [number, number, number] | null {
    return this.postUnproject([this.target[0], this.target[1], 0]);
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
 * Convert a screen pixel to world coordinates (`fromCrs`), or `null` if it
 * falls outside the projection's invertible area.
 *
 * Written against members that upstream's `_CustomProjectionViewport` shares
 * with the shim, so it works with both.
 */
export function pixelToWorld(
  viewport: Viewport & {
    postUnproject(position: number[]): number[] | null;
  },
  pixel: [number, number],
): number[] | null {
  const common = pixelsToWorld(pixel, viewport.pixelUnprojectionMatrix, 0);
  const mapMeters = viewport.unprojectFlat(common);
  return viewport.postUnproject([mapMeters[0]!, mapMeters[1]!, 0]);
}

function projectWith(
  projection: ProjectionConverter,
  fromBounds: FromBounds | undefined,
  position: number[],
): [number, number, number] {
  const projected = projection.forward(clampToBounds(position, fromBounds));
  return [projected[0]!, projected[1]!, projected[2] ?? position[2] ?? 0];
}

function clampToBounds(
  position: number[],
  bounds: FromBounds | undefined,
): number[] {
  const result = position.slice();
  if (bounds) {
    result[0] = Math.max(bounds[0], Math.min(bounds[2], result[0]!));
    result[1] = Math.max(bounds[1], Math.min(bounds[3], result[1]!));
  }
  return result;
}
