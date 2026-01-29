/**
 * @module parser
 *
 * Main Zarr metadata parser.
 * Combines V2/V3 loading, multiscale detection, and CRS extraction.
 */

import * as zarr from 'zarrita'
import type { Readable, AsyncReadable } from 'zarrita'
import type {
  ZarrMultiscaleMetadata,
  ZarrArrayMetadata,
  ZarrLevelMetadata,
  ZarrV2ConsolidatedMetadata,
  ZarrV2ArrayMetadata,
  ZarrV2Attributes,
  ZarrV3GroupMetadata,
  ZarrV3ArrayMetadata,
  ZarrConventionsMultiscale,
  OmeNgffMultiscale,
  NdpyramidTiledMultiscale,
  ParseOptions,
  MetadataStore,
  CRSInfo,
  MultiscaleFormat,
} from './types'
import { identifySpatialDimensions } from './dimensions'
import {
  detectMultiscaleFormat,
  parseZarrConventions,
  parseOmeNgff,
  parseNdpyramidTiled,
  getConsolidatedMetadata,
} from './multiscale'
import {
  findGridMapping,
  extractCrsFromGroupAttributes,
  createExplicitCrs,
} from './crs'
import { getCachedMetadata, setCachedMetadata } from './cache'

const textDecoder = new TextDecoder()

/**
 * Decode bytes to JSON.
 */
function decodeJSON(bytes: Uint8Array | undefined): unknown {
  if (!bytes) return null
  return JSON.parse(textDecoder.decode(bytes))
}

/**
 * Get the source URL from input (for cache key purposes).
 */
function getSourceUrl(
  source: string | MetadataStore,
  options: ParseOptions
): string | null {
  if (typeof source === 'string') {
    return source
  }
  // For stores, use optional sourceUrl from options
  return options.sourceUrl ?? null
}

/**
 * Parse Zarr metadata from a store URL or store instance.
 *
 * This is the main entry point for the library. It:
 * 1. Loads and parses Zarr V2 or V3 metadata
 * 2. Detects multiscale format (zarr-conventions, OME-NGFF, ndpyramid tiled)
 * 3. Extracts CRS information
 * 4. Returns a unified ZarrMultiscaleMetadata structure
 *
 * @param source - URL string or zarrita-compatible store
 * @param options - Parse options including variable name
 * @returns Parsed metadata ready for visualization
 */
export async function parseZarrMetadata(
  source: string | MetadataStore,
  options: ParseOptions
): Promise<ZarrMultiscaleMetadata> {
  const { variable, version, spatialDimensions, crs, proj4, preloadedMetadata } = options
  const sourceUrl = getSourceUrl(source, options)

  // Create store from URL or use provided store
  const store =
    typeof source === 'string' ? new zarr.FetchStore(source) : source

  // Load metadata (with caching), using preloaded metadata if provided
  const { metadata: groupMetadata, detectedVersion } = await loadMetadata(
    store,
    version ?? null,
    sourceUrl,
    preloadedMetadata
  )

  // Extract multiscale attributes
  const multiscales = extractMultiscales(groupMetadata)
  const format = detectMultiscaleFormat(multiscales)

  // Parse format-specific metadata
  const consolidatedMeta = getConsolidatedMetadata(groupMetadata)
  const parseResult = parseMultiscaleByFormat(
    format,
    multiscales,
    variable,
    consolidatedMeta
  )

  // Get base level metadata
  const basePath = parseResult.levelPaths[0] ?? ''
  const baseArrayMetadata = await loadArrayMetadata(
    store,
    basePath,
    variable,
    detectedVersion,
    groupMetadata
  )

  // Identify spatial dimensions
  const spatialDimIndices = identifySpatialDimensions(
    baseArrayMetadata.dimensions,
    spatialDimensions
  )

  // Determine CRS with priority:
  // 1. User-provided explicit CRS
  // 2. CRS from multiscale metadata (e.g., multiscales.crs)
  // 3. proj:code at group level (per zarr-conventions spec)
  // 4. CF grid_mapping from array attributes
  // 5. null (consumer decides what to do)
  let crsInfo: CRSInfo | null = null
  if (crs) {
    crsInfo = createExplicitCrs(crs, proj4)
  } else if (parseResult.crs) {
    crsInfo = parseResult.crs
  } else {
    // Try proj:code at group level (per spec)
    const groupLevelCrs = extractCrsFromGroupAttributes(groupMetadata)
    if (groupLevelCrs) {
      crsInfo = groupLevelCrs
    } else {
      // Try CF grid_mapping
      const arrayAttrs = await loadArrayAttributes(
        store,
        basePath,
        variable,
        detectedVersion,
        groupMetadata
      )
      crsInfo = findGridMapping(arrayAttrs, groupMetadata)
    }
  }

  // Build base array metadata
  const base: ZarrArrayMetadata = {
    path: basePath ? `${basePath}/${variable}` : variable,
    shape: baseArrayMetadata.shape,
    chunks: baseArrayMetadata.chunks,
    dtype: baseArrayMetadata.dtype,
    fillValue: baseArrayMetadata.fillValue,
    dimensions: baseArrayMetadata.dimensions,
    spatialDimIndices,
    scaleFactor: baseArrayMetadata.scaleFactor,
    addOffset: baseArrayMetadata.addOffset,
  }

  // Build level metadata with shapes
  const levels = await buildLevelMetadata(
    parseResult.levels,
    variable,
    detectedVersion,
    groupMetadata,
    store,
    base
  )

  return {
    version: detectedVersion,
    format,
    base,
    levels,
    crs: crsInfo,
    bounds: null, // Must be loaded separately via loadCoordinateBounds()
    latIsAscending: null, // Must be detected separately
    tileSize: parseResult.tileSize,
  }
}

/**
 * Load metadata with caching support.
 * Handles both V2 and V3, with auto-detection if version not specified.
 * If preloadedMetadata is provided, uses it directly without fetching.
 */
async function loadMetadata(
  store: Readable | AsyncReadable<RequestInit>,
  version: 2 | 3 | null,
  sourceUrl: string | null,
  preloadedMetadata?: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata
): Promise<{
  metadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata
  detectedVersion: 2 | 3
}> {
  // Use preloaded metadata if provided (avoids duplicate .zmetadata fetch)
  if (preloadedMetadata) {
    const isV3 = 'node_type' in preloadedMetadata || ('zarr_format' in preloadedMetadata && (preloadedMetadata as { zarr_format?: number }).zarr_format === 3)
    const detectedVersion = isV3 ? 3 : (version ?? 2)
    // Cache it for future use
    if (sourceUrl) setCachedMetadata(sourceUrl, preloadedMetadata)
    return {
      metadata: preloadedMetadata,
      detectedVersion: detectedVersion as 2 | 3,
    }
  }

  // Check cache first
  if (sourceUrl) {
    const cached = getCachedMetadata(sourceUrl)
    if (cached) {
      // Determine version from cached metadata
      const isV3 = 'node_type' in cached || 'zarr_format' in cached
      return {
        metadata: cached,
        detectedVersion: isV3 ? 3 : 2,
      }
    }
  }

  if (version === 3) {
    const metadata = await loadV3Metadata(store)
    if (sourceUrl) setCachedMetadata(sourceUrl, metadata)
    return { metadata, detectedVersion: 3 }
  }

  if (version === 2) {
    const metadata = await loadV2Metadata(store)
    if (sourceUrl) setCachedMetadata(sourceUrl, metadata)
    return { metadata, detectedVersion: 2 }
  }

  // Auto-detect: try V3 first, then V2
  try {
    const metadata = await loadV3Metadata(store)
    if (sourceUrl) setCachedMetadata(sourceUrl, metadata)
    return { metadata, detectedVersion: 3 }
  } catch {
    const metadata = await loadV2Metadata(store)
    if (sourceUrl) setCachedMetadata(sourceUrl, metadata)
    return { metadata, detectedVersion: 2 }
  }
}

/**
 * Load Zarr V2 consolidated metadata.
 */
async function loadV2Metadata(
  store: Readable | AsyncReadable<RequestInit>
): Promise<ZarrV2ConsolidatedMetadata> {
  // Try .zmetadata first (consolidated)
  try {
    const bytes = await store.get('/.zmetadata')
    if (bytes) {
      return decodeJSON(bytes) as ZarrV2ConsolidatedMetadata
    }
  } catch {
    // Fall through
  }

  // Fall back to just .zattrs
  try {
    const zattrs = await store.get('/.zattrs')
    return {
      metadata: { '.zattrs': zattrs ? decodeJSON(zattrs) : {} },
    }
  } catch {
    return { metadata: { '.zattrs': {} } }
  }
}

/**
 * Load Zarr V3 metadata.
 */
async function loadV3Metadata(
  store: Readable | AsyncReadable<RequestInit>
): Promise<ZarrV3GroupMetadata> {
  const bytes = await store.get('/zarr.json')
  if (!bytes) {
    throw new Error('No zarr.json found')
  }
  return decodeJSON(bytes) as ZarrV3GroupMetadata
}

/**
 * Extract multiscales from group metadata.
 */
function extractMultiscales(
  metadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null
): unknown {
  if (!metadata) return null

  // V3: attributes.multiscales
  const v3 = metadata as ZarrV3GroupMetadata
  if (v3.attributes?.multiscales) {
    return v3.attributes.multiscales
  }

  // V2: .zattrs.multiscales
  const v2 = metadata as ZarrV2ConsolidatedMetadata
  const zattrs = v2.metadata?.['.zattrs'] as ZarrV2Attributes | undefined
  if (zattrs?.multiscales) {
    return zattrs.multiscales
  }

  return null
}

/**
 * Parse multiscale metadata by detected format.
 */
function parseMultiscaleByFormat(
  format: MultiscaleFormat,
  multiscales: unknown,
  variable: string,
  consolidatedMeta: Record<string, ZarrV3ArrayMetadata> | null
) {
  switch (format) {
    case 'zarr-conventions':
      return parseZarrConventions(
        multiscales as ZarrConventionsMultiscale,
        variable,
        consolidatedMeta
      )
    case 'ome-ngff':
      return parseOmeNgff(
        multiscales as OmeNgffMultiscale[],
        variable,
        consolidatedMeta
      )
    case 'ndpyramid-tiled':
      return parseNdpyramidTiled(
        multiscales as NdpyramidTiledMultiscale[],
        variable,
        consolidatedMeta
      )
    default:
      return {
        format: 'single-level' as const,
        levelPaths: [''],
        levels: [],
        crs: null,
      }
  }
}

/**
 * Load array metadata for the base level.
 */
async function loadArrayMetadata(
  store: Readable | AsyncReadable<RequestInit>,
  levelPath: string,
  variable: string,
  version: 2 | 3,
  groupMetadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null
): Promise<{
  shape: number[]
  chunks: number[]
  dtype: string
  fillValue: number | null
  dimensions: string[]
  scaleFactor: number | undefined
  addOffset: number | undefined
}> {
  const arrayPath =
    variable.includes('/') || !levelPath ? variable : `${levelPath}/${variable}`

  if (version === 3) {
    return loadV3ArrayMetadata(store, arrayPath, groupMetadata)
  }
  return loadV2ArrayMetadata(store, arrayPath, groupMetadata)
}

/**
 * Load V2 array metadata.
 */
async function loadV2ArrayMetadata(
  store: Readable | AsyncReadable<RequestInit>,
  arrayPath: string,
  groupMetadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null
): Promise<{
  shape: number[]
  chunks: number[]
  dtype: string
  fillValue: number | null
  dimensions: string[]
  scaleFactor: number | undefined
  addOffset: number | undefined
}> {
  const v2 = groupMetadata as ZarrV2ConsolidatedMetadata

  // Try consolidated metadata first
  let zarray = v2?.metadata?.[`${arrayPath}/.zarray`] as
    | ZarrV2ArrayMetadata
    | undefined
  let zattrs = v2?.metadata?.[`${arrayPath}/.zattrs`] as
    | ZarrV2Attributes
    | undefined

  // Fall back to network requests
  if (!zarray) {
    const bytes = await store.get(`/${arrayPath}/.zarray`)
    zarray = bytes ? (decodeJSON(bytes) as ZarrV2ArrayMetadata) : undefined
  }
  if (!zattrs) {
    try {
      const bytes = await store.get(`/${arrayPath}/.zattrs`)
      zattrs = bytes ? (decodeJSON(bytes) as ZarrV2Attributes) : {}
    } catch {
      zattrs = {}
    }
  }

  if (!zarray) {
    throw new Error(`Array metadata not found at ${arrayPath}`)
  }

  return {
    shape: zarray.shape,
    chunks: zarray.chunks,
    dtype: zarray.dtype,
    fillValue: normalizeFillValue(zarray.fill_value),
    dimensions: zattrs?._ARRAY_DIMENSIONS ?? [],
    scaleFactor: zattrs?.scale_factor,
    addOffset: zattrs?.add_offset,
  }
}

/**
 * Load V3 array metadata.
 */
async function loadV3ArrayMetadata(
  store: Readable | AsyncReadable<RequestInit>,
  arrayPath: string,
  groupMetadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null
): Promise<{
  shape: number[]
  chunks: number[]
  dtype: string
  fillValue: number | null
  dimensions: string[]
  scaleFactor: number | undefined
  addOffset: number | undefined
}> {
  const v3 = groupMetadata as ZarrV3GroupMetadata

  // Try consolidated metadata first
  let arrayMeta = v3?.consolidated_metadata?.metadata?.[arrayPath]

  // Fall back to network request
  if (!arrayMeta) {
    const bytes = await store.get(`/${arrayPath}/zarr.json`)
    arrayMeta = bytes ? (decodeJSON(bytes) as ZarrV3ArrayMetadata) : undefined
  }

  if (!arrayMeta) {
    throw new Error(`Array metadata not found at ${arrayPath}`)
  }

  // Extract chunks
  const isSharded = arrayMeta.codecs?.[0]?.name === 'sharding_indexed'
  const shardedChunks = isSharded
    ? (arrayMeta.codecs?.[0]?.configuration?.chunk_shape as number[] | undefined)
    : undefined
  const gridChunks = arrayMeta.chunk_grid?.configuration?.chunk_shape
  const legacyChunks = Array.isArray(arrayMeta.chunks) ? arrayMeta.chunks : undefined
  const chunks = shardedChunks ?? gridChunks ?? legacyChunks ?? arrayMeta.shape

  // Extract attributes
  const attrs = arrayMeta.attributes as Record<string, unknown> | undefined
  const legacyDims = Array.isArray(attrs?._ARRAY_DIMENSIONS)
    ? (attrs._ARRAY_DIMENSIONS as string[])
    : []

  return {
    shape: arrayMeta.shape,
    chunks,
    dtype: arrayMeta.data_type ?? '',
    fillValue: normalizeFillValue(arrayMeta.fill_value),
    dimensions: arrayMeta.dimension_names ?? legacyDims,
    scaleFactor: typeof attrs?.scale_factor === 'number' ? attrs.scale_factor : undefined,
    addOffset: typeof attrs?.add_offset === 'number' ? attrs.add_offset : undefined,
  }
}

/**
 * Load array attributes for CRS detection.
 */
async function loadArrayAttributes(
  store: Readable | AsyncReadable<RequestInit>,
  levelPath: string,
  variable: string,
  version: 2 | 3,
  groupMetadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null
): Promise<ZarrV2Attributes | Record<string, unknown>> {
  const arrayPath = levelPath ? `${levelPath}/${variable}` : variable

  if (version === 3) {
    const v3 = groupMetadata as ZarrV3GroupMetadata
    let arrayMeta = v3?.consolidated_metadata?.metadata?.[arrayPath]

    // Fall back to network request if not in consolidated metadata
    if (!arrayMeta) {
      try {
        const bytes = await store.get(`/${arrayPath}/zarr.json`)
        arrayMeta = bytes ? (decodeJSON(bytes) as ZarrV3ArrayMetadata) : undefined
      } catch {
        // Ignore fetch errors
      }
    }

    return arrayMeta?.attributes ?? {}
  }

  const v2 = groupMetadata as ZarrV2ConsolidatedMetadata
  let zattrs = v2?.metadata?.[`${arrayPath}/.zattrs`] as ZarrV2Attributes | undefined

  if (!zattrs) {
    try {
      const bytes = await store.get(`/${arrayPath}/.zattrs`)
      zattrs = bytes ? (decodeJSON(bytes) as ZarrV2Attributes) : {}
    } catch {
      zattrs = {}
    }
  }

  return zattrs ?? {}
}

/**
 * Build complete level metadata, filling in missing shapes from network requests if needed.
 */
async function buildLevelMetadata(
  partialLevels: ZarrLevelMetadata[],
  variable: string,
  version: 2 | 3,
  groupMetadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null,
  store: Readable | AsyncReadable<RequestInit>,
  base: ZarrArrayMetadata
): Promise<ZarrLevelMetadata[]> {
  // If no levels from multiscale, create single-level
  if (partialLevels.length === 0) {
    return [
      {
        path: '',
        shape: base.shape,
        chunks: base.chunks,
        resolution: [1.0, 1.0],
        scaleFactor: base.scaleFactor,
        addOffset: base.addOffset,
        dtype: base.dtype,
        fillValue: base.fillValue,
      },
    ]
  }

  // Fill in any missing metadata
  return Promise.all(
    partialLevels.map(async (level) => {
      if (level.shape.length > 0) {
        return level
      }

      // Load metadata for this level
      try {
        const meta = await loadArrayMetadata(
          store,
          level.path,
          variable,
          version,
          groupMetadata
        )
        return {
          ...level,
          shape: meta.shape,
          chunks: meta.chunks,
          dtype: level.dtype ?? meta.dtype,
          fillValue: level.fillValue ?? meta.fillValue,
          scaleFactor: level.scaleFactor ?? meta.scaleFactor,
          addOffset: level.addOffset ?? meta.addOffset,
        }
      } catch {
        // Use base level as fallback
        return {
          ...level,
          shape: base.shape,
          chunks: base.chunks,
        }
      }
    })
  )
}

/**
 * Normalize fill_value to number or null.
 */
export function normalizeFillValue(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (lower === 'nan') return Number.NaN
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'number') {
    return value
  }
  return null
}

/**
 * Create a zarrita root location for use with loadCoordinateBounds and tile loading.
 *
 * @param source - URL string to the Zarr store
 * @returns A zarrita Location suitable for coordinate and tile data loading
 */
export async function createZarritaRoot(
  source: string
): Promise<zarr.Location<Readable>> {
  const store = new zarr.FetchStore(source)

  // Use consolidated metadata for zarrita operations (coordinate loading, tile loading)
  // tryWithConsolidated reads .zmetadata once and serves metadata from it
  // Falls back gracefully to regular store if .zmetadata is absent
  const consolidatedStore = await zarr.tryWithConsolidated(store)
  return zarr.root(consolidatedStore)
}
