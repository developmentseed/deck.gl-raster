import type { CompositeLayerProps, UpdateParameters } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { GeoTIFF, GeoTIFFImage, TypedArrayWithDimensions } from "geotiff";
import { extractGeotiffReprojectors } from "./geotiff-reprojection.js";

const DEFAULT_MAX_ERROR = 0.125;

export interface COGLayerProps extends CompositeLayerProps {
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
 * COGLayer renders a GeoTIFF from an arbitrary projection.
 */
export class COGLayer extends CompositeLayer<COGLayerProps> {
  static override layerName = "COGLayer";
  static override defaultProps = defaultProps;

  declare state: {
    reprojectionFns?: ReprojectionFns;
    image: ImageData;
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
    const { image, height, width } = await loadRgbImage(
      await geotiff.getImage(),
    );

    this.setState({
      reprojectionFns,
      image,
      height,
      width,
    });
  }

  renderLayers() {
    const { reprojectionFns, image, height, width } = this.state;

    if (!reprojectionFns || !image || !height || !width) {
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
        texture: image,
        debug,
        debugOpacity,
      }),
    );
  }
}

async function loadRgbImage(
  image: GeoTIFFImage,
): Promise<{ image: ImageData; height: number; width: number }> {
  const rgbImage = (await image.readRGB()) as TypedArrayWithDimensions;

  const rgbaLength = (rgbImage.length / 3) * 4;
  const rgbaArray = new Uint8ClampedArray(rgbaLength);
  for (let i = 0; i < rgbImage.length / 3; ++i) {
    rgbaArray[i * 4] = rgbImage[i * 3]!;
    rgbaArray[i * 4 + 1] = rgbImage[i * 3 + 1]!;
    rgbaArray[i * 4 + 2] = rgbImage[i * 3 + 2]!;
    rgbaArray[i * 4 + 3] = 255;
  }
  return {
    image: new ImageData(rgbaArray, image.getWidth(), image.getHeight()),
    height: rgbImage.height,
    width: rgbImage.width,
  };
}
