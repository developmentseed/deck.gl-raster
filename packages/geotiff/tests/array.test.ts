import type { Affine } from "@developmentseed/affine";
import { describe, expect, it } from "vitest";
import type { BandRasterArray, PixelRasterArray } from "../src/array.js";
import {
  packBandsToRGBA,
  reorderBands,
  toBandSeparate,
  toPixelInterleaved,
} from "../src/array.js";
import type { GeographicCRS } from "../src/crs.js";

const EPSG_4326: GeographicCRS = {
  $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
  type: "GeographicCRS",
  name: "WGS 84",
  datum_ensemble: {
    name: "World Geodetic System 1984 ensemble",
    members: [
      { name: "World Geodetic System 1984 (Transit)", id: { authority: "EPSG", code: 1166 } },
      { name: "World Geodetic System 1984 (G730)", id: { authority: "EPSG", code: 1152 } },
      { name: "World Geodetic System 1984 (G873)", id: { authority: "EPSG", code: 1153 } },
      { name: "World Geodetic System 1984 (G1150)", id: { authority: "EPSG", code: 1154 } },
      { name: "World Geodetic System 1984 (G1674)", id: { authority: "EPSG", code: 1155 } },
      { name: "World Geodetic System 1984 (G1762)", id: { authority: "EPSG", code: 1156 } },
      { name: "World Geodetic System 1984 (G2139)", id: { authority: "EPSG", code: 1309 } },
      { name: "World Geodetic System 1984 (G2296)", id: { authority: "EPSG", code: 1383 } },
    ],
    ellipsoid: { name: "WGS 84", semi_major_axis: 6378137, inverse_flattening: 298.257223563 },
    accuracy: "2.0",
    id: { authority: "EPSG", code: 6326 },
  },
  coordinate_system: {
    subtype: "ellipsoidal",
    axis: [
      { name: "Geodetic latitude", abbreviation: "Lat", direction: "north", unit: "degree" },
      { name: "Geodetic longitude", abbreviation: "Lon", direction: "east", unit: "degree" },
    ],
  },
};

function baseMetadata() {
  return {
    width: 2,
    height: 2,
    transform: [1, 0, 0, 0, -1, 0] as Affine,
    crs: EPSG_4326,
    nodata: null,
    mask: null,
  };
}

describe("RasterArray helpers", () => {
  it("converts band-separate data to pixel-interleaved", () => {
    const raster: BandRasterArray = {
      ...baseMetadata(),
      layout: "band-separate",
      count: 3,
      bands: [
        new Uint16Array([1, 2, 3, 4]),
        new Uint16Array([10, 20, 30, 40]),
        new Uint16Array([100, 200, 300, 400]),
      ],
    };

    const interleaved = toPixelInterleaved(raster);
    expect(interleaved.layout).toBe("pixel-interleaved");
    expect(Array.from(interleaved.data)).toEqual([
      1, 10, 100, 2, 20, 200, 3, 30, 300, 4, 40, 400,
    ]);
  });

  it("converts pixel-interleaved data to band-separate", () => {
    const raster: PixelRasterArray = {
      ...baseMetadata(),
      layout: "pixel-interleaved",
      count: 3,
      data: new Uint16Array([1, 10, 100, 2, 20, 200, 3, 30, 300, 4, 40, 400]),
    };

    const planar = toBandSeparate(raster);
    expect(planar.layout).toBe("band-separate");
    expect(Array.from(planar.bands[0]!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(planar.bands[1]!)).toEqual([10, 20, 30, 40]);
    expect(Array.from(planar.bands[2]!)).toEqual([100, 200, 300, 400]);
  });

  it("reorders bands without repacking to pixel layout", () => {
    const raster: BandRasterArray = {
      ...baseMetadata(),
      layout: "band-separate",
      count: 3,
      bands: [
        new Uint8Array([1, 2, 3, 4]),
        new Uint8Array([10, 20, 30, 40]),
        new Uint8Array([100, 110, 120, 130]),
      ],
    };

    const reordered = reorderBands(raster, [2, 0, 1]);
    expect(reordered.count).toBe(3);
    expect(Array.from(reordered.bands[0]!)).toEqual([100, 110, 120, 130]);
    expect(Array.from(reordered.bands[1]!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(reordered.bands[2]!)).toEqual([10, 20, 30, 40]);
  });

  it("packs selected bands to RGBA", () => {
    const raster: BandRasterArray = {
      ...baseMetadata(),
      layout: "band-separate",
      count: 3,
      bands: [
        new Uint8Array([1, 2, 3, 4]),
        new Uint8Array([10, 20, 30, 40]),
        new Uint8Array([100, 110, 120, 130]),
      ],
    };

    const packed = packBandsToRGBA(raster, {
      order: [2, 1, 0, null],
      fillValue: 255,
    });

    expect(packed.layout).toBe("pixel-interleaved");
    expect(packed.count).toBe(4);
    expect(Array.from(packed.data)).toEqual([
      100, 10, 1, 255, 110, 20, 2, 255, 120, 30, 3, 255, 130, 40, 4, 255,
    ]);
  });
});
