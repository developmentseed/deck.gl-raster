import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import * as zarr from "zarrita";
import { ZarrSource } from "../src/index.js";
import { geoZarrStore } from "./helpers.js";

/** The opened root group of a {@link geoZarrStore}, and the store's reads. */
async function openRoot() {
  const { store, reads, attributes } = await geoZarrStore();
  const root = await zarr.open(zarr.root(store), { kind: "group" });
  return { root, reads, attributes };
}

/** The opened group `name` of a {@link geoZarrStore}. */
async function openGroup(name: string) {
  const { root, reads, attributes } = await openRoot();
  const group = await zarr.open(root.resolve(name), { kind: "group" });
  return { group, reads, attributes };
}

describe("ZarrSource.open", () => {
  it("opens a group's levels, finest first", async () => {
    const { group } = await openGroup("a");

    const source = await ZarrSource.open(group);

    expect(source.arrays.map((arr) => arr.path)).toEqual([
      "/a/r10m",
      "/a/r20m",
      "/a/r60m",
    ]);
  });

  it("resolves variable in a group", async () => {
    const { root } = await openRoot();

    const source = await ZarrSource.open(root, { variable: "b" });

    expect(source.arrays[0]!.path).toBe("/b/r10m");
  });

  it("reads geoZarrMetadata instead of the group's attrs", async () => {
    const { group, attributes } = await openGroup("bare");

    const source = await ZarrSource.open(group, {
      geoZarrMetadata: attributes,
    });

    expect(source.arrays.map((arr) => arr.path)).toEqual([
      "/bare/r10m",
      "/bare/r20m",
      "/bare/r60m",
    ]);
  });

  it("names the dimensions", async () => {
    const { group } = await openGroup("a");

    const source = await ZarrSource.open(group);

    expect(source.dimensionNames).toEqual(["Y", "X"]);
    expect(source.spatialDims).toEqual(["Y", "X"]);
  });

  it("builds a tile grid of its levels, coarsest first", async () => {
    const { group } = await openGroup("a");

    const source = await ZarrSource.open(group);

    expect(
      source.tilesetDescriptor.levels.map((level) => level.matrixWidth),
    ).toEqual([1, 3, 5]);
  });

  it("bounds the finest level in WGS84", async () => {
    const { group } = await openGroup("a");
    const converter = proj4(
      "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
      "EPSG:4326",
    );
    // The corners of r10m: 1200 pixels of 10 m from (500000, 5000000)
    const corners = [
      [500000, 5000000],
      [512000, 5000000],
      [512000, 4988000],
      [500000, 4988000],
    ].map((corner) => converter.forward(corner));
    const lons = corners.map(([lon]) => lon!);
    const lats = corners.map(([, lat]) => lat!);

    const { geographicBounds } = await ZarrSource.open(group);

    expect(geographicBounds.west).toBeCloseTo(Math.min(...lons), 9);
    expect(geographicBounds.south).toBeCloseTo(Math.min(...lats), 9);
    expect(geographicBounds.east).toBeCloseTo(Math.max(...lons), 9);
    expect(geographicBounds.north).toBeCloseTo(Math.max(...lats), 9);
  });

  it("moves the bounds by half a pixel for node registration", async () => {
    const { group, attributes } = await openGroup("a");

    const pixel = await ZarrSource.open(group);
    const node = await ZarrSource.open(group, {
      geoZarrMetadata: { ...attributes, "spatial:registration": "node" },
    });

    // The pixels' corners are half a pixel up and to the left of their
    // centers, as in the tile grid
    expect(node.geographicBounds.west).toBeLessThan(
      pixel.geographicBounds.west,
    );
    expect(node.geographicBounds.east).toBeLessThan(
      pixel.geographicBounds.east,
    );
    expect(node.geographicBounds.north).toBeGreaterThan(
      pixel.geographicBounds.north,
    );
  });

  it("keeps the bounds of a grid centered on the poles within -90° to 90°", async () => {
    const { group } = await openGroup("a");
    const array = await zarr.open(group.resolve("r10m"), { kind: "array" });
    // A global 0.25° grid of 721 rows from 90°N, as in the ECMWF example,
    // reaches to 90.25°S
    const geoZarrMetadata = {
      "proj:code": "EPSG:4326",
      "spatial:dimensions": ["Y", "X"],
      "spatial:shape": [721, 1440],
      "spatial:transform": [0.25, 0, -180, 0, -0.25, 90],
    };

    const { geographicBounds } = await ZarrSource.open(array, {
      geoZarrMetadata,
    });

    expect(geographicBounds.south).toBe(-90);
    expect(geographicBounds.north).toBe(90);
  });

  it("passes its signal to every read", async () => {
    const { root, reads } = await openRoot();
    reads.length = 0;
    const { signal } = new AbortController();

    await ZarrSource.open(root, { variable: "a", signal });

    expect(reads.map((read) => read.key)).toContain("/a/r60m/zarr.json");
    expect(reads.every((read) => read.signal === signal)).toBe(true);
  });

  it("rejects with the reason of an aborted signal", async () => {
    const { group } = await openGroup("a");
    const reason = new Error("stop");

    await expect(
      ZarrSource.open(group, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });

  it("rejects arrays whose dimensions have no names", async () => {
    const { group } = await openGroup("unnamed");

    await expect(ZarrSource.open(group)).rejects.toThrow(
      /every zarr array dimension to have a name/,
    );
  });

  it("rejects arrays with x before y", async () => {
    const { group } = await openGroup("transposed");

    await expect(ZarrSource.open(group)).rejects.toThrow(/swapped/);
  });
});
