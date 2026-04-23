import type {
  CompositeLayerProps,
  Layer,
  LayerProps,
  LayersList,
  UpdateParameters,
} from "@deck.gl/core";
import { COORDINATE_SYSTEM, CompositeLayer } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import * as affine from "@developmentseed/affine";
import type {
  RenderTileResult,
  TileMetadata,
} from "@developmentseed/deck.gl-raster";
import {
  RasterLayer,
  RasterTileset2D,
  _renderDebugTileOutline as renderDebugTileOutline,
} from "@developmentseed/deck.gl-raster";
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
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { Device } from "@luma.gl/core";
import proj4 from "proj4";
import * as zarr from "zarrita";
import { validateSelection, validateSpatialDimOrder } from "./validation.js";
import { geoZarrToDescriptor } from "./zarr-tileset.js";

/** Size of deck.gl's common coordinate space in world units. */
const TILE_SIZE = 512;

/** Size of the globe in web mercator meters. */
const WEB_MERCATOR_METER_CIRCUMFERENCE = 40075016.686;

/** Scale factor for converting EPSG:3857 meters into deck.gl world units. */
const WEB_MERCATOR_TO_WORLD_SCALE =
  TILE_SIZE / WEB_MERCATOR_METER_CIRCUMFERENCE;

/**
 * A single dimension selector: a fixed integer index, a `zarr.Slice` range,
 * or `null` to use zarrita's default (full extent).
 */
type SliceInput = number | zarr.Slice | null;

/**
 * Minimum interface that a `DataT` returned from `getTileData` must satisfy.
 */
export type MinimalZarrTileData = {
  /** Pixel width of the fetched tile. */
  width: number;
  /** Pixel height of the fetched tile. */
  height: number;
  /**
   * Optional byte count used by deck.gl's `maxCacheByteSize` eviction.
   * Omitting it disables byte-based eviction for this tile.
   */
  byteLength?: number;
};

/**
 * Options bag passed to the user's {@link ZarrLayerProps.getTileData} callback.
 */
export type GetTileDataOptions = {
  /** The luma.gl device, for GPU-side operations. */
  device: Device;
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
  /** AbortSignal forwarded from the TileLayer's tile lifecycle. */
  signal?: AbortSignal;
};

/**
 * Props for the {@link ZarrLayer}.
 */
export type ZarrLayerProps<
  Store extends zarr.Readable = zarr.Readable,
  Dtype extends zarr.DataType = zarr.DataType,
  DataT extends MinimalZarrTileData = MinimalZarrTileData,
> = CompositeLayerProps &
  Pick<
    TileLayerProps,
    | "debounceTime"
    | "maxCacheSize"
    | "maxCacheByteSize"
    | "maxRequests"
    | "refinementStrategy"
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
    source: zarr.Array<Dtype, Store> | zarr.Group<Store>;

    /**
     * Optional path within the store to the variable group. Only applies
     * when `source` is a {@link zarr.Group}; ignored when an Array is passed
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
     * GeoZarr metadata. Useful when you have already fetched the metadata
     * out-of-band (e.g. from a STAC item).
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

    /** Maximum reprojection error in pixels for mesh refinement. @default 0.125 */
    maxError?: number;

    /** Enable debug tile outline visualization. @default false */
    debug?: boolean;

    /** Opacity of the debug mesh overlay (0-1). @default 0.5 */
    debugOpacity?: number;
  };

const defaultProps: Partial<ZarrLayerProps> = {
  ...TileLayer.defaultProps,
  epsgResolver,
  debug: false,
  debugOpacity: 0.5,
};

type TileData<DataT extends MinimalZarrTileData = MinimalZarrTileData> =
  DataT & {
    forwardTransform: ReprojectionFns["forwardTransform"];
    inverseTransform: ReprojectionFns["inverseTransform"];
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
  DataT extends MinimalZarrTileData = MinimalZarrTileData,
> extends CompositeLayer<ZarrLayerProps<Store, Dtype, DataT>> {
  static override layerName = "ZarrLayer";
  static override defaultProps = defaultProps;

  declare state: {
    meta?: GeoZarrMetadata;
    spatialDims?: [string, string];

    /** One opened array per level, finest-first (matches meta.levels order). */
    arrays?: zarr.Array<zarr.DataType, zarr.Readable>[];
    forwardTo4326?: ReprojectionFns["forwardReproject"];
    inverseFrom4326?: ReprojectionFns["inverseReproject"];
    forwardTo3857?: ReprojectionFns["forwardReproject"];
    inverseFrom3857?: ReprojectionFns["inverseReproject"];
    mpu?: number;
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps, changeFlags } = params;

    const needsUpdate =
      Boolean(changeFlags.dataChanged) ||
      props.source !== oldProps.source ||
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
      forwardTo4326: undefined,
      inverseFrom4326: undefined,
      forwardTo3857: undefined,
      inverseFrom3857: undefined,
      mpu: undefined,
    });
  }

  /** Open the Zarr store, parse GeoZarr metadata, validate dims, build reprojection fns. */
  async _parseZarr(): Promise<void> {
    const { source, variable, metadata: metadataOverride } = this.props;

    // Callers own the store. We accept a pre-opened Array (rendered as a
    // single-level source) or Group (used directly, with optional `variable`
    // resolution to a child group).
    let preopenedArray: zarr.Array<zarr.DataType, zarr.Readable> | null = null;
    let root:
      | zarr.Group<zarr.Readable>
      | zarr.Array<zarr.DataType, zarr.Readable>;
    if ("shape" in source) {
      // zarr.Array — reuse directly as the (single) level's array.
      preopenedArray = source;
      root = source;
    } else {
      // zarr.Group
      root = source;
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
    const forwardTo4326 = (x: number, y: number) =>
      converter4326.forward<[number, number]>([x, y], false);
    const inverseFrom4326 = (x: number, y: number) =>
      converter4326.inverse<[number, number]>([x, y], false);

    // @ts-expect-error - proj4 typings don't cover wkt-parser output
    const converter3857 = proj4(sourceProjection, "EPSG:3857");
    const forwardTo3857 = makeClampedForwardTo3857(
      (x: number, y: number) =>
        converter3857.forward<[number, number]>([x, y], false),
      forwardTo4326,
    );
    const inverseFrom3857 = (x: number, y: number) =>
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

    this.setState({
      meta,
      spatialDims,
      arrays,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
      mpu,
    });
  }

  /**
   * Fetch data for a single tile. Builds the slice spec from tile bounds and
   * the layer's `selection` prop, then delegates to the user's `getTileData`.
   */
  async _getTileData(
    tile: TileLoadProps,
    meta: GeoZarrMetadata,
    arrays: zarr.Array<zarr.DataType, zarr.Readable>[],
    spatialDims: [string, string],
  ): Promise<TileData<DataT>> {
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
      return this.props.selection[dimName!]!;
    });

    // Compute per-tile affine: compose level affine with pixel offset of this tile
    const tileOffset = affine.translation(colStart, rowStart);
    const tileAffine = affine.compose(level.affine, tileOffset);
    const invTileAffine = affine.invert(tileAffine);

    const forwardTransform = (px: number, py: number) =>
      affine.apply(tileAffine, px, py);
    const inverseTransform = (cx: number, cy: number) =>
      affine.apply(invTileAffine, cx, cy);

    const userData = await this.props.getTileData(arr, {
      device: this.context.device,
      x,
      y,
      z,
      sliceSpec,
      width: actualWidth,
      height: actualHeight,
      signal: tile.signal,
    });

    return {
      ...userData,
      forwardTransform,
      inverseTransform,
    };
  }

  /**
   * Render a single tile. Calls the user's `renderTile` and plugs the result
   * into a `RasterLayer` with the appropriate reprojection functions.
   * Preserves both globe (EPSG:4326) and mercator projection paths.
   */
  _renderSubLayers(
    props: TileLayerProps<TileData<DataT>> & {
      id: string;
      data?: TileData<DataT>;
      _offset: number;
      tile: Tile2DHeader<TileData<DataT>>;
    },
    forwardTo4326: ReprojectionFns["forwardReproject"],
    inverseFrom4326: ReprojectionFns["inverseReproject"],
    forwardTo3857: ReprojectionFns["forwardReproject"],
    inverseFrom3857: ReprojectionFns["inverseReproject"],
  ): Layer | LayersList | null {
    const { maxError, debug, debugOpacity } = this.props;

    // Cast to include TileMetadata from raster-tileset's `getTileMetadata` method.
    const tile = props.tile as Tile2DHeader & TileMetadata;

    const layers: Layer[] = [];
    if (debug) {
      layers.push(
        ...renderDebugTileOutline(
          `${this.id}-${tile.id}-bounds`,
          tile,
          forwardTo4326,
        ),
      );
    }

    if (!props.data) {
      return layers;
    }

    const { forwardTransform, inverseTransform, width, height } = props.data;

    const isGlobe = this.context.viewport.resolution !== undefined;
    let reprojectionFns: ReprojectionFns;
    let deckProjectionProps: Partial<LayerProps>;

    if (isGlobe) {
      reprojectionFns = {
        forwardTransform,
        inverseTransform,
        forwardReproject: forwardTo4326,
        inverseReproject: inverseFrom4326,
      };
      deckProjectionProps = {};
    } else {
      reprojectionFns = {
        forwardTransform,
        inverseTransform,
        forwardReproject: forwardTo3857,
        inverseReproject: inverseFrom3857,
      };
      deckProjectionProps = {
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        coordinateOrigin: [TILE_SIZE / 2, TILE_SIZE / 2, 0],
        // biome-ignore format: array
        modelMatrix: [
          WEB_MERCATOR_TO_WORLD_SCALE, 0, 0, 0,
          0, WEB_MERCATOR_TO_WORLD_SCALE, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1
        ],
      };
    }

    const { image, renderPipeline }: RenderTileResult = this.props.renderTile(
      props.data as DataT,
    );
    // Only forward `image` when the user actually supplied one. RasterLayer
    // treats `image` as an async "type: image" prop and chokes on an
    // explicit `undefined` (it calls createTexture on whatever was passed).
    // Its documented default is `null`.
    const rasterLayer = new RasterLayer(
      this.getSubLayerProps({
        id: `${props.id}-raster`,
        image: image ?? null,
        renderPipeline: renderPipeline ?? [],
        width,
        height,
        maxError,
        reprojectionFns,
        debug,
        debugOpacity,
        ...deckProjectionProps,
      }),
    );
    return [rasterLayer, ...layers];
  }

  /**
   * Construct the inner `TileLayer` with the appropriate `RasterTileset2D`
   * tiling scheme derived from the GeoZarr metadata.
   */
  renderTileLayer(
    meta: GeoZarrMetadata,
    arrays: zarr.Array<zarr.DataType, zarr.Readable>[],
    spatialDims: [string, string],
    mpu: number,
    forwardTo4326: ReprojectionFns["forwardReproject"],
    inverseFrom4326: ReprojectionFns["inverseReproject"],
    forwardTo3857: ReprojectionFns["forwardReproject"],
    inverseFrom3857: ReprojectionFns["inverseReproject"],
  ): TileLayer {
    const chunkSizes = arrays.map((arr) => ({
      width: arr.chunks[arr.chunks.length - 1]!,
      height: arr.chunks[arr.chunks.length - 2]!,
    }));

    class ZarrTilesetFactory extends RasterTileset2D {
      constructor(opts: Tileset2DProps) {
        const descriptor = geoZarrToDescriptor(meta, {
          projectTo4326: forwardTo4326,
          projectFrom4326: inverseFrom4326,
          projectTo3857: forwardTo3857,
          projectFrom3857: inverseFrom3857,
          chunkSizes,
          mpu,
        });
        super(opts, descriptor);
      }
    }

    const {
      maxRequests,
      maxCacheSize,
      maxCacheByteSize,
      debounceTime,
      refinementStrategy,
    } = this.props;

    return new TileLayer<TileData<DataT>>({
      id: `zarr-tile-layer-${this.id}`,
      TilesetClass: ZarrTilesetFactory,
      getTileData: (tile) => this._getTileData(tile, meta, arrays, spatialDims),
      renderSubLayers: (props) =>
        this._renderSubLayers(
          props,
          forwardTo4326,
          inverseFrom4326,
          forwardTo3857,
          inverseFrom3857,
        ),
      updateTriggers: {
        renderSubLayers: this.props.updateTriggers?.renderTile,
      },
      debounceTime,
      maxCacheByteSize,
      maxCacheSize,
      maxRequests,
      refinementStrategy,
    });
  }

  override renderLayers() {
    const {
      meta,
      spatialDims,
      arrays,
      mpu,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
    } = this.state;

    if (
      !meta ||
      !spatialDims ||
      !arrays ||
      mpu === undefined ||
      !forwardTo4326 ||
      !inverseFrom4326 ||
      !forwardTo3857 ||
      !inverseFrom3857
    ) {
      return null;
    }

    return this.renderTileLayer(
      meta,
      arrays,
      spatialDims,
      mpu,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
    );
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
