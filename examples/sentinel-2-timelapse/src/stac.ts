/**
 * STAC search against Earth Search (element84) for Sentinel-2 scenes.
 *
 * STAC ("SpatioTemporal Asset Catalog") is a standard JSON API for searching
 * geospatial imagery. We POST a query (region + time + filters) to the `/search`
 * endpoint and get back a GeoJSON `FeatureCollection` whose features are STAC
 * **Items**. Each Item is one satellite acquisition and exposes its band rasters
 * as named **assets** (e.g. `red`, `green`, `blue`, `swir22`), each a URL to a
 * Cloud-Optimized GeoTIFF (COG) in a public S3 bucket.
 *
 * Sentinel-2 imagery is delivered per ~110km **MGRS tile**, each in its own UTM
 * zone. A single point on the ground is revisited every ~5 days, so one MGRS
 * tile gives us a natural time series to animate.
 */

const EARTH_SEARCH_URL = "https://earth-search.aws.element84.com/v1/search";

/**
 * Drop scenes whose footprint is more than this percent no-data. A Sentinel-2
 * pass often clips the edge of an MGRS tile, producing acquisitions that only
 * partially cover it (large empty wedges). Those make for a jumpy time-lapse,
 * so we keep only near-complete frames — fewer images, but a steady footprint.
 */
const MAX_NODATA_PCT = 5;

/**
 * Sentinel-2 L2A collection on Earth Search.
 *
 * Only `sentinel-2-l2a` is offered: its assets live in the public `sentinel-cogs`
 * bucket, which sends `Access-Control-Allow-Origin: *`, so the browser can fetch
 * the COGs directly. The newer `sentinel-2-c1-l2a` ("Collection 1") product keeps
 * its assets in the `e84-earth-search-sentinel-data` bucket, which has **no CORS
 * headers** — every in-browser COG fetch fails, so the map renders blank even
 * though the STAC search (CORS-enabled) returns scenes. Since this example reads
 * COGs straight from the browser with no tile server, c1-l2a can't be supported.
 */
export type Collection = "sentinel-2-l2a";

/** The band assets we composite into RGB. Keys match Earth Search asset names. */
export const BAND_KEYS = [
  "red",
  "green",
  "blue",
  "nir",
  "swir16",
  "swir22",
] as const;
export type BandKey = (typeof BAND_KEYS)[number];

/** One Sentinel-2 acquisition, reduced to what this example needs. */
export type Scene = {
  /** STAC Item id, used for layer ids and React keys. */
  id: string;
  /** ISO 8601 acquisition timestamp. */
  datetime: string;
  /** Cloud cover percentage (`eo:cloud_cover`), 0-100. */
  cloudCover: number;
  /** MGRS tile code, e.g. "MGRS-42RUQ". */
  gridCode: string;
  /** Percent of the tile footprint with no data (`s2:nodata_pixel_percentage`). */
  nodataPct: number;
  /** Scene footprint [west, south, east, north] in WGS84 degrees. */
  bbox: [number, number, number, number];
  /** COG URL per band, e.g. `bandUrls.red`. */
  bandUrls: Record<BandKey, string>;
};

/** Parameters for a single search. */
export type SearchParams = {
  collection: Collection;
  /** [west, south, east, north] in WGS84 degrees. */
  bbox: [number, number, number, number];
  /** Inclusive start/end dates as "YYYY-MM-DD". */
  startDate: string;
  endDate: string;
  /** Keep only scenes with cloud cover below this percentage. */
  cloudCoverMax: number;
};

/** Minimal shape of a STAC Item in the search response. */
type StacItem = {
  id: string;
  /** Footprint as [west, south, east, north] (may carry elevation as 6 values). */
  bbox: number[];
  properties: {
    datetime: string;
    "eo:cloud_cover"?: number;
    "grid:code"?: string;
    "s2:nodata_pixel_percentage"?: number;
  };
  assets: Record<string, { href: string } | undefined>;
};

type StacFeatureCollection = { features: StacItem[] };

/**
 * Search a collection for scenes covering `bbox` within the date range, then
 * return the single MGRS tile with the most scenes as a time-ordered series.
 *
 * Restricting to one MGRS tile keeps V1 simple: each date maps to exactly one
 * STAC Item, so a `MultiCOGLayer` can render it directly without mosaicking
 * across UTM zones.
 */
export async function searchScenes(
  params: SearchParams,
  signal?: AbortSignal,
): Promise<Scene[]> {
  const { collection, bbox, startDate, endDate, cloudCoverMax } = params;

  const body = {
    collections: [collection],
    bbox,
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    query: { "eo:cloud_cover": { lt: cloudCoverMax } },
    // Plenty of headroom: a few months over one tile is well under this.
    limit: 200,
    sortby: [{ field: "properties.datetime", direction: "asc" }],
  };

  const response = await fetch(EARTH_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(`STAC search failed: ${response.status} ${response.statusText}`);
  }

  const data: StacFeatureCollection = await response.json();
  const scenes = data.features
    .flatMap(toScene)
    // Drop partial-coverage frames so the chosen tile is fully imaged on every
    // date (see MAX_NODATA_PCT) — we'd rather animate fewer, complete scenes.
    .filter((scene) => scene.nodataPct <= MAX_NODATA_PCT);
  // The center of the search bbox is the place the user is looking at; prefer
  // the tile that actually covers it.
  const center: [number, number] = [
    (bbox[0] + bbox[2]) / 2,
    (bbox[1] + bbox[3]) / 2,
  ];
  return pickBestTile(scenes, center);
}

/**
 * Convert a STAC Item to a {@link Scene}, or drop it (return `[]`) if it is
 * missing any band we need. `flatMap` over the result filters dropped items.
 */
function toScene(item: StacItem): Scene[] {
  const bandUrls = {} as Record<BandKey, string>;
  for (const key of BAND_KEYS) {
    const href = item.assets[key]?.href;
    if (!href) {
      return [];
    }
    bandUrls[key] = href;
  }
  return [
    {
      id: item.id,
      datetime: item.properties.datetime,
      cloudCover: item.properties["eo:cloud_cover"] ?? 0,
      gridCode: item.properties["grid:code"] ?? "unknown",
      nodataPct: item.properties["s2:nodata_pixel_percentage"] ?? 0,
      // bbox may include elevation as [w, s, minZ, e, n, maxZ]; take the
      // horizontal corners from the ends.
      bbox: [
        item.bbox[0],
        item.bbox[1],
        item.bbox[item.bbox.length - 2],
        item.bbox[item.bbox.length - 1],
      ],
      bandUrls,
    },
  ];
}

/** Is `point` ([lon, lat]) inside the footprint `bbox` ([w, s, e, n])? */
function bboxContains(
  bbox: [number, number, number, number],
  [lon, lat]: [number, number],
): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/**
 * A bbox often straddles several MGRS tiles, each a separate UTM zone. To get a
 * clean single-tile time series we pick one tile and return its scenes, sorted
 * ascending by time (incomplete frames are filtered out upstream, see
 * MAX_NODATA_PCT).
 *
 * Tile selection is two-fold: among tiles whose footprint covers `center` (the
 * place the user is looking at), keep the one with the most complete scenes.
 * This matters when the most-imaged tile sits *next to* the area of interest —
 * e.g. for the LA fires the adjacent northern tile has more passes but doesn't
 * contain the burn scars. Only if no tile covers the center (an edge case) do
 * we fall back to the most-complete tile overall.
 */
function pickBestTile(scenes: Scene[], center: [number, number]): Scene[] {
  if (scenes.length === 0) {
    return [];
  }
  const byTile = new Map<string, Scene[]>();
  for (const scene of scenes) {
    const group = byTile.get(scene.gridCode) ?? [];
    group.push(scene);
    byTile.set(scene.gridCode, group);
  }

  const groups = [...byTile.values()];
  const covering = groups.filter((group) =>
    group.some((scene) => bboxContains(scene.bbox, center)),
  );
  const pool = covering.length > 0 ? covering : groups;

  let best: Scene[] = [];
  for (const group of pool) {
    if (group.length > best.length) {
      best = group;
    }
  }
  return best;
}
