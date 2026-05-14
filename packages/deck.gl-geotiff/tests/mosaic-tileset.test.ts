import type { Viewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { describe, expect, it } from "vitest";
import type { MosaicSource } from "../src/mosaic-layer/mosaic-tileset-2d.js";
import { MosaicTileset2D } from "../src/mosaic-layer/mosaic-tileset-2d.js";

const TILESET_OPTS: Tileset2DProps = {
  // getTileData is required by the type but not exercised in these tests.
  getTileData: async () => null,
};

function fakeViewport(bounds: [number, number, number, number], zoom = 5) {
  return {
    zoom,
    getBounds: () => bounds,
  } as unknown as Viewport;
}

type Item = MosaicSource & { id: string };
const A: Item = { id: "A", bbox: [0, 0, 10, 10] };
const B: Item = { id: "B", bbox: [20, 0, 30, 10] };
const C: Item = { id: "C", bbox: [40, 0, 50, 10] };

describe("MosaicTileset2D dynamic sources", () => {
  it("returns sources intersecting the viewport on initial query", () => {
    const sourcesRef: { current: Item[] } = { current: [A, B] };
    const tileset = new MosaicTileset2D<Item>(
      () => sourcesRef.current,
      TILESET_OPTS,
    );

    const result = tileset.getTileIndices({
      viewport: fakeViewport([-1, -1, 11, 11]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("A");
  });

  it("picks up appended sources without reconstructing the tileset", () => {
    const sourcesRef: { current: Item[] } = { current: [A, B] };
    const tileset = new MosaicTileset2D<Item>(
      () => sourcesRef.current,
      TILESET_OPTS,
    );

    // Initial query — only A and B available
    tileset.getTileIndices({
      viewport: fakeViewport([-1, -1, 51, 11]),
    });

    // Consumer replaces the array reference with an appended array
    sourcesRef.current = [A, B, C];

    const result = tileset.getTileIndices({
      viewport: fakeViewport([-1, -1, 51, 11]),
    });

    expect(result.map((s) => s.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("starts from an empty array and rebuilds on first non-empty update", () => {
    const sourcesRef: { current: Item[] } = { current: [] };
    const tileset = new MosaicTileset2D<Item>(
      () => sourcesRef.current,
      TILESET_OPTS,
    );

    expect(
      tileset.getTileIndices({ viewport: fakeViewport([-1, -1, 51, 11]) }),
    ).toEqual([]);

    sourcesRef.current = [A, B];

    const result = tileset.getTileIndices({
      viewport: fakeViewport([-1, -1, 51, 11]),
    });
    expect(result.map((s) => s.id).sort()).toEqual(["A", "B"]);
  });

  it("does not pick up in-place mutations of the same array reference", () => {
    const stable: Item[] = [A, B];
    const tileset = new MosaicTileset2D<Item>(() => stable, TILESET_OPTS);

    tileset.getTileIndices({
      viewport: fakeViewport([-1, -1, 51, 11]),
    });

    // Mutate the array in place — same reference
    stable.push(C);

    const result = tileset.getTileIndices({
      viewport: fakeViewport([-1, -1, 51, 11]),
    });

    // C is not picked up because the array reference did not change.
    expect(result.map((s) => s.id).sort()).toEqual(["A", "B"]);
  });

  it("defaults each source's tile-cache key to its array position", () => {
    const sourcesRef: { current: Item[] } = { current: [A, B, C] };
    const tileset = new MosaicTileset2D<Item>(
      () => sourcesRef.current,
      TILESET_OPTS,
    );

    const result = tileset.getTileIndices({
      viewport: fakeViewport([-1, -1, 51, 11]),
    });

    const byId = new Map(result.map((s) => [s.id, s] as const));
    expect(tileset.getTileId(byId.get("A")!)).toBe("0");
    expect(tileset.getTileId(byId.get("B")!)).toBe("1");
    expect(tileset.getTileId(byId.get("C")!)).toBe("2");
  });

  it("respects an explicit `key` on a source", () => {
    const explicit: MosaicSource & { id: string } = {
      id: "explicit",
      bbox: [0, 0, 10, 10],
      key: "stable-id",
    };
    const tileset = new MosaicTileset2D<MosaicSource & { id: string }>(
      () => [explicit],
      TILESET_OPTS,
    );

    const result = tileset.getTileIndices({
      viewport: fakeViewport([-1, -1, 11, 11]),
    });

    expect(result[0]).toMatchObject({ id: "explicit", key: "stable-id" });
    expect(tileset.getTileId(result[0]!)).toBe("stable-id");
  });

  it("returns no tiles when zoom is outside the [minZoom, maxZoom] range", () => {
    const tileset = new MosaicTileset2D<Item>(() => [A], TILESET_OPTS);
    const viewport = fakeViewport([-1, -1, 11, 11], 5);

    expect(tileset.getTileIndices({ viewport, minZoom: 10 })).toEqual([]);
    expect(tileset.getTileIndices({ viewport, maxZoom: 1 })).toEqual([]);
    expect(
      tileset.getTileIndices({ viewport, minZoom: 0, maxZoom: 10 }),
    ).toHaveLength(1);
  });
});
