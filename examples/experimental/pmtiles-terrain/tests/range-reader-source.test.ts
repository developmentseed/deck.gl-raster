import type {
  ConcurrencyLimiter,
  FileIdentity,
  RangeReader,
  RangeReaderStats,
  ReadOptions,
  ReadRange,
  ReadResult,
} from "@developmentseed/range-reader";
import { EtagMismatch } from "pmtiles";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CountingFetchSource } from "../src/pmtiles/counting-fetch-source.js";
import { RangeReaderSource } from "../src/pmtiles/range-reader-source.js";
import { archiveBytes } from "./pmtiles-fixture.js";

const URL_ = "https://example.com/terrain.pmtiles";

/** Counters as a real reader keeps them, after a little work. */
const STATS: RangeReaderStats = {
  requests: 3,
  cancelled: 0,
  bytesRequested: 1200,
  bytesReceived: 1000,
  bytesOverfetched: 0,
  cacheHits: 2,
  cacheHitBytes: 500,
  attached: 1,
  validatorChanges: 0,
};

/** A reader that answers each read with `respond`, recording its arguments. */
function fakeReader(
  respond: (range: ReadRange) => ReadResult = () => ({
    kind: "bytes",
    bytes: new Uint8Array(10),
  }),
) {
  const read = vi.fn(
    async (
      _file: FileIdentity,
      range: ReadRange,
      _options?: ReadOptions,
    ): Promise<ReadResult> => respond(range),
  );
  const reader = { read, stats: STATS } as unknown as RangeReader;
  return { reader, read };
}

/** The purpose each recorded read asked for. */
function purposes(read: ReturnType<typeof fakeReader>["read"]) {
  return read.mock.calls.map(([, , options]) => options?.purpose);
}

describe("RangeReaderSource", () => {
  it("returns a copy of exactly the requested bytes", async () => {
    const backing = Uint8Array.from({ length: 100 }, (_, i) => i);
    const { reader } = fakeReader(() => ({
      kind: "bytes",
      bytes: backing.subarray(10, 20),
    }));
    const source = new RangeReaderSource({ reader, url: URL_ });
    const { data } = await source.getBytes(10, 10);
    backing[10] = 255;
    expect([...new Uint8Array(data)]).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
  });

  it("reads metadata until it has the header, then data inside the tile section", async () => {
    const header = new Uint8Array(
      archiveBytes({ tileType: 4, tileDataOffset: 1000, tileDataLength: 500 }),
    );
    const { reader, read } = fakeReader((range) =>
      range && "offset" in range && range.offset === 0
        ? { kind: "bytes", bytes: header }
        : { kind: "bytes", bytes: new Uint8Array(10) },
    );
    const source = new RangeReaderSource({ reader, url: URL_ });
    await source.getBytes(1100, 10);
    await source.getBytes(0, 16384);
    await source.getBytes(1100, 10);
    await source.getBytes(200, 10);
    await source.getBytes(1500, 10);
    expect(purposes(read)).toEqual([
      "metadata",
      "metadata",
      "data",
      "metadata",
      "metadata",
    ]);
  });

  it("rejects not-found with the URL", async () => {
    const { reader } = fakeReader(() => ({ kind: "not-found" }));
    const source = new RangeReaderSource({ reader, url: URL_ });
    await expect(source.getBytes(0, 10)).rejects.toThrow(`${URL_} not found`);
  });

  it("throws EtagMismatch once when the validator changes, then accepts the new one", async () => {
    const validators = ["a", "b", "b"];
    const { reader } = fakeReader(() => ({
      kind: "bytes",
      bytes: new Uint8Array(10),
      validator: validators.shift(),
    }));
    const source = new RangeReaderSource({ reader, url: URL_ });
    await expect(source.getBytes(0, 10)).resolves.toMatchObject({ etag: "a" });
    await expect(source.getBytes(0, 10)).rejects.toBeInstanceOf(EtagMismatch);
    await expect(source.getBytes(0, 10)).resolves.toMatchObject({ etag: "b" });
  });

  it("passes the signal and limiter to the reader", async () => {
    const { reader, read } = fakeReader();
    const limiter = {} as ConcurrencyLimiter;
    const signal = new AbortController().signal;
    const source = new RangeReaderSource({ reader, url: URL_, limiter });
    await source.getBytes(20, 10, signal);
    const [file, range, options] = read.mock.calls[0]!;
    expect(file.url.href).toBe(URL_);
    expect(range).toEqual({ offset: 20, length: 10 });
    expect(options).toMatchObject({ signal, limiter });
  });

  it("reports the reader's requests and bytes, and joined or cached reads as shared", () => {
    const source = new RangeReaderSource({
      reader: fakeReader().reader,
      url: URL_,
    });
    expect(source.readStats()).toEqual({
      requests: 3,
      bytesReceived: 1000,
      sharedReads: 3,
    });
  });
});

describe("CountingFetchSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts every request and the bytes received", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(10), {
            status: 206,
            headers: { "Content-Length": "10" },
          }),
      ),
    );
    const source = new CountingFetchSource({ url: URL_ });
    await source.getBytes(0, 10);
    await source.getBytes(10, 10);
    expect(source.readStats()).toEqual({
      requests: 2,
      bytesReceived: 20,
      sharedReads: 0,
    });
  });
});
