import type { globals } from "geotiff";

/** Improved typing for IFD. */
export type ImageFileDirectory = {
  ImageWidth: number;
  ImageLength: number;
  BitsPerSample: Uint16Array;
  Compression: number;
  PhotometricInterpretation: typeof globals.photometricInterpretations;
  SamplesPerPixel: number;
  SampleFormat: Uint16Array;
  PlanarConfiguration: number;
};
