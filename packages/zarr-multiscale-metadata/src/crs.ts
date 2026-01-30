/**
 * @module crs
 *
 * CRS (Coordinate Reference System) extraction utilities.
 * Extracts CRS from explicit metadata and CF grid_mapping attributes.
 */

import type {
  CFGridMappingAttributes,
  CRSInfo,
  ZarrV2Attributes,
  ZarrV2ConsolidatedMetadata,
  ZarrV3GroupMetadata,
} from "./types";

/**
 * Extract CRS from zarr-conventions multiscale metadata.
 */
export function extractCrsFromZarrConventions(multiscales: {
  crs?: string;
}): CRSInfo | null {
  if (!multiscales.crs) return null;

  return {
    code: multiscales.crs.toUpperCase(),
    proj4def: null,
    source: "explicit",
  };
}

/**
 * Extract CRS from OME-NGFF dataset metadata.
 * OME-NGFF doesn't have a standard CRS field, but some implementations use custom attributes.
 */
export function extractCrsFromOmeNgff(
  datasets: Array<{ crs?: string }>,
): CRSInfo | null {
  if (!datasets[0]?.crs) return null;

  return {
    code: datasets[0].crs.toUpperCase(),
    proj4def: null,
    source: "explicit",
  };
}

/**
 * Extract CRS from CF grid_mapping variable.
 *
 * @see http://cfconventions.org/Data/cf-conventions/cf-conventions-1.10/cf-conventions.html#appendix-grid-mappings
 */
export function extractCrsFromGridMapping(
  attrs: CFGridMappingAttributes,
): CRSInfo | null {
  // Check for CRS WKT first (most specific)
  if (attrs.crs_wkt) {
    return {
      code: null,
      proj4def: null, // Would need WKT-to-proj4 conversion
      source: "grid_mapping",
    };
  }

  // Try to build proj4 from CF parameters
  // Note: We don't map grid_mapping_name to EPSG codes because CF doesn't
  // guarantee specific datums (e.g., latitude_longitude could be any ellipsoid)
  const proj4def = buildProj4FromCF(attrs);
  if (proj4def) {
    return {
      code: null,
      proj4def,
      source: "grid_mapping",
    };
  }

  return null;
}

/**
 * Build a proj4 string from CF grid_mapping parameters.
 * Supports common projections: transverse_mercator, lambert_conformal_conic.
 *
 * For latitude_longitude, returns null unless ellipsoid parameters are provided,
 * since CF doesn't guarantee WGS84.
 *
 * Note: When ellipsoid params are missing, we don't assume WGS84 - consumers
 * should handle the null case based on their domain knowledge.
 */
function buildProj4FromCF(attrs: CFGridMappingAttributes): string | null {
  const name = attrs.grid_mapping_name?.toLowerCase();
  if (!name) return null;

  // Build ellipsoid string if CF provides the parameters
  const ellipsoidParts = buildEllipsoidParams(attrs);

  switch (name) {
    case "latitude_longitude": {
      // Only return proj4 if we have ellipsoid info, otherwise return null
      // and let consumers decide (we can't assume WGS84)
      if (ellipsoidParts) {
        return `+proj=longlat ${ellipsoidParts} +no_defs`;
      }
      return null;
    }

    case "transverse_mercator": {
      const parts = ["+proj=tmerc"];
      if (attrs.latitude_of_projection_origin !== undefined) {
        parts.push(`+lat_0=${attrs.latitude_of_projection_origin}`);
      }
      if (attrs.longitude_of_central_meridian !== undefined) {
        parts.push(`+lon_0=${attrs.longitude_of_central_meridian}`);
      }
      if (attrs.scale_factor_at_central_meridian !== undefined) {
        parts.push(`+k=${attrs.scale_factor_at_central_meridian}`);
      }
      if (attrs.false_easting !== undefined) {
        parts.push(`+x_0=${attrs.false_easting}`);
      }
      if (attrs.false_northing !== undefined) {
        parts.push(`+y_0=${attrs.false_northing}`);
      }
      // Use explicit ellipsoid if provided, otherwise fall back to WGS84
      parts.push(ellipsoidParts ?? "+datum=WGS84");
      parts.push("+units=m +no_defs");
      return parts.join(" ");
    }

    case "lambert_conformal_conic": {
      const parts = ["+proj=lcc"];
      if (attrs.latitude_of_projection_origin !== undefined) {
        parts.push(`+lat_0=${attrs.latitude_of_projection_origin}`);
      }
      if (attrs.longitude_of_central_meridian !== undefined) {
        parts.push(`+lon_0=${attrs.longitude_of_central_meridian}`);
      }
      const stdPar = attrs.standard_parallel;
      if (Array.isArray(stdPar) && stdPar.length >= 2) {
        parts.push(`+lat_1=${stdPar[0]}`);
        parts.push(`+lat_2=${stdPar[1]}`);
      } else if (typeof stdPar === "number") {
        parts.push(`+lat_1=${stdPar}`);
        parts.push(`+lat_2=${stdPar}`);
      }
      if (attrs.false_easting !== undefined) {
        parts.push(`+x_0=${attrs.false_easting}`);
      }
      if (attrs.false_northing !== undefined) {
        parts.push(`+y_0=${attrs.false_northing}`);
      }
      // Use explicit ellipsoid if provided, otherwise fall back to WGS84
      parts.push(ellipsoidParts ?? "+datum=WGS84");
      parts.push("+units=m +no_defs");
      return parts.join(" ");
    }

    default:
      return null;
  }
}

/**
 * Build proj4 ellipsoid parameters from CF attributes.
 * Returns null if no ellipsoid info is provided.
 *
 * @see http://cfconventions.org/Data/cf-conventions/cf-conventions-1.10/cf-conventions.html#ellipsoid
 */
function buildEllipsoidParams(attrs: CFGridMappingAttributes): string | null {
  const parts: string[] = [];

  if (attrs.semi_major_axis !== undefined) {
    parts.push(`+a=${attrs.semi_major_axis}`);
  }

  if (attrs.inverse_flattening !== undefined) {
    parts.push(`+rf=${attrs.inverse_flattening}`);
  } else if (attrs.semi_minor_axis !== undefined) {
    parts.push(`+b=${attrs.semi_minor_axis}`);
  }

  if (attrs.longitude_of_prime_meridian !== undefined) {
    parts.push(`+pm=${attrs.longitude_of_prime_meridian}`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Attempt to find and parse CF grid_mapping attributes from metadata.
 */
export function findGridMapping(
  arrayAttrs: ZarrV2Attributes | Record<string, unknown> | undefined,
  metadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null,
): CRSInfo | null {
  if (!arrayAttrs || !metadata) return null;

  // Get the grid_mapping variable name
  const gridMappingName = arrayAttrs.grid_mapping as string | undefined;
  if (!gridMappingName) return null;

  // Try to find the grid_mapping variable in metadata
  let gridMappingAttrs: CFGridMappingAttributes | null = null;

  // V2: look in .zattrs
  const v2Meta = metadata as ZarrV2ConsolidatedMetadata;
  if (v2Meta.metadata) {
    const attrsKey = `${gridMappingName}/.zattrs`;
    if (v2Meta.metadata[attrsKey]) {
      gridMappingAttrs = v2Meta.metadata[attrsKey] as CFGridMappingAttributes;
    }
  }

  // V3: look in consolidated_metadata
  const v3Meta = metadata as ZarrV3GroupMetadata;
  if (v3Meta.consolidated_metadata?.metadata) {
    const arrayMeta = v3Meta.consolidated_metadata.metadata[gridMappingName];
    if (arrayMeta?.attributes) {
      gridMappingAttrs = arrayMeta.attributes as CFGridMappingAttributes;
    }
  }

  if (gridMappingAttrs) {
    return extractCrsFromGridMapping(gridMappingAttrs);
  }

  return null;
}

/**
 * Create CRSInfo from an explicit user-provided CRS.
 */
export function createExplicitCrs(crs: string, proj4def?: string): CRSInfo {
  return {
    code: crs.toUpperCase(),
    proj4def: proj4def ?? null,
    source: "explicit",
  };
}

/**
 * Extract CRS from group-level attributes.
 *
 * Per zarr-conventions/multiscales spec, CRS information may be at group level:
 * - `proj:code`: EPSG code (e.g., "EPSG:4326", "EPSG:32632")
 * - `spatial:dimensions`: dimension names for spatial axes
 * - `spatial:transform`: 6-element affine transform
 *
 * @see https://github.com/zarr-conventions/multiscales
 */
export function extractCrsFromGroupAttributes(
  metadata: ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata | null,
): CRSInfo | null {
  if (!metadata) return null;

  // V3: check attributes on group
  const v3Meta = metadata as ZarrV3GroupMetadata;
  if (v3Meta.attributes) {
    const projCode = v3Meta.attributes["proj:code"] as string | undefined;
    if (projCode) {
      return extractCrsFromProjCode(projCode);
    }
  }

  // V2: check root .zattrs
  const v2Meta = metadata as ZarrV2ConsolidatedMetadata;
  if (v2Meta.metadata) {
    const rootAttrs = v2Meta.metadata[".zattrs"] as
      | Record<string, unknown>
      | undefined;
    if (rootAttrs) {
      const projCode = rootAttrs["proj:code"] as string | undefined;
      if (projCode) {
        return extractCrsFromProjCode(projCode);
      }
    }
  }

  return null;
}

/**
 * Parse a proj:code value into CRSInfo.
 */
function extractCrsFromProjCode(projCode: string): CRSInfo {
  return {
    code: projCode.toUpperCase(),
    proj4def: null,
    source: "explicit",
  };
}
