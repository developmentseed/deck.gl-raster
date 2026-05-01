/**
 * Curated set of Vermont Open Data statewide aerial composites used by the
 * comparison UI. Order drives the dropdown order (oldest → newest).
 *
 * Source bucket: `s3://vtopendata-prd/Imagery/` (CORS open, anonymous GET).
 * Catalog: https://registry.opendata.aws/vt-opendata/
 */

const BASE_URL = "https://vtopendata-prd.s3.amazonaws.com/Imagery";

/** Number of bands in the source COG. Drives which render modes are valid. */
export type BandCount = 1 | 3 | 4;

/** One entry in the curated VT imagery table. */
export type VTFile = {
  /** Stable identifier — used as `<select>` option value. */
  id: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Fully qualified COG URL. */
  url: string;
  /** Number of source bands. */
  bands: BandCount;
};

/**
 * Statewide composites. Deliberately omits the 2016-2020 gap and per-county
 * tiles — the goal is "scrub through 50 years" not "browse the bucket".
 */
export const VT_FILES = [
  {
    id: "1974-1992",
    label: "1974–1992 (100cm, leaf-off)",
    url: `${BASE_URL}/STATEWIDE_1974-1992_100cm_LeafOFF_1Band.tif`,
    bands: 1,
  },
  {
    id: "1994-2000",
    label: "1994–2000 (50cm, leaf-off)",
    url: `${BASE_URL}/STATEWIDE_1994-2000_50cm_LeafOFF_1Band.tif`,
    bands: 1,
  },
  {
    id: "2006-2010",
    label: "2006–2010 (50cm, leaf-off)",
    url: `${BASE_URL}/STATEWIDE_2006-2010_50cm_LeafOFF_1Band.tif`,
    bands: 1,
  },
  {
    id: "2011-2015",
    label: "2011–2015 (50cm, leaf-off, 4-band)",
    url: `${BASE_URL}/STATEWIDE_2011-2015_50cm_LeafOFF_4Band.tif`,
    bands: 4,
  },
  {
    id: "2021",
    label: "2021 (60cm, leaf-on, 4-band)",
    url: `${BASE_URL}/STATEWIDE_2021_60cm_LeafON_4Band.tif`,
    bands: 4,
  },
  {
    id: "2021-2022",
    label: "2021–2022 (30cm, leaf-off, 4-band)",
    url: `${BASE_URL}/STATEWIDE_2021-2022_30cm_LeafOFF_4Band.tif`,
    bands: 4,
  },
  {
    id: "2023",
    label: "2023 (30cm, leaf-on, 4-band)",
    url: `${BASE_URL}/STATEWIDE_2023_30cm_LeafON_4Band.tif`,
    bands: 4,
  },
  {
    id: "2024",
    label: "2024 (30cm, leaf-off, 4-band)",
    url: `${BASE_URL}/STATEWIDE_2024_30cm_LeafOFF_4Band.tif`,
    bands: 4,
  },
  {
    id: "2025",
    label: "2025 (30cm, leaf-on, 3-band)",
    url: `${BASE_URL}/STATEWIDE_2025_30cm_LeafON_3Band.tif`,
    bands: 3,
  },
] as const satisfies readonly VTFile[];

/** Union of valid file ids. */
export type VTFileId = (typeof VT_FILES)[number]["id"];

/** Default file shown on the left side at first paint (oldest 1-band). */
export const DEFAULT_LEFT_ID: VTFileId = "1994-2000";

/** Default file shown on the right side at first paint (newest 3-band). */
export const DEFAULT_RIGHT_ID: VTFileId = "2025";

/** Find a file entry by id. The id union prevents a miss from real callers. */
export function getVTFile(id: VTFileId): VTFile {
  const file = VT_FILES.find((f) => f.id === id);
  if (!file) {
    throw new Error(`Unknown VT file id: ${id}`);
  }
  return file;
}
