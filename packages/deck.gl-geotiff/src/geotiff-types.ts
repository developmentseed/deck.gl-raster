import { globals } from "geotiff";

/** Improved typing for IFD. */
export type ImageFileDirectory = {
  ImageWidth: number;
  ImageLength: number;
  BitsPerSample: number[];
  Compression: number;
  PhotometricInterpretation: typeof globals.photometricInterpretations;
  SamplesPerPixel: number;
  SampleFormat: number[];
  PlanarConfiguration: number;
};
