import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

export type StacAssets = Record<string, { href: string }>;

export type StacGeoparquetItem = {
  id: string;
  bbox: [number, number, number, number];
  assets: StacAssets;
};

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
