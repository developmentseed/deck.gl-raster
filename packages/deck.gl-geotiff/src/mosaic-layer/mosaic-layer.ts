import type { CompositeLayerProps, Layer, LayersList } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type { TileLayerProps } from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type { Priority } from "@developmentseed/geotiff";
import type { MosaicSource } from "./mosaic-tileset-2d.js";
import { MosaicTileset2D } from "./mosaic-tileset-2d.js";

export type MosaicLayerProps<
  MosaicT extends MosaicSource = MosaicSource,
  DataT = any,
> = CompositeLayerProps &
  Pick<
    TileLayerProps,
    | "extent"
    | "minZoom"
    | "maxZoom"
    | "maxCacheByteSize"
    | "maxCacheSize"
    | "maxRequests"
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
     * tile ID is derived from its position in this array (see `MosaicSource`'s
     * `x` / `y` / `z` for the exact derivation), so:
     *
     * - Appending items preserves all existing rendered tiles.
     * - Reordering or removing items from the middle of the array invalidates
     *   the cache slots of shifted items, causing them to re-fetch.
     *
     * Supply explicit `x`, `y`, and `z` identifiers per source if you need
     * cache stability across arbitrary mutations of `sources`.
     */
    sources: MosaicT[];

    /** Fetch data for this source. */
    getSource?: (
      source: MosaicT,
      opts: {
        signal?: AbortSignal;
        /**
         * Dynamic priority for fetches related to this source. Re-invoked by
         * the limiter on every slot-open, so the queue re-sorts on viewport
         * pan. Computed from the source's `bbox` center and the layer's
         * current viewport: closer to viewport center ⇒ lower number ⇒
         * serviced sooner. Threaded into {@link fetchGeoTIFF} /
         * `GeoTIFF.fromUrl` to bias center-of-screen rendering ahead of
         * edges; passing it on is otherwise optional.
         */
        getPriority: () => Priority;
      },
    ) => Promise<DataT>;

    /** Render a source */
    renderSource: (
      source: MosaicT,
      opts: {
        data?: DataT;
        signal?: AbortSignal;
      },
    ) => Layer | LayersList | null;
  };

const defaultProps: Partial<MosaicLayerProps> = {};

/**
 * A deck.gl layer for rendering a mosaic of raster sources.
 *
 * The `renderSource` prop is called whenever a source is present in the current
 * viewport.
 */
export class MosaicLayer<
  MosaicT extends MosaicSource = MosaicSource,
  DataT = any,
> extends CompositeLayer<MosaicLayerProps<MosaicT, DataT>> {
  static override layerName = "MosaicLayer";
  static override defaultProps = defaultProps;

  renderTileLayer(
    renderSource: MosaicLayerProps<MosaicT, DataT>["renderSource"],
  ): TileLayer {
    const {
      id,
      minZoom,
      maxZoom,
      extent,
      maxCacheByteSize,
      maxCacheSize,
      maxRequests,
    } = this.props;

    // The arrow function is defined here so its lexical `this` is the
    // MosaicLayer instance (which deck.gl reuses across prop updates),
    // ensuring `this.props.sources` returns the latest array on every call.
    const getSources = () => this.props.sources;
    class MosaicTileset2DFactory extends MosaicTileset2D<MosaicT> {
      constructor(opts: any) {
        super(getSources, opts);
      }
    }

    return new TileLayer<{
      source: MosaicT;
      data?: DataT;
      signal?: AbortSignal;
    }>({
      id: `mosaic-layer-${id}`,
      TilesetClass: MosaicTileset2DFactory,
      minZoom,
      maxZoom,
      extent,
      ...(maxCacheByteSize !== undefined && { maxCacheByteSize }),
      maxCacheSize,
      maxRequests,
      getTileData: async (data) => {
        // We hard-cast this because TilesetClass is not generic.
        // TilesetClass returns MosaicT in `index`, but the known type is only
        // `TileIndex`, which only defines x,y,z
        const index = data.index as MosaicT;
        const { signal } = data;
        // Dynamic priority for the limiter: euclidean distance from this
        // source's bbox center to the layer's current viewport center, in
        // degree-space (just used as an ordering key; great-circle isn't
        // needed). Re-evaluated on every limiter slot-open, so panning the
        // viewport re-sorts the queue and pulls newly-central sources to the
        // front of the line ahead of older edge sources.
        const [minX, minY, maxX, maxY] = index.bbox;
        const sourceCx = (minX + maxX) / 2;
        const sourceCy = (minY + maxY) / 2;
        const getPriority = (): number => {
          const { viewport } = this.context;
          // Viewport exposes longitude/latitude for geographic viewports;
          // fall back to (0, 0) defensively if not available.
          const lon =
            "longitude" in viewport ? (viewport.longitude as number) : 0;
          const lat =
            "latitude" in viewport ? (viewport.latitude as number) : 0;
          const dx = sourceCx - lon;
          const dy = sourceCy - lat;
          return Math.hypot(dx, dy);
        };
        const userData =
          this.props.getSource &&
          (await this.props.getSource(index, { signal, getPriority }));

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
