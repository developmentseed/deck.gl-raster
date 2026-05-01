/**
 * Curated set of Vermont Open Data aerial imagery used by the comparison UI.
 *
 * Source bucket: `s3://vtopendata-prd/Imagery/` (CORS open, anonymous GET).
 * Catalog: https://registry.opendata.aws/vt-opendata/
 *
 * Two categories:
 * - `statewide` — multi-year statewide composites, the headline scrub story
 * - `yearly` — individual-year (or short-range) acquisitions, often higher res
 */

const BASE_URL = "https://vtopendata-prd.s3.amazonaws.com/Imagery";

/** Number of bands in the source COG. Drives which render modes are valid. */
export type BandCount = 1 | 3 | 4;

/** Whether the imagery is a statewide composite or a single-year acquisition. */
export type FileCategory = "statewide" | "yearly";

/** One entry in the curated VT imagery table. */
export type VTFile = {
  /** Stable identifier — used as `<select>` option value. The filename minus `.tif`. */
  id: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Fully qualified COG URL. */
  url: string;
  /** Number of source bands. */
  bands: BandCount;
  /** Group identifier used for `<optgroup>` separation in the UI. */
  category: FileCategory;
  /**
   * Total bytes occupied by the TIFF header (= offset where tile data begins).
   *
   * When known, lets us request the exact range in a single HTTP call when
   * opening the COG. When `undefined` the loader falls back to a generic
   * default. Measure with `GeoTIFF.getHeaderByteLength()` and add to
   * {@link HEADER_BYTE_LENGTHS} below.
   */
  headerByteLength?: number;
};

/**
 * Statewide composites in newest-first order. Filenames encode all the
 * metadata we need (year/range, ground sample distance, leaf season, band
 * count); we parse them rather than spell each entry out longhand.
 */
const STATEWIDE_FILENAMES = [
  "STATEWIDE_2025_30cm_LeafON_3Band.tif",
  "STATEWIDE_2024_30cm_LeafOFF_4Band.tif",
  "STATEWIDE_2023_30cm_LeafON_4Band.tif",
  "STATEWIDE_2021-2022_30cm_LeafOFF_4Band.tif",
  "STATEWIDE_2021_60cm_LeafON_4Band.tif",
  "STATEWIDE_2011-2015_50cm_LeafOFF_4Band.tif",
  "STATEWIDE_2006-2010_50cm_LeafOFF_1Band.tif",
  "STATEWIDE_1994-2000_50cm_LeafOFF_1Band.tif",
  "STATEWIDE_1974-1992_100cm_LeafOFF_1Band.tif",
] as const;

/** Single-year (or short-range) acquisitions, newest-first. */
const YEARLY_FILENAMES = [
  "2023_15cm_LeafOFF_4Band.tif",
  "2022_30cm_LeafOFF_4Band.tif",
  "2021_30cm_LeafOFF_4Band.tif",
  "2020_15cm_LeafOFF_4Band.tif",
  "2019_30cm_LeafOFF_4Band.tif",
  "2019_15cm_LeafOFF_4Band.tif",
  "2018_30cm_LeafOFF_4Band.tif",
  "2018_15cm_LeafOFF_4Band.tif",
  "2017_30cm_LeafOFF_4Band.tif",
  "2017_15cm_LeafOFF_4Band.tif",
  "2016-2019_30cm_LeafOFF_4Band.tif",
  "2016_30cm_LeafOFF_4Band.tif",
  "2016_15cm_LeafOFF_4Band.tif",
  "2015_50cm_LeafOFF_4Band.tif",
  "2014_50cm_LeafOFF_4Band.tif",
  "2013_50cm_LeafOFF_4Band.tif",
  "2013_30cm_LeafOFF_4Band.tif",
  "2013_20cm_LeafOFF_4Band.tif",
  "2013_15cm_LeafOFF_4Band.tif",
  "2012_50cm_LeafOFF_4Band.tif",
  "2011_50cm_LeafOFF_4Band.tif",
  "2010_50cm_LeafOFF_1Band.tif",
  "2009_50cm_LeafOFF_1Band.tif",
  "2009_30cm_LeafOFF_3Band.tif",
  "2008_50cm_LeafOFF_1Band.tif",
  "2008_30cm_LeafON_3Band.tif",
  "2007_50cm_LeafOFF_1Band.tif",
  "2006_50cm_LeafOFF_1Band.tif",
  "2006_15cm_LeafOFF_3Band.tif",
  "2004_16cm_LeafOFF_3Band.tif",
  "2001_15cm_LeafOFF_3Band.tif",
  "2000_50cm_LeafOFF_1Band.tif",
  "1999_50cm_LeafOFF_1Band.tif",
  "1998_50cm_LeafOFF_1Band.tif",
  "1998_13cm_LeafOFF_1Band.tif",
  "1996_50cm_LeafOFF_1Band.tif",
  "1995_50cm_LeafOFF_1Band.tif",
  "1994_50cm_LeafOFF_1Band.tif",
] as const;

/**
 * Measured header byte lengths for files we've opened. Pulled from the
 * `GeoTIFF.getHeaderByteLength()` log; see [README](../README.md). Add
 * an entry whenever a new file's header length is observed so the loader
 * can fetch the exact range in one request.
 *
 * Keyed by VTFile.id (filename without `.tif`).
 */
const HEADER_BYTE_LENGTHS: Record<string, number> = {
  STATEWIDE_2025_30cm_LeafON_3Band: 60_998_796,
  STATEWIDE_2024_30cm_LeafOFF_4Band: 27_985_606,
  STATEWIDE_2023_30cm_LeafON_4Band: 29_757_726,
  "STATEWIDE_2021-2022_30cm_LeafOFF_4Band": 27_985_604,
  STATEWIDE_2021_60cm_LeafON_4Band: 7_445_474,
  "STATEWIDE_2011-2015_50cm_LeafOFF_4Band": 10_014_005,
  "STATEWIDE_2006-2010_50cm_LeafOFF_1Band": 10_012_861,
  "STATEWIDE_1994-2000_50cm_LeafOFF_1Band": 10_012_861,
  "STATEWIDE_1974-1992_100cm_LeafOFF_1Band": 3_507_513,
  "2023_15cm_LeafOFF_4Band": 73_284_297,
  "2022_30cm_LeafOFF_4Band": 18_243_651,
  "2021_30cm_LeafOFF_4Band": 5_955_273,
  "2020_15cm_LeafOFF_4Band": 10_516_770,
  "2019_30cm_LeafOFF_4Band": 26_110_689,
  "2019_15cm_LeafOFF_4Band": 28_574_141,
  "2018_30cm_LeafOFF_4Band": 12_708_843,
  "2018_15cm_LeafOFF_4Band": 41_931_939,
  "2017_30cm_LeafOFF_4Band": 3_127_309,
  "2017_15cm_LeafOFF_4Band": 4_943_211,
  "2016-2019_30cm_LeafOFF_4Band": 27_985_838,
  "2016_30cm_LeafOFF_4Band": 4_399_707,
  "2016_15cm_LeafOFF_4Band": 14_061_893,
  "2015_50cm_LeafOFF_4Band": 1_124_768,
  "2014_50cm_LeafOFF_4Band": 1_657_062,
  "2013_50cm_LeafOFF_4Band": 1_492_374,
  "2013_30cm_LeafOFF_4Band": 563_878,
  "2013_20cm_LeafOFF_4Band": 934_966,
  "2013_15cm_LeafOFF_4Band": 5_870_274,
  "2012_50cm_LeafOFF_4Band": 2_283_359,
  "2011_50cm_LeafOFF_4Band": 1_539_159,
  "2010_50cm_LeafOFF_1Band": 1_122_683,
  "2009_50cm_LeafOFF_1Band": 753_547,
  "2009_30cm_LeafOFF_3Band": 477_338,
  "2008_50cm_LeafOFF_1Band": 1_107_847,
  "2008_30cm_LeafON_3Band": 7_464_402,
  "2007_50cm_LeafOFF_1Band": 1_210_867,
  "2006_50cm_LeafOFF_1Band": 3_188_535,
  "2006_15cm_LeafOFF_3Band": 544_454,
  "2004_16cm_LeafOFF_3Band": 5_226_902,
  "2001_15cm_LeafOFF_3Band": 100_696,
  "2000_50cm_LeafOFF_1Band": 1_124_491,
  "1999_50cm_LeafOFF_1Band": 3_137_297,
  "1998_50cm_LeafOFF_1Band": 665_395,
  "1998_13cm_LeafOFF_1Band": 35_737,
  "1996_50cm_LeafOFF_1Band": 749_887,
  "1995_50cm_LeafOFF_1Band": 2_537_357,
  "1994_50cm_LeafOFF_1Band": 1_538_035,
};

const FILENAME_PATTERN =
  /^(STATEWIDE_)?(\d{4}(?:-\d{4})?)_(\d+)cm_Leaf(OFF|ON)_(\d)Band\.tif$/;

/**
 * Parse a Vermont Open Data filename into a {@link VTFile}.
 *
 * Filename grammar (always upper-camelcase keywords):
 *   `[STATEWIDE_]<year-or-range>_<gsd>cm_Leaf{OFF|ON}_<n>Band.tif`
 */
function parseVTFilename(filename: string, category: FileCategory): VTFile {
  const match = FILENAME_PATTERN.exec(filename);
  if (!match) {
    throw new Error(`Cannot parse Vermont COG filename: ${filename}`);
  }
  const [, , years, gsd, season, bands] = match;
  const bandCount = Number(bands) as BandCount;
  const id = filename.replace(/\.tif$/, "");
  const seasonLabel = season === "OFF" ? "leaf-off" : "leaf-on";
  const label = `${years} — ${gsd}cm ${seasonLabel}, ${bandCount}-band`;
  return {
    id,
    label,
    url: `${BASE_URL}/${filename}`,
    bands: bandCount,
    category,
    headerByteLength: HEADER_BYTE_LENGTHS[id],
  };
}

/** Every Vermont Open Data COG we expose, in display order. */
export const VT_FILES: readonly VTFile[] = [
  ...STATEWIDE_FILENAMES.map((f) => parseVTFilename(f, "statewide")),
  ...YEARLY_FILENAMES.map((f) => parseVTFilename(f, "yearly")),
];

/** Identifier into {@link VT_FILES}. Validated at runtime by {@link getVTFile}. */
export type VTFileId = string;

/** Default file shown on the left side at first paint (oldest 1-band statewide). */
export const DEFAULT_LEFT_ID: VTFileId =
  "STATEWIDE_1994-2000_50cm_LeafOFF_1Band";

/** Default file shown on the right side at first paint (newest 3-band statewide). */
export const DEFAULT_RIGHT_ID: VTFileId = "STATEWIDE_2025_30cm_LeafON_3Band";

/** Find a file entry by id; throws on miss. */
export function getVTFile(id: VTFileId): VTFile {
  const file = VT_FILES.find((f) => f.id === id);
  if (!file) {
    throw new Error(`Unknown VT file id: ${id}`);
  }
  return file;
}
