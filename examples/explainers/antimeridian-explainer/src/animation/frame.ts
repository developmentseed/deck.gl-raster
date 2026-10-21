import type { TriangleSoup } from "../layers/triangle-soup.js";
import type { Camera, MapViewId } from "../scene/layout.js";

/** RGBA colour with components in 0-255. */
export type Rgba = [number, number, number, number];

/**
 * Where an item is drawn: on the slide, in slide units, or in one of the map
 * views, in Web Mercator common space.
 */
export type ViewId = "slide" | MapViewId;

/** A textured triangle mesh to draw. */
export type MeshDraw = {
  /** Stable id; becomes part of the deck.gl layer id. */
  id: string;
  view: ViewId;
  /** The triangles, in the view's units. */
  soup: TriangleSoup;
  /** Edge colour; alpha 0 hides the edges. */
  edgeColor: Rgba;
  /** Edge width per side of an edge, in CSS pixels. */
  edgeWidth: number;
  /** Layer opacity, 0-1. */
  opacity: number;
};

/** Polylines to draw. */
export type LineDraw = {
  /** Stable id; becomes part of the deck.gl layer id. */
  id: string;
  view: ViewId;
  /** Paths in the view's units. */
  paths: [number, number][][];
  /** Line colour. */
  color: Rgba;
  /** Width in CSS pixels. */
  width: number;
  /** Draw dashed. */
  dashed?: boolean;
  /** Draw underneath the meshes instead of on top. */
  under?: boolean;
};

/** Dots to draw. */
export type DotDraw = {
  /** Stable id; becomes part of the deck.gl layer id. */
  id: string;
  view: ViewId;
  /** Dot centres in the view's units. */
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
  /** Opacity, 0-1. */
  opacity: number;
  /** Font size in slide units; 22 when omitted. */
  size?: number;
};

/** Text drawn over the slide. */
export type Hud = {
  /** One-line caption near the bottom of the slide. */
  caption: string | null;
  /** Labels on the panels. */
  labels: Label[];
};

/** Everything drawn in one animation frame. */
export type Frame = {
  /** The map views shown in this frame, and what each shows. */
  cameras: Partial<Record<MapViewId, Camera>>;
  /** Textured triangle meshes, drawn in order. */
  meshes: MeshDraw[];
  /** Polylines. */
  lines: LineDraw[];
  /** Dots, drawn last. */
  dots: DotDraw[];
  /** Text overlay. */
  hud: Hud;
};

/** A frame with nothing in it. */
export function emptyFrame(): Frame {
  return {
    cameras: {},
    meshes: [],
    lines: [],
    dots: [],
    hud: { caption: null, labels: [] },
  };
}
