import { describe, expect, it } from "vitest";
import { antimeridianCut } from "../../src/raster-tileset/antimeridian-cut.js";

// cornerLngs are WGS84 longitudes normalized to (−180, 180], as returned by
// descriptor.projectTo4326(corner)[0].
describe("antimeridianCut", () => {
  it("returns undefined for a non-crossing tile (west < east)", () => {
    expect(
      antimeridianCut({
        topLeft: 10,
        topRight: 20,
        bottomLeft: 10,
        bottomRight: 20,
      }),
    ).toBeUndefined();
  });

  it("locates a vertical cut for an axis-aligned crossing tile", () => {
    // antimeridian.tif: west edge lng −204° → normalized 156°; east edge −162°.
    const cut = antimeridianCut({
      topLeft: 156,
      topRight: -162,
      bottomLeft: 156,
      bottomRight: -162,
    });
    expect(cut).toBeDefined();
    // from 156° east to +180° is 24°; from −180° to −162° is 18°; total 42°.
    expect(cut?.uCut).toBeCloseTo(24 / 42, 9);
  });

  it("returns undefined for a slanted (non-vertical) crossing cut", () => {
    // top and bottom edges cross the antimeridian at different u → not vertical.
    expect(
      antimeridianCut({
        topLeft: 156,
        topRight: -162,
        bottomLeft: 170,
        bottomRight: -150,
      }),
    ).toBeUndefined();
  });
});
