import type { UpdateParameters } from "@deck.gl/core";
import type {
  MinimalTileData,
  GetTileDataOptions as RasterTileGetTileDataOptions,
  RasterTileLayerProps,
  RenderTileResult,
  TilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import { RasterTileLayer } from "@developmentseed/deck.gl-raster";
import type { GeoZarrMetadata } from "@developmentseed/geozarr";
import { parseGeoZarrMetadata } from "@developmentseed/geozarr";
import type {
  EpsgResolver,
  ProjectionDefinition,
  ProjJson,
} from "@developmentseed/proj";
import {
  epsgResolver,
  makeClampedForwardTo3857,
  metersPerUnit,
  parseWkt,
} from "@developmentseed/proj";
import proj4 from "proj4";
import * as zarr from "zarrita";
import { validateSelection, validateSpatialDimOrder } from "./validation.js";
import { geoZarrToDescriptor } from "./zarr-tileset.js";

/**
 * A single dimension selector: a fixed integer index, a `zarr.Slice` range,
 * or `null` to use zarrita's default (full extent).
 */
export type SliceInput = number | zarr.Slice | null;

/**
 * Options bag passed to the user's {@link ZarrLayerProps.getTileData} callback.
 */
export type GetTileDataOptions = RasterTileGetTileDataOptions & {
  /** Tile column index. */
  x: number;
  /** Tile row index. */
  y: number;
  /** Tile zoom level (0 = coarsest). */
  z: number;
  /**
   * Pre-computed slice spec for the tile. Pass directly to `zarr.get(arr,
   * sliceSpec)`. Spatial dims are sliced to the tile bounds; non-spatial dims
   * are filled from the layer's `selection` prop.
   */
  sliceSpec: SliceInput[];
  /**
   * Actual pixel width of this tile. All tiles are the same chunk size except
   * at the right and bottom edges of the array, where the valid region may be
   * narrower (analogous to edge tiles in a Cloud-Optimized GeoTIFF).
   */
  width: number;
  /**
   * Actual pixel height of this tile. All tiles are the same chunk size except
   * at the right and bottom edges of the array, where the valid region may be
   * shorter (analogous to edge tiles in a Cloud-Optimized GeoTIFF).
   */
  height: number;
};

/**
 * Props for the {@link ZarrLayer}.
 */
export type ZarrLayerProps<
  Store extends zarr.Readable = zarr.Readable,
  Dtype extends zarr.DataType = zarr.DataType,
  DataT extends MinimalTileData = MinimalTileData,
> = Omit<
  RasterTileLayerProps<DataT>,
  "tilesetDescriptor" | "getTileData" | "renderTile"
> & {
  /**
   * A pre-opened zarrita {@link zarr.Array} or {@link zarr.Group}. Callers
   * must build and configure the underlying store themselves (for example, a
   * user may want to wrap a {@link zarr.FetchStore} with
   * `withConsolidatedMetadata`, `withRangeCoalescing`.
   *
   * Pass an Array to render it directly as a single-level source; pass a
   * Group to let the layer resolve a `variable` path and use the GeoZarr
   * multiscale layout from its attrs.
   */
  node: zarr.Array<Dtype, Store> | zarr.Group<Store>;

  /**
   * Optional path within the store to the variable group. Only applies
   * when `node` is a {@link zarr.Group}; ignored when an Array is passed
   * directly. If omitted, the group itself is used.
   */
  variable?: string;

  /**
   * Selection for non-spatial dimensions. Must include exactly one entry
   * per non-spatial dim in the array. Use a number to pin to a single index,
   * `null` to use zarr's default slice, or a `zarr.Slice` for a range.
   *
   * For datasets with only spatial dimensions (e.g. a plain [H, W] or
   * [bands, H, W] array whose non-spatial dims are already accounted for),
   * pass an empty object `{}`.
   */
  selection: Record<string, SliceInput>;

  /**
   * Optional raw group attrs to use in place of `group.attrs` when parsing
   * GeoZarr metadata.
   *
   * Use this to hard-code GeoZarr metadata when the Zarr data source does not
   * include it.
   */
  metadata?: unknown;

  /**
   * Fetch and return the tile data for a given tile coordinate.
   *
   * The layer opens the appropriate zarr array for the requested zoom level
   * and passes it along with a pre-built `sliceSpec` (one entry per array
   * dim). Call `zarr.get(arr, sliceSpec)` and convert the result to whatever
   * format your `renderTile` callback expects.
   */
  getTileData: (
    arr: zarr.Array<Dtype, Store>,
    options: GetTileDataOptions,
  ) => Promise<DataT>;

  /**
   * Convert a loaded `DataT` tile into a {@link RenderTileResult} that the
   * layer can pass to `RasterLayer`. Return `{ image }` for a simple
   * `ImageData` / texture, or `{ renderPipeline }` for a GPU shader
   * pipeline.
   */
  renderTile: (data: DataT) => RenderTileResult;

  /**
   * Resolver for authority:code CRS strings (e.g. "EPSG:4326").
   * Defaults to fetching from epsg.io.
   */
  epsgResolver?: EpsgResolver;
};

/**
 * ZarrLayer renders a GeoZarr dataset using a tiled approach with reprojection.
 *
 * The caller is responsible for supplying `getTileData` (which fetches and
 * converts the zarr chunk) and `renderTile` (which converts the result into a
 * {@link RenderTileResult} for the GPU). This keeps the layer agnostic about
 * data format and rendering pipeline.
 */
export class ZarrLayer<
  Store extends zarr.Readable = zarr.Readable,
  Dtype extends zarr.DataType = zarr.DataType,
  DataT extends MinimalTileData = MinimalTileData,
> extends RasterTileLayer<DataT, ZarrLayerProps<Store, Dtype, DataT>> {
  static override layerName = "ZarrLayer";
  // ZarrLayer's getTileData signature differs from the base class's, so
  // `DefaultProps<ZarrLayerProps>` is not assignable to
  // `DefaultProps<RasterTileLayerProps>`. Cast to the base static-side type
  // to keep inheritance happy. The only ZarrLayer-specific default is
  // `epsgResolver`; all behavior still flows from the base class.
  static override defaultProps = {
    ...RasterTileLayer.defaultProps,
    epsgResolver,
  } as typeof RasterTileLayer.defaultProps;

  declare state: {
    meta?: GeoZarrMetadata;
    spatialDims?: [string, string];
    /** One opened array per level, finest-first (matches meta.levels order). */
    arrays?: zarr.Array<zarr.DataType, zarr.Readable>[];
    tilesetDescriptor?: TilesetDescriptor;
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps, changeFlags } = params;

    const needsUpdate =
      Boolean(changeFlags.dataChanged) ||
      props.node !== oldProps.node ||
      props.variable !== oldProps.variable;

    if (needsUpdate) {
      // Clear stale state so renderLayers returns null until the new Zarr is ready
      this._clearState();
      void this._parseZarr();
    }
  }

  /** Reset all async-loaded state. */
  _clearState() {
    this.setState({
      meta: undefined,
      spatialDims: undefined,
      arrays: undefined,
      tilesetDescriptor: undefined,
    });
  }

  /** Open the Zarr store, parse GeoZarr metadata, validate dims, build reprojection fns. */
  async _parseZarr(): Promise<void> {
    const { node, variable, metadata: metadataOverride } = this.props;

    // Callers own the store. We accept a pre-opened Array (rendered as a
    // single-level source) or Group (used directly, with optional `variable`
    // resolution to a child group).
    let preopenedArray: zarr.Array<zarr.DataType, zarr.Readable> | null = null;
    let root:
      | zarr.Group<zarr.Readable>
      | zarr.Array<zarr.DataType, zarr.Readable>;
    if ("shape" in node) {
      // zarr.Array — reuse directly as the (single) level's array.
      preopenedArray = node;
      root = node;
    } else {
      // zarr.Group
      root = node;
    }
    // @ts-expect-error - for debugging
    window.root = root;

    const group = variable
      ? await zarr.open(root.resolve(variable), { kind: "group" })
      : root;
    // @ts-expect-error - for debugging
    window.group = group;

    const rawAttrs = metadataOverride ?? group.attrs;
    const meta = parseGeoZarrMetadata(rawAttrs);
    // @ts-expect-error - for debugging
    window.meta = meta;

    // Open each level's array once and keep the references in state. If the
    // caller passed a pre-opened array and the metadata describes a single
    // level, reuse that array directly.
    const arrays: zarr.Array<zarr.DataType, zarr.Readable>[] =
      preopenedArray && meta.levels.length === 1
        ? [preopenedArray]
        : await Promise.all(
            meta.levels.map((level) =>
              zarr.open(group.resolve(level.path), { kind: "array" }),
            ),
          );

    // Derive spatial dim names from GeoZarr metadata.
    // `meta.axes` lists only the *spatial* dims (from the `spatial:dimensions`
    // convention). The full ordered dim list comes from the zarr array's own
    // `dimension_names`, which includes non-spatial dims (e.g. time, band).
    if (!meta.axes || meta.axes.length === 0) {
      throw new Error(
        "ZarrLayer requires named axes in GeoZarr metadata (spatial:dimensions). " +
          "Arrays without named dims are not supported.",
      );
    }
    const spatialDims: [string, string] = [
      meta.axes[meta.yAxisIndex]!,
      meta.axes[meta.xAxisIndex]!,
    ];

    // Use the first array's dim names as the canonical list. All levels of a
    // multiscale pyramid share the same dim names by spec.
    const arrDimNames: (string | null)[] = arrays[0]?.dimensionNames ?? [];
    const dimensionNames: string[] = arrDimNames.filter(
      (d): d is string => d !== null,
    );
    if (dimensionNames.length !== arrDimNames.length) {
      throw new Error(
        "ZarrLayer requires every zarr array dimension to have a name. " +
          `Got dimension_names = ${JSON.stringify(arrDimNames)}.`,
      );
    }

    validateSpatialDimOrder({ dimensionNames, spatialDims });
    validateSelection({
      dimensionNames,
      spatialDims,
      selection: this.props.selection,
    });

    const sourceProjection = await parseCrs(meta.crs, this.props.epsgResolver!);

    // Build proj4 converters
    // @ts-expect-error - proj4 typings don't cover wkt-parser output
    const converter4326 = proj4(sourceProjection, "EPSG:4326");
    const projectTo4326 = (x: number, y: number) =>
      converter4326.forward<[number, number]>([x, y], false);
    const projectFrom4326 = (x: number, y: number) =>
      converter4326.inverse<[number, number]>([x, y], false);

    // @ts-expect-error - proj4 typings don't cover wkt-parser output
    const converter3857 = proj4(sourceProjection, "EPSG:3857");
    const projectTo3857 = makeClampedForwardTo3857(
      (x: number, y: number) =>
        converter3857.forward<[number, number]>([x, y], false),
      projectTo4326,
    );
    const projectFrom3857 = (x: number, y: number) =>
      converter3857.inverse<[number, number]>([x, y], false);

    // Compute meters-per-CRS-unit from the resolved projection
    const units = sourceProjection.units;
    if (!units) {
      throw new Error(
        "Source projection is missing 'units' property, cannot compute meters per unit",
      );
    }
    const semiMajorAxis: number | undefined =
      sourceProjection.datum?.a ?? sourceProjection.a;
    const mpu = metersPerUnit(units as Parameters<typeof metersPerUnit>[0], {
      semiMajorAxis,
    });

    const chunkSizes = arrays.map((arr) => ({
      width: arr.chunks[arr.chunks.length - 1]!,
      height: arr.chunks[arr.chunks.length - 2]!,
    }));

    const tilesetDescriptor = geoZarrToDescriptor(meta, {
      projectTo4326,
      projectFrom4326,
      projectTo3857,
      projectFrom3857,
      chunkSizes,
      mpu,
    });

    this.setState({
      meta,
      spatialDims,
      arrays,
      tilesetDescriptor,
    });
  }

  protected override _tilesetDescriptor() {
    return this.state.tilesetDescriptor;
  }

  /**
   * Adapts the user-facing `(arr, { x, y, z, sliceSpec, ... }) => Promise<DataT>`
   * signature into RasterTileLayer's `(tile, { signal, device }) => Promise<DataT>`.
   */
  protected override _getTileDataCallback() {
    const { meta, arrays, spatialDims } = this.state;
    if (!meta || !arrays || !spatialDims) {
      return undefined;
    }
    const userFn = this.props.getTileData;
    if (!userFn) {
      return undefined;
    }
    // Capture selection at closure time. The base RasterTileLayer re-invokes
    // this accessor on every render, so new fetches always see the latest
    // selection. Note: deck.gl's inner TileLayer only calls getTileData for
    // uncached tiles — to invalidate cached tiles when selection changes,
    // pass `updateTriggers: { renderTile: [selection] }` on the ZarrLayer.
    const selection = this.props.selection;
    type RasterGetTileData = NonNullable<
      RasterTileLayerProps<DataT>["getTileData"]
    >;
    const wrapped: RasterGetTileData = async (tile, options) => {
      const { x, y, z } = tile.index;
      // descriptor z=0 is coarsest; meta.levels is finest-first
      // so descriptor level z maps to meta.levels[numLevels - 1 - z]
      const zarrLevelIdx = meta.levels.length - 1 - z;
      const level = meta.levels[zarrLevelIdx]!;
      // TODO: the cast is needed because `arrays` is typed as the widest
      // zarr.Array<DataType, Readable> to avoid threading Store/Dtype through
      // the state declaration. Revisit if zarrita exposes a narrower getter.
      const arr = arrays[zarrLevelIdx]! as zarr.Array<Dtype, Store>;

      // Use the zarr array's actual ordered dim names (includes non-spatial
      // dims like time/band), not meta.axes (spatial only).
      const arrDimNames = arr.dimensionNames ?? [];
      const tileWidth = arr.chunks[arr.chunks.length - 1]!;
      const tileHeight = arr.chunks[arr.chunks.length - 2]!;

      const rowStart = y * tileHeight;
      const rowEnd = Math.min((y + 1) * tileHeight, level.arrayHeight);
      const colStart = x * tileWidth;
      const colEnd = Math.min((x + 1) * tileWidth, level.arrayWidth);

      const actualHeight = rowEnd - rowStart;
      const actualWidth = colEnd - colStart;

      // Build slice per array dim: spatial dims get tile-bounded slices,
      // non-spatial dims are filled from the user's `selection` prop.
      const sliceSpec: SliceInput[] = arrDimNames.map((dimName) => {
        if (dimName === spatialDims[0]) {
          return zarr.slice(rowStart, rowEnd);
        }
        if (dimName === spatialDims[1]) {
          return zarr.slice(colStart, colEnd);
        }
        // validateSelection guarantees presence for all non-spatial dims.
        return selection[dimName!]!;
      });

      return userFn(arr, {
        device: options.device,
        x,
        y,
        z,
        sliceSpec,
        width: actualWidth,
        height: actualHeight,
        signal: options.signal,
      });
    };
    return wrapped;
  }

  protected override _renderTileCallback() {
    const userFn = this.props.renderTile;
    if (!userFn) {
      return undefined;
    }
    return userFn as NonNullable<RasterTileLayerProps<DataT>["renderTile"]>;
  }
}

async function parseCrs(
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
