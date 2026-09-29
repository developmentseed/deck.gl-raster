/** Minimal per-item shape this example needs — id, bbox, and R/G/B asset URLs. */
export type GeomadItem = {
  id: string;
  bbox: [number, number, number, number];
  assets: { red: string; green: string; blue: string };
};

const BASE =
  "https://s3.us-west-2.amazonaws.com/dep-public-staging/dep_ls_geomad/0-3-1-test";

// Two items from the same DEP Landsat GeoMAD catalog: `064/020` doesn't cross
// the antimeridian, `066/022` does. Fetched from each item's own STAC item
// JSON below rather than hardcoding bbox/asset URLs.
const ITEM_PATHS = [
  "064/020/2025/dep_ls_geomad_064_020_2025",
  "066/022/2025/dep_ls_geomad_066_022_2025",
];

type StacItem = {
  bbox: [number, number, number, number];
  assets: Record<string, { href: string }>;
};

/**
 * Fetch each item's STAC item JSON and pull out just what this example needs.
 *
 * The STAC bbox for a crossing item is GeoJSON-flipped (RFC 7946 §5.2: crosses
 * ±180° → xmin > xmax, e.g. `066/022`'s `179.97, -179.17`). MosaicLayer's
 * spatial index (Flatbush) is a plain numeric R-tree with no antimeridian
 * awareness — a flipped bbox doesn't mean anything to it — so unwrap onto a
 * continuous frame instead (same convention as antimeridian-cut.ts's
 * `unwrapEastLng`): xmax = −179.169819 + 360 = 180.830181.
 */
export async function fetchGeomadItems(): Promise<GeomadItem[]> {
  return Promise.all(
    ITEM_PATHS.map(async (path) => {
      const res = await fetch(`${BASE}/${path}.stac-item.json`);
      const item: StacItem = await res.json();
      const [minX, minY, maxX, maxY] = item.bbox;
      return {
        id: path.split("/").pop()!,
        bbox: [minX, minY, maxX < minX ? maxX + 360 : maxX, maxY],
        assets: {
          red: item.assets.red!.href,
          green: item.assets.green!.href,
          blue: item.assets.blue!.href,
        },
      };
    }),
  );
}
