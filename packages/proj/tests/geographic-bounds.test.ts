import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import type { Point } from "../src/index.js";
import { geographicBounds } from "../src/index.js";

const UTM_60N = "+proj=utm +zone=60 +datum=WGS84 +units=m +no_defs";

/** The projection function from `crs` to WGS84. */
function to4326(crs: string) {
  const converter = proj4(crs, "EPSG:4326");
  return (x: number, y: number) => converter.forward<Point>([x, y]);
}

/** For rings already in longitude and latitude. */
const identity = (x: number, y: number): Point => [x, y];

/** The corners of a box, in order around it. */
function box(minX: number, minY: number, maxX: number, maxY: number): Point[] {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

describe("geographicBounds", () => {
  it("bounds a ring across the antimeridian the short way", () => {
    // UTM 60N is centered on 177°E, so 400 km east of it is past 180°
    const ring = box(400000, 4000000, 900000, 4100000);
    const [west, south, east, north] = geographicBounds(ring, to4326(UTM_60N));

    expect(west).toBeCloseTo(175.8755, 4);
    // proj4 gives 178.5080°W, written as 181.4920°
    expect(east).toBeCloseTo(181.492, 4);
    expect(south).toBeCloseTo(36.0624, 4);
    expect(north).toBeCloseTo(37.0409, 4);
  });

  it("moves a ring stored past -180° into the usual range", () => {
    expect(geographicBounds(box(-204, -10, -162, 10), identity)).toEqual([
      156, -10, 198, 10,
    ]);
  });

  it("keeps a ring all the way around the world from -180° to 180°", () => {
    expect(geographicBounds(box(-180, -90, 180, 90), identity)).toEqual([
      -180, -90, 180, 90,
    ]);
  });

  it("bounds the corners of a ring that isn't a box", () => {
    const diamond: Point[] = [
      [0, -10],
      [10, 0],
      [0, 10],
      [-10, 0],
    ];
    expect(geographicBounds(diamond, identity)).toEqual([-10, -10, 10, 10]);
  });
});
