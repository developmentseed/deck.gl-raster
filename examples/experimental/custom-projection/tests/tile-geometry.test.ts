import type { Corners } from "@developmentseed/deck.gl-raster";
import { describe, expect, it } from "vitest";
import {
  computeDomainPixelRect,
  insideBounds,
  isGeographicGrid,
  pixelRectToTriangulation,
  ringArea,
  sampleBoundary,
  sampleGrid,
  wrapLongitudeDelta,
} from "../src/projected-cog-layer/tile-geometry.js";

const identity = (x: number, y: number): [number, number] => [x, y];

/** A 512 px EPSG:4326 tile spanning `west..east`, `north..south`. */
function geographicTile(
  west: number,
  north: number,
  east: number,
  south: number,
) {
  const corners: Corners = {
    topLeft: [west, north],
    topRight: [east, north],
    bottomLeft: [west, south],
    bottomRight: [east, south],
  };
  const inverseTransform = (lng: number, lat: number): [number, number] => [
    ((lng - west) / (east - west)) * 512,
    ((north - lat) / (north - south)) * 512,
  ];
  return {
    corners,
    tileWidth: 512,
    tileHeight: 512,
    sourceToLngLat: identity,
    lngLatToSource: identity,
    inverseTransform,
  };
}

describe("computeDomainPixelRect", () => {
  it("trims a tile that crosses the domain's latitude limit", () => {
    // Northern hemisphere domain; the tile spans 20°N..20°S.
    const rect = computeDomainPixelRect({
      ...geographicTile(0, 20, 40, -20),
      fromBounds: [-180, 0, 180, 90],
    });
    expect(rect).toEqual([0, 0, 512, 256]);
  });

  it("keeps the tile off the pole", () => {
    const rect = computeDomainPixelRect({
      ...geographicTile(0, 90, 40, 50),
      fromBounds: [-180, 0, 180, 90],
    });
    // One source row (40° over 512 rows) is trimmed at the pole.
    expect(rect?.[1]).toBeCloseTo(1, 9);
    expect(rect?.[3]).toBe(512);
  });

  it("returns undefined when the tile is inside the domain", () => {
    expect(
      computeDomainPixelRect({
        ...geographicTile(0, 60, 40, 20),
        fromBounds: [-180, 0, 180, 90],
      }),
    ).toBeUndefined();
  });

  it("returns null when the tile is outside the domain", () => {
    expect(
      computeDomainPixelRect({
        ...geographicTile(0, -20, 40, -60),
        fromBounds: [-180, 0, 180, 90],
      }),
    ).toBeNull();
  });

  it("trims longitude for a regional domain", () => {
    const rect = computeDomainPixelRect({
      ...geographicTile(-40, 60, 40, 20),
      fromBounds: [0, -90, 180, 90],
    });
    expect(rect).toEqual([256, 0, 512, 512]);
  });

  it("returns undefined for a tile whose rows are not parallels", () => {
    const rotated = geographicTile(0, 60, 40, 20);
    rotated.corners.topRight = [40, 61];
    expect(
      computeDomainPixelRect({ ...rotated, fromBounds: [-180, 0, 180, 90] }),
    ).toBeUndefined();
  });
});

describe("pixelRectToTriangulation", () => {
  it("divides by the decoded tile size, which may be clipped", () => {
    const seed = pixelRectToTriangulation([0, 100, 200, 300], 200, 300);
    expect(seed?.uvs).toEqual([0, 1 / 3, 1, 1 / 3, 0, 1, 1, 1]);
  });

  it("returns undefined when the rectangle covers the tile", () => {
    expect(
      pixelRectToTriangulation([0, 0, 512, 512], 512, 512),
    ).toBeUndefined();
  });
});

describe("helpers", () => {
  it("wraps longitude differences into [-180, 180)", () => {
    expect(wrapLongitudeDelta(359)).toBe(-1);
    expect(wrapLongitudeDelta(-181)).toBe(179);
    expect(wrapLongitudeDelta(10)).toBe(10);
  });

  it("recognizes geographic grids", () => {
    expect(isGeographicGrid(geographicTile(0, 60, 40, 20).corners)).toBe(true);
  });

  it("samples a closed boundary and measures its area", () => {
    const corners = geographicTile(0, 10, 10, 0).corners;
    const ring = sampleBoundary(corners, 4);
    expect(ring).toHaveLength(16);
    expect(ringArea(ring)).toBeCloseTo(100, 9);
  });

  it("samples grid cell centers inside the quad", () => {
    const corners = geographicTile(0, 10, 10, 0).corners;
    const grid = sampleGrid(corners, 2);
    expect(grid).toEqual([
      [2.5, 7.5],
      [7.5, 7.5],
      [2.5, 2.5],
      [7.5, 2.5],
    ]);
    expect(grid.every((p) => insideBounds(p, [0, 0, 10, 10]))).toBe(true);
  });
});
