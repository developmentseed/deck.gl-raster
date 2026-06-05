import { Texture } from "@luma.gl/core";
import { describe, expect, it, vi } from "vitest";
import { destroyIfTexture } from "../src/texture-cleanup.js";

/**
 * A value that passes `instanceof Texture` (shares Texture's prototype) plus a
 * spy `destroy`. We can't `new Texture()` (it is abstract / needs a device), so
 * we synthesize the prototype link directly.
 */
function fakeTexture(): {
  texture: Texture;
  destroy: ReturnType<typeof vi.fn>;
} {
  const destroy = vi.fn();
  const texture = Object.create(Texture.prototype) as Texture;
  Object.defineProperty(texture, "destroy", { value: destroy });
  return { texture, destroy };
}

describe("destroyIfTexture", () => {
  it("destroys a value that is a Texture", () => {
    const { texture, destroy } = fakeTexture();
    destroyIfTexture(texture);
    expect(destroy).toHaveBeenCalledOnce();
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
