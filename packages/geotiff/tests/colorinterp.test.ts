import { Photometric } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { ColorInterp, inferColorInterpretation } from "../src/colorinterp.js";
import { ExtraSample } from "../src/ifd.js";

describe("inferColorInterpretation", () => {
  it("returns UNDEFINED per band when photometric is null", () => {
    expect(
      inferColorInterpretation({
        count: 3,
        photometric: null,
        extraSamples: null,
      }),
    ).toEqual([
      ColorInterp.UNDEFINED,
      ColorInterp.UNDEFINED,
      ColorInterp.UNDEFINED,
    ]);
  });

  it("maps a single-band MinIsBlack image to GRAY", () => {
    expect(
      inferColorInterpretation({
        count: 1,
        photometric: Photometric.MinIsBlack,
        extraSamples: null,
      }),
    ).toEqual([ColorInterp.GRAY]);
  });

  it("maps a single-band MinIsWhite image to GRAY", () => {
    // GDAL reports GCI_GrayIndex for both black-is-zero and white-is-zero; the
    // black/white polarity is not a color-interpretation concern.
    expect(
      inferColorInterpretation({
        count: 1,
        photometric: Photometric.MinIsWhite,
        extraSamples: null,
      }),
    ).toEqual([ColorInterp.GRAY]);
  });

  it("labels the alpha band of a gray+alpha image, not a second GRAY", () => {
    expect(
      inferColorInterpretation({
        count: 2,
        photometric: Photometric.MinIsBlack,
        extraSamples: [ExtraSample.UnassociatedAlpha],
      }),
    ).toEqual([ColorInterp.GRAY, ColorInterp.ALPHA]);
  });

  it("handles gray+alpha for MinIsWhite too", () => {
    expect(
      inferColorInterpretation({
        count: 2,
        photometric: Photometric.MinIsWhite,
        extraSamples: [ExtraSample.UnassociatedAlpha],
      }),
    ).toEqual([ColorInterp.GRAY, ColorInterp.ALPHA]);
  });

  it("pads a multi-band grayscale/multispectral stack to one entry per band", () => {
    expect(
      inferColorInterpretation({
        count: 6,
        photometric: Photometric.MinIsBlack,
        extraSamples: null,
      }),
    ).toEqual([
      ColorInterp.GRAY,
      ColorInterp.UNDEFINED,
      ColorInterp.UNDEFINED,
      ColorInterp.UNDEFINED,
      ColorInterp.UNDEFINED,
      ColorInterp.UNDEFINED,
    ]);
  });

  it("maps a 3-band RGB image to RED/GREEN/BLUE", () => {
    expect(
      inferColorInterpretation({
        count: 3,
        photometric: Photometric.Rgb,
        extraSamples: null,
      }),
    ).toEqual([ColorInterp.RED, ColorInterp.GREEN, ColorInterp.BLUE]);
  });

  it("maps a 4-band RGBA image to RED/GREEN/BLUE/ALPHA", () => {
    expect(
      inferColorInterpretation({
        count: 4,
        photometric: Photometric.Rgb,
        extraSamples: [ExtraSample.UnassociatedAlpha],
      }),
    ).toEqual([
      ColorInterp.RED,
      ColorInterp.GREEN,
      ColorInterp.BLUE,
      ColorInterp.ALPHA,
    ]);
  });

  it("pads RGB with a trailing non-alpha band to one entry per band", () => {
    expect(
      inferColorInterpretation({
        count: 5,
        photometric: Photometric.Rgb,
        extraSamples: [ExtraSample.UnassociatedAlpha],
      }),
    ).toEqual([
      ColorInterp.RED,
      ColorInterp.GREEN,
      ColorInterp.BLUE,
      ColorInterp.ALPHA,
      ColorInterp.UNDEFINED,
    ]);
  });

  it("throws for RGB with fewer than 3 bands", () => {
    expect(() =>
      inferColorInterpretation({
        count: 2,
        photometric: Photometric.Rgb,
        extraSamples: null,
      }),
    ).toThrow();
  });

  it("maps a palette image to a single PALETTE band", () => {
    expect(
      inferColorInterpretation({
        count: 1,
        photometric: Photometric.Palette,
        extraSamples: null,
      }),
    ).toEqual([ColorInterp.PALETTE]);
  });

  it("maps a Separated image to CMYK", () => {
    expect(
      inferColorInterpretation({
        count: 4,
        photometric: Photometric.Separated,
        extraSamples: null,
      }),
    ).toEqual([
      ColorInterp.CYAN,
      ColorInterp.MAGENTA,
      ColorInterp.YELLOW,
      ColorInterp.BLACK,
    ]);
  });

  it("maps a YCbCr image to Y/Cb/Cr", () => {
    expect(
      inferColorInterpretation({
        count: 3,
        photometric: Photometric.Ycbcr,
        extraSamples: null,
      }),
    ).toEqual([ColorInterp.Y, ColorInterp.Cb, ColorInterp.Cr]);
  });
});
