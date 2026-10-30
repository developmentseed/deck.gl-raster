import type { CompositeLayerProps, LayerDataSource } from "@deck.gl/core";
import { describe, expectTypeOf, it } from "vitest";
import type { COGSource, MosaicItem, MosaicLayerProps } from "../src/index.js";
import { COGLayer, MosaicLayer } from "../src/index.js";

type Item = MosaicItem & { url: string };
const item: Item = { bbox: [0, 0, 1, 1], url: "https://example.com/a.tif" };

// These assertions are checked by `tsc` (the package's `typecheck` script),
// not at runtime.
describe("MosaicLayer props", () => {
  it("takes its items as data", () => {
    expectTypeOf<MosaicLayerProps<Item>["data"]>().toEqualTypeOf<
      LayerDataSource<Item>
    >();
  });

  it("passes each item and its opened source to renderSource", () => {
    new MosaicLayer<Item, COGSource>({
      data: [item],
      renderSource: (renderedItem, { source }) => {
        expectTypeOf(renderedItem).toEqualTypeOf<Item>();
        expectTypeOf(source).toEqualTypeOf<COGSource | undefined>();
        return null;
      },
    });
  });

  it("gives renderSource the source and its sublayer props, and no abort signal", () => {
    expectTypeOf<
      Parameters<MosaicLayerProps<Item, COGSource>["renderSource"]>[1]
    >().toEqualTypeOf<{
      source?: COGSource;
      subLayerProps: Omit<
        Partial<CompositeLayerProps>,
        "id" | "data" | "updateTriggers"
      >;
    }>();
  });

  it("lets renderSource spread its sublayer props into a COGLayer", () => {
    new MosaicLayer<Item, COGSource>({
      data: [item],
      renderSource: (renderedItem, { source, subLayerProps }) =>
        source
          ? new COGLayer({ ...subLayerProps, id: renderedItem.url, source })
          : null,
    });
  });

  it("reports each item with its source to onViewportLoad", () => {
    new MosaicLayer<Item, COGSource>({
      data: [item],
      renderSource: () => null,
      onViewportLoad: (entries) => {
        expectTypeOf(entries).toEqualTypeOf<
          Array<{ item: Item; source?: COGSource }>
        >();
      },
    });
  });

  it("no longer takes sources", () => {
    new MosaicLayer<Item>({
      // @ts-expect-error data replaces sources
      sources: [item],
      renderSource: () => null,
    });
  });
});
