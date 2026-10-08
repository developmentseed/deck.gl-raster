import type { Layer } from "@deck.gl/core";
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

/**
 * Turn a frame description into deck.gl layers: lines marked `under` first,
 * then the textured meshes, then the other lines, then dots.
 */
export function frameToLayers(frame: Frame, texture: Texture): Layer[] {
  return [
    ...frame.lines.filter((line) => line.under).map(lineLayer),
    ...frame.meshes.map((mesh) => meshLayer(mesh, texture)),
    ...frame.lines.filter((line) => !line.under).map(lineLayer),
    ...frame.dots.map(dotLayer),
  ];
}

function meshLayer(mesh: MeshDraw, texture: Texture): Layer {
  return new TexturedTrianglesLayer({
    id: `mesh-${mesh.id}`,
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
    id: `line-${line.id}`,
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
    id: `dots-${dots.id}`,
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
