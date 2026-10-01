import { fetchStacGeoparquetItems } from "./stac-geoparquet.js";

export type GeomadItem = {
  id: string;
  bbox: [number, number, number, number];
  assets: { red: string; green: string; blue: string };
};

const PARQUET_URL =
  "https://s3.us-west-2.amazonaws.com/dep-public-staging/dep_ls_geomad/0-3-1-test/dep_ls_geomad.parquet";

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
