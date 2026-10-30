import { describe, expect, it } from "vitest";
import { parseGeoZarrMetadata } from "../src/parse.js";
import type { GeoZarrMetadata } from "../src/types.js";

/** Single-resolution GeoZarr attrs with the given `spatial:dimensions`. */
function attrsWithDimensions(dimensions: string[]): unknown {
  return {
    "spatial:dimensions": dimensions,
    "spatial:transform": [10, 0, 500000, 0, -10, 5000000],
    "spatial:shape": [256, 512],
    "proj:code": "EPSG:32633",
  };
}

/** The names of the axes that `meta` identifies as Y and X. */
function spatialAxes(meta: GeoZarrMetadata): { y?: string; x?: string } {
  return { y: meta.axes[meta.yAxisIndex], x: meta.axes[meta.xAxisIndex] };
}

describe("parseGeoZarrMetadata spatial:dimensions", () => {
  it("takes Y and X from the last two entries when the names are not recognized", () => {
    const meta = parseGeoZarrMetadata(
      attrsWithDimensions(["northing", "easting"]),
    );
    expect(spatialAxes(meta)).toEqual({ y: "northing", x: "easting" });
  });

  it("takes Y and X from the last two entries of a 3-entry list", () => {
    const meta = parseGeoZarrMetadata(
      attrsWithDimensions(["depth", "northing", "easting"]),
    );
    expect(spatialAxes(meta)).toEqual({ y: "northing", x: "easting" });
  });

  it("prefers recognized Y and X labels over position", () => {
    const meta = parseGeoZarrMetadata(attrsWithDimensions(["lon", "lat"]));
    expect(spatialAxes(meta)).toEqual({ y: "lat", x: "lon" });
  });

  it("rejects fewer than 2 entries", () => {
    expect(() =>
      parseGeoZarrMetadata(attrsWithDimensions(["easting"])),
    ).toThrow(/spatial:dimensions/);
  });
});
