import type { RasterModule } from "@developmentseed/deck.gl-raster";
import type { GeoTIFF } from "@developmentseed/geotiff";
import { describe, expect, it } from "vitest";
import { inferRenderPipeline } from "../src/geotiff/render-pipeline";
import { loadGeoTIFF } from "./helpers.js";

const MOCK_DEVICE = {
  createTexture: (x: any) => x,
};
const MOCK_RENDER_TILE_DATA = {
  texture: {},
};

function _createRenderPipeline(geotiff: GeoTIFF): RasterModule[] {
  const { getTileData: _, renderTile } = inferRenderPipeline(
    geotiff,
    MOCK_DEVICE as any,
  );
  return renderTile(MOCK_RENDER_TILE_DATA as any).renderPipeline!;
}

describe("land cover, single-band uint8", async () => {
  const geotiff = await loadGeoTIFF("nlcd_landcover", "nlcd");

  it("generates correct render pipeline", () => {
    const renderPipeline = _createRenderPipeline(geotiff);

    expect(renderPipeline[0]?.module.name).toEqual("create-texture-unorm");

    expect(renderPipeline[1]?.module.name).toEqual("nodata");
    expect(renderPipeline[1]?.props?.value).toEqual(250 / 255.0);

    expect(renderPipeline[2]?.module.name).toEqual("colormap");
    expect(renderPipeline[2]?.props?.colormapTexture).toBeDefined();
  });
});

describe("RGB with mask", async () => {
  const geotiff = await loadGeoTIFF(
    "maxar_opendata_yellowstone_visual",
    "vantor",
  );

  it("generates correct render pipeline", () => {
    const renderPipeline = _createRenderPipeline(geotiff);

    expect(renderPipeline[0]?.module.name).toEqual("create-texture-unorm");
    expect(renderPipeline[1]?.module.name).toEqual("mask-texture");
  });
});
