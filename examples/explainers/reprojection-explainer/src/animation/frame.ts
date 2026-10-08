import type { TriangleSoup } from "../layers/triangle-soup.js";

/** RGBA colour with components in 0–255. */
export type Rgba = [number, number, number, number];

/** A textured triangle mesh to draw. */
export type MeshDraw = {
  /** Stable id; becomes part of the deck.gl layer id. */
  id: string;
  /** The triangles, positioned in slide units. */
  soup: TriangleSoup;
  /** Edge colour; alpha 0 hides the edges. */
  edgeColor: Rgba;
  /** Edge width per side of an edge, in CSS pixels. */
  edgeWidth: number;
  /** Layer opacity, 0–1. */
  opacity: number;
};

/** Polylines to draw. */
export type LineDraw = {
  /** Stable id; becomes part of the deck.gl layer id. */
  id: string;
  /** Paths in slide units. Keep the array stable between frames when it doesn't change. */
  paths: [number, number][][];
  /** Line colour. */
  color: Rgba;
  /** Width in CSS pixels. */
  width: number;
  /** Draw dashed. */
  dashed: boolean;
  /** Draw underneath the meshes instead of on top. */
  under: boolean;
};

/** Dots to draw. */
export type DotDraw = {
  /** Stable id; becomes part of the deck.gl layer id. */
  id: string;
  /** Dot centres in slide units. */
  points: [number, number][];
  /** Fill colour. */
  color: Rgba;
  /** Radius in CSS pixels. */
  radius: number;
};

/** A text label anchored at a slide position. */
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
  /** Opacity, 0–1. */
  opacity: number;
};

/** Text drawn over the slide. */
export type Hud = {
  /** Triangle count and error, shown under the target panel. */
  counter: string | null;
  /** One-line caption near the bottom of the slide. */
  caption: string | null;
  /** Labels on the panels. */
  labels: Label[];
};

/** Everything drawn in one animation frame. */
export type Frame = {
  /** Textured triangle meshes, drawn in order. */
  meshes: MeshDraw[];
  /** Polylines. */
  lines: LineDraw[];
  /** Dots, drawn last. */
  dots: DotDraw[];
  /** Text overlay. */
  hud: Hud;
};
