import { describe, it, expect } from 'vitest'
import {
  detectMultiscaleFormat,
  parseZarrConventions,
  parseOmeNgff,
  parseNdpyramidTiled,
} from './multiscale'
import type { ZarrConventionsMultiscale } from './types'
import {
  zarrConventionsMultiscale,
  zarrConventionsWithSpatialTransform,
  omeNgffMultiscale,
  omeNgffWithCrs,
  omeNgffSpecCompliant,
  ndpyramidTiledMultiscale,
  ndpyramidTiledNoCrs,
  v3GroupMetadata,
  v3GroupMetadataSpecCompliant,
  v3GroupWithDataTransforms,
  v3GroupWithFloatData,
} from './test-fixtures'

describe('detectMultiscaleFormat', () => {
  it('detects zarr-conventions format from layout array', () => {
    expect(detectMultiscaleFormat(zarrConventionsMultiscale)).toBe('zarr-conventions')
  })

  it('detects OME-NGFF format from datasets array', () => {
    expect(detectMultiscaleFormat(omeNgffMultiscale)).toBe('ome-ngff')
  })

  it('detects ndpyramid tiled format from pixels_per_tile', () => {
    expect(detectMultiscaleFormat(ndpyramidTiledMultiscale)).toBe('ndpyramid-tiled')
  })

  it('returns single-level for null/undefined', () => {
    expect(detectMultiscaleFormat(null)).toBe('single-level')
    expect(detectMultiscaleFormat(undefined)).toBe('single-level')
  })

  it('returns single-level for empty object', () => {
    expect(detectMultiscaleFormat({})).toBe('single-level')
  })

  it('returns single-level for array without datasets', () => {
    expect(detectMultiscaleFormat([{ name: 'test' }])).toBe('single-level')
  })
})

describe('parseZarrConventions', () => {
  it('extracts level paths from layout', () => {
    const result = parseZarrConventions(zarrConventionsMultiscale, 'temperature', null)

    expect(result.format).toBe('zarr-conventions')
    expect(result.levelPaths).toEqual(['0', '1', '2'])
  })

  it('extracts CRS from multiscale metadata', () => {
    const result = parseZarrConventions(zarrConventionsMultiscale, 'temperature', null)

    expect(result.crs).not.toBeNull()
    expect(result.crs?.code).toBe('EPSG:4326')
    expect(result.crs?.source).toBe('explicit')
  })

  it('extracts resolution from transform.scale', () => {
    const result = parseZarrConventions(zarrConventionsMultiscale, 'temperature', null)

    // Spec-compliant scales: 1.0, 2.0, 4.0 (relative, not absolute)
    expect(result.levels[0].resolution).toEqual([1.0, 1.0])
    expect(result.levels[1].resolution).toEqual([2.0, 2.0])
    expect(result.levels[2].resolution).toEqual([4.0, 4.0])
  })

  it('extracts spatial:transform and spatial:shape', () => {
    const result = parseZarrConventions(zarrConventionsWithSpatialTransform, 'data', null)

    expect(result.levels[0].spatialTransform).toEqual([0.1, 0, -180, 0, -0.1, 90])
    expect(result.levels[0].spatialShape).toEqual([1800, 3600])
  })

  it('extracts shape/chunks from consolidated metadata', () => {
    const consolidatedMeta = v3GroupMetadata.consolidated_metadata?.metadata ?? null
    const result = parseZarrConventions(zarrConventionsMultiscale, 'temperature', consolidatedMeta)

    expect(result.levels[0].shape).toEqual([365, 1800, 3600])
    expect(result.levels[0].chunks).toEqual([1, 180, 360])
  })

  it('handles empty layout', () => {
    const result = parseZarrConventions({ layout: [] }, 'data', null)

    expect(result.levelPaths).toEqual([])
    expect(result.levels).toEqual([])
  })
})

describe('parseOmeNgff', () => {
  it('extracts level paths from datasets', () => {
    const result = parseOmeNgff(omeNgffMultiscale, 'data', null)

    expect(result.format).toBe('ome-ngff')
    expect(result.levelPaths).toEqual(['0', '1', '2'])
  })

  it('extracts resolution from dataset coordinateTransformations', () => {
    const result = parseOmeNgff(omeNgffMultiscale, 'data', null)

    // Resolution comes from last two dimensions of scale array [time, y, x]
    // extractOmeNgffResolution returns [scale[len-1], scale[len-2]] = [x, y]
    expect(result.levels[0].resolution).toEqual([0.5, 0.5])
    expect(result.levels[1].resolution).toEqual([1.0, 1.0])
    expect(result.levels[2].resolution).toEqual([2.0, 2.0])
  })

  it('extracts CRS from non-standard extension', () => {
    const result = parseOmeNgff(omeNgffWithCrs, 'data', null)

    expect(result.crs).not.toBeNull()
    expect(result.crs?.code).toBe('EPSG:3857')
  })

  it('returns null CRS when not present', () => {
    const result = parseOmeNgff(omeNgffMultiscale, 'data', null)

    expect(result.crs).toBeNull()
  })

  it('handles empty datasets', () => {
    const result = parseOmeNgff([{ datasets: [] }], 'data', null)

    expect(result.levelPaths).toEqual([])
    expect(result.levels).toEqual([])
  })

  it('does not assume power-of-2 scaling between levels', () => {
    // Each level should use its own coordinateTransformations, not assumed 2^levelIndex
    const customOmeNgff: typeof omeNgffMultiscale = [
      {
        datasets: [
          { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1.0, 1.0] }] },
          { path: '1', coordinateTransformations: [{ type: 'scale', scale: [3.0, 3.0] }] }, // 3x, not 2x
        ],
      },
    ]

    const result = parseOmeNgff(customOmeNgff, 'data', null)

    expect(result.levels[0].resolution).toEqual([1.0, 1.0])
    expect(result.levels[1].resolution).toEqual([3.0, 3.0]) // Should be 3, not 2
  })
})

describe('parseNdpyramidTiled', () => {
  it('extracts level paths as strings', () => {
    const result = parseNdpyramidTiled(ndpyramidTiledMultiscale, 'data', null)

    expect(result.format).toBe('ndpyramid-tiled')
    expect(result.levelPaths).toEqual(['0', '1', '2'])
  })

  it('extracts tile size from pixels_per_tile', () => {
    const result = parseNdpyramidTiled(ndpyramidTiledMultiscale, 'data', null)

    expect(result.tileSize).toBe(128)
  })

  it('extracts CRS when present', () => {
    const result = parseNdpyramidTiled(ndpyramidTiledMultiscale, 'data', null)

    expect(result.crs).not.toBeNull()
    expect(result.crs?.code).toBe('EPSG:3857')
  })

  it('returns null CRS when not present (no default)', () => {
    const result = parseNdpyramidTiled(ndpyramidTiledNoCrs, 'data', null)

    // Should NOT default to EPSG:3857 - that's a consumer decision
    expect(result.crs).toBeNull()
  })

  it('computes shape from level index and tile size', () => {
    const result = parseNdpyramidTiled(ndpyramidTiledMultiscale, 'data', null)

    // Shape = [2^level × tileSize, 2^level × tileSize]
    expect(result.levels[0].shape).toEqual([128, 128])   // 2^0 × 128
    expect(result.levels[1].shape).toEqual([256, 256])   // 2^1 × 128
    expect(result.levels[2].shape).toEqual([512, 512])   // 2^2 × 128
  })

  it('sets chunks equal to tile size', () => {
    const result = parseNdpyramidTiled(ndpyramidTiledMultiscale, 'data', null)

    expect(result.levels[0].chunks).toEqual([128, 128])
    expect(result.levels[1].chunks).toEqual([128, 128])
  })

  it('uses placeholder resolution (consumer should compute)', () => {
    const result = parseNdpyramidTiled(ndpyramidTiledMultiscale, 'data', null)

    // Resolution should be [1.0, 1.0] placeholder, not computed from world extent
    expect(result.levels[0].resolution).toEqual([1.0, 1.0])
  })
})

describe('Data transforms extraction', () => {
  it('extracts scale_factor and add_offset from consolidated metadata', () => {
    const consolidatedMeta = v3GroupWithDataTransforms.consolidated_metadata?.metadata ?? null
    const multiscales = v3GroupWithDataTransforms.attributes?.multiscales as ZarrConventionsMultiscale
    const result = parseZarrConventions(multiscales, 'data', consolidatedMeta)

    expect(result.levels[0].scaleFactor).toBe(0.01)
    expect(result.levels[0].addOffset).toBe(273.15)
  })

  it('supports per-level scale_factor overrides', () => {
    const consolidatedMeta = v3GroupWithDataTransforms.consolidated_metadata?.metadata ?? null
    const multiscales = v3GroupWithDataTransforms.attributes?.multiscales as ZarrConventionsMultiscale
    const result = parseZarrConventions(multiscales, 'data', consolidatedMeta)

    // Level 0 has scale_factor 0.01
    expect(result.levels[0].scaleFactor).toBe(0.01)
    // Level 1 has scale_factor 0.02
    expect(result.levels[1].scaleFactor).toBe(0.02)
    // Both have same add_offset
    expect(result.levels[0].addOffset).toBe(273.15)
    expect(result.levels[1].addOffset).toBe(273.15)
  })

  it('does not set scaleFactor/addOffset when not in metadata', () => {
    const consolidatedMeta = v3GroupWithFloatData.consolidated_metadata?.metadata ?? null
    const multiscales = v3GroupWithFloatData.attributes?.multiscales as ZarrConventionsMultiscale
    const result = parseZarrConventions(multiscales, 'data', consolidatedMeta)

    // Float data without transforms should have undefined scaleFactor/addOffset
    expect(result.levels[0].scaleFactor).toBeUndefined()
    expect(result.levels[0].addOffset).toBeUndefined()
  })

  it('extracts dtype and fillValue from array metadata', () => {
    const consolidatedMeta = v3GroupWithDataTransforms.consolidated_metadata?.metadata ?? null
    const multiscales = v3GroupWithDataTransforms.attributes?.multiscales as ZarrConventionsMultiscale
    const result = parseZarrConventions(multiscales, 'data', consolidatedMeta)

    expect(result.levels[0].dtype).toBe('int16')
    expect(result.levels[0].fillValue).toBe(-9999)
  })

  it('detects float32 dtype correctly', () => {
    const consolidatedMeta = v3GroupWithFloatData.consolidated_metadata?.metadata ?? null
    const multiscales = v3GroupWithFloatData.attributes?.multiscales as ZarrConventionsMultiscale
    const result = parseZarrConventions(multiscales, 'data', consolidatedMeta)

    expect(result.levels[0].dtype).toBe('float32')
    expect(result.levels[0].fillValue).toBeNaN()
  })
})

describe('Spec-compliant fixtures', () => {
  it('detects zarr-conventions from spec-compliant V3 group', () => {
    // The spec puts multiscales in attributes, not at root
    const multiscales = v3GroupMetadataSpecCompliant.attributes?.multiscales
    expect(detectMultiscaleFormat(multiscales)).toBe('zarr-conventions')
  })

  it('extracts CRS from proj:code in spec-compliant format', () => {
    // In spec-compliant format, CRS comes from proj:code, not multiscales.crs
    const projCode = v3GroupMetadataSpecCompliant.attributes?.['proj:code']
    expect(projCode).toBe('EPSG:32632')
  })

  it('parses spec-compliant zarr-conventions with proper transform structure', () => {
    const multiscales = v3GroupMetadataSpecCompliant.attributes?.multiscales as ZarrConventionsMultiscale
    const result = parseZarrConventions(multiscales, 'data', null)

    expect(result.format).toBe('zarr-conventions')
    expect(result.levelPaths).toEqual(['0', '1'])
    // Spec uses transform.scale (nested), which our fixture has
    expect(result.levels[0].resolution).toEqual([1.0, 1.0])
    expect(result.levels[1].resolution).toEqual([2.0, 2.0])
  })

  it('parses OME-NGFF spec-compliant format with coordinateSystems', () => {
    const result = parseOmeNgff(omeNgffSpecCompliant, 'data', null)

    expect(result.format).toBe('ome-ngff')
    expect(result.levelPaths).toEqual(['0', '1', '2'])
    // 4D scale array: [t, z, y, x] - resolution takes last 2 dims
    expect(result.levels[0].resolution).toEqual([0.5, 0.5])
    expect(result.levels[1].resolution).toEqual([1.0, 1.0])
    expect(result.levels[2].resolution).toEqual([2.0, 2.0])
  })

  it('handles spatial:transform in layout entries', () => {
    const result = parseZarrConventions(zarrConventionsWithSpatialTransform, 'data', null)

    // spatial:transform is [scaleX, shearX, originX, shearY, scaleY, originY]
    expect(result.levels[0].spatialTransform).toEqual([0.1, 0, -180, 0, -0.1, 90])
    expect(result.levels[0].spatialShape).toEqual([1800, 3600])
  })
})
