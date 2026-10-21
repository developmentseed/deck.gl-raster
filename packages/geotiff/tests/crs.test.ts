import { parseWkt } from "@developmentseed/proj";
import { describe, expect, it } from "vitest";
import { crsFromGeoKeys } from "../src/crs.js";
import { loadGeoTIFF } from "./helpers.js";

describe("test CRS", () => {
  it("returns EPSG code", async () => {
    const geotiff = await loadGeoTIFF(
      "uint8_rgb_deflate_block64_cog",
      "rasterio",
    );
    const crs = geotiff.crs;
    expect(crs).toEqual(4326);
  });
});

/**
 * Expected PROJJSON for nlcd_landcover.tif — a user-defined Albers Equal Area
 * projected CRS over WGS84, built from raw geo keys (no EPSG fetch).
 *
 * Note: differs from `gdalinfo` output in that we don't emit EPSG `id` fields
 * on the method/parameters (we don't have an EPSG registry) and we use
 * geodeticCitation ("WGS 84") as the datum/ellipsoid name rather than the
 * canonical "World Geodetic System 1984".
 */
const NLCD_EXPECTED = {
  $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
  type: "ProjectedCRS",
  name: "AEA        WGS84",
  base_crs: {
    type: "GeographicCRS",
    name: "WGS 84",
    datum: {
      type: "GeodeticReferenceFrame",
      name: "WGS 84",
      ellipsoid: {
        name: "WGS 84",
        semi_major_axis: 6378137,
        inverse_flattening: 298.257223563,
      },
      prime_meridian: { name: "Greenwich", longitude: 0 },
    },
    coordinate_system: {
      subtype: "ellipsoidal",
      axis: [
        {
          name: "Geodetic latitude",
          abbreviation: "Lat",
          direction: "north",
          unit: "degree",
        },
        {
          name: "Geodetic longitude",
          abbreviation: "Lon",
          direction: "east",
          unit: "degree",
        },
      ],
    },
  },
  conversion: {
    name: "Albers Equal Area",
    method: { name: "Albers Equal Area" },
    parameters: [
      { name: "Latitude of false origin", value: 23, unit: "degree" },
      { name: "Longitude of false origin", value: -96, unit: "degree" },
      {
        name: "Latitude of 1st standard parallel",
        value: 29.5,
        unit: "degree",
      },
      {
        name: "Latitude of 2nd standard parallel",
        value: 45.5,
        unit: "degree",
      },
      { name: "Easting at false origin", value: 0, unit: "metre" },
      { name: "Northing at false origin", value: 0, unit: "metre" },
    ],
  },
  coordinate_system: {
    subtype: "Cartesian",
    axis: [
      { name: "Easting", abbreviation: "E", direction: "east", unit: "metre" },
      {
        name: "Northing",
        abbreviation: "N",
        direction: "north",
        unit: "metre",
      },
    ],
  },
};

describe("test GeoKey CRS parsing", () => {
  it("can parse user-defined projected CRS from GeoKeys", async () => {
    const geotiff = await loadGeoTIFF("nlcd_landcover", "nlcd");
    const crs = geotiff.crs;

    expect(crs).toEqual(NLCD_EXPECTED);

    // Verify wkt-parser can consume our PROJJSON and extract the fields
    // needed for TileMatrixSet construction (semi-major axis, units).
    if (typeof crs === "number") {
      throw new Error("expected PROJJSON, got EPSG code");
    }
    const proj = parseWkt(crs);
    expect(proj.a).toBe(6378137);
    expect(proj.units).toBe("meter");
    expect(proj.projName).toBe("Albers Equal Area");
  });

  it("can parse an ESRI PE String citation under a user-defined model type", async () => {
    // hfp_2017_100m_v1-2_cog: GTModelTypeGeoKey = 32767 (ModelTypeUserDefined),
    // CRS only reconstructable from the `ESRI PE String = ...` citation.
    const geotiff = await loadGeoTIFF(
      "hfp_2017_100m_v1-2_cog",
      "source-coop-vizzuality",
    );
    const crs = geotiff.crs;

    if (typeof crs !== "string") {
      throw new Error("expected raw WKT string for ESRI PE String CRS");
    }
    expect(crs.startsWith("PROJCS[")).toBe(true);
    expect(crs).toContain("Mollweide");

    // wkt-parser must be able to consume the WKT for downstream TMS use.
    const proj = parseWkt(crs);
    expect(proj.projName).toBe("Mollweide");
    expect(proj.units).toBe("meter");
    expect(proj.a ?? proj.datum?.a).toBe(6378137);
  });
});

/**
 * Parameters of New Brunswick Stereographic (equivalent to EPSG:2953), in the
 * order the Oblique Stereographic and Stereographic conversions emit them.
 */
const NEW_BRUNSWICK_STEREOGRAPHIC_PARAMETERS = [
  { name: "Latitude of natural origin", value: 46.5, unit: "degree" },
  { name: "Longitude of natural origin", value: -66.5, unit: "degree" },
  { name: "Scale factor at natural origin", value: 0.999912, unit: "unity" },
  { name: "False easting", value: 2500000, unit: "metre" },
  { name: "False northing", value: 7500000, unit: "metre" },
];

describe("user-defined projection parameters", () => {
  it("reads the Oblique Stereographic origin from ProjNatOrigin* keys", async () => {
    // https://github.com/source-cooperative/cog-viewer/issues/40
    const geotiff = await loadGeoTIFF(
      "O2308000_7586000_cog",
      "source-coop-dataforcanada",
    );

    expect(geotiff.crs).toMatchObject({
      conversion: {
        method: { name: "Oblique Stereographic" },
        parameters: NEW_BRUNSWICK_STEREOGRAPHIC_PARAMETERS,
      },
    });
  });

  it("reads the Stereographic scale factor from ProjScaleAtNatOriginGeoKey", async () => {
    // GDAL writes CT_Stereographic with the origin in ProjCenter{Lat,Long} but
    // the scale factor in ProjScaleAtNatOrigin.
    const { gkd } = await loadGeoTIFF(
      "O2308000_7586000_cog",
      "source-coop-dataforcanada",
    );
    const crs = crsFromGeoKeys({
      ...gkd,
      projMethod: 14,
      projCenterLat: gkd.projNatOriginLat,
      projCenterLong: gkd.projNatOriginLong,
      projNatOriginLat: null,
      projNatOriginLong: null,
    });

    expect(crs).toMatchObject({
      conversion: {
        method: { name: "Stereographic" },
        parameters: NEW_BRUNSWICK_STEREOGRAPHIC_PARAMETERS,
      },
    });
  });
});
