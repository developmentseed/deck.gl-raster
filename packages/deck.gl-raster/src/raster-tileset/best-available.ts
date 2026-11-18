import type { _Tile2DHeader as Tile2DHeader } from "@deck.gl/geo-layers";

/**
 * deck.gl's `best-available` refinement, for tiles that can have several
 * parents.
 *
 * Each selected tile that hasn't loaded shows its nearest loaded ancestors in
 * its place, and its nearest loaded descendants where those don't cover it.
 * When every tile has at most one parent, this is deck.gl's own strategy.
 *
 * @param tiles      Every cached tile.
 * @param parentsOf  The cached tiles nearest above a tile, which together
 *                   cover it. Called only for tiles whose placeholders are
 *                   needed.
 */
export function updateTileStateBestAvailable(
  tiles: Tile2DHeader[],
  parentsOf: (tile: Tile2DHeader) => Tile2DHeader[],
): void {
  for (const tile of tiles) {
    tile.isVisible = false;
  }
  const hasData = (tile: Tile2DHeader) =>
    tile.isLoaded || Boolean(tile.content);

  // Built on first use: most updates find every selected tile, or an ancestor
  // of it, loaded.
  let children: Map<Tile2DHeader, Tile2DHeader[]> | undefined;
  const getChildren = (tile: Tile2DHeader): Tile2DHeader[] => {
    if (!children) {
      children = new Map();
      for (const child of tiles) {
        for (const parent of parentsOf(child)) {
          const siblings = children.get(parent);
          if (siblings) {
            siblings.push(child);
          } else {
            children.set(parent, [child]);
          }
        }
      }
    }
    return children.get(tile) ?? [];
  };

  // Show `tile`, or else its nearest loaded ancestors; return whether they
  // cover all of it.
  const showAncestors = (tile: Tile2DHeader): boolean => {
    if (hasData(tile)) {
      tile.isVisible = true;
      return true;
    }
    const tileParents = parentsOf(tile);
    let covered = tileParents.length > 0;
    // Each parent covers its own part of `tile`, so visit them all.
    for (const parent of tileParents) {
      covered = showAncestors(parent) && covered;
    }
    return covered;
  };

  // Show the nearest loaded descendants of `tile`.
  const showDescendants = (tile: Tile2DHeader): void => {
    for (const child of getChildren(tile)) {
      if (hasData(child)) {
        child.isVisible = true;
      } else {
        showDescendants(child);
      }
    }
  };

  for (const tile of tiles) {
    if (tile.isSelected && !showAncestors(tile)) {
      showDescendants(tile);
    }
  }
}
