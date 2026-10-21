import type { RasterArray } from "@developmentseed/geotiff";
import { levelFor, resolveStoryTile } from "../src/scene/geometry.js";
import type { SceneData } from "../src/scene/load.js";

/** A single-band array whose value at (x, y) is `value(x, y)`. */
export function fakeArray(
  width: number,
  height: number,
  value: (x: number, y: number) => number = () => 0,
): RasterArray {
  const data = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = value(x, y);
    }
  }
  return {
    layout: "pixel-interleaved",
    data,
    count: 1,
    width,
    height,
    mask: null,
    transform: [1, 0, 0, 0, -1, 0],
    crs: 32718,
    nodata: 0,
  };
}

/**
 * Scene data with the real story tile (from the real functions) and blank
 * arrays of the right sizes. No network.
 */
export function fakeScene(): SceneData {
  const tile = resolveStoryTile({
    b04: levelFor("b04"),
    b11: levelFor("b11"),
    b01: levelFor("b01"),
  });
  const piece = (x: number, y: number) => ({
    x,
    y,
    array: fakeArray(256, 256),
  });
  return {
    tile,
    fetched: {
      b04: [{ x: 4, y: 4, array: fakeArray(1024, 1024) }],
      b11: [{ x: 2, y: 2, array: fakeArray(1024, 1024) }],
      b01: [piece(2, 2), piece(3, 2), piece(2, 3), piece(3, 3)],
    },
    stitched: {
      b04: fakeArray(1024, 1024),
      b11: fakeArray(1024, 1024),
      b01: fakeArray(512, 512),
    },
    overview: {
      b04: fakeArray(687, 687),
      b11: fakeArray(687, 687),
      b01: fakeArray(229, 229),
    },
  };
}
