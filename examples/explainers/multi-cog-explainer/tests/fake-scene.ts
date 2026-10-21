import type { AffineTilesetLevel } from "@developmentseed/deck.gl-raster";
import type { RasterArray } from "@developmentseed/geotiff";
import type { BandId } from "../src/scene/constants.js";
import { BANDS, SCENE_ORIGIN } from "../src/scene/constants.js";
import type { ImageGeometry } from "../src/scene/geometry.js";
import {
  imagesByLevel,
  levelFor,
  resolveStoryTile,
} from "../src/scene/geometry.js";
import type { SceneData } from "../src/scene/load.js";

/** Each band's overview widths, finest first, as in the files on AWS. */
const OVERVIEW_WIDTHS: Record<BandId, number[]> = {
  b04: [5490, 2745, 1373, 687],
  b11: [2745, 1373, 687],
  b01: [915, 458, 229],
};

/**
 * A band's levels, coarsest first, from the real files' sizes, built the way
 * `loadScene` builds them from the files.
 */
export function fakeLevels(band: BandId): AffineTilesetLevel[] {
  const spec = BANDS[band];
  const image = (width: number, block: number): ImageGeometry => {
    const pixelSize = (spec.size * spec.pixelSize) / width;
    return {
      width,
      height: width,
      tileWidth: block,
      tileHeight: block,
      transform: [
        pixelSize,
        0,
        SCENE_ORIGIN[0],
        0,
        -pixelSize,
        SCENE_ORIGIN[1],
      ],
    };
  };
  const full = {
    ...image(spec.size, spec.block),
    overviews: OVERVIEW_WIDTHS[band].map((width) =>
      image(width, spec.overviewBlock),
    ),
  };
  return imagesByLevel(full).map((level) => levelFor(band, level));
}

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
    b04: fakeLevels("b04"),
    b11: fakeLevels("b11"),
    b01: fakeLevels("b01"),
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
