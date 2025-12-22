import type { CompositeLayerProps, UpdateParameters } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { GeoTIFF, Pool } from "geotiff";
import { extractGeotiffReprojectors } from "./geotiff-reprojection.js";
import { defaultPool, loadRgbImage } from "./geotiff.js";
import type { GeoKeysParser } from "./proj.js";
import { epsgIoGeoKeyParser } from "./proj.js";

const DEFAULT_MAX_ERROR = 0.125;

export interface GeoTIFFLayerProps extends CompositeLayerProps {
  geotiff: GeoTIFF;

  /**
   * A function callback for parsing GeoTIFF geo keys to a Proj4 compatible
   * definition.
   *
   * By default, uses epsg.io to resolve EPSG codes found in the GeoTIFF.
   * Alternatively, you may want to use `geotiff-geokeys-to-proj4`, which is
   * more extensive but adds 1.5MB to your bundle size.
   */
  geoKeysParser?: GeoKeysParser;

  /**
   * GeoTIFF.js Pool for decoding image chunks.
   *
   * If none is provided, a default Pool will be created and shared between all
   * COGLayer and GeoTIFFLayer instances.
   */
  pool?: Pool;

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
  geoKeysParser: epsgIoGeoKeyParser,
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
    imageData?: ImageData;
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

    const reprojectionFns = await extractGeotiffReprojectors(
      geotiff,
      this.props.geoKeysParser!,
    );
    const image = await geotiff.getImage();
    const { imageData, height, width } = await loadRgbImage(image, {
      pool: this.props.pool || defaultPool(),
    });

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
