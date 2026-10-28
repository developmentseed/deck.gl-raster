import type { MinimalTileData } from "@developmentseed/deck.gl-raster";
import { describe, expectTypeOf, it } from "vitest";
import type * as zarr from "zarrita";
import type { ZarrLayerProps, ZarrSource } from "../src/index.js";
import { ZarrLayer } from "../src/index.js";

/** A zarrita group, for the type checks below. */
declare const group: zarr.Group<zarr.Readable>;

/** Tile callbacks, for the type checks below. */
const tileCallbacks = {
  getTileData: async () => ({ width: 1, height: 1 }),
  renderTile: () => ({ renderPipeline: [] }),
};

// These assertions are checked by `tsc` (the package's `typecheck` script),
// not at runtime.
describe("ZarrLayer source props", () => {
  it("takes an opened ZarrSource, or a group or array to open, as source", () => {
    expectTypeOf<ZarrLayerProps["source"]>().toEqualTypeOf<
      ZarrSource | zarr.Group<zarr.Readable> | zarr.Array<zarr.DataType>
    >();
  });

  it("draws the ZarrSource that its source prop takes", () => {
    expectTypeOf<ZarrLayer["state"]["source"]>().toEqualTypeOf<
      ZarrSource | undefined
    >();
    expectTypeOf<
      ZarrLayer<MinimalTileData, "int8">["state"]["source"]
    >().toEqualTypeOf<ZarrSource<"int8"> | undefined>();
  });

  it("passes a ZarrSource to onSourceLoad", () => {
    () =>
      new ZarrLayer({
        source: group,
        selection: {},
        ...tileCallbacks,
        onSourceLoad: (source) => {
          expectTypeOf(source).toEqualTypeOf<ZarrSource>();
        },
      });
  });

  it("no longer takes the props that source and ZarrSource.open replaced", () => {
    () =>
      new ZarrLayer({
        // @ts-expect-error source replaces node
        node: group,
        selection: {},
        ...tileCallbacks,
      });
    () =>
      new ZarrLayer({
        source: group,
        selection: {},
        ...tileCallbacks,
        // @ts-expect-error variable is a ZarrSource.open option
        variable: "temperature",
      });
    () =>
      new ZarrLayer({
        source: group,
        selection: {},
        ...tileCallbacks,
        // @ts-expect-error geoZarrMetadata, a ZarrSource.open option, replaces metadata
        metadata: {},
      });
    () =>
      new ZarrLayer({
        source: group,
        selection: {},
        ...tileCallbacks,
        // @ts-expect-error epsgResolver is a ZarrSource.open option
        epsgResolver: async () => ({ title: "EPSG:4326" }),
      });
  });

  it("takes nothing else as source", () => {
    () =>
      // @ts-expect-error a string is neither a ZarrSource nor a zarrita node
      new ZarrLayer({ source: "x.zarr", selection: {}, ...tileCallbacks });
  });
});
