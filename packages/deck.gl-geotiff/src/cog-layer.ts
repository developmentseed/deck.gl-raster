import type {
  CompositeLayerProps,
  Layer,
  UpdateParameters,
} from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { PathLayer } from "@deck.gl/layers";
import type {
  RasterLayerProps,
  TileMatrix,
  TileMatrixSet,
} from "@developmentseed/deck.gl-raster";
import { RasterLayer, RasterTileset2D } from "@developmentseed/deck.gl-raster";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { Device, Texture } from "@luma.gl/core";
import type { BaseClient, GeoTIFF, GeoTIFFImage, Pool } from "geotiff";
import proj4 from "proj4";
import { parseCOGTileMatrixSet } from "./cog-tile-matrix-set.js";
import { fromGeoTransform } from "./geotiff-reprojection.js";
import { defaultPool, fetchGeoTIFF, loadRgbImage } from "./geotiff.js";
import type { GeoKeysParser, ProjectionInfo } from "./proj.js";
import { epsgIoGeoKeyParser } from "./proj.js";

// Workaround until upstream exposes props
// https://github.com/visgl/deck.gl/pull/9917
type Tileset2DProps = any;

const DEFAULT_MAX_ERROR = 0.125;

export interface COGLayerProps extends CompositeLayerProps {
  /**
   * GeoTIFF input.
   *
   * - URL string pointing to a COG
   * - ArrayBuffer containing the COG data
   * - Blob containing the COG data
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
   * User-defined method to load texture.
   *
   * The default implementation loads an RGBA image using geotiff.js's readRGB
   * method, returning an ImageData object.
   *
   * For more customizability, you can also return a Texture object from
   * luma.gl, along with optional custom shaders for the RasterLayer.
   */
  loadTexture?: (
    image: GeoTIFFImage,
    options: {
      device: Device;
      window: [number, number, number, number];
      signal?: AbortSignal;
      pool: Pool;
    },
  ) => Promise<{
    texture: ImageData | Texture;
    shaders?: RasterLayerProps["shaders"];
    height: number;
    width: number;
  }>;

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
  onGeoTIFFLoad?: (geotiff: GeoTIFF, projection: ProjectionInfo) => void;
}

const defaultProps: Partial<COGLayerProps> = {
  maxError: DEFAULT_MAX_ERROR,
  geoKeysParser: epsgIoGeoKeyParser,
  loadTexture: loadRgbImage,
};

/**
 * COGLayer renders a COG using a tiled approach with reprojection.
 */
export class COGLayer extends CompositeLayer<COGLayerProps> {
  static override layerName = "COGLayer";
  static override defaultProps = defaultProps;

  declare state: {
    forwardReproject?: ReprojectionFns["forwardReproject"];
    inverseReproject?: ReprojectionFns["inverseReproject"];
    metadata?: TileMatrixSet;
    images?: GeoTIFFImage[];
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps, changeFlags } = params;

    const needsUpdate =
      Boolean(changeFlags.dataChanged) || props.geotiff !== oldProps.geotiff;

    if (needsUpdate) {
      this._parseGeoTIFF();
    }
  }

  async _parseGeoTIFF(): Promise<void> {
    const geotiff = await fetchGeoTIFF(this.props.geotiff);

    const geoKeysParser = this.props.geoKeysParser!;
    const metadata = await parseCOGTileMatrixSet(geotiff, geoKeysParser);

    const image = await geotiff.getImage();
    const imageCount = await geotiff.getImageCount();
    const images: GeoTIFFImage[] = [];
    for (let imageIdx = 0; imageIdx < imageCount; imageIdx++) {
      images.push(await geotiff.getImage(imageIdx));
    }

    const sourceProjection = await geoKeysParser(image.getGeoKeys());
    if (!sourceProjection) {
      throw new Error(
        "Could not determine source projection from GeoTIFF geo keys",
      );
    }

    this.props.onGeoTIFFLoad?.(geotiff, sourceProjection);

    const converter = proj4(sourceProjection.def, "EPSG:4326");
    const forwardReproject = (x: number, y: number) =>
      converter.forward<[number, number]>([x, y], false);
    const inverseReproject = (x: number, y: number) =>
      converter.inverse<[number, number]>([x, y], false);

    this.setState({
      metadata,
      forwardReproject,
      inverseReproject,
      images,
    });
  }

  renderTileLayer(
    metadata: TileMatrixSet,
    forwardReproject: ReprojectionFns["forwardReproject"],
    inverseReproject: ReprojectionFns["inverseReproject"],
    images: GeoTIFFImage[],
  ): TileLayer {
    const { maxError, debug = false, debugOpacity = 0.5 } = this.props;

    // Create a factory class that wraps COGTileset2D with the metadata
    class RasterTileset2DFactory extends RasterTileset2D {
      constructor(opts: Tileset2DProps) {
        super(metadata, opts);
      }
    }

    return new TileLayer({
      id: `cog-tile-layer-${this.id}`,
      TilesetClass: RasterTileset2DFactory,
      getTileData: async (
        tile,
      ): Promise<{
        texture: ImageData | Texture;
        shaders?: RasterLayerProps["shaders"];
        height: number;
        width: number;
        pixelToInputCRS: ReprojectionFns["pixelToInputCRS"];
        inputCRSToPixel: ReprojectionFns["inputCRSToPixel"];
      }> => {
        const { signal } = tile;
        const { x, y, z } = tile.index;

        // Select overview image
        const geotiffImage = images[images.length - 1 - z]!;
        const imageHeight = geotiffImage.getHeight();
        const imageWidth = geotiffImage.getWidth();

        const tileMatrix = metadata.tileMatrices[z]!;
        const { tileWidth, tileHeight } = tileMatrix;

        const tileGeotransform = computeTileGeotransform(x, y, tileMatrix);
        const { pixelToInputCRS, inputCRSToPixel } =
          fromGeoTransform(tileGeotransform);

        const window: [number, number, number, number] = [
          x * tileWidth,
          y * tileHeight,
          Math.min((x + 1) * tileWidth, imageWidth),
          Math.min((y + 1) * tileHeight, imageHeight),
        ];

        const { texture, height, width, shaders } = await this.props
          .loadTexture!(geotiffImage, {
          device: this.context.device,
          window,
          signal,
          pool: this.props.pool || defaultPool(),
        });

        return {
          texture,
          height,
          width,
          shaders,
          pixelToInputCRS,
          inputCRSToPixel,
        };
      },
      renderSubLayers: (props) => {
        const { tile, data } = props;

        const layers: Layer[] = [];

        if (data) {
          const {
            texture,
            shaders,
            height,
            width,
            pixelToInputCRS,
            inputCRSToPixel,
          }: {
            texture: ImageData | Texture;
            shaders?: RasterLayerProps["shaders"];
            height: number;
            width: number;
            pixelToInputCRS: ReprojectionFns["pixelToInputCRS"];
            inputCRSToPixel: ReprojectionFns["inputCRSToPixel"];
          } = data;

          const rasterLayer = new RasterLayer({
            id: `${props.id}-raster`,
            width,
            height,
            texture,
            shaders,
            maxError,
            reprojectionFns: {
              pixelToInputCRS,
              inputCRSToPixel,
              forwardReproject,
              inverseReproject,
            },
            debug,
            debugOpacity,
          });
          layers.push(rasterLayer);
        }

        if (debug) {
          // Get projected bounds from tile data
          // getTileMetadata returns data that includes projectedBounds
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const projectedBounds = (tile as any)?.projectedBounds;

          if (!projectedBounds || !metadata) {
            return [];
          }

          // Project bounds from image CRS to WGS84
          const { topLeft, topRight, bottomLeft, bottomRight } =
            projectedBounds;

          const topLeftWgs84 = metadata.projectToWgs84(topLeft);
          const topRightWgs84 = metadata.projectToWgs84(topRight);
          const bottomRightWgs84 = metadata.projectToWgs84(bottomRight);
          const bottomLeftWgs84 = metadata.projectToWgs84(bottomLeft);

          // Create a closed path around the tile bounds
          const path = [
            topLeftWgs84,
            topRightWgs84,
            bottomRightWgs84,
            bottomLeftWgs84,
            topLeftWgs84, // Close the path
          ];

          layers.push(
            new PathLayer({
              id: `${tile.id}-bounds`,
              data: [{ path }],
              getPath: (d) => d.path,
              getColor: [255, 0, 0, 255], // Red
              getWidth: 2,
              widthUnits: "pixels",
              pickable: false,
            }),
          );
        }

        return layers;
      },
    });
  }

  renderLayers() {
    const { forwardReproject, inverseReproject, metadata, images } = this.state;

    if (!forwardReproject || !inverseReproject || !metadata || !images) {
      return null;
    }

    // Split into a separate method to make TS happy, because when metadata is
    // nullable in any part of function scope, the tileset factory wrapper gives
    // a type error
    return this.renderTileLayer(
      metadata,
      forwardReproject,
      inverseReproject,
      images,
    );
  }
}

/**
 * Compute the affine geotransform for this tile.
 *
 * We need to offset the geotransform for the matrix level by the tile's pixel
 * origin.
 */
function computeTileGeotransform(
  x: number,
  y: number,
  tileMatrix: TileMatrix,
): [number, number, number, number, number, number] {
  const { tileWidth, tileHeight } = tileMatrix;

  const xPixelOrigin = x * tileWidth;
  const yPixelOrigin = y * tileHeight;

  const [a, b, c, d, e, f] = tileMatrix.geotransform;

  const xCoordOffset = a * xPixelOrigin + b * yPixelOrigin + c;
  const yCoordOffset = d * xPixelOrigin + e * yPixelOrigin + f;

  return [a, b, xCoordOffset, d, e, yCoordOffset];
}
