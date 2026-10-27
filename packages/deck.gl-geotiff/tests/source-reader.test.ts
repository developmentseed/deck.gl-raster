import { readFile } from "node:fs/promises";
import { RangeReader } from "@developmentseed/range-reader";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COGSource } from "../src/cog-source.js";
import { DEFAULT_RANGE_READER } from "../src/default-range-reader.js";
import { MultiCOGSource } from "../src/multi-cog-source.js";
import { fixturePath, loadGeoTIFF } from "./helpers.js";
import { fixtureServer } from "./utils/fixture-server.js";

const URL_A = "https://x.test/a.tif";
const URL_B = "https://x.test/b.tif";

async function fixture(): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(fixturePath("cog_uint8_rgba", "rasterio")),
  );
}

describe("COGSource.open with a range reader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens through the reader it is given and sends requestInit on every request", async () => {
    const server = fixtureServer(await fixture());
    const reader = new RangeReader({ fetch: server.fetch });

    const source = await COGSource.open(URL_A, {
      reader,
      requestInit: { headers: { authorization: "Bearer t" } },
    });

    expect(source.geotiff.crs).toBe(4326);
    expect(server.requests.length).toBeGreaterThan(0);
    for (const headers of server.headers) {
      expect(headers.get("authorization")).toBe("Bearer t");
    }
    expect(reader.stats.requests).toBeGreaterThan(0);
  });

  it("defaults to the shared reader", async () => {
    const server = fixtureServer(await fixture());
    vi.stubGlobal("fetch", server.fetch);
    const before = DEFAULT_RANGE_READER.stats.requests;

    await COGSource.open(URL_A);

    expect(DEFAULT_RANGE_READER.stats.requests).toBeGreaterThan(before);
    expect(server.requests.length).toBeGreaterThan(0);
  });

  it("ignores reader and requestInit for an opened GeoTIFF or an ArrayBuffer", async () => {
    const server = fixtureServer(await fixture());
    const reader = new RangeReader({ fetch: server.fetch });
    const options = { reader, requestInit: { headers: { x: "1" } } };

    const fromGeoTIFF = await COGSource.open(
      await loadGeoTIFF("cog_uint8_rgba", "rasterio"),
      options,
    );
    const bytes = await readFile(fixturePath("cog_uint8_rgba", "rasterio"));
    const fromBuffer = await COGSource.open(
      new Uint8Array(bytes).buffer,
      options,
    );

    expect(fromGeoTIFF.geotiff.crs).toBe(4326);
    expect(fromBuffer.geotiff.crs).toBe(4326);
    expect(server.requests).toHaveLength(0);
  });

  it("keeps two inits of one URL apart in the shared cache", async () => {
    const server = fixtureServer(await fixture());
    const reader = new RangeReader({ fetch: server.fetch });

    await COGSource.open(URL_A, {
      reader,
      requestInit: { headers: { authorization: "Bearer one" } },
    });
    const afterFirst = server.requests.length;
    await COGSource.open(URL_A, {
      reader,
      requestInit: { headers: { authorization: "Bearer two" } },
    });

    // The second identity shares no cached byte with the first, so it had
    // to read the header again.
    expect(server.requests.length).toBeGreaterThan(afterFirst);
    expect(server.headers.at(-1)?.get("authorization")).toBe("Bearer two");
  });

  it("MultiCOGSource.open forwards the same options to every file", async () => {
    const server = fixtureServer(await fixture());
    const hrefs: string[] = [];
    const recording = ((input: RequestInfo | URL, init?: RequestInit) => {
      hrefs.push(String(input));
      return server.fetch(input, init);
    }) as typeof fetch;
    const reader = new RangeReader({ fetch: recording });

    await MultiCOGSource.open(
      { r: URL_A, g: URL_B },
      { reader, requestInit: { headers: { authorization: "Bearer t" } } },
    );

    expect(hrefs.some((h) => h === URL_A)).toBe(true);
    expect(hrefs.some((h) => h === URL_B)).toBe(true);
    for (const headers of server.headers) {
      expect(headers.get("authorization")).toBe("Bearer t");
    }
  });
});
