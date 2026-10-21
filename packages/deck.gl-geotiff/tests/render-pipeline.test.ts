import type { RasterModule } from "@developmentseed/deck.gl-raster";
import type { CachedTags, GeoTIFF } from "@developmentseed/geotiff";
import { describe, expect, it } from "vitest";
import { inferRenderPipeline } from "../src/geotiff/render-pipeline.js";
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

/** The modules' names, in pipeline order. */
function moduleNames(renderPipeline: RasterModule[]): string[] {
  return renderPipeline.map((m) => m.module.name);
}

/** The same GeoTIFF, with its ExtraSamples tag replaced. */
function withExtraSamples(
  geotiff: GeoTIFF,
  extraSamples: CachedTags["extraSamples"],
): GeoTIFF {
  return Object.create(geotiff, {
    cachedTags: { value: { ...geotiff.cachedTags, extraSamples } },
  });
}

describe("RGB plus an alpha band", async () => {
  const geotiff = await loadGeoTIFF("cog_uint8_rgba", "rasterio");

  it("takes alpha from the fourth band", () => {
    expect(moduleNames(_createRenderPipeline(geotiff))).toEqual([
      "create-texture-unorm",
    ]);
  });
});

describe("RGB plus a fourth band that isn't alpha", async () => {
  // NAIP's layout: red, green, blue and near-infrared, where ExtraSamples is
  // 0 (unspecified) rather than alpha.
  const geotiff = withExtraSamples(
    await loadGeoTIFF("cog_uint8_rgba", "rasterio"),
    [0],
  );

  it("draws the image opaque", () => {
    expect(moduleNames(_createRenderPipeline(geotiff))).toEqual([
      "create-texture-unorm",
      "opaque",
    ]);
  });
});

describe("gray plus an alpha band", async () => {
  const geotiff = await loadGeoTIFF(
    "uint8_1band_and_alpha_deflate_block64_cog",
    "rasterio",
  );

  it("moves the alpha band into alpha before converting gray to RGB", () => {
    expect(moduleNames(_createRenderPipeline(geotiff))).toEqual([
      "create-texture-unorm",
      "gray-alpha",
      "nodata",
      "black-is-zero",
    ]);
  });
});

describe("gray plus a second band that isn't alpha", async () => {
  const geotiff = withExtraSamples(
    await loadGeoTIFF("uint8_1band_and_alpha_deflate_block64_cog", "rasterio"),
    [0],
  );

  it("draws the gray band without taking alpha from the second band", () => {
    expect(moduleNames(_createRenderPipeline(geotiff))).toEqual([
      "create-texture-unorm",
      "nodata",
      "black-is-zero",
    ]);
  });
});

describe("land cover, single-band uint8", async () => {
  const geotiff = await loadGeoTIFF("nlcd_landcover", "nlcd");

  it("generates correct render pipeline", () => {
    const renderPipeline = _createRenderPipeline(geotiff);

    expect(renderPipeline[0]?.module.name).toEqual("create-texture-unorm");

    expect(renderPipeline[1]?.module.name).toEqual("nodata");
    expect(renderPipeline[1]?.props?.value).toEqual(250 / 255.0);

    expect(renderPipeline[2]?.module.name).toEqual("colormap");
    const cmapTexture = renderPipeline[2]?.props?.colormapTexture as any;
    expect(cmapTexture).toBeDefined();
    // Colormap shader module samples a sampler2DArray, so the texture must be
    // created as a 2d-array (with depth=1 for a single Palette colormap).
    expect(cmapTexture.dimension).toEqual("2d-array");
    expect(cmapTexture.depth).toEqual(1);
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
