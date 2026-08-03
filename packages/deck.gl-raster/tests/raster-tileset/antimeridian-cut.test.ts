import { describe, expect, it } from "vitest";
import { antimeridianCut } from "../../src/raster-tileset/antimeridian-cut.js";

// cornerLngs are WGS84 longitudes as returned by
// descriptor.projectTo4326(corner)[0] — native and NOT normalized to
// (−180, 180]. For a north-up geotransform, west < east always (proj4
// 4326→4326 is identity), so a crossing tile shows up as e.g. (−204, −162),
// not (156, −162).
describe("antimeridianCut", () => {
  it("returns undefined for a non-crossing tile (west < east, no seam inside)", () => {
    expect(
      antimeridianCut({
        topLeft: 10,
        topRight: 20,
        bottomLeft: 10,
        bottomRight: 20,
      }),
    ).toBeUndefined();
  });

  it("locates a vertical cut for an axis-aligned crossing tile (native un-normalized lngs)", () => {
    // antimeridian.tif: ModelTiepoint origin lng −204°, east edge −162°.
    const cut = antimeridianCut({
      topLeft: -204,
      topRight: -162,
      bottomLeft: -204,
      bottomRight: -162,
    });
    expect(cut).toBeDefined();
    // The −180° seam is at (−180 − (−204)) / (−162 − (−204)) = 24/42 of the
    // edge span.
    expect(cut?.uCut).toBeCloseTo(24 / 42, 9);
  });

  it("locates the cut equivalently for an in-range crossing span (170, 190)", () => {
    const cut = antimeridianCut({
      topLeft: 170,
      topRight: 190,
      bottomLeft: 170,
      bottomRight: 190,
    });
    expect(cut?.uCut).toBeCloseTo(0.5, 9);
  });

  it("returns undefined for a slanted (non-vertical) crossing cut", () => {
    // Top edge crosses at u = 24/42 ≈ 0.571; bottom edge at u = 10/40 = 0.25.
    expect(
      antimeridianCut({
        topLeft: -204,
        topRight: -162,
        bottomLeft: -190,
        bottomRight: -150,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when a corner lies exactly on the antimeridian (boundary, non-crossing)", () => {
    // Strict-inequality seam-finding treats edges that *touch* ±180 as
    // non-crossing (the seam is not strictly interior), avoiding a degenerate
    // uCut of 0 or 1.
    expect(
      antimeridianCut({
        topLeft: 160,
        topRight: 180,
        bottomLeft: 160,
        bottomRight: 180,
      }),
    ).toBeUndefined();
    expect(
      antimeridianCut({
        topLeft: -180,
        topRight: -160,
        bottomLeft: -180,
        bottomRight: -160,
      }),
    ).toBeUndefined();
  });
});
