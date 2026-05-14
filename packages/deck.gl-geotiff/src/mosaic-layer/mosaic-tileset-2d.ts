import type { Viewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import { _sortItemsByDistanceFromViewportCenter as sortItemsByDistanceFromViewportCenter } from "@developmentseed/deck.gl-raster";
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
export type MosaicSource = {
  /**
   * Optional stable identifier used as this source's tile-cache key in the
   * inner Tileset2D. Defaults to the source's position in the `sources`
   * array. Supply an explicit value when the sources list is reordered or
   * spliced at runtime, so a given source keeps the same cache slot across
   * updates.
   */
  key?: string;
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
/** A source augmented with the `TileIndex` fields and a resolved `key`
 * (defaulting to the array position) so deck.gl typing is satisfied and the
 * cache identifier is always defined. */
type ResolvedSource<MosaicT> = TileIndex & MosaicT & { key: string };

/** Sources prepared for spatial querying, paired with a Flatbush index over
 * their bboxes. */
type BuiltIndex<MosaicT> = {
  sources: ResolvedSource<MosaicT>[];
  index: Flatbush;
};

export class MosaicTileset2D<MosaicT extends MosaicSource> extends Tileset2D {
  /** Closure returning the parent layer's current sources array. Re-evaluated
   * on each `getTileIndices` call so updates to the layer's `sources` prop
   * propagate without recreating the tileset. */
  private getSources: () => MosaicT[];

  /** Last sources array reference the index was built from. Compared by `===`
   * against the closure's next return value to decide whether to rebuild. */
  private cachedRaw: MosaicT[] | null = null;

  /** Sources + spatial index built from `cachedRaw`. `null` means the last
   * observed sources list was empty (Flatbush requires at least one item). */
  private cached: BuiltIndex<MosaicT> | null = null;

  constructor(getSources: () => MosaicT[], opts: Tileset2DProps) {
    super(opts);
    this.getSources = getSources;
  }

  /**
   * Returns the prepared sources + spatial index for the current sources
   * array, rebuilding only if the closure has produced a new array reference
   * since the last call. Returns `null` when the sources list is empty.
   */
  private buildSpatialIndex(): BuiltIndex<MosaicT> | null {
    const raw = this.getSources();
    if (raw === this.cachedRaw) {
      return this.cached;
    }
    this.cachedRaw = raw;

    if (raw.length === 0) {
      this.cached = null;
      return null;
    }

    // Augment each source with a resolved `key` (used by getTileId for
    // cache keying) and dummy `x`/`y`/`z` fields to satisfy deck.gl's
    // TileIndex typing. The x/y/z values are never read because getTileId is
    // overridden below.
    const sources: ResolvedSource<MosaicT>[] = raw.map((source, i) => ({
      ...source,
      key: source.key ?? String(i),
      // TODO: remove x, y, z fields when merged
      // https://github.com/visgl/deck.gl/pull/10299
      x: i,
      y: 0,
      z: 0,
    }));

    const index = new Flatbush(raw.length);
    for (const source of raw) {
      const [minX, minY, maxX, maxY] = source.bbox;
      index.add(minX, minY, maxX, maxY);
    }
    index.finish();

    this.cached = { sources, index };
    return this.cached;
  }

  /** The Tileset2D cache key for a source. */
  override getTileId(tileIndex: TileIndex): string {
    // `getTileIndices` always returns `ResolvedSource`s, so a `key` is
    // present on every value deck.gl will pass back here.
    return (tileIndex as ResolvedSource<MosaicT>).key;
  }

  /** Must override to provide a zoom level for the tile. */
  override getTileZoom(_tileIndex: TileIndex): number {
    return 0;
  }

  /** Must override because our tileIndex does not have x, y, z */
  override getTileMetadata(tileIndex: TileIndex): Record<string, any> {
    const { key, bbox } = tileIndex as unknown as ResolvedSource<MosaicT>;
    return { key, bbox };
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

    const built = this.buildSpatialIndex();
    if (built === null) {
      return [];
    }

    const viewportBounds = viewport.getBounds();
    const indices = built.index.search(...viewportBounds);
    const sources = indices.map((sourceIndex) => built.sources[sourceIndex]!);

    const { maxRequests } = this.opts;
    if (sources.length <= maxRequests) {
      return sources;
    }

    return sortItemsByDistanceFromViewportCenter(
      sources,
      viewport,
      (source) => {
        const [minX, minY, maxX, maxY] = source.bbox;
        return [(minX + maxX) * 0.5, (minY + maxY) * 0.5] as const;
      },
    );
  }
}
