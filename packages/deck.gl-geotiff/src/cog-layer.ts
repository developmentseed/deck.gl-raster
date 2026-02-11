import type {
  CompositeLayerProps,
  Layer,
  LayersList,
  UpdateParameters,
} from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { PathLayer } from "@deck.gl/layers";
import type { RasterModule } from "@developmentseed/deck.gl-raster";
import { RasterLayer, TMSTileset2D } from "@developmentseed/deck.gl-raster";
import type { TileMatrix, TileMatrixSet } from "@developmentseed/morecantile";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { Device } from "@luma.gl/core";
import type { BaseClient, GeoTIFF, GeoTIFFImage, Pool } from "geotiff";
import proj4 from "proj4";
import { parseCOGTileMatrixSet } from "./cog-tile-matrix-set.js";
import {
  defaultPool,
  fetchGeoTIFF,
  getGeographicBounds,
} from "./geotiff/geotiff.js";
import type { TextureDataT } from "./geotiff/render-pipeline.js";
import { inferRenderPipeline } from "./geotiff/render-pipeline.js";
import { fromGeoTransform } from "./geotiff-reprojection.js";
import type { GeoKeysParser, ProjectionInfo } from "./proj.js";
import { epsgIoGeoKeyParser } from "./proj.js";

/**
 * Minimum interface that **must** be returned from getTileData.
 */
export type MinimalDataT = {
  height: number;
  width: number;
};

export type DefaultDataT = MinimalDataT & {
  texture: ImageData;
};

/** Options passed to `getTileData`. */
export type GetTileDataOptions = {
  /** The luma.gl Device */
  device: Device;

  /** the subset to read data from in pixels. */
  window?: [number, number, number, number];

  /** An AbortSignal that may be signalled if the request is to be aborted */
  signal?: AbortSignal;

  /** The decoder pool to use. */
  pool: Pool;
};

type GetTileDataResult<DataT> = {
  data: DataT;
  forwardTransform: ReprojectionFns["forwardTransform"];
  inverseTransform: ReprojectionFns["inverseTransform"];
};

export interface COGLayerProps<DataT extends MinimalDataT = DefaultDataT>
  extends CompositeLayerProps {
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
   * User-defined method to load data for a tile.
   *
   * The default implementation loads an RGBA image using geotiff.js's readRGB
   * method, returning an ImageData object.
   *
   * For more customizability, you can also return a Texture object from
   * luma.gl, along with optional custom shaders for the RasterLayer.
   */
  getTileData?: (
    image: GeoTIFFImage,
    options: GetTileDataOptions,
  ) => Promise<DataT>;

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

  /** A user-provided AbortSignal to cancel loading.
   *
   * This can be useful in combination with the MosaicLayer, so that when a
   * mosaic source is out of the viewport, all of its tile requests are
   * automatically aborted.
   */
  signal?: AbortSignal;
}

const defaultProps: Partial<COGLayerProps> = {
  geoKeysParser: epsgIoGeoKeyParser,
  debug: false,
  debugOpacity: 0.5,
};

/**
 * COGLayer renders a COG using a tiled approach with reprojection.
 */
export class COGLayer<
  DataT extends MinimalDataT = DefaultDataT,
> extends CompositeLayer<COGLayerProps<DataT>> {
  static override layerName = "COGLayer";
  static override defaultProps = defaultProps;

  declare state: {
    forwardReproject?: ReprojectionFns["forwardReproject"];
    inverseReproject?: ReprojectionFns["inverseReproject"];
    metadata?: TileMatrixSet;
    images?: GeoTIFFImage[];
    defaultGetTileData?: COGLayerProps<TextureDataT>["getTileData"];
    defaultRenderTile?: COGLayerProps<TextureDataT>["renderTile"];
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

    const converter = proj4(sourceProjection.def, "EPSG:4326");
    const forwardReproject = (x: number, y: number) =>
      converter.forward<[number, number]>([x, y], false);
    const inverseReproject = (x: number, y: number) =>
      converter.inverse<[number, number]>([x, y], false);

    if (this.props.onGeoTIFFLoad) {
      const geographicBounds = getGeographicBounds(image, converter);
      this.props.onGeoTIFFLoad(geotiff, {
        projection: sourceProjection,
        geographicBounds,
      });
    }

    const { getTileData: defaultGetTileData, renderTile: defaultRenderTile } =
      inferRenderPipeline(image.fileDirectory, this.context.device);

    this.setState({
      metadata,
      forwardReproject,
      inverseReproject,
      images,
      defaultGetTileData,
      defaultRenderTile,
    });
  }

  /**
   * Inner callback passed in to the underlying TileLayer's `getTileData`.
   */
  async _getTileData(
    tile: TileLoadProps,
    images: GeoTIFFImage[],
    metadata: TileMatrixSet,
  ): Promise<GetTileDataResult<DataT>> {
    const { signal } = tile;
    const { x, y, z } = tile.index;

    // Select overview image
    const geotiffImage = images[images.length - 1 - z]!;
    const imageHeight = geotiffImage.getHeight();
    const imageWidth = geotiffImage.getWidth();

    const tileMatrix = metadata.tileMatrices[z]!;
    const { tileWidth, tileHeight } = tileMatrix;

    const tileGeotransform = computeTileGeotransform(x, y, tileMatrix);
    const { forwardTransform, inverseTransform } =
      fromGeoTransform(tileGeotransform);

    const window: [number, number, number, number] = [
      x * tileWidth,
      y * tileHeight,
      Math.min((x + 1) * tileWidth, imageWidth),
      Math.min((y + 1) * tileHeight, imageHeight),
    ];

    const getTileData =
      this.props.getTileData || this.state.defaultGetTileData!;

    // Combine abort signals if both are defined
    const combinedSignal =
      signal && this.props.signal
        ? AbortSignal.any([signal, this.props.signal])
        : signal || this.props.signal;

    const data = await getTileData(geotiffImage, {
      device: this.context.device,
      window,
      signal: combinedSignal,
      pool: this.props.pool || defaultPool(),
    });

    return {
      // @ts-expect-error type mismatch when using provided getTileData
      data,
      forwardTransform,
      inverseTransform,
    };
  }

  _renderSubLayers(
    // TODO: it would be nice to have a cleaner type here
    // this is copy-pasted from the upstream tile layer definition for props.
    props: TileLayerProps<GetTileDataResult<DataT>> & {
      id: string;
      data?: GetTileDataResult<DataT>;
      _offset: number;
      tile: Tile2DHeader<GetTileDataResult<DataT>>;
    },
    metadata: TileMatrixSet,
    forwardReproject: ReprojectionFns["forwardReproject"],
    inverseReproject: ReprojectionFns["inverseReproject"],
  ): Layer | LayersList | null {
    const { maxError, debug, debugOpacity } = this.props;
    const { tile } = props;

    if (!props.data) {
      return null;
    }

    const { data, forwardTransform, inverseTransform } = props.data;

    const layers: Layer[] = [];

    if (data) {
      const { height, width } = data;
      const renderTile = this.props.renderTile || this.state.defaultRenderTile!;

      layers.push(
        new RasterLayer({
          id: `${props.id}-raster`,
          width,
          height,
          renderPipeline: renderTile(data),
          maxError,
          reprojectionFns: {
            forwardTransform,
            inverseTransform,
            forwardReproject,
            inverseReproject,
          },
          debug,
          debugOpacity,
        }),
      );
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
      const { topLeft, topRight, bottomLeft, bottomRight } = projectedBounds;

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
          id: `${this.id}-${tile.id}-bounds`,
          data: [path],
          getPath: (d) => d,
          getColor: [255, 0, 0, 255], // Red
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
        }),
      );
    }

    return layers;
  }

  renderTileLayer(
    metadata: TileMatrixSet,
    forwardReproject: ReprojectionFns["forwardReproject"],
    inverseReproject: ReprojectionFns["inverseReproject"],
    images: GeoTIFFImage[],
  ): TileLayer {
    // Create a factory class that wraps COGTileset2D with the metadata
    class TMSTileset2DFactory extends TMSTileset2D {
      constructor(opts: Tileset2DProps) {
        super(metadata, opts);
      }
    }

    return new TileLayer<GetTileDataResult<DataT>>({
      id: `cog-tile-layer-${this.id}`,
      TilesetClass: TMSTileset2DFactory,
      getTileData: async (tile) => this._getTileData(tile, images, metadata),
      renderSubLayers: (props) =>
        this._renderSubLayers(
          props,
          metadata,
          forwardReproject,
          inverseReproject,
        ),
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
