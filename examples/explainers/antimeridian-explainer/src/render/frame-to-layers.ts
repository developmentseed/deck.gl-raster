import type { Layer, Viewport } from "@deck.gl/core";
import type { PathStyleExtensionProps } from "@deck.gl/extensions";
import { PathStyleExtension } from "@deck.gl/extensions";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Texture } from "@luma.gl/core";
import type { DotDraw, Frame, LineDraw, MeshDraw } from "../animation/frame.js";
import { TexturedTrianglesLayer } from "../layers/textured-triangles-layer.js";

type Path = [number, number][];

/** Everything is coplanar at z = 0, so draw strictly in submission order. */
const PARAMETERS = {
  depthCompare: "always",
  depthWriteEnabled: false,
} as const;

const DASHED = [new PathStyleExtension({ dash: true })];

/** What frames draw from, made once after loading. */
export type Assets = {
  /** The image, colored, as a texture. */
  texture: Texture;
};

/**
 * Turn a frame into deck.gl layers: lines marked `under`, then meshes, then
 * the other lines, then dots. Each layer's id starts with its view's id, so
 * {@link layerFilter} draws it in that view only.
 */
export function frameToLayers(frame: Frame, assets: Assets): Layer[] {
  return [
    ...frame.lines.filter((line) => line.under).map(lineLayer),
    ...frame.meshes.map((mesh) => meshLayer(mesh, assets.texture)),
    ...frame.lines.filter((line) => !line.under).map(lineLayer),
    ...frame.dots.map(dotLayer),
  ];
}

/** deck.gl's `layerFilter`: draw each layer in the view its id names. */
export function layerFilter({
  layer,
  viewport,
}: {
  layer: Layer;
  viewport: Viewport;
}): boolean {
  return layer.id.startsWith(`${viewport.id}:`);
}

function meshLayer(mesh: MeshDraw, texture: Texture): Layer {
  return new TexturedTrianglesLayer({
    id: `${mesh.view}:mesh-${mesh.id}`,
    triangles: mesh.soup,
    texture,
    edgeColor: mesh.edgeColor,
    edgeWidth: mesh.edgeWidth,
    opacity: mesh.opacity,
    parameters: PARAMETERS,
  });
}

function lineLayer(line: LineDraw): Layer {
  return new PathLayer<Path, PathStyleExtensionProps<Path>>({
    id: `${line.view}:line-${line.id}`,
    data: line.paths,
    getPath: (path) => path,
    getColor: line.color,
    getWidth: line.width,
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
    parameters: PARAMETERS,
    ...(line.dashed
      ? {
          extensions: DASHED,
          getDashArray: [8, 6],
          dashUnits: "pixels" as const,
        }
      : {}),
    updateTriggers: {
      getColor: line.color.join(","),
      getWidth: line.width,
    },
  });
}

function dotLayer(dots: DotDraw): Layer {
  return new ScatterplotLayer<[number, number]>({
    id: `${dots.view}:dots-${dots.id}`,
    data: dots.points,
    getPosition: (point) => point,
    getFillColor: dots.color,
    getRadius: dots.radius,
    radiusUnits: "pixels",
    stroked: true,
    getLineColor: [255, 255, 255, dots.color[3]],
    getLineWidth: 1.5,
    lineWidthUnits: "pixels",
    parameters: PARAMETERS,
    updateTriggers: {
      getFillColor: dots.color.join(","),
      getLineColor: dots.color[3],
    },
  });
}
