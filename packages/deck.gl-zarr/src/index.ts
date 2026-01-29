/**
 * @developmentseed/deck.gl-zarr
 *
 * Zarr visualization in deck.gl with automatic reprojection support.
 */

// Main layer export
export { ZarrLayer } from "./zarr-layer.js";
export type {
  ZarrLayerProps,
  MinimalDataT,
  DefaultDataT,
  GetTileDataOptions,
} from "./zarr-layer.js";

// TileMatrixSet conversion
export { parseZarrTileMatrixSet } from "./zarr-tile-matrix-set.js";
export type {
  ColormapFunction,
  ParseZarrTileMatrixSetOptions,
  SortedLevel,
  ZarrTileMatrixSetResult,
} from "./types.js";

// Data loading utilities
export {
  loadZarrTileData,
  renderZarrTileToImageData,
} from "./zarr-data-loader.js";
export type {
  LoadZarrTileDataOptions,
  ZarrTileData,
} from "./zarr-data-loader.js";

// Reprojection utilities
export {
  fromGeoTransform,
  createReprojectionFns,
  computeGeotransformFromBounds,
  OGC_84,
} from "./zarr-reprojection.js";

// Re-export commonly used types from zarr-metadata
export type {
  ZarrMultiscaleMetadata,
  ZarrArrayMetadata,
  ZarrLevelMetadata,
  Bounds,
  CRSInfo,
  MultiscaleFormat,
  FormatDescriptor,
  TileConvention,
} from "zarr-multiscale-metadata";

// Re-export zarr-metadata functions for convenience
export {
  parseZarrMetadata,
  loadCoordinateBounds,
  createZarritaRoot,
  createFormatDescriptor,
  STANDARD_CRS,
  TILED_BOUNDS,
} from "zarr-multiscale-metadata";
