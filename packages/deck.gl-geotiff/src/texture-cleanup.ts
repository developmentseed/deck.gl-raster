import { Texture } from "@luma.gl/core";

/**
 * Destroy `value` if it is a luma.gl {@link Texture}, freeing its GPU memory.
 *
 * A no-op for `undefined`, `null`, or any non-`Texture` value, so it is safe to
 * call on optional fields (e.g. an absent mask) without guarding first. luma's
 * `Texture.destroy()` is idempotent, so calling this twice on the same texture
 * is harmless.
 */
export function destroyIfTexture(value: unknown): void {
  if (value instanceof Texture) {
    value.destroy();
  }
}
