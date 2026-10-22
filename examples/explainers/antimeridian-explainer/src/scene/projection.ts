import { apply, invert } from "@developmentseed/affine";
import {
  rescaleCommonSpaceToEPSG3857,
  rescaleEPSG3857ToCommonSpace,
} from "@developmentseed/deck.gl-raster/internal/raster-tileset/raster-tile-traversal.js";
import { epsgResolver, makeClampedForwardTo3857 } from "@developmentseed/proj";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import proj4 from "proj4";
import type { SourceImage } from "./load.js";

/** The image's projection functions, plus longitude and latitude. */
export type Projection = {
  /**
   * The functions `RasterTileLayer` gives `RasterLayer` in Web Mercator:
   * pixels to UTM, and UTM to deck.gl's common space (one world is 512 wide).
   */
  fns: ReprojectionFns;
  /** Source CRS to longitude and latitude. */
  toLngLat(x: number, y: number): [number, number];
  /** Longitude and latitude to source CRS. */
  fromLngLat(lng: number, lat: number): [number, number];
};

/**
 * Build the image's projection functions the way COGLayer and
 * `RasterTileset2D` build a tile's: resolve the EPSG code, project with proj4
 * to EPSG:3857 (clamped), then rescale to common space.
 */
export async function makeProjection(image: SourceImage): Promise<Projection> {
  const definition = await epsgResolver(image.epsg);
  // @ts-expect-error - proj4's typings don't take a parsed definition; COGLayer does the same.
  const to4326 = proj4(definition, "EPSG:4326");
  // @ts-expect-error - as above.
  const to3857 = proj4(definition, "EPSG:3857");
  const toLngLat = (x: number, y: number) =>
    to4326.forward<[number, number]>([x, y], false);
  const projectTo3857 = makeClampedForwardTo3857(
    (x: number, y: number) => to3857.forward<[number, number]>([x, y], false),
    toLngLat,
  );
  const inverse = invert(image.transform);
  const fns: ReprojectionFns = {
    forwardTransform: (px, py) => apply(image.transform, px, py),
    inverseTransform: (x, y) => apply(inverse, x, y),
    forwardReproject: (x, y) =>
      rescaleEPSG3857ToCommonSpace(projectTo3857(x, y)),
    inverseReproject: (cx, cy) => {
      const [mx, my] = rescaleCommonSpaceToEPSG3857([cx, cy]);
      return to3857.inverse<[number, number]>([mx, my], false);
    },
  };
  return {
    fns,
    toLngLat,
    fromLngLat: (lng, lat) =>
      to4326.inverse<[number, number]>([lng, lat], false),
  };
}
