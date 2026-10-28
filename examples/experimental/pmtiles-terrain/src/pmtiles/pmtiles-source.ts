import type {
  GeographicBounds,
  RasterTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import {
  RasterSource,
  TileMatrixSetAdaptor,
} from "@developmentseed/deck.gl-raster";
import type { Header } from "pmtiles";
import { PMTiles, TileType } from "pmtiles";
import proj4 from "proj4";
import { webMercatorQuad } from "../web-mercator.js";
import type { CountedSource } from "./read-stats.js";

/** Web Mercator's latitude limit, where its y reaches the world's edge. */
const MAX_LATITUDE = 85.0511287798066;

/** Options for {@link PMTilesSource.open}. */
export interface PMTilesSourceOptions {
  /** Where the archive's bytes come from. */
  byteSource: CountedSource;
  /** Width and height of the archive's tiles. The header doesn't say. */
  tileSize: number;
}

/**
 * A PMTiles archive of raster tiles, opened: its header read and its tile grid
 * described for `RasterTileLayer`.
 *
 * PMTiles addresses WebMercatorQuad tiles by z/x/y, so the grid is that tile
 * matrix set, bounded to the archive's bounds. Two meanings of "source" meet
 * here: `byteSource` is a `pmtiles` source of bytes, while this is a
 * deck.gl-raster `RasterSource`, opened data that layers draw.
 */
export class PMTilesSource extends RasterSource {
  /** The `pmtiles` archive, for `getZxy`. */
  readonly archive: PMTiles;
  /** The archive's header. */
  readonly header: Header;
  /** Width and height of the archive's tiles. */
  readonly tileSize: number;
  /** Where the archive's bytes come from. */
  readonly byteSource: CountedSource;

  private constructor(options: {
    archive: PMTiles;
    header: Header;
    tileSize: number;
    byteSource: CountedSource;
    tilesetDescriptor: RasterTilesetDescriptor;
    geographicBounds: GeographicBounds;
  }) {
    super({
      tilesetDescriptor: options.tilesetDescriptor,
      geographicBounds: options.geographicBounds,
    });
    this.archive = options.archive;
    this.header = options.header;
    this.tileSize = options.tileSize;
    this.byteSource = options.byteSource;
  }

  /**
   * Read an archive's header and describe its tile grid.
   *
   * @throws If the archive holds tiles other than WebP or PNG images.
   */
  static async open(options: PMTilesSourceOptions): Promise<PMTilesSource> {
    const { byteSource, tileSize } = options;
    const archive = new PMTiles(byteSource);
    const header = await archive.getHeader();
    if (header.tileType !== TileType.Webp && header.tileType !== TileType.Png) {
      throw new Error(
        `${byteSource.getKey()} holds ${TileType[header.tileType] ?? header.tileType} tiles; PMTilesSource needs WebP or PNG`,
      );
    }
    const geographicBounds: GeographicBounds = {
      west: header.minLon,
      south: header.minLat,
      east: header.maxLon,
      north: header.maxLat,
    };
    const tilesetDescriptor = buildDescriptor({
      tileSize,
      maxZoom: header.maxZoom,
      geographicBounds,
    });
    return new PMTilesSource({
      archive,
      header,
      tileSize,
      byteSource,
      tilesetDescriptor,
      geographicBounds,
    });
  }

  /** The MIME type of the archive's tiles. */
  get mimeType(): string {
    return this.header.tileType === TileType.Webp ? "image/webp" : "image/png";
  }
}

/**
 * The tileset descriptor for a WebMercatorQuad grid bounded to
 * `geographicBounds`, as `titiler-cog`'s `buildDescriptor` makes one: the
 * grid's CRS is EPSG:3857, so its 3857 projections are the identity.
 */
function buildDescriptor(options: {
  tileSize: number;
  maxZoom: number;
  geographicBounds: GeographicBounds;
}): RasterTilesetDescriptor {
  const { tileSize, maxZoom, geographicBounds } = options;
  const converter = proj4("EPSG:3857", "EPSG:4326");
  const projectTo4326 = (x: number, y: number) =>
    converter.forward<[number, number]>([x, y], false);
  const projectFrom4326 = (x: number, y: number) =>
    converter.inverse<[number, number]>([x, y], false);
  const identity = (x: number, y: number): [number, number] => [x, y];
  const clamp = (latitude: number) =>
    Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  const { west, south, east, north } = geographicBounds;
  const tms = webMercatorQuad({ tileSize, maxZoom });
  return new TileMatrixSetAdaptor(
    {
      ...tms,
      boundingBox: {
        lowerLeft: projectFrom4326(west, clamp(south)),
        upperRight: projectFrom4326(east, clamp(north)),
        crs: tms.crs,
      },
    },
    {
      projectTo3857: identity,
      projectFrom3857: identity,
      projectTo4326,
      projectFrom4326,
    },
  );
}
