import type {
  CompositeLayerProps,
  Layer,
  UpdateParameters,
} from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { PathLayer } from "@deck.gl/layers";
import {
  RasterLayer,
  RasterTileset2D,
  TileMatrixSet,
} from "@developmentseed/deck.gl-raster";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { GeoTIFF } from "geotiff";
import proj4 from "proj4";
import { parseCOGTileMatrixSet } from "./cog-tile-matrix-set.js";
import {
  fromGeoTransform,
  getGeoTIFFProjection,
} from "./geotiff-reprojection.js";
import { loadRgbImage } from "./geotiff.js";

// Workaround until upstream exposes props
// https://github.com/visgl/deck.gl/pull/9917
type Tileset2DProps = any;

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
 * COGLayer renders a COG using a tiled approach with reprojection.
 */
export class COGLayer extends CompositeLayer<COGLayerProps> {
  static override layerName = "COGLayer";
  static override defaultProps = defaultProps;

  declare state: {
    forwardReproject?: ReprojectionFns["forwardReproject"];
    inverseReproject?: ReprojectionFns["inverseReproject"];
    metadata?: TileMatrixSet;
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
    const { geotiff } = this.props;

    const metadata = await parseCOGTileMatrixSet(geotiff);

    const image = await geotiff.getImage();
    const sourceProjection = await getGeoTIFFProjection(image);
    if (!sourceProjection) {
      throw new Error(
        "Could not determine source projection from GeoTIFF geo keys",
      );
    }

    const converter = proj4(sourceProjection, "EPSG:4326");
    const forwardReproject = (x: number, y: number) =>
      converter.forward<[number, number]>([x, y], false);
    const inverseReproject = (x: number, y: number) =>
      converter.inverse<[number, number]>([x, y], false);

    this.setState({
      metadata,
      forwardReproject,
      inverseReproject,
    });
  }

  renderTileLayer(
    metadata: TileMatrixSet,
    forwardReproject: ReprojectionFns["forwardReproject"],
    inverseReproject: ReprojectionFns["inverseReproject"],
  ): TileLayer {
    const { geotiff, maxError, debug = false, debugOpacity = 0.5 } = this.props;

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
        image: ImageData;
        height: number;
        width: number;
        pixelToInputCRS: ReprojectionFns["pixelToInputCRS"];
        inputCRSToPixel: ReprojectionFns["inputCRSToPixel"];
      }> => {
        const { x, y, z } = tile.index;
        const imageCount = await geotiff.getImageCount();
        // Select overview image
        const geotiffImage = await geotiff.getImage(imageCount - 1 - z);

        const tileMatrix = metadata.tileMatrices[z]!;
        const { tileWidth, tileHeight } = tileMatrix;

        const xPixelOrigin = x * tileWidth;
        const yPixelOrigin = y * tileHeight;

        const [a, b, c, d, e, f] = tileMatrix.geotransform;

        // Affine geotransform for this tile

        const xCoordOffset = a * xPixelOrigin + b * yPixelOrigin + c;
        const yCoordOffset = d * xPixelOrigin + e * yPixelOrigin + f;

        const tileGeotransform: [
          number,
          number,
          number,
          number,
          number,
          number,
        ] = [a, b, xCoordOffset, d, e, yCoordOffset];
        const { pixelToInputCRS, inputCRSToPixel } =
          fromGeoTransform(tileGeotransform);

        const window: [number, number, number, number] = [
          x * tileWidth,
          y * tileHeight,
          (x + 1) * tileWidth,
          (y + 1) * tileHeight,
        ];

        const { imageData, height, width } = await loadRgbImage(geotiffImage, {
          window,
        });

        return {
          image: imageData,
          height,
          width,
          pixelToInputCRS,
          inputCRSToPixel,
        };
      },
      renderSubLayers: (props) => {
        const { tile, data } = props;

        const layers: Layer[] = [];

        if (data) {
          const {
            image,
            height,
            width,
            pixelToInputCRS,
            inputCRSToPixel,
          }: {
            image: ImageData;
            height: number;
            width: number;
            pixelToInputCRS: ReprojectionFns["pixelToInputCRS"];
            inputCRSToPixel: ReprojectionFns["inputCRSToPixel"];
          } = data;

          const rasterLayer = new RasterLayer({
            id: `${props.id}-raster`,
            width,
            height,
            texture: image,
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
    const { forwardReproject, inverseReproject, metadata } = this.state;

    if (!forwardReproject || !inverseReproject || !metadata) {
      return null;
    }

    // Split into a separate method to make TS happy, because when metadata is
    // nullable in any part of function scope, the tileset factory wrapper gives
    // a type error
    return this.renderTileLayer(metadata, forwardReproject, inverseReproject);
  }
}
