import { RangeReader } from "@developmentseed/range-reader";

/**
 * Shared default {@link RangeReader} for {@link COGSource.open},
 * {@link MultiCOGSource.open} and {@link MosaicLayer}, when they aren't given
 * a `reader`. A single module-level reader, so every COG layer on a page
 * shares one byte cache (a tile fetched for one layer is served from memory
 * for another) and one batching window (the reads of every layer issued in
 * one task are merged per file). Pass a reader of your own to tune its
 * budgets, gap and over-fetch limits, or to isolate a layer.
 */
export const DEFAULT_RANGE_READER = new RangeReader();
