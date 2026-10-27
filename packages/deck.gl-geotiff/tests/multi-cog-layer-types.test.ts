import { describe, expectTypeOf, it } from "vitest";
import type {
  COGInput,
  MultiCOGLayerProps,
  MultiCOGSource,
} from "../src/index.js";
import { MultiCOGLayer } from "../src/index.js";

// These assertions are checked by `tsc` (the package's `typecheck` script),
// not at runtime.
describe("MultiCOGLayer source props", () => {
  it("takes an opened MultiCOGSource or a record of COGs to open as source", () => {
    expectTypeOf<MultiCOGLayerProps["source"]>().toEqualTypeOf<
      MultiCOGSource | Record<string, COGInput>
    >();
  });

  it("passes a MultiCOGSource to onSourceLoad", () => {
    new MultiCOGLayer({
      source: { a: "https://example.com/a.tif" },
      onSourceLoad: (source) => {
        expectTypeOf(source).toEqualTypeOf<MultiCOGSource>();
      },
    });
  });

  it("draws the MultiCOGSource that its source prop takes", () => {
    expectTypeOf<MultiCOGLayer["state"]["source"]>().toEqualTypeOf<
      MultiCOGSource | undefined
    >();
  });

  it("no longer takes the props that source and MultiCOGSource.open replaced", () => {
    new MultiCOGLayer({
      // @ts-expect-error source replaces sources
      sources: { a: { url: "https://example.com/a.tif" } },
    });
    new MultiCOGLayer({
      source: { a: "https://example.com/a.tif" },
      // @ts-expect-error epsgResolver is a MultiCOGSource.open option
      epsgResolver: async () => ({ title: "EPSG:4326" }),
    });
    new MultiCOGLayer({
      source: { a: "https://example.com/a.tif" },
      // @ts-expect-error concurrencyLimiter is a MultiCOGSource.open option
      concurrencyLimiter: null,
    });
    new MultiCOGLayer({
      source: { a: "https://example.com/a.tif" },
      // @ts-expect-error onSourceLoad replaces onGeoTIFFLoad
      onGeoTIFFLoad: () => {},
    });
  });
});
