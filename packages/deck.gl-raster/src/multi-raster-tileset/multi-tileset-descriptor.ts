import type {
  RasterTilesetDescriptor,
  RasterTilesetLevel,
} from "../raster-tileset/tileset-interface.js";
import type { Bounds, ProjectionFunction } from "../raster-tileset/types.js";

/**
 * Groups N {@link RasterTilesetDescriptor}s representing the same geographic extent
 * at different native resolutions.
 *
 * The {@link primary} tileset (finest resolution) drives tile traversal;
 * {@link secondaries} are consulted at fetch time to resolve covering tiles
 * and compute UV transforms.
 *
 * @see {@link createMultiRasterTilesetDescriptor} to construct from a named map of tilesets
 */
export interface MultiRasterTilesetDescriptor {
  /** Highest-resolution tileset — drives tile traversal. */
  primary: RasterTilesetDescriptor;
  /** The key under which the primary was provided to {@link createMultiRasterTilesetDescriptor}. */
  primaryKey: string;
  /** Lower-resolution tilesets, keyed by user-defined name. */
  secondaries: Map<string, RasterTilesetDescriptor>;
  /** Shared CRS bounds (from primary's {@link RasterTilesetDescriptor.projectedBounds}). */
  bounds: Bounds;
  /** Shared projection: source CRS -> EPSG:3857. */
  projectTo3857: ProjectionFunction;
  /** Shared projection: source CRS -> EPSG:4326. */
  projectTo4326: ProjectionFunction;
}

/**
 * Create a {@link MultiRasterTilesetDescriptor} from a map of named tilesets.
 *
 * Automatically selects the tileset with the finest
 * {@link RasterTilesetLevel.metersPerPixel} at its highest-resolution level as the
 * primary. All others become secondaries.
 *
 * @param tilesets - Named tilesets, e.g. `new Map([["B04", band10m], ["B11", band20m]])`
 * @throws If `tilesets` is empty
 */
export function createMultiRasterTilesetDescriptor(
  tilesets: Map<string, RasterTilesetDescriptor>,
): MultiRasterTilesetDescriptor {
  if (tilesets.size === 0) {
    throw new Error("At least one tileset is required");
  }
  let primaryKey: string | null = null;
  let finestMpp = Number.POSITIVE_INFINITY;
  for (const [key, descriptor] of tilesets) {
    const finestLevel = descriptor.levels[descriptor.levels.length - 1];
    if (finestLevel && finestLevel.metersPerPixel < finestMpp) {
      finestMpp = finestLevel.metersPerPixel;
      primaryKey = key;
    }
  }
  const primary = tilesets.get(primaryKey!)!;
  const secondaries = new Map<string, RasterTilesetDescriptor>();
  for (const [key, descriptor] of tilesets) {
    if (key !== primaryKey) {
      secondaries.set(key, descriptor);
    }
  }
  return {
    primary,
    primaryKey: primaryKey!,
    secondaries,
    bounds: primary.projectedBounds,
    projectTo3857: primary.projectTo3857,
    projectTo4326: primary.projectTo4326,
  };
}

/**
 * Strategy for selecting a secondary tileset level.
 *
 * - `"closest"` — Pick the level whose `metersPerPixel` is nearest to the
 *   primary's, in either direction. Minimizes wasted bandwidth but may return
 *   a slightly coarser level than necessary.
 * - `"closest-finer"` — Prefer the finest level whose `metersPerPixel` is
 *   <= the primary's. Falls back to the finest available if all levels are
 *   coarser. Ensures the secondary is never blurrier than necessary when a
 *   finer option exists.
 */
export type SecondaryLevelStrategy = "closest" | "closest-finer";

/**
 * Select the best {@link RasterTilesetLevel} from a secondary tileset for a given
 * primary {@link RasterTilesetLevel.metersPerPixel}.
 *
 * @param levels - Ordered coarsest-first (index 0 = coarsest), matching
 *   {@link RasterTilesetDescriptor.levels} convention
 * @param primaryMetersPerPixel - The `metersPerPixel` of the current primary
 *   tile's zoom level
 * @param strategy - Selection strategy. Defaults to `"closest-finer"`.
 * @returns The selected {@link RasterTilesetLevel}
 *
 * @see {@link SecondaryLevelStrategy} for available strategies
 */
export function selectSecondaryLevel(
  levels: RasterTilesetLevel[],
  primaryMetersPerPixel: number,
  strategy: SecondaryLevelStrategy = "closest-finer",
): RasterTilesetLevel {
  if (strategy === "closest-finer") {
    // Among levels that are finer-or-equal to the primary, pick the closest
    // (coarsest of the finer-or-equal set). Walk from coarsest to finest,
    // tracking the last level that's <= primary.
    let bestFiner: RasterTilesetLevel | null = null;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i]!.metersPerPixel <= primaryMetersPerPixel) {
        bestFiner = levels[i]!;
        break;
      }
    }
    // If found, return it; otherwise fall back to the finest available
    return bestFiner ?? levels[levels.length - 1]!;
  }

  // "closest" — pick the level with the smallest absolute difference
  let best = levels[0]!;
  let bestDiff = Math.abs(best.metersPerPixel - primaryMetersPerPixel);
  for (let i = 1; i < levels.length; i++) {
    const diff = Math.abs(levels[i]!.metersPerPixel - primaryMetersPerPixel);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = levels[i]!;
    }
  }
  return best;
}

/**
 * Check if two {@link RasterTilesetLevel}s have the same grid parameters.
 *
 * Used to detect when sources share a tile grid and can skip UV transform
 * computation (e.g., all 10m Sentinel-2 bands share the same grid).
 *
 * Compares {@link RasterTilesetLevel.matrixWidth}, {@link RasterTilesetLevel.matrixHeight},
 * {@link RasterTilesetLevel.tileWidth}, {@link RasterTilesetLevel.tileHeight}, and
 * {@link RasterTilesetLevel.metersPerPixel}.
 */
export function tilesetLevelsEqual(
  a: RasterTilesetLevel,
  b: RasterTilesetLevel,
): boolean {
  return (
    a.matrixWidth === b.matrixWidth &&
    a.matrixHeight === b.matrixHeight &&
    a.tileWidth === b.tileWidth &&
    a.tileHeight === b.tileHeight &&
    a.metersPerPixel === b.metersPerPixel
  );
}
