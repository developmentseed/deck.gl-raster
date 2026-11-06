import { WebMercatorViewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { compose, scale, translation } from "@developmentseed/affine";
import { describe, expect, it } from "vitest";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";

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

const descriptor = new AffineTileset({
  levels: [makeLevel(2), makeLevel(1)],
  projectTo3857: identity,
  projectFrom3857: identity,
  projectTo4326: identity,
  projectFrom4326: identity,
});

/** Over the array. */
const HERE = new WebMercatorViewport({
  longitude: 0,
  latitude: 0,
  zoom: 18,
  width: 100,
  height: 100,
});

/** Nowhere near it: nothing is selected. */
const FAR = new WebMercatorViewport({
  longitude: 90,
  latitude: 45,
  zoom: 18,
  width: 100,
  height: 100,
});

/** Waits for pending promise callbacks, such as tile loads, to run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A tileset whose tiles never finish loading, recording each load's signal.
 * `maxRequests: 0` keeps deck.gl's own pruning out of the way.
 */
function makeTileset(abortUnwantedLoads: boolean) {
  const signals: AbortSignal[] = [];
  const getTileData: Tileset2DProps["getTileData"] = (tile) => {
    signals.push(tile.signal!);
    return new Promise(() => {});
  };
  const tileset = new RasterTileset2D(
    { getTileData, onTileUnload: () => {}, maxRequests: 0 },
    descriptor,
    { abortUnwantedLoads },
  );
  return { tileset, signals };
}

describe("RasterTileset2D abort of unwanted loads", () => {
  it("aborts loading tiles that leave the selection and are not visible", async () => {
    const { tileset, signals } = makeTileset(true);
    tileset.update(HERE);
    await settle();
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.some((signal) => signal.aborted)).toBe(false);

    tileset.update(FAR);
    await settle();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("leaves them loading when the option is off", async () => {
    const { tileset, signals } = makeTileset(false);
    tileset.update(HERE);
    await settle();
    expect(signals.length).toBeGreaterThan(0);

    tileset.update(FAR);
    await settle();
    expect(signals.some((signal) => signal.aborted)).toBe(false);
  });

  it("requests a tile again when it comes back", async () => {
    const { tileset, signals } = makeTileset(true);
    tileset.update(HERE);
    await settle();
    const first = signals.length;

    tileset.update(FAR);
    await settle();
    tileset.update(HERE);
    await settle();
    expect(signals.length).toBe(2 * first);
    expect(signals.slice(first).some((signal) => signal.aborted)).toBe(false);
  });
});

describe("RasterTileset2D abort of unloaded loads", () => {
  /** Nearly the same view, one level coarser: a new tile, the old ones unselected. */
  const COARSER = new WebMercatorViewport({
    longitude: 0,
    latitude: 0,
    zoom: 15,
    width: 100,
    height: 100,
  });

  function makeTinyCacheTileset(abortUnwantedLoads: boolean) {
    const signals: AbortSignal[] = [];
    const unloaded: unknown[] = [];
    const getTileData: Tileset2DProps["getTileData"] = (tile) => {
      signals.push(tile.signal!);
      return new Promise(() => {});
    };
    const tileset = new RasterTileset2D(
      {
        getTileData,
        onTileUnload: (tile) => unloaded.push(tile),
        maxRequests: 0,
        // Any newly created tile overflows the cache, so deck.gl evicts the
        // unselected ones inside the same update, before our loop sees them.
        maxCacheSize: 1,
      },
      descriptor,
      { abortUnwantedLoads },
    );
    return { tileset, signals, unloaded };
  }

  it("aborts a loading tile when deck.gl unloads it", async () => {
    const { tileset, signals, unloaded } = makeTinyCacheTileset(true);
    tileset.update(HERE);
    await settle();
    const first = signals.length;
    expect(first).toBeGreaterThan(0);

    tileset.update(COARSER);
    await settle();
    expect(signals.length).toBeGreaterThan(first);
    expect(unloaded.length).toBeGreaterThanOrEqual(first);
    expect(signals.slice(0, first).every((signal) => signal.aborted)).toBe(
      true,
    );
  });

  it("leaves an unloaded tile loading when the option is off", async () => {
    const { tileset, signals, unloaded } = makeTinyCacheTileset(false);
    tileset.update(HERE);
    await settle();
    const first = signals.length;

    tileset.update(COARSER);
    await settle();
    expect(unloaded.length).toBeGreaterThanOrEqual(first);
    expect(signals.slice(0, first).some((signal) => signal.aborted)).toBe(
      false,
    );
  });
});
