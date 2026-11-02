import { RasterTileLayer } from "@developmentseed/deck.gl-raster";
import { describe, expect, it } from "vitest";
import { PMTilesTerrainLayer } from "../src/pmtiles-terrain-layer.js";

/** The protected hook #809 adds, reached for the test. */
type WithAbortHook = { _abortUnwantedLoads(): boolean };

describe("PMTilesTerrainLayer", () => {
  it("turns on aborting unwanted loads, which RasterTileLayer leaves off", () => {
    const layer = new PMTilesTerrainLayer({ id: "terrain" });
    const base = new RasterTileLayer({ id: "base" });
    expect((layer as unknown as WithAbortHook)._abortUnwantedLoads()).toBe(
      true,
    );
    expect((base as unknown as WithAbortHook)._abortUnwantedLoads()).toBe(
      false,
    );
  });
});
