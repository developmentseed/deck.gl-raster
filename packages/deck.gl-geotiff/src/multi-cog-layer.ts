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
  CompositeBandsMapping,
  MultiTilesetDescriptor,
  RasterModule,
  TilesetDescriptor,
  TilesetLevel,
} from "@developmentseed/deck.gl-raster";
import {
  createCompositeBandsModule,
  createMultiTilesetDescriptor,
  RasterLayer,
  RasterTileset2D,
  resolveSecondaryTiles,
  selectSecondaryLevel,
  TileMatrixSetAdaptor,
  tilesetLevelsEqual,
} from "@developmentseed/deck.gl-raster";
import type {
  DecoderPool,
  GeoTIFF,
  Overview,
  RasterArray,
} from "@developmentseed/geotiff";
import {
  assembleTiles,
  defaultDecoderPool,
  generateTileMatrixSet,
} from "@developmentseed/geotiff";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { tileTransform } from "@developmentseed/morecantile";
import type { EpsgResolver } from "@developmentseed/proj";
import {
  epsgResolver as defaultEpsgResolver,
  makeClampedForwardTo3857,
  parseWkt,
} from "@developmentseed/proj";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { Device, Texture } from "@luma.gl/core";
import proj4 from "proj4";
import { fetchGeoTIFF } from "./geotiff/geotiff.js";
import { fromAffine } from "./geotiff-reprojection.js";

/** Size of deck.gl's common coordinate space in world units. */
const TILE_SIZE = 512;

/** The size of the globe in web mercator meters. */
const WEB_MERCATOR_METER_CIRCUMFERENCE = 40075016.686;

/**
 * Scale factor for converting EPSG:3857 meters into deck.gl world units
 * (512x512).
 */
const WEB_MERCATOR_TO_WORLD_SCALE =
  TILE_SIZE / WEB_MERCATOR_METER_CIRCUMFERENCE;

/**
 * UV transform mapping primary tile UV space to the correct sub-region of a
 * band texture.
 *
 * Applied in the shader as: `sampledUV = uv * [scaleX, scaleY] + [offsetX, offsetY]`
 *
 * For primary-grid bands this is the identity `[0, 0, 1, 1]`.
 * For secondary bands it accounts for resolution and alignment differences.
 */
interface UvTransform {
  /** Horizontal offset: left edge of the primary tile within the band texture, in UV units. */
  offsetX: number;
  /** Vertical offset: top edge of the primary tile within the band texture, in UV units. */
  offsetY: number;
  /** Horizontal scale: fraction of the band texture width covered by the primary tile. */
  scaleX: number;
  /** Vertical scale: fraction of the band texture height covered by the primary tile. */
  scaleY: number;
}

/**
 * Convert the `[offsetX, offsetY, scaleX, scaleY]` tuple returned by
 * {@link resolveSecondaryTiles} into the named {@link UvTransform} form.
 */
function tupleToUvTransform(t: [number, number, number, number]): UvTransform {
  return { offsetX: t[0], offsetY: t[1], scaleX: t[2], scaleY: t[3] };
}

/** Data returned per band from tile fetching. */
interface BandTileData {
  /** GPU texture containing the band's raster data. */
  texture: Texture;
  /** UV transform for aligning this band's texture to the primary tile. */
  uvTransform: UvTransform;
  /** Width of the texture in pixels. */
  width: number;
  /** Height of the texture in pixels. */
  height: number;
}

/** Result of {@link MultiCOGLayer._getTileData} -- all band textures plus reprojection functions. */
interface MultiTileResult {
  /** Per-band texture data, keyed by source name. */
  bands: Map<string, BandTileData>;
  /** Forward transform from pixel coordinates to CRS coordinates. */
  forwardTransform: (x: number, y: number) => [number, number];
  /** Inverse transform from CRS coordinates to pixel coordinates. */
  inverseTransform: (x: number, y: number) => [number, number];
  /** Width of the primary tile in pixels. */
  width: number;
  /** Height of the primary tile in pixels. */
  height: number;
}

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

  /**
   * Fetch tile data for all configured sources at the given tile index.
   *
   * Primary-grid sources are fetched directly at (x, y, z). Secondary
   * sources are resolved to covering tiles at the closest matching zoom
   * level, fetched (potentially multiple tiles), stitched if necessary,
   * and returned with the appropriate UV transform.
   *
   * @param tile - Tile load props from the TileLayer, containing index and signal.
   * @returns Per-band textures, UV transforms, and reprojection functions.
   */
  async _getTileData(tile: TileLoadProps): Promise<MultiTileResult> {
    const { signal } = tile;
    const { x, y, z } = tile.index;
    const { multiDescriptor, sources } = this.state;
    const pool = this.props.pool ?? defaultDecoderPool();
    const device = this.context.device;

    // Combine abort signals if both are defined
    const combinedSignal =
      signal && this.props.signal
        ? AbortSignal.any([signal, this.props.signal])
        : signal || this.props.signal;

    // Compute reprojection transforms from the primary TMS
    const primaryKey = multiDescriptor!.primaryKey;
    const primarySource = sources!.get(primaryKey)!;
    const primaryTms = primarySource.tms;
    const tileMatrix = primaryTms.tileMatrices[z]!;
    const tileAffine = tileTransform(tileMatrix, { col: x, row: y });
    const { forwardTransform, inverseTransform } = fromAffine(tileAffine);

    const primaryLevel = multiDescriptor!.primary.levels[z]!;

    // Collect fetch promises for all bands
    const bandPromises: Array<Promise<[string, BandTileData]>> = [];

    for (const [name, sourceState] of sources!) {
      const descriptor =
        name === primaryKey
          ? multiDescriptor!.primary
          : multiDescriptor!.secondaries.get(name)!;

      const isPrimary =
        name === primaryKey ||
        tilesetLevelsEqual(
          descriptor.levels[z] ?? descriptor.levels[0]!,
          primaryLevel,
        );

      if (isPrimary) {
        // Primary-grid source: fetch tile directly with identity UV transform
        bandPromises.push(
          this._fetchPrimaryBand(name, sourceState, {
            x,
            y,
            z,
            pool,
            signal: combinedSignal,
            device,
          }),
        );
      } else {
        // Secondary source: resolve covering tiles and fetch
        bandPromises.push(
          this._fetchSecondaryBand(name, sourceState, {
            descriptor,
            primaryLevel,
            primaryCol: x,
            primaryRow: y,
            primaryZ: z,
            pool,
            signal: combinedSignal,
            device,
          }),
        );
      }
    }

    const bandEntries = await Promise.all(bandPromises);
    const bands = new Map(bandEntries);

    return {
      bands,
      forwardTransform,
      inverseTransform,
      width: primaryLevel.tileWidth,
      height: primaryLevel.tileHeight,
    };
  }

  /**
   * Fetch a single tile for a source that shares the primary tile grid.
   *
   * @returns A `[name, BandTileData]` tuple with identity UV transform.
   */
  private async _fetchPrimaryBand(
    name: string,
    sourceState: SourceState,
    opts: {
      x: number;
      y: number;
      z: number;
      pool: DecoderPool;
      signal: AbortSignal | undefined;
      device: Device;
    },
  ): Promise<[string, BandTileData]> {
    const { x, y, z, pool, signal, device } = opts;
    const image = selectImage(sourceState.geotiff, z);

    const tile = await image.fetchTile(x, y, {
      boundless: false,
      pool,
      signal,
    });

    const texture = createBandTexture(device, tile.array);

    return [
      name,
      {
        texture,
        uvTransform: { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
        width: tile.array.width,
        height: tile.array.height,
      },
    ];
  }

  /**
   * Fetch covering tiles for a secondary source and stitch them into a
   * single texture using {@link assembleTiles}.
   *
   * @returns A `[name, BandTileData]` tuple with the computed UV transform.
   */
  private async _fetchSecondaryBand(
    name: string,
    sourceState: SourceState,
    opts: {
      descriptor: TilesetDescriptor;
      primaryLevel: TilesetLevel;
      primaryCol: number;
      primaryRow: number;
      primaryZ: number;
      pool: DecoderPool;
      signal: AbortSignal | undefined;
      device: Device;
    },
  ): Promise<[string, BandTileData]> {
    const {
      descriptor,
      primaryLevel,
      primaryCol,
      primaryRow,
      primaryZ,
      pool,
      signal,
      device,
    } = opts;

    // Select the best secondary level
    const primaryMpp =
      this.state.multiDescriptor!.primary.levels[primaryZ]!.metersPerPixel;
    const secondaryLevel = selectSecondaryLevel(descriptor.levels, primaryMpp);
    const secondaryZ = descriptor.levels.indexOf(secondaryLevel);

    // Resolve covering tile indices and UV transform
    const resolution = resolveSecondaryTiles(
      primaryLevel,
      primaryCol,
      primaryRow,
      secondaryLevel,
      secondaryZ,
    );

    // Fetch all covering tiles via fetchTiles
    const image = selectImage(sourceState.geotiff, secondaryZ);
    const xy: Array<[number, number]> = resolution.tileIndices.map((idx) => [
      idx.x,
      idx.y,
    ]);
    const tiles = await image.fetchTiles(xy, {
      boundless: false,
      pool,
      signal,
    });

    // Assemble into a single RasterArray (handles stitching + typed array preservation)
    const assembled = assembleTiles(tiles, {
      width: resolution.stitchedWidth,
      height: resolution.stitchedHeight,
      tileWidth: secondaryLevel.tileWidth,
      tileHeight: secondaryLevel.tileHeight,
      minCol: resolution.minCol,
      minRow: resolution.minRow,
    });

    const texture = createBandTexture(device, assembled);

    return [
      name,
      {
        texture,
        uvTransform: tupleToUvTransform(resolution.uvTransform),
        width: assembled.width,
        height: assembled.height,
      },
    ];
  }

  /**
   * Create sub-layers for a single loaded tile.
   *
   * Builds a {@link RasterLayer} with reprojection functions and a render
   * pipeline that starts with a {@link CompositeBands} module binding all
   * band textures, followed by any user-provided pipeline modules.
   */
  _renderSubLayers(
    props: TileLayerProps<MultiTileResult> & {
      id: string;
      data?: MultiTileResult;
      _offset: number;
      tile: Tile2DHeader<MultiTileResult>;
    },
    forwardTo4326: ReprojectionFns["forwardReproject"],
    inverseFrom4326: ReprojectionFns["inverseReproject"],
    forwardTo3857: ReprojectionFns["forwardReproject"],
    inverseFrom3857: ReprojectionFns["inverseReproject"],
  ): Layer | LayersList | null {
    const { maxError } = this.props;

    if (!props.data) {
      return null;
    }

    const { bands, forwardTransform, inverseTransform, width, height } =
      props.data;

    // Build the composite bands mapping — default to first source for R if
    // no composite mapping is provided
    const composite = this.props.composite ?? {
      r: [...bands.keys()][0]!,
    };

    // Create the CompositeBands shader module
    const compositeBandsModule = createCompositeBandsModule(composite);

    // Build props for the CompositeBands module: bind textures and UV transforms
    const compositeBandsProps: Record<string, unknown> = {};
    for (const [bandName, bandData] of bands) {
      compositeBandsProps[`band_${bandName}`] = bandData.texture;
      const uv = bandData.uvTransform;
      compositeBandsProps[`uvTransform_${bandName}`] = [
        uv.offsetX,
        uv.offsetY,
        uv.scaleX,
        uv.scaleY,
      ];
    }

    // Assemble the full render pipeline
    // Cast required because CompositeBandsModule uses Record<string, unknown>
    // for its getUniforms return type, while RasterModule expects
    // ShaderModule<Record<string, number | Texture>>.
    const renderPipeline: RasterModule[] = [
      {
        module: compositeBandsModule as RasterModule["module"],
        props: compositeBandsProps as RasterModule["props"],
      },
      ...(this.props.renderPipeline ?? []),
    ];

    // Determine projection mode (globe vs web mercator)
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
        renderPipeline,
        maxError,
        reprojectionFns,
        ...deckProjectionProps,
      }),
    );

    return [rasterLayer];
  }

  /**
   * Build the tile layer that drives tile traversal and rendering.
   *
   * Creates a {@link RasterTileset2D} factory from the primary tileset,
   * then returns a {@link TileLayer} wired up with tile fetching and
   * sub-layer rendering.
   */
  renderTileLayer(
    multiDescriptor: MultiTilesetDescriptor,
    forwardTo4326: ReprojectionFns["forwardReproject"],
    inverseFrom4326: ReprojectionFns["inverseReproject"],
    forwardTo3857: ReprojectionFns["forwardReproject"],
    inverseFrom3857: ReprojectionFns["inverseReproject"],
  ): TileLayer {
    const { primary } = multiDescriptor;

    // Create a factory class that wraps RasterTileset2D with the primary descriptor
    class PrimaryTilesetFactory extends RasterTileset2D {
      constructor(opts: Tileset2DProps) {
        super(opts, primary, {
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

    return new TileLayer<MultiTileResult>({
      id: `multi-cog-tile-layer-${this.id}`,
      TilesetClass: PrimaryTilesetFactory,
      getTileData: async (tile) => this._getTileData(tile),
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

  override renderLayers(): Layer | LayersList | null {
    const {
      multiDescriptor,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
    } = this.state;

    if (
      !multiDescriptor ||
      !forwardTo4326 ||
      !inverseFrom4326 ||
      !forwardTo3857 ||
      !inverseFrom3857
    ) {
      return null;
    }

    return this.renderTileLayer(
      multiDescriptor,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
    );
  }
}

/**
 * Select the correct GeoTIFF image (full-res or overview) for a zoom level.
 *
 * z=0 is the coarsest overview, z=max is full resolution.
 */
function selectImage(geotiff: GeoTIFF, z: number): GeoTIFF | Overview {
  const images: Array<GeoTIFF | Overview> = [geotiff, ...geotiff.overviews];
  return images[images.length - 1 - z]!;
}

/**
 * Create a GPU texture from a {@link RasterArray}.
 *
 * Currently hardcoded to `r8unorm` for single-band uint8 data.
 * TODO: infer texture format from the array's typed array type and band count.
 */
function createBandTexture(device: Device, array: RasterArray): Texture {
  if (array.layout !== "pixel-interleaved") {
    throw new Error("Band-separate layout not yet supported in MultiCOGLayer");
  }

  return device.createTexture({
    data: array.data as Uint8Array,
    format: "r8unorm",
    width: array.width,
    height: array.height,
    sampler: { minFilter: "linear", magFilter: "linear" },
  });
}
