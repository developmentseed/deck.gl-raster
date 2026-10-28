/**
 * Regression tests for
 * https://github.com/developmentseed/deck.gl-raster/issues/690
 *
 * When a COG's TileOffsets and TileByteCounts tables run past the bytes read
 * at open, every tile fetch reads its two table entries lazily through the
 * header source. That source caches each chunk it reads, so all tiles with
 * entries in one chunk share one request. One tile's abort, or one failed
 * request, must not fail the other tiles that share it.
 *
 * The `SourceHttp.fetch` stubbing mirrors fromurl.test.ts.
 */

import { SourceHttp } from "@chunkd/source-http";
import { PerOriginSemaphore } from "@developmentseed/range-reader";
import { afterEach, describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import type { Tile } from "../src/tile.js";
import { makeTiledGeoTIFF } from "./utils/tiled-tiff.js";

const URL_STRING = "https://example.test/large-header.tif";
const CHUNK_SIZE = 64 * 1024;
const FILL = 42;

// 128 × 128 tiles give two 64 KiB tables, so TileByteCounts starts past the
// first chunk (the one open reads). Tiles (0, 0) and (1, 0) have their byte
// counts at adjacent entries, in the second chunk.
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

/** Minimal `Response` stand-in with the fields `SourceHttp.fetch` reads. */
function respond(status: number, body: Uint8Array) {
  return {
    ok: status >= 200 && status < 300,
    status,
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

/**
 * Resolve when `released` does, or reject with the signal's reason if
 * `signal` aborts first, as `fetch` does for a request in flight.
 */
function waitUnlessAborted(
  released: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
    released.then(resolve);
  });
}

/**
 * A stand-in for `SourceHttp.fetch` that serves `file` and records the Range
 * header of each request it receives. Like `fetch`, a request whose signal is
 * already aborted is never sent, and a request in flight rejects with the
 * signal's reason when it aborts. The next request can be held open until
 * released, or answered with HTTP 503.
 */
function fakeServer(file: Uint8Array) {
  const requests: string[] = [];
  let hold: { arrived: () => void; released: Promise<void> } | null = null;
  let failNextRequest = false;

  const fetch = async (
    _url: string | URL,
    init?: { headers?: Record<string, string>; signal?: AbortSignal },
  ) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      throw signal.reason;
    }
    const range = init?.headers?.range ?? "";
    requests.push(range);
    if (failNextRequest) {
      failNextRequest = false;
      return respond(503, new Uint8Array());
    }
    if (hold) {
      const { arrived, released } = hold;
      hold = null;
      arrived();
      await waitUnlessAborted(released, signal);
    }
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!.map(Number);
    return respond(
      206,
      file.subarray(start, Math.min(end!, file.length - 1) + 1),
    );
  };

  return {
    fetch: fetch as unknown as typeof SourceHttp.fetch,
    requests,
    /** Hold the next request open until `release` is called. */
    holdNext() {
      let arrived!: () => void;
      const arrival = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      hold = { arrived, released };
      return { arrival, release };
    },
    /** Answer the next request with HTTP 503. */
    failNext() {
      failNextRequest = true;
    },
  };
}

/** The value of a tile's first pixel. */
function firstPixel(tile: Tile): number {
  const { array } = tile;
  return array.layout === "pixel-interleaved"
    ? array.data[0]!
    : array.bands[0]![0]!;
}

describe("header reads shared between tiles", () => {
  const realFetch = SourceHttp.fetch;
  afterEach(() => {
    SourceHttp.fetch = realFetch;
  });

  function open(
    server: ReturnType<typeof fakeServer>,
    limiter?: PerOriginSemaphore,
  ): Promise<GeoTIFF> {
    SourceHttp.fetch = server.fetch;
    return GeoTIFF.fromUrl(URL_STRING, {
      chunkSize: CHUNK_SIZE,
      concurrencyLimiter: limiter,
    });
  }

  it("reads the byte counts of tiles (0, 0) and (1, 0) with one request after open", async () => {
    // Guards the fixture: if open ever read these entries itself, the tests
    // below would no longer exercise a header read shared between tiles.
    const server = fakeServer(FIXTURE.bytes);
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
    const server = fakeServer(FIXTURE.bytes);
    const tiff = await open(server);
    const { arrival, release } = server.holdNext();

    const a = new AbortController();
    const tileA = tiff.fetchTile(0, 0, { signal: a.signal });
    await arrival;
    a.abort(new Error("tile left the viewport"));
    await tileA.catch(() => {});
    release();

    const tileB = await tiff.fetchTile(1, 0, {
      signal: new AbortController().signal,
    });
    expect(firstPixel(tileB)).toBe(FILL);
  });

  it("an aborted tile rejects with its signal's reason without waiting for the shared header read", async () => {
    const server = fakeServer(FIXTURE.bytes);
    const tiff = await open(server);
    const { arrival, release } = server.holdNext();

    const a = new AbortController();
    const reason = new Error("tile left the viewport");
    const tileA = tiff.fetchTile(0, 0, { signal: a.signal });
    await arrival;
    a.abort(reason);

    // The header read is still held open here.
    await expect(tileA).rejects.toBe(reason);
    release();
  });

  it.each(READ_PATHS)(
    "a tile that joins an in-flight header read survives the abort of the tile that started it ($name)",
    async ({ fixture, read }) => {
      const server = fakeServer(fixture);
      const tiff = await open(server);
      const { arrival, release } = server.holdNext();

      const a = new AbortController();
      const tileA = read(tiff, 0, 0, a.signal);
      await arrival;
      const tileB = read(tiff, 1, 0, new AbortController().signal);
      a.abort(new Error("tile left the viewport"));
      await tileA.catch(() => {});
      release();

      expect(firstPixel(await tileB)).toBe(FILL);
    },
  );

  it("a tile aborted while its header read waits for the limiter does not fail later tiles", async () => {
    const server = fakeServer(FIXTURE.bytes);
    const limiter = new PerOriginSemaphore({ maxRequests: 1 });
    const tiff = await open(server, limiter);

    // Take the only slot, so tile A's header read queues behind it.
    const releaseSlot = await limiter.acquire(new URL(URL_STRING));
    const afterOpen = server.requests.length;
    const a = new AbortController();
    const tileA = tiff.fetchTile(0, 0, { signal: a.signal });
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
    const server = fakeServer(FIXTURE.bytes);
    const tiff = await open(server);
    server.failNext();

    await expect(tiff.fetchTile(0, 0)).rejects.toThrow();
    const tileB = await tiff.fetchTile(1, 0);

    expect(firstPixel(tileB)).toBe(FILL);
    const headerReads = server.requests.filter((r) => r === SECOND_CHUNK);
    expect(headerReads).toEqual([SECOND_CHUNK, SECOND_CHUNK]);
  });

  it("a tile whose signal is already aborted rejects with its reason and sends no request", async () => {
    const server = fakeServer(FIXTURE.bytes);
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
