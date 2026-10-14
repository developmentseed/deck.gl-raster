import { WebMercatorViewport } from "@deck.gl/core";
import { describe, expect, it } from "vitest";
import { BoundingVolumeCache } from "../../src/raster-tileset/bounding-volume-cache.js";
import {
  getTileIndices,
  RasterTileNode,
} from "../../src/raster-tileset/raster-tile-traversal.js";
import type { RasterTilesetDescriptor } from "../../src/raster-tileset/tileset-interface.js";
import type { Bounds } from "../../src/raster-tileset/types.js";

/** One world width in deck.gl's common space. */
const WORLD = 512;

/** Half of EPSG:3857's world width, in metres. */
const HALF_WORLD_METRES = Math.PI * 6378137;

/**
 * Longitude/latitude to EPSG:3857 metres, wrapping longitude into
 * [−180°, 180°] like proj4, so a point past 180° lands on the far side.
 */
function lngLatTo3857(lng: number, lat: number): [number, number] {
  const wrapped = Math.abs(lng) <= 180 ? lng : lng - Math.sign(lng) * 360;
  const phi = (lat * Math.PI) / 180;
  return [
    (wrapped / 180) * HALF_WORLD_METRES,
    (Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) * HALF_WORLD_METRES,
  ];
}

const identity = (x: number, y: number): [number, number] => [x, y];

/**
 * One 42×42 px longitude/latitude tile, like the `antimeridian.tif` fixture:
 * 204°W to 162°W (that is, 156°E across 180° to 162°W), 18°S to 24°N.
 */
const descriptor: RasterTilesetDescriptor = {
  levels: [
    {
      matrixWidth: 1,
      matrixHeight: 1,
      tileWidth: 42,
      tileHeight: 42,
      metersPerPixel: 111_000,
      projectedTileCorners: () => ({
        topLeft: [-204, 24],
        topRight: [-162, 24],
        bottomLeft: [-204, -18],
        bottomRight: [-162, -18],
      }),
      tileTransform: () => {
        throw new Error("not used in this test");
      },
      crsBoundsToTileRange: () => ({
        minCol: 0,
        maxCol: 0,
        minRow: 0,
        maxRow: 0,
      }),
    },
  ],
  projectTo3857: lngLatTo3857,
  projectTo4326: identity,
  projectFrom3857: identity,
  projectFrom4326: identity,
  projectedBounds: [-204, -18, -162, 24],
};

/** Longitude/latitude bounds of the dataset, as `RasterTileset2D` gets them. */
const WGS84_BOUNDS: Bounds = [-204, -18, -162, 24];

/** Tiles selected with the view centered on `longitude`. */
function selected(longitude: number, { repeat }: { repeat: boolean }) {
  const viewport = new WebMercatorViewport({
    longitude,
    latitude: 3,
    zoom: 5,
    width: 800,
    height: 600,
    repeat,
  });
  return getTileIndices(descriptor, {
    viewport,
    maxZ: 0,
    zRange: null,
    wgs84Bounds: WGS84_BOUNDS,
  });
}

describe("tile selection across the antimeridian", () => {
  it("bounds a tile across the antimeridian tightly, not across the world", () => {
    const node = new RasterTileNode(0, 0, 0, { descriptor });
    const { commonSpaceBounds } = node.getBoundingVolume(
      [0, 0],
      null,
      new BoundingVolumeCache(),
    );
    const [minX, , maxX] = commonSpaceBounds;
    // 42° of longitude, not the whole world.
    expect(maxX - minX).toBeCloseTo((42 / 360) * WORLD, 6);
  });

  for (const repeat of [false, true]) {
    describe(repeat ? "with repeat" : "without repeat", () => {
      it("selects the tile with the view centered on the seam", () => {
        expect(selected(180, { repeat })).toHaveLength(1);
      });

      it("selects the tile with only its part west of 180° in view", () => {
        // The view spans about 161°E to 179°E.
        expect(selected(170, { repeat })).toHaveLength(1);
      });

      it("selects the tile with only its part east of 180° in view", () => {
        // The view spans about 179°W to 161°W.
        expect(selected(-170, { repeat })).toHaveLength(1);
      });

      it("doesn't select the tile with the view across the world from it", () => {
        expect(selected(0, { repeat })).toHaveLength(0);
      });
    });
  }
});

describe("tile selection around a pole", () => {
  const R = 6378137;
  const LON_0 = -45;

  /** Spherical north polar stereographic metres → longitude, latitude. */
  const polarToLngLat = (x: number, y: number): [number, number] => {
    const rho = Math.hypot(x, y);
    const lat = 90 - (2 * Math.atan(rho / (2 * R)) * 180) / Math.PI;
    let lng = LON_0 + (Math.atan2(x, -y) * 180) / Math.PI;
    if (lng <= -180) {
      lng += 360;
    }
    return [lng, lat];
  };

  // The extent of NSIDC's sea ice grid (EPSG:3413), which has the North Pole
  // inside it, as a 4-level quadtree of 256 px tiles.
  const [minX, minY, maxX, maxY] = [-3850000, -5350000, 3750000, 5850000];
  const levels = [0, 1, 2, 3].map((z) => {
    const n = 2 ** z;
    const tileWidth = (maxX - minX) / n;
    const tileHeight = (maxY - minY) / n;
    return {
      matrixWidth: n,
      matrixHeight: n,
      tileWidth: 256,
      tileHeight: 256,
      metersPerPixel: Math.max(tileWidth, tileHeight) / 256,
      projectedTileCorners: (col: number, row: number) => ({
        topLeft: [minX + col * tileWidth, maxY - row * tileHeight],
        topRight: [minX + (col + 1) * tileWidth, maxY - row * tileHeight],
        bottomLeft: [minX + col * tileWidth, maxY - (row + 1) * tileHeight],
        bottomRight: [
          minX + (col + 1) * tileWidth,
          maxY - (row + 1) * tileHeight,
        ],
      }),
      tileTransform: () => {
        throw new Error("not used in this test");
      },
      crsBoundsToTileRange: () => ({
        minCol: 0,
        maxCol: n - 1,
        minRow: 0,
        maxRow: n - 1,
      }),
    } as RasterTilesetDescriptor["levels"][number];
  });
  const polar: RasterTilesetDescriptor = {
    levels,
    projectTo3857: (x, y) => {
      const [lng, lat] = polarToLngLat(x, y);
      return lngLatTo3857(lng, Math.min(lat, 85.05112878));
    },
    projectTo4326: polarToLngLat,
    projectFrom3857: identity,
    projectFrom4326: identity,
    projectedBounds: [minX, minY, maxX, maxY],
  };

  it("bounds a tile around the pole across every longitude", () => {
    const node = new RasterTileNode(0, 0, 0, { descriptor: polar });
    const { commonSpaceBounds } = node.getBoundingVolume(
      [0, 0],
      null,
      new BoundingVolumeCache(),
    );
    expect(commonSpaceBounds[0]).toBe(0);
    expect(commonSpaceBounds[2]).toBe(WORLD);
  });

  for (const repeat of [false, true]) {
    it(`selects tiles at every longitude${repeat ? " with repeat" : ""}`, () => {
      for (const longitude of [-160, -100, -60, -40, -20, 0, 60, 120]) {
        for (const latitude of [55, 65, 75]) {
          const viewport = new WebMercatorViewport({
            longitude,
            latitude,
            zoom: 6,
            width: 800,
            height: 600,
            repeat,
          });
          const selected = getTileIndices(polar, {
            viewport,
            maxZ: 3,
            zRange: null,
            // Every longitude, down to the Mercator limit, as RasterTileset2D
            // clamps a polar dataset's bounds.
            wgs84Bounds: [-180, 30, 180, 85.05112878],
          });
          expect(
            selected.length,
            `at ${longitude}°, ${latitude}°`,
          ).toBeGreaterThan(0);
        }
      }
    });
  }
});
