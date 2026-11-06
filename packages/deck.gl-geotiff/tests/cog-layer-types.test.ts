import { describe, expectTypeOf, it } from "vitest";
import type {
  COGInput,
  COGLayerProps,
  COGSource,
  TextureDataT,
} from "../src/index.js";
import { COGLayer } from "../src/index.js";

// These assertions are checked by `tsc` (the package's `typecheck` script),
// not at runtime.
describe("COGLayer default tile data type", () => {
  it("defaults to TextureDataT when getTileData is omitted", () => {
    const layer = new COGLayer({ source: "https://example.com/x.tif" });
    expectTypeOf(layer).toEqualTypeOf<COGLayer<TextureDataT>>();
  });

  it("passes TextureDataT, including the mask, to tile callbacks", () => {
    new COGLayer({
      source: "https://example.com/x.tif",
      onTileUnload: (tile) => {
        expectTypeOf(tile.content).toEqualTypeOf<TextureDataT | null>();
      },
    });
  });
});

describe("COGLayer source props", () => {
  it("takes an opened COGSource or a COG to open as source", () => {
    expectTypeOf<COGLayerProps["source"]>().toEqualTypeOf<
      COGSource | COGInput
    >();
  });

  it("passes a COGSource to onSourceLoad", () => {
    new COGLayer({
      source: "https://example.com/x.tif",
      onSourceLoad: (source) => {
        expectTypeOf(source).toEqualTypeOf<COGSource>();
      },
    });
  });

  it("draws the COGSource that its source prop takes", () => {
    expectTypeOf<COGLayer["state"]["source"]>().toEqualTypeOf<
      COGSource | undefined
    >();
  });

  it("takes nothing else as source", () => {
    // @ts-expect-error a number is neither a COGSource nor a COG to open
    new COGLayer({ source: 42 });
  });

  it("no longer takes the props that source and COGSource.open replaced", () => {
    new COGLayer({
      source: "https://example.com/x.tif",
      // @ts-expect-error epsgResolver is a COGSource.open option
      epsgResolver: async () => ({ title: "EPSG:4326" }),
    });
    new COGLayer({
      source: "https://example.com/x.tif",
      // @ts-expect-error concurrencyLimiter is a COGSource.open option
      concurrencyLimiter: null,
    });
    new COGLayer({
      source: "https://example.com/x.tif",
      // @ts-expect-error onSourceLoad replaces onGeoTIFFLoad
      onGeoTIFFLoad: () => {},
    });
    new COGLayer({
      // @ts-expect-error source replaces geotiff
      geotiff: "https://example.com/x.tif",
    });
  });
});
