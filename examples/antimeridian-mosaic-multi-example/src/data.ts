/** Minimal per-item shape this example needs — id, bbox, and R/G/B asset URLs. */
export type GeomadItem = {
  id: string;
  bbox: [number, number, number, number];
  assets: { red: string; green: string; blue: string };
};

const BASE =
  "https://s3.us-west-2.amazonaws.com/dep-public-staging/dep_ls_geomad/0-3-1-test";

// TODO: Get this from the stac items, not the r g b asset urls. e.g. https://s3.us-west-2.amazonaws.com/dep-public-staging/dep_ls_geomad/0-3-1-test/064/020/2025/dep_ls_geomad_064_020_2025.stac-item.json
// Actually the stac-geoparquet. https://s3.us-west-2.amazonaws.com/dep-public-staging/dep_ls_geomad/0-3-1-test/dep_ls_geomad.parquet

export const GEOMAD_ITEMS: GeomadItem[] = [
  {
    id: "dep_ls_geomad_064_020_2025",
    // Ordinary STAC bbox — doesn't cross the antimeridian.
    bbox: [
      178.24303253271776, -18.47766942595451, 179.1054152054725,
      -17.65281330691017,
    ],
    assets: {
      red: `${BASE}/064/020/2025/dep_ls_geomad_064_020_2025_red.tif`,
      green: `${BASE}/064/020/2025/dep_ls_geomad_064_020_2025_green.tif`,
      blue: `${BASE}/064/020/2025/dep_ls_geomad_064_020_2025_blue.tif`,
    },
  },
  {
    id: "dep_ls_geomad_066_022_2025",
    // The STAC bbox for this item is GeoJSON-flipped (RFC 7946 §5.2: crosses
    // ±180° → xmin=179.97 > xmax=-179.17). MosaicLayer's spatial index
    // (Flatbush) is a plain numeric R-tree with no antimeridian awareness —
    // a flipped bbox (minX > maxX) doesn't mean anything to it. Unwrap onto
    // a continuous frame instead (same convention as antimeridian-cut.ts's
    // `unwrapEastLng`): xmax = −179.169819 + 360 = 180.830181.
    bbox: [179.9677978782272, -16.8241145, 180.830180550982, -15.991730594839623],
    assets: {
      red: `${BASE}/066/022/2025/dep_ls_geomad_066_022_2025_red.tif`,
      green: `${BASE}/066/022/2025/dep_ls_geomad_066_022_2025_green.tif`,
      blue: `${BASE}/066/022/2025/dep_ls_geomad_066_022_2025_blue.tif`,
    },
  },
];
