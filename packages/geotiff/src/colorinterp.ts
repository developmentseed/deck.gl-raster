import { Photometric } from "@cogeotiff/core";
import { ExtraSample } from "./ifd.js";

export enum ColorInterp {
  UNDEFINED = "undefined",
  GRAY = "gray",
  RED = "red",
  GREEN = "green",
  BLUE = "blue",
  ALPHA = "alpha",
  PALETTE = "palette",
  CYAN = "cyan",
  MAGENTA = "magenta",
  YELLOW = "yellow",
  BLACK = "black",
  Y = "Y",
  Cb = "Cb",
  Cr = "Cr",
}

export function inferColorInterpretation({
  count,
  photometric,
  extraSamples,
}: {
  count: number;
  photometric: Photometric | null;
  extraSamples: ExtraSample[] | null;
}): ColorInterp[] {
  switch (photometric) {
    case null:
      return Array<ColorInterp>(count).fill(ColorInterp.UNDEFINED);

    case Photometric.MinIsBlack:
      return Array<ColorInterp>(count).fill(ColorInterp.GRAY);

    case Photometric.Rgb: {
      if (count < 3) {
        throw new Error(
          "RGB photometric interpretation with fewer than 3 bands is not supported.",
        );
      }
      if (count === 3) {
        return [ColorInterp.RED, ColorInterp.GREEN, ColorInterp.BLUE];
      }
      // count >= 4: map extra samples
      const extras = (extraSamples ?? []).map((sample) =>
        sample === ExtraSample.UnassociatedAlpha ? ColorInterp.ALPHA : ColorInterp.UNDEFINED,
      );
      return [ColorInterp.RED, ColorInterp.GREEN, ColorInterp.BLUE, ...extras];
    }

    case Photometric.Palette:
      return [ColorInterp.PALETTE];

    case Photometric.Separated:
      return [ColorInterp.CYAN, ColorInterp.MAGENTA, ColorInterp.YELLOW, ColorInterp.BLACK];

    case Photometric.Ycbcr:
      return [ColorInterp.Y, ColorInterp.Cb, ColorInterp.Cr];

    default:
      throw new Error(
        `Color interpretation not implemented for photometric: ${photometric}`,
      );
  }
}
