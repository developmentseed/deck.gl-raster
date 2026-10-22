import { describe, expectTypeOf, it } from "vitest";
import type { TextureDataT } from "../src/index.js";
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
