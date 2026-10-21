import { WebMercatorViewport } from "@deck.gl/core";
import { compose, scale, translation } from "@developmentseed/affine";
import { describe, expect, it } from "vitest";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";
import { getTileIndices } from "../../src/raster-tileset/raster-tile-traversal.js";
import type { Bounds, ZRange } from "../../src/raster-tileset/types.js";

const EARTH_RADIUS = 6378137;

/** WGS84 longitude/latitude to EPSG:3857 meters. */
function toMercator(lng: number, lat: number): [number, number] {
  return [
    (EARTH_RADIUS * lng * Math.PI) / 180,
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  ];
}

/** EPSG:3857 meters to WGS84 longitude/latitude. */
function fromMercator(x: number, y: number): [number, number] {
  return [
    ((x / EARTH_RADIUS) * 180) / Math.PI,
    ((2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * 180) / Math.PI,
  ];
}

const identity = (x: number, y: number): [number, number] => [x, y];

/**
 * A 30 x 36 km EPSG:3857 raster near the Grand Canyon, at 96, 48, 24, 12 and
 * 6 m per pixel in 512 px tiles.
 */
function makeTileset(): AffineTileset {
  const [originX, originY] = toMercator(-112.75, 36.45);
  const levels = [96, 48, 24, 12, 6].map(
    (metersPerPixel) =>
      new AffineTilesetLevel({
        affine: compose(
          translation(originX, originY),
          scale(metersPerPixel, -metersPerPixel),
        ),
        arrayWidth: Math.ceil(30000 / metersPerPixel),
        arrayHeight: Math.ceil(36000 / metersPerPixel),
        tileWidth: 512,
        tileHeight: 512,
        mpu: 1,
      }),
  );
  return new AffineTileset({
    levels,
    projectTo3857: identity,
    projectFrom3857: identity,
    projectTo4326: fromMercator,
    projectFrom4326: toMercator,
  });
}

/** The selected tiles as sorted `z/x/y` keys. */
function selectedTiles(zRange: ZRange | null): string[] {
  const tileset = makeTileset();
  const [minX, minY, maxX, maxY] = tileset.projectedBounds;
  const wgs84Bounds: Bounds = [
    ...fromMercator(minX, minY),
    ...fromMercator(maxX, maxY),
  ];
  const viewport = new WebMercatorViewport({
    longitude: -112.62,
    latitude: 36.37,
    zoom: 12.5,
    pitch: 55,
    bearing: 0,
    width: 1280,
    height: 800,
  });
  return getTileIndices(tileset, {
    viewport,
    maxZ: 4,
    zRange,
    wgs84Bounds,
    pixelRatio: 1,
  })
    .map(({ x, y, z }) => `${z}/${x}/${y}`)
    .sort();
}

describe("getTileIndices: zRange", () => {
  it("selects tiles near the camera that terrain lifts into view", () => {
    // Terrain 500-2100 m high is in view at the bottom of the screen, nearer
    // the camera than the sea-level ground the view would otherwise assume.
    const nearCameraTiles = ["3/1/3", "3/2/3", "3/3/3"];
    const withZRange = selectedTiles([500, 2100]);
    const atSeaLevel = selectedTiles(null);
    expect(withZRange).toEqual(expect.arrayContaining(nearCameraTiles));
    for (const tile of nearCameraTiles) {
      expect(atSeaLevel).not.toContain(tile);
    }
  });
});
