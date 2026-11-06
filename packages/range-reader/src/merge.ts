import type { ByteRange } from "./types.js";

/** How far apart, and how large, reads may be and still share one request. */
export interface MergeOptions {
  /**
   * Largest gap in bytes between two reads that share a request. `"median"`
   * uses the batch's median read length.
   */
  maxGap: number | "median";
  /** Largest number of bytes in one merged range that no read covers. */
  maxOverfetchBytes: number;
  /**
   * Largest merged range, in bytes. A single read longer than this is sent
   * alone; a read that overlaps the current range always joins it, since
   * fetching the overlap twice would cost more than the longer request.
   */
  maxRequestBytes: number;
}

/** One request's byte range, and the reads it serves. */
export interface MergedRange extends ByteRange {
  /** Indexes into the input array of the reads this range covers, in offset order. */
  members: number[];
  /** Bytes of this range no member covers: the sum of the gaps merged across. */
  overfetch: number;
}

/**
 * Group reads into as few contiguous ranges as the options allow.
 *
 * Reads are taken in offset order, longest first among equals, so a range
 * starts with its widest read. A read that starts before the current range's
 * end joins it unconditionally: it is contained or overlapping, and fetching
 * the overlap twice would cost more than the longer request. A read that
 * starts at or past the end, adjacent reads included (the tiles of a COG
 * row are contiguous), joins only if the gap is at most `maxGap`, the merged
 * range stays within `maxRequestBytes`, and the range's over-fetch stays
 * within `maxOverfetchBytes`.
 */
export function mergeReads(
  reads: readonly ByteRange[],
  options: MergeOptions,
): MergedRange[] {
  const maxGap =
    options.maxGap === "median" ? medianLength(reads) : options.maxGap;
  const order = reads
    .map((_, i) => i)
    .sort(
      (a, b) =>
        reads[a]!.offset - reads[b]!.offset ||
        reads[b]!.length - reads[a]!.length,
    );

  const ranges: MergedRange[] = [];
  let current: MergedRange | undefined;
  for (const i of order) {
    const { offset, length } = reads[i]!;
    const end = offset + length;
    if (current !== undefined) {
      const currentEnd = current.offset + current.length;
      if (offset < currentEnd) {
        current.length = Math.max(currentEnd, end) - current.offset;
        current.members.push(i);
        continue;
      }
      const gap = offset - currentEnd;
      const mergedLength = end - current.offset;
      const overfetch = current.overfetch + gap;
      if (
        gap <= maxGap &&
        mergedLength <= options.maxRequestBytes &&
        overfetch <= options.maxOverfetchBytes
      ) {
        current.length = mergedLength;
        current.overfetch = overfetch;
        current.members.push(i);
        continue;
      }
    }
    current = { offset, length, members: [i], overfetch: 0 };
    ranges.push(current);
  }
  return ranges;
}

/**
 * Widen a read shorter than `blockSize` to the aligned block span that
 * contains it, so small metadata reads (cogeotiff reads one offset-table entry
 * at a time) become block reads that neighbouring entries hit in the cache.
 * A read of `blockSize` or more is returned as is.
 */
export function widenRead(range: ByteRange, blockSize: number): ByteRange {
  if (range.length >= blockSize) {
    return range;
  }
  const start = Math.floor(range.offset / blockSize) * blockSize;
  const end = Math.ceil((range.offset + range.length) / blockSize) * blockSize;
  return { offset: start, length: end - start };
}

/** The median read length, taking the lower middle for an even count. */
function medianLength(reads: readonly ByteRange[]): number {
  const lengths = reads.map((r) => r.length).sort((a, b) => a - b);
  return lengths[Math.floor((lengths.length - 1) / 2)] ?? 0;
}
