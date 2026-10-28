import type { Source } from "pmtiles";

/** What a byte source has fetched so far, for the stats readout. */
export type ReadStats = {
  /** HTTP requests sent. */
  requests: number;
  /** Bytes received over the network. */
  bytesReceived: number;
  /** Reads answered without a request of their own: joined or cached. */
  sharedReads: number;
};

/** A `pmtiles` byte source that counts what it fetches. */
export interface CountedSource extends Source {
  /** Totals since the source was made (or, for a shared reader, the page loaded). */
  readStats(): ReadStats;
}
