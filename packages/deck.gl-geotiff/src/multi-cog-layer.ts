import type {
  CompositeLayerProps,
  Layer,
  LayersList,
  UpdateParameters,
} from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type { TileLayerProps } from "@deck.gl/geo-layers";
import type {
  CompositeBandsMapping,
  MultiTilesetDescriptor,
  RasterModule,
  TilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import {
  createMultiTilesetDescriptor,
  TileMatrixSetAdaptor,
} from "@developmentseed/deck.gl-raster";
import type { DecoderPool, GeoTIFF } from "@developmentseed/geotiff";
import { generateTileMatrixSet } from "@developmentseed/geotiff";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import type { EpsgResolver } from "@developmentseed/proj";
import {
  epsgResolver as defaultEpsgResolver,
  makeClampedForwardTo3857,
  parseWkt,
} from "@developmentseed/proj";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import proj4 from "proj4";
import { fetchGeoTIFF } from "./geotiff/geotiff.js";

/**
 * Configuration for a single COG source within a {@link MultiCOGLayer}.
 */
export interface MultiCOGSourceConfig {
  /**
   * URL or ArrayBuffer of the COG.
   *
   * @see {@link fetchGeoTIFF} for supported input types.
   */
  url: string | URL | ArrayBuffer;
}

/** Internal state for a single opened COG source. */
interface SourceState {
  geotiff: GeoTIFF;
  tms: TileMatrixSet;
}

/**
 * Props accepted by {@link MultiCOGLayer}.
 *
 * Extends {@link CompositeLayerProps} with multi-source COG configuration and
 * optional tile-layer tuning knobs forwarded to the underlying
 * {@link TileLayerProps | TileLayer}.
 *
 * @see {@link MultiCOGLayer}
 * @see {@link MultiCOGSourceConfig}
 */
export type MultiCOGLayerProps = CompositeLayerProps &
  Pick<
    TileLayerProps,
    | "debounceTime"
    | "maxCacheSize"
    | "maxCacheByteSize"
    | "maxRequests"
    | "refinementStrategy"
  > & {
    /**
     * Named sources -- each key becomes a band name used when compositing.
     *
     * @see {@link MultiCOGSourceConfig}
     */
    sources: Record<string, MultiCOGSourceConfig>;

    /**
     * Map source bands to RGB(A) output channels.
     *
     * @see {@link CompositeBandsMapping}
     */
    composite?: CompositeBandsMapping;

    /**
     * Post-processing render pipeline modules applied after compositing.
     *
     * @see {@link RasterModule}
     */
    renderPipeline?: RasterModule[];

    /**
     * EPSG code resolver used to look up projection definitions for numeric
     * CRS codes found in GeoTIFF metadata.
     *
     * @default defaultEpsgResolver
     * @see {@link EpsgResolver}
     */
    epsgResolver?: EpsgResolver;

    /**
     * Decoder pool for parallel image chunk decompression.
     *
     * @see {@link DecoderPool}
     */
    pool?: DecoderPool;

    /**
     * Maximum reprojection error in pixels for mesh refinement.
     * Lower values create denser meshes with higher accuracy.
     *
     * @default 0.125
     */
    maxError?: number;

    /**
     * AbortSignal to cancel loading of all sources.
     */
    signal?: AbortSignal;
  };

const defaultProps = {
  epsgResolver: { type: "accessor" as const, value: defaultEpsgResolver },
  maxError: { type: "number" as const, value: 0.125 },
};

/**
 * A deck.gl {@link CompositeLayer} that opens multiple Cloud-Optimized GeoTIFFs
 * (COGs) in parallel, builds a {@link TilesetDescriptor} for each, and groups
 * them into a single {@link MultiTilesetDescriptor}.
 *
 * The finest-resolution source is automatically selected as the primary
 * tileset, which drives the tile grid. Secondary sources are sampled at the
 * closest matching resolution.
 *
 * This layer handles initialization only -- tile fetching and rendering are
 * added in a subsequent task.
 *
 * @see {@link MultiCOGLayerProps} for accepted props.
 * @see {@link createMultiTilesetDescriptor} for the grouping logic.
 * @see {@link TileMatrixSetAdaptor} for the per-source tileset adapter.
 */
export class MultiCOGLayer extends CompositeLayer<MultiCOGLayerProps> {
  static override layerName = "MultiCOGLayer";
  static override defaultProps = defaultProps;

  declare state: {
    sources: Map<string, SourceState> | null;
    multiDescriptor: MultiTilesetDescriptor | null;
    forwardTo4326: ReprojectionFns["forwardReproject"] | null;
    inverseFrom4326: ReprojectionFns["inverseReproject"] | null;
    forwardTo3857: ReprojectionFns["forwardReproject"] | null;
    inverseFrom3857: ReprojectionFns["inverseReproject"] | null;
  };

  override initializeState(): void {
    this.setState({
      sources: null,
      multiDescriptor: null,
      forwardTo4326: null,
      inverseFrom4326: null,
      forwardTo3857: null,
      inverseFrom3857: null,
    });
  }

  override updateState({ changeFlags }: UpdateParameters<this>): void {
    if (changeFlags.dataChanged || changeFlags.propsChanged) {
      this._parseAllSources();
    }
  }

  /**
   * Open all configured COG sources in parallel, compute shared projection
   * functions, and build the {@link MultiTilesetDescriptor}.
   *
   * All sources are assumed to share the same CRS; the projection of the
   * first source is used for the shared coordinate converters.
   *
   * @returns Resolves when all sources have been opened and state has been set.
   */
  async _parseAllSources(): Promise<void> {
    const { sources } = this.props;
    const entries = Object.entries(sources);

    // Open all COGs in parallel
    const cogSources = await Promise.all(
      entries.map(async ([name, config]) => {
        const geotiff = await fetchGeoTIFF(config.url);
        const crs = geotiff.crs;
        const sourceProjection =
          typeof crs === "number"
            ? await this.props.epsgResolver!(crs)
            : parseWkt(crs);
        const tms = generateTileMatrixSet(geotiff, sourceProjection);
        return { name, geotiff, tms, sourceProjection };
      }),
    );

    // Use the first source's projection for shared projection functions
    // (all sources must share the same CRS)
    const firstCogSource = cogSources[0]!;
    const sourceProjection = firstCogSource.sourceProjection;

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

    // Build TilesetDescriptors
    const tilesetMap = new Map<string, TilesetDescriptor>();
    const sourceMap = new Map<string, SourceState>();

    for (const cogSource of cogSources) {
      const descriptor = new TileMatrixSetAdaptor(cogSource.tms, {
        projectTo4326: forwardTo4326,
        projectTo3857: forwardTo3857,
      });
      tilesetMap.set(cogSource.name, descriptor);
      sourceMap.set(cogSource.name, {
        geotiff: cogSource.geotiff,
        tms: cogSource.tms,
      });
    }

    const multiDescriptor = createMultiTilesetDescriptor(tilesetMap);

    this.setState({
      sources: sourceMap,
      multiDescriptor,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
    });
  }

  override renderLayers(): Layer | LayersList | null {
    // Placeholder -- tile fetching and rendering will be added in Task 5
    if (!this.state.multiDescriptor) return null;
    return [];
  }
}
