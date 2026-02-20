import type { CompositeLayerProps, UpdateParameters } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import type { GeoTIFF } from "@developmentseed/geotiff";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import proj4 from "proj4";
import type { ProjectionDefinition } from "wkt-parser";
import wktParser from "wkt-parser";
import { fetchGeoTIFF, getGeographicBounds } from "./geotiff/geotiff.js";
import { extractGeotiffReprojectors } from "./geotiff-reprojection.js";
import type { EpsgResolver } from "./proj.js";
import { epsgResolver } from "./proj.js";

export interface GeoTIFFLayerProps extends CompositeLayerProps {
  /**
   * GeoTIFF input.
   *
   * - {@link URL} or `string` pointing to a GeoTIFF
   * - {@link ArrayBuffer} containing the GeoTIFF data
   * - An instance of the {@link GeoTIFF} class.
   */
  geotiff: GeoTIFF | string | URL | ArrayBuffer;

  /**
   * A function callback for parsing numeric EPSG codes to projection
   * information (as returned by `wkt-parser`).
   *
   * The default implementation:
   * - makes a request to epsg.io to resolve EPSG codes found in the GeoTIFF.
   * - caches any previous requests
   * - parses PROJJSON response with `wkt-parser`
   */
  epsgResolver?: EpsgResolver;

  /**
   * GeoTIFF.js Pool for decoding image chunks.
   *
   * If none is provided, a default Pool will be created and shared between all
   * COGLayer and GeoTIFFLayer instances.
   */
  // TODO: Restore a sort of worker pool with our geotiff implementation
  // pool?: Pool;

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
   */
  onGeoTIFFLoad?: (
    geotiff: GeoTIFF,
    options: {
      projection: ProjectionDefinition;
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
  epsgResolver,
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
    const crs = geotiff.crs;
    const sourceProjection =
      typeof crs === "number"
        ? await this.props.epsgResolver!(crs)
        : wktParser(crs);

    // @ts-expect-error proj4 has incomplete types that don't support wkt-parser
    // output
    const converter = proj4(sourceProjection, "EPSG:4326");

    if (this.props.onGeoTIFFLoad) {
      const geographicBounds = getGeographicBounds(geotiff, converter);
      this.props.onGeoTIFFLoad(geotiff, {
        projection: sourceProjection,
        geographicBounds,
      });
    }

    // @ts-expect-error unused variable
    // biome-ignore lint/correctness/noUnusedVariables: not implemented
    const reprojectionFns = await extractGeotiffReprojectors(
      geotiff,
      sourceProjection,
    );

    // Our GeoTIFF implementation doesn't currently support reading the full
    // image; it only supports reading tiles.
    throw new Error("Loading GeoTIFF image data not yet implemented");
    // const { texture, height, width } = await loadRgbImage(image);

    // this.setState({
    //   reprojectionFns,
    //   imageData: texture,
    //   height,
    //   width,
    // });
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
