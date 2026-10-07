import type { Viewport } from "@deck.gl/core";
import {
  AffineTileset,
  AffineTilesetLevel,
} from "@developmentseed/deck.gl-raster";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { CustomProjectionViewport } from "../src/custom-projection/index.js";
import type { TileIndex } from "../src/projected-cog-layer/custom-projection-tileset-2d.js";
import { CustomProjectionTileset2D } from "../src/projected-cog-layer/custom-projection-tileset-2d.js";
import { createProjectionContext } from "../src/projected-cog-layer/projection-context.js";
import { computeDomainPixelRect } from "../src/projected-cog-layer/tile-geometry.js";
import { PROJECTIONS } from "../src/projections.js";

const identity = (x: number, y: number): [number, number] => [x, y];

/** A global EPSG:4326 pyramid with exact 2x levels (GEBCO-like). */
function globalDescriptor(levels: number) {
  return new AffineTileset({
    levels: Array.from({ length: levels }, (_, z) => {
      const width = 675 * 2 ** z;
      const height = Math.floor(width / 2);
      return new AffineTilesetLevel({
        affine: [360 / width, 0, -180, 0, -180 / height, 90],
        arrayWidth: width,
        arrayHeight: height,
        tileWidth: 512,
        tileHeight: 512,
        mpu: 111_320,
      });
    }),
    projectTo3857: identity,
    projectFrom3857: identity,
    projectTo4326: identity,
    projectFrom4326: identity,
  });
}

function select(presetId: string, center: number[], zoom: number) {
  const preset = PROJECTIONS.find((p) => p.id === presetId)!;
  const viewport = new CustomProjectionViewport({
    projection: proj4("EPSG:4326", preset.toCrs),
    fromCrs: "EPSG:4326",
    toCrs: preset.toCrs,
    fromBounds: preset.fromBounds,
    width: 1440,
    height: 900,
    center,
    zoom,
  });
  const descriptor = globalDescriptor(6);
  const tileset = new CustomProjectionTileset2D(
    { getTileData: () => null } as never,
    descriptor,
    createProjectionContext(viewport, descriptor, preset.fromBounds),
    { getPixelRatio: () => 2 },
  );
  const indices = tileset.getTileIndices({
    viewport: viewport as unknown as Viewport,
    zRange: null,
  });
  return { tileset, indices };
}

/** Whether `ancestor` contains `tile` in a pyramid with exact 2x levels. */
function isAncestor(ancestor: TileIndex, tile: TileIndex): boolean {
  const scale = 2 ** (tile.z - ancestor.z);
  return (
    ancestor.z < tile.z &&
    Math.floor(tile.x / scale) === ancestor.x &&
    Math.floor(tile.y / scale) === ancestor.y
  );
}

describe("CustomProjectionTileset2D traversal", () => {
  const views: [string, number[], number][] = [
    ["arctic", [-135, 68.2, 0], 2.6],
    ["antarctic", [-90, -71, 0], 2.8],
    ["antarctic", [170, -78, 0], 4],
    ["arctic", [175, 66, 0], 6],
    ["equal-earth", [-70, 0, 0], 1],
  ];

  for (const [presetId, center, zoom] of views) {
    it(`selects each tile once, never under its own ancestor (${presetId} ${center.join(",")} z${zoom})`, () => {
      const { tileset, indices } = select(presetId, center, zoom);
      expect(indices.length).toBeGreaterThan(0);
      const ids = indices.map((i) => tileset.getTileId(i));
      expect(new Set(ids).size).toBe(ids.length);
      for (const a of indices) {
        for (const b of indices) {
          expect(isAncestor(a, b)).toBe(false);
        }
      }
    });
  }
});

describe("pole guard", () => {
  it("applies even when the view provides no domain", () => {
    const rect = computeDomainPixelRect({
      corners: {
        topLeft: [0, 90],
        topRight: [40, 90],
        bottomLeft: [0, 50],
        bottomRight: [40, 50],
      },
      tileWidth: 512,
      tileHeight: 512,
      sourceToLngLat: identity,
      lngLatToSource: identity,
      inverseTransform: (lng, lat) => [
        (lng / 40) * 512,
        ((90 - lat) / 40) * 512,
      ],
      fromBounds: undefined,
    });
    // Meshing stops at 89.5°: half a degree of the tile's 40° over 512 rows.
    expect(rect?.[1]).toBeCloseTo(6.4, 9);
  });
});
