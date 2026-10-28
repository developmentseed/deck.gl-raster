import type { Source as ChunkdSource, SourceMetadata } from "@chunkd/source";
import type {
  ConcurrencyLimiter,
  FileIdentity,
  Priority,
  Purpose,
  RangeReader,
  ReadRange,
} from "@developmentseed/range-reader";
import { fileIdentity } from "@developmentseed/range-reader";

/** Options for {@link ByteSource}. */
export interface ByteSourceOptions {
  /** The reader every read of this file goes through. */
  reader: RangeReader;
  url: URL;
  /** Which of the reader's budgets this source's reads belong to: `metadata` for the header, `data` for tiles. */
  purpose: Purpose;
  /** Headers, credentials and mode sent with every request for this file. */
  init?: RequestInit;
  /** Caps concurrent requests; one slot per merged request. */
  limiter?: ConcurrencyLimiter | null;
  /** Re-evaluated by the limiter on every slot-open; lower is served sooner. */
  getPriority?: () => Priority;
}

/**
 * A chunkd `Source` whose reads go through a {@link RangeReader}, so
 * cogeotiff's header reads and our tile reads are merged, streamed and
 * cached by it. "Source" here is chunkd's byte-range interface, the thing
 * `GeoTIFF.open` reads bytes through, not a dataset source like `COGSource`:
 * one of these is a cheap per-file, per-purpose handle on a shared reader. `GeoTIFF.fromUrl` builds two over one reader: one for the
 * header (purpose `metadata`) and one for tile data (purpose `data`).
 *
 * `metadata.size` is seeded infinite and never updated: cogeotiff clamps a
 * read to the size it knows, and in a browser a range response often reveals
 * only the range's own `Content-Length`, which once got recorded as the file
 * size and rejected every later read past it
 * (https://github.com/developmentseed/deck.gl-raster/issues/524). The reader
 * handles the end of the object on its own.
 *
 * The first result's validator (`ETag`, or `Last-Modified`) is remembered,
 * and a later result with a different one fails with an `ETag conflict`
 * error, as chunkd's `SourceHttp` did: the object was replaced underneath
 * a `GeoTIFF` whose parsed layout no longer applies, so it must be opened
 * again. The reader itself drops its cached bytes of the old version.
 */
export class ByteSource implements ChunkdSource {
  readonly type = "range-reader";
  readonly url: URL;
  metadata: SourceMetadata = { size: Number.POSITIVE_INFINITY };

  private readonly reader: RangeReader;
  private readonly file: FileIdentity;
  private readonly purpose: Purpose;
  private readonly limiter: ConcurrencyLimiter | null | undefined;
  private readonly getPriority: (() => Priority) | undefined;
  /** The validator of the first result; a different one later means a replaced object. */
  private validator: string | undefined;

  constructor(options: ByteSourceOptions) {
    this.reader = options.reader;
    this.url = options.url;
    this.file = fileIdentity(options.url, options.init);
    this.purpose = options.purpose;
    this.limiter = options.limiter;
    this.getPriority = options.getPriority;
  }

  /** Not supported: the reader never needs the object's size up front. */
  head(): Promise<SourceMetadata> {
    return Promise.reject(new Error("head() is not supported"));
  }

  /**
   * Read `length` bytes at `offset`, as chunkd defines it: a negative offset
   * reads that many bytes from the end, and offset `0` with no length reads
   * the whole object. The bytes are copied into a fresh `ArrayBuffer`, which
   * cogeotiff reads from offset zero.
   */
  async fetch(
    offset: number,
    length?: number,
    options?: { signal?: AbortSignal },
  ): Promise<ArrayBuffer> {
    let range: ReadRange | undefined;
    if (offset < 0) {
      range = { suffixLength: -offset };
    } else if (length !== undefined) {
      range = { offset, length };
    } else if (offset === 0) {
      range = undefined;
    } else {
      throw new Error("open-ended reads are not supported");
    }
    const result = await this.reader.read(this.file, range, {
      purpose: this.purpose,
      signal: options?.signal,
      limiter: this.limiter,
      getPriority: this.getPriority,
    });
    if (result.kind === "not-found") {
      throw new Error(`${this.url.href} not found`);
    }
    if (result.validator !== undefined) {
      if (this.validator === undefined) {
        this.validator = result.validator;
      } else if (this.validator !== result.validator) {
        throw new Error(
          `ETag conflict for ${this.url.href}: it was ${this.validator} when opened, now ${result.validator}`,
        );
      }
    }
    return result.bytes.slice().buffer as ArrayBuffer;
  }
}
