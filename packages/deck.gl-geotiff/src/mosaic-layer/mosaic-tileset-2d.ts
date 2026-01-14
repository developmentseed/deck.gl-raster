import type { Viewport } from "@deck.gl/core";
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
  x?: number;
  y?: number;
  z?: number;
  /**
   * Geographic bounds (WGS84) of the source in [minX, minY, maxX, maxY] format
   */
  bbox: [number, number, number, number];
};

// Include correct Tileset2DProps type when exported from deck.gl
// https://github.com/visgl/deck.gl/pull/9917
type Tileset2DProps = any;

/**
 * A deck.gl Tileset2D for navigating an arbitrary collection of bounding boxes.
 *
 * This is intended to be used for a collection of image mosaics, where we want
 * to render all images currently visible in the viewport.
 */
export class MosaicTileset2D<M extends MosaicSource> extends Tileset2D {
  private sources: (TileIndex & M)[];
  private index: Flatbush;

  constructor(sources: M[], opts: Tileset2DProps) {
    super(opts);

    // Add x,y,z to each source for TileIndex compatibility
    // This is mostly just a hack to satisfy deck.gl typing requirements for
    // getTileIndices
    this.sources = sources.map((source, i) => ({
      x: source.x === undefined ? i : source.x,
      y: source.y === undefined ? 0 : source.y,
      z: source.z === undefined ? 0 : source.z,
      ...source,
    }));

    // Build spatial index of mosaic sources
    const index = new Flatbush(sources.length);
    for (const source of sources) {
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
  }): (TileIndex & M)[] {
    if (viewport.zoom < (minZoom ?? -Infinity)) {
      return [];
    }
    if (viewport.zoom > (maxZoom ?? Infinity)) {
      return [];
    }

    const bounds = viewport.getBounds();
    const indices = this.index.search(...bounds);
    return indices.map((sourceIndex) => this.sources[sourceIndex]!);
  }
}
