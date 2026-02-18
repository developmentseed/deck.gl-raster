import { Photometric, SampleFormat } from "@cogeotiff/core";
import type { RasterModule } from "@developmentseed/deck.gl-raster";
import type { GeoTIFF } from "@developmentseed/geotiff";
import { describe, expect, it } from "vitest";
import type { CachedTags } from "../../geotiff/dist/ifd";
import { inferRenderPipeline } from "../src/geotiff/render-pipeline";

const MOCK_DEVICE = {
  createTexture: (x: any) => x,
};
const MOCK_RENDER_TILE_DATA = {
  texture: {},
};

type RelevantImageFileDirectory = Pick<
  CachedTags,
  | "bitsPerSample"
  | "colorMap"
  | "nodata"
  | "photometric"
  | "sampleFormat"
  | "samplesPerPixel"
>;

describe("land cover, single-band uint8", () => {
  const ifd: RelevantImageFileDirectory = {
    bitsPerSample: new Uint16Array([8]),
    colorMap: new Uint16Array([
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
    nodata: 250,
    photometric: Photometric.Palette,
    sampleFormat: [SampleFormat.Uint],
    samplesPerPixel: 1,
  };
  const geotiff = {
    cachedTags: ifd,
  } as unknown as GeoTIFF;

  const { getTileData: _, renderTile } = inferRenderPipeline(
    geotiff,
    MOCK_DEVICE as any,
  );
  const renderPipeline = renderTile(
    MOCK_RENDER_TILE_DATA as any,
  ) as RasterModule[];

  it("Test render pipeline inference", () => {
    expect(Array.isArray(renderPipeline)).toBeTruthy();
    expect(renderPipeline[0]?.module.name).toEqual("create-texture-unorm");

    expect(renderPipeline[1]?.module.name).toEqual("nodata");
    expect(renderPipeline[1]?.props?.value).toEqual(250 / 255.0);

    expect(renderPipeline[2]?.module.name).toEqual("colormap");
    expect(renderPipeline[2]?.props?.colormapTexture).toBeDefined();
  });
});
