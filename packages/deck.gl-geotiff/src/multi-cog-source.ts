import type {
  GeographicBounds,
  MultiRasterTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import {
  createMultiRasterTilesetDescriptor,
  RasterSource,
} from "@developmentseed/deck.gl-raster";
import type { GeoTIFF } from "@developmentseed/geotiff";
import type { ProjectionDefinition } from "@developmentseed/proj";
import {
  epsgResolver as defaultEpsgResolver,
  projectionFunctions,
} from "@developmentseed/proj";
import type { COGInput, COGSourceOptions } from "./cog-source.js";
import { DEFAULT_CONCURRENCY_LIMITER } from "./default-concurrency-limiter.js";
import { DEFAULT_RANGE_READER } from "./default-range-reader.js";
import { fetchGeoTIFF, getGeographicBounds } from "./geotiff/geotiff.js";
import { geoTiffToDescriptor } from "./geotiff-tileset.js";
import { resolveProjection } from "./projection.js";

/** The parts of a GeoTIFF that {@link checkSameScene} compares. */
export type SceneFile = Pick<GeoTIFF, "crs" | "bbox" | "transform">;

/**
 * Throw unless every file shares the first file's CRS and extent, as the
 * files of one scene do.
 *
 * - CRSs must be equal: EPSG codes by number, WKT and PROJJSON by value.
 * - Each edge of a file's bounding box must be within one pixel of the coarser
 *   of the two files from the first file's edge, so bands of different
 *   resolutions can end slightly apart.
 *
 * Resolutions may differ.
 */
export function checkSameScene(files: ReadonlyMap<string, SceneFile>): void {
  const [reference, ...rest] = files;
  if (!reference) {
    return;
  }
  const [firstName, first] = reference;
  for (const [name, file] of rest) {
    if (!sameCrs(file.crs, first.crs)) {
      throw new Error(
        `The files of one scene must share a CRS, but "${name}" is in ${describeCrs(file.crs)} and "${firstName}" in ${describeCrs(first.crs)}`,
      );
    }

    const tolerance = Math.max(
      pixelSize(file.transform),
      pixelSize(first.transform),
    );
    const offset = Math.max(
      ...file.bbox.map((edge, i) => Math.abs(edge - first.bbox[i]!)),
    );
    if (offset > tolerance) {
      throw new Error(
        `The files of one scene must cover the same extent, but an edge of "${name}" is ${round(offset)} from the edge of "${firstName}", more than one pixel of the coarser file (${round(tolerance)})`,
      );
    }
  }
}

function sameCrs(a: GeoTIFF["crs"], b: GeoTIFF["crs"]): boolean {
  if (typeof a === "number" || typeof b === "number") {
    return a === b;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function describeCrs(crs: GeoTIFF["crs"]): string {
  if (typeof crs === "number") {
    return `EPSG:${crs}`;
  }
  return typeof crs === "string" ? "WKT" : "PROJJSON";
}

/** The larger side of a pixel, in CRS units, from a file's transform. */
function pixelSize(transform: SceneFile["transform"]): number {
  const [a, b, , d, e] = transform;
  return Math.max(Math.hypot(a, d), Math.hypot(b, e));
}

function round(value: number): number {
  return Number(value.toPrecision(6));
}

/**
 * The files of one scene, opened, such as the band files of one Sentinel-2
 * image, ready for a `MultiCOGLayer` to draw.
 *
 * Create it with {@link MultiCOGSource.open}, which opens every file, checks
 * that they make up one scene, and resolves their CRS once. Several layers can
 * share one source.
 */
export class MultiCOGSource extends RasterSource {
  /**
   * The opened files, by name, in the record's key order, as `Object.keys`
   * lists them.
   */
  readonly geotiffs: ReadonlyMap<string, GeoTIFF>;

  /** The CRS of every file, resolved once. */
  readonly projection: ProjectionDefinition;

  /**
   * Every file's tile grid, with the finest file's grid as the primary, which
   * is also {@link RasterSource.tilesetDescriptor}.
   */
  readonly multiTilesetDescriptor: MultiRasterTilesetDescriptor;

  private constructor(options: {
    geotiffs: ReadonlyMap<string, GeoTIFF>;
    projection: ProjectionDefinition;
    multiTilesetDescriptor: MultiRasterTilesetDescriptor;
    geographicBounds: GeographicBounds;
  }) {
    super({
      tilesetDescriptor: options.multiTilesetDescriptor.primary,
      geographicBounds: options.geographicBounds,
    });
    this.geotiffs = options.geotiffs;
    this.projection = options.projection;
    this.multiTilesetDescriptor = options.multiTilesetDescriptor;
  }

  /**
   * Open the files of one scene, by name: read every header, check that the
   * files share a CRS and an extent, resolve the CRS, and group the files' tile
   * grids.
   *
   * Takes the same options as {@link COGSource.open}, which apply to every
   * file. Rejects with an error naming the file that failed to open, or the
   * files that don't make up one scene. Rejects with an `AbortError` when
   * `signal` aborts before the source is ready.
   */
  static async open(
    inputs: Record<string, COGInput>,
    options: COGSourceOptions = {},
  ): Promise<MultiCOGSource> {
    const {
      signal,
      epsgResolver = defaultEpsgResolver,
      concurrencyLimiter = DEFAULT_CONCURRENCY_LIMITER,
      getPriority,
      reader = DEFAULT_RANGE_READER,
      requestInit,
    } = options;
    signal?.throwIfAborted();

    const entries = Object.entries(inputs);
    if (entries.length === 0) {
      throw new Error("MultiCOGSource.open needs at least one COG");
    }

    const opened = await Promise.all(
      entries.map(async ([name, input]) => {
        try {
          const geotiff = await fetchGeoTIFF(input, {
            concurrencyLimiter,
            getPriority,
            reader,
            requestInit,
            signal,
          });
          return [name, geotiff] as const;
        } catch (error) {
          // An abort isn't a failure to open
          if (signal?.aborted) {
            throw error;
          }
          throw new Error(
            `Failed to open "${name}"${describeInput(input)}: ${(error as Error).message}`,
            { cause: error },
          );
        }
      }),
    );
    const geotiffs = new Map(opened);
    checkSameScene(geotiffs);

    const projection = await resolveProjection(opened[0]![1].crs, epsgResolver);

    // The open was aborted while we waited
    signal?.throwIfAborted();

    const functions = projectionFunctions(projection);
    const multiTilesetDescriptor = createMultiRasterTilesetDescriptor(
      new Map(
        opened.map(([name, geotiff]) => [
          name,
          geoTiffToDescriptor(geotiff, functions),
        ]),
      ),
    );
    const primary = geotiffs.get(multiTilesetDescriptor.primaryKey)!;

    return new MultiCOGSource({
      geotiffs,
      projection,
      multiTilesetDescriptor,
      geographicBounds: getGeographicBounds(primary, functions.projectTo4326),
    });
  }
}

/** ` (<url>)` for a URL input, or nothing. */
function describeInput(input: COGInput): string {
  if (typeof input === "string") {
    return ` (${input})`;
  }
  return input instanceof URL ? ` (${input.href})` : "";
}
