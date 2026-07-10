export type BandStatistics = {
  max: number | null;
  min: number | null;
  mean: number | null;
  std: number | null;
  validPercent: number | null;
};

export type GDALMetadata = {
  /** Mapping of 1-based band index to statistics. */
  bandStatistics: Map<number, BandStatistics>;
  offsets: number[];
  scales: number[];
};

export function parseGDALMetadata(
  gdalMetadata: string | null | undefined,
  { count }: { count: number },
): GDALMetadata | null {
  if (gdalMetadata == null) {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(gdalMetadata, "text/xml");
  const root = doc.documentElement;

  if (root.tagName !== "GDALMetadata") {
    throw new Error("Not a GDALMetadata XML block");
  }

  const bandStatistics = new Map<number, BandStatistics>();
  const offsets = Array<number>(count).fill(0);
  const scales = Array<number>(count).fill(1);

  const getOrCreateBand = (sample: string): BandStatistics => {
    const idx = parseInt(sample, 10) + 1; // 1-based
    if (!bandStatistics.has(idx)) {
      bandStatistics.set(idx, {
        max: null,
        min: null,
        mean: null,
        std: null,
        validPercent: null,
      });
    }
    return bandStatistics.get(idx)!;
  };

  for (const elem of Array.from(root.querySelectorAll("Item"))) {
    const name = elem.getAttribute("name");
    const sample = elem.getAttribute("sample");
    const text = elem.textContent ?? "";

    if (sample === null) {
      continue;
    }

    switch (name) {
      case "STATISTICS_MAXIMUM":
        getOrCreateBand(sample).max = parseFloat(text);
        break;
      case "STATISTICS_MEAN":
        getOrCreateBand(sample).mean = parseFloat(text);
        break;
      case "STATISTICS_MINIMUM":
        getOrCreateBand(sample).min = parseFloat(text);
        break;
      case "STATISTICS_STDDEV":
        getOrCreateBand(sample).std = parseFloat(text);
        break;
      case "STATISTICS_VALID_PERCENT":
        getOrCreateBand(sample).validPercent = parseFloat(text);
        break;
      case "OFFSET":
        offsets[parseInt(sample, 10)] = parseFloat(text);
        break;
      case "SCALE":
        scales[parseInt(sample, 10)] = parseFloat(text);
        break;
    }
  }

  return { bandStatistics, offsets, scales };
}
