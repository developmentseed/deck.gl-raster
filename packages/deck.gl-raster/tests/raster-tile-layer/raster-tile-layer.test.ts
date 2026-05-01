import { describe, expect, it } from "vitest";
import type { RasterTileLayerProps } from "../../src/raster-tile-layer/index.js";
import { RasterTileLayer } from "../../src/raster-tile-layer/index.js";

describe("RasterTileLayer", () => {
  it("is importable and has the expected layerName", () => {
    expect(RasterTileLayer.layerName).toBe("RasterTileLayer");
  });

  it("exposes defaults for maxError, debug, and debugOpacity", () => {
    const dp = RasterTileLayer.defaultProps as Partial<RasterTileLayerProps>;
    expect(dp.maxError).toBe(0.125);
    expect(dp.debug).toBe(false);
    expect(dp.debugOpacity).toBe(0.5);
  });

  it("can be constructed with no props without throwing", () => {
    expect(() => new RasterTileLayer({ id: "test" })).not.toThrow();
  });

  it("exposes a _renderExtraSubLayers hook returning [] by default", () => {
    class ProbeLayer extends RasterTileLayer {
      callExtra(tile: unknown, data: unknown) {
        return (
          this as unknown as {
            _renderExtraSubLayers: (t: unknown, d: unknown) => unknown[];
          }
        )._renderExtraSubLayers(tile, data);
      }
    }
    const layer = new ProbeLayer({ id: "probe" });
    expect(layer.callExtra({}, { width: 1, height: 1 })).toEqual([]);
  });
});
