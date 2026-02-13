import type { Tiff, TiffImage } from "@cogeotiff/core";
import type { HasTransform } from "./transform";

/** Protocol for objects that hold a TIFF reference and can request tiles. */
interface HasTiffReference extends HasTransform {
  /** The data Image File Directory (IFD) */
  ifd: TiffImage;

  /** The mask Image File Directory (IFD), if any. */
  maskIfd: TiffImage | null;

  /** The underlying TIFF object. */
  tiff: Tiff;

  /** The coordinate reference system. */
  crs: string;

  /** The height of tiles in pixels. */
  tileHeight: number;

  /** The width of tiles in pixels. */
  tileWidth: number;

  /** The nodata value for the image, if any. */
  nodata: number | null;
}
