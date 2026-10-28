/**
 * Network test for https://github.com/source-cooperative/cog-viewer/issues/20
 *
 * A user reported that LERC-compressed DEM COGs hosted on source.coop fail to
 * render in the COG viewer. This exercises the same read path the viewer uses
 * (`GeoTIFF.fromUrl` → `fetchTile` → the LERC codec) against one of the
 * reported files.
 *
 * Hits the network, so it is skipped unless `NETWORK_TESTS=1` is set:
 *
 *     NETWORK_TESTS=1 pnpm vitest run tests/lerc-remote.test.ts
 */

import { Compression, TiffTag } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { toBandSeparate } from "../src/array.js";
import { GeoTIFF } from "../src/geotiff.js";

const TIFF_URL =
  "https://data.source.coop/rebalance-earth/ea-dem/DTM/NT80ne_DTM_1m.tif";

const describeNetwork = process.env.NETWORK_TESTS ? describe : describe.skip;

describeNetwork("source.coop LERC DEM (cog-viewer#20)", () => {
  it("opens the file and reports LERC compression", async () => {
    const tiff = await GeoTIFF.fromUrl(TIFF_URL);

    expect(tiff.image.value(TiffTag.Compression)).toBe(Compression.Lerc);
    expect(tiff.width).toBeGreaterThan(0);
    expect(tiff.height).toBeGreaterThan(0);
    expect(tiff.isTiled).toBe(true);
    expect(tiff.overviews.length).toBeGreaterThan(0);
  }, 60_000);

  it("decodes a full-resolution tile", async () => {
    const tiff = await GeoTIFF.fromUrl(TIFF_URL);
    const tile = await tiff.fetchTile(0, 0);

    expect(tile.array.width).toBe(tiff.tileWidth);
    expect(tile.array.height).toBe(tiff.tileHeight);
    expect(tile.array.count).toBe(tiff.count);

    const { bands } = toBandSeparate(tile.array);
    expect(bands.length).toBe(tiff.count);
    expect(bands[0]!.length).toBe(tiff.tileWidth * tiff.tileHeight);

    // A DTM tile should hold plausible elevations, not all-nodata garbage.
    const valid = Array.from(bands[0]!).filter(
      (v) => Number.isFinite(v) && v !== tiff.nodata,
    );
    expect(valid.length).toBeGreaterThan(0);
    expect(valid.reduce((a, b) => Math.min(a, b))).toBeGreaterThan(-500);
    expect(valid.reduce((a, b) => Math.max(a, b))).toBeLessThan(9000);
  }, 60_000);

  it("decodes a tile from the coarsest overview", async () => {
    const tiff = await GeoTIFF.fromUrl(TIFF_URL);

    const overview = tiff.overviews.at(-1)!;
    const tile = await overview.fetchTile(0, 0);
    const { bands } = toBandSeparate(tile.array);
    expect(bands[0]!.length).toBeGreaterThan(0);
  }, 60_000);
});
