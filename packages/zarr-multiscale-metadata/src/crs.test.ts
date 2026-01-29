import { describe, it, expect } from 'vitest'
import {
  extractCrsFromZarrConventions,
  extractCrsFromOmeNgff,
  extractCrsFromGridMapping,
  extractCrsFromGroupAttributes,
  findGridMapping,
  createExplicitCrs,
} from './crs'
import {
  cfLatLonGridMapping,
  cfTransverseMercator,
  cfLambertConformalConic,
  cfWithCrsWkt,
  v2WithGridMapping,
  v2WithProjCode,
  v3GroupMetadata,
} from './test-fixtures'

describe('extractCrsFromZarrConventions', () => {
  it('extracts CRS from multiscales.crs', () => {
    const result = extractCrsFromZarrConventions({ crs: 'EPSG:4326' })

    expect(result).not.toBeNull()
    expect(result?.code).toBe('EPSG:4326')
    expect(result?.source).toBe('explicit')
  })

  it('normalizes CRS code to uppercase', () => {
    const result = extractCrsFromZarrConventions({ crs: 'epsg:3857' })

    expect(result?.code).toBe('EPSG:3857')
  })

  it('returns null when CRS is not present', () => {
    const result = extractCrsFromZarrConventions({})

    expect(result).toBeNull()
  })

  it('passes through non-standard CRS codes', () => {
    const result = extractCrsFromZarrConventions({ crs: 'EPSG:32632' })

    expect(result?.code).toBe('EPSG:32632')
  })
})

describe('extractCrsFromOmeNgff', () => {
  it('extracts CRS from first dataset', () => {
    const result = extractCrsFromOmeNgff([{ crs: 'EPSG:4326' }])

    expect(result).not.toBeNull()
    expect(result?.code).toBe('EPSG:4326')
  })

  it('returns null for empty datasets', () => {
    const result = extractCrsFromOmeNgff([])

    expect(result).toBeNull()
  })

  it('returns null when CRS is not present', () => {
    const result = extractCrsFromOmeNgff([{}])

    expect(result).toBeNull()
  })
})

describe('extractCrsFromGridMapping', () => {
  it('returns null for latitude_longitude without ellipsoid params', () => {
    const result = extractCrsFromGridMapping(cfLatLonGridMapping)

    // Without ellipsoid parameters, we can't assume WGS84
    // Consumers should handle this based on their domain knowledge
    expect(result).toBeNull()
  })

  it('builds proj4 string for latitude_longitude with ellipsoid params', () => {
    const result = extractCrsFromGridMapping({
      grid_mapping_name: 'latitude_longitude',
      semi_major_axis: 6378137,
      inverse_flattening: 298.257223563,
    })

    expect(result).not.toBeNull()
    expect(result?.code).toBeNull()
    expect(result?.proj4def).toContain('+proj=longlat')
    expect(result?.proj4def).toContain('+a=6378137')
    expect(result?.proj4def).toContain('+rf=298.257223563')
    expect(result?.source).toBe('grid_mapping')
  })

  it('builds proj4 string for transverse_mercator', () => {
    const result = extractCrsFromGridMapping(cfTransverseMercator)

    expect(result).not.toBeNull()
    expect(result?.proj4def).toContain('+proj=tmerc')
    expect(result?.proj4def).toContain('+lon_0=-93')
    expect(result?.proj4def).toContain('+k=0.9996')
    expect(result?.proj4def).toContain('+x_0=500000')
    expect(result?.source).toBe('grid_mapping')
  })

  it('builds proj4 string for lambert_conformal_conic', () => {
    const result = extractCrsFromGridMapping(cfLambertConformalConic)

    expect(result).not.toBeNull()
    expect(result?.proj4def).toContain('+proj=lcc')
    expect(result?.proj4def).toContain('+lat_0=25')
    expect(result?.proj4def).toContain('+lon_0=-95')
    expect(result?.proj4def).toContain('+lat_1=25')
    expect(result?.proj4def).toContain('+lat_2=25')
  })

  it('returns CRSInfo with null code when crs_wkt is present', () => {
    const result = extractCrsFromGridMapping(cfWithCrsWkt)

    expect(result).not.toBeNull()
    expect(result?.code).toBeNull()
    expect(result?.source).toBe('grid_mapping')
  })

  it('returns null for unknown grid_mapping_name', () => {
    const result = extractCrsFromGridMapping({
      grid_mapping_name: 'unknown_projection',
    })

    expect(result).toBeNull()
  })
})

describe('extractCrsFromGroupAttributes', () => {
  it('extracts proj:code from V3 group attributes', () => {
    const result = extractCrsFromGroupAttributes(v3GroupMetadata)

    expect(result).not.toBeNull()
    expect(result?.code).toBe('EPSG:4326')
    expect(result?.source).toBe('explicit')
  })

  it('extracts proj:code from V2 root .zattrs', () => {
    const result = extractCrsFromGroupAttributes(v2WithProjCode)

    expect(result).not.toBeNull()
    expect(result?.code).toBe('EPSG:32632')
  })

  it('returns null when proj:code is not present', () => {
    const result = extractCrsFromGroupAttributes({
      zarr_format: 3,
      node_type: 'group',
      attributes: {},
    })

    expect(result).toBeNull()
  })

  it('returns null for null metadata', () => {
    const result = extractCrsFromGroupAttributes(null)

    expect(result).toBeNull()
  })
})

describe('findGridMapping', () => {
  it('finds grid_mapping from V2 consolidated metadata', () => {
    const arrayAttrs = { grid_mapping: 'crs' }
    const result = findGridMapping(arrayAttrs, v2WithGridMapping)

    expect(result).not.toBeNull()
    expect(result?.proj4def).toContain('+proj=tmerc')
  })

  it('returns null when grid_mapping attribute is missing', () => {
    const result = findGridMapping({}, v2WithGridMapping)

    expect(result).toBeNull()
  })

  it('returns null when grid_mapping variable not found', () => {
    const result = findGridMapping({ grid_mapping: 'nonexistent' }, v2WithGridMapping)

    expect(result).toBeNull()
  })

  it('returns null for null metadata', () => {
    const result = findGridMapping({ grid_mapping: 'crs' }, null)

    expect(result).toBeNull()
  })
})

describe('createExplicitCrs', () => {
  it('creates CRSInfo from user-provided CRS', () => {
    const result = createExplicitCrs('EPSG:4326')

    expect(result.code).toBe('EPSG:4326')
    expect(result.proj4def).toBeNull()
    expect(result.source).toBe('explicit')
  })

  it('normalizes CRS code to uppercase', () => {
    const result = createExplicitCrs('epsg:3857')

    expect(result.code).toBe('EPSG:3857')
  })

  it('includes proj4def when provided', () => {
    const proj4 = '+proj=longlat +datum=WGS84 +no_defs'
    const result = createExplicitCrs('EPSG:4326', proj4)

    expect(result.proj4def).toBe(proj4)
  })
})
