import type { Tile } from "@developmentseed/geotiff";
import type { GeoTIFFLike, SourceImage } from "../src/scene/load.js";

type FetchCall = { xy: [number, number][]; boundless: boolean | undefined };

/** The fixture's values: 1 to 42, one per column (a west-to-east ramp). */
function rampValues(width: number, height: number): Uint8Array {
  const values = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      values[y * width + x] = x + 1;
    }
  }
  return values;
}

/**
 * A fake of `antimeridian_UTM_60N.tif` as `GeoTIFF.fromUrl` opens it, with
 * `overrides` for a changed file. Records its fetches.
 */
export function fakeGeoTIFF(
  overrides: Partial<Omit<GeoTIFFLike, "fetchTiles">> = {},
  fail?: Error,
) {
  const calls: FetchCall[] = [];
  const geotiff: GeoTIFFLike = {
    width: 42,
    height: 42,
    transform: [20000, 0, 300000, 0, -20000, 6200000],
    crs: 32660,
    ...overrides,
    fetchTiles: async (xy, options) => {
      calls.push({ xy, boundless: options?.boundless });
      if (fail) {
        throw fail;
      }
      return xy.map(
        ([x, y]): Tile => ({
          x,
          y,
          array: {
            layout: "pixel-interleaved",
            data: rampValues(42, 42),
            count: 1,
            width: 42,
            height: 42,
            mask: null,
            transform: [20000, 0, 300000, 0, -20000, 6200000],
            crs: 32660,
            nodata: 0,
          },
        }),
      );
    },
  };
  return { geotiff, calls };
}

/** The fixture as `loadImage` returns it. No network. */
export function fakeImage(): SourceImage {
  return {
    values: rampValues(42, 42),
    width: 42,
    height: 42,
    transform: [20000, 0, 300000, 0, -20000, 6200000],
    epsg: 32660,
  };
}
