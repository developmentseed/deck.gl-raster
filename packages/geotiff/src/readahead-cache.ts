/**
 * Contiguous-from-zero buffer cache.
 *
 * Stores a sequence of buffers logically concatenated from byte offset 0.
 * Used by {@link SourceReadaheadCache} to retain previously fetched ranges.
 *
 * @internal
 */
export class SequentialBlockCache {
  private readonly buffers: Uint8Array[] = [];

  /** Total cached length in bytes (sum of buffer lengths). */
  len = 0;

  /** Append a buffer to the end of the cache. */
  appendBuffer(buffer: ArrayBuffer): void {
    const view = new Uint8Array(buffer);
    this.len += view.byteLength;
    this.buffers.push(view);
  }

  /** True iff the byte range `[start, end)` is fully cached. */
  contains(start: number, end: number): boolean {
    return end <= this.len;
  }

  /**
   * Slice the byte range `[start, end)` out of the cached buffers.
   *
   * Returns a zero-copy slice when the range fits in one block; copies
   * into a fresh buffer when it spans multiple blocks. Caller must ensure
   * the range is fully cached (see {@link contains}).
   */
  slice(start: number, end: number): ArrayBuffer {
    const outLen = end - start;
    if (outLen === 0) {
      return new ArrayBuffer(0);
    }

    let remainingStart = start;
    let remainingEnd = end;
    const parts: Uint8Array[] = [];

    for (const block of this.buffers) {
      const blockLen = block.byteLength;
      if (remainingStart >= blockLen) {
        remainingStart -= blockLen;
        remainingEnd -= blockLen;
        continue;
      }
      const sliceStart = remainingStart;
      const sliceEnd = Math.min(remainingEnd, blockLen);
      if (sliceEnd > sliceStart) {
        parts.push(block.subarray(sliceStart, sliceEnd));
      }
      remainingStart = 0;
      if (remainingEnd <= blockLen) {
        break;
      }
      remainingEnd -= blockLen;
    }

    if (parts.length === 1) {
      const part = parts[0]!;
      return part.buffer.slice(
        part.byteOffset,
        part.byteOffset + part.byteLength,
      );
    }

    const out = new Uint8Array(outLen);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out.buffer;
  }
}
