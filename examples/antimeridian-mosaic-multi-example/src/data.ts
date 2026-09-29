import { fetchStacGeoparquetItems } from "deck.gl-raster-examples-shared";

/** Minimal per-item shape this example needs — id, bbox, and R/G/B asset URLs. */
export type GeomadItem = {
  id: string;
  bbox: [number, number, number, number];
  assets: { red: string; green: string; blue: string };
};

const PARQUET_URL =
  "https://s3.us-west-2.amazonaws.com/dep-public-staging/dep_ls_geomad/0-3-1-test/dep_ls_geomad.parquet";

/**
 * Fetch every item in the DEP Landsat GeoMAD test catalog (a 4×3 grid, 12
 * items) from its STAC-geoparquet and pull out just what this example needs.
 * The 3 items at column `066` cross the antimeridian; the other 9 don't.
 *
 * The STAC bbox for a crossing item is GeoJSON-flipped (RFC 7946 §5.2: crosses
 * ±180° → xmin > xmax, e.g. `066/022`'s `179.97, -179.17`) — passed straight
 * through here; `MosaicLayer` unwraps a flipped bbox onto a continuous frame
 * internally.
 */
export async function fetchGeomadItems(): Promise<GeomadItem[]> {
  const items = await fetchStacGeoparquetItems(PARQUET_URL);
  return items.map(({ id, bbox, assets }) => ({
    id,
    bbox,
    assets: {
      red: assets.red!.href,
      green: assets.green!.href,
      blue: assets.blue!.href,
    },
  }));
}
