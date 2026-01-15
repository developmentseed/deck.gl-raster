import type { CompositeLayerProps, Layer, LayersList } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type { _TileLoadProps as TileLoadProps } from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type { MosaicSource } from "./mosaic-tileset-2d";
import { MosaicTileset2D } from "./mosaic-tileset-2d";

export interface MosaicLayerProps<MosaicT extends MosaicSource = MosaicSource>
  extends CompositeLayerProps {
  sources: MosaicT[];

  /** Render a source */
  renderSource: (
    source: MosaicT,
    opts: { signal: AbortSignal },
  ) => Layer | LayersList | null;
}

const defaultProps: Partial<MosaicLayerProps> = {};

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

    return new TileLayer({
      id: "mosaic-layer",
      TilesetClass: MosaicTileset2DFactory,
      getTileData: (data: TileLoadProps) => {
        const { index, signal } = data;
        return {
          source: index,
          signal,
        };
      },
      renderSubLayers: (props) => {
        console.log("MosaicLayer renderSubLayers props:", props);
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
