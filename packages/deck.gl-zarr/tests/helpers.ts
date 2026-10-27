import { readFile } from "node:fs/promises";

/** A group in {@link geoZarrStore}. */
type GroupSpec = {
  /** The group's attributes. */
  attributes: Record<string, unknown>;
  /** The `dimension_names` of the group's arrays. */
  dimensionNames: (string | null)[];
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
          shape: level["spatial:shape"],
          data_type: "uint16",
          chunk_grid: {
            name: "regular",
            configuration: { chunk_shape: [256, 256] },
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
