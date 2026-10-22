/** One of the three Sentinel-2 bands the explainer follows. */
export type BandId = "b04" | "b11" | "b01";

/** The bands in the order the explainer shows them. */
export const BAND_IDS: readonly BandId[] = ["b04", "b11", "b01"];

/** What the explainer expects of one band's COG. */
export type BandSpec = {
  /** Sentinel-2 band name, also the file name. */
  file: "B04" | "B11" | "B01";
  /** What the band measures. */
  label: string;
  /** Pixel size in metres at full resolution. */
  pixelSize: number;
  /** Width and height in pixels at full resolution. */
  size: number;
  /** Tile (block) size in pixels at full resolution. */
  block: number;
  /** Width and height of the coarsest overview, in pixels. */
  overviewSize: number;
  /** Tile (block) size of the coarsest overview, in pixels. */
  overviewBlock: number;
  /** Channel this band fills in the composite. */
  channel: "r" | "g" | "b";
  /** Colour of this band's grids and labels: its channel's colour. */
  color: [number, number, number, number];
};

/** The three bands, as the files on AWS store them. */
export const BANDS: Record<BandId, BandSpec> = {
  b04: {
    file: "B04",
    label: "Red",
    pixelSize: 10,
    size: 10980,
    block: 1024,
    overviewSize: 687,
    overviewBlock: 512,
    channel: "g",
    color: [90, 220, 130, 255],
  },
  b11: {
    file: "B11",
    label: "Shortwave infrared",
    pixelSize: 20,
    size: 5490,
    block: 1024,
    overviewSize: 687,
    overviewBlock: 512,
    channel: "r",
    color: [240, 100, 85, 255],
  },
  b01: {
    file: "B01",
    label: "Coastal aerosol",
    pixelSize: 60,
    size: 1830,
    block: 256,
    overviewSize: 229,
    overviewBlock: 128,
    channel: "b",
    color: [100, 160, 255, 255],
  },
};

/** The scene: Torres del Paine, Chile, 2026-04-06 (Sentinel-2 L2A). */
const SCENE_URL =
  "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/F/XJ/2026/4/S2C_18FXJ_20260406_0_L2A";

/** URL of one band's COG. */
export function bandUrl(band: BandId): string {
  return `${SCENE_URL}/${BANDS[band].file}.tif`;
}

/** Top-left corner of the scene, in UTM zone 18S (EPSG:32718) metres. */
export const SCENE_ORIGIN: [number, number] = [600000, 4400020];

/** Width and height of the scene, in metres. */
export const SCENE_EXTENT = 109800;

/** The 10 m tile the story follows. */
export const STORY_TILE = { x: 4, y: 4 } as const;

/**
 * Where step 1's insets look, as a UV point of the story tile. Chosen for
 * contrast: of 225 points tried, the 600 m square here varies most in all
 * three bands, so their different pixel sizes show.
 */
export const INSET_UV: [number, number] = [0.0625, 0.75];
