/** A rectangle in slide units. */
export type Rect = { x: number; y: number; width: number; height: number };

/** Slide width in slide units. */
export const SLIDE_WIDTH = 1920;

/** Slide height in slide units. */
export const SLIDE_HEIGHT = 1080;

/** The image as stored, in its own pixels (left). */
export const IMAGE_BOX: Rect = { x: 80, y: 190, width: 560, height: 560 };

/** The map, in Web Mercator common space (right). */
export const MAP_BOX: Rect = { x: 720, y: 170, width: 1120, height: 620 };

/** From step 5: the whole world, where proj4's raw answers land. */
export const STRIP_BOX: Rect = { x: 720, y: 170, width: 1120, height: 150 };

/** From step 5: the seam up close, where the mesh is. */
export const CLOSEUP_BOX: Rect = { x: 720, y: 340, width: 1120, height: 450 };

/** Top of the step description, in slide units. */
export const DESCRIPTION_TOP = 860;

/** The views the map is drawn in, each with its own camera. */
export type MapViewId = "world" | "strip" | "closeup";

/**
 * What a map view shows: a box on the slide, and the common-space point at
 * its center, at `scale` slide units per common unit. North is up.
 */
export type Camera = {
  rect: Rect;
  center: [number, number];
  scale: number;
};

/** A camera on `rect` that fits `bounds` (`[minX, minY, maxX, maxY]`) inside a `padding` margin. */
export function cameraForBounds(
  rect: Rect,
  bounds: [number, number, number, number],
  padding: number,
): Camera {
  const [minX, minY, maxX, maxY] = bounds;
  const scale = Math.min(
    (rect.width - 2 * padding) / (maxX - minX),
    (rect.height - 2 * padding) / (maxY - minY),
  );
  return { rect, center: [(minX + maxX) / 2, (minY + maxY) / 2], scale };
}

/** Where a common-space point is drawn on the slide, through `camera`. */
export function commonToSlide(
  camera: Camera,
  [x, y]: [number, number],
): [number, number] {
  const { rect, center, scale } = camera;
  return [
    rect.x + rect.width / 2 + (x - center[0]) * scale,
    rect.y + rect.height / 2 - (y - center[1]) * scale,
  ];
}

/** Interpolate two cameras: box and center linearly, zoom geometrically. */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const mix = (p: number, q: number) => p + (q - p) * t;
  return {
    rect: {
      x: mix(a.rect.x, b.rect.x),
      y: mix(a.rect.y, b.rect.y),
      width: mix(a.rect.width, b.rect.width),
      height: mix(a.rect.height, b.rect.height),
    },
    center: [mix(a.center[0], b.center[0]), mix(a.center[1], b.center[1])],
    scale: a.scale * (b.scale / a.scale) ** t,
  };
}

/** Where a texture coordinate (0-1, v down) is drawn in the image box. */
export function uvToSlide([u, v]: [number, number]): [number, number] {
  return [
    IMAGE_BOX.x + u * IMAGE_BOX.width,
    IMAGE_BOX.y + v * IMAGE_BOX.height,
  ];
}

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

/**
 * A map camera as a deck.gl view: its box in CSS pixels, and the view state
 * that puts `camera.center` in the middle at its scale.
 */
export function viewFor(
  camera: Camera,
  fit: SlideFit,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  target: [number, number, number];
  zoom: number;
} {
  const { rect, center, scale } = camera;
  return {
    x: fit.offsetX + rect.x * fit.scale,
    y: fit.offsetY + rect.y * fit.scale,
    width: rect.width * fit.scale,
    height: rect.height * fit.scale,
    target: [center[0], center[1], 0],
    zoom: Math.log2(scale * fit.scale),
  };
}
