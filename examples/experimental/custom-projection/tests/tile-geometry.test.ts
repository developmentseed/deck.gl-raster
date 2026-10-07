import type { Corners } from "@developmentseed/deck.gl-raster";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import {
  columnErrorScale,
  computeDomainPixelRect,
  insideBounds,
  isGeographicGrid,
  pixelRectToTriangulation,
  ringArea,
  sampleBoundary,
  sampleGrid,
  wrapLongitudeDelta,
} from "../src/projected-cog-layer/tile-geometry.js";
import { PROJECTIONS } from "../src/projections.js";

const identity = (x: number, y: number): [number, number] => [x, y];

/** A preset's PROJ string. */
function presetCrs(id: string): string {
  return PROJECTIONS.find((preset) => preset.id === id)!.toCrs;
}

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
    // Meshing stops at 89.5°: half a degree of a 40° tile's 512 rows.
    expect(rect?.[1]).toBeCloseTo(6.4, 9);
    expect(rect?.[3]).toBe(512);
  });

  it("trims a whole row at the pole when rows are coarser than the guard", () => {
    // 180° over 256 rows: each row is 0.7°, more than the 0.5° guard.
    const rect = computeDomainPixelRect({
      corners: {
        topLeft: [0, 90],
        topRight: [180, 90],
        bottomLeft: [0, -90],
        bottomRight: [180, -90],
      },
      tileWidth: 256,
      tileHeight: 256,
      sourceToLngLat: identity,
      lngLatToSource: identity,
      inverseTransform: (lng, lat) => [
        (lng / 180) * 256,
        ((90 - lat) / 180) * 256,
      ],
      fromBounds: undefined,
    });
    expect(rect?.[1]).toBeCloseTo(1, 9);
    expect(rect?.[3]).toBeCloseTo(255, 9);
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

describe("columnErrorScale", () => {
  /** Pixel → lng/lat for a 512 px EPSG:4326 tile. */
  function geographicPixels(
    west: number,
    north: number,
    east: number,
    south: number,
  ) {
    return (px: number, py: number): [number, number] => [
      west + ((east - west) * px) / 512,
      north - ((north - south) * py) / 512,
    ];
  }

  /** Pixel → map for a 512 px EPSG:4326 tile shown in `crs`. */
  function mapPixels(crs: string, tile: [number, number, number, number]) {
    const toMap = proj4("EPSG:4326", crs).forward;
    const pixelToLngLat = geographicPixels(...tile);
    return (px: number, py: number) =>
      toMap(pixelToLngLat(px, py)) as [number, number];
  }

  it("is cos(latitude) at the most equatorward row on a polar stereographic map", () => {
    const scale = columnErrorScale({
      pixelToMap: mapPixels(presetCrs("arctic"), [0, 80, 20, 60]),
      rect: [0, 0, 512, 512],
    });
    // Within the WGS84 ellipsoid's ~0.2% departure from the sphere.
    expect(scale).toBeCloseTo(Math.cos(Math.PI / 3), 2);
  });

  it("only measures the meshed part of the tile", () => {
    // Rows 0..256 of an 80°..60° tile reach down to 70°.
    const scale = columnErrorScale({
      pixelToMap: mapPixels(presetCrs("arctic"), [0, 80, 20, 60]),
      rect: [0, 0, 512, 256],
    });
    expect(scale).toBeCloseTo(Math.cos((70 * Math.PI) / 180), 2);
  });

  it("measures in the map, so non-conformal maps get their own ratio", () => {
    // Equal Earth stretches parallels near the poles: its columns at 60° are
    // wider relative to rows than on the sphere.
    const scale = columnErrorScale({
      pixelToMap: mapPixels(presetCrs("equal-earth"), [0, 80, 20, 60]),
      rect: [0, 0, 512, 512],
    });
    expect(scale).toBeGreaterThan(Math.cos(Math.PI / 3) + 0.1);
    expect(scale).toBeLessThanOrEqual(1);
  });

  it("is 1 when pixels are already square on the map", () => {
    const scale = columnErrorScale({
      pixelToMap: (px, py) => [px * 100, py * 100],
      rect: [0, 0, 512, 512],
    });
    expect(scale).toBeCloseTo(1, 9);
  });

  it("never stretches beyond 1", () => {
    const scale = columnErrorScale({
      pixelToMap: (px, py) => [px * 300, py * 100],
      rect: [0, 0, 512, 512],
    });
    expect(scale).toBe(1);
  });
});
