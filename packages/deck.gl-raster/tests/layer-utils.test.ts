import { describe, expect, it } from "vitest";
import { renderDebugTileOutline } from "../src/layer-utils.js";

describe("renderDebugTileOutline", () => {
  it("outlines a 72×4 global band in a 512×512 tile as a 360° equatorial box", () => {
    // EPSG:4326, 5° pixels, origin (−180, 10): the antimeridian_360 fixture.
    const tile = {
      index: { x: 0, y: 0, z: 0 },
      tileWidth: 512,
      tileHeight: 512,
      forwardTransform: (x: number, y: number) => [-180 + 5 * x, 10 - 5 * y],
    } as unknown as Parameters<typeof renderDebugTileOutline>[1];
    // Real projections hand back lon normalized to [−180, 180).
    const to4326 = (x: number, y: number): [number, number] => [
      ((((x + 180) % 360) + 360) % 360) - 180,
      y,
    ];

    const [outline] = renderDebugTileOutline("t", tile, to4326, {
      width: 72,
      height: 4,
    });
    const path = (outline!.props.data as number[][][])[0]!;
    const lons = path.map((p) => p[0]!);
    const lats = path.map((p) => p[1]!);
    expect(Math.max(...lons) - Math.min(...lons)).toBeCloseTo(360);
    expect(Math.min(...lats)).toBe(-10);
    expect(Math.max(...lats)).toBe(10);
  });
});
