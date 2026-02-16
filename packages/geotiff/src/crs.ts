import type { GeoKeyDirectory } from "./ifd.js";

// ── PROJJSON types ────────────────────────────────────────────────────────────
// Subset of the PROJJSON spec covering the two CRS types we emit.
// https://proj.org/en/stable/specifications/projjson.html

export interface ProjJsonUnit {
  type: "LinearUnit" | "AngularUnit";
  name: string;
  conversion_factor: number;
}

export interface ProjJsonAxis {
  name: string;
  abbreviation: string;
  direction: string;
  unit: string | ProjJsonUnit;
}

export interface ProjJsonCoordinateSystem {
  subtype: string;
  axis: ProjJsonAxis[];
}

export interface ProjJsonEllipsoid {
  name: string;
  semi_major_axis?: number;
  semi_minor_axis?: number;
  inverse_flattening?: number;
}

export interface ProjJsonPrimeMeridian {
  name: string;
  longitude: number;
}

export interface ProjJsonDatum {
  type: "GeodeticReferenceFrame";
  name: string;
  ellipsoid?: ProjJsonEllipsoid;
  prime_meridian?: ProjJsonPrimeMeridian;
}

export interface ProjJsonParameter {
  name: string;
  value: number;
  unit: string | ProjJsonUnit;
}

export interface ProjJsonConversion {
  name: string;
  method: { name: string };
  parameters: ProjJsonParameter[];
}

export interface ProjJsonDatumEnsemble {
  name: string;
  members: { name: string; id?: { authority: string; code: number } }[];
  ellipsoid: ProjJsonEllipsoid;
  accuracy?: string;
  id?: { authority: string; code: number };
}

export interface GeographicCRS {
  type: "GeographicCRS";
  $schema?: string;
  name: string;
  datum?: ProjJsonDatum;
  datum_ensemble?: ProjJsonDatumEnsemble;
  coordinate_system: ProjJsonCoordinateSystem;
  [key: string]: unknown;
}

export interface ProjectedCRS {
  type: "ProjectedCRS";
  $schema: string;
  name: string;
  base_crs: GeographicCRS;
  conversion: ProjJsonConversion;
  coordinate_system: ProjJsonCoordinateSystem;
}

export type ProjJson = GeographicCRS | ProjectedCRS;

// ── Constants ─────────────────────────────────────────────────────────────────

const PROJJSON_SCHEMA = "https://proj.org/schemas/v0.7/projjson.schema.json";

const MODEL_TYPE_PROJECTED = 1;
const MODEL_TYPE_GEOGRAPHIC = 2;
const USER_DEFINED = 32767;

// GeoTIFF coordinate transformation type codes (GeoKey 3075)
// http://geotiff.maptools.org/spec/geotiff6.html#6.3.3.3
const CT_TRANSVERSE_MERCATOR = 1;
const CT_TRANSVERSE_MERCATOR_SOUTH = 2;
const CT_OBLIQUE_MERCATOR = 3;
const CT_OBLIQUE_MERCATOR_LABORDE = 4;
const CT_OBLIQUE_MERCATOR_ROSENMUND = 5;
const CT_OBLIQUE_MERCATOR_SPHERICAL = 6;
const CT_MERCATOR = 7;
const CT_LAMBERT_CONFORMAL_CONIC_2SP = 8;
const CT_LAMBERT_CONFORMAL_CONIC_1SP = 9;
const CT_LAMBERT_AZIMUTHAL_EQUAL_AREA = 10;
const CT_ALBERS_EQUAL_AREA = 11;
const CT_AZIMUTHAL_EQUIDISTANT = 12;
const CT_STEREOGRAPHIC = 14;
const CT_POLAR_STEREOGRAPHIC = 15;
const CT_OBLIQUE_STEREOGRAPHIC = 16;
const CT_EQUIRECTANGULAR = 17;
const CT_CASSINI_SOLDNER = 18;
const CT_ORTHOGRAPHIC = 21;
const CT_POLYCONIC = 22;
const CT_SINUSOIDAL = 24;
const CT_NEW_ZEALAND_MAP_GRID = 26;
const CT_TRANSVERSE_MERCATOR_SOUTH_ORIENTED = 27;

const ANGULAR_UNIT_DEGREE = 9102;
const ANGULAR_UNIT_RADIAN = 9101;
const ANGULAR_UNIT_GRAD = 9105;

const ANGULAR_UNIT: Record<number, string> = {
  [ANGULAR_UNIT_DEGREE]: "degree",
  [ANGULAR_UNIT_RADIAN]: "radian",
  [ANGULAR_UNIT_GRAD]: "grad",
};

const LINEAR_UNIT_METRE = 9001;
const LINEAR_UNIT_FOOT = 9002;
const LINEAR_UNIT_US_SURVEY_FOOT = 9003;

const US_SURVEY_FOOT: ProjJsonUnit = {
  type: "LinearUnit",
  name: "US survey foot",
  conversion_factor: 0.30480060960121924,
};

const LINEAR_UNIT: Record<number, string | ProjJsonUnit> = {
  [LINEAR_UNIT_METRE]: "metre",
  [LINEAR_UNIT_FOOT]: "foot",
  [LINEAR_UNIT_US_SURVEY_FOOT]: US_SURVEY_FOOT,
};

/**
 * Parse a CRS from a GeoKeyDirectory.
 *
 * Returns the EPSG code as a number for EPSG-coded CRSes (letting the caller
 * decide how to resolve it), or a PROJJSON object built from the geo keys for
 * user-defined CRSes.
 */
export function crsFromGeoKeys(gkd: GeoKeyDirectory): number | ProjJson {
  const modelType = gkd.modelType;

  if (modelType === MODEL_TYPE_PROJECTED) {
    return _projectedCrs(gkd);
  }

  if (modelType === MODEL_TYPE_GEOGRAPHIC) {
    return _geographicCrs(gkd);
  }

  throw new Error(`Unsupported GeoTIFF model type: ${modelType}`);
}

function _geographicCrs(gkd: GeoKeyDirectory): number | GeographicCRS {
  const epsg = gkd.geodeticCRS;
  if (epsg !== null && epsg !== USER_DEFINED) {
    return epsg;
  }
  return _buildGeographicCrs(gkd, PROJJSON_SCHEMA);
}

function _projectedCrs(gkd: GeoKeyDirectory): number | ProjectedCRS {
  const epsg = gkd.projectedCRS;
  if (epsg !== null && epsg !== USER_DEFINED) {
    return epsg;
  }
  return _buildProjectedCrs(gkd);
}

function _buildGeographicCrs(
  gkd: GeoKeyDirectory,
  schema?: string,
): GeographicCRS {
  const ellipsoid = _buildEllipsoid(gkd);

  let pmName = "Greenwich";
  let pmLongitude = 0.0;
  if (gkd.primeMeridian !== null && gkd.primeMeridian !== USER_DEFINED) {
    pmName = `EPSG:${gkd.primeMeridian}`;
  } else if (gkd.primeMeridianLongitude !== null) {
    pmLongitude = gkd.primeMeridianLongitude;
    pmName = "User-defined";
  }

  let datum: ProjJsonDatum;
  if (gkd.geodeticDatum !== null && gkd.geodeticDatum !== USER_DEFINED) {
    datum = {
      type: "GeodeticReferenceFrame",
      name: `Unknown datum based upon EPSG ${gkd.geodeticDatum} ellipsoid`,
    };
  } else {
    datum = {
      type: "GeodeticReferenceFrame",
      name: gkd.geodeticCitation ?? "User-defined",
      ellipsoid,
      prime_meridian: { name: pmName, longitude: pmLongitude },
    };
  }

  const crs: GeographicCRS = {
    type: "GeographicCRS",
    name: gkd.geodeticCitation ?? "User-defined",
    datum,
    coordinate_system: _geographicCs(gkd),
  };

  if (schema !== undefined) {
    crs.$schema = schema;
  }

  return crs;
}

function _buildProjectedCrs(gkd: GeoKeyDirectory): ProjectedCRS {
  // Always build the base CRS from geo keys — the geodeticCRS EPSG code inside
  // a user-defined projected CRS is informational, not a fetch target.
  const baseCrs = _buildGeographicCrs(gkd);
  const conversion = _buildConversion(gkd);
  const cs = _projectedCs(gkd);

  return {
    type: "ProjectedCRS",
    $schema: PROJJSON_SCHEMA,
    name: gkd.projectedCitation ?? gkd.citation ?? "User-defined",
    base_crs: baseCrs,
    conversion,
    coordinate_system: cs,
  };
}

function _buildEllipsoid(gkd: GeoKeyDirectory): ProjJsonEllipsoid {
  if (gkd.ellipsoid !== null && gkd.ellipsoid !== USER_DEFINED) {
    const ellipsoid: ProjJsonEllipsoid = {
      name: `EPSG ellipsoid ${gkd.ellipsoid}`,
    };
    if (gkd.ellipsoidSemiMajorAxis !== null) {
      ellipsoid.semi_major_axis = gkd.ellipsoidSemiMajorAxis;
    }
    if (gkd.ellipsoidInvFlattening !== null) {
      ellipsoid.inverse_flattening = gkd.ellipsoidInvFlattening;
    } else if (gkd.ellipsoidSemiMinorAxis !== null) {
      ellipsoid.semi_minor_axis = gkd.ellipsoidSemiMinorAxis;
    }
    return ellipsoid;
  }

  if (gkd.ellipsoidSemiMajorAxis === null) {
    throw new Error("User-defined ellipsoid requires ellipsoidSemiMajorAxis");
  }

  const ellipsoid: ProjJsonEllipsoid = {
    name: gkd.geodeticCitation ?? "User-defined",
    semi_major_axis: gkd.ellipsoidSemiMajorAxis,
  };

  if (gkd.ellipsoidInvFlattening !== null) {
    ellipsoid.inverse_flattening = gkd.ellipsoidInvFlattening;
  } else if (gkd.ellipsoidSemiMinorAxis !== null) {
    ellipsoid.semi_minor_axis = gkd.ellipsoidSemiMinorAxis;
  } else {
    throw new Error(
      "User-defined ellipsoid requires ellipsoidInvFlattening or ellipsoidSemiMinorAxis",
    );
  }

  return ellipsoid;
}

function _buildConversion(gkd: GeoKeyDirectory): ProjJsonConversion {
  const ct = gkd.projMethod;
  if (ct === null) {
    throw new Error("User-defined projected CRS requires projMethod");
  }

  const angular = (
    name: string,
    value: number | null,
    default_ = 0.0,
  ): ProjJsonParameter => ({
    name,
    value: value ?? default_,
    unit: "degree",
  });

  const linear = (
    name: string,
    value: number | null,
    default_ = 0.0,
  ): ProjJsonParameter => ({
    name,
    value: value ?? default_,
    unit: "metre",
  });

  const scale = (
    name: string,
    value: number | null,
    default_ = 1.0,
  ): ProjJsonParameter => ({
    name,
    value: value ?? default_,
    unit: "unity",
  });

  switch (ct) {
    case CT_TRANSVERSE_MERCATOR:
    case CT_TRANSVERSE_MERCATOR_SOUTH:
    case CT_TRANSVERSE_MERCATOR_SOUTH_ORIENTED: {
      const name =
        ct === CT_TRANSVERSE_MERCATOR
          ? "Transverse Mercator"
          : "Transverse Mercator (South Orientated)";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projNatOriginLat),
          angular("Longitude of natural origin", gkd.projNatOriginLong),
          scale("Scale factor at natural origin", gkd.projScaleAtNatOrigin),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_OBLIQUE_MERCATOR:
    case CT_OBLIQUE_MERCATOR_LABORDE:
    case CT_OBLIQUE_MERCATOR_ROSENMUND:
    case CT_OBLIQUE_MERCATOR_SPHERICAL: {
      const name = "Hotine Oblique Mercator (variant B)";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of projection centre", gkd.projCenterLat),
          angular("Longitude of projection centre", gkd.projCenterLong),
          angular("Azimuth of initial line", gkd.projAzimuthAngle),
          angular("Angle from Rectified to Skew Grid", gkd.projAzimuthAngle),
          scale("Scale factor on initial line", gkd.projScaleAtCenter),
          linear("Easting at projection centre", gkd.projCenterEasting),
          linear("Northing at projection centre", gkd.projCenterNorthing),
        ],
      };
    }

    case CT_MERCATOR: {
      const name = "Mercator (variant A)";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projNatOriginLat),
          angular("Longitude of natural origin", gkd.projNatOriginLong),
          scale("Scale factor at natural origin", gkd.projScaleAtNatOrigin),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_LAMBERT_CONFORMAL_CONIC_2SP: {
      const name = "Lambert Conic Conformal (2SP)";
      return {
        name,
        method: { name },
        parameters: [
          angular(
            "Latitude of false origin",
            gkd.projFalseOriginLat ?? gkd.projNatOriginLat,
          ),
          angular(
            "Longitude of false origin",
            gkd.projFalseOriginLong ?? gkd.projNatOriginLong,
          ),
          angular("Latitude of 1st standard parallel", gkd.projStdParallel1),
          angular("Latitude of 2nd standard parallel", gkd.projStdParallel2),
          linear(
            "Easting at false origin",
            gkd.projFalseOriginEasting ?? gkd.projFalseEasting,
          ),
          linear(
            "Northing at false origin",
            gkd.projFalseOriginNorthing ?? gkd.projFalseNorthing,
          ),
        ],
      };
    }

    case CT_LAMBERT_CONFORMAL_CONIC_1SP: {
      const name = "Lambert Conic Conformal (1SP)";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projNatOriginLat),
          angular("Longitude of natural origin", gkd.projNatOriginLong),
          scale("Scale factor at natural origin", gkd.projScaleAtNatOrigin),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_LAMBERT_AZIMUTHAL_EQUAL_AREA: {
      const name = "Lambert Azimuthal Equal Area";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projCenterLat),
          angular("Longitude of natural origin", gkd.projCenterLong),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_ALBERS_EQUAL_AREA: {
      const name = "Albers Equal Area";
      return {
        name,
        method: { name },
        parameters: [
          angular(
            "Latitude of false origin",
            gkd.projFalseOriginLat ?? gkd.projNatOriginLat,
          ),
          angular(
            "Longitude of false origin",
            gkd.projFalseOriginLong ?? gkd.projNatOriginLong,
          ),
          angular("Latitude of 1st standard parallel", gkd.projStdParallel1),
          angular("Latitude of 2nd standard parallel", gkd.projStdParallel2),
          linear(
            "Easting at false origin",
            gkd.projFalseOriginEasting ?? gkd.projFalseEasting,
          ),
          linear(
            "Northing at false origin",
            gkd.projFalseOriginNorthing ?? gkd.projFalseNorthing,
          ),
        ],
      };
    }

    case CT_AZIMUTHAL_EQUIDISTANT: {
      const name = "Modified Azimuthal Equidistant";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projCenterLat),
          angular("Longitude of natural origin", gkd.projCenterLong),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_STEREOGRAPHIC: {
      const name = "Stereographic";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projCenterLat),
          angular("Longitude of natural origin", gkd.projCenterLong),
          scale("Scale factor at natural origin", gkd.projScaleAtCenter),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_POLAR_STEREOGRAPHIC: {
      const name = "Polar Stereographic (variant B)";
      return {
        name,
        method: { name },
        parameters: [
          angular(
            "Latitude of standard parallel",
            gkd.projNatOriginLat ?? gkd.projStdParallel1,
          ),
          angular(
            "Longitude of origin",
            gkd.projStraightVertPoleLong ?? gkd.projNatOriginLong,
          ),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_OBLIQUE_STEREOGRAPHIC: {
      const name = "Oblique Stereographic";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projCenterLat),
          angular("Longitude of natural origin", gkd.projCenterLong),
          scale("Scale factor at natural origin", gkd.projScaleAtCenter),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_EQUIRECTANGULAR: {
      const name = "Equidistant Cylindrical";
      return {
        name,
        method: { name },
        parameters: [
          angular(
            "Latitude of 1st standard parallel",
            gkd.projStdParallel1 ?? gkd.projCenterLat,
          ),
          angular("Longitude of natural origin", gkd.projCenterLong),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_CASSINI_SOLDNER: {
      const name = "Cassini-Soldner";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projNatOriginLat),
          angular("Longitude of natural origin", gkd.projNatOriginLong),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_POLYCONIC: {
      const name = "American Polyconic";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projNatOriginLat),
          angular("Longitude of natural origin", gkd.projNatOriginLong),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_SINUSOIDAL: {
      const name = "Sinusoidal";
      return {
        name,
        method: { name },
        parameters: [
          angular("Longitude of natural origin", gkd.projCenterLong),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_ORTHOGRAPHIC: {
      const name = "Orthographic";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projCenterLat),
          angular("Longitude of natural origin", gkd.projCenterLong),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    case CT_NEW_ZEALAND_MAP_GRID: {
      const name = "New Zealand Map Grid";
      return {
        name,
        method: { name },
        parameters: [
          angular("Latitude of natural origin", gkd.projNatOriginLat),
          angular("Longitude of natural origin", gkd.projNatOriginLong),
          linear("False easting", gkd.projFalseEasting),
          linear("False northing", gkd.projFalseNorthing),
        ],
      };
    }

    default:
      throw new Error(`Unsupported coordinate transformation type: ${ct}`);
  }
}

function _geographicCs(gkd: GeoKeyDirectory): ProjJsonCoordinateSystem {
  const unit =
    ANGULAR_UNIT[gkd.angularUnits ?? ANGULAR_UNIT_DEGREE] ?? "degree";
  return {
    subtype: "ellipsoidal",
    axis: [
      { name: "Geodetic latitude", abbreviation: "Lat", direction: "north", unit },
      { name: "Geodetic longitude", abbreviation: "Lon", direction: "east", unit },
    ],
  };
}

function _projectedCs(gkd: GeoKeyDirectory): ProjJsonCoordinateSystem {
  const unit: string | ProjJsonUnit =
    LINEAR_UNIT[gkd.projLinearUnits ?? LINEAR_UNIT_METRE] ?? "metre";
  return {
    subtype: "Cartesian",
    axis: [
      { name: "Easting", abbreviation: "E", direction: "east", unit },
      { name: "Northing", abbreviation: "N", direction: "north", unit },
    ],
  };
}
