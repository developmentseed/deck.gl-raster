import type { _TileLoadProps as TileLoadProps } from "@deck.gl/geo-layers";
import { _Tile2DHeader as Tile2DHeader } from "@deck.gl/geo-layers";
import type { Device } from "@luma.gl/core";
import { describe, expect, it, vi } from "vitest";
import type { PMTilesSource } from "../src/pmtiles/pmtiles-source.js";
import { BorderCache } from "../src/terrain/border-cache.js";
import {
  loadTerrariumElevation,
  makeGetTileData,
} from "../src/terrain/get-tile-data.js";
import type { TileIndex } from "../src/terrain/neighbors.js";
import { tileKey } from "../src/terrain/neighbors.js";
import type { TerrainTileData } from "../src/terrain/types.js";

/** Let settled promises run their handlers. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The tile under test, in the middle of z2, and its eight neighbors' values. */
const TILE = { z: 2, x: 1, y: 1 };
const NEIGHBOR_VALUES: Record<string, number> = {
  "2/0/0": 10,
  "2/1/0": 20,
  "2/2/0": 30,
  "2/0/1": 40,
  "2/2/1": 60,
  "2/0/2": 70,
  "2/1/2": 80,
  "2/2/2": 90,
};
const NEIGHBOR_KEYS = Object.keys(NEIGHBOR_VALUES);

type Deferred = {
  resolve: (elevation: Float32Array | null) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
};

/** A cache over a load whose tiles the test settles by hand, by key. */
function setup() {
  const loads = new Map<string, Deferred>();
  const load = vi.fn(
    (tile: TileIndex, signal: AbortSignal) =>
      new Promise<Float32Array | null>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        loads.set(tileKey(tile), { resolve, reject, signal });
      }),
  );
  const cache = new BorderCache({ load, tileSize: 2, capacity: 100 });
  const onTileRefined = vi.fn();
  const getTileData = makeGetTileData({ cache, tileSize: 2, onTileRefined });

  const textures: Array<{
    options: Record<string, unknown>;
    writeData: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  }> = [];
  const device = {
    createTexture: vi.fn((options: Record<string, unknown>) => {
      const texture = { options, writeData: vi.fn(), destroyed: false };
      textures.push(texture);
      return texture;
    }),
  } as unknown as Device;

  /** Settle the center as 1 2 / 3 4. */
  const resolveCenter = () =>
    loads.get(tileKey(TILE))!.resolve(Float32Array.from([1, 2, 3, 4]));
  /** Settle every neighbor as a 2 x 2 tile of its constant. */
  const resolveNeighbors = (except?: string) => {
    for (const [key, value] of Object.entries(NEIGHBOR_VALUES)) {
      if (key !== except) {
        loads
          .get(key)!
          .resolve(Float32Array.from([value, value, value, value]));
      }
    }
  };
  /** Whether every neighbor's load has been aborted. */
  const neighborsAborted = () =>
    NEIGHBOR_KEYS.map((key) => loads.get(key)!.signal.aborted);
  const run = (signal?: AbortSignal) =>
    getTileData({ index: TILE } as TileLoadProps, { device, signal });

  return {
    load,
    loads,
    onTileRefined,
    textures,
    device,
    getTileData,
    resolveCenter,
    resolveNeighbors,
    neighborsAborted,
    run,
  };
}

/** Rows of a 4-texel-wide array. */
function rows(data: unknown): number[][] {
  const values = Array.from(data as Float32Array);
  return [0, 1, 2, 3].map((r) => values.slice(r * 4, r * 4 + 4));
}

/** The halo a texture was first filled with: its first, whole-texture write. */
function uploaded(texture: { writeData: ReturnType<typeof vi.fn> }) {
  const [data, rect] = texture.writeData.mock.calls[0]!;
  expect(rect).toBeUndefined();
  return data;
}

describe("makeGetTileData", () => {
  it("asks for the center and all eight neighbors in the same task", () => {
    const { load, run } = setup();
    void run();
    expect(load).toHaveBeenCalledTimes(9);
  });

  it("uploads a (tileSize + 2)^2 r32float texture with the center inset", async () => {
    const { textures, resolveCenter, resolveNeighbors, run, onTileRefined } =
      setup();
    const result = run();
    resolveNeighbors();
    await flush();
    resolveCenter();
    await result;
    expect(textures[0]!.options).toMatchObject({
      format: "r32float",
      width: 4,
      height: 4,
      mipLevels: 1,
      sampler: {
        minFilter: "nearest",
        magFilter: "nearest",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      },
    });
    expect(rows(uploaded(textures[0]!))).toEqual([
      [10, 20, 20, 30],
      [40, 1, 2, 60],
      [40, 3, 4, 60],
      [70, 80, 80, 90],
    ]);
    await flush();
    expect(onTileRefined).not.toHaveBeenCalled();
  });

  it("doesn't hand the halo array to createTexture, which would keep it alive", async () => {
    const { textures, resolveCenter, run } = setup();
    const result = run();
    resolveCenter();
    await result;
    expect(textures[0]!.options).not.toHaveProperty("data");
  });

  it("returns null when the archive has no center tile", async () => {
    const { loads, device, run } = setup();
    const result = run();
    loads.get(tileKey(TILE))!.resolve(null);
    await expect(result).resolves.toBeNull();
    expect(device.createTexture).not.toHaveBeenCalled();
  });

  it("replicates the ring where a neighbor load fails", async () => {
    const { loads, textures, resolveCenter, resolveNeighbors, run } = setup();
    const result = run();
    resolveNeighbors("2/0/1");
    loads.get("2/0/1")!.reject(new Error("network"));
    await flush();
    resolveCenter();
    await result;
    expect(rows(uploaded(textures[0]!)).map((row) => row[0])).toEqual([
      10, 1, 3, 70,
    ]);
  });

  it("rewrites only the ring when late neighbors arrive, then asks for a redraw", async () => {
    const { textures, resolveCenter, resolveNeighbors, run, onTileRefined } =
      setup();
    const result = run();
    resolveCenter();
    await result;
    expect(rows(uploaded(textures[0]!))).toEqual([
      [1, 1, 2, 2],
      [1, 1, 2, 2],
      [3, 3, 4, 4],
      [3, 3, 4, 4],
    ]);
    resolveNeighbors();
    await flush();
    const writes = textures[0]!.writeData.mock.calls
      .slice(1)
      .map(([data, options]) => [Array.from(data as Float32Array), options]);
    expect(writes).toEqual([
      [[10, 20, 20, 30], { x: 0, y: 0, width: 4, height: 1 }],
      [[70, 80, 80, 90], { x: 0, y: 3, width: 4, height: 1 }],
      [[40, 40], { x: 0, y: 1, width: 1, height: 2 }],
      [[60, 60], { x: 3, y: 1, width: 1, height: 2 }],
    ]);
    expect(onTileRefined).toHaveBeenCalledTimes(1);
  });

  it("leaves a destroyed texture alone", async () => {
    const { textures, resolveCenter, resolveNeighbors, run, onTileRefined } =
      setup();
    const result = run();
    resolveCenter();
    await result;
    textures[0]!.destroyed = true;
    resolveNeighbors();
    await flush();
    expect(textures[0]!.writeData).toHaveBeenCalledTimes(1);
    expect(onTileRefined).not.toHaveBeenCalled();
  });

  it("stops its halo reads when its load is aborted", async () => {
    const { run, neighborsAborted } = setup();
    const controller = new AbortController();
    const result = run(controller.signal);
    controller.abort();
    await expect(result).rejects.toBe(controller.signal.reason);
    expect(neighborsAborted()).toEqual(NEIGHBOR_KEYS.map(() => true));
  });

  it("stops its halo reads when the archive has no center tile", async () => {
    const { loads, run, neighborsAborted } = setup();
    const result = run();
    loads.get(tileKey(TILE))!.resolve(null);
    await result;
    expect(neighborsAborted()).toEqual(NEIGHBOR_KEYS.map(() => true));
  });

  it("stops its halo reads when the center fails", async () => {
    const { loads, run, neighborsAborted } = setup();
    const failure = new Error("network");
    const result = run();
    loads.get(tileKey(TILE))!.reject(failure);
    await expect(result).rejects.toBe(failure);
    expect(neighborsAborted()).toEqual(NEIGHBOR_KEYS.map(() => true));
  });

  it("stops a drawn tile's halo reads on releaseHalo, which deck.gl's abort() can't", async () => {
    const {
      getTileData,
      device,
      textures,
      resolveCenter,
      neighborsAborted,
      onTileRefined,
    } = setup();
    // A real deck.gl tile header, driven the way Tileset2D drives it.
    const header = new Tile2DHeader({ x: 1, y: 1, z: 2 });
    const loaded = header.loadData({
      getData: ({ index, signal }: { index: TileIndex; signal: AbortSignal }) =>
        getTileData({ index, signal } as TileLoadProps, { device, signal }),
      getRequestPriority: () => 0,
      requestScheduler: { scheduleRequest: async () => ({ done: () => {} }) },
      onLoad: () => {},
      onError: () => {},
    } as never);
    await flush();
    resolveCenter();
    await loaded;
    expect(header.isLoaded).toBe(true);

    // deck.gl ignores abort() on a loaded tile, so the halo reads run on...
    header.abort();
    await flush();
    expect(neighborsAborted()).toEqual(NEIGHBOR_KEYS.map(() => false));

    // ...until the tile is unloaded, where the app calls releaseHalo.
    (header.content as TerrainTileData).releaseHalo();
    await flush();
    expect(neighborsAborted()).toEqual(NEIGHBOR_KEYS.map(() => true));
    expect(textures[0]!.writeData).toHaveBeenCalledTimes(1);
    expect(onTileRefined).not.toHaveBeenCalled();
  });

  it("derives cellSize and mercatorYRange from the tile's zoom and row", async () => {
    const { resolveCenter, run } = setup();
    const result = run();
    resolveCenter();
    const data = await result;
    // 2 * pi * 6378137 / (2 texels * 4 tiles), and z2 row 1 is the band just
    // north of the equator.
    expect(data?.cellSize).toBeCloseTo(5009377.085697311, 6);
    expect(data?.mercatorYRange).toEqual([10018754.171394622, 0]);
    expect(data).toMatchObject({ width: 2, height: 2, byteLength: 64 });
  });
});

describe("loadTerrariumElevation", () => {
  it("returns null when the archive has no such tile", async () => {
    const source = {
      archive: { getZxy: vi.fn(async () => undefined) },
      tileSize: 512,
      mimeType: "image/webp",
    } as unknown as PMTilesSource;
    const signal = new AbortController().signal;
    await expect(
      loadTerrariumElevation({ source, tile: TILE, signal }),
    ).resolves.toBeNull();
    expect(source.archive.getZxy).toHaveBeenCalledWith(2, 1, 1, signal);
  });
});
