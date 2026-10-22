import type { BandId } from "./constants.js";
import { SCENE_EXTENT, SCENE_ORIGIN } from "./constants.js";

/** An axis-aligned rectangle in slide units. */
export type Rect = { x: number; y: number; width: number; height: number };

/** Width of the slide, in slide units. */
export const SLIDE_WIDTH = 1920;

/** Height of the slide, in slide units. */
export const SLIDE_HEIGHT = 1080;

/** Step 0's three band images, side by side (b04, b11, b01). */
export const INTRO_SLOTS: [Rect, Rect, Rect] = [
  { x: 100, y: 190, width: 520, height: 520 },
  { x: 700, y: 190, width: 520, height: 520 },
  { x: 1300, y: 190, width: 520, height: 520 },
];

/** The whole scene, from step 1 on. */
export const SCENE_BOX: Rect = { x: 80, y: 170, width: 640, height: 640 };

/** One texture slot per band, in the texture panel. */
export const TEXTURE_SLOTS: Record<BandId, Rect> = {
  b04: { x: 820, y: 210, width: 300, height: 300 },
  b11: { x: 1170, y: 210, width: 300, height: 300 },
  b01: { x: 1520, y: 210, width: 300, height: 300 },
};

/** Step 7's sample bars, under the texture panel. */
export const BARS_BOX: Rect = { x: 820, y: 600, width: 1000, height: 180 };

/** Top of the step description, in slide units. */
export const DESCRIPTION_TOP = 860;

/** How the slide is shown in a window. */
export type SlideFit = {
  /** CSS pixels per slide unit. */
  scale: number;
  /** Left edge of the slide in the window, CSS pixels. */
  offsetX: number;
  /** Top edge of the slide in the window, CSS pixels. */
  offsetY: number;
  /** deck.gl `OrthographicView` zoom (`log2(scale)`). */
  zoom: number;
};

/** Fit the 1920 x 1080 slide into a `width` x `height` window, letterboxed. */
export function fitSlide(width: number, height: number): SlideFit {
  const scale = Math.min(width / SLIDE_WIDTH, height / SLIDE_HEIGHT);
  return {
    scale,
    offsetX: (width - SLIDE_WIDTH * scale) / 2,
    offsetY: (height - SLIDE_HEIGHT * scale) / 2,
    zoom: Math.log2(scale),
  };
}

/** Map a point in the scene's UTM metres onto the scene box. */
export function utmToScene(x: number, y: number): [number, number] {
  const scale = SCENE_BOX.width / SCENE_EXTENT;
  return [
    SCENE_BOX.x + (x - SCENE_ORIGIN[0]) * scale,
    SCENE_BOX.y + (SCENE_ORIGIN[1] - y) * scale,
  ];
}
