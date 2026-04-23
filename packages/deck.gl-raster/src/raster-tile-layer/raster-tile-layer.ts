import type { Layer, LayerProps } from "@deck.gl/core";
import { COORDINATE_SYSTEM, CompositeLayer } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { renderDebugTileOutline } from "../layer-utils.js";
import { RasterLayer } from "../raster-layer.js";
import type { TilesetDescriptor } from "../raster-tileset/index.js";
import { RasterTileset2D } from "../raster-tileset/index.js";
import type { TileMetadata } from "../raster-tileset/raster-tileset-2d.js";
import { TILE_SIZE, WEB_MERCATOR_TO_WORLD_SCALE } from "./constants.js";
import type {
  GetTileDataOptions,
  MinimalDataT,
  RasterTileLayerProps,
} from "./types.js";

const defaultProps: Partial<RasterTileLayerProps> = {
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

  override initializeState(): void {
    this.setState({});
  }

  /** @returns the descriptor, or `undefined` if not yet available. */
  protected _getTilesetDescriptor(): TilesetDescriptor | undefined {
    return this.props.tilesetDescriptor;
  }

  /** @returns the tile-fetch callback, or `undefined` if not yet available. */
  protected _getGetTileData():
    | RasterTileLayerProps<DataT>["getTileData"]
    | undefined {
    return this.props.getTileData;
  }

  /** @returns the per-tile render callback, or `undefined` if not yet available. */
  protected _getRenderTile():
    | RasterTileLayerProps<DataT>["renderTile"]
    | undefined {
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
    const { forwardTransform, inverseTransform } = descriptor.levels[
      z
    ]!.tileTransform(x, y);
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
