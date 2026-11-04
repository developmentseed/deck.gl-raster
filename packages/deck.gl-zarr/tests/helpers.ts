import { readFile } from "node:fs/promises";

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
 * - `transposed`: arrays with x before y.
 * - `timed`: arrays with a leading `time` dimension of 4, in chunks of 1.
 *
 * It also has a group `flat`, whose attributes describe `r10m` as one level
 * (`proj:code` and `spatial:` attributes), with these arrays:
 *
 * - `data`: no GeoZarr attributes, like the AEF mosaic's `embeddings`.
 * - `half`: the `spatial:shape` and `spatial:transform` of `r20m`.
 * - `wkt2`: the example's CRS as `proj:wkt2`.
 * - `sub/data`: no GeoZarr attributes, in a group `sub` with none either.
 *
 * And `loose/data`, an array with the attributes of `flat`, in a group without
 * metadata.
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
    transposed: { attributes, dimensionNames: [...dimensions].reverse() },
    timed: { attributes, dimensionNames: ["time", ...dimensions], times: 4 },
  };

  const encode = (json: unknown) =>
    new TextEncoder().encode(JSON.stringify(json));
  /** The `zarr.json` of an empty uint16 array. */
  const encodeArray = (array: {
    shape: number[];
    chunkShape: number[];
    dimensionNames: (string | null)[];
    attributes?: Record<string, unknown>;
  }) =>
    encode({
      zarr_format: 3,
      node_type: "array",
      shape: array.shape,
      data_type: "uint16",
      chunk_grid: {
        name: "regular",
        configuration: { chunk_shape: array.chunkShape },
      },
      chunk_key_encoding: {
        name: "default",
        configuration: { separator: "/" },
      },
      codecs: [{ name: "bytes", configuration: { endian: "little" } }],
      fill_value: 0,
      dimension_names: array.dimensionNames,
      attributes: array.attributes ?? {},
    });
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
        encodeArray({
          shape: group.times
            ? [group.times, ...level["spatial:shape"]]
            : level["spatial:shape"],
          chunkShape: group.times ? [1, 256, 256] : [256, 256],
          dimensionNames: group.dimensionNames,
        }),
      );
    }
  }

  const [r10m, r20m] = attributes.multiscales.layout;
  const flat = {
    "proj:code": attributes["proj:code"],
    "spatial:dimensions": dimensions,
    "spatial:shape": r10m["spatial:shape"],
    "spatial:transform": r10m["spatial:transform"],
  };
  const flatArray = (
    level: { "spatial:shape": number[] },
    attributes: Record<string, unknown> = {},
  ) =>
    encodeArray({
      shape: level["spatial:shape"],
      chunkShape: [256, 256],
      dimensionNames: dimensions,
      attributes,
    });
  const wkt2 = JSON.parse(
    await readFile(
      new URL("../../geozarr/geo-proj/examples/wkt2.json", import.meta.url),
      "utf8",
    ),
  ).attributes["proj:wkt2"];
  blobs.set(
    "/flat/zarr.json",
    encode({ zarr_format: 3, node_type: "group", attributes: flat }),
  );
  blobs.set("/flat/data/zarr.json", flatArray(r10m));
  blobs.set(
    "/flat/half/zarr.json",
    flatArray(r20m, {
      "spatial:shape": r20m["spatial:shape"],
      "spatial:transform": r20m["spatial:transform"],
    }),
  );
  blobs.set("/flat/wkt2/zarr.json", flatArray(r10m, { "proj:wkt2": wkt2 }));
  blobs.set(
    "/flat/sub/zarr.json",
    encode({ zarr_format: 3, node_type: "group", attributes: {} }),
  );
  blobs.set("/flat/sub/data/zarr.json", flatArray(r10m));
  blobs.set("/loose/data/zarr.json", flatArray(r10m, flat));

  const reads: { key: string; signal?: AbortSignal }[] = [];
  const store = {
    async get(key: string, options?: { signal?: AbortSignal }) {
      reads.push({ key, signal: options?.signal });
      return blobs.get(key);
    },
  };
  return { store, reads, attributes };
}
