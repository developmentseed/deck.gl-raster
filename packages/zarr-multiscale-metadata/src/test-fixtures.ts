/**
 * Test fixtures for zarr-metadata tests.
 * These represent real-world metadata structures from different formats.
 *
 * FIXTURE CATEGORIES:
 * 1. Spec-compliant fixtures - match official specifications exactly
 * 2. Simplified fixtures - commonly used in practice, library should support
 *
 * @see https://github.com/zarr-conventions/multiscales (zarr-conventions)
 * @see https://ngff.openmicroscopy.org/latest/ (OME-NGFF)
 */

import type {
  ZarrV2ConsolidatedMetadata,
  ZarrV3GroupMetadata,
  ZarrV3ArrayMetadata,
  ZarrConventionsMultiscale,
  OmeNgffMultiscale,
  NdpyramidTiledMultiscale,
  CFGridMappingAttributes,
} from './types'

// =============================================================================
// zarr-conventions/multiscales fixtures
// Based on https://github.com/zarr-conventions/multiscales
// =============================================================================

/**
 * Spec-compliant zarr-conventions multiscale.
 * Based on: examples/power-of-2-pyramid.json
 *
 * Note: The spec places CRS in group attributes via proj:code (geo-proj convention),
 * not in the multiscales object. Some libraries use a simplified format with
 * crs directly in multiscales for convenience.
 */
export const zarrConventionsMultiscale: ZarrConventionsMultiscale = {
  layout: [
    {
      asset: '0',
      transform: { scale: [1.0, 1.0] },
    },
    {
      asset: '1',
      derived_from: '0',
      transform: { scale: [2.0, 2.0] },
    },
    {
      asset: '2',
      derived_from: '1',
      transform: { scale: [4.0, 4.0] },
    },
  ],
  resampling_method: 'average',
  // Note: Simplified format - spec uses proj:code in group attributes
  crs: 'EPSG:4326',
}

/**
 * zarr-conventions with spatial:transform extension.
 * Based on: examples/geospatial-pyramid.json
 *
 * The spatial:transform is placed at layout entry level (outside transform object)
 * to represent absolute positioning, not relative transformation.
 */
export const zarrConventionsWithSpatialTransform: ZarrConventionsMultiscale = {
  layout: [
    {
      asset: 'surface',
      transform: { scale: [1.0, 1.0] },
      // Affine matrix: [scaleX, shearX, originX, shearY, scaleY, originY]
      'spatial:transform': [0.1, 0, -180, 0, -0.1, 90],
      'spatial:shape': [1800, 3600],
    },
  ],
  crs: 'EPSG:4326',
}

/**
 * Spec-compliant V3 group metadata with zarr_conventions array.
 * Based on: examples/geospatial-pyramid.json
 */
export const v3GroupMetadataSpecCompliant: ZarrV3GroupMetadata = {
  zarr_format: 3,
  node_type: 'group',
  attributes: {
    zarr_conventions: [
      {
        schema_url:
          'https://raw.githubusercontent.com/zarr-conventions/multiscales/refs/tags/v1/schema.json',
        name: 'multiscales',
      },
    ],
    multiscales: {
      layout: [
        { asset: '0', transform: { scale: [1.0, 1.0] } },
        { asset: '1', derived_from: '0', transform: { scale: [2.0, 2.0] } },
      ],
      resampling_method: 'average',
    },
    // CRS via geo-proj convention (not in multiscales)
    'proj:code': 'EPSG:32632',
    // Spatial convention attributes
    'spatial:dimensions': ['Y', 'X'],
    'spatial:transform': [10.0, 0.0, 500000.0, 0.0, -10.0, 5000000.0],
    'spatial:bbox': [500000.0, 4900000.0, 600000.0, 5000000.0],
  },
}

// =============================================================================
// OME-NGFF fixtures
// Based on https://ngff.openmicroscopy.org/latest/
// =============================================================================

/**
 * OME-NGFF multiscale (simplified structure commonly seen in practice).
 * The library supports both the simplified and full spec formats.
 *
 * Key differences from full spec:
 * - Full spec nests under ome.multiscales[]
 * - Full spec uses coordinateSystems[] with named systems
 * - coordinateTransformations can have input/output fields
 */
export const omeNgffMultiscale: OmeNgffMultiscale[] = [
  {
    datasets: [
      {
        path: '0',
        coordinateTransformations: [{ type: 'scale', scale: [1, 0.5, 0.5] }],
      },
      {
        path: '1',
        coordinateTransformations: [{ type: 'scale', scale: [1, 1.0, 1.0] }],
      },
      {
        path: '2',
        coordinateTransformations: [{ type: 'scale', scale: [1, 2.0, 2.0] }],
      },
    ],
    axes: [
      { name: 'time', type: 'time' },
      { name: 'y', type: 'space' },
      { name: 'x', type: 'space' },
    ],
    coordinateTransformations: [{ type: 'scale', scale: [1, 0.5, 0.5] }],
  },
]

/**
 * OME-NGFF with CRS extension (non-standard but common in geospatial).
 * Note: OME-NGFF doesn't standardize CRS - this is a common extension pattern.
 */
export const omeNgffWithCrs: OmeNgffMultiscale[] = [
  {
    datasets: [
      {
        path: 'level0',
        coordinateTransformations: [{ type: 'scale', scale: [1.0, 1.0] }],
        // Non-standard CRS extension
        crs: 'EPSG:3857',
      } as OmeNgffMultiscale['datasets'][0] & { crs?: string },
    ],
    axes: [
      { name: 'y', type: 'space' },
      { name: 'x', type: 'space' },
    ],
  },
]

/**
 * Full OME-NGFF spec format (v0.6 style with coordinateSystems).
 * Based on: ngff-spec/examples/multiscales_strict/multiscales_example.json
 */
export const omeNgffSpecCompliant: OmeNgffMultiscale[] = [
  {
    name: 'example',
    coordinateSystems: [
      {
        name: 'intrinsic',
        axes: [
          { name: 't', type: 'time', unit: 'millisecond' },
          { name: 'z', type: 'space', unit: 'micrometer' },
          { name: 'y', type: 'space', unit: 'micrometer' },
          { name: 'x', type: 'space', unit: 'micrometer' },
        ],
      },
    ],
    datasets: [
      {
        path: '0',
        coordinateTransformations: [
          {
            type: 'scale',
            scale: [0.1, 0.5, 0.5, 0.5],
          },
        ],
      },
      {
        path: '1',
        coordinateTransformations: [
          {
            type: 'scale',
            scale: [0.1, 1.0, 1.0, 1.0],
          },
        ],
      },
      {
        path: '2',
        coordinateTransformations: [
          {
            type: 'scale',
            scale: [0.1, 2.0, 2.0, 2.0],
          },
        ],
      },
    ],
    type: 'gaussian',
  },
]

// =============================================================================
// ndpyramid tiled fixtures
// Used with ndpyramid/@carbonplan/maps
// =============================================================================

/**
 * ndpyramid tiled multiscale format.
 * This is an internal format used by ndpyramid/carbonplan tools,
 * not a standardized spec.
 */
export const ndpyramidTiledMultiscale: NdpyramidTiledMultiscale[] = [
  {
    datasets: [
      { path: '0', pixels_per_tile: 128, crs: 'EPSG:3857', level: 0 },
      { path: '1', pixels_per_tile: 128, crs: 'EPSG:3857', level: 1 },
      { path: '2', pixels_per_tile: 128, crs: 'EPSG:3857', level: 2 },
    ],
  },
]

export const ndpyramidTiledNoCrs: NdpyramidTiledMultiscale[] = [
  {
    datasets: [
      { path: '0', pixels_per_tile: 256 },
      { path: '1', pixels_per_tile: 256 },
    ],
  },
]

// =============================================================================
// V2 Consolidated Metadata fixtures
// =============================================================================

export const v2ConsolidatedMetadata: ZarrV2ConsolidatedMetadata = {
  metadata: {
    '.zattrs': {
      multiscales: zarrConventionsMultiscale,
    },
    '.zgroup': { zarr_format: 2 },
    '0/temperature/.zarray': {
      shape: [100, 3600, 7200],
      chunks: [1, 360, 720],
      dtype: '<f4',
      fill_value: 'NaN',
      compressor: { id: 'zlib', level: 1 },
      order: 'C',
    },
    '0/temperature/.zattrs': {
      _ARRAY_DIMENSIONS: ['time', 'lat', 'lon'],
      scale_factor: 0.01,
      add_offset: 273.15,
    },
    '1/temperature/.zarray': {
      shape: [100, 1800, 3600],
      chunks: [1, 360, 720],
      dtype: '<f4',
      fill_value: 'NaN',
    },
    '1/temperature/.zattrs': {
      _ARRAY_DIMENSIONS: ['time', 'lat', 'lon'],
    },
    'lat/.zarray': {
      shape: [3600],
      chunks: [3600],
      dtype: '<f4',
      fill_value: null,
    },
    'lon/.zarray': {
      shape: [7200],
      chunks: [7200],
      dtype: '<f4',
      fill_value: null,
    },
  },
  zarr_consolidated_format: 1,
}

export const v2WithGridMapping: ZarrV2ConsolidatedMetadata = {
  metadata: {
    '.zattrs': {},
    'temperature/.zarray': {
      shape: [100, 100],
      chunks: [50, 50],
      dtype: '<i2',
      fill_value: -9999,
    },
    'temperature/.zattrs': {
      _ARRAY_DIMENSIONS: ['y', 'x'],
      grid_mapping: 'crs',
      scale_factor: 0.1,
    },
    'crs/.zattrs': {
      grid_mapping_name: 'transverse_mercator',
      latitude_of_projection_origin: 0,
      longitude_of_central_meridian: -93,
      scale_factor_at_central_meridian: 0.9996,
      false_easting: 500000,
      false_northing: 0,
    } satisfies CFGridMappingAttributes,
  },
}

export const v2WithProjCode: ZarrV2ConsolidatedMetadata = {
  metadata: {
    '.zattrs': {
      'proj:code': 'EPSG:32632',
    },
    'data/.zarray': {
      shape: [1000, 1000],
      chunks: [256, 256],
      dtype: '<f4',
      fill_value: null,
    },
    'data/.zattrs': {
      _ARRAY_DIMENSIONS: ['northing', 'easting'],
    },
  },
}

// =============================================================================
// V3 Group Metadata fixtures
// =============================================================================

export const v3ArrayMetadata: ZarrV3ArrayMetadata = {
  zarr_format: 3,
  node_type: 'array',
  shape: [365, 1800, 3600],
  dimension_names: ['time', 'lat', 'lon'],
  data_type: 'float32',
  fill_value: Number.NaN,
  chunk_grid: {
    name: 'regular',
    configuration: { chunk_shape: [1, 180, 360] },
  },
  codecs: [
    { name: 'bytes', configuration: {} },
    { name: 'gzip', configuration: { level: 5 } },
  ],
  attributes: {
    units: 'K',
    long_name: 'Temperature',
  },
}

export const v3ArrayMetadataInt16: ZarrV3ArrayMetadata = {
  zarr_format: 3,
  node_type: 'array',
  shape: [100, 100],
  dimension_names: ['y', 'x'],
  data_type: 'int16',
  fill_value: -9999,
  chunk_grid: {
    name: 'regular',
    configuration: { chunk_shape: [50, 50] },
  },
  attributes: {
    scale_factor: 0.01,
    add_offset: 273.15,
  },
}

/**
 * Simplified V3 group metadata (common in practice).
 * Uses CRS in multiscales object rather than separate proj:code.
 */
export const v3GroupMetadata: ZarrV3GroupMetadata = {
  zarr_format: 3,
  node_type: 'group',
  attributes: {
    multiscales: zarrConventionsMultiscale,
    'proj:code': 'EPSG:4326',
  },
  consolidated_metadata: {
    metadata: {
      '0/temperature': v3ArrayMetadata,
      '1/temperature': {
        ...v3ArrayMetadata,
        shape: [365, 900, 1800],
        chunk_grid: {
          name: 'regular',
          configuration: { chunk_shape: [1, 180, 360] },
        },
      },
    },
  },
}

export const v3GroupWithSharding: ZarrV3GroupMetadata = {
  zarr_format: 3,
  node_type: 'group',
  attributes: {},
  consolidated_metadata: {
    metadata: {
      data: {
        zarr_format: 3,
        node_type: 'array',
        shape: [4096, 4096],
        dimension_names: ['y', 'x'],
        data_type: 'float32',
        fill_value: Number.NaN,
        chunk_grid: {
          name: 'regular',
          configuration: { chunk_shape: [1024, 1024] },
        },
        codecs: [
          {
            name: 'sharding_indexed',
            configuration: {
              chunk_shape: [256, 256],
            },
          },
        ],
      },
    },
  },
}

export const v3GroupWithDataTransforms: ZarrV3GroupMetadata = {
  zarr_format: 3,
  node_type: 'group',
  attributes: {
    multiscales: {
      layout: [
        { asset: '0', transform: { scale: [0.1, 0.1] } },
        { asset: '1', transform: { scale: [0.2, 0.2] } },
      ],
      crs: 'EPSG:4326',
    },
  },
  consolidated_metadata: {
    metadata: {
      '0/data': v3ArrayMetadataInt16,
      '1/data': {
        ...v3ArrayMetadataInt16,
        shape: [50, 50],
        chunk_grid: {
          name: 'regular',
          configuration: { chunk_shape: [25, 25] },
        },
        // Override scale_factor for level 1
        attributes: {
          scale_factor: 0.02,
          add_offset: 273.15,
        },
      },
    },
  },
}

export const v3GroupWithFloatData: ZarrV3GroupMetadata = {
  zarr_format: 3,
  node_type: 'group',
  attributes: {
    multiscales: {
      layout: [{ asset: '0', transform: { scale: [0.1, 0.1] } }],
    },
  },
  consolidated_metadata: {
    metadata: {
      '0/data': {
        zarr_format: 3,
        node_type: 'array',
        shape: [100, 100],
        dimension_names: ['y', 'x'],
        data_type: 'float32',
        fill_value: Number.NaN,
        chunk_grid: {
          name: 'regular',
          configuration: { chunk_shape: [50, 50] },
        },
        // Float data should NOT have scale_factor/add_offset applied
        attributes: {},
      },
    },
  },
}

// =============================================================================
// CF Grid Mapping fixtures
// Based on http://cfconventions.org/Data/cf-conventions/cf-conventions-1.10/cf-conventions.html#appendix-grid-mappings
// =============================================================================

export const cfLatLonGridMapping: CFGridMappingAttributes = {
  grid_mapping_name: 'latitude_longitude',
}

export const cfTransverseMercator: CFGridMappingAttributes = {
  grid_mapping_name: 'transverse_mercator',
  latitude_of_projection_origin: 0,
  longitude_of_central_meridian: -93,
  scale_factor_at_central_meridian: 0.9996,
  false_easting: 500000,
  false_northing: 0,
}

export const cfLambertConformalConic: CFGridMappingAttributes = {
  grid_mapping_name: 'lambert_conformal_conic',
  latitude_of_projection_origin: 25,
  longitude_of_central_meridian: -95,
  standard_parallel: [25, 25],
  false_easting: 0,
  false_northing: 0,
}

export const cfWithCrsWkt: CFGridMappingAttributes = {
  grid_mapping_name: 'transverse_mercator',
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 32N"...]',
}
