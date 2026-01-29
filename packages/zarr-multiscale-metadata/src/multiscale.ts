/**
 * @module multiscale
 *
 * Multiscale format detection and parsing.
 * Supports zarr-conventions, OME-NGFF, and ndpyramid tiled formats.
 */

import type {
  MultiscaleFormat,
  ZarrLevelMetadata,
  ZarrConventionsMultiscale,
  ZarrConventionsLayoutEntry,
  OmeNgffMultiscale,
  OmeNgffDataset,
  NdpyramidTiledMultiscale,
  NdpyramidTiledDataset,
  CRSInfo,
  ZarrV3ArrayMetadata,
  ZarrV3GroupMetadata,
  ZarrV2ConsolidatedMetadata,
} from './types'
import { extractCrsFromZarrConventions, extractCrsFromOmeNgff } from './crs'
import { normalizeFillValue } from './parser'

/**
 * Result of multiscale parsing.
 */
export interface MultiscaleParseResult {
  /** Detected format */
  format: MultiscaleFormat
  /** Ordered level paths (finest resolution first for untiled, coarsest first for tiled) */
  levelPaths: string[]
  /** Level metadata with resolution info (may be partial if shapes unavailable) */
  levels: ZarrLevelMetadata[]
  /** CRS if detected from multiscale metadata */
  crs: CRSInfo | null
  /** Tile size for tiled pyramids */
  tileSize?: number
}

/**
 * Detect the multiscale format from root attributes.
 */
export function detectMultiscaleFormat(
  multiscales: unknown
): MultiscaleFormat {
  if (!multiscales) {
    return 'single-level'
  }

  // zarr-conventions: has 'layout' key
  if (
    typeof multiscales === 'object' &&
    'layout' in multiscales &&
    Array.isArray((multiscales as { layout: unknown }).layout)
  ) {
    return 'zarr-conventions'
  }

  // Array-based formats (OME-NGFF or ndpyramid tiled)
  if (Array.isArray(multiscales) && multiscales[0]?.datasets) {
    const datasets = multiscales[0].datasets as NdpyramidTiledDataset[]
    // If any dataset has pixels_per_tile, it's ndpyramid tiled
    if (datasets.some((d) => d.pixels_per_tile !== undefined)) {
      return 'ndpyramid-tiled'
    }
    return 'ome-ngff'
  }

  return 'single-level'
}

/**
 * Parse zarr-conventions/multiscales format.
 *
 * @see https://github.com/zarr-conventions/multiscales
 */
export function parseZarrConventions(
  multiscales: ZarrConventionsMultiscale,
  variable: string,
  consolidatedMetadata: Record<string, ZarrV3ArrayMetadata> | null
): MultiscaleParseResult {
  const layout = multiscales.layout
  if (!layout || layout.length === 0) {
    return {
      format: 'zarr-conventions',
      levelPaths: [],
      levels: [],
      crs: extractCrsFromZarrConventions(multiscales),
    }
  }

  const levelPaths = layout.map((entry) => entry.asset)
  const levels: ZarrLevelMetadata[] = layout.map((entry) =>
    parseZarrConventionsLevel(entry, variable, consolidatedMetadata)
  )

  return {
    format: 'zarr-conventions',
    levelPaths,
    levels,
    crs: extractCrsFromZarrConventions(multiscales),
  }
}

/**
 * Parse a single zarr-conventions level entry.
 */
function parseZarrConventionsLevel(
  entry: ZarrConventionsLayoutEntry,
  variable: string,
  consolidatedMetadata: Record<string, ZarrV3ArrayMetadata> | null
): ZarrLevelMetadata {
  const level: ZarrLevelMetadata = {
    path: entry.asset,
    shape: [],
    chunks: [],
    resolution: entry.transform?.scale ?? [1.0, 1.0],
  }

  // Extract absolute spatial positioning fields (per spec)
  // These are at the layout entry level, outside the transform object
  const spatialTransform = entry['spatial:transform']
  const spatialShape = entry['spatial:shape']

  if (spatialTransform && Array.isArray(spatialTransform) && spatialTransform.length === 6) {
    level.spatialTransform = spatialTransform
  }
  if (spatialShape && Array.isArray(spatialShape) && spatialShape.length === 2) {
    level.spatialShape = spatialShape as [number, number]
  }

  // Try to extract metadata from consolidated metadata
  if (consolidatedMetadata) {
    const arrayKey = `${entry.asset}/${variable}`
    const arrayMeta = consolidatedMetadata[arrayKey]
    if (arrayMeta) {
      level.shape = arrayMeta.shape
      level.chunks = extractChunks(arrayMeta)
      level.dtype = arrayMeta.data_type
      level.fillValue = normalizeFillValue(arrayMeta.fill_value)

      // Extract scale_factor/add_offset based on dtype
      const transforms = extractDataTransforms(arrayMeta)
      if (transforms.scaleFactor !== undefined) {
        level.scaleFactor = transforms.scaleFactor
      }
      if (transforms.addOffset !== undefined) {
        level.addOffset = transforms.addOffset
      }
    }
  }

  return level
}

/**
 * Parse OME-NGFF multiscale format.
 *
 * @see https://ngff.openmicroscopy.org/latest/
 */
export function parseOmeNgff(
  multiscales: OmeNgffMultiscale[],
  variable: string,
  consolidatedMetadata: Record<string, ZarrV3ArrayMetadata> | null
): MultiscaleParseResult {
  const ms = multiscales[0]
  if (!ms?.datasets?.length) {
    return {
      format: 'ome-ngff',
      levelPaths: [],
      levels: [],
      crs: null,
    }
  }

  const levelPaths = ms.datasets.map((d) => d.path)
  const levels: ZarrLevelMetadata[] = ms.datasets.map((dataset, index) =>
    parseOmeNgffLevel(dataset, variable, consolidatedMetadata, ms, index)
  )

  // Try to extract CRS from datasets (non-standard extension)
  const crs = extractCrsFromOmeNgff(
    ms.datasets as Array<{ crs?: string }>
  )

  return {
    format: 'ome-ngff',
    levelPaths,
    levels,
    crs,
  }
}

/**
 * Parse a single OME-NGFF level entry.
 */
function parseOmeNgffLevel(
  dataset: OmeNgffDataset,
  variable: string,
  consolidatedMetadata: Record<string, ZarrV3ArrayMetadata> | null,
  multiscale: OmeNgffMultiscale,
  levelIndex: number
): ZarrLevelMetadata {
  // Calculate resolution from coordinate transformations
  const resolution = extractOmeNgffResolution(dataset, multiscale, levelIndex)

  const level: ZarrLevelMetadata = {
    path: dataset.path,
    shape: [],
    chunks: [],
    resolution,
  }

  // Try to extract metadata from consolidated metadata
  if (consolidatedMetadata) {
    const arrayKey = `${dataset.path}/${variable}`
    const arrayMeta = consolidatedMetadata[arrayKey]
    if (arrayMeta) {
      level.shape = arrayMeta.shape
      level.chunks = extractChunks(arrayMeta)
      level.dtype = arrayMeta.data_type
      level.fillValue = normalizeFillValue(arrayMeta.fill_value)

      const transforms = extractDataTransforms(arrayMeta)
      if (transforms.scaleFactor !== undefined) {
        level.scaleFactor = transforms.scaleFactor
      }
      if (transforms.addOffset !== undefined) {
        level.addOffset = transforms.addOffset
      }
    }
  }

  return level
}

/**
 * Extract resolution from OME-NGFF coordinate transformations.
 *
 * Per OME-NGFF spec, each dataset should have its own coordinateTransformations
 * specifying the exact scale for that level. The spec does NOT mandate power-of-2
 * scaling between levels.
 *
 * Priority:
 * 1. Dataset-level coordinateTransformations (exact per-level scale)
 * 2. Multiscale-level coordinateTransformations as base (no assumed scaling factor)
 * 3. Default to 1.0 (will be computed from bounds/shape later)
 */
function extractOmeNgffResolution(
  dataset: OmeNgffDataset,
  multiscale: OmeNgffMultiscale,
  _levelIndex: number // Preserved for API compatibility but no longer used for power-of-2 assumption
): [number, number] {
  // Try dataset-level transforms first (most accurate per spec)
  const datasetScale = dataset.coordinateTransformations?.find(
    (t) => t.type === 'scale'
  )
  if (datasetScale?.scale && datasetScale.scale.length >= 2) {
    const len = datasetScale.scale.length
    // Last two dimensions are typically Y, X (or Z, Y for 3D)
    return [datasetScale.scale[len - 1], datasetScale.scale[len - 2]]
  }

  // Fall back to multiscale-level transforms as base resolution
  // NOTE: Previously assumed power-of-2 scaling (factor = 2^levelIndex),
  // but OME-NGFF spec doesn't mandate this. Each dataset should have its
  // own explicit coordinateTransformations if different from base.
  const msScale = multiscale.coordinateTransformations?.find(
    (t) => t.type === 'scale'
  )
  if (msScale?.scale && msScale.scale.length >= 2) {
    const len = msScale.scale.length
    // Use base scale without assuming power-of-2 multiplication
    // If this level differs, it should have dataset-level transforms (handled above)
    return [msScale.scale[len - 1], msScale.scale[len - 2]]
  }

  // Default resolution (will be computed from bounds/shape later by caller)
  return [1.0, 1.0]
}

/**
 * Parse ndpyramid tiled pyramid format.
 * Used with ndpyramid/@carbonplan/maps.
 */
export function parseNdpyramidTiled(
  multiscales: NdpyramidTiledMultiscale[],
  variable: string,
  consolidatedMetadata: Record<string, ZarrV3ArrayMetadata> | null
): MultiscaleParseResult {
  const ms = multiscales[0]
  if (!ms?.datasets?.length) {
    return {
      format: 'ndpyramid-tiled',
      levelPaths: [],
      levels: [],
      crs: null,
    }
  }

  const datasets = ms.datasets
  const levelPaths = datasets.map((d) => String(d.path))
  const tileSize = datasets[0].pixels_per_tile ?? 128

  // Extract CRS from metadata if present, otherwise null
  const crsCode = datasets[0].crs?.toUpperCase() ?? null

  const levels: ZarrLevelMetadata[] = datasets.map((dataset, index) =>
    parseNdpyramidTiledLevel(
      dataset,
      variable,
      consolidatedMetadata,
      tileSize,
      index
    )
  )

  return {
    format: 'ndpyramid-tiled',
    levelPaths,
    levels,
    crs: crsCode
      ? {
          code: crsCode,
          proj4def: null,
          source: 'explicit',
        }
      : null,
    tileSize,
  }
}

/**
 * Parse a single ndpyramid tiled level.
 *
 * Computes default shape/chunks from tile size and level index for standard
 * slippy map pyramids. These may be overridden by consolidated metadata
 * if available (which can include additional non-spatial dimensions).
 */
function parseNdpyramidTiledLevel(
  dataset: NdpyramidTiledDataset,
  variable: string,
  consolidatedMetadata: Record<string, ZarrV3ArrayMetadata> | null,
  tileSize: number,
  levelIndex: number
): ZarrLevelMetadata {
  // Compute expected shape for standard slippy map pyramid
  // At level N, there are 2^N tiles per dimension, each of tileSize pixels
  const levelSize = tileSize * Math.pow(2, levelIndex)

  const level: ZarrLevelMetadata = {
    path: String(dataset.path),
    shape: [levelSize, levelSize],
    chunks: [tileSize, tileSize],
    resolution: [1.0, 1.0], // Placeholder - consumer should compute from bounds/shape
  }

  // Override with actual metadata if available from V3 consolidated
  if (consolidatedMetadata) {
    const arrayKey = `${dataset.path}/${variable}`
    const arrayMeta = consolidatedMetadata[arrayKey]
    if (arrayMeta) {
      level.shape = arrayMeta.shape
      level.chunks = extractChunks(arrayMeta)
      level.dtype = arrayMeta.data_type
      level.fillValue = normalizeFillValue(arrayMeta.fill_value)

      const transforms = extractDataTransforms(arrayMeta)
      if (transforms.scaleFactor !== undefined) {
        level.scaleFactor = transforms.scaleFactor
      }
      if (transforms.addOffset !== undefined) {
        level.addOffset = transforms.addOffset
      }
    }
  }

  return level
}

/**
 * Extract chunk shape from array metadata.
 * Handles regular chunks, sharding, and legacy formats.
 */
function extractChunks(meta: ZarrV3ArrayMetadata): number[] {
  // Check for sharding codec
  const shardingCodec = meta.codecs?.find((c) => c.name === 'sharding_indexed')
  if (shardingCodec?.configuration?.chunk_shape) {
    return shardingCodec.configuration.chunk_shape
  }

  // Regular chunk_grid
  if (meta.chunk_grid?.configuration?.chunk_shape) {
    return meta.chunk_grid.configuration.chunk_shape
  }

  // Legacy top-level chunks
  if (Array.isArray(meta.chunks)) {
    return meta.chunks
  }

  // Fall back to shape (unchunked)
  return meta.shape
}

/**
 * Extract scale_factor and add_offset from array attributes.
 * Only returns values if explicitly present in metadata.
 */
function extractDataTransforms(
  meta: ZarrV3ArrayMetadata
): { scaleFactor?: number; addOffset?: number } {
  const attrs = meta.attributes
  const result: { scaleFactor?: number; addOffset?: number } = {}

  if (attrs?.scale_factor !== undefined) {
    result.scaleFactor = attrs.scale_factor as number
  }
  if (attrs?.add_offset !== undefined) {
    result.addOffset = attrs.add_offset as number
  }

  return result
}


/**
 * Get consolidated array metadata from group metadata.
 * Handles both V2 (.zmetadata) and V3 (zarr.json with consolidated_metadata).
 *
 * For V2, converts .zarray entries to V3-compatible format for uniform handling.
 */
export function getConsolidatedMetadata(
  metadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null
): Record<string, ZarrV3ArrayMetadata> | null {
  if (!metadata) return null

  // V3 consolidated
  const v3 = metadata as ZarrV3GroupMetadata
  if (v3.consolidated_metadata?.metadata) {
    return v3.consolidated_metadata.metadata
  }

  // V2 consolidated (.zmetadata)
  const v2 = metadata as ZarrV2ConsolidatedMetadata
  if (v2.metadata) {
    // Convert V2 .zarray entries to V3-compatible format
    const result: Record<string, ZarrV3ArrayMetadata> = {}

    for (const [key, value] of Object.entries(v2.metadata)) {
      // Match keys like "level/variable/.zarray"
      if (key.endsWith('/.zarray')) {
        const arrayPath = key.slice(0, -'/.zarray'.length)
        const zarray = value as {
          shape?: number[]
          chunks?: number[]
          dtype?: string
          fill_value?: unknown
        }
        const attrsKey = `${arrayPath}/.zattrs`
        const zattrs = (v2.metadata[attrsKey] ?? {}) as Record<string, unknown>

        result[arrayPath] = {
          shape: zarray.shape ?? [],
          chunks: zarray.chunks,
          data_type: zarray.dtype ?? '',
          fill_value: zarray.fill_value,
          attributes: zattrs,
        } as ZarrV3ArrayMetadata
      }
    }

    return Object.keys(result).length > 0 ? result : null
  }

  return null
}
