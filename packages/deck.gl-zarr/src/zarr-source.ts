import * as affine from "@developmentseed/affine";
import type {
  GeographicBounds,
  ProjectionFunction,
  RasterTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import { RasterSource } from "@developmentseed/deck.gl-raster";
import type { GeoZarrMetadata } from "@developmentseed/geozarr";
import { parseGeoZarrMetadata } from "@developmentseed/geozarr";
import type {
  EpsgResolver,
  ProjectionDefinition,
  ProjJson,
} from "@developmentseed/proj";
import {
  epsgResolver as defaultEpsgResolver,
  geographicBounds,
  parseWkt,
  projectionFunctions,
} from "@developmentseed/proj";
import * as zarr from "zarrita";
import { validateSpatialDimOrder } from "./validation.js";
import { geoZarrToDescriptor } from "./zarr-tileset.js";

/** Options for {@link ZarrSource.open}. */
export type ZarrSourceOptions = {
  /**
   * Path within the node to the group of the variable to draw. If omitted,
   * the node itself is used.
   */
  variable?: string;

  /**
   * GeoZarr metadata to read instead of the node's own attributes: an
   * attributes object in the GeoZarr conventions (`spatial:*`, `proj:*` and
   * `multiscales`). Pass it when the node has none, such as another group's
   * `attrs`, or a hand-written object for a store without GeoZarr metadata.
   */
  geoZarrMetadata?: unknown;

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

  /** Aborts the open: reads in flight are cancelled, and `open` rejects. */
  signal?: AbortSignal;
};

/**
 * Opened GeoZarr data, ready for a `ZarrLayer` to draw.
 *
 * Create it with {@link ZarrSource.open}, which reads the metadata, opens the
 * array of each level and resolves the CRS once. Several layers can share one
 * source, such as two layers drawing different selections of it.
 */
export class ZarrSource<
  Store extends zarr.Readable = zarr.Readable,
  Dtype extends zarr.DataType = zarr.DataType,
> extends RasterSource {
  /** One opened array per level, finest first. */
  readonly arrays: readonly zarr.Array<Dtype, Store>[];

  /**
   * The names of the arrays' dimensions, in order, such as
   * `["time", "y", "x"]`.
   */
  readonly dimensionNames: readonly string[];

  /** The names of the y and x dimensions: the last two dimensions. */
  readonly spatialDims: [y: string, x: string];

  /** The data's CRS, resolved once. */
  readonly projection: ProjectionDefinition;

  private constructor(options: {
    arrays: readonly zarr.Array<Dtype, Store>[];
    dimensionNames: readonly string[];
    spatialDims: [y: string, x: string];
    projection: ProjectionDefinition;
    tilesetDescriptor: RasterTilesetDescriptor;
    geographicBounds: GeographicBounds;
  }) {
    super(options);
    this.arrays = options.arrays;
    this.dimensionNames = options.dimensionNames;
    this.spatialDims = options.spatialDims;
    this.projection = options.projection;
  }

  /**
   * Open GeoZarr data: read its metadata, open the array of each level,
   * resolve its CRS, and build its tile grid.
   *
   * Rejects when `signal` aborts before the source is ready, when the
   * metadata is missing or invalid, when a level's array can't be opened,
   * when the CRS can't be resolved, and when the arrays' dimensions aren't
   * named or aren't in y, x order at the end.
   *
   * @param node A zarrita group, whose attributes hold the GeoZarr metadata,
   *   or an array to draw as a single level. The caller owns the store, so it
   *   can wrap it, for example with `withConsolidatedMetadata`.
   */
  static async open<
    Store extends zarr.Readable = zarr.Readable,
    Dtype extends zarr.DataType = zarr.DataType,
  >(
    node: zarr.Group<Store> | zarr.Array<Dtype, Store>,
    options: ZarrSourceOptions = {},
  ): Promise<ZarrSource<Store, Dtype>> {
    const {
      variable,
      geoZarrMetadata,
      epsgResolver = defaultEpsgResolver,
      signal,
    } = options;
    signal?.throwIfAborted();

    const group = variable
      ? await zarr.open(node.resolve(variable), { kind: "group", signal })
      : node;
    const metadata = parseGeoZarrMetadata(geoZarrMetadata ?? group.attrs);

    // Open each level's array once. An array passed in is reused when the
    // metadata describes a single level.
    const arrays =
      "shape" in node && metadata.levels.length === 1
        ? [node]
        : // A pyramid's levels share their data type
          ((await Promise.all(
            metadata.levels.map((level) =>
              zarr.open(group.resolve(level.path), { kind: "array", signal }),
            ),
          )) as zarr.Array<Dtype, Store>[]);

    // `metadata.axes` lists only the spatial dims (from the
    // `spatial:dimensions` convention). The full ordered list comes from the
    // arrays' own `dimension_names`, which include dims like time or band.
    if (metadata.axes.length === 0) {
      throw new Error(
        "ZarrSource requires named axes in GeoZarr metadata (spatial:dimensions). " +
          "Arrays without named dims are not supported.",
      );
    }
    const spatialDims: [string, string] = [
      metadata.axes[metadata.yAxisIndex]!,
      metadata.axes[metadata.xAxisIndex]!,
    ];

    // Every level of a multiscale pyramid has the same dim names
    const arrDimNames: (string | null)[] = arrays[0]?.dimensionNames ?? [];
    const dimensionNames = arrDimNames.filter((d): d is string => d !== null);
    if (dimensionNames.length !== arrDimNames.length) {
      throw new Error(
        "ZarrSource requires every zarr array dimension to have a name. " +
          `Got dimension_names = ${JSON.stringify(arrDimNames)}.`,
      );
    }
    validateSpatialDimOrder({ dimensionNames, spatialDims });

    const projection = await resolveCrs(metadata.crs, epsgResolver);

    // The open was aborted while we waited
    signal?.throwIfAborted();

    const functions = projectionFunctions(projection);
    const chunkSizes = arrays.map((arr) => ({
      width: arr.chunks[arr.chunks.length - 1]!,
      height: arr.chunks[arr.chunks.length - 2]!,
    }));
    return new ZarrSource({
      arrays,
      dimensionNames,
      spatialDims,
      projection,
      tilesetDescriptor: geoZarrToDescriptor(metadata, {
        ...functions,
        chunkSizes,
      }),
      geographicBounds: finestLevelBounds(metadata, functions.projectTo4326),
    });
  }
}

/**
 * Resolve GeoZarr metadata's CRS: an EPSG code through `epsgResolver`, and
 * WKT2 or PROJJSON with `parseWkt`.
 */
async function resolveCrs(
  crs: GeoZarrMetadata["crs"],
  epsgResolver: EpsgResolver,
): Promise<ProjectionDefinition> {
  if (crs.code) {
    const [authority, code] = crs.code.split(":");
    if (authority !== "EPSG") {
      throw new Error(
        `Unsupported CRS authority "${authority}". Only "EPSG" is supported.`,
      );
    }
    if (!code) {
      throw new Error(
        `Invalid CRS code "${crs.code}". Expected format "EPSG:XXXX".`,
      );
    }
    return await epsgResolver(Number.parseInt(code, 10));
  } else if (crs.wkt2) {
    return parseWkt(crs.wkt2);
  } else if (crs.projjson) {
    return parseWkt(crs.projjson as unknown as ProjJson);
  } else {
    throw new Error("No CRS information found in GeoZarr metadata");
  }
}

/**
 * The WGS84 bounds of the finest level: its corners, through the same affine
 * as its tile grid's.
 */
function finestLevelBounds(
  metadata: GeoZarrMetadata,
  projectTo4326: ProjectionFunction,
): GeographicBounds {
  const finest = metadata.levels[0]!;
  const transform =
    metadata.registration === "node"
      ? affine.pixelIsPointToArea(finest.affine)
      : finest.affine;
  const { arrayWidth: width, arrayHeight: height } = finest;
  const outline = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([col, row]) => affine.apply(transform, col!, row!));
  const [west, south, east, north] = geographicBounds(outline, projectTo4326);
  return { west, south, east, north };
}
