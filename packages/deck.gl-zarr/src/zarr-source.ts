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
import { findSpatialDimIndices } from "./validation.js";
import { geoZarrToDescriptor } from "./zarr-tileset.js";

/**
 * Where {@link ZarrSource.open} finds GeoZarr data: a zarrita store, or an
 * opened group or array within one.
 */
export type ZarrInput =
  | zarr.Readable
  | zarr.Group<zarr.Readable>
  | zarr.Array<zarr.DataType>;

/** Options for {@link ZarrSource.open}. */
export type ZarrSourceOptions = {
  /**
   * Path from the input to the array or multiscales group to draw: relative,
   * and separated by `/`, such as `"temperature"` or
   * `"measurements/reflectance"`. If omitted, the input itself is drawn: the
   * store's root, or the group or array passed in.
   */
  path?: string;

  /**
   * GeoZarr metadata to read instead of the data's own attributes: an
   * attributes object in the GeoZarr conventions (`spatial:*`, `proj:*` and
   * `multiscales`). Pass it when the data has none, such as another group's
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
  Dtype extends zarr.DataType = zarr.DataType,
> extends RasterSource {
  /**
   * The zarrita group or array drawn, at `path` from the input: the
   * multiscales group of a pyramid, or the array of a single level. Its store
   * holds other arrays, such as coordinates:
   *
   * ```ts
   * zarr.open(zarr.root(source.node.store).resolve("band"), { kind: "array" });
   * ```
   */
  readonly node: zarr.Group<zarr.Readable> | zarr.Array<Dtype>;

  /** One opened array per level, finest first. */
  readonly arrays: readonly zarr.Array<Dtype>[];

  /**
   * The names of the arrays' dimensions, in order, such as
   * `["time", "y", "x"]`.
   */
  readonly dimensionNames: readonly string[];

  /**
   * The names of the y and x dimensions, from `spatial:dimensions`. In
   * {@link ZarrSource.dimensionNames}, y comes before x, and other dimensions
   * may sit anywhere, such as `["band", "y", "x"]` or `["y", "x", "band"]`.
   */
  readonly spatialDims: [y: string, x: string];

  /** The data's CRS, resolved once. */
  readonly projection: ProjectionDefinition;

  private constructor(options: {
    node: zarr.Group<zarr.Readable> | zarr.Array<Dtype>;
    arrays: readonly zarr.Array<Dtype>[];
    dimensionNames: readonly string[];
    spatialDims: [y: string, x: string];
    projection: ProjectionDefinition;
    tilesetDescriptor: RasterTilesetDescriptor;
    geographicBounds: GeographicBounds;
  }) {
    super(options);
    this.node = options.node;
    this.arrays = options.arrays;
    this.dimensionNames = options.dimensionNames;
    this.spatialDims = options.spatialDims;
    this.projection = options.projection;
  }

  /**
   * Whether the arrays' data type is `dtype`, narrowing the source to it, as
   * zarrita's `Array.is` does for an array.
   */
  is<D extends zarr.DataType>(dtype: D): this is ZarrSource<D> {
    return this.arrays[0]!.is(dtype);
  }

  /**
   * Open GeoZarr data: read its metadata, open the array of each level,
   * resolve its CRS, and build its tile grid.
   *
   * An array inherits the `proj:` and `spatial:` attributes of the group it's
   * directly in: its own CRS replaces the group's, and each of its own
   * `spatial:` attributes replaces the group's. See the [proj] and [spatial]
   * conventions.
   *
   * Rejects when `signal` aborts before the source is ready, when the
   * metadata is missing or invalid, when a level's array can't be opened,
   * when the levels' data types differ, when the CRS can't be resolved, and
   * when the arrays' dimensions aren't named, differ between levels, don't
   * include the y and x dimensions, or have x before y.
   *
   * [proj]: https://github.com/zarr-conventions/proj/blob/v0.1/README.md#inheritance-model
   * [spatial]: https://github.com/zarr-conventions/spatial/blob/v0.1/README.md#can-i-use-spatial-at-the-group-level
   *
   * @param input A zarrita store, or an opened group or array within one.
   *   Pass a store, unless the app has opened the node already, for example
   *   to read coordinate or label arrays or to browse the hierarchy, or needs
   *   to control how it was opened: `open` tries Zarr v3, then v2. The caller
   *   owns the store, so it can wrap it, for example with
   *   `withConsolidatedMetadata`.
   */
  static async open(
    input: ZarrInput,
    options: ZarrSourceOptions = {},
  ): Promise<ZarrSource> {
    const {
      path,
      geoZarrMetadata,
      epsgResolver = defaultEpsgResolver,
      signal,
    } = options;
    signal?.throwIfAborted();

    const target = await openTarget(input, { path, signal });
    const metadata = parseGeoZarrMetadata(
      geoZarrMetadata ??
        (target.kind === "array"
          ? await inheritGeoZarrAttrs({ array: target, input, signal })
          : target.attrs),
    );

    // Metadata without `multiscales` describes one array, at path "."
    if (target.kind === "group" && metadata.levels[0]?.path === ".") {
      throw new Error(
        "GeoZarr metadata without multiscales describes an array, not the " +
          `group "${target.path}". Name the array with \`path\`.`,
      );
    }

    // Open each level's array once. The array to draw is reused when the
    // metadata describes a single level.
    const arrays =
      target.kind === "array" && metadata.levels.length === 1
        ? [target]
        : // `kind: "array"` opens only arrays
          ((await Promise.all(
            metadata.levels.map((level) =>
              openNode(target.resolve(level.path), { kind: "array", signal }),
            ),
          )) as zarr.Array<zarr.DataType>[]);

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

    checkSameDimensionNames(arrays);
    checkSameDataType(arrays);

    // Every level of a multiscale pyramid has the same dim names
    const arrDimNames: (string | null)[] = arrays[0]?.dimensionNames ?? [];
    const dimensionNames = arrDimNames.filter((d): d is string => d !== null);
    if (dimensionNames.length !== arrDimNames.length) {
      throw new Error(
        "ZarrSource requires every zarr array dimension to have a name. " +
          `Got dimension_names = ${JSON.stringify(arrDimNames)}.`,
      );
    }
    const [yIndex, xIndex] = findSpatialDimIndices({
      dimensionNames,
      spatialDims,
    });

    const projection = await resolveCrs(metadata.crs, epsgResolver);

    // The open was aborted while we waited
    signal?.throwIfAborted();

    const functions = projectionFunctions(projection);
    const chunkSizes = arrays.map((arr) => ({
      width: arr.chunks[xIndex]!,
      height: arr.chunks[yIndex]!,
    }));
    return new ZarrSource({
      node: target,
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
 * Whether `input` is an opened zarrita group or array, rather than a store: it
 * has a `store`, as zarrita's own `open` checks, and a `kind`.
 */
function isNode(
  input: ZarrInput,
): input is zarr.Group<zarr.Readable> | zarr.Array<zarr.DataType> {
  return "store" in input && "kind" in input;
}

/** The group or array to draw: `input` itself, or the node at `path` in it. */
async function openTarget(
  input: ZarrInput,
  options: { path?: string; signal?: AbortSignal },
): Promise<zarr.Group<zarr.Readable> | zarr.Array<zarr.DataType>> {
  const { path, signal } = options;
  if (isNode(input)) {
    return path ? openNode(input.resolve(path), { signal }) : input;
  }
  const root = zarr.root(input);
  return openNode(path ? root.resolve(path) : root, { signal });
}

/**
 * Open the group or array at `location`: as Zarr v3, or as v2 when it has no v3
 * metadata. Unlike zarrita's `open`, it never tries v2 first. See #838.
 */
async function openNode(
  location: zarr.Location<zarr.Readable>,
  options: { kind?: "group" | "array"; signal?: AbortSignal },
): Promise<zarr.Group<zarr.Readable> | zarr.Array<zarr.DataType>> {
  try {
    return await zarr.open.v3(location, options);
  } catch (error) {
    // zarrita sets `found` when the node is v3, but not of `kind`
    if (!zarr.isZarritaError(error, "NotFoundError") || error.found) {
      throw error;
    }
  }
  return zarr.open.v2(location, options);
}

/**
 * The attributes of `array`, with the `proj:` and `spatial:` attributes it
 * inherits from the group it's directly in, as described for
 * {@link ZarrSource.open}.
 */
async function inheritGeoZarrAttrs(options: {
  array: zarr.Array<zarr.DataType>;
  input: ZarrInput;
  signal?: AbortSignal;
}): Promise<zarr.Attributes> {
  const { array } = options;
  const groupAttrs = await readGroupAttrs(options);
  if (!groupAttrs) {
    return array.attrs;
  }
  const hasCrs = Object.keys(array.attrs).some((key) =>
    key.startsWith("proj:"),
  );
  const inherited = Object.entries(groupAttrs).filter(
    ([key]) =>
      key.startsWith("spatial:") || (!hasCrs && key.startsWith("proj:")),
  );
  return { ...Object.fromEntries(inherited), ...array.attrs };
}

/**
 * The attributes of the group that `array` is directly in: `input`'s when
 * `input` is that group. `undefined` for an array at the root of its store, or
 * in a group that can't be found.
 */
async function readGroupAttrs(options: {
  array: zarr.Array<zarr.DataType>;
  input: ZarrInput;
  signal?: AbortSignal;
}): Promise<zarr.Attributes | undefined> {
  const { array, input, signal } = options;
  if (array.path === "/") {
    return undefined;
  }
  // `resolve` ends both paths with "/"
  const location = array.resolve("..");
  if (isNode(input) && input.resolve(".").path === location.path) {
    return input.attrs;
  }
  try {
    return (await openNode(location, { kind: "group", signal })).attrs;
  } catch (error) {
    if (zarr.isZarritaError(error, "NotFoundError")) {
      return undefined;
    }
    throw error;
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

/**
 * Throw unless every level's array has the first level's data type, which
 * {@link ZarrSource.is} checks for all of them.
 */
function checkSameDataType(arrays: readonly zarr.Array<zarr.DataType>[]): void {
  const [first, ...rest] = arrays;
  for (const arr of rest) {
    if (arr.dtype !== first!.dtype) {
      throw new Error(
        "ZarrSource requires every level to have the same data_type: " +
          `${arr.path} has ${arr.dtype}, but ${first!.path} has ${first!.dtype}.`,
      );
    }
  }
}

/**
 * Throw unless every level's array has the first level's `dimension_names`,
 * which {@link ZarrSource.dimensionNames} holds for all of them.
 */
function checkSameDimensionNames(
  arrays: readonly zarr.Array<zarr.DataType, zarr.Readable>[],
): void {
  const [first, ...rest] = arrays;
  const names = JSON.stringify(first?.dimensionNames ?? []);
  for (const arr of rest) {
    const other = JSON.stringify(arr.dimensionNames ?? []);
    if (other !== names) {
      throw new Error(
        "ZarrSource requires every level to have the same dimension_names: " +
          `${arr.path} has ${other}, but ${first!.path} has ${names}.`,
      );
    }
  }
}
