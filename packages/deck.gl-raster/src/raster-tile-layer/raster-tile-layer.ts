import type {
  CompositeLayerProps,
  DefaultProps,
  Layer,
  LayerProps,
} from "@deck.gl/core";
import { COORDINATE_SYSTEM, CompositeLayer } from "@deck.gl/core";
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
 */
export type MinimalDataT = {
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
  /** The luma.gl Device. Optional — consumers that don't touch GPU may ignore. */
  device?: Device;
  /**
   * Combined AbortSignal: the layer's `signal` prop composed with the
   * TileLayer's per-tile lifecycle signal. Fires when either aborts.
   */
  signal?: AbortSignal;
};

/**
 * Props for {@link RasterTileLayer}.
 */
export type RasterTileLayerProps<DataT extends MinimalDataT = MinimalDataT> =
  CompositeLayerProps &
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
       * `_getTilesetDescriptor()` method.
       */
      tilesetDescriptor?: TilesetDescriptor;

      /**
       * Load data for one tile. Runs once per (x, y, z); the resulting `DataT`
       * is cached by the underlying TileLayer.
       *
       * Subclasses may supply this via state by overriding `_getGetTileData()`.
       */
      getTileData?: (
        tile: TileLoadProps,
        options: GetTileDataOptions,
      ) => Promise<DataT>;

      /**
       * Turn cached tile data into a render result (image and/or shader pipeline).
       * Called on every render; does not re-fetch.
       *
       * To invalidate the inner TileLayer's rendered sub-layers when a dependency
       * changes (e.g. a colormap choice), pass
       * `updateTriggers: { renderTile: [dep1, dep2] }` on the layer props.
       *
       * Subclasses may supply this via state by overriding `_getRenderTile()`.
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
 * Base layer that renders a tiled raster source driven by a generic
 * {@link TilesetDescriptor}.
 *
 * Usable directly (provide `tilesetDescriptor`, `getTileData`, and `renderTile`
 * as props) or as a base class (override the protected `_getTilesetDescriptor`,
 * `_getGetTileData`, `_getRenderTile` accessors to source them from state).
 */
export class RasterTileLayer<
  DataT extends MinimalDataT = MinimalDataT,
  // biome-ignore lint/complexity/noBannedTypes: matches CompositeLayer's generic default shape
  ExtraProps extends {} = {},
> extends CompositeLayer<Required<RasterTileLayerProps<DataT>> & ExtraProps> {
  static override layerName = "RasterTileLayer";
  static override defaultProps = defaultProps;

  /** @returns the descriptor, or `undefined` if not yet available. */
  protected _getTilesetDescriptor(): TilesetDescriptor | undefined {
    return this.props.tilesetDescriptor;
  }

  /** @returns the tile-fetch callback, or `undefined` if not yet available. */
  protected _getGetTileData(): RasterTileLayerProps<DataT>["getTileData"] {
    return this.props.getTileData;
  }

  /** @returns the per-tile render callback, or `undefined` if not yet available. */
  protected _getRenderTile(): RasterTileLayerProps<DataT>["renderTile"] {
    return this.props.renderTile;
  }

  override renderLayers(): Layer | null {
    const descriptor = this._getTilesetDescriptor();
    const getTileData = this._getGetTileData();
    const renderTile = this._getRenderTile();
    if (!descriptor || !getTileData || !renderTile) return null;
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
        renderSubLayers: this.props.updateTriggers?.renderTile,
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
    if (!props.data) return layers;

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
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
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
