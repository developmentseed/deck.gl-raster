import { readFile } from "node:fs/promises";
import { GeoTIFF } from "@developmentseed/geotiff";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONCURRENCY_LIMITER } from "../src/default-concurrency-limiter.js";
import type { SceneFile } from "../src/multi-cog-source.js";
import { checkSameScene, MultiCOGSource } from "../src/multi-cog-source.js";
import { fixturePath, loadGeoTIFF } from "./helpers.js";

/** The bounds of a Sentinel-2 tile in UTM zone 33N, in meters. */
const TILE: [number, number, number, number] = [
  600000, 5090220, 709800, 5200020,
];

/** A file on `TILE` with `size`-meter pixels, in `crs`. */
function sceneFile(
  size: number,
  options: { crs?: SceneFile["crs"]; bbox?: SceneFile["bbox"] } = {},
): SceneFile {
  return {
    crs: options.crs ?? 32633,
    bbox: options.bbox ?? TILE,
    transform: [size, 0, TILE[0], 0, -size, TILE[3]],
  };
}

describe("checkSameScene", () => {
  it("accepts Sentinel-2-like 10, 20 and 60 m bands of one tile", () => {
    const files = new Map([
      ["b02", sceneFile(10)],
      ["b05", sceneFile(20)],
      ["b01", sceneFile(60)],
    ]);

    expect(() => checkSameScene(files)).not.toThrow();
  });

  it("accepts edges within one pixel of the coarser file", () => {
    // A 15 m band whose right edge is 20 m short: within the 30 m pixel, but
    // not within the 15 m one
    const pan: SceneFile["bbox"] = [TILE[0], TILE[1], TILE[2] - 20, TILE[3]];
    const files = new Map([
      ["red", sceneFile(30)],
      ["pan", sceneFile(15, { bbox: pan })],
    ]);

    expect(() => checkSameScene(files)).not.toThrow();
  });

  it("rejects files in different CRSs, naming them", () => {
    const files = new Map([
      ["a", sceneFile(10)],
      ["b", sceneFile(10, { crs: 32634 })],
    ]);

    expect(() => checkSameScene(files)).toThrow(
      /"b".*EPSG:32634.*"a".*EPSG:32633|"a".*EPSG:32633.*"b".*EPSG:32634/,
    );
  });

  it("rejects an edge more than one pixel of the coarser file away", () => {
    const shifted: SceneFile["bbox"] = [
      TILE[0] + 61,
      TILE[1],
      TILE[2],
      TILE[3],
    ];
    const files = new Map([
      ["a", sceneFile(10)],
      ["b", sceneFile(60, { bbox: shifted })],
    ]);

    expect(() => checkSameScene(files)).toThrow(/"b".*"a"|"a".*"b"/);
  });

  it("rejects the same CRS given as an EPSG code and as WKT", () => {
    const wkt =
      'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';
    const files = new Map([
      ["a", sceneFile(10, { crs: 4326 })],
      ["b", sceneFile(10, { crs: wkt })],
    ]);

    expect(() => checkSameScene(files)).toThrow(/EPSG:4326/);
    expect(() => checkSameScene(files)).toThrow(/WKT/);
  });

  it("accepts PROJJSON CRSs equal by value", () => {
    const projjson = () =>
      ({ type: "ProjectedCRS", name: "WGS 84 / UTM zone 33N" }) as never;
    const files = new Map([
      ["a", sceneFile(10, { crs: projjson() })],
      ["b", sceneFile(20, { crs: projjson() })],
    ]);

    expect(() => checkSameScene(files)).not.toThrow();
  });
});

describe("MultiCOGSource.open", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens the files of one scene and groups their tile grids", async () => {
    // In EPSG:4326, with a bounding box of (0, -2.56, 2.56, 0)
    const geotiff = await loadGeoTIFF("cog_uint8_rgba", "rasterio");
    const bytes = await readFile(fixturePath("cog_uint8_rgba", "rasterio"));

    const source = await MultiCOGSource.open({
      a: geotiff,
      b: new Uint8Array(bytes).buffer,
    });

    expect([...source.geotiffs.keys()]).toEqual(["a", "b"]);
    expect(source.multiTilesetDescriptor.primaryKey).toBe("a");
    expect(source.tilesetDescriptor).toBe(
      source.multiTilesetDescriptor.primary,
    );
    const { west, south, east, north } = source.geographicBounds;
    expect(west).toBeCloseTo(0, 9);
    expect(south).toBeCloseTo(-2.56, 9);
    expect(east).toBeCloseTo(2.56, 9);
    expect(north).toBeCloseTo(0, 9);
  });

  it("opens a record of one file", async () => {
    const geotiff = await loadGeoTIFF("cog_uint8_rgba", "rasterio");

    const source = await MultiCOGSource.open({ only: geotiff });

    expect(source.multiTilesetDescriptor.primaryKey).toBe("only");
  });

  it("rejects files in different CRSs before resolving either", async () => {
    const resolver = vi.fn();

    const opening = MultiCOGSource.open(
      {
        a: await loadGeoTIFF("cog_uint8_rgba", "rasterio"),
        b: await loadGeoTIFF("cog_uint8_rgba_3857", "rasterio"),
      },
      { epsgResolver: resolver },
    );

    await expect(opening).rejects.toThrow(/"b".*"a"|"a".*"b"/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("names the file that fails to open", async () => {
    const geotiff = await loadGeoTIFF("cog_uint8_rgba", "rasterio");
    const boom = new Error("boom");
    vi.spyOn(GeoTIFF, "fromUrl").mockImplementation(async (url) => {
      if (String(url).includes("nir")) {
        throw boom;
      }
      return geotiff;
    });

    const opening = MultiCOGSource.open({
      red: "https://example.com/red.tif",
      nir: "https://example.com/nir.tif",
    });

    await expect(opening).rejects.toMatchObject({
      message: 'Failed to open "nir" (https://example.com/nir.tif): boom',
      cause: boom,
    });
  });

  it("keeps an abort during a header read an AbortError", async () => {
    const controller = new AbortController();
    // Abort while the header read is in flight, through the real transport,
    // which wraps a failed fetch in its own error
    vi.stubGlobal("fetch", async () => {
      controller.abort();
      throw controller.signal.reason;
    });

    const opening = MultiCOGSource.open(
      { nir: "https://example.com/nir.tif" },
      { signal: controller.signal },
    );

    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    await expect(opening).rejects.not.toThrow(/Failed to/);
  });

  it("opens URLs through the shared limiter by default", async () => {
    const fromUrl = vi
      .spyOn(GeoTIFF, "fromUrl")
      .mockResolvedValue(await loadGeoTIFF("cog_uint8_rgba", "rasterio"));
    const { signal } = new AbortController();
    const getPriority = () => 0;

    await MultiCOGSource.open(
      { a: "https://example.com/a.tif" },
      { signal, getPriority },
    );

    expect(fromUrl).toHaveBeenCalledWith("https://example.com/a.tif", {
      concurrencyLimiter: DEFAULT_CONCURRENCY_LIMITER,
      getPriority,
      signal,
    });
  });

  it("rejects an empty record", async () => {
    await expect(MultiCOGSource.open({})).rejects.toThrow(/at least one/);
  });
});
