import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

/** A STAC item's `assets` entries, keyed by asset name. */
export type StacAssets = Record<string, { href: string }>;

/** Minimal STAC item shape read from a STAC-geoparquet file. */
export type StacGeoparquetItem = {
  id: string;
  /** `[minX, minY, maxX, maxY]`, as stored — not unwrapped for a crossing item. */
  bbox: [number, number, number, number];
  assets: StacAssets;
};

/**
 * Read `id`, `bbox`, and `assets` for every item in a STAC-geoparquet file,
 * fetched directly in the browser (no server-side indexing step) via
 * `hyparquet` — a pure-JS, zero-dependency Parquet reader that uses HTTP
 * range requests, so only the 3 needed columns are actually downloaded.
 *
 * `bbox` here is the geoparquet `STRUCT(xmin, ymin, xmax, ymax)` column
 * as-is — an antimeridian-crossing item's bbox is GeoJSON-flipped (RFC 7946
 * §5.2: xmin > xmax), same as a STAC item's own JSON `bbox`. Callers that
 * need a continuous frame (e.g. for a Flatbush spatial index) must unwrap it
 * themselves.
 */
export async function fetchStacGeoparquetItems(
  url: string,
): Promise<StacGeoparquetItem[]> {
  const file = await asyncBufferFromUrl({ url });
  const rows = await parquetReadObjects({
    file,
    columns: ["id", "bbox", "assets"],
    compressors,
  });
  return rows.map((row) => {
    const { id, bbox, assets } = row as {
      id: string;
      bbox: { xmin: number; ymin: number; xmax: number; ymax: number };
      assets: StacAssets;
    };
    return {
      id,
      bbox: [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax],
      assets,
    };
  });
}
