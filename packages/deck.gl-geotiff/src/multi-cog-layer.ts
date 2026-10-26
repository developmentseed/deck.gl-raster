import type {
  CompositeLayerProps,
  Layer,
  UpdateParameters,
} from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
} from "@deck.gl/geo-layers";
import { PathLayer, TextLayer } from "@deck.gl/layers";
import type {
  Corners,
  GetTileDataOptions,
  ProjectionFunction,
  RasterModule,
  RasterTileLayerProps,
  RasterTilesetDescriptor,
  RasterTilesetLevel,
  RenderTileResult,
  UvTransform,
} from "@developmentseed/deck.gl-raster";
import {
  RasterTileLayer,
  resolveSecondaryTiles,
  selectSecondaryLevel,
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
import { assembleTiles, defaultDecoderPool } from "@developmentseed/geotiff";
import type { Device, TextureFormat } from "@luma.gl/core";
import { Texture } from "@luma.gl/core";
import type { COGInput } from "./cog-source.js";
import { isFilterable, resolveTextureFormat } from "./geotiff/texture.js";
import { MultiCOGSource } from "./multi-cog-source.js";

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
  forwardTransform: ProjectionFunction;
  /** Inverse transform from CRS coordinates to pixel coordinates. */
  inverseTransform: ProjectionFunction;
  /** Width of the primary tile in pixels, clipped to the image at its edge. */
  width: number;
  /** Height of the primary tile in pixels, clipped to the image at its edge. */
  height: number;
  /** Byte length of all band textures, required for deck.gl TileLayer cache management. */
  byteLength: number;
  /** Only present when `debug: true`. */
  debugInfo?: MultiTileDebugInfo;
}

/**
 * Props accepted by {@link MultiCOGLayer}.
 *
 * Extends {@link CompositeLayerProps} with multi-source COG configuration and
 * optional tile-layer tuning knobs forwarded to the underlying
 * {@link TileLayerProps | TileLayer}.
 *
 * @see {@link MultiCOGLayer}
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
     * The files of one scene to draw: an opened {@link MultiCOGSource}, or a
     * record of COGs for the layer to open with the defaults of
     * {@link MultiCOGSource.open}, each a URL string, {@link URL},
     * {@link ArrayBuffer} or opened {@link GeoTIFF}. An empty record draws
     * nothing.
     *
     * Each name is a band name for `composite`. Open the files yourself to
     * change those defaults, such as the EPSG resolver or the request limiter,
     * or to share them between layers.
     *
     * Keep the same object across renders: a new one starts the layer's tiles
     * over.
     */
    source: MultiCOGSource | Record<string, COGInput>;

    /**
     * Called with the source the layer opened, when `source` isn't an opened
     * {@link MultiCOGSource} already.
     */
    onSourceLoad?: (source: MultiCOGSource) => void;

    /**
     * Map source bands to RGB(A) output channels.
     *
     * @see {@link buildCompositeBandsProps}
     */
    composite?: { r: string; g?: string; b?: string; a?: string };

    /**
     * Post-processing render pipeline modules applied after compositing.
     *
     * Modules see each band's samples in units that depend on its data type,
     * so give values such as a nodata value or a rescale range in those
     * units:
     *
     * - `uint8` and `uint16` bands are normalized to 0-1: a sample divided by
     *   255 or 65535.
     * - Every other type (signed integers, `uint32` and floats) keeps its raw
     *   value.
     *
     *   Support for these types is **experimental**, and the units they
     *   arrive in are likely to change.
     *
     * @see {@link RasterModule}
     */
    renderPipeline?: RasterModule[];

    /**
     * How band textures are resampled when drawn.
     *
     * - `"linear"` blends the four nearest pixels, for a smooth image.
     * - `"nearest"` uses the single nearest pixel, so pixel edges stay sharp
     *   and every value drawn is a value in the data.
     *
     * Use `"nearest"` with an exact-match nodata filter such as
     * {@link FilterNoDataVal}: linear blending mixes the nodata value into
     * the pixels around it, so those pixels no longer match it and are drawn
     * as a rim around the nodata area.
     *
     * Changing this prop updates tiles that are already loaded, without
     * fetching them again.
     *
     * A band whose texture format the device can't filter is always drawn
     * with `"nearest"`, such as a 16-bit band stored as 32-bit floats on a
     * device without float filtering.
     *
     * @default "linear"
     */
    resampling?: "linear" | "nearest";

    /**
     * Decoder pool for parallel image chunk decompression.
     *
     * @see {@link DecoderPool}
     */
    pool?: DecoderPool;

    /**
     * Maximum reprojection error for mesh refinement: how far a tile's mesh
     * may draw a point from where it belongs on the map, in output pixels
     * (one input pixel's size on the map, normally at the center of the
     * meshed area).
     * Lower values create denser meshes with higher accuracy.
     *
     * @default 0.125
     */
    maxError?: number;

    /**
     * AbortSignal applied to every tile fetch. It doesn't abort opening
     * `source`: the layer aborts that itself when `source` changes or the
     * layer is removed.
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
  ...RasterTileLayer.defaultProps,
  debugLevel: { type: "number" as const, value: 1 },
};

/**
 * A deck.gl {@link CompositeLayer} that draws several Cloud-Optimized GeoTIFFs
 * (COGs) as the bands of one image: an opened {@link MultiCOGSource}, or a
 * record of COGs for the layer to open.
 *
 * Use this layer when the COGs are separate files of **one** composite image:
 * the same scene with the same spatial extent, such as the per-band files of
 * one Sentinel-2 scene. {@link MultiCOGSource.open} rejects files that aren't.
 * To render multiple images as a mosaic, use {@link MosaicLayer}.
 *
 * The finest-resolution source is automatically selected as the primary
 * tileset, which drives the tile grid. Secondary sources are sampled at the
 * closest matching resolution.
 *
 * @see {@link MultiCOGLayerProps} for accepted props.
 * @see {@link MultiCOGSource} for how the files are opened and grouped.
 */
export class MultiCOGLayer extends RasterTileLayer<
  MultiTileResult,
  MultiCOGLayerProps
> {
  static override layerName = "MultiCOGLayer";
  // Same casting trick as COGLayer: defaultProps shape diverges from the
  // base's parameterized type, so cast through to satisfy the static-side
  // check while keeping subclass-specific defaults.
  static override defaultProps =
    defaultProps as unknown as typeof RasterTileLayer.defaultProps;

  declare state: RasterTileLayer<
    MultiTileResult,
    MultiCOGLayerProps
  >["state"] & {
    /** The source the layer draws: `source` itself, or the one opened from it. */
    source?: MultiCOGSource;
  };

  override shouldLoadMetadata(params: UpdateParameters<this>): boolean {
    // An empty record names no files, so the layer draws nothing
    return (
      super.shouldLoadMetadata(params) &&
      Object.keys(params.props.source).length > 0
    );
  }

  /**
   * Open the files that `source` names, with the defaults of
   * {@link MultiCOGSource.open}.
   */
  protected override _openSource(
    input: Record<string, COGInput>,
    signal: AbortSignal,
  ): Promise<MultiCOGSource> {
    return MultiCOGSource.open(input, { signal });
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
  async _getTileData(
    tile: TileLoadProps,
    options: GetTileDataOptions,
  ): Promise<MultiTileResult> {
    const { x, y, z } = tile.index;
    const { multiTilesetDescriptor: multiDescriptor, geotiffs } =
      this.state.source!;
    const pool = this.props.pool ?? defaultDecoderPool();
    const { device, signal: combinedSignal } = options;

    // Compute per-tile reprojection transforms from the primary descriptor
    const primaryKey = multiDescriptor.primaryKey;
    const primaryLevel = multiDescriptor.primary.levels[z]!;
    const { forwardTransform, inverseTransform } = primaryLevel.tileTransform(
      x,
      y,
    );

    // Collect fetch promises for all bands
    const bandPromises: Array<
      Promise<[string, BandTileData, BandDebugInfo | null]>
    > = [];

    for (const [name, geotiff] of geotiffs) {
      const descriptor =
        name === primaryKey
          ? multiDescriptor.primary
          : multiDescriptor.secondaries.get(name)!;

      const isPrimary =
        name === primaryKey ||
        tilesetLevelsEqual(
          descriptor.levels[z] ?? descriptor.levels[0]!,
          primaryLevel,
        );

      if (isPrimary) {
        // Primary-grid source: fetch tile directly with identity UV transform
        bandPromises.push(
          this._fetchPrimaryBand(name, geotiff, {
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
          this._fetchSecondaryBand(name, geotiff, {
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

    // Mesh only the primary texture: edge tiles are clipped to the image.
    const primaryBand = bands.get(primaryKey)!;

    return {
      bands,
      forwardTransform,
      inverseTransform,
      width: primaryBand.width,
      height: primaryBand.height,
      byteLength,
      debugInfo,
    };
  }

  protected override _getTileDataCallback() {
    if (!this.state.source) {
      return undefined;
    }
    return (
      tile: TileLoadProps,
      options: GetTileDataOptions,
    ): Promise<MultiTileResult> => this._getTileData(tile, options);
  }

  protected override _renderTileCallback() {
    if (!this.state.source) {
      return undefined;
    }
    return (data: MultiTileResult): RenderTileResult | null =>
      this._buildRenderResult(data);
  }

  protected override _onTileUnloadCallback(): RasterTileLayerProps<MultiTileResult>["onTileUnload"] {
    const onTileUnload = this.props.onTileUnload;
    // MultiCOGLayer always creates the band textures itself (there is no
    // user-supplied `getTileData`), so it always frees them.
    return (tile) => {
      onTileUnload?.(tile);
      const data = tile.content;
      if (!data) {
        return;
      }
      for (const band of data.bands.values()) {
        if (band.texture instanceof Texture) {
          band.texture.destroy();
        }
      }
    };
  }

  protected override _renderDebug(
    tile: Tile2DHeader<MultiTileResult>,
    data: MultiTileResult | null,
  ): Layer[] {
    if (!data?.debugInfo) {
      return super._renderDebug(tile, data);
    }
    const projectTo4326 = this.state.source?.tilesetDescriptor.projectTo4326;
    if (!projectTo4326) {
      return super._renderDebug(tile, data);
    }
    return this._renderDebugLayers(
      `${this.id}-${tile.id}`,
      tile,
      data,
      projectTo4326,
    );
  }

  /**
   * Build the per-tile render pipeline. Mirrors the band-binding logic that
   * previously lived inline in `_renderSubLayers`.
   *
   * Returns `null` when the configured `composite` references a band that
   * isn't present in the cached tile data (happens transiently while sources
   * are switching).
   */
  private _buildRenderResult(data: MultiTileResult): RenderTileResult | null {
    const { bands } = data;

    const composite = this.props.composite ?? {
      r: [...bands.keys()][0]!,
    };

    const requiredBands = [
      composite.r,
      composite.g,
      composite.b,
      composite.a,
    ].filter((n): n is string => n != null);
    if (requiredBands.some((name) => !bands.has(name))) {
      return null;
    }

    // Set each band's filter here rather than when its texture is created:
    // this runs for every loaded tile whenever the layer's props change, so a
    // new `resampling` applies without fetching the tiles again. A format the
    // device can't filter stays nearest, as `createBandTexture` made it.
    const resampling = this.props.resampling ?? "linear";
    for (const { texture } of bands.values()) {
      const filter =
        resampling === "linear" && isFilterable(texture.device, texture.format)
          ? "linear"
          : "nearest";
      const { minFilter, magFilter } = texture.sampler.props;
      if (minFilter !== filter || magFilter !== filter) {
        texture.setSampler({ minFilter: filter, magFilter: filter });
      }
    }

    const compositeBandsProps = buildCompositeBandsProps(composite, bands);

    const renderPipeline: RasterModule[] = [
      {
        module: CompositeBands as RasterModule["module"],
        props: compositeBandsProps as RasterModule["props"],
      },
      ...(this.props.renderPipeline ?? []),
    ];

    return { renderPipeline };
  }

  /**
   * Fetch a single tile for a source that shares the primary tile grid.
   *
   * @returns A `[name, BandTileData, null]` tuple with identity UV transform
   *   and no debug info (primary bands don't need it).
   */
  private async _fetchPrimaryBand(
    name: string,
    geotiff: GeoTIFF,
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
    const image = selectImage(geotiff, z);

    const tile = await image.fetchTile(x, y, {
      boundless: false,
      pool,
      signal,
    });

    const { texture, byteLength } = createBandTexture(device, tile.array);
    const arr = tile.array;

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
    geotiff: GeoTIFF,
    opts: {
      descriptor: RasterTilesetDescriptor;
      primaryLevel: RasterTilesetLevel;
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
      this.state.source!.multiTilesetDescriptor.primary.levels[primaryZ]!
        .metersPerPixel;
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
    const image = selectImage(geotiff, secondaryZ);
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

    const { texture, byteLength } = createBandTexture(device, assembled);

    return [
      name,
      {
        texture,
        uvTransform: resolution.uvTransform,
        width: assembled.width,
        height: assembled.height,
        byteLength,
      },
      debugInfo,
    ];
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
    forwardTo4326: ProjectionFunction,
  ): Layer[] {
    const layers: Layer[] = [];
    const debugLevel = this.props.debugLevel ?? 1;
    const multiDescriptor = this.state.source?.multiTilesetDescriptor;
    if (!multiDescriptor) {
      return layers;
    }

    const { x, y, z } = tile.index;
    const primaryLevel = multiDescriptor.primary.levels[z];
    if (!primaryLevel) {
      return layers;
    }

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
    if (!data.debugInfo) {
      return layers;
    }

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
 * Create a GPU texture from a {@link RasterArray}, and return it with the
 * byte length of the uploaded data.
 *
 * Infers the texture format from the typed array type:
 *
 * - `Uint8Array` uploads as `r8unorm` and `Uint16Array` as `r16unorm`, so
 *   shaders read samples normalized to 0-1.
 *
 *   Devices not supporting `r16unorm` get the same 0-1 values in `r32float`
 *   (see {@link resolveTextureFormat}).
 * - Every other typed array uploads as `r32float`, where shaders read raw
 *   sample values.
 *
 *   This is **experimental** (see `renderPipeline`). Integers
 *   past 2^24 and `Float64Array` samples round to float32. Integer texture
 *   formats aren't used because {@link CompositeBands} samples with
 *   `sampler2D`, which can't read them.
 *
 * Uses nearest sampling when the device can't linearly filter the format.
 */
export function createBandTexture(
  device: Device,
  array: RasterArray,
): { texture: Texture; byteLength: number } {
  if (array.layout !== "pixel-interleaved") {
    throw new Error("Band-separate layout not yet supported in MultiCOGLayer");
  }

  const { data, width, height } = array;
  let format: TextureFormat;
  let samples = data;

  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    format = "r8unorm";
  } else if (data instanceof Uint16Array) {
    format = "r16unorm";
  } else if (
    data instanceof Int8Array ||
    data instanceof Int16Array ||
    data instanceof Int32Array ||
    data instanceof Uint32Array ||
    data instanceof Float32Array ||
    data instanceof Float64Array
  ) {
    format = "r32float";
    samples = data instanceof Float32Array ? data : new Float32Array(data);
  } else {
    // Unreachable by type, kept as a runtime guard.
    throw new Error(
      `Unsupported typed array type: ${(data as object).constructor.name}.`,
    );
  }

  const upload = resolveTextureFormat(device, format, samples);
  const filter = isFilterable(device, upload.format) ? "linear" : "nearest";
  const texture = device.createTexture({
    data: upload.data,
    format: upload.format,
    width,
    height,
    sampler: { minFilter: filter, magFilter: filter },
  });
  return { texture, byteLength: upload.data.byteLength };
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
  projectTo4326: ProjectionFunction,
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
