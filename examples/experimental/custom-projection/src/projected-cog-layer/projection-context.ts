import type { Viewport } from "@deck.gl/core";
import type {
  Bounds,
  ProjectionFunction,
  RasterTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";

/**
 * The members of a custom-projection viewport that {@link ProjectedCOGLayer}
 * relies on.
 *
 * Both this example's interim `CustomProjectionViewport` shim and upstream
 * deck.gl's experimental `_CustomProjectionViewport` (visgl/deck.gl#10741)
 * provide the required members with the same semantics. Upstream doesn't
 * expose `fromBounds`, so with upstream's view pass the domain to the layer's
 * `fromBounds` prop.
 */
export interface CustomProjectionViewportLike {
  /** Opaque id of the projection; changes when `fromCrs`/`toCrs` change. */
  readonly projectionSignature: string;
  /** World coordinates (`fromCrs`, here WGS84 lng/lat) → map meters. */
  preproject(position: number[]): number[];
  /** Map meters → world coordinates, or `null` outside the inverse's domain. */
  postUnproject(position: number[]): number[] | null;
  /** Map meters → common space. */
  projectFlat(xyz: number[]): number[];
  /**
   * The projection's valid domain in lng/lat. Only the shim exposes it; the
   * layer's `fromBounds` prop takes precedence.
   */
  readonly fromBounds?: Bounds;
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
    typeof candidate.preproject === "function" &&
    typeof candidate.postUnproject === "function"
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
  /** Source CRS → map meters (clamped to the projection's domain). */
  sourceToMap: ProjectionFunction;
  /** Map meters → source CRS; `[NaN, NaN]` where the inverse is undefined. */
  mapToSource: ProjectionFunction;
  /** Map meters → WGS84 lng/lat, or `null` where the inverse is undefined. */
  mapToLngLat: (x: number, y: number) => [number, number] | null;
  /** Source CRS → WGS84 lng/lat. */
  sourceToLngLat: ProjectionFunction;
  /** WGS84 lng/lat → source CRS. */
  lngLatToSource: ProjectionFunction;
  /**
   * Map meters → common space. A fixed linear scale (independent of the
   * camera) in both the shim and upstream.
   */
  mapToCommon: ProjectionFunction;
  /**
   * The projection's domain in lng/lat. Without it, tiles are only kept off
   * the poles: none are culled or trimmed for lying outside the domain.
   */
  fromBounds: Bounds | undefined;
}

/**
 * Compose the raster's source CRS ↔ WGS84 functions with the view's
 * WGS84 ↔ map converter.
 *
 * Going through lng/lat means the layer never needs a proj4 definition of the
 * map CRS — only the view's converter, exactly what upstream's viewport
 * offers. This assumes the view's `fromCrs` is WGS84 lng/lat (the default).
 *
 * @param fromBounds The projection's domain in lng/lat (see
 *   {@link ProjectionContext.fromBounds}).
 */
export function createProjectionContext(
  viewport: CustomProjectionViewportLike,
  descriptor: RasterTilesetDescriptor,
  fromBounds: Bounds | undefined,
): ProjectionContext {
  const { projectTo4326, projectFrom4326 } = descriptor;
  const preproject = viewport.preproject.bind(viewport);
  const postUnproject = viewport.postUnproject.bind(viewport);
  const projectFlat = viewport.projectFlat.bind(viewport);

  const sourceToMap: ProjectionFunction = (x, y) => {
    const [lng, lat] = projectTo4326(x, y);
    const projected = preproject([lng, lat, 0]);
    return [projected[0]!, projected[1]!];
  };

  const mapToLngLat = (x: number, y: number): [number, number] | null => {
    const world = postUnproject([x, y, 0]);
    return world ? [world[0]!, world[1]!] : null;
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
    fromBounds,
  };
}
