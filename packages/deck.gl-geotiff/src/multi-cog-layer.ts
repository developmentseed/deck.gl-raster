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
import { PathLayer, TextLayer } from "@deck.gl/layers";
import type {
  Corners,
  MultiTilesetDescriptor,
  RasterModule,
  TilesetDescriptor,
  TilesetLevel,
  UvTransform,
} from "@developmentseed/deck.gl-raster";
import {
  createMultiTilesetDescriptor,
  RasterLayer,
  RasterTileset2D,
  resolveSecondaryTiles,
  selectSecondaryLevel,
  TileMatrixSetAdaptor,
  tilesetLevelsEqual,
} from "@developmentseed/deck.gl-raster";
import {
  buildCompositeBandsProps,
  CompositeBands,
} from "@developmentseed/deck.gl-raster/gpu-modules";
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
import type { Device, Texture, TextureFormat } from "@luma.gl/core";
import proj4 from "proj4";
import { fetchGeoTIFF } from "./geotiff/geotiff.js";
import { enforceAlignment } from "./geotiff/render-pipeline.js";
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
 * Color palette for debug overlays.
 *
 * Index 0 is the primary tileset (red outline, white text).
 * Indices 1+ cycle through distinct colors for secondary tilesets.
 */
const DEBUG_COLORS: {
  outline: [number, number, number, number];
  text: [number, number, number, number];
}[] = [
  { outline: [255, 0, 0, 255], text: [255, 255, 255, 255] }, // primary: red outline, white text
  { outline: [0, 255, 255, 255], text: [0, 255, 255, 255] }, // cyan
  { outline: [255, 255, 0, 255], text: [255, 255, 0, 255] }, // yellow
  { outline: [255, 0, 255, 255], text: [255, 0, 255, 255] }, // magenta
  { outline: [0, 255, 128, 255], text: [0, 255, 128, 255] }, // lime
];

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
  /** Byte length of the underlying texture data. */
  byteLength: number;
}

/** Debug metadata for a secondary band, collected during tile fetching. */
interface BandDebugInfo {
  /** CRS corners of each secondary tile fetched (for drawing outlines). */
  secondaryTileCorners: Corners[];
  /** Secondary zoom level index selected. */
  secondaryZ: number;
  /** UV transform applied to this band. */
  uvTransform: UvTransform;
  /** Stitched texture width in pixels. */
  stitchedWidth: number;
  /** Stitched texture height in pixels. */
  stitchedHeight: number;
  /** Number of secondary tiles fetched. */
  tileCount: number;
  /** Meters per pixel at the selected secondary level. */
  metersPerPixel: number;
}

/** Debug info for all bands of a single primary tile. */
interface MultiTileDebugInfo {
  /** Per-band debug metadata, keyed by source name. Only secondary bands. */
  bands: Map<string, BandDebugInfo>;
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
  /** Byte length of all band textures, required for deck.gl TileLayer cache management. */
  byteLength: number;
  /** Only present when `debug: true`. */
  debugInfo?: MultiTileDebugInfo;
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
     * @see {@link buildCompositeBandsProps}
     */
    composite?: { r: string; g?: string; b?: string; a?: string };

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

    /**
     * Enable debug overlay showing tile boundaries and metadata labels
     * for all tilesets.
     *
     * @default false
     */
    debug?: boolean;

    /**
     * Opacity of the reprojection mesh debug overlay. Only used when
     * `debug` is `true`. Forwarded to the underlying {@link RasterLayer}.
     *
     * @default 0.5
     */
    debugOpacity?: number;

    /**
     * Controls how much detail is shown in debug text labels.
     *
     * - `1`: tile index and resolution only
     * - `2`: adds UV transform and tile count
     * - `3`: adds stitched dimensions and meters/pixel
     *
     * @default 1
     */
    debugLevel?: 1 | 2 | 3;
  };

const defaultProps = {
  epsgResolver: { type: "accessor" as const, value: defaultEpsgResolver },
  maxError: { type: "number" as const, value: 0.125 },
  debug: { type: "boolean" as const, value: false },
  debugOpacity: { type: "number" as const, value: 0.5 },
  debugLevel: { type: "number" as const, value: 1 },
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

  override updateState({
    changeFlags,
    props,
    oldProps,
  }: UpdateParameters<this>): void {
    if (changeFlags.dataChanged || props.sources !== oldProps.sources) {
      // Reset state so renderLayers() returns null while we re-open COGs.
      // Without this, the TileLayer renders with new props but stale state,
      // caching tiles with the wrong bands.
      this.setState({
        sources: null,
        multiDescriptor: null,
      });
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
    const bandPromises: Array<
      Promise<[string, BandTileData, BandDebugInfo | null]>
    > = [];

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
            debug: this.props.debug ?? false,
          }),
        );
      }
    }

    const bandEntries = await Promise.all(bandPromises);
    const bands = new Map(bandEntries.map(([name, data]) => [name, data]));

    // Collect debug info from secondary bands
    let debugInfo: MultiTileDebugInfo | undefined;
    if (this.props.debug) {
      const debugBands = new Map<string, BandDebugInfo>();
      for (const [name, , bandDebug] of bandEntries) {
        if (bandDebug) {
          debugBands.set(name, bandDebug);
        }
      }
      debugInfo = { bands: debugBands };
    }

    const byteLength = [...bands.values()].reduce(
      (sum, band) => sum + band.byteLength,
      0,
    );

    console.log(
      `Tile (${x}, ${y}, ${z}): fetched bands [${[...bands.keys()].join(", ")}], total byte length: ${byteLength}`,
    );

    return {
      bands,
      forwardTransform,
      inverseTransform,
      width: primaryLevel.tileWidth,
      height: primaryLevel.tileHeight,
      byteLength,
      debugInfo,
    };
  }

  /**
   * Fetch a single tile for a source that shares the primary tile grid.
   *
   * @returns A `[name, BandTileData, null]` tuple with identity UV transform
   *   and no debug info (primary bands don't need it).
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
  ): Promise<[string, BandTileData, BandDebugInfo | null]> {
    const { x, y, z, pool, signal, device } = opts;
    const image = selectImage(sourceState.geotiff, z);

    const tile = await image.fetchTile(x, y, {
      boundless: true,
      pool,
      signal,
    });

    const texture = createBandTexture(device, tile.array);
    const arr = tile.array;
    const byteLength =
      arr.layout === "pixel-interleaved"
        ? arr.data.byteLength
        : arr.bands.reduce((sum, b) => sum + b.byteLength, 0);

    return [
      name,
      {
        texture,
        uvTransform: [0, 0, 1, 1],
        width: arr.width,
        height: arr.height,
        byteLength,
      },
      null,
    ];
  }

  /**
   * Fetch covering tiles for a secondary source and stitch them into a
   * single texture using {@link assembleTiles}.
   *
   * @returns A `[name, BandTileData, BandDebugInfo | null]` tuple with the
   *   computed UV transform and optional debug metadata.
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
      debug: boolean;
    },
  ): Promise<[string, BandTileData, BandDebugInfo | null]> {
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

    // Collect debug info if requested
    let debugInfo: BandDebugInfo | null = null;
    if (opts.debug) {
      const secondaryTileCorners = resolution.tileIndices.map((idx) =>
        secondaryLevel.projectedTileCorners(idx.x, idx.y),
      );
      debugInfo = {
        secondaryTileCorners,
        secondaryZ,
        uvTransform: resolution.uvTransform,
        stitchedWidth: resolution.stitchedWidth,
        stitchedHeight: resolution.stitchedHeight,
        tileCount: resolution.tileIndices.length,
        metersPerPixel: secondaryLevel.metersPerPixel,
      };
    }

    // Fetch all covering tiles via fetchTiles
    const image = selectImage(sourceState.geotiff, secondaryZ);
    const xy: Array<[number, number]> = resolution.tileIndices.map((idx) => [
      idx.x,
      idx.y,
    ]);
    const tiles = await image.fetchTiles(xy, {
      boundless: true,
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
    const assembledByteLength =
      assembled.layout === "pixel-interleaved"
        ? assembled.data.byteLength
        : assembled.bands.reduce((sum, b) => sum + b.byteLength, 0);

    return [
      name,
      {
        texture,
        uvTransform: resolution.uvTransform,
        width: assembled.width,
        height: assembled.height,
        byteLength: assembledByteLength,
      },
      debugInfo,
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
    const { maxError, debug, debugOpacity } = this.props;

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

    // Skip rendering if cached tile data doesn't have the required bands
    // (happens when switching presets — old tiles will be re-fetched)
    const requiredBands = [
      composite.r,
      composite.g,
      composite.b,
      composite.a,
    ].filter((n): n is string => n != null);
    if (requiredBands.some((name) => !bands.has(name))) {
      return null;
    }

    // Map named bands to fixed slot indices and build module props
    const compositeBandsProps = buildCompositeBandsProps(composite, bands);

    const renderPipeline: RasterModule[] = [
      {
        module: CompositeBands as RasterModule["module"],
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
        debug,
        debugOpacity,
        ...deckProjectionProps,
      }),
    );

    const sublayers: Layer[] = [rasterLayer];

    if (debug && props.data) {
      sublayers.push(
        ...this._renderDebugLayers(
          props.id,
          props.tile,
          props.data,
          forwardTo4326,
        ),
      );
    }

    return sublayers;
  }

  /**
   * Render debug overlay layers for a single tile: colored outlines for
   * primary and secondary tile boundaries, and tiered text labels.
   *
   * @param tileId - Base id for sub-layer naming.
   * @param tile - The tile header with index info.
   * @param data - The fetched multi-tile result containing debug info.
   * @param forwardTo4326 - Projection function for converting CRS corners to WGS84.
   * @returns Array of PathLayer and TextLayer sub-layers.
   */
  private _renderDebugLayers(
    tileId: string,
    tile: Tile2DHeader<MultiTileResult>,
    data: MultiTileResult,
    forwardTo4326: ReprojectionFns["forwardReproject"],
  ): Layer[] {
    const layers: Layer[] = [];
    const debugLevel = this.props.debugLevel ?? 1;
    const { multiDescriptor } = this.state;
    if (!multiDescriptor) return layers;

    const { x, y, z } = tile.index;
    const primaryLevel = multiDescriptor.primary.levels[z];
    if (!primaryLevel) return layers;

    // --- Primary tile outline and label ---
    const primaryCrsCorners = primaryLevel.projectedTileCorners(x, y);
    const { path: primaryPath, center: primaryCenter } = cornersToWgs84Path(
      primaryCrsCorners,
      forwardTo4326,
    );

    const primaryColor = DEBUG_COLORS[0]!;

    layers.push(
      new PathLayer({
        id: `${tileId}-debug-primary-outline`,
        data: [primaryPath],
        getPath: (d) => d,
        getColor: primaryColor.outline,
        getWidth: 2,
        widthUnits: "pixels",
        pickable: false,
      }),
    );

    // Build primary label text
    let primaryText = `x=${x} y=${y} z=${z}`;
    if (debugLevel >= 2) {
      primaryText += `  ${data.width}x${data.height}`;
    }
    if (debugLevel >= 3) {
      primaryText += `  ${primaryLevel.metersPerPixel.toFixed(1)}m/px`;
    }

    // Count total label lines for vertical stacking
    const secondaryNames = data.debugInfo
      ? [...data.debugInfo.bands.keys()]
      : [];
    const totalLines = 1 + secondaryNames.length;
    const lineSpacing = 18; // pixels
    const topOffset = ((totalLines - 1) * lineSpacing) / 2;

    layers.push(
      new TextLayer({
        id: `${tileId}-debug-primary-label`,
        data: [
          {
            position: primaryCenter,
            text: primaryText,
          },
        ],
        getColor: primaryColor.text,
        getSize: 14,
        getPixelOffset: [0, -topOffset],
        sizeUnits: "pixels",
        outlineWidth: 3,
        outlineColor: [0, 0, 0, 255],
        fontSettings: { sdf: true },
      }),
    );

    // --- Secondary tile outlines and labels ---
    if (!data.debugInfo) return layers;

    let secondaryIdx = 0;
    for (const [name, info] of data.debugInfo.bands) {
      const colorEntry =
        DEBUG_COLORS[1 + (secondaryIdx % (DEBUG_COLORS.length - 1))]!;

      // Draw outline for each secondary tile
      for (let i = 0; i < info.secondaryTileCorners.length; i++) {
        const { path: secondaryPath } = cornersToWgs84Path(
          info.secondaryTileCorners[i]!,
          forwardTo4326,
        );

        layers.push(
          new PathLayer({
            id: `${tileId}-debug-${name}-outline-${i}`,
            data: [secondaryPath],
            getPath: (d) => d,
            getColor: colorEntry.outline,
            getWidth: 2,
            widthUnits: "pixels",
            pickable: false,
          }),
        );
      }

      // Build secondary label text
      const mpp = info.metersPerPixel.toFixed(1);
      let labelText = `${name}: ${mpp}m z=${info.secondaryZ}`;
      if (debugLevel >= 2) {
        const uv = info.uvTransform;
        labelText += `  uv=[${uv.map((v) => v.toFixed(2)).join(",")}]  ${info.tileCount} tiles`;
      }
      if (debugLevel >= 3) {
        labelText += `  stitch=${info.stitchedWidth}x${info.stitchedHeight}`;
      }

      const lineOffset = -topOffset + (1 + secondaryIdx) * lineSpacing;

      layers.push(
        new TextLayer({
          id: `${tileId}-debug-${name}-label`,
          data: [
            {
              position: primaryCenter,
              text: labelText,
            },
          ],
          getColor: colorEntry.text,
          getSize: 12,
          getPixelOffset: [0, lineOffset],
          sizeUnits: "pixels",
          outlineWidth: 2,
          outlineColor: [0, 0, 0, 255],
          fontSettings: { sdf: true },
        }),
      );

      secondaryIdx++;
    }

    return layers;
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

    // Stringify sources to detect when the set of COG URLs changes.
    // This triggers TileLayer to invalidate its cache and re-fetch.
    const sourceKeys = Object.keys(this.props.sources).sort().join(",");
    const sourceUrls = Object.values(this.props.sources)
      .map((s) => String(s.url))
      .sort()
      .join(",");

    return new TileLayer<MultiTileResult>({
      id: `multi-cog-tile-layer-${this.id}-${sourceUrls}`,
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
      updateTriggers: {
        getTileData: [sourceKeys, sourceUrls],
      },
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
 * Infers the texture format from the typed array type. Currently supports
 * single-band `Uint8Array` (`r8unorm`) and `Uint16Array` (`r16unorm`).
 *
 * TODO: use `inferTextureFormat` from `texture.ts` for full format support.
 */
function createBandTexture(device: Device, array: RasterArray): Texture {
  if (array.layout !== "pixel-interleaved") {
    throw new Error("Band-separate layout not yet supported in MultiCOGLayer");
  }

  const { data, width, height, count } = array;
  let format: TextureFormat;
  let bytesPerSample: number;

  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    format = "r8unorm";
    bytesPerSample = 1;
  } else if (data instanceof Uint16Array) {
    format = "r16unorm";
    bytesPerSample = 2;
  } else {
    throw new Error(
      `Unsupported typed array type: ${data.constructor.name}. ` +
        "Currently only Uint8Array and Uint16Array are supported.",
    );
  }

  const aligned = enforceAlignment(data, {
    width,
    height,
    bytesPerPixel: bytesPerSample * count,
  });

  return device.createTexture({
    data: aligned,
    format,
    width,
    height,
    sampler: { minFilter: "linear", magFilter: "linear" },
  });
}

/**
 * Project CRS tile corners to WGS84 and return a closed path suitable for
 * PathLayer, plus the center point for label placement.
 *
 * @param corners - Tile corners in the source CRS.
 * @param projectTo4326 - Projection function from source CRS to WGS84.
 * @returns A closed `[topLeft, topRight, bottomRight, bottomLeft, topLeft]`
 *   path and the geographic center.
 */
function cornersToWgs84Path(
  corners: Corners,
  projectTo4326: ReprojectionFns["forwardReproject"],
): { path: [number, number][]; center: [number, number] } {
  const topLeft = projectTo4326(corners.topLeft[0], corners.topLeft[1]);
  const topRight = projectTo4326(corners.topRight[0], corners.topRight[1]);
  const bottomRight = projectTo4326(
    corners.bottomRight[0],
    corners.bottomRight[1],
  );
  const bottomLeft = projectTo4326(
    corners.bottomLeft[0],
    corners.bottomLeft[1],
  );
  return {
    path: [topLeft, topRight, bottomRight, bottomLeft, topLeft],
    center: [
      (topLeft[0] + bottomRight[0]) / 2,
      (topLeft[1] + bottomRight[1]) / 2,
    ],
  };
}
