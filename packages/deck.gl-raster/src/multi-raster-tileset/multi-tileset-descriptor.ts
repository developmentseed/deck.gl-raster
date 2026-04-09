import type {
  TilesetDescriptor,
  TilesetLevel,
} from "../raster-tileset/tileset-interface.js";
import type { Bounds, ProjectionFunction } from "../raster-tileset/types.js";

export interface MultiTilesetDescriptor {
  primary: TilesetDescriptor;
  primaryKey: string;
  secondaries: Map<string, TilesetDescriptor>;
  bounds: Bounds;
  projectTo3857: ProjectionFunction;
  projectTo4326: ProjectionFunction;
}

export function createMultiTilesetDescriptor(
  tilesets: Map<string, TilesetDescriptor>,
): MultiTilesetDescriptor {
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
  const secondaries = new Map<string, TilesetDescriptor>();
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

export function selectSecondaryLevel(
  levels: TilesetLevel[],
  primaryMetersPerPixel: number,
): TilesetLevel {
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

export function tilesetLevelsEqual(a: TilesetLevel, b: TilesetLevel): boolean {
  return (
    a.matrixWidth === b.matrixWidth &&
    a.matrixHeight === b.matrixHeight &&
    a.tileWidth === b.tileWidth &&
    a.tileHeight === b.tileHeight &&
    a.metersPerPixel === b.metersPerPixel
  );
}
