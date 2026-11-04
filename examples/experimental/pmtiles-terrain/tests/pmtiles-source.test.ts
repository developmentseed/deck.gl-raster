import { describe, expect, it } from "vitest";
import { PMTilesSource } from "../src/pmtiles/pmtiles-source.js";
import type { CountedSource } from "../src/pmtiles/read-stats.js";
import { archiveBytes } from "./pmtiles-fixture.js";

const URL_ = "https://example.com/terrain.pmtiles";

/** A byte source serving the fixture archive. */
function fixtureSource(tileType: number): CountedSource {
  const bytes = archiveBytes({ tileType });
  return {
    getKey: () => URL_,
    getBytes: async (offset: number, length: number) => ({
      data: bytes.slice(offset, offset + length),
    }),
    readStats: () => ({ requests: 0, bytesReceived: 0, sharedReads: 0 }),
  };
}

describe("PMTilesSource", () => {
  it("opens a WebP archive with its bounds and a 512 px grid", async () => {
    const source = await PMTilesSource.open({
      byteSource: fixtureSource(4),
      tileSize: 512,
    });
    expect(source.geographicBounds).toEqual({
      west: -180,
      south: -85.0511287,
      east: 180,
      north: 85.0511287,
    });
    expect(source.mimeType).toBe("image/webp");
    const { levels, projectedBounds } = source.tilesetDescriptor;
    expect(levels).toHaveLength(13);
    expect(levels[12]).toMatchObject({
      matrixWidth: 4096,
      matrixHeight: 4096,
      tileWidth: 512,
      tileHeight: 512,
    });
    // 85.0511287° is a hair short of Web Mercator's edge.
    const [minX, minY, maxX, maxY] = projectedBounds;
    expect(minX).toBeCloseTo(-20037508.34, 1);
    expect(maxX).toBeCloseTo(20037508.34, 1);
    expect(Math.abs(minY + 20037508.34)).toBeLessThan(1);
    expect(Math.abs(maxY - 20037508.34)).toBeLessThan(1);
  });

  it("opens a PNG archive as image/png", async () => {
    const source = await PMTilesSource.open({
      byteSource: fixtureSource(2),
      tileSize: 512,
    });
    expect(source.mimeType).toBe("image/png");
  });

  it("rejects vector tiles, naming the URL and the type", async () => {
    await expect(
      PMTilesSource.open({ byteSource: fixtureSource(1), tileSize: 512 }),
    ).rejects.toThrow(`${URL_} holds Mvt tiles`);
  });
});
