import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import type { Affine } from "@developmentseed/affine";
import { compose, rotation, scale, translation } from "@developmentseed/affine";
import { RasterReprojector } from "@developmentseed/raster-reproject";
import { describe, expect, it } from "vitest";
import { clipMeshToWorld } from "../../src/clip-mesh-to-world.js";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";
import type { RasterTilesetDescriptor } from "../../src/raster-tileset/tileset-interface.js";

// End-to-end: tile metadata → RasterReprojector (wrapX) → clipMeshToWorld,
// for each antimeridian seam shape in
// fixtures/geotiff-test-data/rasterio_generated/fixtures/.

const TILE_SIZE = 512;
const HALF = 20037508.342789244;
const RAD = Math.PI / 180;

/** proj4 normalizes longitude to (−180°, 180°]. */
const wrapLng = (lng: number) => lng - 360 * Math.ceil((lng - 180) / 360);
const toMerc = (lng: number, lat: number): [number, number] => [
  (lng / 180) * HALF,
  Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) * (HALF / Math.PI),
];
const fromMerc = (x: number, y: number): [number, number] => [
  (x / HALF) * 180,
  (2 * Math.atan(Math.exp((y / HALF) * Math.PI)) - Math.PI / 2) / RAD,
];

/**
 * An EPSG:4326 source: proj4 4326→4326 passes native longitudes through
 * un-normalized (e.g. −204°), but 4326→3857 wraps them.
 */
const GEOGRAPHIC = {
  projectTo4326: (x: number, y: number): [number, number] => [x, y],
  projectFrom4326: (x: number, y: number): [number, number] => [x, y],
  projectTo3857: (x: number, y: number) => toMerc(wrapLng(x), y),
  projectFrom3857: fromMerc,
};

/**
 * A projected source with *curved* meridians (sinusoidal, central meridian
 * 177° like UTM 60N). Its lng/lat output is normalized; its inverse folds
 * longitude against the central meridian (proj4's `adjlon`).
 */
const K = 1e5;
const CENTRAL = 177;
const sinusoidalTo4326 = (x: number, y: number): [number, number] => {
  const lat = y / K;
  return [wrapLng(CENTRAL + x / (K * Math.cos(lat * RAD))), lat];
};
const sinusoidalFrom4326 = (lng: number, lat: number): [number, number] => [
  wrapLng(lng - CENTRAL) * K * Math.cos(lat * RAD),
  lat * K,
];
const SINUSOIDAL = {
  projectTo4326: sinusoidalTo4326,
  projectFrom4326: sinusoidalFrom4326,
  projectTo3857: (x: number, y: number) => toMerc(...sinusoidalTo4326(x, y)),
  projectFrom3857: (x: number, y: number) =>
    sinusoidalFrom4326(...fromMerc(x, y)),
};

function tileset(
  projections: typeof GEOGRAPHIC,
  affine: Affine,
  arrayWidth: number,
  arrayHeight: number,
  tileSize: number,
): { tileset: RasterTileset2D; descriptor: RasterTilesetDescriptor } {
  const level = new AffineTilesetLevel({
    affine,
    arrayWidth,
    arrayHeight,
    tileWidth: tileSize,
    tileHeight: tileSize,
    mpu: 1,
  });
  const descriptor = new AffineTileset({ levels: [level], ...projections });
  const props = { getTileData: () => new Promise(() => {}) } as Tileset2DProps;
  return { tileset: new RasterTileset2D(props, descriptor), descriptor };
}

/**
 * Mesh tile (0, 0, 0). `dataSize` is the fetched data's size — COGLayer
 * fetches edge tiles clipped to the image, so the mesh spans only the data.
 */
function meshTile(t: RasterTileset2D, dataSize?: [number, number]) {
  const md = t.getTileMetadata({ x: 0, y: 0, z: 0 });
  const [width, height] = dataSize ?? [md.tileWidth, md.tileHeight];
  const reprojector = new RasterReprojector(
    {
      forwardTransform: md.forwardTransform,
      inverseTransform: md.inverseTransform,
      forwardReproject: md._projectPosition,
      inverseReproject: md._unprojectPosition,
    },
    width + 1,
    height + 1,
    {
      initialTriangulation: md._webMercatorInitialTriangulation(width, height),
      wrapX: 512,
    },
  );
  reprojector.run(0.125, { maxIterations: 2000 });
  const clipped = clipMeshToWorld(
    {
      positions: reprojector.exactOutputPositions,
      uvs: reprojector.uvs,
      triangles: reprojector.triangles,
    },
    TILE_SIZE,
  );
  return { md, reprojector, clipped };
}

const SHAPES = {
  // antimeridian.tif: lng −204..−162, cut at column 24.
  vertical: () =>
    tileset(
      GEOGRAPHIC,
      compose(translation(-204, 24), scale(1, -1)),
      42,
      42,
      42,
    ),
  // antimeridian_rotated.tif: rotated geotransform → straight slanted seam.
  slanted: () =>
    tileset(
      GEOGRAPHIC,
      compose(translation(-204, 24), compose(rotation(20), scale(1, -1))),
      42,
      42,
      42,
    ),
  // antimeridian_utm60.tif-like: ~174°E..173°W, 48°N..56°N, curved seam.
  curved: () =>
    tileset(
      SINUSOIDAL,
      compose(translation(-2e5, 56e5), scale(2e4, -2e4)),
      42,
      42,
      42,
    ),
};

describe("antimeridian crossing: unwrap + clip", () => {
  for (const [name, make] of Object.entries(SHAPES)) {
    describe(name, () => {
      const { descriptor, tileset: t } = make();
      const { md, reprojector, clipped } = meshTile(t);

      it("converges", () => {
        expect(reprojector.getMaxError()).toBeLessThanOrEqual(0.125);
      });

      it("is continuous: no triangle jumps across the seam", () => {
        const { triangles, exactOutputPositions: p } = reprojector;
        for (let i = 0; i < triangles.length; i += 3) {
          const xs = [0, 1, 2].map((j) => p[2 * triangles[i + j]!]!);
          // A wrapped triangle would span ~a whole world (512).
          expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(TILE_SIZE / 2);
        }
      });

      it("actually straddles a world boundary, and clips into [0, 512]", () => {
        const xs = reprojector.exactOutputPositions.filter(
          (_, i) => i % 2 === 0,
        );
        const copies = new Set(xs.map((x) => Math.floor(x / TILE_SIZE)));
        expect(copies.size).toBe(2);
        for (let i = 0; i < clipped.positions.length; i += 2) {
          expect(clipped.positions[i]!).toBeGreaterThanOrEqual(-1e-9);
          expect(clipped.positions[i]!).toBeLessThanOrEqual(TILE_SIZE + 1e-9);
        }
      });

      it("places every vertex at its true longitude (mod one world)", () => {
        const { uvs, exactOutputPositions: p } = reprojector;
        for (let i = 0; i < uvs.length / 2; i++) {
          const [sx, sy] = md.forwardTransform(
            uvs[2 * i]! * md.tileWidth,
            uvs[2 * i + 1]! * md.tileHeight,
          );
          const [lng] = descriptor.projectTo4326(sx, sy);
          const expected = ((lng + 180) / 360) * TILE_SIZE;
          const diff = (p[2 * i]! - expected) / TILE_SIZE;
          expect(Math.abs(diff - Math.round(diff))).toBeLessThan(1e-9);
        }
      });

      it("round-trips forward/inverse from either world copy", () => {
        for (const [px, py] of [
          [1, 1],
          [21, 21],
          [41, 41],
          [41, 1],
          [1, 41],
        ] as const) {
          const [sx, sy] = md.forwardTransform(px, py);
          const [cx, cy] = md._projectPosition(sx, sy);
          for (const shift of [0, TILE_SIZE, -TILE_SIZE]) {
            const [rx, ry] = md._unprojectPosition(cx + shift, cy);
            const [rpx, rpy] = md.inverseTransform(rx, ry);
            if (shift === 0 || name === "curved") {
              // A projected source folds any copy back; a 4326 source only
              // round-trips from the copy forward placed it in — the only
              // one the mesh ever asks about.
              expect(rpx).toBeCloseTo(px, 6);
              expect(rpy).toBeCloseTo(py, 6);
            }
          }
        }
      });
    });
  }

  describe("world-spanning (antimeridian_360.tif overview)", () => {
    // 36×2 px at 10°/px in a 64 px tile, fetched clipped: −180..180.
    const { tileset: t } = tileset(
      GEOGRAPHIC,
      compose(translation(-180, 10), scale(10, -10)),
      36,
      2,
      64,
    );
    const { reprojector, clipped } = meshTile(t, [36, 2]);

    it("converges and covers exactly one world, with no gap", () => {
      expect(reprojector.getMaxError()).toBeLessThanOrEqual(0.125);
      const xs = clipped.positions.filter((_, i) => i % 2 === 0);
      expect(Math.min(...xs)).toBeCloseTo(0, 6);
      expect(Math.max(...xs)).toBeCloseTo(TILE_SIZE, 6);
      for (let i = 0; i < clipped.positions.length; i += 2) {
        expect(clipped.positions[i]!).toBeGreaterThanOrEqual(-1e-9);
        expect(clipped.positions[i]!).toBeLessThanOrEqual(TILE_SIZE + 1e-9);
      }
    });
  });
});
