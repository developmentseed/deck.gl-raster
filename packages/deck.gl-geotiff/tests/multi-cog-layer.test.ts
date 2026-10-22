import { CompositeLayer } from "@deck.gl/core";
import {
  AffineTileset,
  AffineTilesetLevel,
  createMultiRasterTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import { Texture } from "@luma.gl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MultiCOGLayer } from "../src/multi-cog-layer.js";

/**
 * Build a {@link MultiCOGLayer} ready for direct lifecycle calls: bypasses
 * deck.gl's `LayerManager` by replacing `state` and `setState` with a plain
 * object + assign, mirroring `makeBareLayer` in the deck.gl-raster tests.
 */
function makeBareLayer(props: Record<string, unknown> = {}): MultiCOGLayer {
  const layer = new MultiCOGLayer({
    id: "multi",
    sources: { a: { url: "https://example.com/a.tif" } },
    ...props,
  } as never);
  const state: Record<string, unknown> = {};
  Object.assign(layer as object, {
    state,
    setState: (updates: Record<string, unknown>) =>
      Object.assign(state, updates),
  });
  return layer;
}

/** Run `updateState` as deck.gl does when the layer is first added. */
function runInitialUpdate(layer: MultiCOGLayer): void {
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: { dataChanged: true },
  } as never);
}

function fakeTexture(): {
  texture: Texture;
  destroy: ReturnType<typeof vi.fn>;
} {
  const destroy = vi.fn();
  const texture = Object.create(Texture.prototype) as Texture;
  Object.defineProperty(texture, "destroy", { value: destroy });
  return { texture, destroy };
}

function unloadCallback(layer: MultiCOGLayer) {
  return (
    layer as unknown as {
      _onTileUnloadCallback: () =>
        | ((tile: { content: unknown }) => void)
        | undefined;
    }
  )._onTileUnloadCallback();
}

describe("MultiCOGLayer._onTileUnloadCallback", () => {
  it("destroys every band texture and calls the user callback", () => {
    const userCalls: unknown[] = [];
    const layer = new MultiCOGLayer({
      id: "multi",
      sources: {},
      onTileUnload: (tile: unknown) => userCalls.push(tile),
    } as never);

    const cb = unloadCallback(layer);
    expect(cb).toBeTypeOf("function");

    const texA = fakeTexture();
    const texB = fakeTexture();
    const bands = new Map([
      ["a", { texture: texA.texture }],
      ["b", { texture: texB.texture }],
    ]);
    const tile = { content: { bands } };
    cb?.(tile);

    expect(texA.destroy).toHaveBeenCalledOnce();
    expect(texB.destroy).toHaveBeenCalledOnce();
    expect(userCalls).toEqual([tile]);
  });

  it("tolerates a tile with no data", () => {
    const layer = new MultiCOGLayer({ id: "multi", sources: {} } as never);
    const cb = unloadCallback(layer);
    expect(() => cb?.({ content: null })).not.toThrow();
  });
});

describe("MultiCOGLayer.updateState", () => {
  it("raises a COG open failure through onError", async () => {
    const onError = vi.fn((_error: Error) => true);
    const layer = new MultiCOGLayer({
      id: "multi",
      sources: { a: { url: "https://example.com/a.tif" } },
      onError,
    } as never);
    vi.spyOn(layer, "setState").mockImplementation(() => {});
    vi.spyOn(layer, "_parseAllSources").mockRejectedValue(new Error("boom"));

    layer.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: { dataChanged: true },
    } as never);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    const error = onError.mock.calls[0]?.[0];
    expect(error?.message).toBe("loading COG sources: boom");
    expect(error?.cause).toBeInstanceOf(Error);
  });
});

describe("MultiCOGLayer.isLoaded", () => {
  beforeEach(() => {
    // Report every sublayer as loaded, so only metadata loading decides.
    vi.spyOn(CompositeLayer.prototype, "isLoaded", "get").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is not loaded while the COG sources are opening", () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "_parseAllSources").mockReturnValue(new Promise(() => {}));

    runInitialUpdate(layer);

    expect(layer.isLoaded).toBe(false);
  });

  it("is loaded once the COG sources have opened", async () => {
    const layer = makeBareLayer();
    vi.spyOn(layer, "_parseAllSources").mockResolvedValue(undefined);

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });

  it("is loaded after a COG source fails to open", async () => {
    const layer = makeBareLayer({ onError: () => true });
    vi.spyOn(layer, "_parseAllSources").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(layer.isLoaded).toBe(true));
  });
});

/**
 * A fake single-band source with no overviews: a `size` x `size` image on
 * `tileSize` tiles, `cellSize` CRS units per pixel. Like a real GeoTIFF, it
 * returns edge tiles at full tile size when `boundless` is true (the default)
 * and clipped to the image otherwise.
 */
function fakeSource(opts: {
  size: number;
  tileSize: number;
  cellSize: number;
}) {
  const { size, tileSize, cellSize } = opts;
  const tile = (x: number, y: number, boundless = true) => {
    const width = boundless
      ? tileSize
      : Math.min(tileSize, size - x * tileSize);
    const height = boundless
      ? tileSize
      : Math.min(tileSize, size - y * tileSize);
    return {
      x,
      y,
      array: {
        layout: "pixel-interleaved",
        data: new Uint8Array(width * height),
        count: 1,
        width,
        height,
        mask: null,
        transform: [cellSize, 0, 0, 0, -cellSize, 0],
        crs: 4326,
        nodata: null,
      },
    };
  };
  const geotiff = {
    width: size,
    height: size,
    tileWidth: tileSize,
    tileHeight: tileSize,
    overviews: [],
    fetchTile: async (x: number, y: number, o?: { boundless?: boolean }) =>
      tile(x, y, o?.boundless),
    fetchTiles: async (xy: [number, number][], o?: { boundless?: boolean }) =>
      xy.map(([x, y]) => tile(x, y, o?.boundless)),
  };
  const identity = (x: number, y: number): [number, number] => [x, y];
  const tileset = new AffineTileset({
    levels: [
      new AffineTilesetLevel({
        affine: [cellSize, 0, 0, 0, -cellSize, 0],
        arrayWidth: size,
        arrayHeight: size,
        tileWidth: tileSize,
        tileHeight: tileSize,
        mpu: 1,
      }),
    ],
    projectTo3857: identity,
    projectFrom3857: identity,
    projectTo4326: identity,
    projectFrom4326: identity,
  });
  return { geotiff, tileset };
}

/** Fetch tile `(x, y)` at the only level, from sources already opened. */
function getTileData(
  sources: Record<string, ReturnType<typeof fakeSource>>,
  x: number,
  y: number,
) {
  const layer = makeBareLayer({ pool: {} });
  const entries = Object.entries(sources);
  layer.setState({
    sources: new Map(
      entries.map(([name, s]) => [name, { geotiff: s.geotiff }]),
    ),
    multiDescriptor: createMultiRasterTilesetDescriptor(
      new Map(entries.map(([name, s]) => [name, s.tileset])),
    ),
  } as never);
  const device = { createTexture: () => fakeTexture().texture };
  return layer._getTileData(
    { index: { x, y, z: 0 } } as never,
    { device } as never,
  );
}

describe("MultiCOGLayer._getTileData", () => {
  it("meshes and uploads only the image part of an edge tile", async () => {
    // A 6x6 image on 4x4 tiles: tile (1, 1) holds a 2x2 corner of data.
    const result = await getTileData(
      { a: fakeSource({ size: 6, tileSize: 4, cellSize: 1 }) },
      1,
      1,
    );
    const band = result.bands.get("a")!;
    expect([result.width, result.height]).toEqual([2, 2]);
    expect([band.width, band.height]).toEqual([2, 2]);
  });

  it("stitches a coarser band's edge tiles clipped to its image", async () => {
    // Band b has half the resolution: its one 4x4 tile holds 3x3 pixels,
    // covering the same 6x6 CRS units as band a.
    const result = await getTileData(
      {
        a: fakeSource({ size: 6, tileSize: 4, cellSize: 1 }),
        b: fakeSource({ size: 3, tileSize: 4, cellSize: 2 }),
      },
      1,
      1,
    );
    const band = result.bands.get("b")!;
    expect([band.width, band.height]).toEqual([3, 3]);
    // Tile (1, 1) covers units [4, 6] of the texture's [0, 6] each way.
    expect(band.uvTransform[0]).toBeCloseTo(2 / 3);
    expect(band.uvTransform[1]).toBeCloseTo(2 / 3);
    expect(band.uvTransform[2]).toBeCloseTo(1 / 3);
    expect(band.uvTransform[3]).toBeCloseTo(1 / 3);
  });
});
