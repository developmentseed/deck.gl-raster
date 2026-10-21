import type { Rect } from "../scene/layout.js";
import { easeInOutCubic, lerp } from "./math.js";

/** A rect partway from `from` to `to`, with ease-in-out timing (t in 0-1). */
export function flyRect(from: Rect, to: Rect, t: number): Rect {
  const eased = easeInOutCubic(t);
  return {
    x: lerp(from.x, to.x, eased),
    y: lerp(from.y, to.y, eased),
    width: lerp(from.width, to.width, eased),
    height: lerp(from.height, to.height, eased),
  };
}
