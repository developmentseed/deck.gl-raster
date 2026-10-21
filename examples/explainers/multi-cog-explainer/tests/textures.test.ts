import { describe, expect, it } from "vitest";
import { checkTextureSupport } from "../src/render/textures.js";

describe("checkTextureSupport", () => {
  it("explains a GPU that can't filter 16-bit textures", () => {
    const device = { isTextureFormatFilterable: () => false };
    expect(() => checkTextureSupport(device)).toThrow(
      "This GPU can't filter 16-bit textures (r16unorm), which this explainer needs.",
    );
  });

  it("accepts a GPU that can", () => {
    const device = { isTextureFormatFilterable: () => true };
    expect(() => checkTextureSupport(device)).not.toThrow();
  });
});
