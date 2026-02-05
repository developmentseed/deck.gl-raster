import type { GeoTransform } from "@developmentseed/raster-reproject/affine";
import type { GeoTIFF as UpstreamGeoTIFF, GeoTIFFImage } from "geotiff";
import { extractGeotransform } from "../../geotiff-reprojection.js";
import { PhotometricInterpretationT } from "../types.js";
import type { RasterArray } from "./array.js";
import type { FetchOptions } from "./options.js";
import type { Overview } from "./overview.js";
import { Overview as OverviewClass } from "./overview.js";
import type { Tile } from "./tile.js";
import type { Window } from "./window.js";

/**
 * A higher-level GeoTIFF abstraction that separates data IFDs from mask IFDs,
 * pairs them by resolution, and exposes sorted overviews.
 *
 * Construct via `GeoTIFF.open(tiff)`.
 */
export class GeoTIFF {
  /**
   * Reduced-resolution overview levels, sorted finest-to-coarsest.
   *
   * Does not include the full-resolution image — use `fetchTile` / `read`
   * on the GeoTIFF instance itself for that.
   */
  readonly overviews: Overview[];
  /** Affine geotransform of the full-resolution image. */
  readonly transform: GeoTransform;
  /** The primary (full-resolution) GeoTIFFImage.  Useful for geo key access. */
  readonly primaryImage: GeoTIFFImage;

  /** Overview wrapper around the primary image, used by the convenience delegates. */
  private readonly _primary: Overview;

  private constructor(
    primary: Overview,
    overviews: Overview[],
    transform: GeoTransform,
    primaryImage: GeoTIFFImage,
  ) {
    this._primary = primary;
    this.overviews = overviews;
    this.transform = transform;
    this.primaryImage = primaryImage;
  }

  /**
   * Open a GeoTIFF and classify its IFDs into data/mask pairs.
   *
   * All IFDs are walked; mask IFDs are matched to data IFDs by matching
   * (width, height).  Overviews are sorted from finest to coarsest resolution.
   */
  static async open(tiff: UpstreamGeoTIFF): Promise<GeoTIFF> {
    const imageCount = await tiff.getImageCount();
    if (imageCount === 0) {
      throw new Error("TIFF does not contain any IFDs");
    }

    // Fetch all images and their file directories up front.  geotiff.js only
    // fetches IFD headers here — raster data is not read until readRasters.
    const images: GeoTIFFImage[] = [];
    for (let i = 0; i < imageCount; i++) {
      images.push(await tiff.getImage(i));
    }

    const primaryImage = images[0]!;
    const baseTransform = extractGeotransform(primaryImage);
    const primaryWidth = primaryImage.getWidth();

    // Classify IFDs (skipping index 0) into overview-data and mask buckets
    // keyed by "width,height".
    const dataIFDs = new Map<string, GeoTIFFImage>();
    const maskIFDs = new Map<string, GeoTIFFImage>();

    for (let i = 1; i < images.length; i++) {
      const image = images[i]!;
      const key = `${image.getWidth()},${image.getHeight()}`;

      if (isMaskIfd(image)) {
        maskIFDs.set(key, image);
      } else {
        dataIFDs.set(key, image);
      }
    }

    // Build the primary Overview (full-resolution image + its mask, if any)
    const primaryKey = `${primaryImage.getWidth()},${primaryImage.getHeight()}`;
    const primary = new OverviewClass(
      primaryImage,
      maskIFDs.get(primaryKey) ?? null,
      baseTransform,
    );

    // Build reduced-resolution Overview instances, sorted by pixel count
    // descending (finest first).
    const dataEntries = Array.from(dataIFDs.entries());
    dataEntries.sort((a, b) => {
      const [wa, ha] = a[0]!.split(",").map(Number);
      const [wb, hb] = b[0]!.split(",").map(Number);
      return wb! * hb! - wa! * ha!;
    });

    const overviews: Overview[] = dataEntries.map(([key, dataImage]) => {
      const maskImage = maskIFDs.get(key) ?? null;
      const overviewWidth = dataImage.getWidth();

      // Scale the base transform for this overview level.
      // scale = primaryWidth / overviewWidth
      // Scaled: [a*s, b*s, c, d*s, e*s, f]  (origin stays the same)
      const scale = primaryWidth / overviewWidth;
      const [a, b, c, d, e, f] = baseTransform;
      const overviewTransform: GeoTransform = [
        a * scale,
        b * scale,
        c,
        d * scale,
        e * scale,
        f,
      ];

      return new OverviewClass(dataImage, maskImage, overviewTransform);
    });

    return new GeoTIFF(primary, overviews, baseTransform, primaryImage);
  }

  // ── Convenience delegates to the full-resolution image ─────────────────

  /** Fetch a single tile from the full-resolution image. */
  async fetchTile(x: number, y: number, options?: FetchOptions): Promise<Tile> {
    return this._primary.fetchTile(x, y, options);
  }

  /** Read an arbitrary window from the full-resolution image. */
  async read(window: Window, options?: FetchOptions): Promise<RasterArray> {
    return this._primary.read(window, options);
  }
}

/**
 * Determine whether a GeoTIFFImage is a mask IFD.
 *
 * Per the TIFF spec, bit 2 (value 4) of NewSubfileType signals
 * "this IFD is a mask".  We also require PhotometricInterpretation === 4
 * (TransparencyMask) to confirm the intent.
 *
 * NewSubfileType defaults to 0 when absent from the file directory.
 */
export function isMaskIfd(image: GeoTIFFImage): boolean {
  // getFileDirectory() returns a plain object; NewSubfileType is not in our
  // typed ImageFileDirectory, so we access it from the raw directory.
  const fd = image.getFileDirectory() as Record<string, unknown>;
  const newSubfileType = (fd.NewSubfileType as number) ?? 0;
  const photometric = fd.PhotometricInterpretation as number;

  return (
    (newSubfileType & 4) !== 0 &&
    photometric === PhotometricInterpretationT.TransparencyMask
  );
}
