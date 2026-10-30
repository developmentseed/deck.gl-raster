import type { RangeResponse } from "pmtiles";
import { FetchSource } from "pmtiles";
import type { CountedSource, ReadStats } from "./read-stats.js";

/**
 * `pmtiles`' own `FetchSource`, one HTTP request per read, counting what it
 * fetches. The example's "Merge requests" switch swaps it in for comparison.
 */
export class CountingFetchSource implements CountedSource {
  readonly #source: FetchSource;
  #requests = 0;
  #bytesReceived = 0;

  constructor(options: { url: string }) {
    this.#source = new FetchSource(options.url);
  }

  /** The archive's URL. */
  getKey(): string {
    return this.#source.getKey();
  }

  /** Read `length` bytes at `offset` with a request of their own. */
  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    this.#requests += 1;
    const response = await this.#source.getBytes(offset, length, signal, etag);
    this.#bytesReceived += response.data.byteLength;
    return response;
  }

  /** Requests and bytes so far. Nothing is shared without a reader. */
  readStats(): ReadStats {
    return {
      requests: this.#requests,
      bytesReceived: this.#bytesReceived,
      sharedReads: 0,
    };
  }
}
