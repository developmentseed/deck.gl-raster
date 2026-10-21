import type { Tile } from "@developmentseed/geotiff";
import { describe, expect, it } from "vitest";
import type { BandId } from "../src/scene/constants.js";
import { BANDS } from "../src/scene/constants.js";
import type { GeoTIFFLike, ImageLike } from "../src/scene/load.js";
import { checkBand, loadScene } from "../src/scene/load.js";

type FetchCall = { xy: [number, number][]; boundless: boolean | undefined };

/** A fake image of `size` pixels on `block` tiles, recording its fetches. */
function fakeImage(
  size: number,
  block: number,
  pixelSize: number,
  calls: FetchCall[],
  fail?: Error,
): ImageLike {
  return {
    width: size,
    height: size,
    tileWidth: block,
    tileHeight: block,
    transform: [pixelSize, 0, 600000, 0, -pixelSize, 4400020],
    fetchTiles: async (xy, options) => {
      calls.push({ xy, boundless: options?.boundless });
      if (fail) {
        throw fail;
      }
      return xy.map(([x, y]): Tile => {
        const width = Math.min(block, size - x * block);
        const height = Math.min(block, size - y * block);
        return {
          x,
          y,
          array: {
            layout: "pixel-interleaved",
            data: new Uint16Array(width * height),
            count: 1,
            width,
            height,
            mask: null,
            transform: [pixelSize, 0, 0, 0, -pixelSize, 0],
            crs: 32718,
            nodata: 0,
          },
        };
      });
    },
  };
}

/** Fakes of the three COGs, as the files on AWS store them. */
function fakeScene(failBand?: BandId) {
  const calls = { b04: [], b11: [], b01: [] } as Record<BandId, FetchCall[]>;
  const byFile = new Map<string, GeoTIFFLike>();
  for (const band of ["b04", "b11", "b01"] as const) {
    const spec = BANDS[band];
    const fail = band === failBand ? new Error("network down") : undefined;
    const overviewPixel = (spec.size * spec.pixelSize) / spec.overviewSize;
    byFile.set(spec.file, {
      ...fakeImage(spec.size, spec.block, spec.pixelSize, calls[band], fail),
      overviews: [
        fakeImage(
          spec.overviewSize,
          spec.overviewBlock,
          overviewPixel,
          calls[band],
        ),
      ],
    });
  }
  const open = async (url: string) => {
    const file = url.slice(url.lastIndexOf("/") + 1, -".tif".length);
    return byFile.get(file)!;
  };
  return { open, calls };
}

describe("checkBand", () => {
  it("names the band and the field when a file has changed", () => {
    const b01 = BANDS.b01;
    expect(() =>
      checkBand("b01", {
        width: b01.size,
        height: b01.size,
        tileWidth: 512,
        tileHeight: 512,
        transform: [60, 0, 600000, 0, -60, 4400020],
      }),
    ).toThrow(/B01: expected tileWidth 256, got 512/);
  });
});

describe("loadScene", () => {
  it("fetches the four 60 m tiles once, unpadded, and stitches them", async () => {
    const { open, calls } = fakeScene();
    const scene = await loadScene({ open });
    expect(calls.b01[0]).toEqual({
      xy: [
        [2, 2],
        [3, 2],
        [2, 3],
        [3, 3],
      ],
      boundless: false,
    });
    expect([scene.stitched.b01.width, scene.stitched.b01.height]).toEqual([
      512, 512,
    ]);
  });

  it("names the band whose fetch failed", async () => {
    const { open } = fakeScene("b11");
    await expect(loadScene({ open })).rejects.toThrow(/Couldn't load B11/);
  });
});
