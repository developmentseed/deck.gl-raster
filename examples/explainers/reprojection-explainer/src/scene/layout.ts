import type { Bounds } from "./lines.js";

/** An axis-aligned rectangle in slide units (y down). */
export type Rect = { x: number; y: number; width: number; height: number };

/** Width of the slide coordinate space. */
export const SLIDE_WIDTH = 1920;

/** Height of the slide coordinate space. */
export const SLIDE_HEIGHT = 1080;

/** Box the source image is fitted into. */
export const SOURCE_BOX: Rect = { x: 80, y: 190, width: 820, height: 560 };

/** Box the reprojected footprint is fitted into. */
export const TARGET_BOX: Rect = { x: 1020, y: 190, width: 820, height: 560 };

/** Where the two panels sit on the slide, and how to map into them. */
export type Layout = {
  /** The source image's rectangle. */
  source: Rect;
  /** The reprojected footprint's bounding box. */
  target: Rect;
  /** A source-sized rectangle centred on `target`: where fly-then-snap lands. */
  copy: Rect;
  /** Texture coordinate (0–1, v down) → slide position on the source panel. */
  uvToSource(u: number, v: number): [number, number];
  /** Texture coordinate → slide position on the copy rectangle. */
  uvToCopy(u: number, v: number): [number, number];
  /** Source pixel → slide position on the source panel. */
  pixelToSource(x: number, y: number): [number, number];
  /** Target CRS position (y up) → slide position on the target panel. */
  targetToSlide(x: number, y: number): [number, number];
};

/** Options for {@link createLayout}. */
export type LayoutOptions = {
  /** Source image width in pixels. */
  imageWidth: number;
  /** Source image height in pixels. */
  imageHeight: number;
  /** Bounding box of the reprojected footprint, target CRS (y up). */
  targetBounds: Bounds;
  /** Box the source image is fitted into. */
  sourceBox: Rect;
  /** Box the reprojected footprint is fitted into. */
  targetBox: Rect;
};

/** Fit the source image and the reprojected footprint into their boxes. */
export function createLayout(options: LayoutOptions): Layout {
  const { imageWidth, imageHeight, sourceBox, targetBox } = options;
  const [minX, minY, maxX, maxY] = options.targetBounds;
  const source = fitRect(imageWidth, imageHeight, sourceBox);
  const target = fitRect(maxX - minX, maxY - minY, targetBox);
  const copy: Rect = {
    x: target.x + (target.width - source.width) / 2,
    y: target.y + (target.height - source.height) / 2,
    width: source.width,
    height: source.height,
  };
  const targetScale = target.width / (maxX - minX);
  return {
    source,
    target,
    copy,
    uvToSource: (u, v) => [
      source.x + u * source.width,
      source.y + v * source.height,
    ],
    uvToCopy: (u, v) => [copy.x + u * copy.width, copy.y + v * copy.height],
    pixelToSource: (x, y) => [
      source.x + (x / imageWidth) * source.width,
      source.y + (y / imageHeight) * source.height,
    ],
    targetToSlide: (x, y) => [
      target.x + (x - minX) * targetScale,
      target.y + (maxY - y) * targetScale,
    ],
  };
}

/** The largest `width`:`height` rectangle that fits in `box`, centred. */
export function fitRect(width: number, height: number, box: Rect): Rect {
  const scale = Math.min(box.width / width, box.height / height);
  const w = width * scale;
  const h = height * scale;
  return {
    x: box.x + (box.width - w) / 2,
    y: box.y + (box.height - h) / 2,
    width: w,
    height: h,
  };
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

/** Fit the 1920×1080 slide into a `width`×`height` window, letterboxed. */
export function fitSlide(width: number, height: number): SlideFit {
  const scale = Math.min(width / SLIDE_WIDTH, height / SLIDE_HEIGHT);
  return {
    scale,
    offsetX: (width - SLIDE_WIDTH * scale) / 2,
    offsetY: (height - SLIDE_HEIGHT * scale) / 2,
    zoom: Math.log2(scale),
  };
}
