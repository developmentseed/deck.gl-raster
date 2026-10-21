import type { Viewport } from "@deck.gl/core";
import {
  _GlobeViewport as GlobeViewport,
  WebMercatorViewport,
} from "@deck.gl/core";
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
  opts: { maxRequests?: number; extent?: number[] } = {},
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
      // deck.gl's TileLayer always passes `extent`, `null` by default.
      extent: opts.extent ?? null,
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

describe("MosaicTileset2D tile metadata", () => {
  it("gives each tile a geographic bbox object that deck.gl can read", () => {
    // deck.gl's request priority and cull-rect visibility check only
    // understand `{west, south, east, north}` bboxes, not arrays.
    const tileset = makeTileset([A]);
    const [tileIndex] = tileset.getTileIndices({
      viewport: makeViewport([-1, -1, 11, 11]),
    });
    expect(tileset.getTileMetadata(tileIndex!)).toEqual({
      id: "0",
      bbox: { west: 0, south: 0, east: 10, north: 10 },
    });
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

describe("MosaicTileset2D across the antimeridian", () => {
  // One source on each side of the antimeridian, like scenes over Fiji.
  const west: Item = { name: "west", bbox: [176, -20, 179, -17] };
  const east: Item = { name: "east", bbox: [-179, -20, -176, -17] };
  const names = (sources: Item[]) => sources.map((s) => s.name).sort();
  // About 9° of longitude wide.
  const view = { latitude: -18.5, zoom: 6, width: 800, height: 600 };

  it.each([179.9, -179.9])(
    "selects both sides in Web Mercator with repeat, centered at %s°",
    (longitude) => {
      const tileset = makeTileset([west, east]);
      const viewport = new WebMercatorViewport({
        ...view,
        longitude,
        repeat: true,
      });
      expect(names(tileset.getTileIndices({ viewport }))).toEqual([
        "east",
        "west",
      ]);
    },
  );

  it("selects only the side drawn in Web Mercator without repeat", () => {
    // Nothing is drawn past 180°.
    const tileset = makeTileset([west, east]);
    const viewport = new WebMercatorViewport({ ...view, longitude: 179.9 });
    expect(names(tileset.getTileIndices({ viewport }))).toEqual(["west"]);
  });

  it.each([179.9, -179.9])(
    "selects both sides on a globe centered at %s°",
    (longitude) => {
      const tileset = makeTileset([west, east]);
      const viewport = new GlobeViewport({ ...view, longitude });
      expect(names(tileset.getTileIndices({ viewport }))).toEqual([
        "east",
        "west",
      ]);
    },
  );

  it("selects both sides when the center longitude isn't wrapped", () => {
    // Controllers wrap the center into [-180, 180], but a view state set
    // directly can be anywhere. 899.9° is 179.9°, two worlds east.
    const tileset = makeTileset([west, east]);
    const viewport = new WebMercatorViewport({
      ...view,
      longitude: 899.9,
      repeat: true,
    });
    expect(names(tileset.getTileIndices({ viewport }))).toEqual([
      "east",
      "west",
    ]);
  });

  it("selects every source when the viewport shows more than one world", () => {
    const tileset = makeTileset([west, east, A]);
    const viewport = new WebMercatorViewport({
      longitude: 0,
      latitude: 0,
      zoom: 0,
      width: 3000,
      height: 800,
      repeat: true,
    });
    expect(names(tileset.getTileIndices({ viewport }))).toEqual([
      "A",
      "east",
      "west",
    ]);
  });

  it("selects a source on both sides of the antimeridian once", () => {
    // A scene across the antimeridian, with a bbox spanning every longitude.
    const across: Item = { name: "across", bbox: [-180, -20, 180, -17] };
    const tileset = makeTileset([across]);
    const viewport = new WebMercatorViewport({
      ...view,
      longitude: 179.9,
      repeat: true,
    });
    expect(names(tileset.getTileIndices({ viewport }))).toEqual(["across"]);
  });
});

describe("MosaicTileset2D extent", () => {
  // Shows all of A, B and C.
  const viewport = makeViewport([-1, -1, 51, 11]);
  const names = (sources: Item[]) => sources.map((s) => s.name).sort();

  it("selects only the sources that overlap the extent", () => {
    // Covers part of A and part of B. Asymmetric, so reading it with swapped
    // axes would select only A.
    const tileset = makeTileset([A, B, C], { extent: [5, 2, 25, 8] });
    expect(names(tileset.getTileIndices({ viewport }))).toEqual(["A", "B"]);
  });

  it("keeps array-position ids when the extent skips an earlier source", () => {
    // Skips A. B and C still get ids from their positions in `sources`.
    const tileset = makeTileset([A, B, C], { extent: [25, 2, 45, 8] });
    const result = tileset.getTileIndices({ viewport });
    const ids = Object.fromEntries(
      result.map((s) => [s.name, tileset.getTileId(s)]),
    );
    expect(ids).toEqual({ B: "1", C: "2" });
  });

  it("skips sources that only touch the extent", () => {
    // Shares A's east edge and B's west edge. deck.gl's TileLayer likewise
    // skips tiles that only touch its extent.
    const sideBySide = makeTileset([A, B, C], { extent: [10, 0, 20, 10] });
    expect(names(sideBySide.getTileIndices({ viewport }))).toEqual([]);

    // Shares the north edges of A, B and C.
    const above = makeTileset([A, B, C], { extent: [0, 10, 50, 20] });
    expect(names(above.getTileIndices({ viewport }))).toEqual([]);
  });

  it("keeps a visible source whose overlap with the extent is off-screen", () => {
    // `wide` reaches the extent off-screen to the east, and a source is drawn
    // in full, so its west end stays on screen. `near` is on screen but
    // misses the extent.
    const wide: Item = { name: "wide", bbox: [0, 0, 100, 10] };
    const near: Item = { name: "near", bbox: [0, 20, 10, 30] };
    const tileset = makeTileset([wide, near], { extent: [80, 0, 90, 10] });
    const result = tileset.getTileIndices({
      viewport: makeViewport([-1, -1, 11, 31]),
    });
    expect(names(result)).toEqual(["wide"]);
  });

  it("applies an extent changed through setOptions on the next call", () => {
    const tileset = makeTileset([A, B, C]);
    const getTileData = () => new Promise(() => {});

    // deck.gl's TileLayer calls `setOptions` when its props change.
    tileset.setOptions({ getTileData, extent: [5, 2, 25, 8] });
    expect(names(tileset.getTileIndices({ viewport }))).toEqual(["A", "B"]);

    tileset.setOptions({ getTileData, extent: null });
    expect(names(tileset.getTileIndices({ viewport }))).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});
