import type { UpdateParameters } from "@deck.gl/core";
import type {
  MinimalTileData,
  GetTileDataOptions as RasterTileGetTileDataOptions,
  RasterTileLayerProps,
  RenderTileResult,
  TilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import { RasterTileLayer } from "@developmentseed/deck.gl-raster";
import type { DecoderPool, GeoTIFF, Overview } from "@developmentseed/geotiff";
import { defaultDecoderPool } from "@developmentseed/geotiff";
import type { EpsgResolver, ProjectionDefinition } from "@developmentseed/proj";
import {
  epsgResolver,
  makeClampedForwardTo3857,
  metersPerUnit,
  parseWkt,
} from "@developmentseed/proj";
import type { Texture } from "@luma.gl/core";
import proj4 from "proj4";
import { fetchGeoTIFF, getGeographicBounds } from "./geotiff/geotiff.js";
import type { TextureDataT } from "./geotiff/render-pipeline.js";
import { inferRenderPipeline } from "./geotiff/render-pipeline.js";
import { geoTiffToDescriptor } from "./geotiff-tileset.js";

export type { MinimalTileData } from "@developmentseed/deck.gl-raster";

type DefaultDataT = MinimalTileData & {
  texture: Texture;
  byteLength: number;
};

/** Options passed to `getTileData`. */
export type GetTileDataOptions = RasterTileGetTileDataOptions & {
  /** The x coordinate of the tile within the IFD. */
  x: number;

  /** The y coordinate of the tile within the IFD. */
  y: number;

  /** The decoder pool to use. */
  pool: DecoderPool;
};

type COGLayerDataProps<DataT extends MinimalTileData> =
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
export type COGLayerProps<DataT extends MinimalTileData = DefaultDataT> = Omit<
  RasterTileLayerProps<DataT>,
  "tilesetDescriptor" | "getTileData" | "renderTile"
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

/**
 * COGLayer renders a COG using a tiled approach with reprojection.
 */
export class COGLayer<
  DataT extends MinimalTileData = DefaultDataT,
> extends RasterTileLayer<DataT, COGLayerProps<DataT>> {
  static override layerName = "COGLayer";
  // COGLayer's getTileData signature differs from the base class's, so
  // `DefaultProps<COGLayerProps>` is not assignable to
  // `DefaultProps<RasterTileLayerProps>`. Cast to the base static-side type
  // to keep inheritance happy. The only COG-specific default is
  // `epsgResolver`; all behavior still flows from the base class.
  static override defaultProps = {
    ...RasterTileLayer.defaultProps,
    epsgResolver,
  } as typeof RasterTileLayer.defaultProps;

  declare state: {
    geotiff?: GeoTIFF;
    tilesetDescriptor?: TilesetDescriptor;
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
      tilesetDescriptor: undefined,
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

    // @ts-expect-error - proj4 typings are incomplete and don't support
    // wkt-parser input
    const converter4326 = proj4(sourceProjection, "EPSG:4326");
    const projectTo4326 = (x: number, y: number) =>
      converter4326.forward<[number, number]>([x, y], false);
    const projectFrom4326 = (x: number, y: number) =>
      converter4326.inverse<[number, number]>([x, y], false);

    // @ts-expect-error - proj4 typings are incomplete and don't support
    // wkt-parser input
    const converter3857 = proj4(sourceProjection, "EPSG:3857");
    const projectTo3857 = makeClampedForwardTo3857(
      (x: number, y: number) =>
        converter3857.forward<[number, number]>([x, y], false),
      projectTo4326,
    );
    const projectFrom3857 = (x: number, y: number) =>
      converter3857.inverse<[number, number]>([x, y], false);

    const units = sourceProjection.units;
    if (!units) {
      throw new Error(
        "Source projection is missing 'units' property, cannot compute meters per unit",
      );
    }
    const semiMajorAxis: number | undefined =
      sourceProjection.datum?.a ?? sourceProjection.a;
    const mpu = metersPerUnit(units as Parameters<typeof metersPerUnit>[0], {
      semiMajorAxis,
    });

    const tilesetDescriptor = geoTiffToDescriptor(geotiff, {
      projectTo4326,
      projectFrom4326,
      projectTo3857,
      projectFrom3857,
      mpu,
    });

    if (this.props.onGeoTIFFLoad) {
      const geographicBounds = getGeographicBounds(geotiff, converter4326);
      this.props.onGeoTIFFLoad(geotiff, {
        projection: sourceProjection,
        geographicBounds,
      });
    }

    let defaultGetTileData: COGLayerProps<TextureDataT>["getTileData"];
    let defaultRenderTile: COGLayerProps<TextureDataT>["renderTile"];
    if (!this.props.getTileData || !this.props.renderTile) {
      ({ getTileData: defaultGetTileData, renderTile: defaultRenderTile } =
        inferRenderPipeline(geotiff, this.context.device));
    }

    this.setState({
      geotiff,
      tilesetDescriptor,
      defaultGetTileData,
      defaultRenderTile,
    });
  }

  protected override _tilesetDescriptor() {
    return this.state.tilesetDescriptor;
  }

  /**
   * Adapts the user-facing `(image, { x, y, ... }) => Promise<DataT>` signature
   * into RasterTileLayer's `(tile, { signal, device }) => Promise<DataT>`.
   */
  protected override _getTileDataCallback() {
    const geotiff = this.state.geotiff;

    if (!geotiff) {
      return undefined;
    }

    const userFn = this.props.getTileData ?? this.state.defaultGetTileData;

    if (!userFn) {
      return undefined;
    }

    type RasterGetTileData = NonNullable<
      RasterTileLayerProps<DataT>["getTileData"]
    >;
    const wrapped: RasterGetTileData = async (tile, options) => {
      const { x, y, z } = tile.index;
      // Levels are emitted coarsest-first with the full-res geotiff appended
      // last, so z === overviews.length picks the full-res image and lower z
      // picks the corresponding overview from the finest-first list.
      const image =
        z === geotiff.overviews.length
          ? geotiff
          : geotiff.overviews[geotiff.overviews.length - 1 - z]!;
      return userFn(image, {
        device: options.device,
        x,
        y,
        signal: options.signal,
        pool: this.props.pool ?? defaultDecoderPool(),
      }) as Promise<DataT>;
    };
    return wrapped;
  }

  protected override _renderTileCallback() {
    const userFn = this.props.renderTile ?? this.state.defaultRenderTile;

    if (!userFn) {
      return undefined;
    }

    return userFn as NonNullable<RasterTileLayerProps<DataT>["renderTile"]>;
  }
}
