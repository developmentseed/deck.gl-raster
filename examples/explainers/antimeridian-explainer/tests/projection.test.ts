import { describe, expect, it } from "vitest";
import { makeProjection } from "../src/scene/projection.js";
import { fakeImage } from "./fake-image.js";

/** Where a pixel lands in common space, through the projection. */
async function commonAt(px: number, py: number) {
  const { fns } = await makeProjection(fakeImage());
  return fns.forwardReproject(...fns.forwardTransform(px, py));
}

describe("makeProjection", () => {
  it("puts the image's center just east of the world's west edge", async () => {
    const [x] = await commonAt(21, 21);
    expect(x).toBeCloseTo(0.3045, 3);
  });

  it("puts the NW corner at the world's east edge, as proj4 returns it", async () => {
    const [x] = await commonAt(0, 0);
    expect(x).toBeCloseTo(503.18, 2);
  });

  it("gives the NW corner's longitude and latitude", async () => {
    const { fns, toLngLat } = await makeProjection(fakeImage());
    const [lng, lat] = toLngLat(...fns.forwardTransform(0, 0));
    expect(lng).toBeCloseTo(173.8, 2);
    expect(lat).toBeCloseTo(55.904, 2);
  });
});
