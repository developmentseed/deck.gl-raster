import type {
  Compression,
  Tiff,
  TiffImage,
  TiffMimeType,
} from "@cogeotiff/core";
import type { Tile } from "./tile";
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

export async function fetchTile(
  self: HasTiffReference,
  x: number,
  y: number,
): Promise<Tile> {
  if (self.maskIfd != null) {
    throw new Error("Mask fetching not implemented yet");
  }

  const tile = await self.ifd.getTile(x, y);
  if (tile === null) {
    throw new Error("Tile not found");
  }

  throw new Error("Not implemented");
}

//     mask_data: AsyncTiffArray | None = None
//     if self._mask_ifd is not None:
//         mask_fut = self._mask_ifd.fetch_tile(x, y)
//         tile, mask = await asyncio.gather(tile_fut, mask_fut)
//         tile_data, mask_data = await asyncio.gather(tile.decode(), mask.decode())
//     else:
//         tile = await tile_fut
//         tile_data = await tile.decode()

//     tile_transform = self.transform * Affine.translation(
//         x * self.tile_width,
//         y * self.tile_height,
//     )

//     array = Array._create(  # noqa: SLF001
//         data=tile_data,
//         mask=mask_data,
//         planar_configuration=self._ifd.planar_configuration,
//         crs=self.crs,
//         transform=tile_transform,
//         nodata=self.nodata,
//     )
//     return Tile(
//         x=x,
//         y=y,
//         _ifd=self._ifd,
//         array=array,
//     )
