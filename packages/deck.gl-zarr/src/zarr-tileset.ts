import type {
  ProjectionFunction,
  TilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import {
  AffineTileset,
  AffineTilesetLevel,
} from "@developmentseed/deck.gl-raster";
import type { GeoZarrMetadata } from "@developmentseed/geozarr";

/**
 * Convert a `GeoZarrMetadata` object into a `TilesetDescriptor` for use with
 * `RasterTileset2D`.
 *
 * @param meta  Parsed GeoZarr metadata (from `parseGeoZarrMetadata`).
 * @param opts  Projection functions and tiling parameters.
 * @param opts.projectTo4326   Forward projection: source CRS → EPSG:4326.
 * @param opts.projectFrom4326 Inverse projection: EPSG:4326 → source CRS.
 * @param opts.projectTo3857   Forward projection: source CRS → EPSG:3857.
 * @param opts.projectFrom3857 Inverse projection: EPSG:3857 → source CRS.
 * @param opts.chunkSizes      Chunk (tile) width/height per level, in the same
 *                             finest-first order as `meta.levels`.
 * @param opts.mpu             Meters per CRS unit.
 */
export function geoZarrToDescriptor(
  meta: GeoZarrMetadata,
  opts: {
    projectTo4326: ProjectionFunction;
    projectFrom4326: ProjectionFunction;
    projectTo3857: ProjectionFunction;
    projectFrom3857: ProjectionFunction;
    chunkSizes: Array<{ width: number; height: number }>;
    mpu: number;
  },
): TilesetDescriptor {
  if (opts.chunkSizes.length !== meta.levels.length) {
    throw new Error(
      `chunkSizes length (${opts.chunkSizes.length}) must match meta.levels length (${meta.levels.length})`,
    );
  }

  // meta.levels is finest-first; TilesetDescriptor requires coarsest-first.
  const reversedLevels = [...meta.levels].reverse();
  const reversedChunks = [...opts.chunkSizes].reverse();

  const levels = reversedLevels.map((level, i) => {
    const chunk = reversedChunks[i]!;
    return new AffineTilesetLevel({
      affine: level.affine,
      arrayWidth: level.arrayWidth,
      arrayHeight: level.arrayHeight,
      tileWidth: chunk.width,
      tileHeight: chunk.height,
      mpu: opts.mpu,
    });
  });

  return new AffineTileset({
    levels,
    projectTo4326: opts.projectTo4326,
    projectFrom4326: opts.projectFrom4326,
    projectTo3857: opts.projectTo3857,
    projectFrom3857: opts.projectFrom3857,
  });
}
