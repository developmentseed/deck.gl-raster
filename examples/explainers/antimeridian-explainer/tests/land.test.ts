import { describe, expect, it } from "vitest";
import { landInRange, landToCommon, loadLand } from "../src/scene/land.js";

/** A GeoJSON land layer with one square island at 179°E-179.5°E, 51°N-52°N. */
const island = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [179, 51],
            [179.5, 51],
            [179.5, 52],
            [179, 52],
            [179, 51],
          ],
        ],
      },
    },
  ],
};

describe("landToCommon", () => {
  it("places land in Web Mercator common space, one world 0-512 wide", () => {
    const [polygon] = landToCommon(island);
    const [x, y] = polygon!.rings[0]![0]!;
    expect(x).toBeCloseTo(((179 + 180) / 360) * 512, 9);
    const mercator =
      256 +
      (256 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (51 * Math.PI) / 360));
    expect(y).toBeCloseTo(mercator, 9);
  });
});

describe("landInRange", () => {
  it("brings in the copy one world west for a view past -180°", () => {
    const land = landToCommon(island);
    const near = landInRange(land, [-10, 10]);
    expect(near).toHaveLength(1);
    const xs = near[0]![0]!.map(([x]) => x);
    expect(Math.max(...xs)).toBeLessThan(0);
  });

  it("leaves out land the view doesn't reach", () => {
    expect(landInRange(landToCommon(island), [100, 200])).toHaveLength(0);
  });
});

describe("loadLand", () => {
  it("names the file when it can't be read", async () => {
    const fetchFails = async () => new Response("nope", { status: 404 });
    await expect(loadLand({ fetch: fetchFails })).rejects.toThrow(
      /Couldn't load ne_50m_land\.geojson: 404/,
    );
  });
});
