import { describe, expect, it, vi } from "vitest";
import { ProjectedCOGLayer } from "../src/projected-cog-layer/projected-cog-layer.js";

/**
 * A {@link ProjectedCOGLayer} ready for direct lifecycle calls, with a plain
 * `state` and a device the TileLayer factory only stores.
 */
function makeBareLayer(): ProjectedCOGLayer {
  const layer = new ProjectedCOGLayer({ id: "projected" } as never);
  const state: Record<string, unknown> = {};
  Object.assign(layer as object, {
    context: { device: {} },
    state,
    setState: (updates: Record<string, unknown>) =>
      Object.assign(state, updates),
  });
  return layer;
}

/** The id of the inner TileLayer that a custom-projection render returns. */
function innerTileLayerId(layer: ProjectedCOGLayer): string {
  const { _renderProjectedTileLayer } = layer as unknown as {
    _renderProjectedTileLayer(...args: unknown[]): { id: string };
  };
  return _renderProjectedTileLayer.call(
    layer,
    {},
    { signature: "polar" },
    vi.fn(),
    vi.fn(),
  ).id;
}

describe("ProjectedCOGLayer refetching", () => {
  it("gets a new inner TileLayer when the layer refetches its tiles", () => {
    const layer = makeBareLayer();
    const before = innerTileLayerId(layer);

    (layer as unknown as { _refetchTiles(): void })._refetchTiles();

    expect(innerTileLayerId(layer)).not.toBe(before);
  });
});
