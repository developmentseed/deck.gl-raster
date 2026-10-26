import type {
  GeographicBounds,
  RasterTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import { RasterSource } from "@developmentseed/deck.gl-raster";
import type {
  ConcurrencyLimiter,
  GeoTIFF,
  Priority,
} from "@developmentseed/geotiff";
import type { EpsgResolver, ProjectionDefinition } from "@developmentseed/proj";
import {
  epsgResolver as defaultEpsgResolver,
  makeClampedForwardTo3857,
  metersPerUnit,
  parseWkt,
} from "@developmentseed/proj";
import proj4 from "proj4";
import { DEFAULT_CONCURRENCY_LIMITER } from "./default-concurrency-limiter.js";
import { fetchGeoTIFF, getGeographicBounds } from "./geotiff/geotiff.js";
import { geoTiffToDescriptor } from "./geotiff-tileset.js";

/**
 * A Cloud-Optimized GeoTIFF to open:
 *
 * - a {@link URL} or `string` pointing to a COG
 * - an {@link ArrayBuffer} containing the COG data
 * - an opened {@link GeoTIFF}
 */
export type COGInput = GeoTIFF | string | URL | ArrayBuffer;

/** Options for {@link COGSource.open}. */
export type COGSourceOptions = {
  /** Aborts the open: header reads in flight are cancelled, and `open` rejects. */
  signal?: AbortSignal;

  /**
   * A function for resolving numeric EPSG codes to projection information (as
   * returned by `wkt-parser`).
   *
   * The default implementation:
   * - resolves codes that proj4 ships definitions for without a request
   * - makes a request to epsg.io to resolve other EPSG codes
   * - caches any previous requests
   * - parses PROJJSON response with `wkt-parser`
   */
  epsgResolver?: EpsgResolver;

  /**
   * Caps concurrent HTTP requests for this COG's header and tile fetches.
   *
   * Defaults to a maximum of 6 concurrent requests per origin, which aligns
   * with browser limits of 6 HTTP/1.1 requests per origin. If your sources
   * support HTTP/2 or HTTP/3, you may want to increase this limit or disable
   * it entirely by passing `null`.
   *
   * Ignored when the input is an opened `GeoTIFF` or an `ArrayBuffer`. For an
   * opened `GeoTIFF`, pass the limiter to {@link GeoTIFF.fromUrl} instead.
   */
  concurrencyLimiter?: ConcurrencyLimiter | null;

  /**
   * Priority of this COG's queued requests. Lower values are fetched sooner.
   * Only used with a `concurrencyLimiter`.
   */
  getPriority?: () => Priority;
};

/**
 * One opened Cloud-Optimized GeoTIFF, ready for a `COGLayer` to draw.
 *
 * Create it with {@link COGSource.open}, which reads the file's header and
 * resolves its CRS once. Several layers can share one source.
 */
export class COGSource extends RasterSource {
  /** The opened file. */
  readonly geotiff: GeoTIFF;

  /** The file's CRS, resolved once. */
  readonly projection: ProjectionDefinition;

  private constructor(options: {
    geotiff: GeoTIFF;
    projection: ProjectionDefinition;
    tilesetDescriptor: RasterTilesetDescriptor;
    geographicBounds: GeographicBounds;
  }) {
    super(options);
    this.geotiff = options.geotiff;
    this.projection = options.projection;
  }

  /**
   * Open a COG: read its header, resolve its CRS, and build its tile grid.
   *
   * Rejects with an `AbortError` when `signal` aborts before the source is
   * ready.
   */
  static async open(
    input: COGInput,
    options: COGSourceOptions = {},
  ): Promise<COGSource> {
    const {
      signal,
      epsgResolver = defaultEpsgResolver,
      concurrencyLimiter = DEFAULT_CONCURRENCY_LIMITER,
      getPriority,
    } = options;
    signal?.throwIfAborted();

    const geotiff = await fetchGeoTIFF(input, {
      concurrencyLimiter,
      getPriority,
      signal,
    });
    const crs = geotiff.crs;
    const projection =
      typeof crs === "number" ? await epsgResolver(crs) : parseWkt(crs);

    // The open was aborted while we waited
    signal?.throwIfAborted();

    // @ts-expect-error - proj4 typings are incomplete and don't support
    // wkt-parser input
    const converter4326 = proj4(projection, "EPSG:4326");
    const projectTo4326 = (x: number, y: number) =>
      converter4326.forward<[number, number]>([x, y], false);
    const projectFrom4326 = (x: number, y: number) =>
      converter4326.inverse<[number, number]>([x, y], false);

    // @ts-expect-error - proj4 typings are incomplete and don't support
    // wkt-parser input
    const converter3857 = proj4(projection, "EPSG:3857");
    const projectTo3857 = makeClampedForwardTo3857(
      (x: number, y: number) =>
        converter3857.forward<[number, number]>([x, y], false),
      projectTo4326,
    );
    const projectFrom3857 = (x: number, y: number) =>
      converter3857.inverse<[number, number]>([x, y], false);

    const units = projection.units;
    if (!units) {
      throw new Error(
        "Source projection is missing 'units' property, cannot compute meters per unit",
      );
    }
    const mpu = metersPerUnit(units as Parameters<typeof metersPerUnit>[0], {
      semiMajorAxis: projection.datum?.a ?? projection.a,
    });

    const tilesetDescriptor = geoTiffToDescriptor(geotiff, {
      projectTo4326,
      projectFrom4326,
      projectTo3857,
      projectFrom3857,
      mpu,
    });

    return new COGSource({
      geotiff,
      projection,
      tilesetDescriptor,
      geographicBounds: getGeographicBounds(geotiff, converter4326),
    });
  }
}
