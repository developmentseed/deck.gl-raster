import assert from "node:assert";
import { describe, expect, it } from "vitest";
import { loadGeoTIFF } from "../../geotiff/tests/helpers.js";
import { inferRenderPipeline } from "../src/geotiff/render-pipeline";

const MOCK_DEVICE = {
  createTexture: (x: any) => x,
};
const MOCK_RENDER_TILE_DATA = {
  texture: {},
};

describe("land cover, single-band uint8", async () => {
  const geotiff = await loadGeoTIFF("nlcd_landcover", "nlcd");

  it("generates correct render pipeline", () => {
    const { getTileData: _, renderTile } = inferRenderPipeline(
      geotiff,
      MOCK_DEVICE as any,
    );
    const renderPipeline = renderTile(MOCK_RENDER_TILE_DATA as any);

    assert(!(renderPipeline instanceof ImageData));

    expect(Array.isArray(renderPipeline)).toBeTruthy();
    expect(renderPipeline[0]?.module.name).toEqual("create-texture-unorm");

    expect(renderPipeline[1]?.module.name).toEqual("nodata");
    expect(renderPipeline[1]?.props?.value).toEqual(250 / 255.0);

    expect(renderPipeline[2]?.module.name).toEqual("colormap");
    expect(renderPipeline[2]?.props?.colormapTexture).toBeDefined();
  });
});
