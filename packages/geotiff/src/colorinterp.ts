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

    case Photometric.MinIsWhite:
    case Photometric.MinIsBlack:
      return [ColorInterp.GRAY, ...trailingBands(extraSamples, count - 1)];

    case Photometric.Rgb: {
      if (count < 3) {
        throw new Error(
          "RGB photometric interpretation with fewer than 3 bands is not supported.",
        );
      }
      return [
        ColorInterp.RED,
        ColorInterp.GREEN,
        ColorInterp.BLUE,
        ...trailingBands(extraSamples, count - 3),
      ];
    }

    case Photometric.Palette:
      return [ColorInterp.PALETTE];

    case Photometric.Separated:
      return [
        ColorInterp.CYAN,
        ColorInterp.MAGENTA,
        ColorInterp.YELLOW,
        ColorInterp.BLACK,
      ];

    case Photometric.Ycbcr:
      return [ColorInterp.Y, ColorInterp.Cb, ColorInterp.Cr];

    default:
      throw new Error(
        `Color interpretation not implemented for photometric: ${photometric}`,
      );
  }
}

/**
 * Color interpretation for the `count` trailing (non-primary) bands.
 *
 * A band is ALPHA if its extra sample is unassociated alpha, otherwise
 * UNDEFINED.
 *
 * Bands without a corresponding extra sample (e.g. a multi-band
 * grayscale/multispectral stack) are UNDEFINED, keeping the result one entry
 * per band.
 */
function trailingBands(
  extraSamples: ExtraSample[] | null,
  count: number,
): ColorInterp[] {
  return Array.from({ length: count }, (_, i) =>
    extraSamples?.[i] === ExtraSample.UnassociatedAlpha
      ? ColorInterp.ALPHA
      : ColorInterp.UNDEFINED,
  );
}
