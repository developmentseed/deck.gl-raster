import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WebMercatorViewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { describe, expect, it } from "vitest";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";
import { TileMatrixSetAdaptor } from "../../src/raster-tileset/tile-matrix-set.js";
import type { Bounds, TileIndex } from "../../src/raster-tileset/types.js";

// The OGC TMS 2.0 example WebMercatorQuad. It has no `boundingBox`, so its
// bounds are the whole Mercator world.
const WEB_MERCATOR_QUAD: TileMatrixSet = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../../../morecantile/spec/schemas/tms/2.0/json/examples/tilematrixset/WebMercatorQuad.json",
    ),
    "utf8",
  ),
);

// Asymmetric, so reading it with swapped axes would select other tiles.
const EXTENT: Bounds = [-5, 10, 5, 30];

const WGS84_RADIUS = 6378137;
function wgs84To3857(lng: number, lat: number): [number, number] {
  const x = (lng * Math.PI * WGS84_RADIUS) / 180;
  const y =
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * WGS84_RADIUS;
  return [x, y];
}
function epsg3857ToWgs84(x: number, y: number): [number, number] {
  const lng = (x * 180) / (Math.PI * WGS84_RADIUS);
  const lat = (Math.atan(Math.exp(y / WGS84_RADIUS)) * 360) / Math.PI - 90;
  return [lng, lat];
}
const identity = (x: number, y: number): [number, number] => [x, y];

/** A descriptor for a TileMatrixSet in EPSG:3857, like WebMercatorQuad. */
function makeDescriptor(tms: TileMatrixSet): TileMatrixSetAdaptor {
  return new TileMatrixSetAdaptor(tms, {
    projectTo3857: identity,
    projectFrom3857: identity,
    projectTo4326: epsg3857ToWgs84,
    projectFrom4326: wgs84To3857,
  });
}

/**
 * Tileset options as deck.gl's TileLayer passes them, where `extent` defaults
 * to `null`.
 */
function tilesetProps(extent: Bounds | null = null): Tileset2DProps {
  return { getTileData: () => new Promise(() => {}), extent };
}

function makeViewport(): WebMercatorViewport {
  return new WebMercatorViewport({
    longitude: 0,
    latitude: 0,
    zoom: 3,
    width: 512,
    height: 512,
  });
}

// The traversal can return the same tile more than once, so compare the
// unique `z/x/y` keys.
function tileKeys(indices: TileIndex[]): string[] {
  return [...new Set(indices.map(({ x, y, z }) => `${z}/${x}/${y}`))].sort();
}

/**
 * Keys of the WebMercatorQuad tiles in `indices` that overlap `extent`, with
 * each tile's WGS84 bounds from the standard XYZ tile math.
 */
function keysOverlapping(indices: TileIndex[], extent: Bounds): string[] {
  const lng = (col: number, n: number) => (col / n) * 360 - 180;
  const lat = (row: number, n: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  const [minLng, minLat, maxLng, maxLat] = extent;
  return tileKeys(
    indices.filter(({ x, y, z }) => {
      const n = 2 ** z;
      return (
        lng(x, n) < maxLng &&
        lng(x + 1, n) > minLng &&
        lat(y + 1, n) < maxLat &&
        lat(y, n) > minLat
      );
    }),
  );
}

describe("RasterTileset2D extent", () => {
  it("selects only the tiles that overlap the extent", () => {
    const descriptor = makeDescriptor(WEB_MERCATOR_QUAD);
    const viewport = makeViewport();
    const all = new RasterTileset2D(tilesetProps(), descriptor).getTileIndices({
      viewport,
      zRange: null,
    });
    const expected = keysOverlapping(all, EXTENT);
    // The extent keeps some of the tiles in view, but not all of them.
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(tileKeys(all).length);

    const tileset = new RasterTileset2D(tilesetProps(EXTENT), descriptor);
    expect(
      tileKeys(tileset.getTileIndices({ viewport, zRange: null })),
    ).toEqual(expected);
  });

  it("selects no tiles when the extent misses the descriptor's bounds", () => {
    // A dataset covering roughly 4.5°–13.5° E and N.
    const descriptor = makeDescriptor({
      ...WEB_MERCATOR_QUAD,
      boundingBox: {
        lowerLeft: [500000, 500000],
        upperRight: [1500000, 1500000],
      },
    });
    const viewport = makeViewport();
    const withoutExtent = new RasterTileset2D(tilesetProps(), descriptor);
    expect(
      withoutExtent.getTileIndices({ viewport, zRange: null }).length,
    ).toBeGreaterThan(0);

    const tileset = new RasterTileset2D(
      tilesetProps([20, 20, 30, 30]),
      descriptor,
    );
    expect(
      tileKeys(tileset.getTileIndices({ viewport, zRange: null })),
    ).toEqual([]);
  });

  it("applies an extent changed through setOptions on the next call", () => {
    const viewport = makeViewport();
    const tileset = new RasterTileset2D(
      tilesetProps(),
      makeDescriptor(WEB_MERCATOR_QUAD),
    );
    const all = tileset.getTileIndices({ viewport, zRange: null });

    // deck.gl's TileLayer calls `setOptions` when its props change.
    tileset.setOptions(tilesetProps(EXTENT));
    expect(
      tileKeys(tileset.getTileIndices({ viewport, zRange: null })),
    ).toEqual(keysOverlapping(all, EXTENT));

    tileset.setOptions(tilesetProps());
    expect(
      tileKeys(tileset.getTileIndices({ viewport, zRange: null })),
    ).toEqual(tileKeys(all));
  });
});
