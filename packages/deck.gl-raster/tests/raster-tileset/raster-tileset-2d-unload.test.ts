import { WebMercatorViewport } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { compose, scale, translation } from "@developmentseed/affine";
import { describe, expect, it, vi } from "vitest";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";
import type { RasterTileset2DOptions } from "../../src/raster-tileset/raster-tileset-2d.js";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";

const identity = (x: number, y: number): [number, number] => [x, y];

/** A level of a 32 m square array centered on the origin, in EPSG:3857. */
function makeLevel(metersPerPixel: number): AffineTilesetLevel {
  const size = 32 / metersPerPixel;
  return new AffineTilesetLevel({
    affine: compose(
      translation(-16, 16),
      scale(metersPerPixel, -metersPerPixel),
    ),
    arrayWidth: size,
    arrayHeight: size,
    tileWidth: 16,
    tileHeight: 16,
    mpu: 1,
  });
}

const descriptor = new AffineTileset({
  levels: [makeLevel(2), makeLevel(1)],
  projectTo3857: identity,
  projectFrom3857: identity,
  projectTo4326: identity,
  projectFrom4326: identity,
});

const viewport = new WebMercatorViewport({
  longitude: 0,
  latitude: 0,
  zoom: 18,
  width: 100,
  height: 100,
});

/** Waits for pending promise callbacks, such as tile loads, to run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A viewport inside one finest-level tile: the one east or west of the origin. */
function viewportOverOneTile(side: "west" | "east"): WebMercatorViewport {
  // About 8 m from the origin along both axes, in degrees.
  const offset = 7e-5;
  return new WebMercatorViewport({
    longitude: side === "west" ? -offset : offset,
    latitude: offset,
    zoom: 18,
    width: 8,
    height: 8,
  });
}

/** A tileset with spied `onTileLoad` and `onTileUnload`, and no request throttling. */
function makeTileset(
  getTileData: Tileset2DProps["getTileData"],
  options: Partial<Tileset2DProps> = {},
  rasterOptions: RasterTileset2DOptions = {},
) {
  const onTileLoad = vi.fn();
  const onTileUnload = vi.fn();
  const tileset = new RasterTileset2D(
    { getTileData, onTileLoad, onTileUnload, maxRequests: 0, ...options },
    descriptor,
    rasterOptions,
  );
  return { tileset, onTileLoad, onTileUnload };
}

/** `getTileData` that returns data only when the test resolves it. */
function deferredTileData() {
  const pending: ((data: unknown) => void)[] = [];
  const getTileData = () => new Promise((resolve) => pending.push(resolve));
  /** Returns data for every tile requested so far. */
  const resolveAll = () => {
    for (const resolve of pending) {
      resolve({ byteLength: 1 });
    }
  };
  return { getTileData, pending, resolveAll };
}

/** The tiles that `onTileLoad` was called with. */
function loadedTiles(onTileLoad: ReturnType<typeof vi.fn>): Tile2DHeader[] {
  return onTileLoad.mock.calls.map(([tile]) => tile as Tile2DHeader);
}

/** The tiles that `onTileUnload` was called with. */
function unloadedTiles(onTileUnload: ReturnType<typeof vi.fn>): Tile2DHeader[] {
  return onTileUnload.mock.calls.map(([tile]) => tile as Tile2DHeader);
}

describe("RasterTileset2D tile unloading", () => {
  it("unloads every cached tile on finalize", async () => {
    const { tileset, onTileUnload } = makeTileset(async () => ({
      byteLength: 1,
    }));
    tileset.update(viewport);
    await settle();
    const tiles = [...tileset.tiles];
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((tile) => tile.isLoaded)).toBe(true);

    tileset.finalize();

    expect(unloadedTiles(onTileUnload)).toEqual(tiles);
  });

  it("unloads a tile still loading at finalize once its data arrives", async () => {
    const { getTileData, pending, resolveAll } = deferredTileData();
    const { tileset, onTileUnload } = makeTileset(getTileData);
    tileset.update(viewport);
    await settle();
    const tiles = [...tileset.tiles];
    expect(pending).toHaveLength(tiles.length);

    tileset.finalize();
    expect(onTileUnload).not.toHaveBeenCalled();
    // getTileData ignores the abort and returns data anyway.
    resolveAll();
    await settle();

    const unloaded = unloadedTiles(onTileUnload);
    expect(unloaded).toHaveLength(tiles.length);
    expect(tiles.every((tile) => unloaded.includes(tile))).toBe(true);
    expect(unloaded.every((tile) => tile.content !== null)).toBe(true);
  });

  it.each([false, true])(
    "unloads a tile evicted while loading once its data arrives (abortUnwantedLoads: %s)",
    async (abortUnwantedLoads) => {
      const { getTileData, resolveAll } = deferredTileData();
      const { tileset, onTileLoad, onTileUnload } = makeTileset(
        getTileData,
        { maxCacheSize: 0 },
        { abortUnwantedLoads },
      );
      tileset.update(viewportOverOneTile("west"));
      await settle();
      const tiles = [...tileset.tiles];
      expect(tiles.length).toBeGreaterThan(0);

      // Loading another tile evicts the first ones, which are still loading.
      tileset.update(viewportOverOneTile("east"));
      await settle();
      expect(unloadedTiles(onTileUnload)).toEqual(tiles);
      expect(tiles.every((tile) => tile.content === null)).toBe(true);
      onTileUnload.mockClear();
      // getTileData ignores the abort and returns data anyway.
      resolveAll();
      await settle();

      expect(unloadedTiles(onTileUnload)).toEqual(tiles);
      expect(tiles.every((tile) => tile.content !== null)).toBe(true);
      expect(loadedTiles(onTileLoad).some((tile) => tiles.includes(tile))).toBe(
        false,
      );
    },
  );

  it("unloads a tile whose load stops at the abort", async () => {
    const { tileset, onTileUnload } = makeTileset(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    tileset.update(viewport);
    await settle();
    const tiles = [...tileset.tiles];
    expect(tiles.length).toBeGreaterThan(0);

    tileset.finalize();
    await settle();

    const unloaded = unloadedTiles(onTileUnload);
    expect(unloaded).toHaveLength(tiles.length);
    expect(tiles.every((tile) => unloaded.includes(tile))).toBe(true);
  });
});
