import { describe, it, expect } from 'vitest'
import {
  createFormatDescriptor,
  createExplicitFormatDescriptor,
  isTiledDescriptor,
  requiresProj4Reprojection,
  isStandardCrs,
} from './format-descriptor'
import type { ZarrMultiscaleMetadata, MultiscaleFormat } from './types'

// Helper to create mock metadata
function createMockMetadata(
  overrides: Partial<ZarrMultiscaleMetadata> = {}
): ZarrMultiscaleMetadata {
  return {
    version: 2,
    format: 'zarr-conventions',
    base: {
      path: 'variable',
      shape: [100, 200],
      chunks: [50, 50],
      dtype: 'float32',
      fillValue: null,
      dimensions: ['lat', 'lon'],
      spatialDimIndices: { x: 1, y: 0 },
    },
    levels: [],
    crs: {
      code: 'EPSG:4326',
      proj4def: null,
      source: 'inferred',
    },
    bounds: [-180, -90, 180, 90],
    latIsAscending: true,
    ...overrides,
  }
}

describe('createFormatDescriptor', () => {
  it('creates descriptor for zarr-conventions format', () => {
    const metadata = createMockMetadata({
      format: 'zarr-conventions',
    })

    const descriptor = createFormatDescriptor(metadata)

    expect(descriptor.format).toBe('zarr-conventions')
    expect(descriptor.tileConvention).toBe('none')
    expect(descriptor.crs.code).toBe('EPSG:4326')
    expect(descriptor.bounds).toEqual([-180, -90, 180, 90])
    expect(descriptor.latIsAscending).toBe(true)
  })

  it('creates descriptor for ndpyramid-tiled EPSG:4326 format', () => {
    const metadata = createMockMetadata({
      format: 'ndpyramid-tiled',
      crs: { code: 'EPSG:4326', proj4def: null, source: 'explicit' },
      tileSize: 256,
    })

    const descriptor = createFormatDescriptor(metadata)

    expect(descriptor.format).toBe('ndpyramid-tiled')
    expect(descriptor.tileConvention).toBe('equirectangular')
    expect(descriptor.tileSize).toBe(256)
  })

  it('creates descriptor for ndpyramid-tiled EPSG:3857 format', () => {
    const metadata = createMockMetadata({
      format: 'ndpyramid-tiled',
      crs: { code: 'EPSG:3857', proj4def: null, source: 'explicit' },
      tileSize: 256,
    })

    const descriptor = createFormatDescriptor(metadata)

    expect(descriptor.format).toBe('ndpyramid-tiled')
    expect(descriptor.tileConvention).toBe('slippy')
    expect(descriptor.crs.code).toBe('EPSG:3857')
  })

  it('creates descriptor with proj4 definition', () => {
    const proj4def = '+proj=stere +lat_0=-90 +lon_0=0'
    const metadata = createMockMetadata({
      crs: { code: 'EPSG:3031', proj4def, source: 'explicit' },
    })

    const descriptor = createFormatDescriptor(metadata)

    expect(descriptor.crs.code).toBe('EPSG:3031')
    expect(descriptor.crs.def).toBe(proj4def)
  })

  it('allows override of latIsAscending', () => {
    const metadata = createMockMetadata({ latIsAscending: true })

    const descriptor = createFormatDescriptor(metadata, {
      latIsAscending: false,
    })

    expect(descriptor.latIsAscending).toBe(false)
  })

  it('defaults to latIsAscending=false for tiled format', () => {
    const metadata = createMockMetadata({
      format: 'ndpyramid-tiled',
      latIsAscending: null,
    })

    const descriptor = createFormatDescriptor(metadata)

    expect(descriptor.latIsAscending).toBe(false)
  })
})

describe('createExplicitFormatDescriptor', () => {
  it('creates descriptor with minimal params', () => {
    const descriptor = createExplicitFormatDescriptor({
      format: 'single-level',
      crs: { code: 'EPSG:4326' },
    })

    expect(descriptor.format).toBe('single-level')
    expect(descriptor.crs.code).toBe('EPSG:4326')
    expect(descriptor.tileConvention).toBe('none')
    expect(descriptor.bounds).toBeNull()
  })

  it('creates tiled descriptor with explicit params', () => {
    const descriptor = createExplicitFormatDescriptor({
      format: 'ndpyramid-tiled',
      crs: { code: 'EPSG:3857' },
      tileConvention: 'slippy',
      tileSize: 512,
      bounds: [-180, -85, 180, 85],
    })

    expect(descriptor.tileConvention).toBe('slippy')
    expect(descriptor.tileSize).toBe(512)
    expect(descriptor.bounds).toEqual([-180, -85, 180, 85])
  })
})

describe('type guards', () => {
  it('isTiledDescriptor returns true for tiled formats', () => {
    const slippy = createExplicitFormatDescriptor({
      format: 'ndpyramid-tiled',
      crs: { code: 'EPSG:3857' },
      tileConvention: 'slippy',
    })
    const equirect = createExplicitFormatDescriptor({
      format: 'ndpyramid-tiled',
      crs: { code: 'EPSG:4326' },
      tileConvention: 'equirectangular',
    })

    expect(isTiledDescriptor(slippy)).toBe(true)
    expect(isTiledDescriptor(equirect)).toBe(true)
  })

  it('isTiledDescriptor returns false for untiled formats', () => {
    const untiled = createExplicitFormatDescriptor({
      format: 'zarr-conventions',
      crs: { code: 'EPSG:4326' },
    })

    expect(isTiledDescriptor(untiled)).toBe(false)
  })

  it('requiresProj4Reprojection returns true when proj4 def present', () => {
    const descriptor = createExplicitFormatDescriptor({
      format: 'single-level',
      crs: { code: 'EPSG:3031', def: '+proj=stere +lat_0=-90' },
    })

    expect(requiresProj4Reprojection(descriptor)).toBe(true)
  })

  it('requiresProj4Reprojection returns false for standard CRS', () => {
    const descriptor = createExplicitFormatDescriptor({
      format: 'single-level',
      crs: { code: 'EPSG:4326' },
    })

    expect(requiresProj4Reprojection(descriptor)).toBe(false)
  })

  it('isStandardCrs returns true for EPSG:4326 and EPSG:3857', () => {
    const wgs84 = createExplicitFormatDescriptor({
      format: 'single-level',
      crs: { code: 'EPSG:4326' },
    })
    const mercator = createExplicitFormatDescriptor({
      format: 'single-level',
      crs: { code: 'EPSG:3857' },
    })

    expect(isStandardCrs(wgs84)).toBe(true)
    expect(isStandardCrs(mercator)).toBe(true)
  })

  it('isStandardCrs returns false for custom CRS', () => {
    const custom = createExplicitFormatDescriptor({
      format: 'single-level',
      crs: { code: 'EPSG:3031' },
    })

    expect(isStandardCrs(custom)).toBe(false)
  })
})
