import { LayerManager, WebMercatorViewport } from "@deck.gl/core";
import { compose, scale, translation } from "@developmentseed/affine";
import type { Device } from "@luma.gl/core";
import { describe, expect, it, vi } from "vitest";
import type { MinimalTileData } from "../../src/raster-tile-layer/index.js";
import { RasterTileLayer } from "../../src/raster-tile-layer/index.js";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";

const identity = (x: number, y: number): [number, number] => [x, y];

/** A level of a 32 m square array centered on the origin, in EPSG:3857. */
function makeLevel(metersPerPixel: number): AffineTilesetLevel {
  const size = 32 / metersPerPixel;
  return new AffineTilesetLevel({
    affine: compose(
      translation(-16, 16),
      scale(metersPerPixel, -metersPerPixel),
    ),
    arrayWidth: size,
    arrayHeight: size,
    tileWidth: 16,
    tileHeight: 16,
    mpu: 1,
  });
}

const tilesetDescriptor = new AffineTileset({
  levels: [makeLevel(2), makeLevel(1)],
  projectTo3857: identity,
  projectFrom3857: identity,
  projectTo4326: identity,
  projectFrom4326: identity,
});

const viewport = new WebMercatorViewport({
  longitude: 0,
  latitude: 0,
  zoom: 18,
  width: 100,
  height: 100,
});

/**
 * A device that draws nothing. The layer reads only the canvas sizes from it,
 * to pick tiles for the screen's pixel ratio.
 */
const device = {
  getDefaultCanvasContext: () => ({
    getDrawingBufferSize: () => [100, 100],
    getCSSSize: () => [100, 100],
  }),
} as unknown as Device;

/** Waits for pending promise callbacks, such as tile loads, to run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** What happened to the tile loads of the first render. */
type Refetch = {
  /** The number of tiles the first render loaded. */
  loads: number;
  /** How many of those loads were aborted. */
  aborted: number;
  /** How many tiles `onTileUnload` got. */
  unloaded: number;
  /** How many loads the second render started. */
  refetched: number;
};

/**
 * Draw a `RasterTileLayer` in deck.gl's `LayerManager` with the `before`
 * triggers, then with the `after` triggers, and report what happened to the
 * loads of the first render. Each load settles only when aborted.
 */
async function changeTriggers(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<Refetch> {
  const signals: AbortSignal[] = [];
  const onTileUnload = vi.fn();
  const layerManager = new LayerManager(device, {});
  layerManager.activateViewport(viewport);
  const render = (updateTriggers: Record<string, unknown>) =>
    layerManager.setLayers([
      new RasterTileLayer<MinimalTileData>({
        id: "tiles",
        tilesetDescriptor,
        getTileData: (_tile, { signal }) => {
          signals.push(signal!);
          return new Promise<never>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason));
          });
        },
        renderTile: () => ({ renderPipeline: [] }),
        onTileUnload,
        maxRequests: 0,
        updateTriggers,
      }),
    ]);

  render(before);
  await settle();
  const first = [...signals];
  render(after);
  await settle();
  const refetch = {
    loads: first.length,
    aborted: first.filter((signal) => signal.aborted).length,
    unloaded: onTileUnload.mock.calls.length,
    refetched: signals.length - first.length,
  };
  layerManager.finalize();
  return refetch;
}

describe("RasterTileLayer refetching", () => {
  it("drops every tile and fetches the visible ones again when updateTriggers.getTileData changes", async () => {
    const refetch = await changeTriggers(
      { getTileData: [0] },
      { getTileData: [1] },
    );

    expect(refetch.loads).toBeGreaterThan(0);
    expect(refetch).toEqual({
      loads: refetch.loads,
      aborted: refetch.loads,
      unloaded: refetch.loads,
      refetched: refetch.loads,
    });
  });

  it("drops every tile and fetches the visible ones again when updateTriggers.all changes", async () => {
    const refetch = await changeTriggers({ all: [0] }, { all: [1] });

    expect(refetch.loads).toBeGreaterThan(0);
    expect(refetch).toEqual({
      loads: refetch.loads,
      aborted: refetch.loads,
      unloaded: refetch.loads,
      refetched: refetch.loads,
    });
  });

  it("keeps its tiles when updateTriggers.getTileData is equal", async () => {
    // A new array with the same contents, as an inline literal gives
    const refetch = await changeTriggers(
      { getTileData: [0] },
      { getTileData: [0] },
    );

    expect(refetch).toEqual({
      loads: refetch.loads,
      aborted: 0,
      unloaded: 0,
      refetched: 0,
    });
  });

  it("keeps its tiles when only updateTriggers.renderTile changes", async () => {
    const refetch = await changeTriggers(
      { getTileData: [0], renderTile: [0] },
      { getTileData: [0], renderTile: [1] },
    );

    expect(refetch).toEqual({
      loads: refetch.loads,
      aborted: 0,
      unloaded: 0,
      refetched: 0,
    });
  });
});
