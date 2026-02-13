import { describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import { mockImage, mockTiff } from "./helpers.js";

describe("Overview", () => {
  it("computes scaled transform from parent", async () => {
    const primary = mockImage({
      width: 1000,
      height: 1000,
      origin: [100, 200, 0],
      resolution: [0.01, -0.01, 0],
    });
    const ov = mockImage({ width: 500, height: 500 });

    const tiff = mockTiff([primary, ov]);
    const geo = await GeoTIFF.fromTiff(tiff);

    const ovTransform = geo.overviews[0]!.transform;
    // scale = 1000 / 500 = 2
    expect(ovTransform[0]).toBeCloseTo(0.02); // a * 2
    expect(ovTransform[4]).toBeCloseTo(-0.02); // e * 2
    // Origin unchanged
    expect(ovTransform[2]).toBe(100); // c
    expect(ovTransform[5]).toBe(200); // f
  });
});
