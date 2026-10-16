import { WebMercatorViewport } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { compose, scale, translation } from "@developmentseed/affine";
import { describe, expect, it, vi } from "vitest";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";
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

/**
 * A close view of one finest-level tile: the one whose center is `[x, y]`
 * meters from the origin.
 */
function tileViewport(x: number, y: number): WebMercatorViewport {
  const degreesPerMeter = 360 / 40075016.686;
  return new WebMercatorViewport({
    longitude: x * degreesPerMeter,
    latitude: y * degreesPerMeter,
    zoom: 21,
    width: 100,
    height: 100,
  });
}

/** A tileset with spied tile callbacks and no request throttling. */
function makeTileset(
  getTileData: Tileset2DProps["getTileData"],
  opts: Partial<Tileset2DProps> = {},
) {
  const onTileLoad = vi.fn();
  const onTileUnload = vi.fn();
  const tileset = new RasterTileset2D(
    { getTileData, onTileLoad, onTileUnload, maxRequests: 0, ...opts },
    descriptor,
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

  it("unloads a tile whose data arrives after finalize", async () => {
    const { getTileData, pending, resolveAll } = deferredTileData();
    const { tileset, onTileLoad, onTileUnload } = makeTileset(getTileData);
    tileset.update(viewport);
    await settle();
    expect(pending.length).toBeGreaterThan(0);

    tileset.finalize();
    onTileUnload.mockClear();
    // getTileData ignores the abort and returns data anyway.
    resolveAll();
    await settle();

    expect(onTileLoad).not.toHaveBeenCalled();
    expect(onTileUnload).toHaveBeenCalledTimes(pending.length);
    expect(
      unloadedTiles(onTileUnload).every((tile) => tile.content !== null),
    ).toBe(true);
  });

  it("unloads a tile evicted while loading, once its data arrives", async () => {
    const { getTileData, pending, resolveAll } = deferredTileData();
    const { tileset, onTileLoad, onTileUnload } = makeTileset(getTileData, {
      maxCacheSize: 0,
    });
    tileset.update(tileViewport(-8, 8));
    await settle();
    const [evicted] = tileset.tiles;
    expect(tileset.tiles).toHaveLength(1);

    // Selecting another tile evicts the first, which is still loading.
    tileset.update(tileViewport(8, -8));
    const [kept] = tileset.tiles;
    expect(tileset.tiles).toHaveLength(1);
    expect(kept).not.toBe(evicted);
    await settle();
    expect(pending).toHaveLength(2);
    onTileUnload.mockClear();
    resolveAll();
    await settle();

    expect(unloadedTiles(onTileUnload)).toEqual([evicted]);
    expect(evicted!.content).not.toBeNull();
    expect(onTileLoad.mock.calls.map(([tile]) => tile)).toEqual([kept]);
  });

  it("reports a tile that loads while it's cached", async () => {
    const { tileset, onTileLoad, onTileUnload } = makeTileset(async () => ({
      byteLength: 1,
    }));
    tileset.update(viewport);
    await settle();

    expect(onTileLoad).toHaveBeenCalledTimes(tileset.tiles.length);
    expect(onTileUnload).not.toHaveBeenCalled();
  });
});
