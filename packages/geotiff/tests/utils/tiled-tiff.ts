/** Side length of every tile, in pixels. */
const TILE_SIZE = 16;

/** TIFF field types used below. */
const SHORT = 3;
const LONG = 4;
const DOUBLE = 12;

/** One IFD entry: a tag, its field type, and its values. */
type Entry = { tag: number; type: number; values: number[] };

/** Byte size of one value of each field type. */
const TYPE_SIZE: Record<number, number> = {
  [SHORT]: 2,
  [LONG]: 4,
  [DOUBLE]: 8,
};

/** A GeoTIFF built by {@link makeTiledGeoTIFF}. */
export interface TiledGeoTIFF {
  /** The file contents. */
  bytes: Uint8Array;
  /** Byte offset of the TileOffsets table. */
  tileOffsetsOffset: number;
  /** Byte offset of the TileByteCounts table. */
  tileByteCountsOffset: number;
}

/**
 * Build an uncompressed, single-band uint8 GeoTIFF in EPSG:3857 made of
 * `tilesAcross × tilesDown` tiles of 16×16 pixels, all filled with `fill`.
 *
 * The layout follows a COG header: the IFD, then its out-of-line tag values
 * with the TileOffsets and TileByteCounts tables last, then the pixel data.
 * Every tile points at one shared 256-byte block, so the file stays small
 * however many tiles it has, while each table grows by 4 bytes per tile. With
 * enough tiles the tables run past the bytes `GeoTIFF.open` reads, and
 * cogeotiff reads their entries lazily on each tile fetch, as it does for a
 * large COG.
 *
 * `planarConfiguration` defaults to 1 (contiguous). Set it to 2 to read the
 * same file through the band-separate path; with one band the tables are
 * identical.
 */
export function makeTiledGeoTIFF(options: {
  tilesAcross: number;
  tilesDown: number;
  fill: number;
  planarConfiguration?: 1 | 2;
}): TiledGeoTIFF {
  const { tilesAcross, tilesDown, fill, planarConfiguration = 1 } = options;
  const tileCount = tilesAcross * tilesDown;
  const width = tilesAcross * TILE_SIZE;
  const height = tilesDown * TILE_SIZE;
  const tileBytes = TILE_SIZE * TILE_SIZE;

  const geoKeys = [
    // KeyDirectoryVersion, KeyRevision, MinorRevision, NumberOfKeys
    1, 1, 0, 3,
    // GTModelTypeGeoKey = ModelTypeProjected
    1024, 0, 1, 1,
    // GTRasterTypeGeoKey = RasterPixelIsArea
    1025, 0, 1, 1,
    // ProjectedCSTypeGeoKey = EPSG:3857
    3072, 0, 1, 3857,
  ];

  // Placeholders for the two tables; their values depend on where the pixel
  // data lands, which is only known after laying out the header.
  const tileOffsets: Entry = { tag: 324, type: LONG, values: [] };
  const tileByteCounts: Entry = { tag: 325, type: LONG, values: [] };

  // Sorted by tag, as TIFF requires.
  const entries: Entry[] = [
    { tag: 256, type: LONG, values: [width] }, // ImageWidth
    { tag: 257, type: LONG, values: [height] }, // ImageLength
    { tag: 258, type: SHORT, values: [8] }, // BitsPerSample
    { tag: 259, type: SHORT, values: [1] }, // Compression: none
    { tag: 262, type: SHORT, values: [1] }, // Photometric: BlackIsZero
    { tag: 277, type: SHORT, values: [1] }, // SamplesPerPixel
    { tag: 284, type: SHORT, values: [planarConfiguration] }, // PlanarConfiguration
    { tag: 322, type: SHORT, values: [TILE_SIZE] }, // TileWidth
    { tag: 323, type: SHORT, values: [TILE_SIZE] }, // TileLength
    tileOffsets,
    tileByteCounts,
    { tag: 339, type: SHORT, values: [1] }, // SampleFormat: uint
    { tag: 33550, type: DOUBLE, values: [1, 1, 0] }, // ModelPixelScale
    { tag: 33922, type: DOUBLE, values: [0, 0, 0, 0, height, 0] }, // ModelTiepoint
    { tag: 34735, type: SHORT, values: geoKeys }, // GeoKeyDirectory
  ];

  // Out-of-line values follow the IFD; the two tables go last.
  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const tableSize = tileCount * TYPE_SIZE[LONG]!;
  const others = entries.filter(
    (e) => e !== tileOffsets && e !== tileByteCounts,
  );
  const valueOffsets = new Map<Entry, number>();
  let cursor = ifdOffset + ifdSize;
  for (const entry of [...others, tileOffsets, tileByteCounts]) {
    const size =
      entry === tileOffsets || entry === tileByteCounts
        ? tableSize
        : entry.values.length * TYPE_SIZE[entry.type]!;
    if (size > 4) {
      valueOffsets.set(entry, cursor);
      cursor += size;
    }
  }
  const pixelOffset = cursor;
  tileOffsets.values = new Array<number>(tileCount).fill(pixelOffset);
  tileByteCounts.values = new Array<number>(tileCount).fill(tileBytes);

  const bytes = new Uint8Array(pixelOffset + tileBytes);
  const view = new DataView(bytes.buffer);
  // Header: little-endian ("II"), magic 42, offset of the first IFD.
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach((entry, i) => {
    const at = ifdOffset + 2 + i * 12;
    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, entry.values.length, true);
    const valueOffset = valueOffsets.get(entry);
    if (valueOffset !== undefined) {
      view.setUint32(at + 8, valueOffset, true);
    }
    writeValues(view, entry, valueOffset ?? at + 8);
  });
  // The next-IFD offset stays 0: this is the only IFD.

  bytes.fill(fill, pixelOffset);

  return {
    bytes,
    tileOffsetsOffset: valueOffsets.get(tileOffsets)!,
    tileByteCountsOffset: valueOffsets.get(tileByteCounts)!,
  };
}

/** Write an entry's values, little-endian, starting at `offset`. */
function writeValues(view: DataView, entry: Entry, offset: number): void {
  const size = TYPE_SIZE[entry.type]!;
  entry.values.forEach((value, i) => {
    const at = offset + i * size;
    if (entry.type === SHORT) {
      view.setUint16(at, value, true);
    } else if (entry.type === LONG) {
      view.setUint32(at, value, true);
    } else {
      view.setFloat64(at, value, true);
    }
  });
}
