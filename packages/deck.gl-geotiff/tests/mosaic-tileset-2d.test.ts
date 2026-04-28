import type { Viewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { describe, expect, it } from "vitest";
import type { MosaicSource } from "../src/mosaic-layer/mosaic-tileset-2d.js";
import { MosaicTileset2D } from "../src/mosaic-layer/mosaic-tileset-2d.js";

function makeViewport(bounds: [number, number, number, number]): Viewport {
  return {
    equals: () => false,
    resolution: undefined,
    zoom: 5,
    getBounds: () => bounds,
  } as unknown as Viewport;
}

function makeTileset(
  sources: MosaicSource[],
  maxRequests?: number,
): MosaicTileset2D<MosaicSource> {
  return new MosaicTileset2D<MosaicSource>(sources, {
    getTileData: () => new Promise(() => {}),
    ...(maxRequests !== undefined ? { maxRequests } : {}),
  } as unknown as Tileset2DProps);
}

describe("MosaicTileset2D center-out ordering", () => {
  it("excludes sources outside viewport bounds (culling unaffected)", () => {
    const sources: MosaicSource[] = [
      { bbox: [0, 0, 1, 1] },
      { bbox: [100, 100, 101, 101] },
    ];
    const tileset = makeTileset(sources);
    const viewport = makeViewport([-5, -5, 5, 5]);
    const result = tileset.getTileIndices({ viewport });
    expect(result.length).toBe(1);
    expect(result[0]!.bbox).toEqual([0, 0, 1, 1]);
  });

  it("places the source nearest the viewport center first", () => {
    const sources: MosaicSource[] = [
      { bbox: [4, 4, 5, 5] },
      { bbox: [-4, -4, -3, -3] },
      { bbox: [0.4, 0.4, 0.6, 0.6] },
    ];
    // maxRequests=1 to force the sort path regardless of deck.gl defaults.
    const tileset = makeTileset(sources, 1);
    const viewport = makeViewport([-10, -10, 10, 10]);
    const result = tileset.getTileIndices({ viewport });
    expect(result.length).toBe(3);
    expect(result[0]!.bbox).toEqual([0.4, 0.4, 0.6, 0.6]);
  });

  it("short-circuits when source count <= maxRequests", () => {
    const sources: MosaicSource[] = [
      { bbox: [4, 4, 5, 5] },
      { bbox: [0.4, 0.4, 0.6, 0.6] },
    ];
    const tileset = makeTileset(sources, 6);
    const viewport = makeViewport([-10, -10, 10, 10]);
    const result = tileset.getTileIndices({ viewport });
    expect(result.map((s) => s.bbox)).toEqual([
      [4, 4, 5, 5],
      [0.4, 0.4, 0.6, 0.6],
    ]);
  });

  it("still sorts when count > maxRequests", () => {
    const sources: MosaicSource[] = [
      { bbox: [4, 4, 5, 5] },
      { bbox: [-4, -4, -3, -3] },
      { bbox: [0.4, 0.4, 0.6, 0.6] },
    ];
    const tileset = makeTileset(sources, 2);
    const viewport = makeViewport([-10, -10, 10, 10]);
    const result = tileset.getTileIndices({ viewport });
    expect(result[0]!.bbox).toEqual([0.4, 0.4, 0.6, 0.6]);
  });
});
