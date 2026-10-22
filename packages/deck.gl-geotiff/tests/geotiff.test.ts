import type {
  RasterArray,
  RasterArrayBandSeparate,
} from "@developmentseed/geotiff";
import { describe, expect, it } from "vitest";
import { addAlphaChannel } from "../src/geotiff/geotiff.js";

/** A band-separate raster holding one array per band, two pixels wide. */
function bandSeparate(
  bands: number[][],
  ArrayType: new (values: number[]) => Uint8Array | Uint16Array = Uint8Array,
): RasterArrayBandSeparate {
  return {
    layout: "band-separate",
    count: bands.length,
    width: bands[0]!.length,
    height: 1,
    mask: null,
    bands: bands.map((band) => new ArrayType(band)),
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

  it("adds an opaque fourth band to a band-separate RGB array", () => {
    const rgba = addAlphaChannel(
      bandSeparate([
        [1, 4],
        [2, 5],
        [3, 6],
      ]),
    );

    expect(rgba.layout).toEqual("band-separate");
    expect(rgba.count).toEqual(4);
    expect(rgba.bands.map((band) => Array.from(band))).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
      [255, 255],
    ]);
  });

  it("adds a 16-bit opaque band to a band-separate uint16 RGB array", () => {
    const rgba = addAlphaChannel(
      bandSeparate(
        [
          [1, 4],
          [2, 5],
          [3, 6],
        ],
        Uint16Array,
      ),
    );

    expect(Array.from(rgba.bands[3]!)).toEqual([65535, 65535]);
  });

  it("returns a band-separate RGBA array unchanged", () => {
    const rgba = bandSeparate([
      [1, 5],
      [2, 6],
      [3, 7],
      [0, 255],
    ]);

    expect(addAlphaChannel(rgba)).toBe(rgba);
  });
});
