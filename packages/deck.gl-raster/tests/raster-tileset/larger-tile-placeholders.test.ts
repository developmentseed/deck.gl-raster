/**
 * Placeholders across a level whose tiles are larger than the coarser level's,
 * as in a COG whose overviews use 128 px tiles and its full-resolution image
 * 512 px tiles. See #873.
 */

import type { Viewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { describe, expect, it } from "vitest";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";
import type { TileIndex } from "../../src/raster-tileset/types.js";

const identity = (x: number, y: number): [number, number] => [x, y];

/** A level covering the unit square at `width` px, in `tile` px tiles. */
function squareLevel(width: number, tile: number): AffineTilesetLevel {
  return new AffineTilesetLevel({
    affine: [1 / width, 0, 0, 0, -1 / width, 1],
    arrayWidth: width,
    arrayHeight: width,
    tileWidth: tile,
    tileHeight: tile,
    mpu: 1,
  });
}

/** A tileset whose selection the test sets, and whose tiles never load. */
class ControlledTileset extends RasterTileset2D {
  forced: TileIndex[] = [];

  override getTileIndices(): TileIndex[] {
    return this.forced;
  }
}

/** Levels, coarsest first, each `[width, tile]` in px. */
function makeTileset(
  levels: [number, number][],
  opts?: Partial<Tileset2DProps>,
): ControlledTileset {
  return new ControlledTileset(
    { getTileData: () => new Promise(() => {}), ...opts },
    new AffineTileset({
      levels: levels.map(([width, tile]) => squareLevel(width, tile)),
      projectTo3857: identity,
      projectFrom3857: identity,
      projectTo4326: identity,
      projectFrom4326: identity,
    }),
  );
}

/** Every tile of an `n` × `n` level `z`. */
function grid(z: number, n: number): TileIndex[] {
  const indices: TileIndex[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      indices.push({ x, y, z });
    }
  }
  return indices;
}

function select(tileset: ControlledTileset, indices: TileIndex[]): void {
  tileset.forced = indices;
  // A viewport that never equals the last one, so the selection is re-read.
  const viewport = { equals: () => false } as unknown as Viewport;
  tileset.update(viewport, { zRange: null, modelMatrix: null });
}

function load(tileset: ControlledTileset, ids: string[]): void {
  for (const tile of tileset.tiles) {
    if (ids.includes(tile.id)) {
      tile.content = { width: 1, height: 1 };
      // @ts-expect-error _isLoaded is private
      tile._isLoaded = true;
    }
  }
  // Show the loads, as deck.gl's TileLayer does on each load.
  select(tileset, tileset.forced);
}

/** The ids, `x-y-z`, of the visible tiles of level `z`. */
function visible(tileset: ControlledTileset, z: number): string[] {
  return tileset.tiles
    .filter((tile) => tile.index.z === z && tile.isVisible)
    .map((tile) => tile.id)
    .sort();
}

const ids = (indices: TileIndex[]) =>
  indices.map(({ x, y, z }) => `${x}-${y}-${z}`).sort();

// A 512 px overview in 128 px tiles (4 × 4), then a 1024 px full-resolution
// image in 512 px tiles (2 × 2): each full-resolution tile covers 2 × 2
// overview tiles.
const OVERVIEW_THEN_FULL: [number, number][] = [
  [512, 128],
  [1024, 512],
];

describe("best-available across larger tiles", () => {
  it("keeps every overview tile a loading full-resolution tile covers", () => {
    const tileset = makeTileset(OVERVIEW_THEN_FULL);
    select(tileset, grid(0, 4));
    load(tileset, ids(grid(0, 4)));

    select(tileset, grid(1, 2));

    expect(visible(tileset, 0)).toEqual(ids(grid(0, 4)));
  });

  it("leaves out an overview tile a full-resolution tile only grazes", () => {
    // A 9571 px image in 512 px tiles over a 4786 px overview in 128 px
    // tiles. The overview's width is rounded up from 4785.5, so its tile
    // edges drift from the full-resolution ones by up to half a pixel.
    const tileset = makeTileset([
      [4786, 128],
      [9571, 512],
    ]);
    const overview = [8, 9, 10].flatMap((x) => [
      { x, y: 0, z: 0 },
      { x, y: 1, z: 0 },
    ]);
    select(tileset, overview);
    load(tileset, ids(overview));

    // Full-resolution tile 4-0 covers overview columns 8 and 9, and column 10
    // by less than a pixel.
    select(tileset, [{ x: 4, y: 0, z: 1 }]);

    expect(visible(tileset, 0)).toEqual(["8-0-0", "8-1-0", "9-0-0", "9-1-0"]);
  });

  it("hides the overview tiles once the full-resolution tiles load", () => {
    const tileset = makeTileset(OVERVIEW_THEN_FULL);
    select(tileset, grid(0, 4));
    load(tileset, ids(grid(0, 4)));
    select(tileset, grid(1, 2));

    load(tileset, ids(grid(1, 2)));

    expect(visible(tileset, 0)).toEqual([]);
    expect(visible(tileset, 1)).toEqual(ids(grid(1, 2)));
  });

  it("keeps a full-resolution tile until every overview tile it covers loads", () => {
    const tileset = makeTileset(OVERVIEW_THEN_FULL);
    select(tileset, grid(1, 2));
    load(tileset, ids(grid(1, 2)));
    select(tileset, grid(0, 4));

    // One of the four overview tiles under 0-0-1 loads.
    load(tileset, ["1-1-0"]);

    expect(visible(tileset, 1)).toEqual(ids(grid(1, 2)));
  });

  it("falls back to a coarser tile where a covered tile isn't cached", () => {
    // A 256 px overview in 128 px tiles (2 × 2) above the same two levels.
    const tileset = makeTileset([[256, 128], ...OVERVIEW_THEN_FULL]);
    select(tileset, grid(0, 2));
    load(tileset, ids(grid(0, 2)));
    // Three of the four tiles under full-resolution tile 0-0-2 load; the
    // fourth, 1-1-1, is never requested.
    select(tileset, [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
    ]);
    load(tileset, ["0-0-1", "1-0-1", "0-1-1"]);

    select(tileset, [{ x: 0, y: 0, z: 2 }]);

    expect(visible(tileset, 1)).toEqual(["0-0-1", "0-1-1", "1-0-1"]);
    // 0-0-0 covers 1-1-1's quarter.
    expect(visible(tileset, 0)).toEqual(["0-0-0"]);
  });

  it("leaves other refinement strategies to deck.gl", () => {
    const tileset = makeTileset(OVERVIEW_THEN_FULL, {
      refinementStrategy: "never",
    });
    select(tileset, grid(0, 4));
    load(tileset, ids(grid(0, 4)));

    select(tileset, grid(1, 2));

    expect(visible(tileset, 0)).toEqual([]);
  });
});
