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

const TILE_SIZE = 512;
/** Half-width of the NASA Explorer Base Map's square EPSG:3031 extent. */
const HALF_EXTENT = 12_367_875;

describe("polar-native tiles in their own projection", () => {
  it("mesh a hemisphere-wide EPSG:3031 pyramid within the refinement cap", () => {
    const preset = PROJECTIONS.find((p) => p.id === "antarctic")!;
    const toLngLat = proj4(preset.toCrs, "EPSG:4326");
    // The basemap's coarsest levels: 257, 515, 1031 and 2062 px wide.
    const widths = [257, 515, 1031, 2062];
    const descriptor = new AffineTileset({
      levels: widths.map((width) => {
        const pixelSize = (2 * HALF_EXTENT) / width;
        return new AffineTilesetLevel({
          affine: [pixelSize, 0, -HALF_EXTENT, 0, -pixelSize, HALF_EXTENT],
          arrayWidth: width,
          arrayHeight: width,
          tileWidth: TILE_SIZE,
          tileHeight: TILE_SIZE,
          mpu: 1,
        });
      }),
      projectTo3857: (x, y) => [x, y],
      projectFrom3857: (x, y) => [x, y],
      projectTo4326: (x, y) => toLngLat.forward<[number, number]>([x, y]),
      projectFrom4326: (x, y) => toLngLat.inverse<[number, number]>([x, y]),
    });
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
      const levelWidth = widths[z]!;
      for (let y = 0; y < level.matrixHeight; y++) {
        for (let x = 0; x < level.matrixWidth; x++) {
          const tile = tileset.getTileMetadata({ x, y, z });
          if (tile.outsideDomain) {
            continue;
          }
          const width = Math.min(TILE_SIZE, levelWidth - x * TILE_SIZE);
          const height = Math.min(TILE_SIZE, levelWidth - y * TILE_SIZE);
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
            failures.push(`z${z} x${x} y${y}: error=${error.toFixed(2)}`);
          }
        }
      }
    });
    expect(failures).toEqual([]);
  }, 120_000);
});
