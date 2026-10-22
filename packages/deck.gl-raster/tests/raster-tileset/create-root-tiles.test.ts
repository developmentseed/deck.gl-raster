import {
  _GlobeViewport as GlobeViewport,
  WebMercatorViewport,
} from "@deck.gl/core";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { describe, expect, it } from "vitest";
import { createRootTiles } from "../../src/raster-tileset/raster-tile-traversal.js";
import { TileMatrixSetAdaptor } from "../../src/raster-tileset/tile-matrix-set.js";
import { overlappingTileSpan } from "../../src/raster-tileset/tile-span.js";
import type {
  RasterTilesetDescriptor,
  RasterTilesetLevel,
} from "../../src/raster-tileset/tileset-interface.js";
import type { Bounds } from "../../src/raster-tileset/types.js";

/**
 * Minimal fake `RasterTilesetLevel`: top-left-origin EPSG:4326 grid whose
 * first column starts at longitude `west` (-180 by default). Only methods
 * `createRootTiles` touches are implemented.
 */
function makeFakeLevel(opts: {
  matrixWidth: number;
  matrixHeight: number;
  tileDegrees: number;
  west?: number;
}): RasterTilesetLevel {
  const { matrixWidth, matrixHeight, tileDegrees, west = -180 } = opts;
  return {
    matrixWidth,
    matrixHeight,
    tileWidth: 256,
    tileHeight: 256,
    metersPerPixel: 10,
    projectedTileCorners() {
      throw new Error("not used");
    },
    tileTransform() {
      throw new Error("not used");
    },
    crsBoundsToTileRange(minX, minY, maxX, maxY) {
      // Tiles that only share an edge with the box are left out, as the
      // `RasterTilesetLevel` contract requires.
      const [firstCol, lastCol] = overlappingTileSpan(
        (minX - west) / tileDegrees,
        (maxX - west) / tileDegrees,
      );
      const [firstRow, lastRow] = overlappingTileSpan(
        (90 - maxY) / tileDegrees,
        (90 - minY) / tileDegrees,
      );
      const minCol = Math.max(0, Math.min(matrixWidth - 1, firstCol));
      const maxCol = Math.max(0, Math.min(matrixWidth - 1, lastCol));
      const minRow = Math.max(0, Math.min(matrixHeight - 1, firstRow));
      const maxRow = Math.max(0, Math.min(matrixHeight - 1, lastRow));
      return { minCol, maxCol, minRow, maxRow };
    },
  };
}

/** Identity projection: source CRS already is EPSG:4326. */
const identity = (x: number, y: number): [number, number] => [x, y];

function makeDescriptor(level: RasterTilesetLevel): RasterTilesetDescriptor {
  return {
    levels: [level],
    projectTo3857: identity,
    projectTo4326: identity,
    projectFrom3857: identity,
    projectFrom4326: identity,
    projectedBounds: [-180, -90, 180, 90],
  };
}

/** A viewport without world copies, showing `bounds`. */
function makeViewport(bounds: Bounds) {
  return { getBounds: () => bounds, subViewports: null };
}

describe("createRootTiles", () => {
  it("bounds a huge global single-level descriptor to a handful of root tiles for a small viewport", () => {
    // Mirror AEF: ~10 m pixels over the whole globe at 256 px tiles →
    // ~15000 × 7000 root tiles. A San Francisco-sized viewport should resolve
    // to fewer than 100 root tiles, not millions.
    const descriptor = makeDescriptor(
      makeFakeLevel({
        matrixWidth: 15665,
        matrixHeight: 7264,
        // 256 * 10 m ≈ 2.56 km ≈ 0.023° at the equator
        tileDegrees: 0.023,
      }),
    );
    const roots = createRootTiles({
      descriptor,
      viewport: makeViewport([-122.5, 37.7, -122.3, 37.9]),
      datasetWgs84Bounds: [-180, -90, 180, 90],
    });
    expect(roots.length).toBeLessThan(100);
    expect(roots.length).toBeGreaterThan(0);
  });

  it("returns an empty list when the viewport does not overlap the dataset", () => {
    const descriptor = makeDescriptor(
      makeFakeLevel({
        matrixWidth: 15665,
        matrixHeight: 7264,
        tileDegrees: 0.023,
      }),
    );
    // Dataset covers only [0, 0, 10, 10]; viewport is far away in lng.
    const roots = createRootTiles({
      descriptor,
      viewport: makeViewport([100, 0, 110, 10]),
      datasetWgs84Bounds: [0, 0, 10, 10],
    });
    expect(roots).toHaveLength(0);
  });

  it("enumerates every tile for small root matrices without projecting", () => {
    // Uncullable descriptor — projectFrom4326 throws. The small-matrix path
    // must not touch it.
    const descriptor: RasterTilesetDescriptor = {
      levels: [
        makeFakeLevel({ matrixWidth: 3, matrixHeight: 4, tileDegrees: 90 }),
      ],
      projectTo3857: identity,
      projectTo4326: identity,
      projectFrom3857: identity,
      projectFrom4326: () => {
        throw new Error("should not be called for small root matrices");
      },
      projectedBounds: [-180, -90, 180, 90],
    };
    const roots = createRootTiles({
      descriptor,
      viewport: makeViewport([-180, -90, 180, 90]),
      datasetWgs84Bounds: [-180, -90, 180, 90],
    });
    // 3 × 4 = 12 root tiles, all enumerated.
    expect(roots).toHaveLength(12);
  });

  it("leaves out root tiles that only touch the viewport", () => {
    // 360 × 180 one-degree root tiles, so the culled path runs.
    const tms: TileMatrixSet = {
      crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      boundingBox: { lowerLeft: [-180, -90], upperRight: [180, 90] },
      tileMatrices: [
        {
          id: "0",
          scaleDenominator: 397569609.9759771,
          cellSize: 1 / 256,
          cornerOfOrigin: "topLeft",
          pointOfOrigin: [-180, 90],
          tileWidth: 256,
          tileHeight: 256,
          matrixWidth: 360,
          matrixHeight: 180,
        },
      ],
    };
    const descriptor = new TileMatrixSetAdaptor(tms, {
      projectTo3857: identity,
      projectFrom3857: identity,
      projectTo4326: identity,
      projectFrom4326: identity,
    });
    // Every viewport edge lies on a root tile edge.
    const roots = createRootTiles({
      descriptor,
      viewport: makeViewport([10, 20, 13, 22]),
      datasetWgs84Bounds: [-180, -90, 180, 90],
    });
    // Columns 190..192 cover longitudes 10..13, rows 68..69 latitudes 22..20.
    expect(roots.map(({ x, y }) => `${x}/${y}`)).toEqual([
      "190/68",
      "191/68",
      "192/68",
      "190/69",
      "191/69",
      "192/69",
    ]);
  });
});

describe("createRootTiles across the antimeridian", () => {
  // 360 x 180 one-degree root tiles, so the culled path runs.
  const globalGrid = makeDescriptor(
    makeFakeLevel({ matrixWidth: 360, matrixHeight: 180, tileDegrees: 1 }),
  );
  const world: Bounds = [-180, -85, 180, 85];
  // A pixel at zoom 6 is 360° / 32768, so this view reaches 4.39° to each side
  // of its center: centered at 179.9°, it shows 175.51° to 184.29°.
  const view = { latitude: 0, zoom: 6, width: 800, height: 600 };
  const columns = (roots: { x: number }[]) =>
    [...new Set(roots.map(({ x }) => x))].sort((a, b) => a - b);

  it("creates root tiles past 180° in Web Mercator with repeat", () => {
    const roots = createRootTiles({
      descriptor: globalGrid,
      viewport: new WebMercatorViewport({
        ...view,
        longitude: 179.9,
        repeat: true,
      }),
      datasetWgs84Bounds: world,
    });
    // Columns 0-4 cover -180° to -175°, the part of the view past 180°.
    expect(columns(roots)).toEqual([0, 1, 2, 3, 4, 355, 356, 357, 358, 359]);
  });

  it("creates root tiles past 180° on a globe", () => {
    const roots = createRootTiles({
      descriptor: globalGrid,
      viewport: new GlobeViewport({ ...view, longitude: 179.9 }),
      datasetWgs84Bounds: world,
    });
    expect(columns(roots)).toContain(0);
    expect(columns(roots)).toContain(359);
  });

  it("creates root tiles only on the side Web Mercator without repeat draws", () => {
    // Nothing is drawn past 180°, so -180° to -175° stays out.
    const roots = createRootTiles({
      descriptor: globalGrid,
      viewport: new WebMercatorViewport({ ...view, longitude: 179.9 }),
      datasetWgs84Bounds: world,
    });
    expect(columns(roots)).toEqual([355, 356, 357, 358, 359]);
  });

  // A grid from 0° to 360°, as many climate datasets are stored: its bounds
  // run past 180°, so its root tiles past 180° are its own columns 180-359.
  const grid0To360 = makeDescriptor(
    makeFakeLevel({
      matrixWidth: 360,
      matrixHeight: 180,
      tileDegrees: 1,
      west: 0,
    }),
  );
  const world0To360: Bounds = [0, -85, 360, 85];

  it("creates root tiles across 180° for a dataset stored from 0° to 360°", () => {
    const roots = createRootTiles({
      descriptor: grid0To360,
      viewport: new WebMercatorViewport({
        ...view,
        longitude: 179.9,
        repeat: true,
      }),
      datasetWgs84Bounds: world0To360,
    });
    expect(columns(roots)).toEqual([
      175, 176, 177, 178, 179, 180, 181, 182, 183, 184,
    ]);
  });

  it("creates root tiles across 0° for a dataset stored from 0° to 360°", () => {
    // Centered at 2°, the view shows -2.39° to 6.39°: the dataset's
    // 357.61° to 360° and 0° to 6.39°.
    const roots = createRootTiles({
      descriptor: grid0To360,
      viewport: new WebMercatorViewport({ ...view, longitude: 2 }),
      datasetWgs84Bounds: world0To360,
    });
    expect(columns(roots)).toEqual([0, 1, 2, 3, 4, 5, 6, 357, 358, 359]);
  });

  it("creates a root tile once when both sides of 180° fall in it", () => {
    // A CRS centered on 150°E, like EPSG:3832, is continuous across 180°:
    // 179° and -179° are 29° and 31° east of its center, both in the
    // 20°-wide root tile from 20° to 40°.
    const descriptor = {
      ...makeDescriptor(
        makeFakeLevel({ matrixWidth: 18, matrixHeight: 9, tileDegrees: 20 }),
      ),
      projectFrom4326: (lng: number, lat: number): [number, number] => [
        ((lng - 150 + 540) % 360) - 180,
        lat,
      ],
    };
    const roots = createRootTiles({
      descriptor,
      viewport: new WebMercatorViewport({
        ...view,
        longitude: 179.9,
        repeat: true,
      }),
      datasetWgs84Bounds: world,
    });
    const keys = roots.map(({ x, y }) => `${x}/${y}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(columns(roots)).toEqual([10]);
  });
});
