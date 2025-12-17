import type { CompositeLayerProps, UpdateParameters } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { GeoTIFF } from "geotiff";
import { extractGeotiffReprojectors } from "./geotiff-reprojection.js";
import { loadRgbImage } from "./geotiff.js";

const DEFAULT_MAX_ERROR = 0.125;

export interface GeoTIFFLayerProps extends CompositeLayerProps {
  geotiff: GeoTIFF;

  /**
   * Maximum reprojection error in pixels for mesh refinement.
   * Lower values create denser meshes with higher accuracy.
   * @default 0.125
   */
  maxError?: number;

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

const defaultProps = {
  maxError: DEFAULT_MAX_ERROR,
};

/**
 * GeoTIFFLayer renders a GeoTIFF file from an arbitrary projection.
 *
 * The GeoTIFFLayer differs from the COGLayer in that it doesn't assume any
 * internal tiling. Rather, it fetches the entire full-resolution image and
 * displays it directly.
 */
export class GeoTIFFLayer extends CompositeLayer<GeoTIFFLayerProps> {
  static override layerName = "GeoTIFFLayer";
  static override defaultProps = defaultProps;

  declare state: {
    reprojectionFns?: ReprojectionFns;
    imageData: ImageData;
    height?: number;
    width?: number;
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps, changeFlags } = params;

    const needsUpdate =
      Boolean(changeFlags.dataChanged) ||
      props.geotiff !== oldProps.geotiff ||
      props.maxError !== oldProps.maxError;

    if (needsUpdate) {
      this._parseGeoTIFF();
    }
  }

  async _parseGeoTIFF(): Promise<void> {
    const { geotiff } = this.props;

    const reprojectionFns = await extractGeotiffReprojectors(geotiff);
    const { imageData, height, width } = await loadRgbImage(
      await geotiff.getImage(),
    );

    this.setState({
      reprojectionFns,
      imageData,
      height,
      width,
    });
  }

  renderLayers() {
    const { reprojectionFns, imageData, height, width } = this.state;

    if (!reprojectionFns || !imageData || !height || !width) {
      return null;
    }

    const { maxError, debug, debugOpacity } = this.props;

    return new RasterLayer(
      this.getSubLayerProps({
        id: "raster",
        width,
        height,
        reprojectionFns,
        maxError,
        texture: imageData,
        debug,
        debugOpacity,
      }),
    );
  }
}
