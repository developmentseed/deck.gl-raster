import type { _TileLoadProps as TileLoadProps } from "@deck.gl/geo-layers";
import type { Device } from "@luma.gl/core";
import { describe, expect, it, vi } from "vitest";
import type { PMTilesSource } from "../src/pmtiles/pmtiles-source.js";
import {
  loadTerrariumElevation,
  makeGetTileData,
} from "../src/terrain/get-tile-data.js";
import type { TileIndex } from "../src/terrain/neighbors.js";
import { tileKey } from "../src/terrain/neighbors.js";
import { TileBorders } from "../src/terrain/tile-borders.js";

/** The tile under test, in the middle of z2, and its northern neighbor. */
const TILE = { z: 2, x: 1, y: 1 };
const NORTH = { z: 2, x: 1, y: 0 };

type FakeTexture = {
  options: Record<string, unknown>;
  writeData: ReturnType<typeof vi.fn>;
  destroyed: boolean;
};

/** getTileData over a load whose tiles the test settles by hand. */
function setup() {
  const loads = new Map<
    string,
    { resolve: (elevation: Float32Array | null) => void }
  >();
  const load = vi.fn(
    (tile: TileIndex, signal?: AbortSignal) =>
      new Promise<Float32Array | null>((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        loads.set(tileKey(tile), { resolve });
      }),
  );
  const borders = new TileBorders({ capacity: 100 });
  const onTileRefined = vi.fn();
  const getTileData = makeGetTileData({
    load,
    borders,
    tileSize: 2,
    onTileRefined,
  });
  const textures = new Map<string, FakeTexture>();
  const device = {
    createTexture: vi.fn((options: Record<string, unknown>) => ({
      options,
      writeData: vi.fn(),
      destroyed: false,
    })),
  } as unknown as Device;

  /** Load `tile` with `values`, keeping its texture by key. */
  const loadTile = async (tile: TileIndex, values: number[] | null) => {
    const result = getTileData({ index: tile } as TileLoadProps, { device });
    loads
      .get(tileKey(tile))!
      .resolve(values ? Float32Array.from(values) : null);
    const data = await result;
    if (data) {
      textures.set(tileKey(tile), data.texture as unknown as FakeTexture);
    }
    return data;
  };

  return {
    load,
    borders,
    onTileRefined,
    getTileData,
    device,
    textures,
    loadTile,
  };
}

/** Rows of a 4-texel-wide array. */
function rows(data: unknown): number[][] {
  const values = Array.from(data as Float32Array);
  return [0, 1, 2, 3].map((r) => values.slice(r * 4, r * 4 + 4));
}

/** The halo a texture was first filled with: its first, whole-texture write. */
function uploaded(texture: FakeTexture) {
  const [data, rect] = texture.writeData.mock.calls[0]!;
  expect(rect).toBeUndefined();
  return data;
}

describe("makeGetTileData", () => {
  it("loads only the tile itself, never its neighbors", () => {
    const { load, getTileData, device } = setup();
    void getTileData({ index: TILE } as TileLoadProps, { device });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toEqual(TILE);
  });

  it("draws as soon as the tile decodes, replicating sides with no loaded neighbor", async () => {
    const { loadTile, textures } = setup();
    await loadTile(TILE, [1, 2, 3, 4]);
    expect(textures.get("2/1/1")!.options).toMatchObject({
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
    expect(rows(uploaded(textures.get("2/1/1")!))).toEqual([
      [1, 1, 2, 2],
      [1, 1, 2, 2],
      [3, 3, 4, 4],
      [3, 3, 4, 4],
    ]);
  });

  it("fills a side from a neighbor that already loaded", async () => {
    const { loadTile, textures } = setup();
    await loadTile(NORTH, [20, 20, 20, 20]);
    await loadTile(TILE, [1, 2, 3, 4]);
    expect(rows(uploaded(textures.get("2/1/1")!))[0]).toEqual([1, 20, 20, 2]);
  });

  it("rewrites only the ring when a neighbor loads later, then asks for a redraw", async () => {
    const { loadTile, textures, onTileRefined } = setup();
    await loadTile(TILE, [1, 2, 3, 4]);
    await loadTile(NORTH, [20, 20, 20, 20]);
    const writes = textures
      .get("2/1/1")!
      .writeData.mock.calls.slice(1)
      .map(([data, rect]) => [Array.from(data as Float32Array), rect]);
    expect(writes).toEqual([
      [[1, 20, 20, 2], { x: 0, y: 0, width: 4, height: 1 }],
      [[3, 3, 4, 4], { x: 0, y: 3, width: 4, height: 1 }],
      [[1, 3], { x: 0, y: 1, width: 1, height: 2 }],
      [[2, 4], { x: 3, y: 1, width: 1, height: 2 }],
    ]);
    expect(onTileRefined).toHaveBeenCalledTimes(1);
  });

  it("stops rewriting a tile after it's released", async () => {
    const { loadTile, textures, onTileRefined } = setup();
    const data = await loadTile(TILE, [1, 2, 3, 4]);
    data!.release();
    await loadTile(NORTH, [20, 20, 20, 20]);
    expect(textures.get("2/1/1")!.writeData).toHaveBeenCalledTimes(1);
    expect(onTileRefined).not.toHaveBeenCalled();
  });

  it("leaves a destroyed texture alone", async () => {
    const { loadTile, textures } = setup();
    await loadTile(TILE, [1, 2, 3, 4]);
    textures.get("2/1/1")!.destroyed = true;
    await loadTile(NORTH, [20, 20, 20, 20]);
    expect(textures.get("2/1/1")!.writeData).toHaveBeenCalledTimes(1);
  });

  it("returns null for a tile the archive lacks, and records no border", async () => {
    const { loadTile, device, borders } = setup();
    await expect(loadTile(TILE, null)).resolves.toBeNull();
    expect(device.createTexture).not.toHaveBeenCalled();
    expect(borders.get(TILE)).toBeUndefined();
  });

  it("fills a z0 tile's east and west sides from itself, across the antimeridian", async () => {
    const { loadTile, textures } = setup();
    await loadTile({ z: 0, x: 0, y: 0 }, [1, 2, 3, 4]);
    expect(rows(uploaded(textures.get("0/0/0")!))).toEqual([
      [1, 1, 2, 2],
      [2, 1, 2, 1],
      [4, 3, 4, 3],
      [3, 3, 4, 4],
    ]);
  });

  it("rejects when its load is aborted", async () => {
    const { getTileData, device } = setup();
    const controller = new AbortController();
    const result = getTileData({ index: TILE } as TileLoadProps, {
      device,
      signal: controller.signal,
    });
    controller.abort();
    await expect(result).rejects.toBe(controller.signal.reason);
  });

  it("doesn't hand the halo array to createTexture, which would keep it alive", async () => {
    const { loadTile, textures } = setup();
    await loadTile(TILE, [1, 2, 3, 4]);
    expect(textures.get("2/1/1")!.options).not.toHaveProperty("data");
  });

  it("derives cellSize and mercatorYRange from the tile's zoom and row", async () => {
    const { loadTile } = setup();
    const data = await loadTile(TILE, [1, 2, 3, 4]);
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
