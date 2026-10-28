import { describe, expect, it } from "vitest";
import {
  choosePixelReader,
  ExactPixelsUnavailableError,
  swapRedBlue,
} from "../src/terrain/decode-tile.js";
import { terrariumToElevation } from "../src/terrain/terrarium.js";

/** One opaque RGBA pixel. */
const px = (r: number, g: number, b: number) => new Uint8Array([r, g, b, 255]);

describe("terrariumToElevation", () => {
  it("puts sea level at R = 128", () => {
    expect(terrariumToElevation(px(128, 0, 0))[0]).toBe(0);
  });

  it("puts the lowest value at all zeros", () => {
    expect(terrariumToElevation(px(0, 0, 0))[0]).toBe(-32768);
  });

  it("decodes the Matterhorn's summit exactly", () => {
    // 4478 + 32768 = 37246 = 145 * 256 + 126.
    expect(terrariumToElevation(px(145, 126, 0))[0]).toBe(4478);
  });

  it("adds G in meters and B in 1/256ths of a meter", () => {
    expect(terrariumToElevation(px(128, 1, 128))[0]).toBe(1.5);
  });

  it("keeps the largest value exact in float32", () => {
    expect(terrariumToElevation(px(255, 255, 255))[0]).toBe(32767.99609375);
  });

  it("reads one value per pixel and ignores alpha", () => {
    const rgba = new Uint8Array([128, 0, 0, 0, 129, 0, 0, 7]);
    expect([...terrariumToElevation(rgba)]).toEqual([0, 256]);
  });
});

describe("swapRedBlue", () => {
  it("swaps the first and third byte of every pixel in place", () => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    swapRedBlue(pixels);
    expect([...pixels]).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
  });
});

describe("choosePixelReader", () => {
  it("reads through a canvas that reads back what was drawn", () => {
    expect(
      choosePixelReader({ canvasDistorted: false, hasVideoFrame: false }),
    ).toBe("canvas");
  });

  it("reads through VideoFrame when the canvas alters reads", () => {
    expect(
      choosePixelReader({ canvasDistorted: true, hasVideoFrame: true }),
    ).toBe("video-frame");
  });

  it("gives up when the canvas alters reads and there's no VideoFrame", () => {
    // Firefox with privacy.resistFingerprinting: canvas reads are random and
    // WebCodecs is switched off.
    expect(
      choosePixelReader({ canvasDistorted: true, hasVideoFrame: false }),
    ).toBe("none");
  });
});

describe("ExactPixelsUnavailableError", () => {
  it("is an Error the app can tell apart from network failures", () => {
    const error = new ExactPixelsUnavailableError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ExactPixelsUnavailableError");
    expect(error.message).toMatch(/fingerprinting/);
  });
});
