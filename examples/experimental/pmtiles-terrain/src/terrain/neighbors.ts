/** A WebMercatorQuad tile: zoom, column and row. */
export type TileIndex = { z: number; x: number; y: number };

/** Index of the tile itself in the 3 x 3 block {@link neighborIndices} returns. */
export const CENTER_INDEX = 4;

/**
 * The 3 x 3 block of tiles centered on `tile`, row-major from the top-left,
 * with `tile` itself at {@link CENTER_INDEX}.
 *
 * Columns wrap around the antimeridian, so a tile at the world's west edge
 * has real neighbors at its east edge (and the lone z0 tile is its own east
 * and west neighbor). Rows don't wrap: past the top or bottom row there is no
 * tile, so those entries are `null`.
 */
export function neighborIndices(tile: TileIndex): Array<TileIndex | null> {
  const { z, x, y } = tile;
  const count = 2 ** z;
  const block: Array<TileIndex | null> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const row = y + dy;
      if (row < 0 || row >= count) {
        block.push(null);
      } else {
        block.push({ z, x: (((x + dx) % count) + count) % count, y: row });
      }
    }
  }
  return block;
}

/** A stable string key for a tile, `z/x/y`. */
export function tileKey(tile: TileIndex): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}
