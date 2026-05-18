import { SourceFile } from "@chunkd/source-file";
import { describe, expect, it } from "vitest";
import { GeoTIFF } from "../src/geotiff.js";
import type { ConcurrencyLimiter } from "../src/limiter.js";
import { fixturePath } from "./helpers.js";

/** A limiter that records every acquire and lets `maxConcurrent` run at once. */
function makeCountingLimiter(maxConcurrent = Number.POSITIVE_INFINITY) {
  let acquired = 0;
  let active = 0;
  let peak = 0;
  const waiters: Array<() => void> = [];
  const limiter: ConcurrencyLimiter = {
    acquire: () =>
      new Promise<() => void>((resolve) => {
        const grant = () => {
          acquired++;
          active++;
          peak = Math.max(peak, active);
          resolve(() => {
            active--;
            const next = waiters.shift();
            if (next) {
              next();
            }
          });
        };
        if (active < maxConcurrent) {
          grant();
        } else {
          waiters.push(grant);
        }
      }),
  };
  return { limiter, stats: () => ({ acquired, peak }) };
}

const GRID: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

describe("GeoTIFF.open({ concurrencyLimiter })", () => {
  it("routes tile-data fetches through the limiter (header reads are not gated)", async () => {
    const { limiter, stats } = makeCountingLimiter();
    const path = fixturePath("uint8_rgb_deflate_block64_cog", "rasterio");
    const tiff = await GeoTIFF.open({
      dataSource: new SourceFile(path),
      headerSource: new SourceFile(path),
      concurrencyLimiter: limiter,
    });
    expect(stats().acquired).toBe(0); // header/IFD reads bypass it
    await tiff.fetchTiles(GRID);
    expect(stats().acquired).toBeGreaterThan(0); // tile-data reads go through it
  });

  it("with a 1-slot limiter, never runs two fetches at once", async () => {
    const { limiter, stats } = makeCountingLimiter(1);
    const path = fixturePath("uint8_rgb_deflate_block64_cog", "rasterio");
    const tiff = await GeoTIFF.open({
      dataSource: new SourceFile(path),
      headerSource: new SourceFile(path),
      concurrencyLimiter: limiter,
    });
    await tiff.fetchTiles(GRID);
    expect(stats().peak).toBe(1);
  });

  it("without a limiter, behaves exactly as before (smoke)", async () => {
    const path = fixturePath("uint8_rgb_deflate_block64_cog", "rasterio");
    const tiff = await GeoTIFF.open({
      dataSource: new SourceFile(path),
      headerSource: new SourceFile(path),
    });
    const tiles = await tiff.fetchTiles(GRID);
    expect(tiles).toHaveLength(4);
  });
});
