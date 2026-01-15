import type { CompositeLayerProps, Layer, LayersList } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type { TileLayerProps } from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type { MosaicSource } from "./mosaic-tileset-2d";
import { MosaicTileset2D } from "./mosaic-tileset-2d";

export type MosaicLayerProps<MosaicT extends MosaicSource = MosaicSource> =
  CompositeLayerProps &
    Pick<TileLayerProps, "extent" | "minZoom" | "maxZoom"> & {
      /** List of mosaic sources to render */
      sources: MosaicT[];

      /** Render a source */
      renderSource: (
        source: MosaicT,
        opts: { signal?: AbortSignal },
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
> extends CompositeLayer<MosaicLayerProps<MosaicT>> {
  static override layerName = "MosaicLayer";
  static override defaultProps = defaultProps;

  renderTileLayer(
    mosaicSources: MosaicT[],
    renderSource: MosaicLayerProps<MosaicT>["renderSource"],
  ): TileLayer {
    class MosaicTileset2DFactory extends MosaicTileset2D<MosaicT> {
      constructor(opts: any) {
        super(mosaicSources, opts);
      }
    }

    return new TileLayer<{ source: MosaicT; signal?: AbortSignal }>({
      id: "mosaic-layer",
      TilesetClass: MosaicTileset2DFactory,
      // @ts-expect-error This errors because TilesetClass is not generic.
      // TilesetClass returns MosaicT in `index`, but the known type is only
      // `TileIndex`, which only defines x,y,z
      getTileData: (data) => {
        const { index, signal } = data;
        return {
          source: index,
          signal,
        };
      },
      renderSubLayers: (props) => {
        const { data } = props;
        const { source, signal } = data;
        return renderSource(source, { signal });
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
