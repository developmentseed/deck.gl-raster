import { SampleFormat, TiffTag } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import type { GeographicCRS } from "../src/crs.js";
import { decode } from "../src/decode/api.js";
import { loadGeoTIFF } from "./helpers.js";

/** Fetched from https://epsg.io/4326.json */
const EPSG_4326: GeographicCRS = {
  $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
  type: "GeographicCRS",
  name: "WGS 84",
  datum_ensemble: {
    name: "World Geodetic System 1984 ensemble",
    members: [
      {
        name: "World Geodetic System 1984 (Transit)",
        id: { authority: "EPSG", code: 1166 },
      },
      {
        name: "World Geodetic System 1984 (G730)",
        id: { authority: "EPSG", code: 1152 },
      },
      {
        name: "World Geodetic System 1984 (G873)",
        id: { authority: "EPSG", code: 1153 },
      },
      {
        name: "World Geodetic System 1984 (G1150)",
        id: { authority: "EPSG", code: 1154 },
      },
      {
        name: "World Geodetic System 1984 (G1674)",
        id: { authority: "EPSG", code: 1155 },
      },
      {
        name: "World Geodetic System 1984 (G1762)",
        id: { authority: "EPSG", code: 1156 },
      },
      {
        name: "World Geodetic System 1984 (G2139)",
        id: { authority: "EPSG", code: 1309 },
      },
      {
        name: "World Geodetic System 1984 (G2296)",
        id: { authority: "EPSG", code: 1383 },
      },
    ],
    ellipsoid: {
      name: "WGS 84",
      semi_major_axis: 6378137,
      inverse_flattening: 298.257223563,
    },
    accuracy: "2.0",
    id: { authority: "EPSG", code: 6326 },
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
  scope: "Horizontal component of 3D system.",
  area: "World.",
  bbox: {
    south_latitude: -90,
    west_longitude: -180,
    north_latitude: 90,
    east_longitude: 180,
  },
  id: { authority: "EPSG", code: 4326 },
};

describe("test CRS", () => {
  it("can fetch EPSG CRS from epsg.io", async () => {
    const geotiff = await loadGeoTIFF(
      "uint8_rgb_deflate_block64_cog",
      "rasterio",
    );
    const crs = await geotiff.crs();
    expect(crs).toEqual(EPSG_4326);

    const epsg = geotiff.epsg;
    expect(epsg).toBe(4326);
  });
});

/** Copied from `gdalinfo -json nlcd_landcover.tif | jq '.stac.["proj:projjson"]'` */
const NLCD_EXPECTED = {
  $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
  type: "ProjectedCRS",
  name: "AEA        WGS84",
  base_crs: {
    type: "GeographicCRS",
    name: "WGS 84",
    datum: {
      type: "GeodeticReferenceFrame",
      name: "World Geodetic System 1984",
      ellipsoid: {
        name: "WGS 84",
        semi_major_axis: 6378137,
        inverse_flattening: 298.257223563,
      },
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
    id: {
      authority: "EPSG",
      code: 4326,
    },
  },
  conversion: {
    name: "Albers Equal Area",
    method: {
      name: "Albers Equal Area",
      id: {
        authority: "EPSG",
        code: 9822,
      },
    },
    parameters: [
      {
        name: "Latitude of false origin",
        value: 23,
        unit: "degree",
        id: {
          authority: "EPSG",
          code: 8821,
        },
      },
      {
        name: "Longitude of false origin",
        value: -96,
        unit: "degree",
        id: {
          authority: "EPSG",
          code: 8822,
        },
      },
      {
        name: "Latitude of 1st standard parallel",
        value: 29.5,
        unit: "degree",
        id: {
          authority: "EPSG",
          code: 8823,
        },
      },
      {
        name: "Latitude of 2nd standard parallel",
        value: 45.5,
        unit: "degree",
        id: {
          authority: "EPSG",
          code: 8824,
        },
      },
      {
        name: "Easting at false origin",
        value: 0,
        unit: "metre",
        id: {
          authority: "EPSG",
          code: 8826,
        },
      },
      {
        name: "Northing at false origin",
        value: 0,
        unit: "metre",
        id: {
          authority: "EPSG",
          code: 8827,
        },
      },
    ],
  },
  coordinate_system: {
    subtype: "Cartesian",
    axis: [
      {
        name: "Easting",
        abbreviation: "",
        direction: "east",
        unit: "metre",
      },
      {
        name: "Northing",
        abbreviation: "",
        direction: "north",
        unit: "metre",
      },
    ],
  },
};

describe("test GeoKey CRS parsing", () => {
  it("can parse geographic CRS from GeoKeys", async () => {
    const geotiff = await loadGeoTIFF("nlcd_landcover", "nlcd");
    const crs = await geotiff.crs();
    console.log(crs);

    expect(crs).toEqual(NLCD_EXPECTED);
  });
});
