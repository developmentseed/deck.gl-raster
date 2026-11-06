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
  it("takes Y from the first entry and X from the second, whatever their names", () => {
    const meta = parseGeoZarrMetadata(
      attrsWithDimensions(["northing", "easting"]),
    );
    expect(spatialAxes(meta)).toEqual({ y: "northing", x: "easting" });
  });

  it("takes Y and X by position even when their names suggest otherwise", () => {
    const meta = parseGeoZarrMetadata(attrsWithDimensions(["lon", "lat"]));
    expect(spatialAxes(meta)).toEqual({ y: "lon", x: "lat" });
  });

  it("rejects fewer than 2 entries", () => {
    expect(() =>
      parseGeoZarrMetadata(attrsWithDimensions(["easting"])),
    ).toThrow(/spatial:dimensions/);
  });

  it("rejects more than 2 entries", () => {
    expect(() =>
      parseGeoZarrMetadata(
        attrsWithDimensions(["depth", "northing", "easting"]),
      ),
    ).toThrow(/spatial:dimensions/);
  });
});

describe("parseGeoZarrMetadata multiscales", () => {
  it("orders levels finest first, whatever the layout's order", () => {
    // As in the multiscales convention's DEM example, which lists an
    // upsampled level last
    const layout = [30, 90, 270, 10].map((size) => ({
      asset: `dem_${size}m`,
      "spatial:transform": [size, 0, 500000, 0, -size, 5000000],
      "spatial:shape": [8100 / size, 8100 / size],
    }));
    const meta = parseGeoZarrMetadata({
      "spatial:dimensions": ["y", "x"],
      "proj:code": "EPSG:32633",
      multiscales: { layout },
    });
    expect(meta.levels.map((level) => level.path)).toEqual([
      "dem_10m",
      "dem_30m",
      "dem_90m",
      "dem_270m",
    ]);
  });
});
