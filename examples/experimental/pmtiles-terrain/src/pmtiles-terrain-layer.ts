import { RasterTileLayer } from "@developmentseed/deck.gl-raster";
import type { TerrainTileData } from "./terrain/types.js";

/**
 * A `RasterTileLayer` that aborts a tile's load as soon as the tile is neither
 * selected nor visible.
 *
 * The example raises `maxRequests` far above deck.gl's default 6, because
 * the range reader merges a view's reads into a few requests. deck.gl aborts
 * loads for tiles that left the view only while more than `maxRequests` are in
 * flight, so without this, every pan would leave stale loads (and their
 * neighbors' halo reads) running. `RasterTileLayer` exposes the switch only as
 * a protected hook, which the COG layers turn on the same way. This subclass
 * exists for that, until a public prop does.
 */
export class PMTilesTerrainLayer extends RasterTileLayer<TerrainTileData | null> {
  static override layerName = "PMTilesTerrainLayer";

  /** Abort loads nobody wants; see the class comment. */
  protected override _abortUnwantedLoads(): boolean {
    return true;
  }
}
