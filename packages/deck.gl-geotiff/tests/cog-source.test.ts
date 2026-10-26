import { readFile } from "node:fs/promises";
import { GeoTIFF } from "@developmentseed/geotiff";
import { epsgResolver } from "@developmentseed/proj";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COGSource } from "../src/cog-source.js";
import { DEFAULT_CONCURRENCY_LIMITER } from "../src/default-concurrency-limiter.js";
import { fixturePath, loadGeoTIFF } from "./helpers.js";

describe("COGSource.open", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a GeoTIFF and builds its tile grid and bounds", async () => {
    // In EPSG:4326, with a bounding box of (0, -2.56, 2.56, 0)
    const geotiff = await loadGeoTIFF("cog_uint8_rgba", "rasterio");

    const source = await COGSource.open(geotiff);

    expect(source.geotiff).toBe(geotiff);
    expect(source.tilesetDescriptor.levels).toHaveLength(
      geotiff.overviews.length + 1,
    );
    const { west, south, east, north } = source.geographicBounds;
    expect(west).toBeCloseTo(0, 9);
    expect(south).toBeCloseTo(-2.56, 9);
    expect(east).toBeCloseTo(2.56, 9);
    expect(north).toBeCloseTo(0, 9);
  });

  it("resolves an EPSG code with epsgResolver", async () => {
    const geotiff = await loadGeoTIFF("cog_uint8_rgba_3857", "rasterio");
    const resolver = vi.fn(epsgResolver);

    const source = await COGSource.open(geotiff, { epsgResolver: resolver });

    expect(resolver).toHaveBeenCalledWith(3857);
    expect(source.projection).toBe(await resolver.mock.results[0]!.value);
  });

  it("parses a CRS that isn't an EPSG code without the resolver", async () => {
    // NLCD's user-defined Albers projection on 96°W: the image's top-left
    // corner, at (-2415585, 3314805), is near 129.3°W, 49.0°N
    const geotiff = await loadGeoTIFF("nlcd_landcover", "nlcd");
    const resolver = vi.fn();

    const source = await COGSource.open(geotiff, { epsgResolver: resolver });

    expect(resolver).not.toHaveBeenCalled();
    expect(source.geographicBounds.west).toBeCloseTo(-129.3, 0);
    expect(source.geographicBounds.north).toBeCloseTo(49.0, 0);
  });

  it("opens an ArrayBuffer", async () => {
    const bytes = await readFile(fixturePath("cog_uint8_rgba", "rasterio"));

    const source = await COGSource.open(new Uint8Array(bytes).buffer);

    expect(source.geotiff.crs).toBe(4326);
  });

  it("opens a URL through the shared limiter by default", async () => {
    const fromUrl = vi
      .spyOn(GeoTIFF, "fromUrl")
      .mockResolvedValue(await loadGeoTIFF("cog_uint8_rgba", "rasterio"));
    const { signal } = new AbortController();
    const getPriority = () => 0;

    await COGSource.open("https://example.com/a.tif", { signal, getPriority });
    const url = new URL("https://example.com/b.tif");
    await COGSource.open(url);

    expect(fromUrl.mock.calls).toEqual([
      [
        "https://example.com/a.tif",
        {
          concurrencyLimiter: DEFAULT_CONCURRENCY_LIMITER,
          getPriority,
          signal,
        },
      ],
      [
        url,
        {
          concurrencyLimiter: DEFAULT_CONCURRENCY_LIMITER,
          getPriority: undefined,
          signal: undefined,
        },
      ],
    ]);
  });

  it("passes a null concurrencyLimiter through", async () => {
    const fromUrl = vi
      .spyOn(GeoTIFF, "fromUrl")
      .mockResolvedValue(await loadGeoTIFF("cog_uint8_rgba", "rasterio"));

    await COGSource.open("https://example.com/a.tif", {
      concurrencyLimiter: null,
    });

    expect(fromUrl).toHaveBeenCalledWith(
      "https://example.com/a.tif",
      expect.objectContaining({ concurrencyLimiter: null }),
    );
  });

  it("rejects with an AbortError when aborted while resolving the CRS", async () => {
    const geotiff = await loadGeoTIFF("cog_uint8_rgba", "rasterio");
    const controller = new AbortController();
    let lookupStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      lookupStarted = resolve;
    });
    let finishLookup!: () => void;
    const lookup = new Promise<void>((resolve) => {
      finishLookup = resolve;
    });

    const opening = COGSource.open(geotiff, {
      signal: controller.signal,
      epsgResolver: async (epsg) => {
        lookupStarted();
        await lookup;
        return epsgResolver(epsg);
      },
    });
    await started;
    controller.abort();
    finishLookup();

    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects before reading anything when its signal is already aborted", async () => {
    const fromUrl = vi
      .spyOn(GeoTIFF, "fromUrl")
      .mockRejectedValue(new Error("unexpected read"));

    const opening = COGSource.open("https://example.com/a.tif", {
      signal: AbortSignal.abort(),
    });

    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    expect(fromUrl).not.toHaveBeenCalled();
  });
});
