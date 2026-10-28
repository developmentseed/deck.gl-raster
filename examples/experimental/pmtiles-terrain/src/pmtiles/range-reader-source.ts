import type {
  ConcurrencyLimiter,
  FileIdentity,
  RangeReader,
} from "@developmentseed/range-reader";
import { fileIdentity } from "@developmentseed/range-reader";
import type { RangeResponse } from "pmtiles";
import { bytesToHeader, EtagMismatch } from "pmtiles";
import type { CountedSource, ReadStats } from "./read-stats.js";

/** Length of a PMTiles v3 header. */
const HEADER_BYTES = 127;

/** The archive's first two bytes, "PM", as a little-endian `uint16`. */
const MAGIC = 19792;

/** Options for {@link RangeReaderSource}. */
export interface RangeReaderSourceOptions {
  /** The reader every read of this archive goes through. */
  reader: RangeReader;
  /** The archive's URL. */
  url: string | URL;
  /** Caps concurrent requests; one slot per merged request. */
  limiter?: ConcurrencyLimiter | null;
  /** Headers, credentials and mode sent with every request. */
  init?: RequestInit;
}

/**
 * A `pmtiles` byte source whose reads go through a {@link RangeReader}, so
 * the reads issued in one task (a view's tiles, once their directory has
 * arrived) merge into a few streamed requests, and every byte lands in the
 * reader's cache.
 *
 * Reads inside the archive's tile data section have purpose `data`; every
 * other read (header, directories, JSON metadata) has purpose `metadata`. The
 * section is learned from the header, the first read at offset 0.
 *
 * A replaced archive is caught the way `pmtiles`' own `FetchSource` catches
 * it. Each response's validator (`ETag`, or `Last-Modified` when there is
 * none) is returned as the read's `etag`. `pmtiles` keeps the header's, and
 * passes it with every later directory and tile read. A read whose validator
 * differs fails with `pmtiles`' `EtagMismatch`, on which `pmtiles` drops its
 * cached header and directories and retries. The header read itself carries
 * no `etag`, so it always succeeds and adopts the new version.
 */
export class RangeReaderSource implements CountedSource {
  /** The archive's URL. */
  readonly url: URL;

  readonly #reader: RangeReader;
  readonly #file: FileIdentity;
  readonly #limiter: ConcurrencyLimiter | null | undefined;
  /** The tile data section, once the header has been read. */
  #tileData: { offset: number; length: number } | undefined;

  constructor(options: RangeReaderSourceOptions) {
    this.url = new URL(options.url);
    this.#reader = options.reader;
    this.#file = fileIdentity(this.url, options.init);
    this.#limiter = options.limiter;
  }

  /** The archive's URL, which `pmtiles` uses as its cache key. */
  getKey(): string {
    return this.url.href;
  }

  /**
   * Read `length` bytes at `offset`.
   *
   * @param etag - The header's validator, which `pmtiles` passes with every
   *   read after the header. A response with a different one means the
   *   archive was replaced.
   * @returns A copy of the bytes. The reader's bytes are views into a merged
   *   response or a cached span, which must not escape: a consumer could
   *   transfer the buffer to a worker and detach the cache's bytes.
   * @throws `EtagMismatch` if the archive was replaced.
   */
  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const result = await this.#reader.read(
      this.#file,
      { offset, length },
      { purpose: this.#purposeOf(offset), signal, limiter: this.#limiter },
    );
    if (result.kind === "not-found") {
      throw new Error(`${this.url.href} not found`);
    }
    const { bytes, validator } = result;
    if (etag !== undefined && validator !== undefined && validator !== etag) {
      throw new EtagMismatch(
        `${this.url.href} changed: its header was read at ${etag}, this read got ${validator}`,
      );
    }
    if (offset === 0) {
      this.#learnTileData(bytes);
    }
    return { data: bytes.slice().buffer, etag: validator };
  }

  /** Totals of this source's reader. */
  readStats(): ReadStats {
    const { requests, bytesReceived, attached, cacheHits } = this.#reader.stats;
    return { requests, bytesReceived, sharedReads: attached + cacheHits };
  }

  /** `data` inside the tile data section, `metadata` everywhere else. */
  #purposeOf(offset: number): "data" | "metadata" {
    const section = this.#tileData;
    return section &&
      offset >= section.offset &&
      offset < section.offset + section.length
      ? "data"
      : "metadata";
  }

  /** Note where tile data lives, if `bytes` starts with a PMTiles header. */
  #learnTileData(bytes: Uint8Array): void {
    if (bytes.length < HEADER_BYTES) {
      return;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_BYTES);
    if (view.getUint16(0, true) !== MAGIC) {
      return;
    }
    const header = bytesToHeader(bytes.slice(0, HEADER_BYTES).buffer);
    this.#tileData = {
      offset: header.tileDataOffset,
      // Optional in pmtiles' types; tile data runs to the end of the file.
      length: header.tileDataLength ?? Number.POSITIVE_INFINITY,
    };
  }
}
