export enum PhotometricInterpretationT {
  WhiteIsZero = 0,
  BlackIsZero = 1,
  RGB = 2,
  Palette = 3,
  TransparencyMask = 4,
  CMYK = 5,
  YCbCr = 6,
  CIELab = 8,
  ICCLab = 9,
}

export enum PlanarConfigurationT {
  Chunky = 1,
  Planar = 2,
}

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
  PhotometricInterpretation: PhotometricInterpretationT;
  /** Strip or tiled */
  PlanarConfiguration: PlanarConfigurationT;
  SampleFormat: Uint16Array;
  /** Number of bands */
  SamplesPerPixel: number;
};
