import { RangeReader } from "@developmentseed/range-reader";

/**
 * The {@link RangeReader} every COG source and layer on the page reads
 * through when given none: one byte cache and one batching window for all.
 */
export const DEFAULT_RANGE_READER = new RangeReader();
