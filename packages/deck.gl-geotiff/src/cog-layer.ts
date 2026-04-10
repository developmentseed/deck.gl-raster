import type {
  CompositeLayerProps,
  Layer,
  LayerProps,
  LayersList,
  UpdateParameters,
} from "@deck.gl/core";
import { COORDINATE_SYSTEM, CompositeLayer } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type {
  RenderTileResult,
  TileMetadata,
} from "@developmentseed/deck.gl-raster";
import {
  RasterLayer,
  RasterTileset2D,
  _renderDebugTileOutline as renderDebugTileOutline,
  TileMatrixSetAdaptor,
} from "@developmentseed/deck.gl-raster";
import type { DecoderPool, GeoTIFF, Overview } from "@developmentseed/geotiff";
import {
  defaultDecoderPool,
  generateTileMatrixSet,
} from "@developmentseed/geotiff";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { tileTransform } from "@developmentseed/morecantile";
import type { EpsgResolver, ProjectionDefinition } from "@developmentseed/proj";
import {
  epsgResolver,
  makeClampedForwardTo3857,
  parseWkt,
} from "@developmentseed/proj";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { Device, Texture } from "@luma.gl/core";
import proj4 from "proj4";
import { fetchGeoTIFF, getGeographicBounds } from "./geotiff/geotiff.js";
import type { TextureDataT } from "./geotiff/render-pipeline.js";
import { inferRenderPipeline } from "./geotiff/render-pipeline.js";
import { fromAffine } from "./geotiff-reprojection.js";

/** Size of deck.gl's common coordinate space in world units.
 *
 * At zoom 0, one tile covers the whole world (512×512 units); at zoom z, each
 * tile is 512/2^z units.
 */
const TILE_SIZE = 512;

/**
 * The size of the globe in web mercator meters.
 */
const WEB_MERCATOR_METER_CIRCUMFERENCE = 40075016.686;

/**
 * Scale factor for converting EPSG:3857 meters into deck.gl world units
 * (512×512).
 */
const WEB_MERCATOR_TO_WORLD_SCALE =
  TILE_SIZE / WEB_MERCATOR_METER_CIRCUMFERENCE;

/**
 * Minimum interface that **must** be returned from getTileData.
 */
export type MinimalDataT = {
  /** The height of the tile in pixels. */
  height: number;
  /** The width of the tile in pixels. */
  width: number;

  /** Byte length of the data, required for cache management when `maxCacheByteSize` is set. */
  byteLength?: number;
};

type DefaultDataT = MinimalDataT & {
  texture: Texture;
  byteLength: number;
};

/** Options passed to `getTileData`. */
export type GetTileDataOptions = {
  /** The luma.gl Device */
  device: Device;

  /** The x coordinate of the tile within the IFD. */
  x: number;

  /** The y coordinate of the tile within the IFD. */
  y: number;

  /** An AbortSignal that may be signalled if the request is to be aborted */
  signal?: AbortSignal;

  /** The decoder pool to use. */
  pool: DecoderPool;
};

type GetTileDataResult<DataT> = {
  data: DataT;
  forwardTransform: ReprojectionFns["forwardTransform"];
  inverseTransform: ReprojectionFns["inverseTransform"];
};

type COGLayerDataProps<DataT extends MinimalDataT> =
  | {
      /**
       * User-defined method to load data for a tile.
       *
       * Must be provided together with `renderTile`. If neither is provided,
       * the default pipeline is used, which fetches the tile, uploads it as a
       * GPU texture, and renders it using an inferred shader pipeline.
       */
      getTileData: (
        image: GeoTIFF | Overview,
        options: GetTileDataOptions,
      ) => Promise<DataT>;

      /**
       * User-defined method to render data for a tile.
       *
       * Must be provided together with `getTileData`. Receives the value
       * returned by `getTileData` and must return a render pipeline.
       */
      renderTile: (data: DataT) => RenderTileResult;
    }
  | {
      getTileData?: undefined;
      renderTile?: undefined;
    };

/**
 * Props that can be passed into the {@link COGLayer}.
 */
export type COGLayerProps<DataT extends MinimalDataT = DefaultDataT> =
  CompositeLayerProps &
    Pick<
      TileLayerProps,
      | "debounceTime"
      | "maxCacheSize"
      | "maxCacheByteSize"
      | "maxRequests"
      | "refinementStrategy"
    > &
    COGLayerDataProps<DataT> & {
      /**
       * Cloud-optimized GeoTIFF input.
       *
       * - {@link URL} or `string` pointing to a COG
       * - {@link ArrayBuffer} containing the COG data
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
       * Worker pool for decoding image chunks.
       *
       * If none is provided, a default Pool will be created and shared between all
       * COGLayer and GeoTIFFLayer instances.
       */
      pool?: DecoderPool;

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

      /** A user-provided AbortSignal to cancel loading.
       *
       * This can be useful in combination with the MosaicLayer, so that when a
       * mosaic source is out of the viewport, all of its tile requests are
       * automatically aborted.
       */
      signal?: AbortSignal;
    };

const defaultProps: Partial<COGLayerProps> = {
  ...TileLayer.defaultProps,
  epsgResolver,
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
    geotiff: GeoTIFF;
    forwardTo4326?: ReprojectionFns["forwardReproject"];
    inverseFrom4326?: ReprojectionFns["inverseReproject"];
    forwardTo3857?: ReprojectionFns["forwardReproject"];
    inverseFrom3857?: ReprojectionFns["inverseReproject"];
    tms?: TileMatrixSet;
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
      // Clear stale state so renderLayers returns null until the new GeoTIFF is
      // ready
      this.clearState();
      this._parseGeoTIFF();
    }
  }

  clearState() {
    this.setState({
      geotiff: undefined,
      tms: undefined,
      forwardTo4326: undefined,
      inverseFrom4326: undefined,
      forwardTo3857: undefined,
      inverseFrom3857: undefined,
      defaultGetTileData: undefined,
      defaultRenderTile: undefined,
    });
  }

  async _parseGeoTIFF(): Promise<void> {
    const geotiff = await fetchGeoTIFF(this.props.geotiff);
    const crs = geotiff.crs;
    const sourceProjection =
      typeof crs === "number"
        ? await this.props.epsgResolver!(crs)
        : parseWkt(crs);

    const tms = generateTileMatrixSet(geotiff, sourceProjection);

    // @ts-expect-error - proj4 typings are incomplete and don't support
    // wkt-parser input
    const converter4326 = proj4(sourceProjection, "EPSG:4326");
    const forwardTo4326 = (x: number, y: number) =>
      converter4326.forward<[number, number]>([x, y], false);
    const inverseFrom4326 = (x: number, y: number) =>
      converter4326.inverse<[number, number]>([x, y], false);

    // @ts-expect-error - proj4 typings are incomplete and don't support
    // wkt-parser input
    const converter3857 = proj4(sourceProjection, "EPSG:3857");
    const forwardTo3857 = makeClampedForwardTo3857(
      (x: number, y: number) =>
        converter3857.forward<[number, number]>([x, y], false),
      forwardTo4326,
    );
    const inverseFrom3857 = (x: number, y: number) =>
      converter3857.inverse<[number, number]>([x, y], false);

    if (this.props.onGeoTIFFLoad) {
      const geographicBounds = getGeographicBounds(geotiff, converter4326);
      this.props.onGeoTIFFLoad(geotiff, {
        projection: sourceProjection,
        geographicBounds,
      });
    }

    // Only create a default render pipeline if the user did not provide a
    // custom one
    if (!this.props.getTileData || !this.props.renderTile) {
      const { getTileData: defaultGetTileData, renderTile: defaultRenderTile } =
        inferRenderPipeline(geotiff, this.context.device);
      this.setState({ defaultGetTileData, defaultRenderTile });
    }

    this.setState({
      geotiff,
      tms,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
    });
  }

  /**
   * Inner callback passed in to the underlying TileLayer's `getTileData`.
   */
  async _getTileData(
    tile: TileLoadProps,
    geotiff: GeoTIFF,
    tms: TileMatrixSet,
  ): Promise<GetTileDataResult<DataT>> {
    const { signal } = tile;
    const { x, y, z } = tile.index;

    // Select overview image
    // If z=0, use the coarsest overview (which is the last in the array)
    // If z=max, use the full-resolution image (which is the first in the array)

    // TODO: should be able to (micro) optimize this to not create the array
    // Something like:
    // const image = z === geotiff.overviews.length - 1 ? geotiff :
    //   geotiff.overviews[geotiff.overviews.length - 1 - z]!;
    const images = [geotiff, ...geotiff.overviews];
    const image = images[images.length - 1 - z]!;

    const tileMatrix = tms.tileMatrices[z]!;

    const tileAffine = tileTransform(tileMatrix, { col: x, row: y });
    const { forwardTransform, inverseTransform } = fromAffine(tileAffine);

    // Combine abort signals if both are defined
    const combinedSignal =
      signal && this.props.signal
        ? AbortSignal.any([signal, this.props.signal])
        : signal || this.props.signal;

    const getTileDataProps = {
      device: this.context.device,
      x,
      y,
      signal: combinedSignal,
      pool: this.props.pool ?? defaultDecoderPool(),
    };

    let data: DataT;
    if (this.props.getTileData) {
      // In the case that the user passed in a custom `getTileData`, TS knows
      // that `DataT` is the return type of that function
      data = await this.props.getTileData(image, getTileDataProps);
    } else {
      // In the case where the user did not pass in a custom `getTileData`, we
      // have to tell TS that `DefaultDataT` is assignable to `DataT`
      data = (await this.state.defaultGetTileData!(
        image,
        getTileDataProps,
      )) as unknown as DataT;
    }

    return {
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
    forwardTo4326: ReprojectionFns["forwardReproject"],
    inverseFrom4326: ReprojectionFns["inverseReproject"],
    forwardTo3857: ReprojectionFns["forwardReproject"],
    inverseFrom3857: ReprojectionFns["inverseReproject"],
  ): Layer | LayersList | null {
    const { maxError, debug, debugOpacity } = this.props;

    // Cast to include TileMetadata from raster-tileset's `getTileMetadata`
    // method.
    // TODO: implement generic handling of tile metadata upstream in TileLayer
    const tile = props.tile as Tile2DHeader<GetTileDataResult<DataT>> &
      TileMetadata;

    const layers: Layer[] = [];
    if (debug) {
      layers.push(
        ...renderDebugTileOutline(
          `${this.id}-${tile.id}-bounds`,
          tile,
          forwardTo4326,
        ),
      );
    }

    if (!props.data) {
      return layers;
    }

    const { data, forwardTransform, inverseTransform } = props.data;

    const { height, width } = data;

    let tileResult: RenderTileResult;
    if (this.props.getTileData) {
      // In the case that the user passed in a custom `getTileData`, TS knows
      // that `data` can be passed in to `renderTile`.
      tileResult = this.props.renderTile(data);
    } else {
      // In the default case, `data` is `DefaultDataT` — cast required because
      // TS can't prove that `DataT` (which defaults to `DefaultDataT`) is
      // `DefaultDataT` at this point.
      tileResult = this.state.defaultRenderTile!(
        data as unknown as DefaultDataT,
      );
    }
    const { image, renderPipeline } = tileResult;

    // viewport.resolution is defined for GlobeView, undefined for WebMercatorViewport.
    // For WebMercator we project the mesh to EPSG:3857 and use a model matrix
    // to map from 3857 meters to deck.gl world space, matching the approach
    // used by the MVTLayer. This avoids per-vertex WGS84→WebMercator linear
    // interpolation errors that become visible at high latitudes.
    const isGlobe = this.context.viewport.resolution !== undefined;
    let reprojectionFns: ReprojectionFns;
    let deckProjectionProps: Partial<LayerProps>;

    if (isGlobe) {
      reprojectionFns = {
        forwardTransform,
        inverseTransform,
        forwardReproject: forwardTo4326,
        inverseReproject: inverseFrom4326,
      };
      deckProjectionProps = {};
    } else {
      reprojectionFns = {
        forwardTransform,
        inverseTransform,
        forwardReproject: forwardTo3857,
        inverseReproject: inverseFrom3857,
      };
      // Scale 3857 meters → deck.gl world units (512×512).
      //
      // coordinateOrigin shifts the world-space origin to (256, 256) so that
      // easting=0 / northing=0 maps to world center. Then the modelMatrix
      //
      // No Y-flip needed: CARTESIAN Y increases upward = northing.
      deckProjectionProps = {
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        coordinateOrigin: [TILE_SIZE / 2, TILE_SIZE / 2, 0],
        // biome-ignore format: array
        modelMatrix: [
            WEB_MERCATOR_TO_WORLD_SCALE, 0, 0, 0,
            0, WEB_MERCATOR_TO_WORLD_SCALE, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
          ],
      };
    }

    const rasterLayer = new RasterLayer(
      this.getSubLayerProps({
        id: `${props.id}-raster`,
        width,
        height,
        // Only pass image if defined — passing `undefined` explicitly overrides
        // the default null and causes isAsyncPropLoading to return true briefly,
        // which hides the parent tile placeholder and causes a black flash.
        // https://github.com/developmentseed/deck.gl-raster/issues/376
        ...(image !== undefined && { image }),
        renderPipeline,
        maxError,
        reprojectionFns,
        debug,
        debugOpacity,
        ...deckProjectionProps,
      }),
    );
    return [rasterLayer, ...layers];
  }

  /** Define the underlying deck.gl TileLayer. */
  renderTileLayer(
    tms: TileMatrixSet,
    forwardTo4326: ReprojectionFns["forwardReproject"],
    inverseFrom4326: ReprojectionFns["inverseReproject"],
    forwardTo3857: ReprojectionFns["forwardReproject"],
    inverseFrom3857: ReprojectionFns["inverseReproject"],
    geotiff: GeoTIFF,
  ): TileLayer {
    // Create a factory class that wraps COGTileset2D with the metadata
    class TileMatrixSetTilesetFactory extends RasterTileset2D {
      constructor(opts: Tileset2DProps) {
        const descriptor = new TileMatrixSetAdaptor(tms, {
          projectTo4326: forwardTo4326,
          projectTo3857: forwardTo3857,
        });
        super(opts, descriptor, {
          projectTo4326: forwardTo4326,
        });
      }
    }

    const {
      maxRequests,
      maxCacheSize,
      maxCacheByteSize,
      debounceTime,
      refinementStrategy,
    } = this.props;

    return new TileLayer<GetTileDataResult<DataT>>({
      id: `cog-tile-layer-${this.id}`,
      TilesetClass: TileMatrixSetTilesetFactory,
      getTileData: async (tile) => this._getTileData(tile, geotiff, tms),
      renderSubLayers: (props) =>
        this._renderSubLayers(
          props,
          forwardTo4326,
          inverseFrom4326,
          forwardTo3857,
          inverseFrom3857,
        ),
      debounceTime,
      maxCacheByteSize,
      maxCacheSize,
      maxRequests,
      refinementStrategy,
    });
  }

  renderLayers() {
    const {
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
      tms,
      geotiff,
    } = this.state;

    if (
      !forwardTo4326 ||
      !inverseFrom4326 ||
      !forwardTo3857 ||
      !inverseFrom3857 ||
      !tms ||
      !geotiff
    ) {
      return null;
    }

    // Split into a separate method to make TS happy, because when metadata is
    // nullable in any part of function scope, the tileset factory wrapper gives
    // a type error
    return this.renderTileLayer(
      tms,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
      geotiff,
    );
  }
}
