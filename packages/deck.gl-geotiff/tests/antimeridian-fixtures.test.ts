import { WebMercatorViewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import type { RasterLayerProps } from "@developmentseed/deck.gl-raster";
import { RasterLayer, RasterTileset2D } from "@developmentseed/deck.gl-raster";
import { makeClampedForwardTo3857 } from "@developmentseed/proj";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { geoTiffToDescriptor } from "../src/geotiff-tileset.js";
import { loadGeoTIFF } from "./helpers.js";

/** One world width in deck.gl's common space. */
const WORLD = 512;

type Fixture = {
  /** The fixture's CRS, as a PROJ string. */
  crs: string;
  /** Whether the image crosses the antimeridian. */
  crosses: boolean;
  /** Latitude to center test views on. */
  latitude: number;
  /** Views that must select the image: `[longitude, zoom]`. */
  views: [number, number][];
};

const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

// The antimeridian fixtures in fixtures/geotiff-test-data. The views are
// centered on the seam, and on each side of it alone.
const FIXTURES: Record<string, Fixture> = {
  // 204°W to 162°W: a straight seam down the image.
  antimeridian: {
    crs: WGS84,
    crosses: true,
    latitude: 3,
    views: [
      [180, 3],
      [175, 6],
      [-175, 6],
    ],
  },
  // The same, rotated: a slanted seam.
  antimeridian_rotated: {
    crs: WGS84,
    crosses: true,
    latitude: 10,
    views: [
      [180, 3],
      [175, 6],
      [-175, 6],
    ],
  },
  // UTM zone 60N: the seam is a curve in the image.
  antimeridian_UTM_60N: {
    crs: "+proj=utm +zone=60 +datum=WGS84 +units=m +no_defs",
    crosses: true,
    latitude: 52,
    views: [
      [180, 3],
      [177, 7],
      [-177, 7],
    ],
  },
  // EPSG:3832, a Mercator centered on 150°E.
  antimeridian_epsg3832: {
    crs: "+proj=merc +lon_0=150 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
    crosses: true,
    latitude: 3,
    views: [
      [180, 3],
      [175, 6],
      [-175, 6],
    ],
  },
  // 180°W to 180°E: touches the antimeridian at both edges, doesn't cross it.
  antimeridian_edge_to_edge: {
    crs: WGS84,
    crosses: false,
    latitude: 0,
    views: [
      [0, 1],
      [-179, 6],
      [179, 6],
    ],
  },
};

/** A `RasterLayer` we can build meshes with outside of deck.gl. */
function meshOf(props: RasterLayerProps) {
  const layer = new RasterLayer(props);
  const state: Record<string, unknown> = {};
  Object.assign(layer as object, {
    state,
    setState: (updates: Record<string, unknown>) =>
      Object.assign(state, updates),
    raiseError: (error: Error) => {
      throw error;
    },
  });
  (layer as unknown as { _generateMesh: () => void })._generateMesh();
  return state as {
    reprojector: {
      exactOutputPositions: number[];
      triangles: number[];
      getMaxError(): number;
    };
    outputMesh: { positions: number[]; triangles: number[] };
  };
}

/** The x range of a mesh, and of its widest triangle. */
function xExtents(positions: number[], triangles: number[]) {
  const xs = positions.filter((_, i) => i % 2 === 0);
  let widestTriangle = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const span = [0, 1, 2].map((j) => positions[2 * triangles[t + j]!]!);
    widestTriangle = Math.max(
      widestTriangle,
      Math.max(...span) - Math.min(...span),
    );
  }
  return { min: Math.min(...xs), max: Math.max(...xs), widestTriangle };
}

/** Open a fixture and build its tileset with the projections COGLayer builds. */
async function openFixture(name: string, { crs }: Fixture) {
  const geotiff = await loadGeoTIFF(name, "rasterio");
  const to4326 = proj4(crs, "EPSG:4326");
  const to3857 = proj4(crs, "EPSG:3857");
  const projectTo4326 = (x: number, y: number) =>
    to4326.forward<[number, number]>([x, y], false);
  const descriptor = geoTiffToDescriptor(geotiff, {
    projectTo4326,
    projectFrom4326: (x, y) => to4326.inverse<[number, number]>([x, y], false),
    projectTo3857: makeClampedForwardTo3857(
      (x, y) => to3857.forward<[number, number]>([x, y], false),
      projectTo4326,
    ),
    projectFrom3857: (x, y) => to3857.inverse<[number, number]>([x, y], false),
    mpu: 1,
  });
  const tileset = new RasterTileset2D(
    { getTileData: () => new Promise(() => {}) } as Tileset2DProps,
    descriptor,
  );
  return { geotiff, descriptor, tileset };
}

describe("antimeridian fixtures", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    describe(name, () => {
      const opened = openFixture(name, fixture);

      for (const repeat of [false, true]) {
        it(`is selected on and beside the seam${repeat ? " with repeat" : ""}`, async () => {
          const { tileset } = await opened;
          for (const [longitude, zoom] of fixture.views) {
            const viewport = new WebMercatorViewport({
              longitude,
              latitude: fixture.latitude,
              zoom,
              width: 800,
              height: 600,
              repeat,
            });
            const selected = tileset.getTileIndices({ viewport, zRange: null });
            expect(
              selected.length,
              `at ${longitude}°, zoom ${zoom}`,
            ).toBeGreaterThan(0);
          }
        });
      }

      it("draws every tile the short way across the antimeridian, inside the world", async () => {
        const { geotiff, descriptor, tileset } = await opened;
        // The same level order as geoTiffToDescriptor: coarsest first.
        const images = [...[...geotiff.overviews].reverse(), geotiff];
        descriptor.levels.forEach((level, z) => {
          const image = images[z]!;
          for (let y = 0; y < level.matrixHeight; y++) {
            for (let x = 0; x < level.matrixWidth; x++) {
              const where = `${name} z=${z} x=${x} y=${y}`;
              const tile = tileset.getTileMetadata({ x, y, z });
              const { reprojector, outputMesh } = meshOf({
                id: where,
                // COGLayer fetches edge tiles cut to the image.
                width: Math.min(
                  tile.tileWidth,
                  image.width - x * tile.tileWidth,
                ),
                height: Math.min(
                  tile.tileHeight,
                  image.height - y * tile.tileHeight,
                ),
                reprojectionFns: {
                  forwardTransform: tile.forwardTransform,
                  inverseTransform: tile.inverseTransform,
                  forwardReproject: tile._projectPosition,
                  inverseReproject: tile._unprojectPosition,
                },
                initialTriangulation: tile._webMercatorInitialTriangulation,
                _errorSpace: "output",
                _wrapX: WORLD,
              });
              expect(reprojector.getMaxError(), where).toBeLessThanOrEqual(
                0.125,
              );

              const unwrapped = xExtents(
                reprojector.exactOutputPositions,
                reprojector.triangles,
              );
              const drawn = xExtents(
                outputMesh.positions,
                outputMesh.triangles,
              );
              if (fixture.crosses) {
                // The image is under half a world wide, and stays so: it never
                // goes the long way, across the rest of the world.
                expect(unwrapped.max - unwrapped.min, where).toBeLessThan(
                  WORLD / 2,
                );
                expect(unwrapped.min, where).toBeLessThan(WORLD);
                expect(unwrapped.max, where).toBeGreaterThan(WORLD);
                expect(drawn.widestTriangle, where).toBeLessThan(WORLD / 2);
                // Drawn as two parts, one at each edge of the world.
                expect(drawn.min, where).toBe(0);
                expect(drawn.max, where).toBe(WORLD);
              }
              // Every part is drawn inside the world.
              expect(drawn.min, where).toBeGreaterThanOrEqual(0);
              expect(drawn.max, where).toBeLessThanOrEqual(WORLD);
            }
          }
        });
      });

      if (!fixture.crosses) {
        it("keeps the whole world's width", async () => {
          const { geotiff, tileset } = await opened;
          const tile = tileset.getTileMetadata({ x: 0, y: 0, z: 0 });
          const image =
            geotiff.overviews[geotiff.overviews.length - 1] ?? geotiff;
          const { reprojector } = meshOf({
            id: name,
            width: image.width,
            height: image.height,
            reprojectionFns: {
              forwardTransform: tile.forwardTransform,
              inverseTransform: tile.inverseTransform,
              forwardReproject: tile._projectPosition,
              inverseReproject: tile._unprojectPosition,
            },
            initialTriangulation: tile._webMercatorInitialTriangulation,
            _errorSpace: "output",
            _wrapX: WORLD,
          });
          const { min, max } = xExtents(
            reprojector.exactOutputPositions,
            reprojector.triangles,
          );
          expect(max - min).toBeCloseTo(WORLD, 6);
        });
      }
    });
  }
});
