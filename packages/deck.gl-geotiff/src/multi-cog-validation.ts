import { _deepEqual as deepEqual } from "@deck.gl/core";
import type { GeoTIFF } from "@developmentseed/geotiff";

/** The parts of a source's GeoTIFF that {@link validateSources} compares. */
type SourceGeoreference = Pick<GeoTIFF, "crs" | "bbox" | "transform">;

/**
 * Check that every source has the primary source's CRS and extent.
 *
 * `MultiCOGLayer` reprojects every source with one CRS and finds each
 * secondary's tiles from the primary's tile grid, so a source in another CRS
 * or over another area would be drawn in the wrong place.
 *
 * Each bounding box edge may differ from the primary's by up to one
 * full-resolution pixel of the coarser of the two sources, as bands at
 * different resolutions may not end on exactly the same edge.
 *
 * @param sources - Each opened source's name and GeoTIFF.
 * @param primaryName - The name of the primary source, which every other
 *   source is compared with.
 * @throws If a source's CRS or bounding box differs from the primary's.
 */
export function validateSources(
  sources: { name: string; geotiff: SourceGeoreference }[],
  primaryName: string,
): void {
  const primary = sources.find(({ name }) => name === primaryName)!.geotiff;
  for (const { name, geotiff } of sources) {
    if (!crsMayMatch(geotiff.crs, primary.crs)) {
      throw new Error(
        `Source "${name}" has CRS ${formatCrs(geotiff.crs)}, but the primary ` +
          `source "${primaryName}" has ${formatCrs(primary.crs)}. All ` +
          `MultiCOGLayer sources must share one CRS.`,
      );
    }
    if (!bboxesMatch(geotiff, primary)) {
      throw new Error(
        `Source "${name}" has bbox [${geotiff.bbox.join(", ")}], but the ` +
          `primary source "${primaryName}" has [${primary.bbox.join(", ")}]. ` +
          `All MultiCOGLayer sources must cover the same extent, to within ` +
          `one pixel of the coarser source.`,
      );
    }
  }
}

/**
 * Whether two CRSs, as {@link GeoTIFF.crs} reports them, may be the same.
 *
 * Two EPSG codes, two PROJJSON objects or two WKT strings are compared by
 * value. A CRS in one of these forms can't be compared reliably with a CRS in
 * another, such as an EPSG code with a WKT string that may describe the same
 * CRS, so those count as a match: an error there could blank a valid layer.
 */
function crsMayMatch(a: GeoTIFF["crs"], b: GeoTIFF["crs"]): boolean {
  if (typeof a !== typeof b) {
    return true;
  }
  // A depth of -1 compares nested PROJJSON objects all the way down
  return deepEqual(a, b, -1);
}

/** Format a CRS for an error message, with an EPSG code as `EPSG:<code>`. */
function formatCrs(crs: GeoTIFF["crs"]): string {
  if (typeof crs === "number") {
    return `EPSG:${crs}`;
  }
  return typeof crs === "string" ? crs : JSON.stringify(crs);
}

/**
 * Whether each edge of `a`'s bounding box is within one full-resolution pixel
 * of the coarser of the two sources from the same edge of `b`'s.
 */
function bboxesMatch(a: SourceGeoreference, b: SourceGeoreference): boolean {
  const [aWidth, aHeight] = pixelSize(a.transform);
  const [bWidth, bHeight] = pixelSize(b.transform);
  const toleranceX = Math.max(aWidth, bWidth);
  const toleranceY = Math.max(aHeight, bHeight);
  // Edges in bbox order: minX, minY, maxX, maxY
  const tolerances = [toleranceX, toleranceY, toleranceX, toleranceY];
  const bBbox = b.bbox;
  return a.bbox.every(
    (edge, i) => Math.abs(edge - bBbox[i]!) <= tolerances[i]!,
  );
}

/**
 * The width and height, in CRS units, of the box around one pixel, so a
 * rotated or skewed pixel is measured like {@link GeoTIFF.bbox} measures the
 * image.
 */
function pixelSize([a, b, , d, e]: GeoTIFF["transform"]): [number, number] {
  return [Math.abs(a) + Math.abs(b), Math.abs(d) + Math.abs(e)];
}
