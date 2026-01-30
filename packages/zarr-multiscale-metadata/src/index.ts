/**
 * zarr-multiscale-metadata
 *
 * Shared Zarr metadata parsing library for geospatial applications.
 * Parses V2/V3 multiscale formats and extracts CRS, bounds, and pyramid structure.
 *
 * @example
 * ```typescript
 * import {
 *   parseZarrMetadata,
 *   loadCoordinateBounds,
 *   createZarritaRoot
 * } from 'zarr-multiscale-metadata'
 *
 * // Parse metadata from URL
 * const metadata = await parseZarrMetadata(
 *   'https://example.com/data.zarr',
 *   { variable: 'temperature' }
 * )
 *
 * // Optionally load bounds from coordinate arrays
 * if (!metadata.bounds) {
 *   const root = await createZarritaRoot('https://example.com/data.zarr')
 *   const coordResult = await loadCoordinateBounds({
 *     root,
 *     version: metadata.version,
 *     dimensions: metadata.base.dimensions,
 *     spatialDimIndices: metadata.base.spatialDimIndices,
 *   })
 *   if (coordResult) {
 *     console.log('Bounds:', coordResult.bounds)
 *     console.log('Lat ascending:', coordResult.latIsAscending)
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

// Metadata cache
export {
  clearMetadataCache,
  getCachedMetadata,
  hasCachedMetadata,
  setCachedMetadata,
} from "./cache";
// Constants
export { SPATIAL_DIM_NAMES, SPATIAL_DIMENSION_ALIASES } from "./constants";
// Coordinate loading utilities
export {
  type CoordinateBoundsResult,
  findHighestResolutionLevel,
  type LoadCoordinateBoundsOptions,
  loadCoordinateBounds,
} from "./coordinates";
// CRS utilities
export {
  createExplicitCrs,
  extractCrsFromGridMapping,
  extractCrsFromGroupAttributes,
  extractCrsFromOmeNgff,
  extractCrsFromZarrConventions,
  findGridMapping,
} from "./crs";
// Standard CRS definitions
export {
  getStandardCRS,
  getTiledBounds,
  STANDARD_CRS,
  type StandardCRSDef,
  TILED_BOUNDS,
} from "./crs-defs";
// Dimension utilities
export {
  buildDimensionInfo,
  getSpatialDimensionKey,
  identifySpatialDimensions,
  isSpatialDimension,
} from "./dimensions";
// Format descriptor
export {
  createExplicitFormatDescriptor,
  createFormatDescriptor,
  type FormatDescriptor,
  isStandardCrs,
  isTiledDescriptor,
  requiresProj4Reprojection,
  type TileConvention,
} from "./format-descriptor";
// Multiscale utilities
export {
  detectMultiscaleFormat,
  getConsolidatedMetadata,
  type MultiscaleParseResult,
  parseNdpyramidTiled,
  parseOmeNgff,
  parseZarrConventions,
} from "./multiscale";
// Main parser
export { createZarritaRoot, parseZarrMetadata } from "./parser";

// Type exports
export type {
  Bounds,
  // CF conventions
  CFGridMappingAttributes,
  CRSInfo,
  DimensionInfo,
  MetadataStore,
  MultiscaleFormat,
  NdpyramidTiledDataset,
  NdpyramidTiledMultiscale,
  OmeNgffAxis,
  OmeNgffCoordinateSystem,
  OmeNgffDataset,
  OmeNgffMultiscale,
  // Parser options
  ParseOptions,
  SpatialDimensionOverrides,
  SpatialDimIndices,
  ZarrArrayMetadata,
  ZarrConventionsLayoutEntry,
  // Multiscale format types
  ZarrConventionsMultiscale,
  ZarrLevelMetadata,
  // Core output types
  ZarrMultiscaleMetadata,
  ZarrV2ArrayMetadata,
  ZarrV2Attributes,
  // Raw Zarr metadata types
  ZarrV2ConsolidatedMetadata,
  ZarrV3ArrayMetadata,
  ZarrV3GroupMetadata,
} from "./types";
