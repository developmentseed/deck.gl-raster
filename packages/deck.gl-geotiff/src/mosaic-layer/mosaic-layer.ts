import type { CompositeLayerProps, Layer, LayersList } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type { TileLayerProps } from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type { MosaicSource } from "./mosaic-tileset-2d";
import { MosaicTileset2D } from "./mosaic-tileset-2d";

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
    /** List of mosaic sources to render */
    sources: MosaicT[];

    /** Fetch data for this source. */
    getSource?: (
      source: MosaicT,
      opts: { signal?: AbortSignal },
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
    mosaicSources: MosaicT[],
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

    class MosaicTileset2DFactory extends MosaicTileset2D<MosaicT> {
      constructor(opts: any) {
        super(mosaicSources, opts);
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
      maxCacheByteSize,
      maxCacheSize,
      maxRequests,
      getTileData: async (data) => {
        // We hard-cast this because TilesetClass is not generic.
        // TilesetClass returns MosaicT in `index`, but the known type is only
        // `TileIndex`, which only defines x,y,z
        const index = data.index as MosaicT;
        const { signal } = data;
        const userData =
          this.props.getSource &&
          (await this.props.getSource(index, { signal }));

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

    if (!sources || sources.length === 0) {
      return null;
    }

    return this.renderTileLayer(sources, renderSource);
  }
}
