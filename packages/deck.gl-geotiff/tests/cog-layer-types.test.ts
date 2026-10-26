import { describe, expectTypeOf, it } from "vitest";
import type { COGLayerProps, COGSource, TextureDataT } from "../src/index.js";
import { COGLayer } from "../src/index.js";

// These assertions are checked by `tsc` (the package's `typecheck` script),
// not at runtime.
describe("COGLayer default tile data type", () => {
  it("defaults to TextureDataT when getTileData is omitted", () => {
    const layer = new COGLayer({ geotiff: "https://example.com/x.tif" });
    expectTypeOf(layer).toEqualTypeOf<COGLayer<TextureDataT>>();
  });

  it("passes TextureDataT, including the mask, to tile callbacks", () => {
    new COGLayer({
      geotiff: "https://example.com/x.tif",
      onTileUnload: (tile) => {
        expectTypeOf(tile.content).toEqualTypeOf<TextureDataT | null>();
      },
    });
  });
});

describe("COGLayer source props", () => {
  it("takes a COGSource as source", () => {
    expectTypeOf<COGLayerProps["source"]>().toEqualTypeOf<
      COGSource | undefined
    >();
  });

  it("passes a COGSource to onSourceLoad", () => {
    new COGLayer({
      geotiff: "https://example.com/x.tif",
      onSourceLoad: (source) => {
        expectTypeOf(source).toEqualTypeOf<COGSource>();
      },
    });
  });

  it("no longer takes the props that moved to COGSource.open", () => {
    new COGLayer({
      geotiff: "https://example.com/x.tif",
      // @ts-expect-error epsgResolver is a COGSource.open option
      epsgResolver: async () => ({ title: "EPSG:4326" }),
    });
    new COGLayer({
      geotiff: "https://example.com/x.tif",
      // @ts-expect-error concurrencyLimiter is a COGSource.open option
      concurrencyLimiter: null,
    });
    new COGLayer({
      geotiff: "https://example.com/x.tif",
      // @ts-expect-error onSourceLoad replaces onGeoTIFFLoad
      onGeoTIFFLoad: () => {},
    });
  });
});
