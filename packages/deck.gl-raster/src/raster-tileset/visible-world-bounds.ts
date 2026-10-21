import type { Viewport } from "@deck.gl/core";
import { _GlobeViewport as GlobeViewport } from "@deck.gl/core";
import {
  normalizeLongitudes,
  splitAtAntimeridian,
} from "@developmentseed/proj";
import type { Bounds } from "./types.js";

/**
 * The parts of the world that `viewport` shows, as longitude/latitude boxes
 * within [-180, 180].
 *
 * Near the antimeridian `viewport.getBounds()` runs past ±180°. There, Web
 * Mercator with `repeat` shows another copy of the world, and a globe shows
 * the other side of the antimeridian. So the bounds are moved back within
 * [-180, 180], and split in two at ±180° if they cross it. Web Mercator
 * without `repeat` draws nothing past ±180°, so its bounds are cut off there.
 */
export function visibleWorldBounds(
  viewport: Pick<Viewport, "getBounds" | "subViewports">,
): Bounds[] {
  const bounds = viewport.getBounds();
  if (!viewport.subViewports && !(viewport instanceof GlobeViewport)) {
    const [minX, minY, maxX, maxY] = bounds;
    return [[Math.max(minX, -180), minY, Math.min(maxX, 180), maxY]];
  }
  return splitAtAntimeridian(normalizeLongitudes(bounds));
}
