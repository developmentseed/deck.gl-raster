/**
 * Regression test for https://github.com/developmentseed/deck.gl-raster/issues/524
 *
 * In a browser, S3 (and many other hosts) don't list `Content-Range` in
 * `Access-Control-Expose-Headers`, so a range response reveals only the
 * `Content-Length` of the range, not the file size. That value once got
 * recorded as the source's size, after which every later read past it was
 * rejected as out of bounds. `GeoTIFF.fromUrl` must never let a range
 * response set a size.
 */

import { readFileSync } from "node:fs";
import { RangeReader } from "@developmentseed/range-reader";
import { describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import { fixturePath } from "./helpers.js";
import { fixtureServer } from "./utils/fixture-server.js";

const FIXTURE = new Uint8Array(
  readFileSync(fixturePath("uint8_rgb_deflate_block64_cog", "rasterio")),
);

describe("GeoTIFF.fromUrl", () => {
  it("reads ranges past the first block when the server hides Content-Range (issue #524)", async () => {
    const server = fixtureServer(FIXTURE);
    // A small block makes the file span many blocks; without the guard the
    // first block's `Content-Length` would be mistaken for the file size.
    const reader = new RangeReader({
      fetch: server.fetch,
      minMetadataReadBytes: 1024,
    });
    const tiff = await GeoTIFF.fromUrl("https://example.test/cog.tif", {
      reader,
    });

    // A header-source read near the end of the file must not be rejected.
    const tail = await tiff.tiff.source.fetch(FIXTURE.byteLength - 16, 16);
    expect(tail.byteLength).toBe(16);
    expect(new Uint8Array(tail)).toEqual(FIXTURE.subarray(-16));
  });

  it("sends requestInit headers on every request", async () => {
    const server = fixtureServer(FIXTURE);
    // Small header blocks, so the open takes several requests and the tile
    // read is not a cache hit from the first block.
    const reader = new RangeReader({
      fetch: server.fetch,
      minMetadataReadBytes: 1024,
    });
    const tiff = await GeoTIFF.fromUrl("https://example.test/cog.tif", {
      reader,
      requestInit: { headers: { authorization: "Bearer t" } },
    });
    await tiff.fetchTile(0, 0);

    expect(server.requests.length).toBeGreaterThan(1);
    for (const headers of server.headers) {
      expect(headers.get("authorization")).toBe("Bearer t");
    }
  });

  it("opens without a reader of its own being supplied", async () => {
    const server = fixtureServer(FIXTURE);
    const realFetch = globalThis.fetch;
    globalThis.fetch = server.fetch;
    try {
      const tiff = await GeoTIFF.fromUrl("https://example.test/cog.tif");
      expect(tiff.tiff.images.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(server.requests.length).toBeGreaterThan(0);
  });
});
