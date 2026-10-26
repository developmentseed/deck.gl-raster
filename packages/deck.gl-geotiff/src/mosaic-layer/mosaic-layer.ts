import type {
  CompositeLayerProps,
  Layer,
  LayerDataSource,
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

/**
 * Props for {@link MosaicLayer}.
 */
export type MosaicLayerProps<
  ItemT extends MosaicItem = MosaicItem,
  SourceT = any,
> = CompositeLayerProps &
  Pick<
    TileLayerProps,
    // NOTE: `debounceTime` is intentionally not exposed.
    // See https://github.com/developmentseed/deck.gl-raster/issues/562
    "maxCacheByteSize" | "maxCacheSize" | "maxRequests" | "maxZoom" | "minZoom"
  > & {
    /**
     * The items of the mosaic, each with a WGS84 `bbox`.
     *
     * As in other deck.gl layers, this can be an array, a promise of one, or a
     * URL that deck.gl loads. With `dataTransform`, the URL can be a STAC
     * search, for example: `dataTransform: (results) => results.features`.
     * `isLoaded` waits for it, and `onDataLoad` is called once it has loaded.
     *
     * The mosaic updates when this prop is replaced with a new array.
     * Mutating the array in place doesn't update it: pass a new array (e.g.
     * `[...items, newItem]`), or compare the items yourself with
     * `dataComparator`.
     *
     * Tile cache reuse depends on stable item IDs. By default, each item's ID
     * is its position in this array (see {@link MosaicItem.id}), so:
     *
     * - Appending items keeps every loaded item.
     * - Reordering or removing items from the middle of the array invalidates
     *   the cache slots of shifted items, causing them to re-fetch.
     *
     * Supply an explicit `id` per item if you need cache stability across
     * arbitrary changes to the items.
     */
    data: LayerDataSource<ItemT>;

    /**
     * Only load and render items whose `bbox` overlaps this bounding box,
     * given as `[minLng, minLat, maxLng, maxLat]` in WGS84 degrees.
     *
     * An item that overlaps it is drawn in full, not clipped to it. To limit
     * what an item loads as well, pass the same `extent` to the layers
     * `renderSource` returns. Unlike in deck.gl's TileLayer, it does not keep
     * items loading below `minZoom`.
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

    /**
     * Open the source of an item, such as a {@link COGSource} from
     * {@link COGSource.open}.
     *
     * It's called only for items in view, and `signal` aborts when the item
     * leaves view first.
     */
    getSource?: (
      item: ItemT,
      options: {
        signal?: AbortSignal;
        /**
         * The layer's current `concurrencyLimiter` prop. Pass it to
         * {@link COGSource.open} so the item's requests join the shared
         * per-origin queue.
         */
        concurrencyLimiter?: ConcurrencyLimiter | null;
        /**
         * Callback that provides dynamic priority for fetches related to this
         * item.
         *
         * This is designed to re-sort the limiter's queue on viewport pan,
         * preferring items closer to the viewport center.
         */
        getPriority?: () => Priority;
      },
    ) => Promise<SourceT>;

    /**
     * Render an item, with the `source` that `getSource` opened for it, or
     * `undefined` when no `getSource` was supplied.
     */
    renderSource: (
      item: ItemT,
      options: {
        source?: SourceT;
        signal?: AbortSignal;
      },
    ) => Layer | LayersList | null;

    /**
     * Called after an item's source has opened. `source` is the value
     * returned by `getSource`, or `undefined` when no `getSource` was
     * supplied.
     */
    onSourceLoad?: (item: ItemT, info: { source?: SourceT }) => void;

    /**
     * Called when opening an item's source fails.
     */
    onSourceError?: (item: ItemT, info: { error: Error }) => void;

    /**
     * Called when an item is evicted from the tile cache, with its source.
     */
    onSourceUnload?: (item: ItemT, info: { source?: SourceT }) => void;

    /**
     * Called when the sources of all items currently in the viewport have
     * opened.
     */
    onViewportLoad?: (
      entries: Array<{ item: ItemT; source?: SourceT }>,
    ) => void;
  };

const defaultProps: Partial<MosaicLayerProps> = {
  concurrencyLimiter: DEFAULT_CONCURRENCY_LIMITER,
};

/**
 * Build the limiter `getPriority` callback for one mosaic item: euclidean
 * distance from the item's bbox center to the current viewport center, in
 * lon/lat degree-space (just an ordering key — great-circle isn't needed).
 * Longitude is measured the short way around, so an item just across the
 * antimeridian counts as near.
 *
 * `getViewport` is read on every call, so the limiter re-sorts its queue as
 * the viewport pans, pulling newly-central items ahead of edge items.
 *
 * Returns `undefined` for non-geographic viewports, where the item's bbox and
 * the viewport center don't share a coordinate space, so the limiter falls
 * back to FIFO instead of comparing mismatched units. The viewport type is
 * checked once here; it isn't expected to change under the layer.
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
  const itemCx = (minX + maxX) / 2;
  const itemCy = (minY + maxY) / 2;

  return (): number => {
    // Geographic viewport (checked above); both types expose lon/lat.
    const v = getViewport() as WebMercatorViewport | _GlobeViewport;
    const dx = nearestCopy(itemCx, v.longitude, 360) - v.longitude;
    const dy = itemCy - v.latitude;
    return Math.hypot(dx, dy);
  };
}

/**
 * A deck.gl layer for rendering a mosaic of raster sources, such as the COGs
 * of a STAC search.
 *
 * Only the items in view are opened and drawn: `getSource` opens an item's
 * source, and `renderSource` draws the item with it.
 *
 * ```ts
 * new MosaicLayer({
 *   id: "mosaic",
 *   data: items, // each with a `bbox` and, here, a `url`
 *   getSource: (item, { signal, concurrencyLimiter, getPriority }) =>
 *     COGSource.open(item.url, { signal, concurrencyLimiter, getPriority }),
 *   renderSource: (item, { source, signal }) =>
 *     new COGLayer({ id: item.url, source, signal }),
 * });
 * ```
 */
export class MosaicLayer<
  ItemT extends MosaicItem = MosaicItem,
  SourceT = any,
> extends CompositeLayer<MosaicLayerProps<ItemT, SourceT>> {
  static override layerName = "MosaicLayer";
  static override defaultProps = defaultProps;

  declare state: {
    // The index can be null if there are no items
    index: ItemIndex | null;
    // The items the index was built from
    items: ItemT[];
  };

  override updateState(params: UpdateParameters<this>): void {
    super.updateState(params);

    // deck.gl sets `dataChanged` on the first update, and again whenever
    // `data` changes or finishes loading
    if (params.changeFlags.dataChanged) {
      this._buildSpatialIndex();
    }
  }

  private _buildSpatialIndex(): void {
    const items = toItems<ItemT>(this.props.data);
    this.setState({ index: buildItemIndex(items), items });
  }

  renderTileLayer(
    renderSource: MosaicLayerProps<ItemT, SourceT>["renderSource"],
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
      item: ItemT;
      source?: SourceT;
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
      getTileData: async (tile) => {
        // We hard-cast this because TilesetClass is not generic.
        // MosaicTileset2D returns ItemT in `index`, but TileLayer's typing
        // exposes only the plain `TileIndex` here.
        const item = tile.index as unknown as ItemT;
        const { signal } = tile;
        const getPriority = createGetPriorityCallback(
          item.bbox,
          () => this.context.viewport,
        );
        const source =
          this.props.getSource &&
          (await this.props.getSource(item, {
            signal,
            concurrencyLimiter,
            getPriority,
          }));

        return { item, source, signal };
      },
      renderSubLayers: (props) => {
        const { item, source, signal } = props.data;
        return renderSource(item, { source, signal });
      },
      ...(onSourceLoad && {
        onTileLoad: (tile) => {
          // `tile.index` is a `ResolvedItem<ItemT>` from
          // MosaicTileset2D.getTileIndices, which structurally extends
          // ItemT.
          const item = tile.index as unknown as ItemT;
          onSourceLoad(item, { source: tile.content?.source });
        },
      }),
      ...(onSourceError && {
        onTileError: (error, tile) => {
          if (!tile) {
            return;
          }
          const item = tile.index as unknown as ItemT;
          onSourceError(item, { error });
        },
      }),
      ...(onSourceUnload && {
        onTileUnload: (tile) => {
          const item = tile.index as unknown as ItemT;
          onSourceUnload(item, { source: tile.content?.source });
        },
      }),
      ...(onViewportLoad && {
        onViewportLoad: (tiles) => {
          onViewportLoad(
            tiles.map((tile) => ({
              item: tile.index as unknown as ItemT,
              source: tile.content?.source,
            })),
          );
        },
      }),
    });
  }

  override renderLayers(): Layer | null | LayersList {
    // Note: we deliberately render the inner TileLayer even when there are no
    // items so the same Tileset2D instance lives across empty -> non-empty
    // transitions and picks up later updates without recreation.
    return this.renderTileLayer(this.props.renderSource);
  }
}

/**
 * The items in a layer's `data`, which deck.gl has already loaded when it was
 * a URL or a promise.
 */
function toItems<ItemT>(data: unknown): ItemT[] {
  if (data == null) {
    return [];
  }
  return Array.isArray(data) ? data : Array.from(data as Iterable<ItemT>);
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
