import type { Viewport } from "@deck.gl/core";
import type {
  Bounds,
  ProjectionFunction,
  RasterTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import type { CRSConverter } from "@math.gl/geospatial/projection/core";

/**
 * Largest distance, in common units, between a map position and its inverse
 * projected forward again, for the inverse to count as valid.
 */
const ROUND_TRIP_TOLERANCE = 1e-5;

/**
 * The members of a custom-projection viewport that {@link ProjectedCOGLayer}
 * relies on.
 *
 * Both this example's interim `CustomProjectionViewport` shim and upstream
 * deck.gl's experimental `_CustomProjectionViewport` (v10.0.0-alpha.1)
 * provide them with the same semantics.
 */
export interface CustomProjectionViewportLike {
  /** Opaque id of the projection; changes when the CRS or resolution change. */
  readonly projectionSignature: string;
  /** The view's CRS. `converter.WGS84` converts WGS84 to map units and back. */
  readonly crs: { readonly converter: { readonly WGS84: CRSConverter } };
  /** Map units -> common space. */
  projectFlat(xyz: number[]): number[];
}

/**
 * Whether `viewport` is a custom-projection viewport (shim or upstream).
 *
 * Duck-typed so it recognizes upstream's class without importing it.
 */
export function isCustomProjectionViewport(
  viewport: Viewport,
): viewport is Viewport & CustomProjectionViewportLike {
  const candidate = viewport as Partial<CustomProjectionViewportLike>;
  return (
    typeof candidate.projectionSignature === "string" &&
    typeof candidate.crs?.converter?.WGS84?.from === "function"
  );
}

/**
 * Projection functions between a raster's source CRS and the view's map CRS.
 *
 * Built once per (descriptor, projection) pair so that the functions are
 * reference-stable: `RasterLayer` regenerates its mesh whenever the identity
 * of a reprojection function changes.
 */
export interface ProjectionContext {
  /** The viewport's `projectionSignature` this context was built for. */
  signature: string;
  /** Source CRS -> map units (clamped to the projection's domain). */
  sourceToMap: ProjectionFunction;
  /** Map units -> source CRS; `[NaN, NaN]` where the inverse is undefined. */
  mapToSource: ProjectionFunction;
  /** Map units -> WGS84 lng/lat, or `null` where the inverse is undefined. */
  mapToLngLat: (x: number, y: number) => [number, number] | null;
  /** Source CRS -> WGS84 lng/lat. */
  sourceToLngLat: ProjectionFunction;
  /** WGS84 lng/lat -> source CRS. */
  lngLatToSource: ProjectionFunction;
  /**
   * Map units -> common space. A fixed linear scale (independent of the
   * camera) in both the shim and upstream.
   */
  mapToCommon: ProjectionFunction;
  /** The projection's domain in lng/lat; see {@link lngLatDomain}. */
  domain: Bounds;
}

/**
 * The lng/lat box that a CRS's `normalize` clamps positions into: its
 * latitude limits (`normalize` caps north polar stereographic at 60°S, for
 * example), with every longitude.
 *
 * Assumes the clamp is a latitude band, which holds for polar, cylindrical
 * and pseudo-cylindrical projections.
 */
export function lngLatDomain(converter: CRSConverter): Bounds {
  const south = converter.normalize([0, -90, 0])[1]!;
  const north = converter.normalize([0, 90, 0])[1]!;
  return [-180, south, 180, north];
}

/**
 * Compose the raster's source CRS <-> WGS84 functions with the view's
 * WGS84 <-> map converter.
 *
 * Going through lng/lat means the layer never needs its own definition of
 * the map CRS, only the view's converter.
 */
export function createProjectionContext(
  viewport: CustomProjectionViewportLike,
  descriptor: RasterTilesetDescriptor,
): ProjectionContext {
  const { projectTo4326, projectFrom4326 } = descriptor;
  const converter = viewport.crs.converter.WGS84;
  const projectFlat = viewport.projectFlat.bind(viewport);

  const sourceToMap: ProjectionFunction = (x, y) => {
    const [lng, lat] = projectTo4326(x, y);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return [Number.NaN, Number.NaN];
    }
    const projected = converter.from(converter.normalize([lng, lat, 0]));
    return [projected[0]!, projected[1]!];
  };

  const mapToLngLat = (x: number, y: number): [number, number] | null => {
    let world: number[];
    let roundTrip: number[];
    try {
      world = converter.to([x, y, 0]);
      roundTrip = converter.from(world);
    } catch {
      // math.gl throws for coordinates outside the projection's domain.
      return null;
    }
    if (!Number.isFinite(world[0]) || !Number.isFinite(world[1])) {
      return null;
    }
    // Some inverses return finite values outside their domain; those don't
    // project back to where they came from.
    const [cx, cy] = projectFlat([x, y]);
    const [rx, ry] = projectFlat([roundTrip[0]!, roundTrip[1]!]);
    if (!(Math.hypot(rx! - cx!, ry! - cy!) <= ROUND_TRIP_TOLERANCE)) {
      return null;
    }
    const bounded = converter.normalize([world[0]!, world[1]!, 0]);
    return [bounded[0]!, bounded[1]!];
  };

  const mapToSource: ProjectionFunction = (x, y) => {
    const world = mapToLngLat(x, y);
    return world ? projectFrom4326(...world) : [Number.NaN, Number.NaN];
  };

  return {
    signature: viewport.projectionSignature,
    sourceToMap,
    mapToSource,
    mapToLngLat,
    sourceToLngLat: projectTo4326,
    lngLatToSource: projectFrom4326,
    mapToCommon: (x, y) => {
      const common = projectFlat([x, y]);
      return [common[0]!, common[1]!];
    },
    domain: lngLatDomain(converter),
  };
}
