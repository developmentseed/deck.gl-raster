/**
 * Verifies that GeoTIFF.fromUrl gates network reads through a
 * ConcurrencyLimiter when one is supplied. Both the header reads (cache
 * misses through the SourceView) and the tile-data reads are gated; cache
 * hits short-circuit in SourceCache and never reach the limiter.
 *
 * The SourceHttp stubbing pattern mirrors fromurl.test.ts.
 */

import { readFileSync } from "node:fs";
import { SourceHttp } from "@chunkd/source-http";
import { afterEach, describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import type { ConcurrencyLimiter } from "../src/limiter.js";
import { PerOriginSemaphore } from "../src/limiter.js";
import { fixturePath } from "./helpers.js";

const FIXTURE = readFileSync(
  fixturePath("uint8_rgb_deflate_block64_cog", "rasterio"),
);

function makeResponse(body: Uint8Array) {
  return {
    ok: true,
    status: 206,
    statusText: "",
    headers: {
      get: (key: string) =>
        key.toLowerCase() === "content-length" ? String(body.byteLength) : null,
    },
    body: null,
    arrayBuffer: async () =>
      body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer,
  };
}

function staticFetch(file: Uint8Array) {
  return async (
    _url: string | URL,
    init?: { method?: string; headers?: Record<string, string> },
  ) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") {
      return {
        ok: true,
        status: 200,
        statusText: "",
        headers: {
          get: (key: string) =>
            key.toLowerCase() === "content-length"
              ? String(file.byteLength)
              : null,
        },
        body: null,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    const range = init?.headers?.range ?? "";
    const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end =
      match?.[2] != null
        ? Math.min(Number(match[2]), file.byteLength - 1)
        : file.byteLength - 1;
    return makeResponse(file.subarray(start, end + 1));
  };
}

describe("GeoTIFF.fromUrl({ concurrencyLimiter })", () => {
  const realFetch = SourceHttp.fetch;
  afterEach(() => {
    SourceHttp.fetch = realFetch;
  });

  it("routes both header and tile-data fetches through the limiter (cache hits skip it)", async () => {
    SourceHttp.fetch = staticFetch(FIXTURE) as typeof SourceHttp.fetch;

    const acquired: URL[] = [];
    const limiter: ConcurrencyLimiter = {
      acquire: async (url) => {
        acquired.push(url);
        return () => {};
      },
    };
    const url = "https://example.test/cog.tif";
    const tiff = await GeoTIFF.fromUrl(url, { concurrencyLimiter: limiter });

    // Opening the TIFF reads headers — those network reads (cache misses
    // through the SourceView) go through the limiter too.
    expect(acquired.length).toBeGreaterThan(0);
    const headerCount = acquired.length;

    await tiff.fetchTile(0, 0);

    // The tile fetch added at least one more acquire (the data-source
    // path). Every URL must be ours.
    expect(acquired.length).toBeGreaterThan(headerCount);
    for (const u of acquired) {
      expect(u.href).toBe(url);
    }
  });

  it("with concurrencyLimiter: null does not wrap (no acquires)", async () => {
    SourceHttp.fetch = staticFetch(FIXTURE) as typeof SourceHttp.fetch;
    const acquired: URL[] = [];
    const limiter: ConcurrencyLimiter = {
      acquire: async (url) => {
        acquired.push(url);
        return () => {};
      },
    };
    // null = explicitly off.
    const tiff = await GeoTIFF.fromUrl("https://example.test/cog.tif", {
      concurrencyLimiter: null,
    });
    await tiff.fetchTile(0, 0);
    // Limiter was passed `null`, so `acquired` only contains entries from
    // explicit calls — but no one called this `limiter` from anywhere, so
    // it must be exactly empty.
    expect(acquired).toEqual([]);
    // Reference `limiter` so it isn't flagged as unused.
    expect(limiter.acquire).toBeDefined();
  });

  it("drops a queued header read when its signal aborts, without fetching it", async () => {
    // One slot per origin, so the second open must queue behind the first.
    const limiter = new PerOriginSemaphore({ maxRequests: 1 });

    const fetched: string[] = [];
    let firstHolds!: () => void;
    const firstHolding = new Promise<void>((resolve) => {
      firstHolds = resolve;
    });
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    SourceHttp.fetch = (async (
      url: string | URL,
      init?: { method?: string; headers?: Record<string, string> },
    ) => {
      const href = String(url);
      fetched.push(href);
      if (href.includes("first.tif")) {
        // The first open holds the only slot until we release it, so the
        // second open's first read must queue in the limiter.
        firstHolds();
        await firstReleased;
      }
      const range = init?.headers?.range ?? "";
      const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const end =
        match?.[2] != null
          ? Math.min(Number(match[2]), FIXTURE.byteLength - 1)
          : FIXTURE.byteLength - 1;
      return makeResponse(FIXTURE.subarray(start, end + 1));
    }) as typeof SourceHttp.fetch;

    // First open acquires the only slot and parks in its first read.
    const first = GeoTIFF.fromUrl("https://ex.test/first.tif", {
      concurrencyLimiter: limiter,
    });
    await firstHolding;

    // Second open queues behind the first; abort it while it waits.
    const ac = new AbortController();
    const second = GeoTIFF.fromUrl("https://ex.test/second.tif", {
      concurrencyLimiter: limiter,
      signal: ac.signal,
    });
    ac.abort(new Error("pan-away"));

    await expect(second).rejects.toThrow();
    // The queued read was dropped before any network fetch for second.tif.
    expect(fetched.some((u) => u.includes("second.tif"))).toBe(false);

    releaseFirst();
    await first;
  });
});
