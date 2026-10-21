import type { UvTransform } from "@developmentseed/deck.gl-raster";
import type { Rect } from "./layout.js";

/** Where a UV transform puts the primary tile, on a texture drawn in `slot`. */
export function uvRect(slot: Rect, uv: UvTransform): Rect {
  const [offsetX, offsetY, scaleX, scaleY] = uv;
  return {
    x: slot.x + offsetX * slot.width,
    y: slot.y + offsetY * slot.height,
    width: scaleX * slot.width,
    height: scaleY * slot.height,
  };
}

/** A number to two decimals, without trailing zeros. */
function short(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** A UV transform as the labels show it: "offset (0, 0) · scale (0.5, 0.5)". */
export function uvLabel(uv: UvTransform): string {
  const [offsetX, offsetY, scaleX, scaleY] = uv;
  return `offset (${short(offsetX)}, ${short(offsetY)}) · scale (${short(scaleX)}, ${short(scaleY)})`;
}
