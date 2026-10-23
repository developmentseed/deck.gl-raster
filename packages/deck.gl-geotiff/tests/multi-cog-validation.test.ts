import type { GeoTIFF } from "@developmentseed/geotiff";
import { describe, expect, it } from "vitest";
import { validateSources } from "../src/multi-cog-validation.js";

/**
 * A source named `name` with north-up pixels `pixelSize` CRS units wide,
 * covering `bbox`, in EPSG:32633 unless `crs` is given.
 */
function source(opts: {
  name: string;
  bbox: [number, number, number, number];
  pixelSize: number;
  crs?: GeoTIFF["crs"];
}) {
  const { name, bbox, pixelSize, crs = 32633 } = opts;
  return {
    name,
    geotiff: {
      crs,
      bbox,
      transform: [pixelSize, 0, bbox[0], 0, -pixelSize, bbox[3]] as const,
    },
  };
}

/** A user-defined geographic CRS, as a new PROJJSON object on each call. */
function projjson(semiMajorAxis = 6378137): GeoTIFF["crs"] {
  return {
    type: "GeographicCRS",
    name: "User-defined",
    datum: {
      type: "GeodeticReferenceFrame",
      name: "User-defined",
      ellipsoid: {
        name: "User-defined",
        semi_major_axis: semiMajorAxis,
        inverse_flattening: 298.257223563,
      },
    },
    coordinate_system: { subtype: "ellipsoidal", axis: [] },
  };
}

// The primary: 10 m pixels covering 1 km x 1 km.
const fine = source({ name: "fine", bbox: [0, 0, 1000, 1000], pixelSize: 10 });

describe("validateSources", () => {
  it("accepts sources with the same CRS and bbox", () => {
    const coarse = source({
      name: "coarse",
      bbox: [0, 0, 1000, 1000],
      pixelSize: 20,
    });
    expect(() => validateSources([fine, coarse], "fine")).not.toThrow();
  });

  it("throws when a source has a different EPSG code", () => {
    const other = source({
      name: "other",
      bbox: [0, 0, 1000, 1000],
      pixelSize: 10,
      crs: 32634,
    });
    expect(() => validateSources([fine, other], "fine")).toThrow(
      'Source "other" has CRS EPSG:32634, but the primary source "fine" has EPSG:32633.',
    );
  });

  it("accepts equal PROJJSON CRSs held in separate objects", () => {
    const a = source({
      name: "a",
      bbox: [0, 0, 1, 1],
      pixelSize: 0.1,
      crs: projjson(),
    });
    const b = source({
      name: "b",
      bbox: [0, 0, 1, 1],
      pixelSize: 0.1,
      crs: projjson(),
    });
    expect(() => validateSources([a, b], "a")).not.toThrow();
  });

  it("throws when two PROJJSON CRSs differ", () => {
    const a = source({
      name: "a",
      bbox: [0, 0, 1, 1],
      pixelSize: 0.1,
      crs: projjson(),
    });
    const b = source({
      name: "b",
      bbox: [0, 0, 1, 1],
      pixelSize: 0.1,
      crs: projjson(6378206.4),
    });
    expect(() => validateSources([a, b], "a")).toThrow(
      'Source "b" has CRS {"type":"GeographicCRS"',
    );
  });

  it("accepts CRSs in forms it can't compare, such as an EPSG code and WKT", () => {
    const wkt = source({
      name: "wkt",
      bbox: [0, 0, 1000, 1000],
      pixelSize: 10,
      crs: 'PROJCS["WGS 84 / UTM zone 33N",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",15],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1]]',
    });
    expect(() => validateSources([fine, wkt], "fine")).not.toThrow();
  });

  it("accepts bbox edges up to one pixel of the coarser source apart", () => {
    // Each edge is one 20 m pixel out, which is two of the primary's pixels.
    const coarse = source({
      name: "coarse",
      bbox: [-20, -20, 1020, 1020],
      pixelSize: 20,
    });
    expect(() => validateSources([fine, coarse], "fine")).not.toThrow();
  });

  it("throws when a bbox edge is more than one pixel of the coarser source apart", () => {
    const coarse = source({
      name: "coarse",
      bbox: [0, 0, 1030, 1000],
      pixelSize: 20,
    });
    expect(() => validateSources([fine, coarse], "fine")).toThrow(
      'Source "coarse" has bbox [0, 0, 1030, 1000], but the primary source "fine" has [0, 0, 1000, 1000].',
    );
  });
});
