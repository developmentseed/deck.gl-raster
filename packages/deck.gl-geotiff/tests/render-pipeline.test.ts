import { assert } from "node:console";
import type { RasterModule } from "@developmentseed/deck.gl-raster";
import { globals } from "geotiff";
import { describe, expect, it } from "vitest";
import { inferRenderPipeline } from "../src/geotiff/render-pipeline";
import type { ImageFileDirectory } from "../src/geotiff/types";

const MOCK_DEVICE = {
  createTexture: (x: any) => x,
};
const MOCK_RENDER_TILE_DATA = {
  texture: {},
};

// import {} from "@"
type RelevantImageFileDirectory = Pick<
  ImageFileDirectory,
  | "BitsPerSample"
  | "ColorMap"
  | "GDAL_NODATA"
  | "PhotometricInterpretation"
  | "SampleFormat"
  | "SamplesPerPixel"
>;

describe("land cover, single-band uint8", () => {
  const ifd: RelevantImageFileDirectory = {
    BitsPerSample: new Uint16Array([8]),
    ColorMap: new Uint16Array([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 17990, 53713, 0, 0, 0, 0, 0, 0, 0, 0,
      57054, 55769, 60395, 43947, 0, 0, 0, 0, 0, 0, 46003, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 26728, 7196, 46517, 0, 0, 0, 0, 0, 0, 0, 0, 52428, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 57311, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      56540, 43947, 0, 0, 0, 0, 0, 0, 0, 47288, 0, 0, 0, 0, 27756, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 27499, 57054, 0, 0, 0,
      0, 0, 0, 0, 0, 50629, 37522, 0, 0, 0, 0, 0, 0, 0, 0, 44204, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 43947, 24415, 50629, 0, 0, 0, 0, 0, 0, 0, 0, 47288, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 57311, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 55769, 27756, 0, 0, 0, 0, 0, 0, 0, 55769, 0, 0, 0, 0, 40863, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40863, 63736, 0,
      0, 0, 0, 0, 0, 0, 0, 50629, 33410, 0, 0, 0, 0, 0, 0, 0, 0, 40863, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 24415, 11308, 36751, 0, 0, 0, 0, 0, 0, 0, 0, 31097, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 49858, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 14649, 10280, 0, 0, 0, 0, 0, 0, 0, 60395, 0, 0, 0, 0, 47288,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]),
    GDAL_NODATA: "250\u0000",
    PhotometricInterpretation: globals.photometricInterpretations.Palette,
    SampleFormat: new Uint16Array([1]),
    SamplesPerPixel: 1,
  };

  const { getTileData: _, renderTile } = inferRenderPipeline(
    ifd as ImageFileDirectory,
    MOCK_DEVICE as any,
  );
  const renderPipeline = renderTile(
    MOCK_RENDER_TILE_DATA as any,
  ) as RasterModule[];

  it("placeholder test", () => {
    expect(Array.isArray(renderPipeline)).toBeTruthy();
    expect(renderPipeline[0]?.module.name).toEqual("create-texture-unorm");

    expect(true).toBe(true);
  });
});
