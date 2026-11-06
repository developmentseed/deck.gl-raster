import { epsgResolver as defaultEpsgResolver } from "@developmentseed/proj";
import proj4 from "proj4";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import * as zarr from "zarrita";
import { ZarrSource } from "../src/index.js";
import type { SpatialArrayDim } from "./helpers.js";
import {
  geoZarrStore,
  openSpatialArray,
  spatialArrayMetadata,
} from "./helpers.js";

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

/** A store whose root is the array `loose/data` of a {@link geoZarrStore}. */
async function rootArrayStore() {
  const { store, reads } = await geoZarrStore();
  const rootArray = {
    get: (key: string, options?: { signal?: AbortSignal }) =>
      store.get(`/loose/data${key}`, options),
  };
  return { store: rootArray, reads };
}

describe("ZarrSource.open", () => {
  it("opens a group's levels, finest first", async () => {
    const { group } = await openGroup("a");

    const source = await ZarrSource.open(group);

    expect(source.levels.map((arr) => arr.path)).toEqual([
      "/a/r10m",
      "/a/r20m",
      "/a/r60m",
    ]);
  });

  it("resolves path in a group", async () => {
    const { root } = await openRoot();

    const source = await ZarrSource.open(root, { path: "b" });

    expect(source.levels[0]!.path).toBe("/b/r10m");
  });

  it.each(["group", "store"] as const)(
    "resolves an absolute path from the store's root, from a %s",
    async (kind) => {
      const { group } = await openGroup("a");
      const input = kind === "group" ? group : group.store;

      const source = await ZarrSource.open(input, { path: "/b" });

      expect(source.levels[0]!.path).toBe("/b/r10m");
    },
  );

  it("opens the group at path in a store", async () => {
    const { store } = await geoZarrStore();

    const source = await ZarrSource.open(store, { path: "a" });

    expect(source.levels.map((arr) => arr.path)).toEqual([
      "/a/r10m",
      "/a/r20m",
      "/a/r60m",
    ]);
  });

  it("opens a store that keeps another store as `store`", async () => {
    const { store } = await geoZarrStore();
    const wrapper = {
      store,
      get: (key: string, options?: { signal?: AbortSignal }) =>
        store.get(key, options),
    };

    const source = await ZarrSource.open(wrapper, { path: "b" });

    expect(source.levels[0]!.path).toBe("/b/r10m");
  });

  it.each([
    { dtype: "uint16", expected: true },
    { dtype: "int8", expected: false },
  ] as const)(
    "checks that its levels are $dtype with is",
    async ({ dtype, expected }) => {
      const { store } = await geoZarrStore();
      const source = await ZarrSource.open(store, { path: "a" });

      expect(source.is(dtype)).toBe(expected);
    },
  );

  it("narrows its data type with is", async () => {
    const { store } = await geoZarrStore();
    const source = await ZarrSource.open(store, { path: "a" });
    expectTypeOf(source).toEqualTypeOf<ZarrSource>();

    if (!source.is("uint16")) {
      throw new Error("Expected uint16");
    }

    expectTypeOf(source).toEqualTypeOf<ZarrSource<"uint16">>();
  });

  it("keeps the group at path as node", async () => {
    const { store } = await geoZarrStore();

    const source = await ZarrSource.open(store, { path: "a" });

    expect([source.node.kind, source.node.path]).toEqual(["group", "/a"]);
  });

  it("keeps the array at path as node", async () => {
    const { store } = await geoZarrStore();

    const source = await ZarrSource.open(store, { path: "flat/data" });

    expect(source.node).toBe(source.levels[0]);
  });

  it("keeps the group passed in as node", async () => {
    const { group } = await openGroup("a");

    const source = await ZarrSource.open(group);

    expect(source.node).toBe(group);
  });

  it.each(["a", "flat/data"])(
    "opens %s in a v3 store without reading v2 metadata",
    async (path) => {
      const { store, reads } = await geoZarrStore();

      await ZarrSource.open(store, { path });

      const v2Keys = reads
        .map((read) => read.key)
        .filter((key) => /\/\.z(group|array|attrs)$/.test(key));
      expect(v2Keys).toEqual([]);
    },
  );

  it("opens an array at path with its group's GeoZarr metadata", async () => {
    const { store } = await geoZarrStore();

    const source = await ZarrSource.open(store, { path: "flat/data" });

    expect(source.levels.map((arr) => arr.path)).toEqual(["/flat/data"]);
  });

  it("opens an array passed in with its group's GeoZarr metadata", async () => {
    const { group } = await openGroup("flat");
    const array = await zarr.open(group.resolve("data"), { kind: "array" });

    const source = await ZarrSource.open(array);

    expect(source.levels[0]).toBe(array);
  });

  it("doesn't read the group passed in again for an array in it", async () => {
    const { group, reads } = await openGroup("flat");
    reads.length = 0;

    await ZarrSource.open(group, { path: "data" });

    expect(reads.map((read) => read.key)).toEqual(["/flat/data/zarr.json"]);
  });

  it("opens an array at the root of a store without looking for its group", async () => {
    const { store, reads } = await rootArrayStore();

    await ZarrSource.open(store);

    expect(reads.map((read) => read.key)).toEqual(["/loose/data/zarr.json"]);
  });

  it("opens an array whose group can't be found with its own GeoZarr metadata", async () => {
    const { store } = await geoZarrStore();

    const source = await ZarrSource.open(store, { path: "loose/data" });

    expect(source.levels.map((arr) => arr.path)).toEqual(["/loose/data"]);
  });

  it("reads no group when given geoZarrMetadata", async () => {
    const { group, reads } = await openGroup("flat");
    const array = await zarr.open(group.resolve("data"), { kind: "array" });
    reads.length = 0;

    await ZarrSource.open(array, { geoZarrMetadata: group.attrs });

    expect(reads).toEqual([]);
  });

  it("doesn't give an array GeoZarr metadata from groups above its own", async () => {
    const { store } = await geoZarrStore();

    await expect(
      ZarrSource.open(store, { path: "flat/sub/data" }),
    ).rejects.toThrow(/spatial:dimensions/);
  });

  it("doesn't give a group its parent's GeoZarr metadata", async () => {
    const { store } = await geoZarrStore();

    await expect(ZarrSource.open(store, { path: "flat/sub" })).rejects.toThrow(
      /spatial:dimensions/,
    );
  });

  it("doesn't give an array its group's multiscales", async () => {
    const { store } = await geoZarrStore();

    // The group's levels have their transforms in `multiscales` only
    await expect(ZarrSource.open(store, { path: "a/r10m" })).rejects.toThrow(
      /spatial:transform is required/,
    );
  });

  it("reads an array's CRS instead of its group's", async () => {
    const { store } = await geoZarrStore();
    const epsgResolver = vi.fn(defaultEpsgResolver);

    await ZarrSource.open(store, { path: "flat/wkt2", epsgResolver });

    // The group's CRS is a `proj:code`, and the array's a `proj:wkt2`
    expect(epsgResolver).not.toHaveBeenCalled();
  });

  it("reads each of an array's spatial: attributes instead of its group's", async () => {
    const { store } = await geoZarrStore();

    // `half` has its own shape and transform, and its group's dimensions
    const source = await ZarrSource.open(store, { path: "flat/half" });

    // 600 pixels in chunks of 256
    expect(
      source.tilesetDescriptor.levels.map((level) => level.matrixWidth),
    ).toEqual([3]);
  });

  it("rejects a level that's a group without reading v2 metadata", async () => {
    const { store, attributes } = await geoZarrStore();
    const [r10m] = attributes.multiscales.layout;
    const geoZarrMetadata = {
      ...attributes,
      multiscales: { layout: [{ ...r10m, asset: "sub" }] },
    };

    await expect(
      ZarrSource.open(store, { path: "flat", geoZarrMetadata }),
    ).rejects.toThrow("Not found: array at /flat/sub");
  });

  it("asks for path when a group's metadata describes one array", async () => {
    const { store } = await geoZarrStore();

    await expect(ZarrSource.open(store, { path: "flat" })).rejects.toThrow(
      /`path`/,
    );
  });

  it("reads geoZarrMetadata instead of the group's attrs", async () => {
    const { group, attributes } = await openGroup("bare");

    const source = await ZarrSource.open(group, {
      geoZarrMetadata: attributes,
    });

    expect(source.levels.map((arr) => arr.path)).toEqual([
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

    await ZarrSource.open(root, { path: "a", signal });

    expect(reads.map((read) => read.key)).toContain("/a/r60m/zarr.json");
    expect(reads.every((read) => read.signal === signal)).toBe(true);
  });

  it("passes its signal to the read of an array's group", async () => {
    const { store, reads } = await geoZarrStore();
    const { signal } = new AbortController();

    await ZarrSource.open(store, { path: "flat/data", signal });

    expect(reads.map((read) => read.key)).toContain("/flat/zarr.json");
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

  it("rejects levels whose data types differ", async () => {
    const { root, attributes } = await openRoot();
    // r10m from group `a`, and r20m from group `bytes`, of uint8
    const [r10m, r20m] = attributes.multiscales.layout;
    const geoZarrMetadata = {
      ...attributes,
      multiscales: {
        layout: [
          { ...r10m, asset: "a/r10m" },
          { ...r20m, asset: "bytes/r20m" },
        ],
      },
    };

    await expect(ZarrSource.open(root, { geoZarrMetadata })).rejects.toThrow(
      "/bytes/r20m has uint8, but /a/r10m has uint16",
    );
  });

  it("rejects levels whose dimensions differ", async () => {
    const { root, attributes } = await openRoot();
    // r10m from group `a`, and r20m from group `timed`, with a time dimension
    const [r10m, r20m] = attributes.multiscales.layout;
    const geoZarrMetadata = {
      ...attributes,
      multiscales: {
        layout: [
          { ...r10m, asset: "a/r10m" },
          { ...r20m, asset: "timed/r20m" },
        ],
      },
    };

    await expect(ZarrSource.open(root, { geoZarrMetadata })).rejects.toThrow(
      '/timed/r20m has ["time","Y","X"], but /a/r10m has ["Y","X"]',
    );
  });

  it.each<{ name: string; dimensionNames: SpatialArrayDim[] }>([
    { name: "[lat, lon]", dimensionNames: ["lat", "lon"] },
    { name: "[band, lat, lon]", dimensionNames: ["band", "lat", "lon"] },
    {
      name: "channel-last [lat, lon, band]",
      dimensionNames: ["lat", "lon", "band"],
    },
  ])(
    "sizes tiles by the chunks of the y and x dims of a $name array",
    async ({ dimensionNames }) => {
      const array = await openSpatialArray(dimensionNames);

      const source = await ZarrSource.open(array, {
        geoZarrMetadata: spatialArrayMetadata,
      });

      const level = source.tilesetDescriptor.levels[0]!;
      expect([level.tileWidth, level.tileHeight]).toEqual([512, 256]);
    },
  );
});
