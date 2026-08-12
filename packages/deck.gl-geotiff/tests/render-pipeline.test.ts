import type { RasterModule } from "@developmentseed/deck.gl-raster";
import type { GeoTIFF } from "@developmentseed/geotiff";
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

describe("band-separate tiles", () => {
  /**
   * A PlanarConfiguration=2 tile, as `fetchTile` decodes one: a separate array
   * per band. Handed to `getTileData` directly rather than read from a fixture,
   * because the only band-separate fixture is int8, which
   * `inferRenderPipeline` does not build a pipeline for.
   */
  function bandSeparateTile(bandCount: number) {
    return {
      array: {
        layout: "band-separate" as const,
        count: bandCount,
        width: 2,
        height: 1,
        mask: null,
        // Band b holds [b, b + bandCount], so an interleaved result reads
        // 0, 1, .., bandCount - 1, bandCount, ..
        bands: Array.from(
          { length: bandCount },
          (_, b) => new Uint8Array([b, b + bandCount]),
        ),
      },
    };
  }

  async function _getTileData(geotiff: GeoTIFF, bandCount: number) {
    const { getTileData } = inferRenderPipeline(geotiff, MOCK_DEVICE as any);
    const image = { fetchTile: async () => bandSeparateTile(bandCount) };
    return await getTileData(
      image as any,
      {
        device: MOCK_DEVICE,
        x: 0,
        y: 0,
      } as any,
    );
  }

  it("interleaves an RGBA tile into a single texture", async () => {
    const geotiff = await loadGeoTIFF("cog_uint8_rgba", "rasterio");

    const { texture, width, height } = await _getTileData(geotiff, 4);

    expect((texture as any).format).toEqual("rgba8unorm");
    expect(Array.from((texture as any).data)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(width).toEqual(2);
    expect(height).toEqual(1);
  });

  // WebGL2 has no RGB-only texture format, so a 3-band tile is interleaved and
  // then padded to RGBA, same as a pixel-interleaved one
  it("interleaves and pads an RGB tile", async () => {
    const geotiff = await loadGeoTIFF(
      "uint8_rgb_deflate_block64_cog",
      "rasterio",
    );

    const { texture } = await _getTileData(geotiff, 3);

    expect((texture as any).format).toEqual("rgba8unorm");
    expect(Array.from((texture as any).data)).toEqual([
      0, 1, 2, 255, 3, 4, 5, 255,
    ]);
  });
});
