import type {
  RasterArray,
  RasterArrayBandSeparate,
} from "@developmentseed/geotiff";
import { describe, expect, it } from "vitest";
import { addAlphaChannel } from "../src/geotiff/geotiff.js";

/** A band-separate raster holding one array per band, two pixels wide. */
function bandSeparate(bands: number[][]): RasterArrayBandSeparate {
  return {
    layout: "band-separate",
    count: bands.length,
    width: bands[0]!.length,
    height: 1,
    mask: null,
    bands: bands.map((band) => new Uint8Array(band)),
  } as RasterArrayBandSeparate;
}

describe("addAlphaChannel", () => {
  it("pads a pixel-interleaved RGB array", () => {
    const rgb = {
      layout: "pixel-interleaved",
      count: 3,
      width: 2,
      height: 1,
      mask: null,
      data: new Uint8Array([1, 2, 3, 4, 5, 6]),
    } as unknown as RasterArray;

    const rgba = addAlphaChannel(rgb);

    expect(rgba.count).toEqual(4);
    expect(Array.from((rgba as any).data)).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255,
    ]);
  });

  it("interleaves a band-separate RGB array before padding it", () => {
    const rgba = addAlphaChannel(
      bandSeparate([
        [1, 4],
        [2, 5],
        [3, 6],
      ]),
    );

    expect(rgba.layout).toEqual("pixel-interleaved");
    expect(rgba.count).toEqual(4);
    expect(Array.from((rgba as any).data)).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255,
    ]);
  });

  // Already four channels, so there is nothing to pad - only to interleave
  it("interleaves a band-separate RGBA array unchanged", () => {
    const rgba = addAlphaChannel(
      bandSeparate([
        [1, 5],
        [2, 6],
        [3, 7],
        [0, 255],
      ]),
    );

    expect(rgba.layout).toEqual("pixel-interleaved");
    expect(rgba.count).toEqual(4);
    expect(Array.from((rgba as any).data)).toEqual([1, 2, 3, 0, 5, 6, 7, 255]);
  });
});
