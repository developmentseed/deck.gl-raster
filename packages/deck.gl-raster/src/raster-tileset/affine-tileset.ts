import type { AffineTilesetLevel } from "./affine-tileset-level.js";
import type { TilesetDescriptor } from "./tileset-interface.js";
import type { Bounds, ProjectionFunction } from "./types.js";

/**
 * Constructor options for {@link AffineTileset}.
 */
export interface AffineTilesetOptions {
  /** Resolution levels, ordered coarsest first. */
  levels: AffineTilesetLevel[];
  /** Forward projection function from source CRS to EPSG:3857. */
  projectTo3857: ProjectionFunction;
  /** Inverse projection function from EPSG:3857 to source CRS. */
  projectFrom3857: ProjectionFunction;
  /** Forward projection function from source CRS to EPSG:4326. */
  projectTo4326: ProjectionFunction;
  /** Inverse projection function from EPSG:4326 to source CRS. */
  projectFrom4326: ProjectionFunction;
}

/**
 * A {@link TilesetDescriptor} backed by per-level affine transforms.
 *
 * Derives `projectedBounds` from the coarsest level's array. Everything else
 * is passed through from the constructor options.
 */
export class AffineTileset implements TilesetDescriptor {
  readonly levels: AffineTilesetLevel[];
  readonly projectTo3857: ProjectionFunction;
  readonly projectFrom3857: ProjectionFunction;
  readonly projectTo4326: ProjectionFunction;
  readonly projectFrom4326: ProjectionFunction;
  readonly projectedBounds: Bounds;

  constructor(options: AffineTilesetOptions) {
    if (options.levels.length === 0) {
      throw new Error("AffineTileset requires at least one level");
    }
    this.levels = options.levels;
    this.projectTo3857 = options.projectTo3857;
    this.projectFrom3857 = options.projectFrom3857;
    this.projectTo4326 = options.projectTo4326;
    this.projectFrom4326 = options.projectFrom4326;
    this.projectedBounds = options.levels[0]!.projectedBounds;
  }
}
