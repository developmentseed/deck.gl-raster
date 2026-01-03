import type { CompositeLayerProps, UpdateParameters } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { BaseClient, GeoTIFF, Pool } from "geotiff";
import proj4 from "proj4";
import {
  defaultPool,
  fetchGeoTIFF,
  getGeographicBounds,
  loadRgbImage,
} from "./geotiff.js";
import { extractGeotiffReprojectors } from "./geotiff-reprojection.js";
import type { GeoKeysParser, ProjectionInfo } from "./proj.js";
import { epsgIoGeoKeyParser } from "./proj.js";

export interface GeoTIFFLayerProps extends CompositeLayerProps {
  /**
   * GeoTIFF input.
   *
   * - URL string pointing to a GeoTIFF
   * - ArrayBuffer containing the GeoTIFF data
   * - Blob containing the GeoTIFF data
   * - An instance of GeoTIFF.js's GeoTIFF class
   * - An instance of GeoTIFF.js's BaseClient for custom fetching
   */
  geotiff: GeoTIFF | string | ArrayBuffer | Blob | BaseClient;

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

  /**
   * Called when the GeoTIFF metadata has been loaded and parsed.
   *
   * @param   {GeoTIFF}  geotiff
   * @param   {ProjectionInfo}  projection
   */
  onGeoTIFFLoad?: (
    geotiff: GeoTIFF,
    options: {
      projection: ProjectionInfo;
      /**
       * Bounds of the image in geographic coordinates (WGS84) [minLon, minLat,
       * maxLon, maxLat]
       */
      geographicBounds: {
        west: number;
        south: number;
        east: number;
        north: number;
      };
    },
  ) => void;
}

const defaultProps = {
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
    const geotiff = await fetchGeoTIFF(this.props.geotiff);
    const image = await geotiff.getImage();

    const geoKeysParser = this.props.geoKeysParser!;
    const sourceProjection = await geoKeysParser(image.getGeoKeys());
    if (!sourceProjection) {
      throw new Error(
        "Could not determine source projection from GeoTIFF geo keys",
      );
    }

    const converter = proj4(sourceProjection.def, "EPSG:4326");

    if (this.props.onGeoTIFFLoad) {
      const geographicBounds = getGeographicBounds(image, converter);
      this.props.onGeoTIFFLoad(geotiff, {
        projection: sourceProjection,
        geographicBounds,
      });
    }

    const reprojectionFns = await extractGeotiffReprojectors(
      geotiff,
      sourceProjection.def,
    );
    const { texture, height, width } = await loadRgbImage(image, {
      pool: this.props.pool || defaultPool(),
    });

    this.setState({
      reprojectionFns,
      imageData: texture,
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
