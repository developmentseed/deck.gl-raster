/**
 * @module coordinates
 *
 * Coordinate array loading utilities.
 * Provides optional helpers for fetching bounds and orientation from coordinate arrays.
 */

import * as zarr from 'zarrita'
import type { Readable } from 'zarrita'
import type {
  Bounds,
  SpatialDimIndices,
  ZarrV2ConsolidatedMetadata,
  ZarrV3GroupMetadata,
} from './types'

/**
 * Result of loading coordinate array bounds.
 */
export interface CoordinateBoundsResult {
  /** Spatial bounds: [xMin, yMin, xMax, yMax] in CRS units */
  bounds: Bounds
  /** Whether latitude values are ascending (row 0 = south) */
  latIsAscending: boolean
}

/**
 * Options for loading coordinate bounds.
 */
export interface LoadCoordinateBoundsOptions {
  /** Root zarrita location */
  root: zarr.Location<Readable>
  /** Zarr version (2, 3, or null for auto) */
  version: 2 | 3 | null
  /** Array dimension names */
  dimensions: string[]
  /** Spatial dimension indices */
  spatialDimIndices: SpatialDimIndices
  /** Consolidated metadata for optimized coordinate path finding */
  metadata?: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null
  /** Variable name (for finding level-specific coordinates) */
  variable?: string
  /** Specific level path to look for coordinates in */
  levelPath?: string
}

/**
 * Load spatial bounds from coordinate arrays.
 *
 * This is an optional helper for when bounds aren't available in metadata.
 * It fetches the first two and last values from coordinate arrays to determine
 * the spatial extent and latitude orientation.
 *
 * @param options - Configuration for coordinate loading
 * @returns Bounds and latIsAscending, or null if coordinates can't be loaded
 */
export async function loadCoordinateBounds(
  options: LoadCoordinateBoundsOptions
): Promise<CoordinateBoundsResult | null> {
  const {
    root,
    version,
    dimensions,
    spatialDimIndices,
    metadata,
    variable,
    levelPath,
  } = options

  if (spatialDimIndices.x === null || spatialDimIndices.y === null) {
    return null
  }

  const xDimName = dimensions[spatialDimIndices.x]
  const yDimName = dimensions[spatialDimIndices.y]

  if (!xDimName || !yDimName) {
    return null
  }

  try {
    // Find best coordinate array paths from metadata
    const xPath = findCoordinatePath(xDimName, metadata, levelPath, variable)
    const yPath = findCoordinatePath(yDimName, metadata, levelPath, variable)

    const openArray = createArrayOpener(version)

    // Open coordinate arrays
    const resolvedXPath = xPath ? xPath : (levelPath ? `${levelPath}/${xDimName}` : xDimName)
    const resolvedYPath = yPath ? yPath : (levelPath ? `${levelPath}/${yDimName}` : yDimName)

    const xArr = await openArray(root.resolve(resolvedXPath))
    const yArr = await openArray(root.resolve(resolvedYPath))

    const xLen = xArr.shape[0]
    const yLen = yArr.shape[0]

    // Fetch first two and last values from each coordinate array
    type ZarrResult = { data: ArrayLike<number> }
    const [xFirstTwo, xLast, yFirstTwo, yLast] = (await Promise.all([
      zarr.get(xArr, [zarr.slice(0, 2)]),
      zarr.get(xArr, [zarr.slice(xLen - 1, xLen)]),
      zarr.get(yArr, [zarr.slice(0, 2)]),
      zarr.get(yArr, [zarr.slice(yLen - 1, yLen)]),
    ])) as ZarrResult[]

    const x0 = xFirstTwo.data[0]
    const x1 = xFirstTwo.data[1] ?? x0
    const xN = xLast.data[0]
    const y0 = yFirstTwo.data[0]
    const y1 = yFirstTwo.data[1] ?? y0
    const yN = yLast.data[0]

    // Detect latIsAscending from first two y values
    const latIsAscending = y1 > y0

    // Calculate pixel spacing for half-pixel expansion
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)

    // Coordinate extents (pixel centers)
    const coordXMin = Math.min(x0, xN)
    const coordXMax = Math.max(x0, xN)
    const coordYMin = Math.min(y0, yN)
    const coordYMax = Math.max(y0, yN)

    // Apply half-pixel expansion (coords are pixel centers, we need edge bounds)
    const xMin = coordXMin - (Number.isFinite(dx) ? dx / 2 : 0)
    const xMax = coordXMax + (Number.isFinite(dx) ? dx / 2 : 0)
    const yMin = coordYMin - (Number.isFinite(dy) ? dy / 2 : 0)
    const yMax = coordYMax + (Number.isFinite(dy) ? dy / 2 : 0)

    const result = {
      bounds: [xMin, yMin, xMax, yMax] as Bounds,
      latIsAscending,
    }

    return result
  } catch (err) {
    return null
  }
}

/**
 * Find the best coordinate array path from consolidated metadata.
 * Prefers highest-resolution coordinate arrays.
 */
function findCoordinatePath(
  dimName: string,
  metadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null | undefined,
  levelPath?: string,
  variable?: string
): string | null {
  if (!metadata) {
    return null
  }

  interface CoordCandidate {
    path: string
    size: number
  }
  const candidates: CoordCandidate[] = []

  // V2: keys are like "lat/.zarray" or "surface/lat/.zarray"
  const v2Meta = metadata as ZarrV2ConsolidatedMetadata
  if (v2Meta.metadata) {
    const suffix = `/${dimName}/.zarray`
    const rootKey = `${dimName}/.zarray`
    for (const key of Object.keys(v2Meta.metadata)) {
      if (key === rootKey || key.endsWith(suffix)) {
        const meta = v2Meta.metadata[key] as { shape?: number[] }
        const size = meta.shape?.[0] ?? 0
        candidates.push({
          path: key.slice(0, -'/.zarray'.length),
          size,
        })
      }
    }
  }

  // V3: keys are like "lat" or "surface/lat" with node_type: 'array'
  const v3Meta = metadata as ZarrV3GroupMetadata
  if (v3Meta.consolidated_metadata?.metadata) {
    const suffix = `/${dimName}`
    for (const [key, value] of Object.entries(
      v3Meta.consolidated_metadata.metadata
    )) {
      if (
        (key === dimName || key.endsWith(suffix)) &&
        value.node_type === 'array'
      ) {
        const size = (value as { shape?: number[] }).shape?.[0] ?? 0
        candidates.push({ path: key, size })
      }
    }
  }

  if (candidates.length === 0) return null

  // Pick the largest (highest resolution) coordinate array
  const pickLargest = (list: CoordCandidate[]) => {
    if (list.length === 0) return null
    const sorted = [...list].sort((a, b) => b.size - a.size)
    return sorted[0].path
  }

  // Prefer coordinates within the specified level
  if (levelPath) {
    const levelPrefix = `${levelPath}/`
    const levelCandidates = candidates.filter((c) => c.path.startsWith(levelPrefix))
    const levelPick = pickLargest(levelCandidates)
    if (levelPick) return levelPick
  }

  // Fall back to root-level coordinates
  const rootCandidates = candidates.filter((c) => !c.path.includes('/'))
  const rootPick = pickLargest(rootCandidates)
  if (rootPick) return rootPick

  // Fall back to variable-prefixed coordinates
  if (variable) {
    const varCandidates = candidates.filter((c) => c.path.startsWith(`${variable}/`))
    const varPick = pickLargest(varCandidates)
    if (varPick) return varPick
  }

  return pickLargest(candidates)
}

/**
 * Create a zarr array opener function for the given version.
 */
function createArrayOpener(version: 2 | 3 | null) {
  return (loc: zarr.Location<Readable>) => {
    if (version === 2) return zarr.open.v2(loc, { kind: 'array' })
    if (version === 3) return zarr.open.v3(loc, { kind: 'array' })
    return zarr.open(loc, { kind: 'array' })
  }
}

/**
 * Find the highest resolution level path for coordinate loading.
 * Uses consolidated metadata to compare shapes without network requests.
 */
export function findHighestResolutionLevel(
  levelPaths: string[],
  variable: string,
  metadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null
): string | null {
  if (levelPaths.length === 0) return null
  if (levelPaths.length === 1) return levelPaths[0]
  if (!metadata) return levelPaths[0]

  let maxSize = 0
  let maxPath: string | null = null

  for (const path of levelPaths) {
    const size = getArraySize(path, variable, metadata)
    if (size > maxSize) {
      maxSize = size
      maxPath = path
    }
  }

  return maxPath ?? levelPaths[0]
}

/**
 * Get array size from consolidated metadata.
 */
function getArraySize(
  levelPath: string,
  variable: string,
  metadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata
): number {
  const key = `${levelPath}/${variable}`

  // V2 metadata
  const v2 = metadata as ZarrV2ConsolidatedMetadata
  if (v2.metadata?.[`${key}/.zarray`]) {
    const arrayMeta = v2.metadata[`${key}/.zarray`] as { shape?: number[] }
    return arrayMeta.shape?.reduce((a, b) => a * b, 1) ?? 0
  }

  // V3 metadata
  const v3 = metadata as ZarrV3GroupMetadata
  if (v3.consolidated_metadata?.metadata?.[key]) {
    const arrayMeta = v3.consolidated_metadata.metadata[key]
    return arrayMeta.shape?.reduce((a, b) => a * b, 1) ?? 0
  }

  return 0
}
