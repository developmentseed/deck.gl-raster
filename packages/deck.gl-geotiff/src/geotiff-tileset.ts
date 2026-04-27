import type { ProjectionFunction } from "@developmentseed/deck.gl-raster";
import {
  AffineTileset,
  AffineTilesetLevel,
} from "@developmentseed/deck.gl-raster";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";

/**
 * Build an {@link AffineTileset} {@link TilesetDescriptor} from a {@link GeoTIFF}.
 *
 * Produces one {@link AffineTilesetLevel} per overview plus a final entry for
 * the full-resolution image. Levels are emitted coarsest first.
 *
 * Replaces the previous `generateTileMatrixSet` + `TileMatrixSetAdaptor`
 * pipeline. Because {@link AffineTilesetLevel} is parameterized by an
 * arbitrary affine, this works correctly for COGs with rotated, skewed, or
 * non-square-pixel geotransforms.
 *
 * @param geotiff  The opened GeoTIFF.
 * @param opts     Projection functions and meters-per-CRS-unit.
 */
export function geoTiffToDescriptor(
  geotiff: GeoTIFF,
  opts: {
    projectTo3857: ProjectionFunction;
    projectFrom3857: ProjectionFunction;
    projectTo4326: ProjectionFunction;
    projectFrom4326: ProjectionFunction;
    mpu: number;
  },
): AffineTileset {
  // GeoTIFF.overviews is sorted finest-to-coarsest. Reverse for coarsest-first
  // and append the full-resolution image as the finest level.
  const images: Array<GeoTIFF | Overview> = [
    ...[...geotiff.overviews].reverse(),
    geotiff,
  ];

  const levels = images.map(
    (img) =>
      new AffineTilesetLevel({
        affine: img.transform,
        arrayWidth: img.width,
        arrayHeight: img.height,
        tileWidth: img.tileWidth,
        tileHeight: img.tileHeight,
        mpu: opts.mpu,
      }),
  );

  return new AffineTileset({
    levels,
    projectTo3857: opts.projectTo3857,
    projectFrom3857: opts.projectFrom3857,
    projectTo4326: opts.projectTo4326,
    projectFrom4326: opts.projectFrom4326,
  });
}
