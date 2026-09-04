/**
 * Hand-picked USGS 3DEP 1-meter elevation cells.
 *
 * The National Map stages 3DEP lidar-derived DEMs as 10 km × 10 km cells under
 * `s3://prd-tnm`, one GeoTIFF per cell, float32 and LZW-compressed with
 * overview factors [2, 4, 8, 16, 32] — valid COGs served with open CORS and
 * HTTP range support, so they stream straight into the browser.
 *
 * The five below were chosen for relief, and deliberately span both product
 * vintages: the older `USGS_one_meter_*` files are internally tiled at 256 px
 * and the newer `USGS_1M_*` at 512 px, across three UTM zones and two
 * different nodata sentinels. Nothing about tile size, nodata, or CRS is
 * hardcoded anywhere in this example.
 */

const BASE_URL =
  "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects";

/** Shape constraint for a cell entry. */
type CellShape = {
  /** Stable identifier used as the select-option value. */
  id: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Full URL of the COG. */
  url: string;
  /**
   * Elevation range in meters used as the default colormap rescale bounds.
   * These vary enormously between cells — Zion's canyon floor to Mount
   * Baker's summit — so a single global default would wash most of them out.
   */
  elevationRange: [number, number];
};

/**
 * The available cells. Order drives the dropdown order.
 *
 * `satisfies` preserves the literal `id` values for downstream inference while
 * still enforcing the shape.
 */
export const CELLS = [
  {
    id: "grand-canyon",
    label: "Grand Canyon — South Rim, AZ",
    url: `${BASE_URL}/AZ_GrandCanyonNP_2019_B19/TIFF/USGS_1M_12_x39y400_AZ_GrandCanyonNP_2019_B19.tif`,
    elevationRange: [750, 2250],
  },
  {
    id: "zion",
    label: "Zion Canyon, UT",
    url: `${BASE_URL}/UT_ZionNP_QL1_2016/TIFF/USGS_one_meter_x32y413_UT_ZionNP_QL1_2016.tif`,
    elevationRange: [1100, 2300],
  },
  {
    id: "yosemite",
    label: "Yosemite — Half Dome, CA",
    url: `${BASE_URL}/CA_YosemiteNP_2019_D19/TIFF/USGS_1M_11_x27y419_CA_YosemiteNP_2019_D19.tif`,
    elevationRange: [1100, 3000],
  },
  {
    id: "grand-teton",
    label: "Grand Teton, WY",
    url: `${BASE_URL}/WY_GrandTetonNP_D22/TIFF/USGS_1M_12_x51y485_WY_GrandTetonNP_D22.tif`,
    elevationRange: [1900, 4200],
  },
  {
    id: "mount-baker",
    label: "Mount Baker, WA",
    url: `${BASE_URL}/WA_MtBaker_2015/TIFF/USGS_one_meter_x58y541_WA_MtBaker_2015.tif`,
    elevationRange: [200, 3300],
  },
] as const satisfies readonly CellShape[];

/** Union of valid cell ids. */
export type CellId = (typeof CELLS)[number]["id"];

/** An entry from {@link CELLS}. */
export type Cell = (typeof CELLS)[number];

/** Cell shown on first load. */
export const DEFAULT_CELL_ID: CellId = CELLS[0].id;
