import { readFile } from "node:fs/promises";
import * as zarr from "zarrita";

/** A group in {@link geoZarrStore}. */
type GroupSpec = {
  /** The group's attributes. */
  attributes: Record<string, unknown>;
  /** The `dimension_names` of the group's arrays. */
  dimensionNames: (string | null)[];
  /** The length of a leading time dimension, for arrays that have one. */
  times?: number;
};

/**
 * A store built from the GeoZarr multiscales example (EPSG:32633; levels
 * `r10m`, `r20m` and `r60m` of 1200, 600 and 200 pixels). It has an empty root
 * group, and these groups, each with an empty uint16 array per level:
 *
 * - `a` and `b`: the example as it is.
 * - `bare`: no GeoZarr attributes.
 * - `unnamed`: arrays whose dimensions have no names.
 * - `timed`: arrays with a leading `time` dimension of 4, in chunks of 1.
 *
 * It records each read's key and abort signal.
 */
export async function geoZarrStore() {
  const { attributes } = JSON.parse(
    await readFile(
      new URL(
        "../../geozarr/geo-proj/examples/multiscales.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const dimensions: string[] = attributes["spatial:dimensions"];
  const groups: Record<string, GroupSpec> = {
    a: { attributes, dimensionNames: dimensions },
    b: { attributes, dimensionNames: dimensions },
    bare: { attributes: {}, dimensionNames: dimensions },
    unnamed: { attributes, dimensionNames: [null, null] },
    timed: { attributes, dimensionNames: ["time", ...dimensions], times: 4 },
  };

  const encode = (json: unknown) =>
    new TextEncoder().encode(JSON.stringify(json));
  const blobs = new Map<string, Uint8Array>();
  blobs.set(
    "/zarr.json",
    encode({ zarr_format: 3, node_type: "group", attributes: {} }),
  );
  for (const [name, group] of Object.entries(groups)) {
    blobs.set(
      `/${name}/zarr.json`,
      encode({
        zarr_format: 3,
        node_type: "group",
        attributes: group.attributes,
      }),
    );
    for (const level of attributes.multiscales.layout) {
      blobs.set(
        `/${name}/${level.asset}/zarr.json`,
        encode({
          zarr_format: 3,
          node_type: "array",
          shape: group.times
            ? [group.times, ...level["spatial:shape"]]
            : level["spatial:shape"],
          data_type: "uint16",
          chunk_grid: {
            name: "regular",
            configuration: {
              chunk_shape: group.times ? [1, 256, 256] : [256, 256],
            },
          },
          chunk_key_encoding: {
            name: "default",
            configuration: { separator: "/" },
          },
          codecs: [{ name: "bytes", configuration: { endian: "little" } }],
          fill_value: 0,
          dimension_names: group.dimensionNames,
          attributes: {},
        }),
      );
    }
  }

  const reads: { key: string; signal?: AbortSignal }[] = [];
  const store = {
    async get(key: string, options?: { signal?: AbortSignal }) {
      reads.push({ key, signal: options?.signal });
      return blobs.get(key);
    },
  };
  return { store, reads, attributes };
}

/** The length and chunk length of each dimension {@link openSpatialArray} knows. */
const SPATIAL_ARRAY_DIMS = {
  lat: { length: 1000, chunk: 256 },
  lon: { length: 2000, chunk: 512 },
  band: { length: 4, chunk: 4 },
};

/** A dimension of an {@link openSpatialArray} array. */
export type SpatialArrayDim = keyof typeof SPATIAL_ARRAY_DIMS;

/**
 * GeoZarr metadata for an {@link openSpatialArray} array: a single-level
 * EPSG:4326 raster of 1000 rows (`lat`) by 2000 columns (`lon`).
 */
export const spatialArrayMetadata = {
  "proj:code": "EPSG:4326",
  "spatial:dimensions": ["lat", "lon"],
  "spatial:shape": [1000, 2000],
  "spatial:transform": [0.01, 0, 0, 0, -0.01, 10],
};

/**
 * Open an empty in-memory uint8 array with the dimensions `dimensionNames`, in
 * that order: `lat` (1000 rows in chunks of 256), `lon` (2000 columns in
 * chunks of 512) and `band` (4, in one chunk). Rows and columns differ in
 * length and chunk length, so a swap of y and x shows.
 */
export async function openSpatialArray(dimensionNames: SpatialArrayDim[]) {
  const dims = dimensionNames.map((name) => SPATIAL_ARRAY_DIMS[name]);
  const metadata = {
    zarr_format: 3,
    node_type: "array",
    shape: dims.map((dim) => dim.length),
    data_type: "uint8",
    chunk_grid: {
      name: "regular",
      configuration: { chunk_shape: dims.map((dim) => dim.chunk) },
    },
    chunk_key_encoding: {
      name: "default",
      configuration: { separator: "/" },
    },
    codecs: [{ name: "bytes", configuration: { endian: "little" } }],
    fill_value: 0,
    dimension_names: dimensionNames,
    attributes: {},
  };
  const store = {
    async get(key: string) {
      return key === "/zarr.json"
        ? new TextEncoder().encode(JSON.stringify(metadata))
        : undefined;
    },
  };
  return zarr.open.v3(store, { kind: "array" });
}
