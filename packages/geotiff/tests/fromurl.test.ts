/**
 * Regression test for https://github.com/developmentseed/deck.gl-raster/issues/524
 *
 * In a browser, S3 (and many other hosts) don't list `Content-Range` in
 * `Access-Control-Expose-Headers`, so `@chunkd/source-http` can only read the
 * `Content-Length` of a range response — the length of a single *chunk*, not
 * the file. That value used to be recorded as `source.metadata.size`, after
 * which `@chunkd/middleware`'s chunk layer rejected any later read past it with
 * "SourceError: Request outside of bounds". `GeoTIFF.fromUrl` must guard
 * against that.
 */

import { readFileSync } from "node:fs";
import { SourceHttp } from "@chunkd/source-http";
import { afterEach, describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import { fixturePath } from "./helpers.js";

const FIXTURE = readFileSync(
  fixturePath("uint8_rgb_deflate_block64_cog", "rasterio"),
);

/** Minimal `Response`-like object for the {@link SourceHttp.fetch} stub. */
function makeResponse(
  status: number,
  headers: Record<string, string>,
  body: Uint8Array,
): {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(key: string): string | null };
  body: null;
  arrayBuffer(): Promise<ArrayBuffer>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (key) => headers[key.toLowerCase()] ?? null },
    body: null,
    arrayBuffer: async () =>
      body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer,
  };
}

/**
 * A stand-in for {@link SourceHttp.fetch} that mimics S3 as seen from a
 * browser: range GETs answer with `Content-Length` (the bytes actually
 * returned) but never expose `Content-Range`; HEAD answers with the full file
 * size.
 */
function browserLikeS3Fetch(file: Uint8Array) {
  return async (
    _url: string | URL,
    init?: { method?: string; headers?: Record<string, string> },
  ) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") {
      return makeResponse(
        200,
        { "content-length": String(file.byteLength) },
        new Uint8Array(),
      );
    }
    const range = init?.headers?.range ?? "";
    const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end =
      match?.[2] != null
        ? Math.min(Number(match[2]), file.byteLength - 1)
        : file.byteLength - 1;
    const body = file.subarray(start, end + 1);
    // Deliberately no `content-range` header — that is what triggers the bug.
    return makeResponse(
      206,
      { "content-length": String(body.byteLength) },
      body,
    );
  };
}

describe("GeoTIFF.fromUrl", () => {
  const realFetch = SourceHttp.fetch;
  afterEach(() => {
    SourceHttp.fetch = realFetch;
  });

  it("reads ranges past the first chunk when the server hides Content-Range (issue #524)", async () => {
    SourceHttp.fetch = browserLikeS3Fetch(FIXTURE) as typeof SourceHttp.fetch;

    // A small initial prefetch forces multiple underlying fetches; without the
    // fix the first response's `Content-Length` gets mistaken for the file
    // size, and subsequent reads past it would be rejected as out-of-bounds.
    const tiff = await GeoTIFF.fromUrl("https://example.test/cog.tif", {
      prefetch: 1024,
    });

    // A header-source read near the end of the file must not be rejected
    // (this is the kind of read that `TiffImage.getTileSize` performs for
    // GDAL "tile leader" bytes).
    const tail = await tiff.tiff.source.fetch(FIXTURE.byteLength - 16, 16);
    expect(tail.byteLength).toBe(16);
  });
});
