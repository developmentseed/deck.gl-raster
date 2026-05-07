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
export class MosaicTileset2D<MosaicT extends MosaicSource> extends Tileset2D {
  private getSources: () => MosaicT[];
  private cachedRaw: MosaicT[] | null = null;
  private sources: (TileIndex & MosaicT)[] = [];
  private index: Flatbush | null = null;

  constructor(getSources: () => MosaicT[], opts: Tileset2DProps) {
    super(opts);
    this.getSources = getSources;
  }

  /**
   * Rebuild the spatial index if the closure returns a new sources array
   * reference. No-op when the reference is unchanged.
   */
  private ensureIndex(): void {
    const raw = this.getSources();
    if (raw === this.cachedRaw) {
      return;
    }
    this.cachedRaw = raw;

    // Add x,y,z to each source for TileIndex compatibility
    // This is mostly just a hack to satisfy deck.gl typing requirements for
    // getTileIndices
    this.sources = raw.map((source, i) => ({
      x: source.x === undefined ? i : source.x,
      y: source.y === undefined ? 0 : source.y,
      z: source.z === undefined ? 0 : source.z,
      ...source,
    }));

    // Flatbush requires numItems >= 1 and that all declared items are added
    // before finish(); skip the build when there are no sources and let
    // getTileIndices short-circuit on the empty cachedRaw.
    if (raw.length === 0) {
      this.index = null;
      return;
    }

    const index = new Flatbush(raw.length);
    for (const source of raw) {
      const [minX, minY, maxX, maxY] = source.bbox;
      index.add(minX, minY, maxX, maxY);
    }
    index.finish();
    this.index = index;
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
    this.ensureIndex();

    if (viewport.zoom < (minZoom ?? -Infinity)) {
      return [];
    }
    if (viewport.zoom > (maxZoom ?? Infinity)) {
      return [];
    }
    if (this.cachedRaw === null || this.cachedRaw.length === 0) {
      return [];
    }

    const bounds = viewport.getBounds();
    const indices = this.index!.search(...bounds);
    return indices.map((sourceIndex) => this.sources[sourceIndex]!);
  }
}
