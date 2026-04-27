import type {
  CompositeLayerProps,
  DefaultProps,
  Layer,
  LayerProps,
} from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { Device } from "@luma.gl/core";
import { renderDebugTileOutline } from "../layer-utils.js";
import type { RenderTileResult } from "../raster-layer.js";
import { RasterLayer } from "../raster-layer.js";
import type { TilesetDescriptor } from "../raster-tileset/index.js";
import { RasterTileset2D } from "../raster-tileset/index.js";
import type { TileMetadata } from "../raster-tileset/raster-tileset-2d.js";
import { TILE_SIZE, WEB_MERCATOR_TO_WORLD_SCALE } from "./constants.js";

/**
 * Minimum interface returned by `getTileData`.
 *
 * null and undefined are allowed to support failed tile loads, which then avoid
 * rendering any layer.
 */
export type MinimalTileData =
  | null
  | undefined
  | {
      /** Tile height in pixels. */
      height: number;
      /** Tile width in pixels. */
      width: number;
      /**
       * Byte length of the tile data, used by deck.gl's TileLayer for
       * byte-based cache eviction when `maxCacheByteSize` is set. Optional.
       */
      byteLength?: number;
    };

/**
 * Options passed to a user-supplied `getTileData` callback.
 */
export type GetTileDataOptions = {
  /**
   * The luma.gl Device. Always populated by the base layer from
   * `this.context.device`.
   */
  device: Device;
  /**
   * Combined AbortSignal: the layer's `signal` prop composed with the
   * TileLayer's per-tile lifecycle signal. Fires when either aborts.
   */
  signal?: AbortSignal;
};

/**
 * Props for {@link RasterTileLayer}.
 */
export type RasterTileLayerProps<
  DataT extends MinimalTileData = MinimalTileData,
> = CompositeLayerProps &
  Pick<
    TileLayerProps,
    | "tileSize"
    | "zoomOffset"
    | "maxZoom"
    | "minZoom"
    | "extent"
    | "debounceTime"
    | "maxCacheSize"
    | "maxCacheByteSize"
    | "maxRequests"
    | "refinementStrategy"
  > & {
    /**
     * Tile pyramid + CRS projection descriptor.
     *
     * Subclasses may supply this via state by overriding the protected
     * `_tilesetDescriptor()` method.
     */
    tilesetDescriptor?: TilesetDescriptor;

    /**
     * Load data for one tile. Runs once per (x, y, z); the resulting `DataT`
     * is cached by the underlying TileLayer.
     *
     * Subclasses may supply this via state by overriding
     * `_getTileDataCallback()`.
     */
    getTileData?: (
      tile: TileLoadProps,
      options: GetTileDataOptions,
    ) => Promise<DataT>;

    /**
     * Turn cached tile data into a render result (image and/or shader
     * pipeline). Called on every render; does not re-fetch.
     *
     * To invalidate the inner TileLayer's rendered sub-layers when a
     * dependency changes (e.g. a colormap choice), pass
     * `updateTriggers: { renderTile: [dep1, dep2] }` on the layer props.
     *
     * Subclasses may supply this via state by overriding `_renderTileCallback()`.
     */
    renderTile?: (data: DataT) => RenderTileResult;

    /**
     * Maximum reprojection error in pixels for mesh refinement.
     * Lower values create denser meshes.
     * @default 0.125
     */
    maxError?: number;

    /**
     * Show triangulation mesh + tile outlines.
     * @default false
     */
    debug?: boolean;

    /**
     * Opacity of the debug mesh overlay (0–1).
     * @default 0.5
     */
    debugOpacity?: number;

    /**
     * AbortSignal applied to every tile fetch, composed with TileLayer's
     * per-tile signal.
     */
    signal?: AbortSignal;
  };

const defaultProps: DefaultProps<RasterTileLayerProps> = {
  ...TileLayer.defaultProps,
  maxError: 0.125,
  debug: false,
  debugOpacity: 0.5,
};

/**
 * Base-class prop shape that excludes the overridable fields.
 *
 * The three overridable fields (`tilesetDescriptor`, `getTileData`,
 * `renderTile`) are declared by `ExtraProps` instead — either via the generic
 * default (for direct use) or by a subclass that provides its own signatures
 * (e.g. `COGLayer`'s `getTileData(image, options)`).
 */
type RasterTileLayerBaseProps<DataT extends MinimalTileData> = Omit<
  RasterTileLayerProps<DataT>,
  "tilesetDescriptor" | "getTileData" | "renderTile"
>;

/**
 * Default `ExtraProps` for direct use of `RasterTileLayer`: brings the three
 * overridable fields back in with the generic signatures. Subclasses supply
 * their own `ExtraProps` to override these.
 */
type RasterTileLayerDefaultExtraProps<DataT extends MinimalTileData> = Pick<
  RasterTileLayerProps<DataT>,
  "tilesetDescriptor" | "getTileData" | "renderTile"
>;

/**
 * Base layer that renders a tiled raster source driven by a generic
 * {@link TilesetDescriptor}.
 *
 * Usable directly (provide `tilesetDescriptor`, `getTileData`, and `renderTile`
 * as props) or as a base class (override the protected `_tilesetDescriptor`,
 * `_getTileDataCallback`, `_renderTileCallback` accessors to source them from
 * state).
 *
 * The generic `ExtraProps` parameter lets a subclass redeclare any of the
 * overridable fields with a domain-specific signature (e.g. `COGLayer`'s
 * `getTileData(image, options)`).
 */
export class RasterTileLayer<
  DataT extends MinimalTileData = MinimalTileData,
  ExtraProps extends object = RasterTileLayerDefaultExtraProps<DataT>,
> extends CompositeLayer<RasterTileLayerBaseProps<DataT> & ExtraProps> {
  static override layerName = "RasterTileLayer";
  static override defaultProps = defaultProps;

  /**
   * The currently effective {@link TilesetDescriptor}.
   *
   * Subclasses override this to return a descriptor built from their own
   * async-parsed state. Returns `undefined` while the source is still
   * loading; `renderLayers()` returns `null` in that case.
   *
   * The inline cast to `RasterTileLayerProps<DataT>` is required because
   * `tilesetDescriptor` is declared on `ExtraProps`, not on the base's
   * `RasterTileLayerBaseProps`. For direct use the default `ExtraProps`
   * brings it in; for subclass use this method is overridden and the cast
   * is never reached.
   */
  protected _tilesetDescriptor(): TilesetDescriptor | undefined {
    return (this.props as unknown as RasterTileLayerProps<DataT>)
      .tilesetDescriptor;
  }

  /**
   * The currently effective tile-fetch callback.
   *
   * Subclasses override this to adapt their user-facing `getTileData`
   * signature into the base's `(tile, options) => Promise<DataT>` shape.
   * Returns `undefined` when the callback is not yet available.
   */
  protected _getTileDataCallback(): RasterTileLayerProps<DataT>["getTileData"] {
    return (this.props as unknown as RasterTileLayerProps<DataT>).getTileData;
  }

  /**
   * The currently effective per-tile render callback.
   *
   * Subclasses override this to thread their user-facing `renderTile` and
   * any inferred default. Returns `undefined` when no callback is available.
   */
  protected _renderTileCallback(): RasterTileLayerProps<DataT>["renderTile"] {
    return (this.props as unknown as RasterTileLayerProps<DataT>).renderTile;
  }

  override renderLayers(): Layer | null {
    const descriptor = this._tilesetDescriptor();
    const getTileData = this._getTileDataCallback();
    const renderTile = this._renderTileCallback();

    if (!descriptor || !getTileData || !renderTile) {
      return null;
    }

    return this._renderTileLayer(descriptor, getTileData, renderTile);
  }

  private _renderTileLayer(
    descriptor: TilesetDescriptor,
    getTileData: NonNullable<RasterTileLayerProps<DataT>["getTileData"]>,
    renderTile: NonNullable<RasterTileLayerProps<DataT>["renderTile"]>,
  ): TileLayer {
    class TilesetFactory extends RasterTileset2D {
      constructor(opts: Tileset2DProps) {
        super(opts, descriptor);
      }
    }

    const {
      tileSize,
      zoomOffset,
      maxZoom,
      minZoom,
      extent,
      debounceTime,
      maxCacheSize,
      maxCacheByteSize,
      maxRequests,
      refinementStrategy,
      updateTriggers,
    } = this.props;

    return new TileLayer<DataT>({
      id: `raster-tile-layer-${this.id}`,
      TilesetClass: TilesetFactory,
      getTileData: (tile) => this._wrapGetTileData(tile, getTileData),
      renderSubLayers: (props) =>
        this._renderSubLayers(
          props as TileLayerProps<DataT> & {
            id: string;
            data?: DataT;
            _offset: number;
            tile: Tile2DHeader<DataT>;
          },
          descriptor,
          renderTile,
        ),
      updateTriggers: {
        renderSubLayers: updateTriggers?.renderTile,
      },
      tileSize,
      zoomOffset,
      maxZoom,
      minZoom,
      extent,
      debounceTime,
      maxCacheSize,
      maxCacheByteSize,
      maxRequests,
      refinementStrategy,
    });
  }

  private async _wrapGetTileData(
    tile: TileLoadProps,
    getTileData: NonNullable<RasterTileLayerProps<DataT>["getTileData"]>,
  ): Promise<DataT> {
    const { signal: tileSignal } = tile;
    const userSignal = this.props.signal;
    const signal =
      userSignal && tileSignal
        ? AbortSignal.any([userSignal, tileSignal])
        : (userSignal ?? tileSignal);
    const options: GetTileDataOptions = {
      device: this.context.device,
      signal,
    };
    return getTileData(tile, options);
  }

  private _renderSubLayers(
    props: TileLayerProps<DataT> & {
      id: string;
      data?: DataT;
      _offset: number;
      tile: Tile2DHeader<DataT>;
    },
    descriptor: TilesetDescriptor,
    renderTile: NonNullable<RasterTileLayerProps<DataT>["renderTile"]>,
  ): Layer[] {
    const { maxError, debug, debugOpacity } = this.props;
    const tile = props.tile as Tile2DHeader<DataT> & TileMetadata;

    const layers: Layer[] = [];
    if (debug) {
      layers.push(
        ...renderDebugTileOutline(
          `${this.id}-${tile.id}-bounds`,
          tile,
          descriptor.projectTo4326,
        ),
      );
    }

    if (!props.data) {
      return layers;
    }

    const { x, y, z } = tile.index;
    const level = descriptor.levels[z];
    if (!level) {
      return layers;
    }
    const { forwardTransform, inverseTransform } = level.tileTransform(x, y);
    const { image, renderPipeline } = renderTile(props.data);
    const { width, height } = props.data;

    const isGlobe = this.context.viewport.resolution !== undefined;
    const reprojectionFns: ReprojectionFns = isGlobe
      ? {
          forwardTransform,
          inverseTransform,
          forwardReproject: descriptor.projectTo4326,
          inverseReproject: descriptor.projectFrom4326,
        }
      : {
          forwardTransform,
          inverseTransform,
          forwardReproject: descriptor.projectTo3857,
          inverseReproject: descriptor.projectFrom3857,
        };
    const deckProjectionProps: Partial<LayerProps> = isGlobe
      ? {}
      : {
          coordinateSystem: "cartesian",
          coordinateOrigin: [TILE_SIZE / 2, TILE_SIZE / 2, 0],
          // biome-ignore format: array
          modelMatrix: [
            WEB_MERCATOR_TO_WORLD_SCALE, 0, 0, 0,
            0, WEB_MERCATOR_TO_WORLD_SCALE, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
          ],
        };

    const rasterLayer = new RasterLayer(
      this.getSubLayerProps({
        id: `${props.id}-raster`,
        width,
        height,
        // Passing `image: undefined` explicitly would trip isAsyncPropLoading
        // and cause a transient black flash (see issue #376).
        ...(image !== undefined && { image }),
        renderPipeline,
        maxError,
        reprojectionFns,
        debug,
        debugOpacity,
        ...deckProjectionProps,
      }),
    );
    return [rasterLayer, ...layers];
  }
}
