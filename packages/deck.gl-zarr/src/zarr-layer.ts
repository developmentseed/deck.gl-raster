import type { UpdateParameters } from "@deck.gl/core";
import type {
  MinimalTileData,
  GetTileDataOptions as RasterTileGetTileDataOptions,
  RasterTileLayerProps,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import { RasterTileLayer } from "@developmentseed/deck.gl-raster";
import * as zarr from "zarrita";
import { validateSelection } from "./validation.js";
import { ZarrSource } from "./zarr-source.js";

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
   * The GeoZarr data to draw: an opened {@link ZarrSource}, or a zarrita
   * {@link zarr.Group} or {@link zarr.Array} for the layer to open with the
   * defaults of {@link ZarrSource.open}.
   *
   * Open the data yourself to change those defaults, such as the variable or
   * the GeoZarr metadata, or to share it between layers. Callers build and
   * configure the store either way, for example to wrap a
   * {@link zarr.FetchStore} with `withConsolidatedMetadata`.
   *
   * Keep the same object across renders: a new one starts the layer's tiles
   * over.
   */
  source:
    | ZarrSource<Store, Dtype>
    | zarr.Group<Store>
    | zarr.Array<Dtype, Store>;

  /**
   * Called with the source the layer opened, when `source` isn't an opened
   * {@link ZarrSource} already.
   */
  onSourceLoad?: (source: ZarrSource<Store, Dtype>) => void;

  /**
   * Selection for non-spatial dimensions. Must include exactly one entry
   * per non-spatial dim in the array. Use a number to pin to a single index,
   * `null` to use zarr's default slice, or a `zarr.Slice` for a range.
   *
   * For datasets with only spatial dimensions (e.g. a plain [H, W] or
   * [bands, H, W] array whose non-spatial dims are already accounted for),
   * pass an empty object `{}`.
   *
   * A selection that doesn't fit the source goes to `onError`, and the layer
   * draws nothing until the selection is fixed. Changing the selection never
   * opens the source again.
   *
   * Tiles already loaded keep the data of the selection they were fetched
   * with. To fetch them again for a new selection, give the layer a new `id`.
   */
  selection: Record<string, SliceInput>;

  /**
   * Fetch and return the tile data for a given tile coordinate.
   *
   * The layer picks the zarr array for the requested zoom level and passes it
   * along with a pre-built `sliceSpec` (one entry per array dim). Call
   * `zarr.get(arr, sliceSpec)` and convert the result to whatever format your
   * `renderTile` callback expects.
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
};

/**
 * ZarrLayer renders a GeoZarr dataset using a tiled approach with reprojection.
 *
 * Its `source` is an opened {@link ZarrSource}, or a zarrita group or array
 * for the layer to open. The caller is responsible for supplying `getTileData`
 * (which fetches and converts the zarr chunk) and `renderTile` (which converts
 * the result into a {@link RenderTileResult} for the GPU). This keeps the
 * layer agnostic about data format and rendering pipeline.
 */
export class ZarrLayer<
  Store extends zarr.Readable = zarr.Readable,
  Dtype extends zarr.DataType = zarr.DataType,
  DataT extends MinimalTileData = MinimalTileData,
> extends RasterTileLayer<DataT, ZarrLayerProps<Store, Dtype, DataT>> {
  static override layerName = "ZarrLayer";

  declare state: RasterTileLayer<
    DataT,
    ZarrLayerProps<Store, Dtype, DataT>
  >["state"] & {
    /**
     * The source and selection last checked against each other, and whether
     * the selection fits the source.
     */
    checked?: {
      source: ZarrSource<Store, Dtype>;
      selection: Record<string, SliceInput>;
      fits: boolean;
    };
  };

  override updateState(params: UpdateParameters<this>): void {
    super.updateState(params);

    // Check `selection` whenever it or the source differs from the pair last
    // checked. Comparing with that pair, rather than with the old props, also
    // catches a source opened from input, which arrives between renders, and
    // a selection that changed while there was no source.
    const { source, checked } = this.state;
    const { selection } = params.props;
    if (
      !source ||
      (checked?.source === source &&
        sameSelection(selection, checked.selection))
    ) {
      return;
    }

    let fits = true;
    try {
      validateSelection({
        dimensionNames: source.dimensionNames,
        spatialDims: source.spatialDims,
        selection,
      });
    } catch (error) {
      fits = false;
      const { layerName } = this.constructor as typeof ZarrLayer;
      this.raiseError(
        error as Error,
        `Can't draw the selection in ${layerName}`,
      );
    }
    this.setState({ checked: { source, selection, fits } });
  }

  /**
   * Open the group or array that `source` names, with the defaults of
   * {@link ZarrSource.open}.
   */
  protected override _openSource(
    input: zarr.Group<Store> | zarr.Array<Dtype, Store>,
    signal: AbortSignal,
  ): Promise<ZarrSource<Store, Dtype>> {
    return ZarrSource.open(input, { signal });
  }

  /**
   * Adapts the user-facing `(arr, { x, y, z, sliceSpec, ... }) => Promise<DataT>`
   * signature into RasterTileLayer's `(tile, { signal, device }) => Promise<DataT>`.
   */
  protected override _getTileDataCallback() {
    const { source, checked } = this.state;
    // Draw nothing while the selection doesn't fit the source
    if (!source || checked?.source !== source || !checked.fits) {
      return undefined;
    }
    const userFn = this.props.getTileData;
    if (!userFn) {
      return undefined;
    }

    const { arrays, dimensionNames, spatialDims } = source;
    const { selection } = checked;
    type RasterGetTileData = NonNullable<
      RasterTileLayerProps<DataT>["getTileData"]
    >;
    const wrapped: RasterGetTileData = async (tile, options) => {
      const { x, y, z } = tile.index;
      // The tile grid's levels are coarsest-first, and `arrays` finest-first
      const arr = arrays[arrays.length - 1 - z]!;

      // The spatial dims are the last two
      const tileWidth = arr.chunks[arr.chunks.length - 1]!;
      const tileHeight = arr.chunks[arr.chunks.length - 2]!;
      const arrayWidth = arr.shape[arr.shape.length - 1]!;
      const arrayHeight = arr.shape[arr.shape.length - 2]!;

      const rowStart = y * tileHeight;
      const rowEnd = Math.min((y + 1) * tileHeight, arrayHeight);
      const colStart = x * tileWidth;
      const colEnd = Math.min((x + 1) * tileWidth, arrayWidth);

      // Build slice per array dim: spatial dims get tile-bounded slices,
      // non-spatial dims are filled from the checked `selection`.
      const sliceSpec: SliceInput[] = dimensionNames.map((dimName) => {
        if (dimName === spatialDims[0]) {
          return zarr.slice(rowStart, rowEnd);
        }
        if (dimName === spatialDims[1]) {
          return zarr.slice(colStart, colEnd);
        }
        // The selection was checked to have every non-spatial dim
        return selection[dimName]!;
      });

      return userFn(arr, {
        device: options.device,
        x,
        y,
        z,
        sliceSpec,
        width: colEnd - colStart,
        height: rowEnd - rowStart,
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

/** Whether two selections pick the same indices of every dimension. */
function sameSelection(
  a: Record<string, SliceInput>,
  b: Record<string, SliceInput>,
): boolean {
  if (a === b) {
    return true;
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => sameSliceInput(a[key], b[key]))
  );
}

/** Whether two dimension selectors pick the same indices. */
function sameSliceInput(
  a: SliceInput | undefined,
  b: SliceInput | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) {
    return false;
  }
  return a.start === b.start && a.stop === b.stop && a.step === b.step;
}
