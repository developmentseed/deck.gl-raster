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
  projectionFunctions,
} from "@developmentseed/proj";
import type { RangeReader } from "@developmentseed/range-reader";
import { DEFAULT_CONCURRENCY_LIMITER } from "./default-concurrency-limiter.js";
import { DEFAULT_RANGE_READER } from "./default-range-reader.js";
import { fetchGeoTIFF, getGeographicBounds } from "./geotiff/geotiff.js";
import { geoTiffToDescriptor } from "./geotiff-tileset.js";
import { resolveProjection } from "./projection.js";

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

  /**
   * The {@link RangeReader} this COG's header and tile reads go through:
   * reads issued together are merged into few streamed range requests and
   * everything received is cached. Defaults to {@link DEFAULT_RANGE_READER},
   * shared by every COG layer on the page. Ignored when the input is an
   * opened `GeoTIFF` or an `ArrayBuffer`.
   */
  reader?: RangeReader;

  /**
   * Headers, credentials and mode sent with every request for this COG, for
   * data behind authentication. COGs read with different inits never share
   * a request or a cached byte. Ignored for an opened `GeoTIFF` or an
   * `ArrayBuffer`.
   */
  requestInit?: RequestInit;
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
      reader = DEFAULT_RANGE_READER,
      requestInit,
    } = options;
    signal?.throwIfAborted();

    const geotiff = await fetchGeoTIFF(input, {
      concurrencyLimiter,
      getPriority,
      reader,
      requestInit,
      signal,
    });
    const projection = await resolveProjection(geotiff.crs, epsgResolver);

    // The open was aborted while we waited
    signal?.throwIfAborted();

    const functions = projectionFunctions(projection);
    return new COGSource({
      geotiff,
      projection,
      tilesetDescriptor: geoTiffToDescriptor(geotiff, functions),
      geographicBounds: getGeographicBounds(geotiff, functions.projectTo4326),
    });
  }
}
