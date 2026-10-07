import {
  AffineTileset,
  AffineTilesetLevel,
} from "@developmentseed/deck.gl-raster";
import { RasterReprojector } from "@developmentseed/raster-reproject";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { CustomProjectionViewport } from "../src/custom-projection/index.js";
import { CustomProjectionTileset2D } from "../src/projected-cog-layer/custom-projection-tileset-2d.js";
import { createProjectionContext } from "../src/projected-cog-layer/projection-context.js";
import { pixelRectToTriangulation } from "../src/projected-cog-layer/tile-geometry.js";
import { PROJECTIONS } from "../src/projections.js";

const identity = (x: number, y: number): [number, number] => [x, y];
const TILE_SIZE = 512;

/**
 * Array sizes of a global EPSG:4326 pyramid shaped like GEBCO's coarse
 * overviews: the coarsest level is 675 px wide (two 512 px tiles).
 */
function levelSizes(levelCount: number): { width: number; height: number }[] {
  return Array.from({ length: levelCount }, (_, z) => {
    const width = 675 * 2 ** z;
    return { width, height: Math.floor(width / 2) };
  });
}

function globalGeographicDescriptor(
  sizes: { width: number; height: number }[],
) {
  return new AffineTileset({
    levels: sizes.map(
      ({ width, height }) =>
        new AffineTilesetLevel({
          affine: [360 / width, 0, -180, 0, -180 / height, 90],
          arrayWidth: width,
          arrayHeight: height,
          tileWidth: TILE_SIZE,
          tileHeight: TILE_SIZE,
          mpu: 111_320,
        }),
    ),
    projectTo3857: identity,
    projectFrom3857: identity,
    projectTo4326: identity,
    projectFrom4326: identity,
  });
}

describe("geographic tiles in polar views", () => {
  for (const presetId of ["arctic", "antarctic"]) {
    it(`mesh every in-domain tile within the refinement cap (${presetId})`, () => {
      const preset = PROJECTIONS.find((p) => p.id === presetId)!;
      const viewport = new CustomProjectionViewport({
        projection: proj4("EPSG:4326", preset.toCrs),
        fromCrs: "EPSG:4326",
        toCrs: preset.toCrs,
        fromBounds: preset.fromBounds,
        width: 1000,
        height: 800,
        center: preset.initialViewState.center,
        zoom: preset.initialViewState.zoom,
      });
      const sizes = levelSizes(4);
      const descriptor = globalGeographicDescriptor(sizes);
      const projection = createProjectionContext(
        viewport,
        descriptor,
        preset.fromBounds,
      );
      const tileset = new CustomProjectionTileset2D(
        { getTileData: () => null } as never,
        descriptor,
        projection,
      );

      const failures: string[] = [];
      descriptor.levels.forEach((level, z) => {
        const size = sizes[z]!;
        for (let y = 0; y < level.matrixHeight; y++) {
          for (let x = 0; x < level.matrixWidth; x++) {
            const tile = tileset.getTileMetadata({ x, y, z });
            if (tile.outsideDomain) {
              continue;
            }
            // Edge tiles are clipped to the image, as COGLayer decodes them.
            const width = Math.min(TILE_SIZE, size.width - x * TILE_SIZE);
            const height = Math.min(TILE_SIZE, size.height - y * TILE_SIZE);
            const seed = tile.domainPixelRect
              ? pixelRectToTriangulation(tile.domainPixelRect, width, height)
              : undefined;
            const reprojector = new RasterReprojector(
              {
                forwardTransform: tile.forwardTransform,
                inverseTransform: tile.inverseTransform,
                forwardReproject: projection.sourceToMap,
                inverseReproject: tile.inverseReproject,
              },
              width + 1,
              height + 1,
              { initialTriangulation: seed },
            );
            reprojector.run(0.125, { maxIterations: 10_000 });
            const error = reprojector.getMaxError();
            if (!(error <= 0.125)) {
              failures.push(
                `z${z} x${x} y${y} (${width}x${height}): error=${error.toFixed(2)} triangles=${reprojector.triangles.length / 3} rect=${JSON.stringify(tile.domainPixelRect)}`,
              );
            }
          }
        }
      });
      expect(failures).toEqual([]);
    }, 120_000);
  }
});
