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
   * Geographic bounds (WGS84) of the source in [minX, minY, maxX, maxY] format.
   *
   * A bbox across the antimeridian may be written with `minX > maxX`, as
   * GeoJSON (RFC 7946 section 5.2) and STAC do.
   */
  bbox: [number, number, number, number];
};

/**
 * The spatial index of a mosaic's sources.
 *
 * A source whose bbox crosses the antimeridian is indexed as two boxes, one on
 * each side, so `boxToSource` maps each box back to its source.
 */
export type SourceIndex = {
  /** Flatbush index of the sources' boxes. */
  boxes: Flatbush;
  /** For each box in `boxes`, the position of its source in `sources`. */
  boxToSource: Uint32Array;
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
  private getIndex: () => SourceIndex | null;

  constructor(
    getSources: () => MosaicT[],
    getIndex: () => SourceIndex | null,
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
    const { id, bbox } = tileIndex as unknown as ResolvedSource<MosaicT>;
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

    // A source can match more than once, since bounds and bboxes across the
    // antimeridian are both split in two.
    const matched = new Set<number>();
    for (const bounds of visibleWorldBounds(viewport)) {
      for (const box of index.boxes.search(...bounds)) {
        matched.add(index.boxToSource[box]!);
      }
    }
    let indices = [...matched];

    const sources = this.getSources();
    // Read `extent` on every call: TileLayer updates it through `setOptions`.
    const extent = this.opts.extent as Bounds | null;
    if (extent) {
      indices = indices.filter((i) => overlapsExtent(sources[i]!.bbox, extent));
    }

    return indices.map((sourceIndex) => {
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
  }
}

/**
 * Index the bboxes of `sources`, or return `null` when there are none.
 */
export function buildSourceIndex(sources: MosaicSource[]): SourceIndex | null {
  if (sources.length === 0) {
    return null;
  }

  const splitBboxes = sources.map((source) =>
    splitAtAntimeridian(unwrapBbox(source.bbox)),
  );
  const numBoxes = splitBboxes.reduce((sum, split) => sum + split.length, 0);
  const boxes = new Flatbush(numBoxes);
  const boxToSource = new Uint32Array(numBoxes);
  splitBboxes.forEach((split, sourceIndex) => {
    for (const box of split) {
      const boxIndex = boxes.add(...box);
      boxToSource[boxIndex] = sourceIndex;
    }
  });
  boxes.finish();
  return { boxes, boxToSource };
}

/**
 * Whether a source's bbox overlaps `extent`. A bbox across the antimeridian is
 * split first, so each side is tested on its own; any other bbox is tested
 * without allocating, since this runs for each matched source on every call.
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
