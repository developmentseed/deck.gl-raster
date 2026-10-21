import type { Layer } from "@deck.gl/core";
import { BitmapLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Frame, ImageId } from "../animation/frame.js";
import type { CompositeInputs } from "./composite-layer.js";
import { compositeLayer, ON_TOP } from "./composite-layer.js";

/** Everything frames draw from, made once after loading. */
export type Assets = {
  /** Grayscale canvases of the band images. */
  images: Record<ImageId, HTMLCanvasElement>;
  /** The textures of the two composites: the whole scene, and the story tile. */
  composites: Record<"overview" | "tile", CompositeInputs>;
};

/**
 * Turn a frame into deck.gl layers, in drawing order: images, composites,
 * outlines, then dots. Each item's id becomes its layer's id, so deck.gl keeps
 * the same layer from frame to frame.
 */
export function frameToLayers(frame: Frame, assets: Assets): Layer[] {
  const layers: Layer[] = [];
  for (const bitmap of frame.bitmaps) {
    const { rect } = bitmap;
    layers.push(
      new BitmapLayer({
        id: bitmap.id,
        image: assets.images[bitmap.image],
        // The slide's y grows downward, so the image's bottom is the larger y.
        bounds: [rect.x, rect.y + rect.height, rect.x + rect.width, rect.y],
        opacity: bitmap.opacity,
        coordinateSystem: "cartesian",
        textureParameters: bitmap.nearest
          ? { minFilter: "nearest", magFilter: "nearest" }
          : { minFilter: "linear", magFilter: "linear" },
        parameters: ON_TOP,
      }),
    );
  }
  for (const composite of frame.composites) {
    layers.push(
      compositeLayer({
        id: composite.id,
        inputs: assets.composites[composite.source],
        rect: composite.rect,
        opacity: composite.opacity,
      }),
    );
  }
  for (const polygon of frame.polygons) {
    layers.push(
      new PolygonLayer<[number, number][]>({
        id: polygon.id,
        data: polygon.rings,
        getPolygon: (ring) => ring,
        filled: polygon.fill !== undefined,
        stroked: polygon.line !== undefined,
        getFillColor: polygon.fill ?? [0, 0, 0, 0],
        getLineColor: polygon.line ?? [0, 0, 0, 0],
        getLineWidth: polygon.lineWidth ?? 2,
        lineWidthUnits: "common",
        coordinateSystem: "cartesian",
        parameters: ON_TOP,
      }),
    );
  }
  for (const dots of frame.dots) {
    layers.push(
      new ScatterplotLayer<[number, number]>({
        id: dots.id,
        data: dots.points,
        getPosition: (point) => point,
        getFillColor: dots.color,
        getRadius: dots.radius,
        radiusUnits: "common",
        coordinateSystem: "cartesian",
        parameters: ON_TOP,
      }),
    );
  }
  return layers;
}
