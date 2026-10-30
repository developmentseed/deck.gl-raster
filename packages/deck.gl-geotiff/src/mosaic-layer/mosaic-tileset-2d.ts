import type { Viewport } from "@deck.gl/core";
import type {
  GeoBoundingBox,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import type { Bounds } from "@developmentseed/deck.gl-raster";
import { _visibleWorldBounds as visibleWorldBounds } from "@developmentseed/deck.gl-raster";
import { splitAtAntimeridian, unwrapBbox } from "@developmentseed/proj";
import Flatbush from "flatbush";

/** Tile index.
 *
 * Note this is essentially just to type-check deck.gl, since getTileIndices
 * must return a `TileIndex[]`.
 */
export type TileIndex = { x: number; y: number; z: number };

/**
 * Minimal required interface of a mosaic item.
 */
export type MosaicItem = {
  /**
   * A unique identifier for the item, which keys the layer's cache of opened
   * sources. Defaults to the item's position in the mosaic's list of items,
   * which is only safe while the list changes by appending: after any other
   * change, a new item at a cached position draws as the old one.
   */
  id?: string;
  /**
   * Geographic bounds (WGS84) of the item in [minX, minY, maxX, maxY] format.
   *
   * A bbox across the antimeridian may be written with `minX > maxX`, as
   * GeoJSON (RFC 7946 section 5.2) and STAC do.
   */
  bbox: [number, number, number, number];
};

/**
 * The spatial index of a mosaic's items.
 *
 * An item whose bbox crosses the antimeridian is indexed as two boxes, one on
 * each side, so `boxToItem` maps each box back to its item.
 */
export type ItemIndex = {
  /** Flatbush index of the items' boxes. */
  boxes: Flatbush;
  /** For each box in `boxes`, the position of its item in the list of items. */
  boxToItem: Uint32Array;
};

/** An item augmented with the `TileIndex` fields and a resolved `id`
 * (defaulting to the array position) so deck.gl typing is satisfied and the
 * cache identifier is always defined. */
type ResolvedItem<ItemT> = TileIndex & ItemT & { id: string };

/**
 * A deck.gl Tileset2D for navigating an arbitrary collection of bounding boxes.
 *
 * This is intended to be used for a collection of image mosaics, where we want
 * to render all images currently visible in the viewport.
 *
 * The constructor takes getters for the parent layer's items and their
 * spatial index rather than the values themselves, so the tileset picks up
 * changes to the layer's items across its lifetime. The layer rebuilds the
 * index when its items change.
 */
export class MosaicTileset2D<ItemT extends MosaicItem> extends Tileset2D {
  /** Getter for the parent layer's current items. Re-evaluated on each
   * `getTileIndices` call so updates to the layer's items propagate without
   * recreating the tileset. */
  private getItems: () => ItemT[];

  /** Access the spatial index on the MosaicLayer instance. */
  private getIndex: () => ItemIndex | null;

  constructor(
    getItems: () => ItemT[],
    getIndex: () => ItemIndex | null,
    opts: Tileset2DProps,
  ) {
    super(opts);
    this.getIndex = getIndex;
    this.getItems = getItems;
  }

  /**
   * Unloads every cached item, which deck.gl's `finalize` skips until
   * https://github.com/visgl/deck.gl/pull/10883 lands. An item still opening
   * is unloaded once its open finishes.
   */
  override finalize(): void {
    const { onTileUnload } = this.opts;
    for (const tile of this.tiles) {
      if (tile.isLoading) {
        // `data` is a promise until the load finishes
        void Promise.resolve(tile.data).then(() => onTileUnload(tile));
      } else {
        onTileUnload(tile);
      }
    }
    super.finalize();
  }

  /** The Tileset2D cache key for an item. */
  override getTileId(tileIndex: TileIndex): string {
    // `getTileIndices` always returns `ResolvedItem`s, so an `id` is
    // present on every value deck.gl will pass back here.
    return (tileIndex as ResolvedItem<ItemT>).id;
  }

  /** Must override to provide a zoom level for the tile. */
  override getTileZoom(_tileIndex: TileIndex): number {
    return 0;
  }

  /**
   * Must override because our tileIndex does not have x, y, z.
   *
   * The bbox is returned as a {@link GeoBoundingBox} object to satisfy deck.gl
   * requirements for center-first tile loading. deck.gl expects west < east,
   * so a bbox across the antimeridian gets its east edge one world east.
   */
  override getTileMetadata(tileIndex: TileIndex): {
    id: string;
    bbox: GeoBoundingBox;
  } {
    const { id, bbox } = tileIndex as unknown as ResolvedItem<ItemT>;
    const [west, south, east, north] = unwrapBbox(bbox);
    return { id, bbox: { west, south, east, north } };
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
  }): ResolvedItem<ItemT>[] {
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

    // An item can match more than once, since bounds and bboxes across the
    // antimeridian are both split in two.
    const matched = new Set<number>();
    for (const bounds of visibleWorldBounds(viewport)) {
      for (const box of index.boxes.search(...bounds)) {
        matched.add(index.boxToItem[box]!);
      }
    }
    let indices = [...matched];

    const items = this.getItems();
    // Read `extent` on every call: TileLayer updates it through `setOptions`.
    const extent = this.opts.extent as Bounds | null;
    if (extent) {
      indices = indices.filter((i) => overlapsExtent(items[i]!.bbox, extent));
    }

    return indices.map((itemIndex) => {
      const item = items[itemIndex]!;
      return {
        // Remove once https://github.com/visgl/deck.gl/pull/10299
        // is merged and released
        x: 0,
        y: 0,
        z: 0,
        ...item,
        id: item.id ?? String(itemIndex),
      };
    });
  }
}

/**
 * Index the bboxes of `items`, or return `null` when there are none.
 */
export function buildItemIndex(items: MosaicItem[]): ItemIndex | null {
  if (items.length === 0) {
    return null;
  }

  const splitBboxes = items.map((item) =>
    splitAtAntimeridian(unwrapBbox(item.bbox)),
  );
  const numBoxes = splitBboxes.reduce((sum, split) => sum + split.length, 0);
  const boxes = new Flatbush(numBoxes);
  const boxToItem = new Uint32Array(numBoxes);
  splitBboxes.forEach((split, itemIndex) => {
    for (const box of split) {
      const boxIndex = boxes.add(...box);
      boxToItem[boxIndex] = itemIndex;
    }
  });
  boxes.finish();
  return { boxes, boxToItem };
}

/**
 * Whether an item's bbox overlaps `extent`. A bbox across the antimeridian is
 * split first, so each side is tested on its own; any other bbox is tested
 * without allocating, since this runs for each matched item on every call.
 */
function overlapsExtent(bbox: Bounds, extent: Bounds): boolean {
  if (bbox[0] <= bbox[2]) {
    return overlaps(bbox, extent);
  }
  return splitAtAntimeridian(unwrapBbox(bbox)).some((box) =>
    overlaps(box, extent),
  );
}

/**
 * Whether two `[minX, minY, maxX, maxY]` boxes overlap. Boxes that only share
 * an edge or a corner don't, as with tiles and `extent` in deck.gl's TileLayer.
 */
function overlaps(a: Bounds, b: Bounds): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}
