/** Options for {@link archiveBytes}. */
export interface ArchiveBytesOptions {
  /** PMTiles tile type: 1 MVT, 2 PNG, 3 JPEG, 4 WebP. */
  tileType: number;
  /** Where the tile data section starts. */
  tileDataOffset?: number;
  /** How long the tile data section is. */
  tileDataLength?: number;
}

/** Write a little-endian 64-bit unsigned integer that fits in 32 bits. */
function setUint64(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
  view.setUint32(offset + 4, 0, true);
}

/**
 * The first 16 KiB of a tiny PMTiles v3 archive: a 127-byte header (world
 * bounds, zooms 0-12, uncompressed) followed by an empty root directory at
 * byte 127. Enough for `pmtiles` to read the header.
 */
export function archiveBytes(options: ArchiveBytesOptions): ArrayBuffer {
  const { tileType, tileDataOffset = 128, tileDataLength = 0 } = options;
  const buffer = new ArrayBuffer(16384);
  const view = new DataView(buffer);
  for (const [i, char] of [..."PMTiles"].entries()) {
    view.setUint8(i, char.charCodeAt(0));
  }
  view.setUint8(7, 3); // spec version
  setUint64(view, 8, 127); // root directory offset
  setUint64(view, 16, 1); // root directory length: one varint, zero entries
  setUint64(view, 24, 128); // metadata offset
  setUint64(view, 32, 0); // metadata length
  setUint64(view, 40, 128); // leaf directories offset
  setUint64(view, 48, 0); // leaf directories length
  setUint64(view, 56, tileDataOffset);
  setUint64(view, 64, tileDataLength);
  view.setUint8(96, 1); // clustered
  view.setUint8(97, 1); // internal compression: none
  view.setUint8(98, 1); // tile compression: none
  view.setUint8(99, tileType);
  view.setUint8(100, 0); // min zoom
  view.setUint8(101, 12); // max zoom
  view.setInt32(102, -1800000000, true); // min lon, e7
  view.setInt32(106, -850511287, true); // min lat, e7
  view.setInt32(110, 1800000000, true); // max lon, e7
  view.setInt32(114, 850511287, true); // max lat, e7
  return buffer;
}

/**
 * A complete one-tile PMTiles v3 archive: its root directory points tile
 * 0/0/0 at 10 bytes of 7s at byte 200, so a real `PMTiles` can read it.
 */
export function oneTileArchive(): Uint8Array {
  const bytes = new Uint8Array(16384);
  const view = new DataView(bytes.buffer);
  for (const [i, char] of [..."PMTiles"].entries()) {
    view.setUint8(i, char.charCodeAt(0));
  }
  view.setUint8(7, 3); // spec version
  setUint64(view, 8, 127); // root directory offset
  setUint64(view, 16, 5); // root directory length
  setUint64(view, 24, 132); // metadata offset
  setUint64(view, 32, 0); // metadata length
  setUint64(view, 40, 132); // leaf directories offset
  setUint64(view, 48, 0); // leaf directories length
  setUint64(view, 56, 200); // tile data offset
  setUint64(view, 64, 10); // tile data length
  view.setUint8(96, 1); // clustered
  view.setUint8(97, 1); // internal compression: none
  view.setUint8(98, 1); // tile compression: none
  view.setUint8(99, 4); // WebP
  // Root directory: one entry, tile id 0, run length 1, length 10, offset 0.
  bytes.set([1, 0, 1, 10, 1], 127);
  bytes.fill(7, 200, 210);
  return bytes;
}
