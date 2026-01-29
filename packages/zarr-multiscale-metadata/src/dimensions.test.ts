import { describe, it, expect } from 'vitest'
import {
  identifySpatialDimensions,
  buildDimensionInfo,
  isSpatialDimension,
  getSpatialDimensionKey,
} from './dimensions'

describe('identifySpatialDimensions', () => {
  it('identifies lat/lon dimensions by common names', () => {
    const result = identifySpatialDimensions(['time', 'lat', 'lon'])

    expect(result.y).toBe(1)
    expect(result.x).toBe(2)
  })

  it('identifies latitude/longitude dimensions', () => {
    const result = identifySpatialDimensions(['latitude', 'longitude'])

    expect(result.y).toBe(0)
    expect(result.x).toBe(1)
  })

  it('identifies y/x dimensions', () => {
    const result = identifySpatialDimensions(['band', 'y', 'x'])

    expect(result.y).toBe(1)
    expect(result.x).toBe(2)
  })

  it('handles case insensitivity', () => {
    const result = identifySpatialDimensions(['TIME', 'LAT', 'LON'])

    expect(result.y).toBe(1)
    expect(result.x).toBe(2)
  })

  it('identifies projection coordinate names', () => {
    const result = identifySpatialDimensions([
      'projection_y_coordinate',
      'projection_x_coordinate',
    ])

    expect(result.y).toBe(0)
    expect(result.x).toBe(1)
  })

  it('identifies northing/easting names', () => {
    const result = identifySpatialDimensions(['northing', 'easting'])

    expect(result.y).toBe(0)
    expect(result.x).toBe(1)
  })

  it('returns null indices when dimensions not found', () => {
    const result = identifySpatialDimensions(['time', 'level', 'band'])

    expect(result.y).toBeNull()
    expect(result.x).toBeNull()
  })

  it('returns partial match when only one dimension found', () => {
    const result = identifySpatialDimensions(['time', 'lat'])

    expect(result.y).toBe(1)
    expect(result.x).toBeNull()
  })

  it('uses override for lat dimension', () => {
    const result = identifySpatialDimensions(
      ['time', 'custom_lat', 'lon'],
      { lat: 'custom_lat' }
    )

    expect(result.y).toBe(1)
    expect(result.x).toBe(2)
  })

  it('uses override for lon dimension', () => {
    const result = identifySpatialDimensions(
      ['lat', 'custom_lon', 'time'],
      { lon: 'custom_lon' }
    )

    expect(result.y).toBe(0)
    expect(result.x).toBe(1)
  })

  it('override is case insensitive', () => {
    const result = identifySpatialDimensions(
      ['MY_LAT', 'MY_LON'],
      { lat: 'my_lat', lon: 'my_lon' }
    )

    expect(result.y).toBe(0)
    expect(result.x).toBe(1)
  })

  it('handles empty dimensions array', () => {
    const result = identifySpatialDimensions([])

    expect(result.y).toBeNull()
    expect(result.x).toBeNull()
  })
})

describe('buildDimensionInfo', () => {
  it('builds dimension info from names and shape', () => {
    const result = buildDimensionInfo(['time', 'lat', 'lon'], [365, 180, 360])

    expect(result).toEqual([
      { name: 'time', index: 0, size: 365 },
      { name: 'lat', index: 1, size: 180 },
      { name: 'lon', index: 2, size: 360 },
    ])
  })

  it('handles empty arrays', () => {
    const result = buildDimensionInfo([], [])

    expect(result).toEqual([])
  })

  it('handles mismatched lengths gracefully', () => {
    const result = buildDimensionInfo(['x', 'y'], [100])

    expect(result).toEqual([
      { name: 'x', index: 0, size: 100 },
      { name: 'y', index: 1, size: 0 },
    ])
  })
})

describe('isSpatialDimension', () => {
  it('returns true for lat aliases', () => {
    expect(isSpatialDimension('lat')).toBe(true)
    expect(isSpatialDimension('latitude')).toBe(true)
    expect(isSpatialDimension('y')).toBe(true)
    expect(isSpatialDimension('northing')).toBe(true)
    expect(isSpatialDimension('projection_y_coordinate')).toBe(true)
  })

  it('returns true for lon aliases', () => {
    expect(isSpatialDimension('lon')).toBe(true)
    expect(isSpatialDimension('longitude')).toBe(true)
    expect(isSpatialDimension('x')).toBe(true)
    expect(isSpatialDimension('lng')).toBe(true)
    expect(isSpatialDimension('easting')).toBe(true)
    expect(isSpatialDimension('projection_x_coordinate')).toBe(true)
  })

  it('handles case insensitivity', () => {
    expect(isSpatialDimension('LAT')).toBe(true)
    expect(isSpatialDimension('Longitude')).toBe(true)
  })

  it('returns false for non-spatial dimensions', () => {
    expect(isSpatialDimension('time')).toBe(false)
    expect(isSpatialDimension('band')).toBe(false)
    expect(isSpatialDimension('level')).toBe(false)
  })
})

describe('getSpatialDimensionKey', () => {
  it('returns lat for latitude aliases', () => {
    expect(getSpatialDimensionKey('lat')).toBe('lat')
    expect(getSpatialDimensionKey('latitude')).toBe('lat')
    expect(getSpatialDimensionKey('y')).toBe('lat')
    expect(getSpatialDimensionKey('northing')).toBe('lat')
  })

  it('returns lon for longitude aliases', () => {
    expect(getSpatialDimensionKey('lon')).toBe('lon')
    expect(getSpatialDimensionKey('longitude')).toBe('lon')
    expect(getSpatialDimensionKey('x')).toBe('lon')
    expect(getSpatialDimensionKey('easting')).toBe('lon')
  })

  it('handles case insensitivity', () => {
    expect(getSpatialDimensionKey('LAT')).toBe('lat')
    expect(getSpatialDimensionKey('LONGITUDE')).toBe('lon')
  })

  it('returns null for non-spatial dimensions', () => {
    expect(getSpatialDimensionKey('time')).toBeNull()
    expect(getSpatialDimensionKey('band')).toBeNull()
    expect(getSpatialDimensionKey('custom_dim')).toBeNull()
  })
})
