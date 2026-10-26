import type { UpdateParameters } from "@deck.gl/core";
import type {
  MinimalTileData,
  GetTileDataOptions as RasterTileGetTileDataOptions,
  RasterTileLayerProps,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import { RasterTileLayer } from "@developmentseed/deck.gl-raster";
import type { DecoderPool, GeoTIFF, Overview } from "@developmentseed/geotiff";
import { defaultDecoderPool } from "@developmentseed/geotiff";
import { Texture } from "@luma.gl/core";
import type { COGInput } from "./cog-source.js";
import { COGSource } from "./cog-source.js";
import type { TextureDataT } from "./geotiff/render-pipeline.js";
import { inferRenderPipeline } from "./geotiff/render-pipeline.js";

/** Options passed to `getTileData`. */
export type GetTileDataOptions = RasterTileGetTileDataOptions & {
  /** The x coordinate of the tile within the IFD. */
  x: number;

  /** The y coordinate of the tile within the IFD. */
  y: number;

  /** The decoder pool to use. */
  pool: DecoderPool;
};

type COGLayerDataProps<DataT extends MinimalTileData> =
  | {
      /**
       * User-defined method to load data for a tile.
       *
       * Must be provided together with `renderTile`. If neither is provided,
       * the default pipeline is used, which fetches the tile, uploads it as a
       * GPU texture, and renders it using an inferred shader pipeline.
       */
      getTileData: (
        image: GeoTIFF | Overview,
        options: GetTileDataOptions,
      ) => Promise<DataT>;

      /**
       * User-defined method to render data for a tile.
       *
       * Must be provided together with `getTileData`. Receives the value
       * returned by `getTileData` and must return a render pipeline, or
       * `null` to skip rendering for this tile.
       */
      renderTile: (data: DataT) => RenderTileResult | null;
    }
  | {
      getTileData?: undefined;
      renderTile?: undefined;
    };

/**
 * Props that can be passed into the {@link COGLayer}.
 */
export type COGLayerProps<DataT extends MinimalTileData = TextureDataT> = Omit<
  RasterTileLayerProps<DataT>,
  "tilesetDescriptor" | "getTileData" | "renderTile"
> &
  COGLayerDataProps<DataT> & {
    /**
     * The Cloud-Optimized GeoTIFF to draw: an opened {@link COGSource}, or one
     * of these for the layer to open with the defaults of
     * {@link COGSource.open}:
     *
     * - a {@link URL} or `string` pointing to a COG
     * - an {@link ArrayBuffer} containing the COG data
     * - an opened {@link GeoTIFF}
     *
     * Open the COG yourself to change those defaults, such as the EPSG
     * resolver or the request limiter, or to share one opened COG between
     * layers.
     *
     * Keep the same object across renders: a new one starts the layer's tiles
     * over.
     */
    source: COGSource | COGInput;

    /**
     * Called with the source the layer opened, when `source` isn't an opened
     * {@link COGSource} already.
     */
    onSourceLoad?: (source: COGSource) => void;

    /**
     * Worker pool for decoding image chunks.
     *
     * If none is provided, a default Pool will be created and shared between all
     * COGLayer and GeoTIFFLayer instances.
     */
    pool?: DecoderPool;

    /** A user-provided AbortSignal to cancel loading.
     *
     * This can be useful in combination with the MosaicLayer, so that when a
     * mosaic source is out of the viewport, all of its tile requests are
     * automatically aborted.
     */
    signal?: AbortSignal;
  };

/**
 * COGLayer renders a COG using a tiled approach with reprojection.
 *
 * Its `source` is an opened {@link COGSource}, or a COG for the layer to open.
 */
export class COGLayer<
  DataT extends MinimalTileData = TextureDataT,
> extends RasterTileLayer<DataT, COGLayerProps<DataT>> {
  static override layerName = "COGLayer";

  declare state: RasterTileLayer<DataT, COGLayerProps<DataT>>["state"] & {
    /** The source the layer draws: `source` itself, or the one opened from it. */
    source?: COGSource;
    defaultGetTileData?: COGLayerProps<TextureDataT>["getTileData"];
    defaultRenderTile?: COGLayerProps<TextureDataT>["renderTile"];
  };

  override shouldLoadMetadata({
    props,
    oldProps,
  }: UpdateParameters<this>): boolean {
    // An opened source needs no loading
    return (
      props.source !== oldProps.source && !(props.source instanceof COGSource)
    );
  }

  override updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    const { props, oldProps } = params;
    if (props.source instanceof COGSource && props.source !== oldProps.source) {
      // An opened source replaces any open still in flight
      this._abortMetadataLoad();
      // If the default pipeline can't draw the new source, draw nothing rather
      // than the old one
      this.clearState();
      this.setState(this._sourceState(props.source));
    }
  }

  clearState() {
    this.setState({
      source: undefined,
      defaultGetTileData: undefined,
      defaultRenderTile: undefined,
    });
  }

  /** Open `source`, when it isn't an opened source already. */
  override async loadMetadata(signal: AbortSignal): Promise<void> {
    // Clear stale state so renderLayers returns null until the new source is
    // ready
    this.clearState();

    const input = this.props.source;
    // `source` was removed. An opened source never loads.
    if (input === undefined || input instanceof COGSource) {
      return;
    }
    const source = await COGSource.open(input, { signal });

    // `source` changed or the layer was removed while we waited
    signal.throwIfAborted();

    this.props.onSourceLoad?.(source);
    this.setState(this._sourceState(source));
  }

  /**
   * The state for drawing `source`, with the default pipeline unless the app
   * passed both `getTileData` and `renderTile`.
   */
  private _sourceState(source: COGSource) {
    let defaultGetTileData: COGLayerProps<TextureDataT>["getTileData"];
    let defaultRenderTile: COGLayerProps<TextureDataT>["renderTile"];
    if (!this.props.getTileData || !this.props.renderTile) {
      ({ getTileData: defaultGetTileData, renderTile: defaultRenderTile } =
        inferRenderPipeline(source.geotiff, this.context.device));
    }

    return { source, defaultGetTileData, defaultRenderTile };
  }

  protected override _tilesetDescriptor() {
    return this.state.source?.tilesetDescriptor;
  }

  /**
   * Adapts the user-facing `(image, { x, y, ... }) => Promise<DataT>` signature
   * into RasterTileLayer's `(tile, { signal, device }) => Promise<DataT>`.
   */
  protected override _getTileDataCallback() {
    const geotiff = this.state.source?.geotiff;

    if (!geotiff) {
      return undefined;
    }

    const userFn = this.props.getTileData ?? this.state.defaultGetTileData;

    if (!userFn) {
      return undefined;
    }

    type RasterGetTileData = NonNullable<
      RasterTileLayerProps<DataT>["getTileData"]
    >;
    const wrapped: RasterGetTileData = async (tile, options) => {
      const { x, y, z } = tile.index;
      // Levels are emitted coarsest-first with the full-res geotiff appended
      // last, so z === overviews.length picks the full-res image and lower z
      // picks the corresponding overview from the finest-first list.
      const image =
        z === geotiff.overviews.length
          ? geotiff
          : geotiff.overviews[geotiff.overviews.length - 1 - z]!;
      return userFn(image, {
        device: options.device,
        x,
        y,
        signal: options.signal,
        pool: this.props.pool ?? defaultDecoderPool(),
      }) as Promise<DataT>;
    };
    return wrapped;
  }

  protected override _renderTileCallback() {
    const userFn = this.props.renderTile ?? this.state.defaultRenderTile;

    if (!userFn) {
      return undefined;
    }

    return userFn as NonNullable<RasterTileLayerProps<DataT>["renderTile"]>;
  }

  protected override _onTileUnloadCallback(): RasterTileLayerProps<DataT>["onTileUnload"] {
    const onTileUnload = this.props.onTileUnload;
    // A user-supplied `getTileData` owns its own textures and is responsible for
    // freeing them. Only destroy textures the default pipeline created.
    if (this.props.getTileData) {
      return onTileUnload;
    }
    return (tile) => {
      onTileUnload?.(tile);
      // `DataT` is generic here (no `texture`/`mask` on `MinimalTileData`), but
      // the default pipeline always returns a `TextureDataT`.
      const data = tile.content as TextureDataT | null;
      if (data?.texture instanceof Texture) {
        data?.texture.destroy();
      }
      if (data?.mask instanceof Texture) {
        data?.mask.destroy();
      }
    };
  }
}
