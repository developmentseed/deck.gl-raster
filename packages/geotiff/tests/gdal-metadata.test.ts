import { describe, expect, it } from "vitest";
import { loadGeoTIFF } from "./helpers.js";

describe("test gdal metadata", () => {
  it("parses correct stats", async () => {
    const geotiff = await loadGeoTIFF("cog_rgb_with_stats", "rio-tiler");
    const expected = new Map([
      [
        1,
        {
          max: 254,
          min: 0,
          mean: 99.615906635455,
          std: 55.811140352764,
          validPercent: 100,
        },
      ],
      [
        2,
        {
          max: 254,
          min: 0,
          mean: 108.65261771856,
          std: 50.561053632253,
          validPercent: 100,
        },
      ],
      [
        3,
        {
          max: 252,
          min: 0,
          mean: 110.68376924462,
          std: 38.462500582021,
          validPercent: 100,
        },
      ],
    ]);
    expect(geotiff.storedStats).toEqual(expected);
  });

  it("parses correct scales and offsets", async () => {
    const geotiff = await loadGeoTIFF("uint16_1band_scale_offset", "rasterio");
    expect(geotiff.scales).toEqual([0.01]);
    expect(geotiff.offsets).toEqual([100]);
  });
});
