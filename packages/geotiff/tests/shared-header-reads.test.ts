/**
 * A tile's byte range comes from `TileOffsets` and `TileByteCounts`. When
 * those tables don't fit in the bytes read at open, every tile fetch reads
 * its two table entries lazily through the header source. Those reads are
 * widened to 64 KiB blocks and merged, so one request can serve several
 * tiles, and one tile's abort must never fail another tile waiting on the
 * same request (https://github.com/developmentseed/deck.gl-raster/issues/690).
 */

import { PerOriginSemaphore, RangeReader } from "@developmentseed/range-reader";
import { describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import type { Tile } from "../src/tile.js";
import type { FixtureServer } from "./utils/fixture-server.js";
import { fixtureServer } from "./utils/fixture-server.js";
import { makeTiledGeoTIFF } from "./utils/tiled-tiff.js";

const URL_STRING = "https://example.test/large-header.tif";
const CHUNK_SIZE = 64 * 1024;
const FILL = 42;

// 128 x 128 tiles give two 64 KiB tables, so TileByteCounts starts past the
// first block (the one open reads). Tiles (0, 0) and (1, 0) have their byte
// counts at adjacent entries, in the second block.
const FIXTURE = makeTiledGeoTIFF({
  tilesAcross: 128,
  tilesDown: 128,
  fill: FILL,
});
const SECOND_CHUNK = `bytes=${CHUNK_SIZE}-${2 * CHUNK_SIZE - 1}`;

/** Each code path that looks up a tile's byte range before reading it. */
const READ_PATHS: Array<{
  name: string;
  fixture: Uint8Array;
  read(tiff: GeoTIFF, x: number, y: number, signal: AbortSignal): Promise<Tile>;
}> = [
  {
    name: "fetchTile",
    fixture: FIXTURE.bytes,
    read: (tiff, x, y, signal) => tiff.fetchTile(x, y, { signal }),
  },
  {
    name: "fetchTiles",
    fixture: FIXTURE.bytes,
    read: async (tiff, x, y, signal) =>
      (await tiff.fetchTiles([[x, y]], { signal }))[0]!,
  },
  {
    name: "fetchTile, band-separate",
    fixture: makeTiledGeoTIFF({
      tilesAcross: 128,
      tilesDown: 128,
      fill: FILL,
      planarConfiguration: 2,
    }).bytes,
    read: (tiff, x, y, signal) => tiff.fetchTile(x, y, { signal }),
  },
];

/** The value of a tile's first pixel. */
function firstPixel(tile: Tile): number {
  const { array } = tile;
  return array.layout === "pixel-interleaved"
    ? array.data[0]!
    : array.bands[0]![0]!;
}

describe("header reads shared between tiles", () => {
  function open(
    server: FixtureServer,
    limiter?: PerOriginSemaphore,
  ): Promise<GeoTIFF> {
    return GeoTIFF.fromUrl(URL_STRING, {
      reader: new RangeReader({ fetch: server.fetch }),
      concurrencyLimiter: limiter,
    });
  }

  it("reads the byte counts of tiles (0, 0) and (1, 0) with one request after open", async () => {
    // Guards the fixture: if open ever read these entries itself, the tests
    // below would no longer exercise a header read shared between tiles.
    const server = fixtureServer(FIXTURE.bytes);
    const tiff = await open(server);
    const afterOpen = server.requests.length;

    await tiff.fetchTile(0, 0);
    await tiff.fetchTile(1, 0);

    const headerReads = server.requests
      .slice(afterOpen)
      .filter((range) => range === SECOND_CHUNK);
    expect(headerReads).toEqual([SECOND_CHUNK]);
  });

  it("a tile aborted mid-request does not fail a later tile that shares its header read", async () => {
    const server = fixtureServer(FIXTURE.bytes);
    const tiff = await open(server);
    const { arrived, release } = server.holdNext();

    const a = new AbortController();
    const tileA = tiff.fetchTile(0, 0, { signal: a.signal });
    await arrived;
    a.abort(new Error("tile left the viewport"));
    await tileA.catch(() => {});
    release();

    const tileB = await tiff.fetchTile(1, 0, {
      signal: new AbortController().signal,
    });
    expect(firstPixel(tileB)).toBe(FILL);
  });

  it("an aborted tile rejects with its signal's reason without waiting for the shared header read", async () => {
    const server = fixtureServer(FIXTURE.bytes);
    const tiff = await open(server);
    const { arrived, release } = server.holdNext();

    const a = new AbortController();
    const reason = new Error("tile left the viewport");
    const tileA = tiff.fetchTile(0, 0, { signal: a.signal });
    await arrived;
    a.abort(reason);

    // The header read is still held open here.
    await expect(tileA).rejects.toBe(reason);
    release();
  });

  it.each(READ_PATHS)(
    "a tile that joins an in-flight header read survives the abort of the tile that started it ($name)",
    async ({ fixture, read }) => {
      const server = fixtureServer(fixture);
      const tiff = await open(server);
      const { arrived, release } = server.holdNext();

      const a = new AbortController();
      const tileA = read(tiff, 0, 0, a.signal);
      await arrived;
      const tileB = read(tiff, 1, 0, new AbortController().signal);
      a.abort(new Error("tile left the viewport"));
      await tileA.catch(() => {});
      release();

      expect(firstPixel(await tileB)).toBe(FILL);
    },
  );

  it("a tile aborted while its header read waits for the limiter does not fail later tiles", async () => {
    const server = fixtureServer(FIXTURE.bytes);
    const limiter = new PerOriginSemaphore({ maxRequests: 1 });
    const tiff = await open(server, limiter);

    // Take the only slot, so tile A's header read queues behind it.
    const releaseSlot = await limiter.acquire(new URL(URL_STRING));
    const afterOpen = server.requests.length;
    const a = new AbortController();
    const tileA = tiff.fetchTile(0, 0, { signal: a.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.requests.length).toBe(afterOpen);
    a.abort(new Error("tile left the viewport"));
    await tileA.catch(() => {});
    releaseSlot();

    const tileB = await tiff.fetchTile(1, 0, {
      signal: new AbortController().signal,
    });
    expect(firstPixel(tileB)).toBe(FILL);
  });

  it("retries a header read that failed on the next tile that needs it", async () => {
    const server = fixtureServer(FIXTURE.bytes);
    const tiff = await open(server);
    server.failNext(503);

    await expect(tiff.fetchTile(0, 0)).rejects.toThrow();
    const tileB = await tiff.fetchTile(1, 0);

    expect(firstPixel(tileB)).toBe(FILL);
    const headerReads = server.requests.filter((r) => r === SECOND_CHUNK);
    expect(headerReads).toEqual([SECOND_CHUNK, SECOND_CHUNK]);
  });

  it("a tile whose signal is already aborted rejects with its reason and sends no request", async () => {
    const server = fixtureServer(FIXTURE.bytes);
    const tiff = await open(server);
    const afterOpen = server.requests.length;

    const a = new AbortController();
    const reason = new Error("tile left the viewport");
    a.abort(reason);

    await expect(tiff.fetchTile(0, 0, { signal: a.signal })).rejects.toBe(
      reason,
    );
    expect(server.requests.slice(afterOpen)).toEqual([]);
  });
});
