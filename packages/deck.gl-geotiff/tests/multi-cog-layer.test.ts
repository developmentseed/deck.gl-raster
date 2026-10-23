import { readFile } from "node:fs/promises";
import { CompositeLayer } from "@deck.gl/core";
import {
  AffineTileset,
  AffineTilesetLevel,
  createMultiRasterTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import type {
  DecodedPixelInterleaved,
  RasterArray,
} from "@developmentseed/geotiff";
import { epsgResolver } from "@developmentseed/proj";
import type { Device } from "@luma.gl/core";
import { Texture } from "@luma.gl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBandTexture, MultiCOGLayer } from "../src/multi-cog-layer.js";
import { fixturePath } from "./helpers.js";

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

/**
 * Render a new {@link MultiCOGLayer} with `props`, as apps do on every render:
 * deck.gl hands the new instance the old one's `state`, then runs
 * `updateState`.
 */
function rerender(
  layer: MultiCOGLayer,
  props: Record<string, unknown>,
): MultiCOGLayer {
  const next = new MultiCOGLayer({ id: "multi", ...props } as never);
  Object.assign(next as object, {
    state: layer.state,
    setState: layer.setState,
  });
  next.updateState({
    props: next.props,
    oldProps: layer.props,
    changeFlags: {},
  } as never);
  return next;
}

/** A test fixture's bytes, to pass as a source's `url`. */
async function fixtureBytes(name: string): Promise<ArrayBuffer> {
  return new Uint8Array(await readFile(fixturePath(name, "rasterio"))).buffer;
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
    const layer = makeBareLayer({ onError });
    vi.spyOn(layer, "_parseAllSources").mockRejectedValue(new Error("boom"));

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    const error = onError.mock.calls[0]?.[0];
    expect(error?.message).toBe("loading COG sources: boom");
    expect(error?.cause).toBeInstanceOf(Error);
  });

  it("raises sources in different CRSs through onError", async () => {
    // Source a is in EPSG:4326 and b in EPSG:3857; a is finer, so it's the
    // primary.
    const onError = vi.fn((_error: Error) => true);
    const layer = makeBareLayer({
      onError,
      sources: {
        a: { url: await fixtureBytes("cog_uint8_rgba") },
        b: { url: await fixtureBytes("cog_uint8_rgba_3857") },
      },
    });

    runInitialUpdate(layer);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]?.[0].message).toBe(
      'loading COG sources: Source "b" has CRS EPSG:3857, but the primary source "a" has EPSG:4326. All MultiCOGLayer sources must share one CRS.',
    );
    expect(layer.state.sources).toBeNull();
  });

  it("keeps the new sources when the old ones finish opening last", async () => {
    // The old source is in EPSG:4326 and the new one in EPSG:3857.
    const oldSources = { old: { url: await fixtureBytes("cog_uint8_rgba") } };
    const newSources = {
      new: { url: await fixtureBytes("cog_uint8_rgba_3857") },
    };
    // Hold each CRS lookup until the test releases it.
    const lookups = new Map<number, () => void>();
    const onGeoTIFFLoad = vi.fn();
    const props = {
      epsgResolver: (epsg: number) =>
        new Promise((resolve) =>
          lookups.set(epsg, () => resolve(epsgResolver(epsg))),
        ),
      onGeoTIFFLoad,
    };

    const layer = makeBareLayer({ ...props, sources: oldSources });
    const oldParse = vi.spyOn(layer, "_parseAllSources");
    runInitialUpdate(layer);
    const next = rerender(layer, { ...props, sources: newSources });
    await vi.waitFor(() => expect(lookups.size).toBe(2));

    lookups.get(3857)!();
    await vi.waitFor(() => expect(next.state.sources).not.toBeNull());
    lookups.get(4326)!();
    await oldParse.mock.results[0]!.value;

    expect([...next.state.sources!.keys()]).toEqual(["new"]);
    expect(
      onGeoTIFFLoad.mock.calls.map(([sources]) => [...sources.keys()]),
    ).toEqual([["new"]]);
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

  it("is not loaded when the old sources finish opening first", async () => {
    let finishOld!: () => void;
    vi.spyOn(MultiCOGLayer.prototype, "_parseAllSources")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockReturnValue(new Promise(() => {}));

    const layer = makeBareLayer();
    runInitialUpdate(layer);
    const next = rerender(layer, {
      sources: { b: { url: "https://example.com/b.tif" } },
    });
    finishOld();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(next.isLoaded).toBe(false);
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
  /** Bits per sample: 8 (the default) or 16. */
  bits?: 8 | 16;
}) {
  const { size, tileSize, cellSize, bits = 8 } = opts;
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
        data:
          bits === 16
            ? new Uint16Array(width * height)
            : new Uint8Array(width * height),
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

/**
 * Fetch tile `(x, y)` at the only level, from sources already opened. The
 * default device can create and filter every texture format.
 */
function getTileData(
  sources: Record<string, ReturnType<typeof fakeSource>>,
  x: number,
  y: number,
  device: object = {
    createTexture: () => fakeTexture().texture,
    isTextureFormatSupported: () => true,
    isTextureFormatFilterable: () => true,
  },
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

  it("counts a 16-bit band's float32 bytes on a device without r16unorm", async () => {
    const formats: string[] = [];
    const device = {
      createTexture: (props: { format: string }) => {
        formats.push(props.format);
        return fakeTexture().texture;
      },
      isTextureFormatSupported: (format: string) => format !== "r16unorm",
      isTextureFormatFilterable: () => true,
      features: new Set(["float32-filterable"]),
    };
    const result = await getTileData(
      { a: fakeSource({ size: 4, tileSize: 4, cellSize: 1, bits: 16 }) },
      0,
      0,
      device,
    );
    expect(formats).toEqual(["r32float"]);
    // 4x4 pixels of 4-byte floats, not the source's 2-byte integers.
    expect(result.bands.get("a")!.byteLength).toEqual(4 * 4 * 4);
  });
});

describe("createBandTexture", () => {
  // Hands back the texture props so the test can see the format and samples.
  const device = (floatFilterable = true) =>
    ({
      createTexture: (props: unknown) => props,
      isTextureFormatSupported: () => true,
      isTextureFormatFilterable: () => true,
      features: new Set(floatFilterable ? ["float32-filterable"] : []),
    }) as unknown as Device;
  const create = (
    data: DecodedPixelInterleaved["data"],
    floatFilterable?: boolean,
  ) =>
    createBandTexture(device(floatFilterable), {
      layout: "pixel-interleaved",
      data,
      width: 2,
      height: 2,
      count: 1,
      nodata: null,
      mask: null,
      transform: [1, 0, 0, 0, -1, 0],
      crs: 4326,
    } satisfies RasterArray);
  const upload = (
    data: DecodedPixelInterleaved["data"],
    floatFilterable?: boolean,
  ) =>
    create(data, floatFilterable).texture as unknown as {
      data: unknown;
      format: string;
      sampler: { minFilter: string };
    };

  it("uploads unsigned 8- and 16-bit samples as normalised formats", () => {
    const u8 = new Uint8Array(4);
    expect(upload(u8)).toMatchObject({ data: u8, format: "r8unorm" });
    const u16 = new Uint16Array(4);
    expect(upload(u16)).toMatchObject({ data: u16, format: "r16unorm" });
  });

  it("uploads signed integers as exact float32 samples", () => {
    const { data, format } = upload(new Int16Array([-999, -32768, 0, 32767]));
    expect(format).toBe("r32float");
    expect(data).toBeInstanceOf(Float32Array);
    expect(Array.from(data as Float32Array)).toEqual([-999, -32768, 0, 32767]);
  });

  it("uploads float32 as is and narrows float64", () => {
    const f32 = new Float32Array([0.5, -1, 2, 3]);
    expect(upload(f32)).toMatchObject({ data: f32, format: "r32float" });
    const { data } = upload(new Float64Array([0.5, -1, 2, 3]));
    expect(data).toBeInstanceOf(Float32Array);
    expect(Array.from(data as Float32Array)).toEqual([0.5, -1, 2, 3]);
  });

  it("samples nearest when the device cannot filter float textures", () => {
    const f32 = new Float32Array(4);
    expect(upload(f32).sampler.minFilter).toBe("linear");
    expect(upload(f32, false).sampler.minFilter).toBe("nearest");
  });

  it("counts the float32 bytes it uploads for a signed 16-bit band", () => {
    // 2x2 pixels of 4-byte floats, not the source's 2-byte integers.
    expect(create(new Int16Array(4)).byteLength).toBe(2 * 2 * 4);
  });

  it("rejects sample types it cannot upload", () => {
    expect(() => upload(new BigInt64Array(4) as never)).toThrow(
      "Unsupported typed array type: BigInt64Array.",
    );
  });
});

/** A fake band texture's format, current filter, and device support. */
type FakeTextureOptions = {
  /** The filter its sampler uses now. */
  filter: "linear" | "nearest";
  /** @default "r8unorm" */
  format?: string;
  /** Whether its device can filter 32-bit float textures. @default true */
  float32Filterable?: boolean;
};

/**
 * A band texture as luma.gl reports it, with a spy on `setSampler`. Like
 * luma.gl's, its device claims every format is filterable; only the
 * `float32-filterable` feature tells the truth about float formats.
 */
function fakeSampledTexture(opts: FakeTextureOptions): {
  texture: Texture;
  setSampler: ReturnType<typeof vi.fn>;
} {
  const { filter, format = "r8unorm", float32Filterable = true } = opts;
  const setSampler = vi.fn();
  const device = {
    isTextureFormatFilterable: () => true,
    features: new Set(float32Filterable ? ["float32-filterable"] : []),
  };
  const texture = Object.create(Texture.prototype) as Texture;
  Object.defineProperties(texture, {
    device: { value: device },
    format: { value: format },
    sampler: { value: { props: { minFilter: filter, magFilter: filter } } },
    setSampler: { value: setSampler },
  });
  return { texture, setSampler };
}

/**
 * Render a loaded one-band tile with a texture made from `textureOptions`, as
 * `RasterTileLayer` does whenever the layer's props change, and return the
 * texture's `setSampler` spy.
 */
function renderLoadedTile(
  props: Record<string, unknown>,
  textureOptions: FakeTextureOptions,
): ReturnType<typeof vi.fn> {
  const layer = makeBareLayer(props);
  layer.setState({ multiDescriptor: {} } as never);
  const { texture, setSampler } = fakeSampledTexture(textureOptions);
  const bands = new Map([
    [
      "a",
      {
        texture,
        uvTransform: [0, 0, 1, 1],
        width: 4,
        height: 4,
        byteLength: 16,
      },
    ],
  ]);
  const renderTile = (
    layer as unknown as {
      _renderTileCallback: () => ((data: unknown) => unknown) | undefined;
    }
  )._renderTileCallback();
  renderTile?.({ bands });
  return setSampler;
}

describe("MultiCOGLayer resampling", () => {
  it("switches a loaded tile to nearest filtering", () => {
    const setSampler = renderLoadedTile(
      { resampling: "nearest" },
      { filter: "linear" },
    );
    expect(setSampler).toHaveBeenCalledWith({
      minFilter: "nearest",
      magFilter: "nearest",
    });
  });

  it("switches a loaded tile back to linear filtering by default", () => {
    const setSampler = renderLoadedTile({}, { filter: "nearest" });
    expect(setSampler).toHaveBeenCalledWith({
      minFilter: "linear",
      magFilter: "linear",
    });
  });

  it("leaves a texture alone when it already filters as requested", () => {
    const setSampler = renderLoadedTile({}, { filter: "linear" });
    expect(setSampler).not.toHaveBeenCalled();
  });

  it("keeps a float band nearest when the device can't filter floats", () => {
    // Linear filtering would leave the texture incomplete, so it reads as 0.
    const setSampler = renderLoadedTile(
      {},
      { filter: "nearest", format: "r32float", float32Filterable: false },
    );
    expect(setSampler).not.toHaveBeenCalled();
  });
});
