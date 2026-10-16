import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Viewport } from "@deck.gl/core";
import {
  _GlobeViewport as GlobeViewport,
  WebMercatorViewport,
} from "@deck.gl/core";
import * as affine from "@developmentseed/affine";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { describe, expect, it } from "vitest";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";
import { getTileIndices } from "../../src/raster-tileset/raster-tile-traversal.js";
import { TileMatrixSetAdaptor } from "../../src/raster-tileset/tile-matrix-set.js";
import type {
  RasterTilesetDescriptor,
  RasterTilesetLevel,
} from "../../src/raster-tileset/tileset-interface.js";
import type { Bounds } from "../../src/raster-tileset/types.js";

const R = 6378137;
const WEB_MERCATOR_EXTENT = Math.PI * R;
const MAX_LAT = 85.0511287798066;

// Source CRS is EPSG:3857 for every fixture here.
const projections = {
  projectTo3857: (x: number, y: number): [number, number] => [x, y],
  projectFrom3857: (x: number, y: number): [number, number] => [x, y],
  projectTo4326: (x: number, y: number): [number, number] => [
    (x * 180) / (Math.PI * R),
    (Math.atan(Math.exp(y / R)) * 360) / Math.PI - 90,
  ],
  projectFrom4326: (lng: number, lat: number): [number, number] => [
    (lng * Math.PI * R) / 180,
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R,
  ],
};

/** The OGC example WebMercatorQuad, whose cellSizes are rounded decimals. */
function specWebMercatorQuad(): TileMatrixSet {
  const path = resolve(
    import.meta.dirname,
    "../../../morecantile/spec/schemas/tms/2.0/json/examples/tilematrixset/WebMercatorQuad.json",
  );
  const tms: TileMatrixSet = JSON.parse(readFileSync(path, "utf8"));
  return {
    ...tms,
    boundingBox: {
      lowerLeft: [-WEB_MERCATOR_EXTENT, -WEB_MERCATOR_EXTENT],
      upperRight: [WEB_MERCATOR_EXTENT, WEB_MERCATOR_EXTENT],
    },
  };
}

/**
 * WebMercatorQuad as titiler serves it (Python morecantile): each level's
 * cellSize is exactly half the previous one.
 */
function titilerWebMercatorQuad(): TileMatrixSet {
  const tms = specWebMercatorQuad();
  return {
    ...tms,
    tileMatrices: tms.tileMatrices.map((matrix, z) => ({
      ...matrix,
      cellSize: 156543.03392804097 / 2 ** z,
      pointOfOrigin: [-WEB_MERCATOR_EXTENT, WEB_MERCATOR_EXTENT],
    })),
  };
}

const WEB_MERCATOR_QUADS = [
  ["spec example", specWebMercatorQuad()],
  ["titiler", titilerWebMercatorQuad()],
] as const;

/**
 * COG-style pyramid: overviews of ceil(size / 2^k) pixels whose transform is
 * scaled like `@developmentseed/geotiff`'s `Overview.transform`.
 */
function cogLevels(size: number, tileSize: number): AffineTilesetLevel[] {
  const full: affine.Affine = [10, 0, 0, 0, -10, 5_000_000];
  const levels: AffineTilesetLevel[] = [];
  for (let width = size; ; width = Math.ceil(width / 2)) {
    levels.unshift(
      new AffineTilesetLevel({
        affine: affine.compose(full, affine.scale(size / width)),
        arrayWidth: width,
        arrayHeight: width,
        tileWidth: tileSize,
        tileHeight: tileSize,
        mpu: 1,
      }),
    );
    if (width <= tileSize) {
      return levels;
    }
  }
}

function tileBounds(
  level: RasterTilesetLevel,
  col: number,
  row: number,
): Bounds {
  const { topLeft, bottomRight } = level.projectedTileCorners(col, row);
  return [topLeft[0], bottomRight[1], bottomRight[0], topLeft[1]];
}

function childRange(
  parent: RasterTilesetLevel,
  child: RasterTilesetLevel,
  col: number,
  row: number,
) {
  return child.crsBoundsToTileRange(...tileBounds(parent, col, row));
}

/** A sample of tile indices along one axis, including both far edges. */
function sampleIndices(n: number): number[] {
  if (n <= 16) {
    return [...Array(n).keys()];
  }
  return [0, 1, n / 2 - 1, n / 2, n - 2, n - 1];
}

function tileKeys(descriptor: RasterTilesetDescriptor, viewport: Viewport) {
  return getTileIndices(descriptor, {
    viewport,
    maxZ: descriptor.levels.length - 1,
    zRange: null,
    wgs84Bounds: [-180, -MAX_LAT, 180, MAX_LAT],
  }).map(({ x, y, z }) => `${z}/${x}/${y}`);
}

/**
 * Selected WebMercatorQuad tiles that cover ground another selected tile also
 * covers: repeats, and tiles selected together with one of their ancestors.
 */
function overlappingTiles(keys: string[]): string[] {
  const selected = new Set(keys);
  const seen = new Set<string>();
  return keys.filter((key) => {
    const repeated = seen.has(key);
    seen.add(key);
    const [z, x, y] = key.split("/").map(Number) as [number, number, number];
    for (let dz = 1; dz <= z; dz++) {
      if (selected.has(`${z - dz}/${x >> dz}/${y >> dz}`)) {
        return true;
      }
    }
    return repeated;
  });
}

describe("crsBoundsToTileRange excludes tiles that only share an edge", () => {
  describe.each(WEB_MERCATOR_QUADS)("WebMercatorQuad (%s)", (_, tms) => {
    const { levels } = new TileMatrixSetAdaptor(tms, projections);

    it("maps tile 1/0/0 to its four children", () => {
      expect(childRange(levels[1]!, levels[2]!, 0, 0)).toEqual({
        minCol: 0,
        maxCol: 1,
        minRow: 0,
        maxRow: 1,
      });
    });

    it("maps every sampled tile at every zoom to its 2×2 children", () => {
      const mismatches: string[] = [];
      for (let z = 0; z < levels.length - 1; z++) {
        for (const x of sampleIndices(2 ** z)) {
          for (const y of sampleIndices(2 ** z)) {
            const range = childRange(levels[z]!, levels[z + 1]!, x, y);
            const expected = {
              minCol: 2 * x,
              maxCol: 2 * x + 1,
              minRow: 2 * y,
              maxRow: 2 * y + 1,
            };
            if (JSON.stringify(range) !== JSON.stringify(expected)) {
              mismatches.push(`${z}/${x}/${y}`);
            }
          }
        }
      }
      expect(mismatches).toEqual([]);
    });
  });

  it("maps each tile of a power-of-two COG pyramid to its 2×2 children", () => {
    const levels = cogLevels(8192, 512);
    for (let z = 0; z < levels.length - 1; z++) {
      for (let x = 0; x < levels[z]!.matrixWidth; x++) {
        expect(childRange(levels[z]!, levels[z + 1]!, x, x)).toEqual({
          minCol: 2 * x,
          maxCol: 2 * x + 1,
          minRow: 2 * x,
          maxRow: 2 * x + 1,
        });
      }
    }
  });

  it("maps a tile to the single tile beneath it when the footprints match", () => {
    // Like the last Sentinel-2 overview: tileWidth doubles while cellSize
    // halves, so each parent covers exactly one child.
    const extent: affine.Affine = [20, 0, 0, 0, -20, 5_000_000];
    const parent = new AffineTilesetLevel({
      affine: extent,
      arrayWidth: 2048,
      arrayHeight: 2048,
      tileWidth: 512,
      tileHeight: 512,
      mpu: 1,
    });
    const child = new AffineTilesetLevel({
      affine: affine.compose(extent, affine.scale(0.5)),
      arrayWidth: 4096,
      arrayHeight: 4096,
      tileWidth: 1024,
      tileHeight: 1024,
      mpu: 1,
    });
    expect(childRange(parent, child, 1, 2)).toEqual({
      minCol: 1,
      maxCol: 1,
      minRow: 2,
      maxRow: 2,
    });
  });

  it("keeps every child that overlaps its parent in a non-aligned COG pyramid", () => {
    // 10980 px (a Sentinel-2 tile) halves exactly to 5490 and 2745, then to
    // 1373, 687 and 344 after rounding up, so only the finer levels line up.
    const levels = cogLevels(10980, 512);
    for (let z = 0; z < levels.length - 1; z++) {
      const parent = levels[z]!;
      const child = levels[z + 1]!;
      const childTile = tileBounds(child, 0, 0);
      const sliver = 1e-6 * (childTile[2] - childTile[0]);
      for (let x = 0; x < parent.matrixWidth; x++) {
        const [minX, , maxX] = tileBounds(parent, x, 0);
        const overlapping: number[] = [];
        for (let col = 0; col < child.matrixWidth; col++) {
          const [childMinX, , childMaxX] = tileBounds(child, col, 0);
          if (Math.min(maxX, childMaxX) - Math.max(minX, childMinX) > sliver) {
            overlapping.push(col);
          }
        }
        const range = childRange(parent, child, x, 0);
        expect([range.minCol, range.maxCol]).toEqual([
          overlapping[0],
          overlapping.at(-1),
        ]);
      }
    }
  });
});

describe("getTileIndices", () => {
  const viewports: [string, Viewport][] = [
    [
      "zoom 3",
      new WebMercatorViewport({
        longitude: 0,
        latitude: 0,
        zoom: 3,
        width: 512,
        height: 512,
      }),
    ],
    [
      "zoom 10",
      new WebMercatorViewport({
        longitude: 0,
        latitude: 0,
        zoom: 10,
        width: 512,
        height: 512,
      }),
    ],
    [
      "pitched and rotated",
      new WebMercatorViewport({
        longitude: -122.42,
        latitude: 37.77,
        zoom: 12,
        width: 1024,
        height: 768,
        pitch: 60,
        bearing: 30,
      }),
    ],
    [
      "pitched across zoom levels",
      new WebMercatorViewport({
        longitude: 20,
        latitude: 40,
        zoom: 2,
        width: 1280,
        height: 720,
        pitch: 45,
      }),
    ],
    [
      "world copies",
      new WebMercatorViewport({
        longitude: 170,
        latitude: 10,
        zoom: 1.5,
        width: 1600,
        height: 800,
        repeat: true,
      }),
    ],
    [
      "globe",
      new GlobeViewport({
        longitude: 0,
        latitude: 20,
        zoom: 2,
        width: 800,
        height: 600,
        resolution: 10,
      }),
    ],
  ];

  describe.each(WEB_MERCATOR_QUADS)("WebMercatorQuad (%s)", (_, tms) => {
    const descriptor = new TileMatrixSetAdaptor(tms, projections);

    it.each(viewports)(
      "selects tiles that do not overlap (%s)",
      (_, viewport) => {
        expect(overlappingTiles(tileKeys(descriptor, viewport))).toEqual([]);
      },
    );
  });

  it("selects each tile once when levels are not aligned", () => {
    const descriptor = new AffineTileset({
      levels: cogLevels(10980, 512),
      ...projections,
    });
    const [longitude, latitude] = projections.projectTo4326(
      54900,
      5_000_000 - 54900,
    );
    const viewport = new WebMercatorViewport({
      longitude,
      latitude,
      zoom: 10,
      width: 1024,
      height: 768,
    });
    const keys = tileKeys(descriptor, viewport);
    expect(keys.length).toBe(new Set(keys).size);
  });
});
