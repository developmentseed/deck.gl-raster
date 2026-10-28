import {
  Colormap,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Texture } from "@luma.gl/core";
import { describe, expect, it } from "vitest";
import {
  ElevationScalar,
  Hillshade,
  MultiplyShade,
  SlopeDegrees,
  TerrainDerivative,
} from "../src/terrain/gpu-modules/index.js";
import type { MakeRenderTileOptions } from "../src/terrain/render-tile.js";
import { makeRenderTile } from "../src/terrain/render-tile.js";
import type { TerrainTileData } from "../src/terrain/types.js";

const elevationTexture = { id: "elevation" } as unknown as Texture;
const colormapTexture = { id: "colormaps" } as unknown as Texture;

const data: TerrainTileData = {
  texture: elevationTexture,
  width: 512,
  height: 512,
  byteLength: 514 * 514 * 4,
  cellSize: 19.109257071294063,
  mercatorYRange: [5774194.4, 5764411.7],
};

const options: MakeRenderTileOptions = {
  mode: "hillshade",
  sunAzimuth: 315,
  sunAltitude: 45,
  zFactor: 2,
  colormapTexture,
  colormapIndex: 7,
  colormapReversed: true,
  rescaleMin: 1000,
  rescaleMax: 4500,
  shadeStrength: 0.8,
};

/** The modules of a tile's pipeline, in order. */
function modules(mode: MakeRenderTileOptions["mode"]) {
  const result = makeRenderTile({ ...options, mode })(data);
  return result?.renderPipeline?.map((step) => step.module);
}

describe("makeRenderTile", () => {
  it("starts with TerrainDerivative, fed the tile's texture, size, cell size and Mercator rows", () => {
    const result = makeRenderTile(options)(data);
    expect(result?.renderPipeline?.[0]).toEqual({
      module: TerrainDerivative,
      props: {
        elevationTexture,
        tileSize: [512, 512],
        cellSize: 19.109257071294063,
        mercatorYRange: [5774194.4, 5764411.7],
        zFactor: 2,
        sunAzimuth: 315,
        sunAltitude: 45,
      },
    });
  });

  it("shades hillshade mode in gray", () => {
    expect(modules("hillshade")).toEqual([TerrainDerivative, Hillshade]);
  });

  it("colors tinted relief by elevation, then multiplies in the shade", () => {
    const result = makeRenderTile({ ...options, mode: "tinted-relief" })(data);
    expect(result?.renderPipeline?.slice(1)).toEqual([
      { module: ElevationScalar },
      {
        module: LinearRescale,
        props: { rescaleMin: 1000, rescaleMax: 4500 },
      },
      {
        module: Colormap,
        props: { colormapTexture, colormapIndex: 7, reversed: true },
      },
      { module: MultiplyShade, props: { shadeStrength: 0.8 } },
    ]);
  });

  it("colors slope mode by slope", () => {
    expect(modules("slope")).toEqual([
      TerrainDerivative,
      SlopeDegrees,
      LinearRescale,
      Colormap,
    ]);
  });

  it("colors elevation mode by elevation", () => {
    expect(modules("elevation")).toEqual([
      TerrainDerivative,
      ElevationScalar,
      LinearRescale,
      Colormap,
    ]);
  });

  it("skips a colormap mode's tiles until the colormap texture exists", () => {
    const render = makeRenderTile({
      ...options,
      mode: "tinted-relief",
      colormapTexture: null,
    });
    expect(render(data)).toBeNull();
  });

  it("shades hillshade mode without a colormap texture", () => {
    const render = makeRenderTile({ ...options, colormapTexture: null });
    expect(render(data)).not.toBeNull();
  });
});

describe("TerrainDerivative.getUniforms", () => {
  it("splits the Mercator range into the north and south uniforms", () => {
    expect(
      TerrainDerivative.getUniforms({ mercatorYRange: [5774194.4, 5764411.7] }),
    ).toMatchObject({ mercatorYNorth: 5774194.4, mercatorYSouth: 5764411.7 });
  });
});

describe("makeRenderTile with a missing tile", () => {
  it("draws nothing for a tile the archive lacks", () => {
    expect(makeRenderTile(options)(null)).toBeNull();
  });
});
