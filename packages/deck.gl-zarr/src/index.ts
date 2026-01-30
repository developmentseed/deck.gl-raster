/**
 * @developmentseed/deck.gl-zarr
 *
 * Zarr visualization in deck.gl with automatic reprojection support.
 */

// Re-export commonly used types from zarr-metadata
export type {
  Bounds,
  CRSInfo,
  FormatDescriptor,
  MultiscaleFormat,
  TileConvention,
  ZarrArrayMetadata,
  ZarrLevelMetadata,
  ZarrMultiscaleMetadata,
} from "zarr-multiscale-metadata";
// Re-export zarr-metadata functions for convenience
export {
  createFormatDescriptor,
  createZarritaRoot,
  loadCoordinateBounds,
  parseZarrMetadata,
  STANDARD_CRS,
  TILED_BOUNDS,
} from "zarr-multiscale-metadata";
export type {
  ColormapFunction,
  ParseZarrTileMatrixSetOptions,
  SortedLevel,
  ZarrTileMatrixSetResult,
} from "./types.js";
export type {
  LoadZarrTileDataOptions,
  ZarrTileData,
} from "./zarr-data-loader.js";

// Data loading utilities
export {
  loadZarrTileData,
  renderZarrTileToImageData,
} from "./zarr-data-loader.js";
export type {
  DefaultDataT,
  GetTileDataOptions,
  MinimalDataT,
  ZarrLayerProps,
} from "./zarr-layer.js";
// Main layer export
export { ZarrLayer } from "./zarr-layer.js";
// Reprojection utilities
export {
  computeGeotransformFromBounds,
  createReprojectionFns,
  fromGeoTransform,
  OGC_84,
} from "./zarr-reprojection.js";
// TileMatrixSet conversion
export { parseZarrTileMatrixSet } from "./zarr-tile-matrix-set.js";
