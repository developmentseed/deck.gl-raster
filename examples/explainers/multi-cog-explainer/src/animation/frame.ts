import type { BandId } from "../scene/constants.js";
import type { Rect } from "../scene/layout.js";

/** An RGBA colour, 0-255 per channel. */
export type Rgba = [number, number, number, number];

/** An image the frame can draw: a canvas made once from the fetched data. */
export type ImageId =
  | `${BandId}-overview`
  | `${BandId}-inset`
  | "b04-tile"
  | "b11-tile"
  | `b01-piece-${0 | 1 | 2 | 3}`;

/** A text label over the slide. */
export type Label = {
  /** Stable id (React key). */
  id: string;
  /** Text to show. */
  text: string;
  /** Anchor x, slide units. */
  x: number;
  /** Anchor y, slide units; the text is vertically centred on it. */
  y: number;
  /** Which way the text extends from the anchor. */
  align: "left" | "right" | "center";
  /** CSS colour. */
  color: string;
  /** Opacity, 0-1. */
  opacity: number;
  /** Font size in slide units; 22 when omitted. */
  size?: number;
};

/** Values sampled from each band at the probe, 0-1 after rescaling. */
export type Bars = { r: number; g: number; b: number };

/** Text drawn over the slide. */
export type Hud = {
  /** One-line caption, shown when descriptions are hidden. */
  caption: string | null;
  /** Labels on the panels. */
  labels: Label[];
  /** The sample bars of step 7, or null. */
  bars: Bars | null;
};

/** Everything drawn in one animation frame. */
export type Frame = {
  /** Band images, drawn first. */
  bitmaps: {
    id: string;
    image: ImageId;
    rect: Rect;
    opacity: number;
    nearest?: boolean;
  }[];
  /** Outlines and fills, in slide units. */
  polygons: {
    id: string;
    rings: [number, number][][];
    fill?: Rgba;
    line?: Rgba;
    lineWidth?: number;
  }[];
  /** Composites drawn by the GPU with `CompositeBands`. */
  composites: {
    id: string;
    source: "overview" | "tile";
    rect: Rect;
    opacity: number;
  }[];
  /** Points, drawn last. */
  dots: {
    id: string;
    points: [number, number][];
    color: Rgba;
    radius: number;
  }[];
  /** Text over the slide. */
  hud: Hud;
};

/** A frame that draws nothing. */
export function emptyFrame(): Frame {
  return {
    bitmaps: [],
    polygons: [],
    composites: [],
    dots: [],
    hud: { caption: null, labels: [], bars: null },
  };
}
