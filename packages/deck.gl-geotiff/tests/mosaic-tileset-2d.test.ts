import type { Viewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import Flatbush from "flatbush";
import { describe, expect, it } from "vitest";
import type { MosaicSource } from "../src/mosaic-layer/mosaic-tileset-2d.js";
import { MosaicTileset2D } from "../src/mosaic-layer/mosaic-tileset-2d.js";

function makeViewport(
  bounds: [number, number, number, number],
  zoom = 5,
): Viewport {
  return {
    equals: () => false,
    resolution: undefined,
    zoom,
    getBounds: () => bounds,
  } as unknown as Viewport;
}

function buildIndex(sources: MosaicSource[]): Flatbush | null {
  if (sources.length === 0) {
    return null;
  }
  const index = new Flatbush(sources.length);
  for (const source of sources) {
    index.add(...source.bbox);
  }
  index.finish();
  return index;
}

function makeTileset<T extends MosaicSource>(
  sources: T[],
  opts: { maxRequests?: number } = {},
): MosaicTileset2D<T> {
  const index = buildIndex(sources);
  return new MosaicTileset2D<T>(
    () => sources,
    () => index,
    {
      getTileData: () => new Promise(() => {}),
      ...(opts.maxRequests !== undefined
        ? { maxRequests: opts.maxRequests }
        : {}),
    } as unknown as Tileset2DProps,
  );
}

type Item = MosaicSource & { name: string };
const A: Item = { name: "A", bbox: [0, 0, 10, 10] };
const B: Item = { name: "B", bbox: [20, 0, 30, 10] };
const C: Item = { name: "C", bbox: [40, 0, 50, 10] };

describe("MosaicTileset2D viewport filtering", () => {
  it("returns sources intersecting the viewport", () => {
    const tileset = makeTileset([A, B, C]);
    const result = tileset.getTileIndices({
      viewport: makeViewport([-1, -1, 11, 11]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("A");
  });

  it("excludes sources outside viewport bounds", () => {
    const tileset = makeTileset<MosaicSource>([
      { bbox: [0, 0, 1, 1] },
      { bbox: [100, 100, 101, 101] },
    ]);
    const result = tileset.getTileIndices({
      viewport: makeViewport([-5, -5, 5, 5]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.bbox).toEqual([0, 0, 1, 1]);
  });

  it("returns no tiles when zoom is outside the [minZoom, maxZoom] range", () => {
    const tileset = makeTileset([A]);
    const viewport = makeViewport([-1, -1, 11, 11], 5);
    expect(tileset.getTileIndices({ viewport, minZoom: 10 })).toEqual([]);
    expect(tileset.getTileIndices({ viewport, maxZoom: 1 })).toEqual([]);
    expect(
      tileset.getTileIndices({ viewport, minZoom: 0, maxZoom: 10 }),
    ).toHaveLength(1);
  });
});

describe("MosaicTileset2D center-out ordering", () => {
  it("places the source nearest the viewport center first", () => {
    const sources: MosaicSource[] = [
      { bbox: [4, 4, 5, 5] },
      { bbox: [-4, -4, -3, -3] },
      { bbox: [0.4, 0.4, 0.6, 0.6] },
    ];
    const tileset = makeTileset(sources, { maxRequests: 1 });
    const viewport = makeViewport([-10, -10, 10, 10]);
    const result = tileset.getTileIndices({ viewport });
    expect(result).toHaveLength(3);
    expect(result[0]!.bbox).toEqual([0.4, 0.4, 0.6, 0.6]);
  });

  it("short-circuits when source count <= maxRequests", () => {
    const sources: MosaicSource[] = [
      { bbox: [4, 4, 5, 5] },
      { bbox: [0.4, 0.4, 0.6, 0.6] },
    ];
    const tileset = makeTileset(sources, { maxRequests: 6 });
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
    const tileset = makeTileset(sources, { maxRequests: 2 });
    const viewport = makeViewport([-10, -10, 10, 10]);
    const result = tileset.getTileIndices({ viewport });
    expect(result[0]!.bbox).toEqual([0.4, 0.4, 0.6, 0.6]);
  });
});

describe("MosaicTileset2D tile ids", () => {
  it("defaults each source's tile-cache id to its array position", () => {
    const tileset = makeTileset([A, B, C]);
    const result = tileset.getTileIndices({
      viewport: makeViewport([-1, -1, 51, 11]),
    });
    const byName = new Map(result.map((s) => [s.name, s] as const));
    expect(tileset.getTileId(byName.get("A")!)).toBe("0");
    expect(tileset.getTileId(byName.get("B")!)).toBe("1");
    expect(tileset.getTileId(byName.get("C")!)).toBe("2");
  });

  it("respects an explicit `id` on a source", () => {
    const explicit: Item = {
      name: "explicit",
      bbox: [0, 0, 10, 10],
      id: "stable-id",
    };
    const tileset = makeTileset([explicit]);
    const result = tileset.getTileIndices({
      viewport: makeViewport([-1, -1, 11, 11]),
    });
    expect(result[0]).toMatchObject({ name: "explicit", id: "stable-id" });
    expect(tileset.getTileId(result[0]!)).toBe("stable-id");
  });
});
