import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as zarr from "zarrita";
import type { GetTileDataOptions } from "../src/zarr-layer.js";
import { ZarrLayer } from "../src/zarr-layer.js";

/**
 * Build a {@link ZarrLayer} ready for direct lifecycle calls: bypasses deck.gl's
 * `LayerManager` by replacing `state` and `setState` with a plain object +
 * assign, mirroring `makeBareLayer` in the deck.gl-raster tests.
 */
function makeBareLayer(props: Record<string, unknown> = {}): ZarrLayer {
  const layer = new ZarrLayer({ id: "zarr", node: {}, ...props } as never);
  const state: Record<string, unknown> = {};
  Object.assign(layer as object, {
    state,
    setState: (updates: Record<string, unknown>) =>
      Object.assign(state, updates),
  });
  return layer;
}

/**
 * Load a {@link ZarrLayer}'s metadata through `updateState`, as deck.gl does
 * when the layer is first added. Resolves once the tileset descriptor is
 * ready, and rejects with the load's error if it fails.
 */
async function loadLayer(props: Record<string, unknown>): Promise<ZarrLayer> {
  const errors: Error[] = [];
  const layer = makeBareLayer({
    ...props,
    onError: (error: Error) => {
      errors.push(error);
      return true;
    },
  });
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: { dataChanged: true },
  } as never);
  await vi.waitFor(() => {
    if (errors.length === 0) {
      expect(layer.state.tilesetDescriptor).toBeDefined();
    }
  });
  if (errors[0]) {
    throw errors[0];
  }
  return layer;
}

/** How a test array stores its dims. */
type ArrayLayout = {
  dimensionNames: string[];
  shape: number[];
  chunks: number[];
};

/**
 * Open an in-memory Zarr v3 array with the given layout. The store holds only
 * the array's metadata: these tests never read chunk data.
 */
async function openArray(layout: ArrayLayout) {
  const metadata = {
    zarr_format: 3,
    node_type: "array",
    shape: layout.shape,
    data_type: "uint8",
    chunk_grid: {
      name: "regular",
      configuration: { chunk_shape: layout.chunks },
    },
    chunk_key_encoding: {
      name: "default",
      configuration: { separator: "/" },
    },
    codecs: [{ name: "bytes", configuration: { endian: "little" } }],
    fill_value: 0,
    dimension_names: layout.dimensionNames,
    attributes: {},
  };
  const store = {
    async get(key: `/${string}`): Promise<Uint8Array | undefined> {
      return key === "/zarr.json"
        ? new TextEncoder().encode(JSON.stringify(metadata))
        : undefined;
    },
  };
  return zarr.open.v3(store, { kind: "array" });
}

/**
 * GeoZarr attributes for a single-level EPSG:4326 raster of 1024 rows by 2048
 * columns, with spatial dims `lat` and `lon`.
 */
const METADATA = {
  "spatial:dimensions": ["lat", "lon"],
  "spatial:transform": [0.01, 0, 0, 0, -0.01, 10],
  "spatial:shape": [1024, 2048],
  "proj:code": "EPSG:4326",
};

// The rows and columns of tile (x=1, y=1) in 256-row by 512-column chunks.
const ROWS = zarr.slice(256, 512);
const COLS = zarr.slice(512, 1024);

// Each layout stores the raster in chunks of 256 rows by 512 columns, with its
// spatial dims at different positions. Unequal chunk sides catch a swap of the
// y and x dims.
const LAYOUTS = [
  {
    name: "[lat, lon]",
    dimensionNames: ["lat", "lon"],
    shape: [1024, 2048],
    chunks: [256, 512],
    selection: {},
    sliceSpec: [ROWS, COLS],
  },
  {
    name: "[band, lat, lon]",
    dimensionNames: ["band", "lat", "lon"],
    shape: [4, 1024, 2048],
    chunks: [1, 256, 512],
    selection: { band: 2 },
    sliceSpec: [2, ROWS, COLS],
  },
  {
    name: "channel-last [lat, lon, band]",
    dimensionNames: ["lat", "lon", "band"],
    shape: [1024, 2048, 4],
    chunks: [256, 512, 4],
    selection: { band: 2 },
    sliceSpec: [ROWS, COLS, 2],
  },
  {
    name: "transposed [lon, lat]",
    dimensionNames: ["lon", "lat"],
    shape: [2048, 1024],
    chunks: [512, 256],
    selection: {},
    sliceSpec: [COLS, ROWS],
  },
];

describe("ZarrLayer spatial dim positions", () => {
  beforeEach(() => {
    // The metadata load stores debug handles on `window`, which Node lacks
    vi.stubGlobal("window", {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(LAYOUTS)(
    "sizes tiles from the spatial chunk dims of a $name array",
    async (layout) => {
      const layer = await loadLayer({
        node: await openArray(layout),
        metadata: METADATA,
        selection: layout.selection,
      });

      const level = layer.state.tilesetDescriptor!.levels[0]!;
      expect([level.tileWidth, level.tileHeight]).toEqual([512, 256]);
    },
  );

  it.each(LAYOUTS)(
    "slices each dim of a $name array at its position",
    async (layout) => {
      const getTileData = vi.fn(
        async (_arr: unknown, _options: GetTileDataOptions) => ({}),
      );
      const layer = await loadLayer({
        node: await openArray(layout),
        metadata: METADATA,
        selection: layout.selection,
        getTileData,
      });

      await (layer as any)._getTileDataCallback()(
        { index: { x: 1, y: 1, z: 0 } },
        { signal: new AbortController().signal },
      );

      const options = getTileData.mock.calls[0]![1];
      expect(options.sliceSpec).toEqual(layout.sliceSpec);
      expect([options.width, options.height]).toEqual([512, 256]);
    },
  );
});
