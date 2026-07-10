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
