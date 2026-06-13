/**
 * Point inspector: read a clicked location's raw band reflectances straight
 * from the Sentinel-2 COGs and classify it via spectral indices.
 *
 * The on-screen composites are deliberately ambiguous (a SWIR combination makes
 * *both* shadow and water dark, say), so "what am I actually looking at?" can't
 * be answered by the rendered color alone. This reads the underlying band
 * values at one pixel and derives the standard indices that separate water,
 * vegetation, burn scars and bare ground — an independent check on the visual.
 *
 * How a point read works:
 *  1. The COGs are in their MGRS tile's UTM zone, so we reproject the clicked
 *     lon/lat (EPSG:4326) into the COG's CRS — same proj4 path the COG layer
 *     uses internally (see `cog-layer.ts`).
 *  2. `GeoTIFF.index` maps that coordinate to a [row, col] pixel; we fetch only
 *     the single tile containing it (one range request per band) and read the
 *     sample. 10m bands (red/green/nir) and 20m bands (swir22) live on
 *     different grids, so each is resolved against its own GeoTIFF.
 *
 * Indices are band *ratios*, so the COGs' uint16 DN scaling cancels — no need
 * to convert to physical reflectance before computing them.
 */

import { GeoTIFF } from "@developmentseed/geotiff";
import { epsgResolver, parseWkt } from "@developmentseed/proj";
import proj4 from "proj4";
import type { BandKey, Scene } from "./stac.js";

/** Bands needed for NDWI (green, nir), NDVI (red, nir) and NBR (nir, swir22). */
const INSPECT_BANDS = ["green", "red", "nir", "swir22"] as const satisfies BandKey[];

/** Per-band reflectance DN read at a point (null = no-data / outside footprint). */
export type BandValues = Record<(typeof INSPECT_BANDS)[number], number | null>;

export type Inspection = {
  /** Heuristic land-cover label for the clicked pixel. */
  category: string;
  /** Normalized Difference Water Index — water/flood is positive. */
  ndwi: number | null;
  /** Normalized Difference Vegetation Index — healthy vegetation is high. */
  ndvi: number | null;
  /** Normalized Burn Ratio — recently burned ground is low/negative. */
  nbr: number | null;
  values: BandValues;
};

// Cache opened GeoTIFFs by URL: a user clicking around one scene re-reads the
// same COGs, and opening parses the header (a range request) each time.
const tiffCache = new Map<string, Promise<GeoTIFF>>();

function openTiff(url: string): Promise<GeoTIFF> {
  let tiff = tiffCache.get(url);
  if (!tiff) {
    tiff = GeoTIFF.fromUrl(url);
    tiffCache.set(url, tiff);
  }
  return tiff;
}

/** Read one band's pixel value at lon/lat, or null if no-data / out of bounds. */
async function readBandValue(
  url: string,
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<number | null> {
  const tiff = await openTiff(url);

  // Reproject the click into the COG's CRS (UTM). `inverse` maps EPSG:4326 ->
  // source CRS; `false` keeps it in radians-vs-degrees-agnostic [x, y] order.
  const crs = tiff.crs;
  const sourceProjection = typeof crs === "number" ? await epsgResolver(crs) : parseWkt(crs);
  // @ts-expect-error - proj4 typings don't accept a parsed projection object
  const converter = proj4(sourceProjection, "EPSG:4326");
  const [x, y] = converter.inverse<[number, number]>([lon, lat], false);

  const [row, col] = tiff.index(x, y);
  if (row < 0 || col < 0 || row >= tiff.height || col >= tiff.width) {
    return null;
  }

  // Fetch only the tile covering the pixel, then index within it.
  const tx = Math.floor(col / tiff.tileWidth);
  const ty = Math.floor(row / tiff.tileHeight);
  const tile = await tiff.fetchTile(tx, ty, { signal });
  const inCol = col - tx * tiff.tileWidth;
  const inRow = row - ty * tiff.tileHeight;
  const { array } = tile;
  const offset = inRow * array.width + inCol;
  const value =
    array.layout === "band-separate"
      ? array.bands[0][offset]
      : array.data[offset * array.count];

  // L2A stores 0 as no-data; also honor an explicit GDAL nodata tag.
  if (value === 0 || (tiff.nodata !== null && value === tiff.nodata)) {
    return null;
  }
  return value;
}

/** Normalized difference (a - b) / (a + b), or null if either input is missing. */
function normDiff(a: number | null, b: number | null): number | null {
  if (a === null || b === null || a + b === 0) {
    return null;
  }
  return (a - b) / (a + b);
}

/**
 * Classify a pixel from its indices. Thresholds are deliberately simple and
 * single-date: good enough to confirm "yes, this is water / burned / vegetated"
 * while inspecting, not a publishable land-cover product. Order matters — water
 * is tested first because flooded ground can still carry some NDVI signal.
 *
 * Note on burn: rigorous detection uses dNBR (pre- vs post-fire). A single-date
 * low NBR over non-vegetated, non-water ground is only *burn-like*, so we label
 * it as such rather than asserting a burn scar.
 */
function classify(ndwi: number | null, ndvi: number | null, nbr: number | null): string {
  if (ndwi === null && ndvi === null && nbr === null) {
    return "No data here";
  }
  if (ndwi !== null && ndwi >= 0) {
    return "Water / flooded land";
  }
  if (ndvi !== null && ndvi >= 0.4) {
    return "Healthy vegetation";
  }
  if (nbr !== null && nbr <= 0.1 && (ndvi === null || ndvi < 0.3)) {
    return "Burn-like (low NBR)";
  }
  return "Bare soil / built-up";
}

/** Read all inspector bands at lon/lat for `scene` and classify the pixel. */
export async function inspectPoint(
  scene: Scene,
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<Inspection> {
  const read = await Promise.all(
    INSPECT_BANDS.map((band) => readBandValue(scene.bandUrls[band], lon, lat, signal)),
  );
  const values = Object.fromEntries(
    INSPECT_BANDS.map((band, i) => [band, read[i]]),
  ) as BandValues;

  const ndwi = normDiff(values.green, values.nir);
  const ndvi = normDiff(values.nir, values.red);
  const nbr = normDiff(values.nir, values.swir22);

  return { category: classify(ndwi, ndvi, nbr), ndwi, ndvi, nbr, values };
}
