import { RasterTileLayer } from "@developmentseed/deck.gl-raster";
import { describe, expect, it } from "vitest";
import { COGLayer } from "../src/cog-layer.js";
import { MosaicLayer } from "../src/mosaic-layer/mosaic-layer.js";
import { MultiCOGLayer } from "../src/multi-cog-layer.js";

describe("request throttling defaults", () => {
  it("COGLayer and MultiCOGLayer release a whole selection to the reader at once", () => {
    const cog = new COGLayer({ id: "a", source: "https://x.test/a.tif" });
    expect(cog.props).toMatchObject({ maxRequests: 256, debounceTime: 50 });

    const multi = new MultiCOGLayer({
      id: "b",
      source: { r: "https://x.test/r.tif" },
    });
    expect(multi.props).toMatchObject({ maxRequests: 256, debounceTime: 50 });
  });

  it("the base layer and the mosaic keep deck.gl's throttling", () => {
    class PlainRasterTileLayer extends RasterTileLayer {
      static override layerName = "PlainRasterTileLayer";
    }
    const plain = new PlainRasterTileLayer({ id: "p" });
    expect(plain.props).toMatchObject({ maxRequests: 6, debounceTime: 0 });

    const mosaic = new MosaicLayer({
      id: "m",
      data: [],
      renderSource: () => null,
    });
    // The mosaic sets neither: its inner TileLayer applies deck.gl's own
    // defaults, so opens stay throttled six at a time and are never debounced
    // (https://github.com/developmentseed/deck.gl-raster/issues/562).
    expect(mosaic.props.maxRequests).toBeUndefined();
    expect(
      (mosaic.props as Record<string, unknown>).debounceTime,
    ).toBeUndefined();
  });
});
