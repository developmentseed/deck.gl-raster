/**
 * Zarr tile data loading utilities.
 *
 * Handles loading tile data from Zarr arrays using zarrita.
 */

import type { TileMatrix } from "@developmentseed/deck.gl-raster";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type {
  ZarrArrayMetadata,
  ZarrLevelMetadata,
  ZarrMultiscaleMetadata,
} from "zarr-multiscale-metadata";
import type { Readable, Slice } from "zarrita";
import * as zarr from "zarrita";
import type { SortedLevel } from "./types.js";
import { fromGeoTransform } from "./zarr-reprojection.js";

/**
 * Options for loading Zarr tile data.
 */
export interface LoadZarrTileDataOptions {
  /** Tile x coordinate */
  x: number;
  /** Tile y coordinate */
  y: number;
  /** Tile matrix set z-level */
  z: number;
  /** TileMatrix for this z-level */
  tileMatrix: TileMatrix;
  /** Sorted levels for TMS index to Zarr path mapping */
  sortedLevels: SortedLevel[];
  /** Zarrita root location */
  root: zarr.Location<Readable>;
  /** Zarr multiscale metadata */
  metadata: ZarrMultiscaleMetadata;
  /** Fixed dimension indices (e.g., { time: 0, band: 2 }) */
  dimensionIndices?: Record<string, number>;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result from loading a Zarr tile.
 */
export interface ZarrTileData {
  /** Tile data as TypedArray */
  data:
    | Float32Array
    | Float64Array
    | Int32Array
    | Uint32Array
    | Int16Array
    | Uint16Array
    | Int8Array
    | Uint8Array;
  /** Tile width in pixels */
  width: number;
  /** Tile height in pixels */
  height: number;
  /** Data type */
  dtype: string;
  /** Fill value for nodata */
  fillValue: number | null;
  /** Scale factor for data transform */
  scaleFactor?: number;
  /** Add offset for data transform */
  addOffset?: number;
  /** Forward transform (pixel to CRS) */
  forwardTransform: ReprojectionFns["forwardTransform"];
  /** Inverse transform (CRS to pixel) */
  inverseTransform: ReprojectionFns["inverseTransform"];
}

/**
 * Load tile data from a Zarr array.
 */
export async function loadZarrTileData(
  options: LoadZarrTileDataOptions,
): Promise<ZarrTileData> {
  const {
    x,
    y,
    z,
    tileMatrix,
    sortedLevels,
    root,
    metadata,
    dimensionIndices = {},
    signal,
  } = options;

  // Map TMS z-index to Zarr level
  const sortedLevel = sortedLevels[z];
  if (!sortedLevel) {
    throw new Error(`Invalid z-level: ${z}`);
  }

  const levelMeta = sortedLevel.level;
  const levelPath = sortedLevel.zarrPath;

  // Construct the full path to the array
  // For zarr-conventions: levelPath/variableName (e.g., "0/elevation")
  // For ome-ngff: levelPath (array is directly at level path)
  // For ndpyramid-tiled: levelPath/variableName (e.g., "0/climate")
  // For single-level: use basePath directly (e.g., "2m_above_ground/TMP/2m_above_ground/TMP")
  //
  // Some datasets have OME-NGFF-style metadata but nested arrays like zarr-conventions.
  // We detect this by checking if base.path contains a "/" indicating the variable is nested.
  const basePath = metadata.base.path;
  const basePathParts = basePath.split("/");
  const variableName = basePathParts[basePathParts.length - 1];

  // Check if the base path indicates nested structure (e.g., "12/BP" vs just "BP")
  const isNestedStructure = basePathParts.length > 1;

  // Construct full array path for this level
  let arrayPath: string;
  if (metadata.format === "single-level") {
    // Single-level: use the full base path directly
    arrayPath = basePath;
  } else if (metadata.format === "ome-ngff" && !isNestedStructure) {
    // Pure OME-NGFF: array is directly at level path
    arrayPath = levelPath;
  } else {
    // zarr-conventions, ndpyramid-tiled, or nested OME-NGFF: levelPath/variableName
    arrayPath = `${levelPath}/${variableName}`;
  }

  // Open the array
  const arr = await zarr.open(root.resolve(arrayPath), { kind: "array" });

  // Check for abort
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Build slice spec
  const slices = buildSliceSpec(
    x,
    y,
    tileMatrix,
    levelMeta,
    metadata.base,
    dimensionIndices,
  );

  // Fetch the data
  const result = await zarr.get(arr, slices);

  // Check for abort
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Get the typed array data
  const data = result.data as ZarrTileData["data"];

  // Compute actual tile dimensions (may be smaller at edges)
  const { tileWidth, tileHeight } = tileMatrix;
  const xDimIndex =
    metadata.base.spatialDimIndices.x ?? levelMeta.shape.length - 1;
  const yDimIndex =
    metadata.base.spatialDimIndices.y ?? levelMeta.shape.length - 2;
  const imageWidth = levelMeta.shape[xDimIndex]!;
  const imageHeight = levelMeta.shape[yDimIndex]!;

  const actualWidth = Math.min(tileWidth, imageWidth - x * tileWidth);
  const actualHeight = Math.min(tileHeight, imageHeight - y * tileHeight);

  // Compute tile-specific geotransform (offset from level geotransform)
  const tileGeotransform = computeTileGeotransform(x, y, tileMatrix);
  const { forwardTransform, inverseTransform } =
    fromGeoTransform(tileGeotransform);

  // Get data transform parameters
  const scaleFactor = levelMeta.scaleFactor ?? metadata.base.scaleFactor;
  const addOffset = levelMeta.addOffset ?? metadata.base.addOffset;
  const fillValue = levelMeta.fillValue ?? metadata.base.fillValue;
  const dtype = levelMeta.dtype ?? metadata.base.dtype;

  return {
    data,
    width: actualWidth,
    height: actualHeight,
    dtype,
    fillValue,
    scaleFactor,
    addOffset,
    forwardTransform,
    inverseTransform,
  };
}

/**
 * Build zarrita slice specification for a tile.
 */
function buildSliceSpec(
  x: number,
  y: number,
  tileMatrix: TileMatrix,
  levelMeta: ZarrLevelMetadata,
  baseMeta: ZarrArrayMetadata,
  dimensionIndices: Record<string, number>,
): (number | Slice | null)[] {
  const { tileWidth, tileHeight } = tileMatrix;
  const dimensions = baseMeta.dimensions;
  const spatialDimIndices = baseMeta.spatialDimIndices;

  const xDimIndex = spatialDimIndices.x ?? dimensions.length - 1;
  const yDimIndex = spatialDimIndices.y ?? dimensions.length - 2;

  // Get image dimensions at this level
  const imageWidth = levelMeta.shape[xDimIndex]!;
  const imageHeight = levelMeta.shape[yDimIndex]!;

  // Calculate pixel window
  const xStart = x * tileWidth;
  const yStart = y * tileHeight;
  const xEnd = Math.min(xStart + tileWidth, imageWidth);
  const yEnd = Math.min(yStart + tileHeight, imageHeight);

  // Build slices for each dimension
  const slices: (number | Slice | null)[] = [];

  for (let i = 0; i < dimensions.length; i++) {
    const dimName = dimensions[i]!;

    if (i === xDimIndex) {
      // X (longitude) dimension - use window slice
      slices.push(zarr.slice(xStart, xEnd));
    } else if (i === yDimIndex) {
      // Y (latitude) dimension - use window slice
      slices.push(zarr.slice(yStart, yEnd));
    } else if (dimName in dimensionIndices) {
      // Fixed index for non-spatial dimension
      slices.push(dimensionIndices[dimName]!);
    } else {
      // Default to first index for any other dimension
      slices.push(0);
    }
  }

  return slices;
}

/**
 * Compute the affine geotransform for a specific tile.
 *
 * Offsets the level's geotransform to the tile's pixel origin.
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

  // Compute tile origin by applying the geotransform to the tile's pixel offset
  const xCoordOffset = a * xPixelOrigin + b * yPixelOrigin + c;
  const yCoordOffset = d * xPixelOrigin + e * yPixelOrigin + f;

  return [a, b, xCoordOffset, d, e, yCoordOffset];
}

/**
 * Default render function: convert Zarr data to ImageData.
 *
 * Applies scale factor and add offset transforms, maps values to grayscale.
 */
export function renderZarrTileToImageData(
  tileData: ZarrTileData,
  options?: {
    /** Minimum value for normalization (default: data min) */
    vmin?: number;
    /** Maximum value for normalization (default: data max) */
    vmax?: number;
    /** Colormap function (value 0-255 -> [r, g, b, a]) */
    colormap?: (value: number) => [number, number, number, number];
  },
): ImageData {
  const {
    data,
    width,
    height,
    fillValue,
    scaleFactor = 1,
    addOffset = 0,
  } = tileData;
  const { vmin, vmax, colormap } = options ?? {};

  // Apply transforms and find range
  const values = new Float32Array(data.length);
  let dataMin = Infinity;
  let dataMax = -Infinity;

  for (let i = 0; i < data.length; i++) {
    const raw = data[i]!;
    if (fillValue !== null && raw === fillValue) {
      values[i] = NaN;
      continue;
    }
    const transformed = raw * scaleFactor + addOffset;
    values[i] = transformed;
    if (transformed < dataMin) dataMin = transformed;
    if (transformed > dataMax) dataMax = transformed;
  }

  const minVal = vmin ?? dataMin;
  const maxVal = vmax ?? dataMax;
  const range = maxVal - minVal || 1;

  // Create ImageData
  const imageData = new ImageData(width, height);
  const pixels = imageData.data;

  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    const pixelOffset = i * 4;

    if (Number.isNaN(value)) {
      // Transparent for nodata
      pixels[pixelOffset] = 0;
      pixels[pixelOffset + 1] = 0;
      pixels[pixelOffset + 2] = 0;
      pixels[pixelOffset + 3] = 0;
    } else {
      // Normalize to 0-255
      const normalized = Math.max(
        0,
        Math.min(255, ((value - minVal) / range) * 255),
      );

      if (colormap) {
        const [r, g, b, a] = colormap(normalized);
        pixels[pixelOffset] = r;
        pixels[pixelOffset + 1] = g;
        pixels[pixelOffset + 2] = b;
        pixels[pixelOffset + 3] = a;
      } else {
        // Grayscale
        pixels[pixelOffset] = normalized;
        pixels[pixelOffset + 1] = normalized;
        pixels[pixelOffset + 2] = normalized;
        pixels[pixelOffset + 3] = 255;
      }
    }
  }

  return imageData;
}
