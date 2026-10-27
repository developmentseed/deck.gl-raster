/**
 * `GeoTIFF.fromUrl({ concurrencyLimiter })` gates every request of the file,
 * header and tile data alike, through the limiter: one slot per merged
 * request, none for a cache hit, and a read dropped while it waits for a
 * slot never reaches the network.
 */

import { readFileSync } from "node:fs";
import type { ConcurrencyLimiter } from "@developmentseed/range-reader";
import { PerOriginSemaphore, RangeReader } from "@developmentseed/range-reader";
import { describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import { fixturePath } from "./helpers.js";
import { fixtureServer } from "./utils/fixture-server.js";

const FIXTURE = new Uint8Array(
  readFileSync(fixturePath("uint8_rgb_deflate_block64_cog", "rasterio")),
);

describe("GeoTIFF.fromUrl({ concurrencyLimiter })", () => {
  it("routes both header and tile-data requests through the limiter (cache hits skip it)", async () => {
    const server = fixtureServer(FIXTURE);
    const acquired: URL[] = [];
    const limiter: ConcurrencyLimiter = {
      acquire: async (url) => {
        acquired.push(url);
        return () => {};
      },
    };
    const url = "https://example.test/cog.tif";
    const tiff = await GeoTIFF.fromUrl(url, {
      // Small header blocks, so the tile read below is not served from the
      // first block the open fetched.
      reader: new RangeReader({
        fetch: server.fetch,
        minHeaderReadBytes: 1024,
      }),
      concurrencyLimiter: limiter,
    });

    // Opening the TIFF reads its header through the limiter.
    expect(acquired.length).toBeGreaterThan(0);
    const headerCount = acquired.length;

    await tiff.fetchTile(0, 0);

    // The tile fetch added at least one more acquire (the data path). Every
    // URL must be ours, and the limiter saw exactly the requests made.
    expect(acquired.length).toBeGreaterThan(headerCount);
    expect(acquired.length).toBe(server.requests.length);
    for (const u of acquired) {
      expect(u.href).toBe(url);
    }
  });

  it("with concurrencyLimiter: null does not gate (no acquires)", async () => {
    const server = fixtureServer(FIXTURE);
    const tiff = await GeoTIFF.fromUrl("https://example.test/cog.tif", {
      reader: new RangeReader({ fetch: server.fetch }),
      concurrencyLimiter: null,
    });
    await tiff.fetchTile(0, 0);
    expect(server.requests.length).toBeGreaterThan(0);
  });

  it("drops a queued header read when its signal aborts, without fetching it", async () => {
    // One slot per origin, so the second open must queue behind the first.
    const limiter = new PerOriginSemaphore({ maxRequests: 1 });
    const server = fixtureServer(FIXTURE);

    const fetched: string[] = [];
    let firstHolds!: () => void;
    const firstHolding = new Promise<void>((resolve) => {
      firstHolds = resolve;
    });
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const routingFetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const href = String(input);
      fetched.push(href);
      if (href.includes("first.tif")) {
        // The first open holds the only slot until we release it, so the
        // second open's first read must queue in the limiter.
        firstHolds();
        await firstReleased;
      }
      return server.fetch(input, init);
    }) as typeof fetch;
    const reader = new RangeReader({ fetch: routingFetch });

    // First open acquires the only slot and parks in its first read.
    const first = GeoTIFF.fromUrl("https://ex.test/first.tif", {
      reader,
      concurrencyLimiter: limiter,
    });
    await firstHolding;

    // Second open queues behind the first; abort it while it waits.
    const ac = new AbortController();
    const second = GeoTIFF.fromUrl("https://ex.test/second.tif", {
      reader,
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
