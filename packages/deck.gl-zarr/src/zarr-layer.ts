/**
 * ZarrLayer - Composite layer for visualizing Zarr arrays in deck.gl
 *
 * Follows the COGLayer pattern from deck.gl-geotiff.
 */

import type {
  Bounds,
  FormatDescriptor,
  ZarrMultiscaleMetadata,
} from "zarr-multiscale-metadata";
import {
  createFormatDescriptor,
  createZarritaRoot,
  loadCoordinateBounds,
  parseZarrMetadata,
} from "zarr-multiscale-metadata";
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
import type {
  RasterModule,
  SourceCrs,
  TileMatrixSet,
} from "@developmentseed/deck.gl-raster";
import { RasterLayer, RasterTileset2D } from "@developmentseed/deck.gl-raster";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { Device } from "@luma.gl/core";
import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import {
  loadZarrTileData,
  renderZarrTileToImageData,
  type ZarrTileData,
} from "./zarr-data-loader.js";
import { createReprojectionFns } from "./zarr-reprojection.js";
import { parseZarrTileMatrixSet } from "./zarr-tile-matrix-set.js";
import type { ColormapFunction, ProjectionInfo, SortedLevel } from "./types.js";

/**
 * Minimum interface that must be returned from getTileData.
 */
export type MinimalDataT = {
  height: number;
  width: number;
};

/**
 * Default data type including texture.
 */
export type DefaultDataT = MinimalDataT & {
  texture: ImageData;
};

/**
 * Options passed to getTileData.
 */
export type GetTileDataOptions = {
  /** The luma.gl Device */
  device: Device;
  /** The pixel window to read [x0, y0, x1, y1] */
  window?: [number, number, number, number];
  /** An AbortSignal that may be signalled if the request is to be aborted */
  signal?: AbortSignal;
};

type GetTileDataResult<DataT> = {
  data: DataT;
  forwardTransform: ReprojectionFns["forwardTransform"];
  inverseTransform: ReprojectionFns["inverseTransform"];
};

/**
 * Props for ZarrLayer
 */
export interface ZarrLayerProps<DataT extends MinimalDataT = DefaultDataT>
  extends CompositeLayerProps {
  /**
   * Zarr source URL or zarrita store.
   */
  source: string | Readable;

  /**
   * Variable name to visualize.
   */
  variable: string;

  /**
   * Force a specific Zarr version (2 or 3).
   */
  version?: 2 | 3;

  /**
   * Override CRS code (e.g., 'EPSG:4326').
   */
  crs?: string;

  /**
   * Custom proj4 definition for CRS.
   */
  proj4def?: string;

  /**
   * Override spatial dimension name detection.
   */
  spatialDimensions?: { lat?: string; lon?: string };

  /**
   * Fixed indices for non-spatial dimensions (e.g., { time: 0, band: 2 }).
   */
  dimensionIndices?: Record<string, number>;

  /**
   * Maximum reprojection error in pixels for mesh refinement.
   * Lower values create denser meshes with higher accuracy.
   * @default 0.125
   */
  maxError?: number;

  /**
   * User-defined method to load data for a tile.
   */
  getTileData?: (
    tileData: ZarrTileData,
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
   * Value normalization options for default rendering.
   */
  normalization?: {
    vmin?: number;
    vmax?: number;
  };

  /**
   * Colormap function for default rendering.
   * Maps a normalized value (0-255) to an RGBA color.
   * If not provided, a grayscale colormap is used.
   */
  colormap?: ColormapFunction;

  /**
   * Enable debug visualization showing the triangulation mesh.
   * @default false
   */
  debug?: boolean;

  /**
   * Opacity of the debug mesh overlay (0-1).
   * @default 0.5
   */
  debugOpacity?: number;

  /**
   * Called when the Zarr metadata has been loaded and parsed.
   */
  onZarrLoad?: (
    metadata: ZarrMultiscaleMetadata,
    options: {
      bounds: Bounds;
      tileMatrixSet: TileMatrixSet;
    },
  ) => void;

  /**
   * A user-provided AbortSignal to cancel loading.
   */
  signal?: AbortSignal;

  /**
   * ID of a Mapbox/MapLibre style layer to render before.
   * Used when rendering interleaved with Mapbox/MapLibre GL.
   */
  beforeId?: string;
}

const defaultProps: Partial<ZarrLayerProps> = {
  debug: false,
  debugOpacity: 0.5,
  maxError: 0.125,
};

/**
 * ZarrLayer renders a Zarr array using a tiled approach with reprojection.
 */
export class ZarrLayer<
  DataT extends MinimalDataT = DefaultDataT,
> extends CompositeLayer<ZarrLayerProps<DataT>> {
  static override layerName = "ZarrLayer";
  static override defaultProps = defaultProps;

  declare state: {
    forwardReproject?: ReprojectionFns["forwardReproject"];
    inverseReproject?: ReprojectionFns["inverseReproject"];
    metadata?: TileMatrixSet;
    zarrMetadata?: ZarrMultiscaleMetadata;
    formatDescriptor?: FormatDescriptor;
    bounds?: Bounds;
    sortedLevels?: SortedLevel[];
    root?: zarr.Location<Readable>;
    projectionInfo?: ProjectionInfo;
    /** Whether row 0 is south (latitude ascending) */
    latIsAscending?: boolean;
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps, changeFlags } = params;

    const needsUpdate =
      Boolean(changeFlags.dataChanged) ||
      props.source !== oldProps.source ||
      props.variable !== oldProps.variable ||
      props.version !== oldProps.version ||
      props.crs !== oldProps.crs ||
      props.spatialDimensions !== oldProps.spatialDimensions;

    if (needsUpdate) {
      this._parseZarr();
    }
  }

  async _parseZarr(): Promise<void> {
    const {
      source,
      variable,
      version,
      crs,
      proj4def,
      spatialDimensions,
      signal,
    } = this.props;

    // Create root location
    const root = typeof source === "string"
      ? await createZarritaRoot(source)
      : zarr.root(source);

    // Parse metadata - only URL strings are supported for now
    if (typeof source !== "string") {
      throw new Error("ZarrLayer currently only supports URL strings as source");
    }

    const zarrMetadata = await parseZarrMetadata(source, {
      variable,
      version,
      spatialDimensions,
      crs,
      proj4: proj4def,
    });

    // Check for abort
    if (signal?.aborted) {
      return;
    }

    // Create FormatDescriptor - this auto-populates bounds for tiled formats
    // and crs.def for standard CRS codes
    const formatDescriptor = createFormatDescriptor(zarrMetadata, { proj4def });

    // Get bounds - FormatDescriptor already handles tiled format defaults
    let bounds = formatDescriptor.bounds;
    let latIsAscending = formatDescriptor.latIsAscending;

    if (!bounds) {
      // Try to compute bounds from spatial:transform if available
      const boundsFromTransform = computeBoundsFromSpatialTransform(zarrMetadata);
      if (boundsFromTransform) {
        bounds = boundsFromTransform.bounds;
        latIsAscending = boundsFromTransform.latIsAscending;
      } else {
        // Fall back to loading from coordinate arrays
        // Find the highest resolution (finest) level to derive accurate bounds
        const highestResLevel = zarrMetadata.levels.reduce((best, level) => {
          const levelRes = Math.max(level.resolution[0], level.resolution[1]);
          const bestRes = Math.max(best.resolution[0], best.resolution[1]);
          return levelRes < bestRes ? level : best;
        }, zarrMetadata.levels[0]!);

        const coordResult = await loadCoordinateBounds({
          root,
          version: zarrMetadata.version,
          dimensions: zarrMetadata.base.dimensions,
          spatialDimIndices: zarrMetadata.base.spatialDimIndices,
          levelPath: highestResLevel.path,
        });

        if (coordResult) {
          bounds = coordResult.bounds;
          latIsAscending = coordResult.latIsAscending;
        } else {
          throw new Error(
            "Could not determine spatial bounds from Zarr metadata, spatial:transform, or coordinates",
          );
        }
      }
    }

    // Check for abort
    if (signal?.aborted) {
      return;
    }

    // Create TileMatrixSet
    const { tileMatrixSet, sortedLevels } = await parseZarrTileMatrixSet(
      zarrMetadata,
      bounds,
      latIsAscending,
      formatDescriptor,
      { crs },
    );

    // Create reprojection functions using the resolved CRS definition from tileMatrixSet
    const { forwardReproject, inverseReproject } = createReprojectionFns(
      tileMatrixSet.crs.def,
    );

    // Use projection info already resolved by parseZarrTileMatrixSet
    const projectionInfo = tileMatrixSet.crs;

    // Extract normalized bounds from tileMatrixSet.boundingBox
    // This ensures 0-360° longitude is converted to -180/180° for geographic CRS
    const bbox = tileMatrixSet.boundingBox;
    const normalizedBounds: Bounds = bbox
      ? [bbox.lowerLeft[0], bbox.lowerLeft[1], bbox.upperRight[0], bbox.upperRight[1]]
      : bounds;

    // Callback
    if (this.props.onZarrLoad) {
      this.props.onZarrLoad(zarrMetadata, {
        bounds: normalizedBounds,
        tileMatrixSet,
      });
    }

    this.setState({
      metadata: tileMatrixSet,
      zarrMetadata,
      formatDescriptor,
      bounds: normalizedBounds,
      sortedLevels,
      root,
      forwardReproject,
      inverseReproject,
      projectionInfo,
      latIsAscending,
    });
  }

  /**
   * Inner callback passed in to the underlying TileLayer's `getTileData`.
   */
  async _getTileData(
    tile: TileLoadProps,
  ): Promise<GetTileDataResult<DataT>> {
    const { signal } = tile;
    const { x, y, z } = tile.index;
    const { dimensionIndices, normalization, colormap } = this.props;
    const { metadata, zarrMetadata, sortedLevels, root } = this.state;

    if (!metadata || !zarrMetadata || !sortedLevels || !root) {
      throw new Error("Zarr metadata not loaded");
    }

    const tileMatrix = metadata.tileMatrices[z]!;

    // Combine abort signals if both are defined
    const combinedSignal = this.props.signal
      ? AbortSignal.any([signal!, this.props.signal])
      : signal;

    // Load tile data from Zarr
    const tileData = await loadZarrTileData({
      x,
      y,
      z,
      tileMatrix,
      sortedLevels,
      root,
      metadata: zarrMetadata,
      dimensionIndices,
      signal: combinedSignal,
    });

    // Compute pixel window for this tile
    const { tileWidth, tileHeight } = tileMatrix;
    const sortedLevel = sortedLevels[z]!;
    const levelMeta = sortedLevel.level;
    const xDimIndex = zarrMetadata.base.spatialDimIndices.x ?? levelMeta.shape.length - 1;
    const yDimIndex = zarrMetadata.base.spatialDimIndices.y ?? levelMeta.shape.length - 2;
    const imageWidth = levelMeta.shape[xDimIndex]!;
    const imageHeight = levelMeta.shape[yDimIndex]!;

    const window: [number, number, number, number] = [
      x * tileWidth,
      y * tileHeight,
      Math.min((x + 1) * tileWidth, imageWidth),
      Math.min((y + 1) * tileHeight, imageHeight),
    ];

    // Use custom getTileData if provided
    let data: DataT;
    if (this.props.getTileData) {
      data = await this.props.getTileData(tileData, {
        device: this.context.device,
        window,
        signal: combinedSignal,
      });
    } else {
      // Default: render to ImageData
      const texture = renderZarrTileToImageData(tileData, {
        ...normalization,
        colormap,
      });
      data = {
        width: tileData.width,
        height: tileData.height,
        texture,
      } as unknown as DataT;
    }

    return {
      data,
      forwardTransform: tileData.forwardTransform,
      inverseTransform: tileData.inverseTransform,
    };
  }

  _renderSubLayers(
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
    const { projectionInfo, latIsAscending } = this.state;
    const { tile } = props;

    if (!props.data) {
      return null;
    }

    const { data, forwardTransform, inverseTransform } = props.data;

    const layers: Layer[] = [];

    if (data) {
      const { height, width } = data;
      const renderTile = this.props.renderTile || defaultRenderTile;

      // Check if source CRS supports GPU reprojection bypass
      const crsCode = projectionInfo?.code?.toUpperCase();
      const sourceCrs: SourceCrs =
        crsCode === "EPSG:4326" ? "EPSG:4326" :
        crsCode === "EPSG:3857" ? "EPSG:3857" :
        null;

      // Get tile bounds for GPU reprojection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const projectedBounds = (tile as any)?.projectedBounds;
      let tileBounds: { west: number; south: number; east: number; north: number } | undefined;
      let tileLatBounds: [number, number] | undefined;

      if (sourceCrs && projectedBounds) {
        const { topLeft, bottomRight } = projectedBounds;
        if (sourceCrs === "EPSG:4326") {
          // For EPSG:4326, coordinates are already in lon/lat
          tileBounds = {
            west: topLeft[0],
            east: bottomRight[0],
            north: topLeft[1],
            south: bottomRight[1],
          };
          tileLatBounds = [tileBounds.south, tileBounds.north];
        } else if (sourceCrs === "EPSG:3857") {
          // For EPSG:3857, convert to WGS84 bounds for positioning
          const topLeftWgs84 = metadata.projectToWgs84(topLeft);
          const bottomRightWgs84 = metadata.projectToWgs84(bottomRight);
          tileBounds = {
            west: topLeftWgs84[0],
            east: bottomRightWgs84[0],
            north: topLeftWgs84[1],
            south: bottomRightWgs84[1],
          };
        }
      }

      layers.push(
        new RasterLayer({
          id: `${props.id}-raster`,
          width,
          height,
          renderPipeline: renderTile(data),
          maxError,
          // Only provide reprojectionFns for non-GPU modes
          ...(sourceCrs ? {} : {
            reprojectionFns: {
              forwardTransform,
              inverseTransform,
              forwardReproject,
              inverseReproject,
            },
          }),
          // GPU reprojection props
          sourceCrs,
          bounds: tileBounds,
          latBounds: tileLatBounds,
          latIsAscending: latIsAscending ?? false,
          debug,
          debugOpacity,
        }),
      );
    }

    if (debug) {
      // Get projected bounds from tile data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const projectedBounds = (tile as any)?.projectedBounds;

      if (!projectedBounds || !metadata) {
        return layers;
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
  ): TileLayer {
    // Create a factory class that wraps RasterTileset2D with the metadata
    class RasterTileset2DFactory extends RasterTileset2D {
      constructor(opts: Tileset2DProps) {
        super(metadata, opts);
      }
    }

    return new TileLayer<GetTileDataResult<DataT>>({
      id: `zarr-tile-layer-${this.id}`,
      TilesetClass: RasterTileset2DFactory,
      getTileData: async (tile) => this._getTileData(tile),
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
    const { forwardReproject, inverseReproject, metadata } = this.state;

    if (!forwardReproject || !inverseReproject || !metadata) {
      return null;
    }

    return this.renderTileLayer(
      metadata,
      forwardReproject,
      inverseReproject,
    );
  }
}

/**
 * Default render function for tile data.
 */
function defaultRenderTile<DataT extends MinimalDataT>(
  data: DataT,
): ImageData | RasterModule[] {
  if ("texture" in data && data.texture instanceof ImageData) {
    return data.texture;
  }
  throw new Error("Default renderTile requires data.texture to be ImageData");
}

/**
 * Compute bounds from spatial:transform metadata if available.
 *
 * The spatial:transform is a 6-element affine: [a, b, c, d, e, f]
 * where: x' = a*col + b*row + c, y' = d*col + e*row + f
 *
 * Combined with spatial:shape [height, width], we can compute the full extent.
 *
 * Assumes center-based pixel registration (common for scientific data like
 * NetCDF/xarray) where (c, f) is the CENTER of pixel (0, 0). We apply a
 * half-pixel shift to convert to edge-based bounds for rendering.
 */
function computeBoundsFromSpatialTransform(
  metadata: ZarrMultiscaleMetadata,
): { bounds: Bounds; latIsAscending: boolean } | null {
  // Find levels that have a valid spatial:transform
  const levelsWithTransform = metadata.levels.filter(
    (level) => level.spatialTransform && level.spatialTransform.length === 6
  );

  if (levelsWithTransform.length === 0) {
    return null;
  }

  // Find the finest (highest resolution) level to get the most accurate bounds
  // Coarser levels may have accumulated rounding error from pyramid generation
  const finestLevel = levelsWithTransform.reduce((best, level) => {
    const levelMaxRes = Math.max(level.resolution[0], level.resolution[1]);
    const bestMaxRes = Math.max(best.resolution[0], best.resolution[1]);
    return levelMaxRes < bestMaxRes ? level : best;
  }, levelsWithTransform[0]!);

  const transform = finestLevel.spatialTransform!;
  const a = transform[0]!; // x pixel width
  const b = transform[1]!; // rotation (typically 0)
  const c = transform[2]!; // x origin (center of pixel 0,0)
  const d = transform[3]!; // rotation (typically 0)
  const e = transform[4]!; // y pixel height (typically negative)
  const f = transform[5]!; // y origin (center of pixel 0,0)

  // Get shape - prefer spatialShape if available, otherwise use level shape
  let height: number;
  let width: number;

  if (finestLevel.spatialShape) {
    [height, width] = finestLevel.spatialShape;
  } else if (finestLevel.shape.length >= 2) {
    // Use last two dimensions as spatial (Y, X)
    const yIdx = metadata.base.spatialDimIndices.y ?? finestLevel.shape.length - 2;
    const xIdx = metadata.base.spatialDimIndices.x ?? finestLevel.shape.length - 1;
    height = finestLevel.shape[yIdx]!;
    width = finestLevel.shape[xIdx]!;
  } else {
    return null;
  }

  // Apply half-pixel shift: (c, f) is the CENTER of pixel (0, 0)
  // We need the CORNER of pixel (0, 0) for edge-based bounds
  // corner = center - 0.5 * pixel_size (accounting for rotation terms)
  const originX = c - 0.5 * a - 0.5 * b;
  const originY = f - 0.5 * d - 0.5 * e;

  // Compute corners using the edge-based origin
  const x0 = originX;
  const y0 = originY;
  const x1 = a * width + b * height + originX;
  const y1 = d * width + e * height + originY;

  // Determine bounds order and lat orientation
  const xMin = Math.min(x0, x1);
  const xMax = Math.max(x0, x1);
  const yMin = Math.min(y0, y1);
  const yMax = Math.max(y0, y1);

  // latIsAscending: if e > 0, then y increases with row (row 0 = south)
  const latIsAscending = e > 0;

  return {
    bounds: [xMin, yMin, xMax, yMax],
    latIsAscending,
  };
}
