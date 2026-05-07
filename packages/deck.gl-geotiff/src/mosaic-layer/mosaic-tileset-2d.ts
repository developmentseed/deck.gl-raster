import type { Viewport } from "@deck.gl/core";
import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
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
   * Optional tile-cache identifier component. Together with `y` and `z`, forms
   * the tile ID `${z}-${x}-${y}` used to key the inner Tileset2D cache.
   * Defaults to the source's index in the `sources` array. Supply an explicit
   * value when you need cache stability across reordering or removal of items.
   */
  x?: number;
  /** See `x`. Defaults to `0`. */
  y?: number;
  /** See `x`. Defaults to `0`. */
  z?: number;
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
/** Sources prepared for spatial querying: each source augmented with the
 * `TileIndex` fields, paired with a Flatbush index over their bboxes. */
type BuiltIndex<MosaicT> = {
  sources: (TileIndex & MosaicT)[];
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
  private ensureIndex(): BuiltIndex<MosaicT> | null {
    const raw = this.getSources();
    if (raw === this.cachedRaw) {
      return this.cached;
    }
    this.cachedRaw = raw;

    if (raw.length === 0) {
      this.cached = null;
      return null;
    }

    // Add x,y,z to each source for TileIndex compatibility
    // This is mostly just a hack to satisfy deck.gl typing requirements for
    // getTileIndices
    const sources: (TileIndex & MosaicT)[] = raw.map((source, i) => ({
      x: source.x === undefined ? i : source.x,
      y: source.y === undefined ? 0 : source.y,
      z: source.z === undefined ? 0 : source.z,
      ...source,
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

  override getTileIndices({
    viewport,
    maxZoom,
    minZoom,
  }: {
    viewport: Viewport;
    maxZoom?: number;
    minZoom?: number;
  }): (TileIndex & MosaicT)[] {
    if (viewport.zoom < (minZoom ?? -Infinity)) {
      return [];
    }
    if (viewport.zoom > (maxZoom ?? Infinity)) {
      return [];
    }

    const built = this.ensureIndex();
    if (built === null) {
      return [];
    }

    const bounds = viewport.getBounds();
    const indices = built.index.search(...bounds);
    return indices.map((sourceIndex) => built.sources[sourceIndex]!);
  }
}
