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

// Main parser
export { parseZarrMetadata, createZarritaRoot } from './parser'

// Format descriptor
export {
  createFormatDescriptor,
  createExplicitFormatDescriptor,
  isTiledDescriptor,
  requiresProj4Reprojection,
  isStandardCrs,
  type FormatDescriptor,
  type TileConvention,
} from './format-descriptor'

// Metadata cache
export {
  getCachedMetadata,
  setCachedMetadata,
  hasCachedMetadata,
  clearMetadataCache,
} from './cache'

// Coordinate loading utilities
export {
  loadCoordinateBounds,
  findHighestResolutionLevel,
  type CoordinateBoundsResult,
  type LoadCoordinateBoundsOptions,
} from './coordinates'

// Dimension utilities
export {
  identifySpatialDimensions,
  buildDimensionInfo,
  isSpatialDimension,
  getSpatialDimensionKey,
} from './dimensions'

// CRS utilities
export {
  extractCrsFromZarrConventions,
  extractCrsFromOmeNgff,
  extractCrsFromGridMapping,
  extractCrsFromGroupAttributes,
  findGridMapping,
  createExplicitCrs,
} from './crs'

// Multiscale utilities
export {
  detectMultiscaleFormat,
  parseZarrConventions,
  parseOmeNgff,
  parseNdpyramidTiled,
  getConsolidatedMetadata,
  type MultiscaleParseResult,
} from './multiscale'

// Constants
export { SPATIAL_DIMENSION_ALIASES, SPATIAL_DIM_NAMES } from './constants'

// Standard CRS definitions
export {
  STANDARD_CRS,
  TILED_BOUNDS,
  getStandardCRS,
  getTiledBounds,
  type StandardCRSDef,
} from './crs-defs'

// Type exports
export type {
  // Core output types
  ZarrMultiscaleMetadata,
  ZarrArrayMetadata,
  ZarrLevelMetadata,
  MultiscaleFormat,
  Bounds,
  CRSInfo,
  DimensionInfo,
  SpatialDimIndices,

  // Parser options
  ParseOptions,
  SpatialDimensionOverrides,
  MetadataStore,

  // Raw Zarr metadata types
  ZarrV2ConsolidatedMetadata,
  ZarrV2ArrayMetadata,
  ZarrV2Attributes,
  ZarrV3GroupMetadata,
  ZarrV3ArrayMetadata,

  // Multiscale format types
  ZarrConventionsMultiscale,
  ZarrConventionsLayoutEntry,
  OmeNgffMultiscale,
  OmeNgffDataset,
  OmeNgffAxis,
  OmeNgffCoordinateSystem,
  NdpyramidTiledMultiscale,
  NdpyramidTiledDataset,

  // CF conventions
  CFGridMappingAttributes,
} from './types'
