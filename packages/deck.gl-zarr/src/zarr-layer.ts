import type { CompositeLayerProps, UpdateParameters } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type {
  RasterModule,
  TileMatrixSet,
} from "@developmentseed/deck.gl-raster";

/**
 * Minimum interface that **must** be returned from getTileData.
 */
export type MinimalDataT = {};

export type DefaultDataT = MinimalDataT & {};

export interface ZarrLayerProps<DataT extends MinimalDataT = DefaultDataT>
  extends CompositeLayerProps {
  /**
   * Zarr dataset input.
   */
  zarr: string;

  /**
   * Maximum reprojection error in pixels for mesh refinement.
   * Lower values create denser meshes with higher accuracy.
   * @default 0.125
   */
  maxError?: number;

  /**
   * User-defined method to load data for a tile.
   *
   * The default implementation loads an RGBA image using geotiff.js's readRGB
   * method, returning an ImageData object.
   *
   * For more customizability, you can also return a Texture object from
   * luma.gl, along with optional custom shaders for the RasterLayer.
   */
  getTileData?: (zarrMetadata: any, options: any) => Promise<DataT>;

  /**
   * User-defined method to render data for a tile.
   *
   * This receives the data returned by getTileData and must return a render
   * pipeline.
   *
   * The default implementation returns an object with a `texture` property,
   * assuming that this texture is already renderable.
   */
  renderTile: (data: DataT) => ImageData | RasterModule[];

  /**
   * Enable debug visualization showing the triangulation mesh
   * @default false
   */
  debug?: boolean;

  /**
   * Opacity of the debug mesh overlay (0-1)
   * @default 0.5
   */
  debugOpacity?: number;
}

const defaultProps: Partial<ZarrLayerProps> = {
  debug: false,
  debugOpacity: 0.5,
};

export class ZarrLayer<
  DataT extends MinimalDataT = DefaultDataT,
> extends CompositeLayer<ZarrLayerProps<DataT>> {
  static override layerName = "ZarrLayer";
  static override defaultProps = defaultProps;

  declare state: {
    metadata?: TileMatrixSet;
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps, changeFlags } = params;

    const needsUpdate =
      Boolean(changeFlags.dataChanged) || props.zarr !== oldProps.zarr;

    if (needsUpdate) {
      this._parseZarr();
    }
  }

  async _parseZarr(): Promise<void> {
    // TODO: given zarr input in props.zarr, parse metadata and set up layer.
    const metadata: TileMatrixSet = {};
    this.setState({ metadata });
  }
}
