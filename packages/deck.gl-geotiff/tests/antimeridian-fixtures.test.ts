import { WebMercatorViewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { RasterTileset2D } from "@developmentseed/deck.gl-raster";
import { makeClampedForwardTo3857 } from "@developmentseed/proj";
import { RasterReprojector } from "@developmentseed/raster-reproject";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { geoTiffToDescriptor } from "../src/geotiff-tileset.js";
import { loadGeoTIFF } from "./helpers.js";

// Every tile of every level of each antimeridian fixture, through the real
// proj4 projections COGLayer builds, must mesh continuously across ±180°.
const FIXTURES = {
  antimeridian: "EPSG:4326", // vertical seam
  antimeridian_rotated: "EPSG:4326", // slanted seam
  antimeridian_utm60: "EPSG:32660", // curved seam
  antimeridian_360: "EPSG:4326", // world-spanning
};

const TILE_SIZE = 512;

const SELECT_LAT: Record<string, number> = {
  antimeridian: 3,
  antimeridian_rotated: 10,
  antimeridian_utm60: 52,
  antimeridian_360: 0,
};
const SELECT_VIEWS: Record<string, [lng: number, zoom: number][]> = {
  antimeridian: [
    [180, 3],
    [175, 6],
    [-175, 6],
  ],
  antimeridian_rotated: [
    [180, 3],
    [175, 6],
    [-175, 6],
  ],
  antimeridian_utm60: [
    [180, 3],
    [177, 7],
    [-177, 7],
  ],
  antimeridian_360: [
    [0, 1],
    [180, 3],
    [-179, 6],
    [179, 6],
  ],
};

describe("antimeridian fixtures mesh across ±180°", () => {
  for (const [name, crs] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const geotiff = await loadGeoTIFF(name, "rasterio");
      const c4326 = proj4(crs, "EPSG:4326");
      const c3857 = proj4(crs, "EPSG:3857");
      const projectTo4326 = (x: number, y: number) =>
        c4326.forward<[number, number]>([x, y], false);
      const descriptor = geoTiffToDescriptor(geotiff, {
        projectTo4326,
        projectFrom4326: (x, y) =>
          c4326.inverse<[number, number]>([x, y], false),
        projectTo3857: makeClampedForwardTo3857(
          (x, y) => c3857.forward<[number, number]>([x, y], false),
          projectTo4326,
        ),
        projectFrom3857: (x, y) =>
          c3857.inverse<[number, number]>([x, y], false),
        mpu: 1,
      });
      const tileset = new RasterTileset2D(
        { getTileData: () => new Promise(() => {}) } as Tileset2DProps,
        descriptor,
      );

      // Selected when centered on the seam, and on either side alone.
      for (const [longitude, zoom] of SELECT_VIEWS[name]!) {
        const viewport = new WebMercatorViewport({
          longitude,
          latitude: SELECT_LAT[name]!,
          zoom,
          width: 800,
          height: 600,
          repeat: true,
        });
        const selected = tileset.getTileIndices({ viewport, zRange: null });
        expect(
          selected.length,
          `${name} @ lng ${longitude} z${zoom}`,
        ).toBeGreaterThan(0);
      }

      // Same level order as geoTiffToDescriptor: coarsest first.
      const images = [...[...geotiff.overviews].reverse(), geotiff];
      descriptor.levels.forEach((level, z) => {
        const image = images[z]!;
        for (let y = 0; y < level.matrixHeight; y++) {
          for (let x = 0; x < level.matrixWidth; x++) {
            const md = tileset.getTileMetadata({ x, y, z });
            // COGLayer fetches edge tiles clipped to the image.
            const width = Math.min(
              md.tileWidth,
              image.width - x * md.tileWidth,
            );
            const height = Math.min(
              md.tileHeight,
              image.height - y * md.tileHeight,
            );
            const r = new RasterReprojector(
              {
                forwardTransform: md.forwardTransform,
                inverseTransform: md.inverseTransform,
                forwardReproject: md._projectPosition,
                inverseReproject: md._unprojectPosition,
              },
              width + 1,
              height + 1,
              {
                initialTriangulation: md._webMercatorInitialTriangulation(
                  width,
                  height,
                ),
                wrapX: TILE_SIZE,
              },
            );
            r.run(0.125, { maxIterations: 3000 });
            const where = `${name} z=${z} x=${x} y=${y}`;
            expect(r.getMaxError(), where).toBeLessThanOrEqual(0.125);
            const { triangles, exactOutputPositions: p } = r;
            // A wrapped triangle would span ~a whole world. The 360° image
            // legitimately has triangles that do, so it may reach exactly one.
            // The mesh covers the whole tile: its clipped x-extent matches
            // the tile's own longitude span (no gap near the seam).
            const lngAt = (px: number, py: number) =>
              projectTo4326(...md.forwardTransform(px, py))[0];
            const xs = p.filter((_, i) => i % 2 === 0);
            const meshSpanDeg =
              ((Math.max(...xs) - Math.min(...xs)) / TILE_SIZE) * 360;
            const west = lngAt(0, 0);
            const east = lngAt(width, 0);
            const tileSpanDeg = east > west ? east - west : east + 360 - west;
            expect(meshSpanDeg, where).toBeGreaterThanOrEqual(
              Math.min(tileSpanDeg, 360) - 1e-6,
            );
            const maxSpan =
              name === "antimeridian_360" ? TILE_SIZE + 1e-6 : TILE_SIZE / 2;
            for (let i = 0; i < triangles.length; i += 3) {
              const xs = [0, 1, 2].map((j) => p[2 * triangles[i + j]!]!);
              expect(
                Math.max(...xs) - Math.min(...xs),
                where,
              ).toBeLessThanOrEqual(maxSpan);
            }
          }
        }
      });
    });
  }
});
