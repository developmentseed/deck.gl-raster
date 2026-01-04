/** Improved typing for IFD. */
export type ImageFileDirectory = {
  BitsPerSample: Uint16Array;
  ColorMap?: Uint16Array;
  Compression: number;
  /** GDAL NoData value as string.
   * <https://gdal.org/en/stable/drivers/raster/gtiff.html#nodata-value>
   */
  GDAL_NODATA?: string;
  ImageLength: number;
  ImageWidth: number;
  PhotometricInterpretation: number;
  /** Strip or tiled */
  PlanarConfiguration: number;
  SampleFormat: Uint16Array;
  /** Number of bands */
  SamplesPerPixel: number;
};
