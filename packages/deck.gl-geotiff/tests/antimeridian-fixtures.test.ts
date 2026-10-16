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

/** One world width in EPSG:3857, in metres. */
const WORLD_METRES = 2 * Math.PI * 6378137;

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

/**
 * Build a mesh with a `RasterLayer` outside of deck.gl. Returns the
 * reprojector, whose mesh is unwrapped across the antimeridian, and the mesh
 * as drawn, cut at the world's edge.
 */
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
  const { reprojector, mesh, positions64Low } = state as {
    reprojector: {
      exactOutputPositions: number[];
      triangles: number[];
      getMaxError(): number;
    };
    mesh: {
      indices: { value: Uint32Array };
      attributes: { POSITION: { value: Float32Array } };
    };
    positions64Low: Float32Array;
  };
  // The drawn positions are split into float32 high and low parts, 3 per
  // vertex: add them back up.
  const high = mesh.attributes.POSITION.value;
  const positions: number[] = [];
  for (let i = 0; i < high.length; i += 3) {
    positions.push(
      high[i]! + positions64Low[i]!,
      high[i + 1]! + positions64Low[i + 1]!,
    );
  }
  return {
    reprojector,
    drawn: { positions, triangles: Array.from(mesh.indices.value) },
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

/**
 * A projection from `crs` to deck.gl's common space, the way COGLayer builds
 * one: to EPSG:3857, then scaled to one world of 512 units.
 */
function projectToCommonSpace(crs: string) {
  const to4326 = proj4(crs, "EPSG:4326");
  const to3857 = proj4(crs, "EPSG:3857");
  const projectTo3857 = makeClampedForwardTo3857(
    (x, y) => to3857.forward<[number, number]>([x, y], false),
    (x, y) => to4326.forward<[number, number]>([x, y], false),
  );
  return (x: number, y: number): [number, number] => {
    const [mx, my] = projectTo3857(x, y);
    const clampedY = Math.max(
      -WORLD_METRES / 2,
      Math.min(WORLD_METRES / 2, my),
    );
    return [
      (mx / WORLD_METRES + 0.5) * WORLD,
      (clampedY / WORLD_METRES + 0.5) * WORLD,
    ];
  };
}

/** For the inverse projection, which output mode never calls. */
const unused = (): [number, number] => {
  throw new Error("not used in output mode");
};

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
              const { reprojector, drawn } = meshOf({
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
                _wrapX: WORLD,
              });
              expect(reprojector.getMaxError(), where).toBeLessThanOrEqual(
                0.125,
              );

              const unwrapped = xExtents(
                reprojector.exactOutputPositions,
                reprojector.triangles,
              );
              const parts = xExtents(drawn.positions, drawn.triangles);
              if (fixture.crosses) {
                // The image is under half a world wide, and stays so: it never
                // goes the long way, across the rest of the world.
                expect(unwrapped.max - unwrapped.min, where).toBeLessThan(
                  WORLD / 2,
                );
                // In one piece, across one edge of the world (x = 0 or 512).
                expect(Math.floor(unwrapped.max / WORLD), where).toBe(
                  Math.floor(unwrapped.min / WORLD) + 1,
                );
                expect(parts.widestTriangle, where).toBeLessThan(WORLD / 2);
                // Drawn as two parts, one at each edge of the world.
                expect(parts.min, where).toBe(0);
                expect(parts.max, where).toBe(WORLD);
              }
              // Every part is drawn inside the world.
              expect(parts.min, where).toBeGreaterThanOrEqual(0);
              expect(parts.max, where).toBeLessThanOrEqual(WORLD);
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

describe("an edge block whose padding crosses the antimeridian (#366)", () => {
  it("is drawn the short way across the antimeridian", () => {
    // The last column of a Digital Earth Pacific COG in EPSG:3832, a Mercator
    // centered on 150°E. Its image ends at 179.97°E, but a full 512 px block
    // of 30 m pixels, as MultiCOGLayer fetches it, runs on to 180.07°E.
    const [west, north, metres, size] = [3_332_160, -1_984_000, 30, 512];
    const { reprojector, drawn } = meshOf({
      id: "dep-edge-block",
      width: size,
      height: size,
      reprojectionFns: {
        forwardTransform: (px, py) => [west + px * metres, north - py * metres],
        inverseTransform: (x, y) => [(x - west) / metres, (north - y) / metres],
        forwardReproject: projectToCommonSpace(
          "+proj=merc +lon_0=150 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
        ),
        inverseReproject: unused,
      },
      _wrapX: WORLD,
    });
    expect(reprojector.getMaxError()).toBeLessThanOrEqual(0.125);
    // 15.36 km of Mercator x, the short way across 180°.
    const unwrapped = xExtents(
      reprojector.exactOutputPositions,
      reprojector.triangles,
    );
    expect(unwrapped.max - unwrapped.min).toBeCloseTo(
      ((size * metres) / WORLD_METRES) * WORLD,
      6,
    );
    // Drawn as two parts, one at each edge of the world.
    const parts = xExtents(drawn.positions, drawn.triangles);
    expect(parts.min).toBe(0);
    expect(parts.max).toBe(WORLD);
    expect(parts.widestTriangle).toBeLessThan(WORLD / 2);
  });
});

describe("a tile with a pole at its corner", () => {
  it("is drawn as it would be without wrapping", () => {
    // A quarter of an Antarctic polar stereographic grid (EPSG:3031), with the
    // South Pole at its top left corner and the 180° meridian down its left
    // edge. Its x is arbitrary at the pole.
    const size = 256;
    const metres = 3_000_000;
    const props: RasterLayerProps = {
      id: "south-pole-corner",
      width: size,
      height: size,
      reprojectionFns: {
        forwardTransform: (px, py) => [
          (px / size) * metres,
          -(py / size) * metres,
        ],
        inverseTransform: (x, y) => [(x / metres) * size, (-y / metres) * size],
        forwardReproject: projectToCommonSpace(
          "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
        ),
        inverseReproject: unused,
      },
    };
    const plain = meshOf(props);
    const wrapped = meshOf({ ...props, _wrapX: WORLD });
    expect(wrapped.drawn).toEqual(plain.drawn);
  });
});
