import { describe, expect, it } from "vitest";
import * as zarr from "zarrita";

describe("zarrita sharded arrays", () => {
  it("exposes the inner sharding chunk as arr.chunks", async () => {
    // Synthesize an in-memory Zarr v3 array with a sharding codec. A sharded
    // array exercises the `kind: "sharded"` branch of zarrita's createContext,
    // which sets chunkShape = configuration.chunk_shape (the inner chunk).
    const arrayMetadata = {
      zarr_format: 3,
      node_type: "array",
      shape: [4096, 4096],
      data_type: "int8",
      chunk_grid: {
        name: "regular",
        configuration: { chunk_shape: [4096, 4096] },
      },
      chunk_key_encoding: {
        name: "default",
        configuration: { separator: "/" },
      },
      fill_value: -128,
      codecs: [
        {
          name: "sharding_indexed",
          configuration: {
            chunk_shape: [256, 256],
            codecs: [{ name: "bytes", configuration: { endian: "little" } }],
            index_codecs: [
              { name: "bytes", configuration: { endian: "little" } },
              { name: "crc32c" },
            ],
            index_location: "end",
          },
        },
      ],
      attributes: {},
      dimension_names: ["y", "x"],
    };
    const blobs = new Map<string, Uint8Array>([
      ["/zarr.json", new TextEncoder().encode(JSON.stringify(arrayMetadata))],
    ]);

    // Sharded arrays require a store with `getRange`; zarrita checks for it at
    // open time. We never actually read data in this test, so the range
    // implementation only needs to exist — it's never called.
    const store = {
      async get(key: `/${string}`): Promise<Uint8Array | undefined> {
        return blobs.get(key);
      },
      async getRange(): Promise<Uint8Array | undefined> {
        return undefined;
      },
    };

    const arr = await zarr.open.v3(store, { kind: "array" });
    expect(arr.chunks).toEqual([256, 256]);
  });
});
