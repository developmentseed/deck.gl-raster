import { describe, expect, it } from "vitest";
import wktParser from "wkt-parser";
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
    const proj = wktParser(crs);
    expect(proj.a).toBe(6378137);
    expect(proj.units).toBe("meter");
    expect(proj.projName).toBe("Albers Equal Area");
  });
});
