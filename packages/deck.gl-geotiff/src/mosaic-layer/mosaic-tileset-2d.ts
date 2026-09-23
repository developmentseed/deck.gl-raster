import type { Viewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import { _sortItemsByDistanceFromViewportCenter as sortItemsByDistanceFromViewportCenter } from "@developmentseed/deck.gl-raster";
import type Flatbush from "flatbush";

/**
 * Maximum number of world copies to test on each side of the primary world
 * so max 7 (primary + 3 either side if visible). Mirrors
 * `raster-tile-traversal.ts`'s `MAX_MAPS`, which in turn matches upstream
 * `@deck.gl/geo-layers/tile-2d-traversal.ts`.
 */
const MAX_MAPS = 3;

/** Tile index.
 *
 * Note this is essentially just to type-check deck.gl, since getTileIndices
 * must return a `TileIndex[]`.
 */
export type TileIndex = { x: number; y: number; z: number };

/**
 * Minimal required interface of a mosaic item.
 */
export type MosaicSource = {
  /**
   * Optional stable identifier used as this source's tile-cache key in the
   * inner Tileset2D. Defaults to the source's position in the `sources`
   * array. Supply an explicit value when the sources list is reordered or
   * spliced at runtime, so a given source keeps the same cache slot across
   * updates.
   */
  id?: string;
  /**
   * Geographic bounds (WGS84) of the source in [minX, minY, maxX, maxY] format
   */
  bbox: [number, number, number, number];
};

/**
 * A deck.gl Tileset2D for navigating an arbitrary collection of bounding boxes.
 *
 * This is intended to be used for a collection of image mosaics, where we want
 * to render all images currently visible in the viewport.
 *
 * The constructor accepts a `getSources` closure rather than a sources array
 * so that updates to the parent layer's `sources` prop are picked up across
 * the tileset's lifetime. The spatial index is rebuilt on demand whenever the
 * closure returns a new array reference (compared by `===`); mutating the
 * array in place will not be detected.
 */
/** A source augmented with the `TileIndex` fields and a resolved `id`
 * (defaulting to the array position) so deck.gl typing is satisfied and the
 * cache identifier is always defined. */
type ResolvedSource<MosaicT> = TileIndex & MosaicT & { id: string };

export class MosaicTileset2D<MosaicT extends MosaicSource> extends Tileset2D {
  /** Closure returning the parent layer's current sources array. Re-evaluated
   * on each `getTileIndices` call so updates to the layer's `sources` prop
   * propagate without recreating the tileset. */
  private getSources: () => MosaicT[];

  /** Access the spatial index on the MosaicLayer instance. */
  private getIndex: () => Flatbush | null;

  constructor(
    getSources: () => MosaicT[],
    getIndex: () => Flatbush | null,
    opts: Tileset2DProps,
  ) {
    super(opts);
    this.getIndex = getIndex;
    this.getSources = getSources;
  }

  /** The Tileset2D cache key for a source. */
  override getTileId(tileIndex: TileIndex): string {
    // `getTileIndices` always returns `ResolvedSource`s, so an `id` is
    // present on every value deck.gl will pass back here.
    return (tileIndex as ResolvedSource<MosaicT>).id;
  }

  /** Must override to provide a zoom level for the tile. */
  override getTileZoom(_tileIndex: TileIndex): number {
    return 0;
  }

  /** Must override because our tileIndex does not have x, y, z */
  override getTileMetadata(tileIndex: TileIndex): Record<string, any> {
    const { id, bbox } = tileIndex as unknown as ResolvedSource<MosaicT>;
    return { id, bbox };
  }

  override getParentIndex(tileIndex: TileIndex): TileIndex {
    return tileIndex;
  }

  override getTileIndices({
    viewport,
    maxZoom,
    minZoom,
  }: {
    viewport: Viewport;
    maxZoom?: number;
    minZoom?: number;
  }): ResolvedSource<MosaicT>[] {
    if (viewport.zoom < (minZoom ?? -Infinity)) {
      return [];
    }
    if (viewport.zoom > (maxZoom ?? Infinity)) {
      return [];
    }

    const index = this.getIndex();
    if (!index) {
      return [];
    }

    const viewportBounds = viewport.getBounds();
    const matched = new Set<number>(index.search(...viewportBounds));

    // World-copy passes: see "MosaicTileset2D source selection" in
    // dev-docs/world-copies.md.
    if ((viewport.subViewports?.length ?? 0) > 1) {
      for (let worldOffset = -1; worldOffset >= -MAX_MAPS; worldOffset--) {
        if (!searchAtOffset(index, viewportBounds, worldOffset, matched)) {
          break;
        }
      }
      for (let worldOffset = 1; worldOffset <= MAX_MAPS; worldOffset++) {
        if (!searchAtOffset(index, viewportBounds, worldOffset, matched)) {
          break;
        }
      }
    }

    const sources = this.getSources();
    const selectedSources = [...matched].map((sourceIndex) => {
      const source = sources[sourceIndex]!;
      return {
        // Remove once https://github.com/visgl/deck.gl/pull/10299
        // is merged and released
        x: 0,
        y: 0,
        z: 0,
        ...source,
        id: source.id ?? String(sourceIndex),
      };
    });

    const { maxRequests } = this.opts;
    if (selectedSources.length <= maxRequests) {
      return selectedSources;
    }

    return sortItemsByDistanceFromViewportCenter(
      selectedSources,
      viewport,
      (source) => {
        const [minX, minY, maxX, maxY] = source.bbox;
        return [(minX + maxX) * 0.5, (minY + maxY) * 0.5] as const;
      },
    );
  }
}

/**
 * Query `index` with `bounds` shifted by `worldOffset * 360°` of longitude,
 * adding any matched source indices into `matched`. Returns `true` if this
 * offset matched anything, signaling the caller to keep walking further from
 * the primary world; `false` stops that direction's walk (the offset has
 * moved past the visible range).
 */
function searchAtOffset(
  index: Flatbush,
  bounds: [number, number, number, number],
  worldOffset: number,
  matched: Set<number>,
): boolean {
  const shift = worldOffset * 360;
  const found = index.search(
    bounds[0] - shift,
    bounds[1],
    bounds[2] - shift,
    bounds[3],
  );
  for (const i of found) {
    matched.add(i);
  }
  return found.length > 0;
}
