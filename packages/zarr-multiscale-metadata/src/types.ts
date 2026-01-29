/**
 * @module types
 *
 * Type definitions for Zarr metadata parsing.
 * Provides a unified representation for geospatial Zarr datasets
 * regardless of the underlying multiscale format.
 */

// =============================================================================
// Core Output Types (what the library produces)
// =============================================================================

/** Bounds tuple: [xMin, yMin, xMax, yMax] in CRS units */
export type Bounds = [number, number, number, number]

/** CRS information extracted from metadata */
export interface CRSInfo {
  /** CRS code (e.g., 'EPSG:4326', 'EPSG:32632') or null if unknown */
  code: string | null
  /** Proj4 definition string for custom CRS, or null */
  proj4def: string | null
  /** Source of CRS information */
  source: 'explicit' | 'grid_mapping' | 'inferred' | 'default'
}

/** Information about a dimension in the array */
export interface DimensionInfo {
  /** Dimension name as it appears in the dataset */
  name: string
  /** Index of this dimension in the shape array */
  index: number
  /** Size of this dimension */
  size: number
}

/** Spatial dimension indices */
export interface SpatialDimIndices {
  /** X (longitude) dimension index, or null if not found */
  x: number | null
  /** Y (latitude) dimension index, or null if not found */
  y: number | null
}

/**
 * Metadata for a single Zarr array level.
 * Contains all information needed for visualization and data access.
 */
export interface ZarrArrayMetadata {
  /** Path to this array within the Zarr store (e.g., '0/variable', 'variable') */
  path: string

  /** Array shape (number of elements per dimension) */
  shape: number[]

  /** Chunk shape for this array */
  chunks: number[]

  /** Data type string (e.g., 'float32', '<f4', 'int16') */
  dtype: string

  /** Fill value for missing data */
  fillValue: number | null

  /** Dimension names (e.g., ['time', 'lat', 'lon']) */
  dimensions: string[]

  /** Indices of spatial dimensions within the shape array */
  spatialDimIndices: SpatialDimIndices

  /** Data transform: physical = raw * scaleFactor + addOffset. Undefined if not in metadata. */
  scaleFactor?: number

  /** Data transform: physical = raw * scaleFactor + addOffset. Undefined if not in metadata. */
  addOffset?: number
}

/**
 * Metadata for a single level in a multiscale pyramid.
 * Extends base array metadata with resolution information.
 */
export interface ZarrLevelMetadata {
  /** Path to this level (e.g., '0', '1', 'surface') */
  path: string

  /** Array shape at this level */
  shape: number[]

  /** Chunk shape at this level (for viewport intersection calculations) */
  chunks: number[]

  /** Resolution in CRS units per pixel: [xRes, yRes] */
  resolution: [number, number]

  /**
   * Absolute spatial transform (6-element affine matrix).
   * Format: [a, b, c, d, e, f] where:
   * - x' = a*col + b*row + c
   * - y' = d*col + e*row + f
   * @see spatial:transform in zarr-conventions/multiscales
   */
  spatialTransform?: number[]

  /**
   * Pixel dimensions [height, width] for absolute positioning.
   * @see spatial:shape in zarr-conventions/multiscales
   */
  spatialShape?: [number, number]

  /** Per-level scale factor override (undefined = use base level value) */
  scaleFactor?: number

  /** Per-level add offset override (undefined = use base level value) */
  addOffset?: number

  /** Per-level dtype override (undefined = use base level value) */
  dtype?: string

  /** Per-level fill value override (undefined = use base level value) */
  fillValue?: number | null
}

/**
 * Detected multiscale format.
 *
 * - 'zarr-conventions': Uses `layout` array with transform info
 * - 'ome-ngff': Uses `coordinateSystems` + `datasets` arrays
 * - 'ndpyramid-tiled': Slippy-map aligned tiles with `pixels_per_tile`
 * - 'single-level': No multiscale metadata, single array
 */
export type MultiscaleFormat =
  | 'zarr-conventions'
  | 'ome-ngff'
  | 'ndpyramid-tiled'
  | 'single-level'

/**
 * Complete multiscale metadata for a Zarr dataset.
 * This is the primary output of the metadata parser.
 */
export interface ZarrMultiscaleMetadata {
  /** Zarr version detected (2 or 3) */
  version: 2 | 3

  /** Detected multiscale format */
  format: MultiscaleFormat

  /** Base (highest resolution) level metadata */
  base: ZarrArrayMetadata

  /** All pyramid levels, ordered by resolution (finest first) */
  levels: ZarrLevelMetadata[]

  /** Coordinate reference system information, or null if not determinable from metadata */
  crs: CRSInfo | null

  /**
   * Spatial bounds in CRS units.
   * null if bounds couldn't be determined from metadata alone.
   * Use loadCoordinateBounds() to fetch from coordinate arrays.
   */
  bounds: Bounds | null

  /**
   * Whether latitude values are ascending (row 0 = south).
   * null if orientation couldn't be determined.
   * Use loadCoordinateBounds() to detect from coordinate arrays.
   */
  latIsAscending: boolean | null

  /**
   * Tile size for tiled pyramids (pixels_per_tile).
   * Only set for 'ndpyramid-tiled' format.
   */
  tileSize?: number
}

// =============================================================================
// Input Types (raw Zarr metadata structures)
// =============================================================================

/** Zarr V2 consolidated metadata (.zmetadata) */
export interface ZarrV2ConsolidatedMetadata {
  metadata: Record<string, unknown>
  zarr_consolidated_format?: number
}

/** Zarr V2 array metadata (.zarray) */
export interface ZarrV2ArrayMetadata {
  shape: number[]
  chunks: number[]
  fill_value: number | null | string
  dtype: string
  compressor?: unknown
  filters?: unknown[]
  order?: 'C' | 'F'
}

/** Zarr V2 attributes (.zattrs) */
export interface ZarrV2Attributes {
  _ARRAY_DIMENSIONS?: string[]
  multiscales?: unknown
  scale_factor?: number
  add_offset?: number
  grid_mapping?: string
  [key: string]: unknown
}

/** Zarr V3 array metadata (zarr.json for arrays) */
export interface ZarrV3ArrayMetadata {
  zarr_format: 3
  node_type: 'array'
  shape: number[]
  dimension_names?: string[]
  data_type?: string
  fill_value: number | null | string
  chunk_grid?: {
    name?: string
    configuration?: {
      chunk_shape?: number[]
    }
  }
  chunks?: number[] // Legacy pre-spec field
  codecs?: Array<{
    name: string
    configuration?: {
      chunk_shape?: number[]
      [key: string]: unknown
    }
  }>
  attributes?: Record<string, unknown>
}

/** Zarr V3 group metadata (zarr.json for groups) */
export interface ZarrV3GroupMetadata {
  zarr_format: 3
  node_type: 'group'
  attributes?: {
    multiscales?: unknown
    [key: string]: unknown
  }
  consolidated_metadata?: {
    metadata?: Record<string, ZarrV3ArrayMetadata>
  }
}

// =============================================================================
// Multiscale Format Types
// =============================================================================

/**
 * zarr-conventions/multiscales format entry.
 * @see https://github.com/zarr-conventions/multiscales
 */
export interface ZarrConventionsLayoutEntry {
  asset: string
  transform?: {
    scale?: [number, number]
    translation?: [number, number]
  }
  derived_from?: string
  /** Absolute positioning: 6-element affine matrix [a, b, c, d, e, f] */
  'spatial:transform'?: number[]
  /** Pixel dimensions [height, width] for absolute positioning */
  'spatial:shape'?: [number, number]
}

/**
 * zarr-conventions/multiscales root attributes.
 */
export interface ZarrConventionsMultiscale {
  layout: ZarrConventionsLayoutEntry[]
  resampling_method?: string
  crs?: 'EPSG:4326' | 'EPSG:3857' | string
}

/**
 * OME-NGFF dataset entry.
 * @see https://ngff.openmicroscopy.org/latest/
 */
export interface OmeNgffDataset {
  path: string
  coordinateTransformations?: Array<{
    type: 'scale' | 'translation'
    scale?: number[]
    translation?: number[]
  }>
}

/**
 * OME-NGFF axis definition.
 */
export interface OmeNgffAxis {
  name: string
  type?: 'space' | 'time' | 'channel'
  unit?: string
}

/**
 * OME-NGFF coordinate system.
 */
export interface OmeNgffCoordinateSystem {
  name: string
  axes: OmeNgffAxis[]
}

/**
 * OME-NGFF multiscale entry.
 */
export interface OmeNgffMultiscale {
  datasets: OmeNgffDataset[]
  axes?: OmeNgffAxis[]
  coordinateSystems?: OmeNgffCoordinateSystem[]
  coordinateTransformations?: Array<{
    type: 'scale' | 'translation'
    scale?: number[]
    translation?: number[]
  }>
  name?: string
  type?: string
  version?: string
}

/**
 * ndpyramid tiled pyramid dataset entry.
 * Used with ndpyramid/@carbonplan/maps.
 */
export interface NdpyramidTiledDataset {
  path: string
  pixels_per_tile?: number
  crs?: string
  level?: number
}

/**
 * ndpyramid tiled multiscale attributes.
 */
export interface NdpyramidTiledMultiscale {
  datasets: NdpyramidTiledDataset[]
}

// =============================================================================
// CF Conventions Types
// =============================================================================

/**
 * CF grid_mapping variable attributes.
 * @see http://cfconventions.org/Data/cf-conventions/cf-conventions-1.10/cf-conventions.html#appendix-grid-mappings
 */
export interface CFGridMappingAttributes {
  grid_mapping_name?: string
  crs_wkt?: string
  semi_major_axis?: number
  semi_minor_axis?: number
  inverse_flattening?: number
  longitude_of_prime_meridian?: number
  longitude_of_central_meridian?: number
  latitude_of_projection_origin?: number
  scale_factor_at_central_meridian?: number
  false_easting?: number
  false_northing?: number
  standard_parallel?: number | number[]
  [key: string]: unknown
}

// =============================================================================
// Parser Options
// =============================================================================

/**
 * Options for overriding automatic detection.
 */
export interface SpatialDimensionOverrides {
  /** Override the dimension name used as latitude/y */
  lat?: string
  /** Override the dimension name used as longitude/x */
  lon?: string
}

/**
 * Options for the metadata parser.
 */
export interface ParseOptions {
  /** Variable name to extract metadata for */
  variable: string

  /** Force a specific Zarr version instead of auto-detecting */
  version?: 2 | 3

  /** Override spatial dimension name detection */
  spatialDimensions?: SpatialDimensionOverrides

  /** Explicit CRS to use instead of auto-detecting */
  crs?: string

  /** Explicit proj4 definition for custom CRS */
  proj4?: string

  /**
   * Source URL for caching purposes.
   * Required when passing a store instance to enable metadata caching.
   * When passing a URL string, this is inferred automatically.
   */
  sourceUrl?: string

  /**
   * Pre-loaded group metadata to use instead of fetching.
   * Pass this when you already have metadata from a consolidated store
   * to avoid duplicate network requests for .zmetadata or zarr.json.
   */
  preloadedMetadata?: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata
}

// =============================================================================
// Fetch Store Types
// =============================================================================

/**
 * Minimal store interface for fetching metadata.
 * Compatible with zarrita's FetchStore.
 */
export interface MetadataStore {
  get(path: string): Promise<Uint8Array | undefined>
}
