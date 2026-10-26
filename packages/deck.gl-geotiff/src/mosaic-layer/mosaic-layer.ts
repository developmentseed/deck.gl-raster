import type {
  CompositeLayerProps,
  Layer,
  LayerContext,
  LayersList,
  UpdateParameters,
  Viewport,
} from "@deck.gl/core";
import {
  _GlobeViewport,
  CompositeLayer,
  WebMercatorViewport,
} from "@deck.gl/core";
import type { TileLayerProps } from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type { ConcurrencyLimiter, Priority } from "@developmentseed/geotiff";
import { nearestCopy, unwrapBbox } from "@developmentseed/proj";
import { DEFAULT_CONCURRENCY_LIMITER } from "../default-concurrency-limiter.js";
import type { ItemIndex, MosaicItem } from "./mosaic-tileset-2d.js";
import { buildItemIndex, MosaicTileset2D } from "./mosaic-tileset-2d.js";

export type MosaicLayerProps<
  ItemT extends MosaicItem = MosaicItem,
  DataT = any,
> = CompositeLayerProps &
  Pick<
    TileLayerProps,
    // NOTE: `debounceTime` is intentionally not exposed.
    // See https://github.com/developmentseed/deck.gl-raster/issues/562
    "maxCacheByteSize" | "maxCacheSize" | "maxRequests" | "maxZoom" | "minZoom"
  > & {
    /**
     * List of mosaic sources to render.
     *
     * The mosaic updates reactively when this prop is replaced with a new
     * array reference. Mutating the array in place will not trigger an
     * update — pass a fresh array (e.g. `[...sources, newItem]`) to add or
     * remove items.
     *
     * Tile cache reuse depends on stable tile IDs. By default, each source's
     * tile ID is derived from its position in this array (see
     * `MosaicItem.id`), so:
     *
     * - Appending items preserves all existing rendered tiles.
     * - Reordering or removing items from the middle of the array invalidates
     *   the cache slots of shifted items, causing them to re-fetch.
     *
     * Supply an explicit `id` per source if you need cache stability across
     * arbitrary mutations of `sources`.
     */
    sources: ItemT[];

    /**
     * Only load and render sources whose `bbox` overlaps this bounding box,
     * given as `[minLng, minLat, maxLng, maxLat]` in WGS84 degrees.
     *
     * A source that overlaps it is drawn in full, not clipped to it. To limit
     * what a source loads as well, pass the same `extent` to the layers
     * `renderSource` returns. Unlike in deck.gl's TileLayer, it does not keep
     * sources loading below `minZoom`.
     */
    extent?: number[] | null;

    /**
     * Caps concurrent HTTP requests for this layer's source fetches.
     *
     * Defaults to a maximum of 6 concurrent requests per origin, which aligns
     * with browser limits of 6 HTTP/1.1 requests per origin. If your sources
     * support HTTP/2 or HTTP/3, you may want to increase this limit or disable
     * it entirely by passing `null`.
     */
    concurrencyLimiter?: ConcurrencyLimiter | null;

    /** Fetch data for this source. */
    getSource?: (
      source: ItemT,
      opts: {
        signal?: AbortSignal;
        /**
         * The layer's current `concurrencyLimiter` prop. Forward to
         * {@link GeoTIFF.fromUrl}'s `concurrencyLimiter` option so this
         * source's fetches join the shared per-origin queue.
         */
        concurrencyLimiter?: ConcurrencyLimiter | null;
        /**
         * Callback that provides dynamic priority for fetches related to this
         * source.
         *
         * This is designed to re-sort the limiter's queue on viewport pan,
         * preferring sources closer to the viewport center.
         */
        getPriority?: () => Priority;
      },
    ) => Promise<DataT>;

    /** Render a source */
    renderSource: (
      source: ItemT,
      opts: {
        data?: DataT;
        signal?: AbortSignal;
      },
    ) => Layer | LayersList | null;

    /**
     * Called after a source's data has loaded successfully. `data` is the
     * value returned by `getSource`, or `undefined` when no `getSource` was
     * supplied.
     */
    onSourceLoad?: (source: ItemT, info: { data?: DataT }) => void;

    /**
     * Called when fetching a source's data fails.
     */
    onSourceError?: (source: ItemT, info: { error: Error }) => void;

    /**
     * Called when a source is evicted from the tile cache.
     */
    onSourceUnload?: (source: ItemT, info: { data?: DataT }) => void;

    /**
     * Called when all sources currently in the viewport have finished
     * loading.
     */
    onViewportLoad?: (entries: Array<{ source: ItemT; data?: DataT }>) => void;
  };

const defaultProps: Partial<MosaicLayerProps> = {
  concurrencyLimiter: DEFAULT_CONCURRENCY_LIMITER,
  sources: [],
};

/**
 * Build the limiter `getPriority` callback for one mosaic source: euclidean
 * distance from the source's bbox center to the current viewport center, in
 * lon/lat degree-space (just an ordering key — great-circle isn't needed).
 * Longitude is measured the short way around, so a source just across the
 * antimeridian counts as near.
 *
 * `getViewport` is read on every call, so the limiter re-sorts its queue as
 * the viewport pans, pulling newly-central sources ahead of edge sources.
 *
 * Returns `undefined` for non-geographic viewports — where the source bbox and
 * viewport center don't share a coordinate space — so the limiter falls back
 * to FIFO instead of comparing mismatched units. The viewport type is checked
 * once here; it isn't expected to change under the layer.
 */
function createGetPriorityCallback(
  bbox: readonly [number, number, number, number],
  getViewport: () => Viewport,
): (() => number) | undefined {
  const viewport = getViewport();
  if (
    !(viewport instanceof WebMercatorViewport) &&
    !(viewport instanceof _GlobeViewport)
  ) {
    return undefined;
  }

  const [minX, minY, maxX, maxY] = unwrapBbox(bbox);
  const sourceCx = (minX + maxX) / 2;
  const sourceCy = (minY + maxY) / 2;

  return (): number => {
    // Geographic viewport (checked above); both types expose lon/lat.
    const v = getViewport() as WebMercatorViewport | _GlobeViewport;
    const dx = nearestCopy(sourceCx, v.longitude, 360) - v.longitude;
    const dy = sourceCy - v.latitude;
    return Math.hypot(dx, dy);
  };
}

/**
 * A deck.gl layer for rendering a mosaic of raster sources.
 *
 * The `renderSource` prop is called whenever a source is present in the current
 * viewport.
 */
export class MosaicLayer<
  ItemT extends MosaicItem = MosaicItem,
  DataT = any,
> extends CompositeLayer<MosaicLayerProps<ItemT, DataT>> {
  static override layerName = "MosaicLayer";
  static override defaultProps = defaultProps;

  declare state: {
    // The index can be null if there are no items
    index: ItemIndex | null;
    // The items the index was built from
    items: ItemT[];
  };

  override initializeState(context: LayerContext): void {
    super.initializeState(context);
    this._buildSpatialIndex();
  }

  override updateState(params: UpdateParameters<this>): void {
    super.updateState(params);

    const { props, oldProps } = params;

    if (props.sources !== oldProps.sources) {
      this._buildSpatialIndex();
    }
  }

  private _buildSpatialIndex(): void {
    const { sources } = this.props;
    this.setState({ index: buildItemIndex(sources), items: sources });
  }

  renderTileLayer(
    renderSource: MosaicLayerProps<ItemT, DataT>["renderSource"],
  ): TileLayer {
    const {
      id,
      concurrencyLimiter,
      extent,
      maxCacheByteSize,
      maxCacheSize,
      maxRequests,
      maxZoom,
      minZoom,
      onSourceLoad,
      onSourceError,
      onSourceUnload,
      onViewportLoad,
    } = this.props;

    // TileLayer creates the tileset only once, so these closures stay bound to
    // the first MosaicLayer instance. Apps create a new MosaicLayer on every
    // render, and deck.gl hands it the same `state` object, but `this.props`
    // here stays the first instance's props. So both closures read
    // `this.state`.
    const getItems = () => this.state.items;
    const getIndex = () => this.state.index;
    class MosaicTileset2DFactory extends MosaicTileset2D<ItemT> {
      constructor(opts: any) {
        super(getItems, getIndex, opts);
      }
    }

    return new TileLayer<{
      source: ItemT;
      data?: DataT;
      signal?: AbortSignal;
    }>({
      id: `mosaic-layer-${id}`,
      TilesetClass: MosaicTileset2DFactory,
      ...omitUndefined({
        minZoom,
        maxZoom,
        extent,
        maxCacheByteSize,
        maxCacheSize,
        maxRequests,
      }),
      getTileData: async (data) => {
        // We hard-cast this because TilesetClass is not generic.
        // MosaicTileset2D returns ItemT in `index`, but TileLayer's typing
        // exposes only the plain `TileIndex` here.
        const index = data.index as unknown as ItemT;
        const { signal } = data;
        const getPriority = createGetPriorityCallback(
          index.bbox,
          () => this.context.viewport,
        );
        const userData =
          this.props.getSource &&
          (await this.props.getSource(index, {
            signal,
            concurrencyLimiter,
            getPriority,
          }));

        return {
          source: index,
          data: userData,
          signal,
        };
      },
      renderSubLayers: (props) => {
        const { data } = props;
        const { source, signal, data: userData } = data;
        return renderSource(source, { data: userData, signal });
      },
      ...(onSourceLoad && {
        onTileLoad: (tile) => {
          // `tile.index` is a `ResolvedItem<ItemT>` from
          // MosaicTileset2D.getTileIndices, which structurally extends
          // ItemT.
          const source = tile.index as unknown as ItemT;
          onSourceLoad(source, { data: tile.content?.data });
        },
      }),
      ...(onSourceError && {
        onTileError: (error, tile) => {
          if (!tile) {
            return;
          }
          const source = tile.index as unknown as ItemT;
          onSourceError(source, { error });
        },
      }),
      ...(onSourceUnload && {
        onTileUnload: (tile) => {
          const source = tile.index as unknown as ItemT;
          onSourceUnload(source, { data: tile.content?.data });
        },
      }),
      ...(onViewportLoad && {
        onViewportLoad: (tiles) => {
          onViewportLoad(
            tiles.map((tile) => ({
              source: tile.index as unknown as ItemT,
              data: tile.content?.data,
            })),
          );
        },
      }),
    });
  }

  override renderLayers(): Layer | null | LayersList {
    const { sources, renderSource } = this.props;

    if (!sources) {
      return null;
    }

    // Note: we deliberately render the inner TileLayer even when `sources` is
    // empty so the same Tileset2D instance lives across empty -> non-empty
    // transitions and picks up later updates without recreation.
    return this.renderTileLayer(renderSource);
  }
}

/**
 * Drop keys whose value is `undefined`.
 *
 * Passing down an explicit `undefined` will override any default prop values.
 */
function omitUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}
