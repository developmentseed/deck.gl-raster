import { Texture } from "@luma.gl/core";
import { describe, expect, it, vi } from "vitest";
import { destroyIfTexture } from "../src/texture-cleanup.js";

/**
 * An object that passes `instanceof Texture` (shares Texture's prototype) with a
 * spy `destroy`. We can't `new Texture()` (it is abstract / needs a device), so
 * we synthesize the prototype link directly.
 */
function fakeTexture(): Texture & { destroy: ReturnType<typeof vi.fn> } {
  const tex = Object.create(Texture.prototype) as Texture & {
    destroy: ReturnType<typeof vi.fn>;
  };
  tex.destroy = vi.fn();
  return tex;
}

describe("destroyIfTexture", () => {
  it("destroys a value that is a Texture", () => {
    const tex = fakeTexture();
    destroyIfTexture(tex);
    expect(tex.destroy).toHaveBeenCalledOnce();
  });

  it("ignores undefined", () => {
    expect(() => destroyIfTexture(undefined)).not.toThrow();
  });

  it("ignores null", () => {
    expect(() => destroyIfTexture(null)).not.toThrow();
  });

  it("does not destroy a non-Texture object that happens to have destroy()", () => {
    const notTexture = { destroy: vi.fn() };
    destroyIfTexture(notTexture);
    expect(notTexture.destroy).not.toHaveBeenCalled();
  });
});
