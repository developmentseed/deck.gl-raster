import type {
  Color,
  DefaultProps,
  LayerProps,
  UpdateParameters,
} from "@deck.gl/core";
import { Layer, project32 } from "@deck.gl/core";
import type { Texture } from "@luma.gl/core";
import { Model } from "@luma.gl/engine";
import type { ShaderModule } from "@luma.gl/shadertools";
import type { TriangleSoup } from "./triangle-soup.js";

/** Uniforms of {@link TexturedTrianglesLayer}'s shader module. */
type TexturedTrianglesModuleProps = {
  edgeColor: [number, number, number, number];
  edgeWidth: number;
  imageTexture: Texture;
};

// GLSL member order must match `uniformTypes` key order (std140 layout).
const uniformBlock = /* glsl */ `\
layout(std140) uniform texturedTrianglesUniforms {
  vec4 edgeColor;
  float edgeWidth;
} texturedTriangles;
`;

const texturedTrianglesModule = {
  name: "texturedTriangles",
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    edgeColor: "vec4<f32>",
    edgeWidth: "f32",
  },
} as const satisfies ShaderModule<TexturedTrianglesModuleProps>;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME textured-triangles-layer-vertex-shader

in vec2 positions;
in vec2 texCoords;
in vec3 barycentrics;
in vec4 tints;

out vec2 vTexCoord;
out vec3 vBarycentric;
out vec4 vTint;

void main(void) {
  vec3 position = vec3(positions, 0.0);
  geometry.worldPosition = position;
  geometry.uv = texCoords;
  gl_Position = project_position_to_clipspace(position, vec3(0.0), vec3(0.0), geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vTexCoord = texCoords;
  vBarycentric = barycentrics;
  vTint = tints;
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME textured-triangles-layer-fragment-shader

precision highp float;

uniform sampler2D imageTexture;

in vec2 vTexCoord;
in vec3 vBarycentric;
in vec4 vTint;

out vec4 fragColor;

void main(void) {
  // The GPU has linearly interpolated vTexCoord across the triangle: this is
  // the "stretch" that approximates the reprojection.
  vec4 color = texture(imageTexture, vTexCoord);
  color.rgb = mix(color.rgb, vTint.rgb, vTint.a);

  if (texturedTriangles.edgeWidth > 0.0) {
    // Distance to the nearest edge in device pixels, from screen-space
    // derivatives of the barycentric coordinate.
    vec3 ramp = smoothstep(vec3(0.0), fwidth(vBarycentric) * texturedTriangles.edgeWidth, vBarycentric);
    float edge = 1.0 - min(min(ramp.x, ramp.y), ramp.z);
    color.rgb = mix(color.rgb, texturedTriangles.edgeColor.rgb, edge * texturedTriangles.edgeColor.a);
  }

  fragColor = vec4(color.rgb, color.a * layer.opacity);
  geometry.uv = vTexCoord;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

type _TexturedTrianglesLayerProps = {
  /** Triangles to draw. Pass a new object (or new arrays) to update. */
  triangles: TriangleSoup | null;
  /** The source image. Shared between layers; not destroyed by the layer. */
  texture: Texture | null;
  /** Edge colour, 0–255 RGBA. Alpha 0 hides the edges. */
  edgeColor?: Color;
  /** Edge width per side of an edge, in CSS pixels. */
  edgeWidth?: number;
};

/** Props of {@link TexturedTrianglesLayer}. */
export type TexturedTrianglesLayerProps = _TexturedTrianglesLayerProps &
  LayerProps;

const defaultProps: DefaultProps<TexturedTrianglesLayerProps> = {
  triangles: { type: "object", value: null },
  texture: { type: "object", value: null },
  edgeColor: { type: "color", value: [255, 255, 255, 0] },
  edgeWidth: { type: "number", value: 1, min: 0 },
};

const ATTRIBUTES = ["positions", "texCoords", "barycentrics", "tints"] as const;

/**
 * Draws de-indexed, textured triangles in slide space, with optional edges
 * and per-vertex tints. Knows nothing about animation: callers move the
 * triangles by passing new positions every frame.
 */
export class TexturedTrianglesLayer extends Layer<
  Required<_TexturedTrianglesLayerProps>
> {
  static override layerName = "TexturedTrianglesLayer";
  static override defaultProps = defaultProps;

  declare state: { model?: Model };

  override getShaders() {
    return super.getShaders({
      vs,
      fs,
      modules: [project32, texturedTrianglesModule],
    });
  }

  override initializeState(): void {
    const noAlloc = true;
    // deck.gl creates a new layer instance on every render and hands it this
    // attribute manager, so the updaters must read the current props from
    // their arguments. `this.props` would stay bound to the first instance.
    this.getAttributeManager()!.add({
      positions: {
        size: 2,
        noAlloc,
        update: (attribute, { props }) => {
          attribute.value = props.triangles?.positions ?? null;
        },
      },
      texCoords: {
        size: 2,
        noAlloc,
        update: (attribute, { props }) => {
          attribute.value = props.triangles?.texCoords ?? null;
        },
      },
      barycentrics: {
        size: 3,
        noAlloc,
        update: (attribute, { props }) => {
          attribute.value = props.triangles?.barycentrics ?? null;
        },
      },
      tints: {
        size: 4,
        noAlloc,
        update: (attribute, { props }) => {
          attribute.value = props.triangles?.tints ?? null;
        },
      },
    });
  }

  override updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    const { props, oldProps, changeFlags } = params;
    const attributeManager = this.getAttributeManager()!;

    if (changeFlags.extensionsChanged) {
      this.state.model?.destroy();
      this.state.model = new Model(this.context.device, {
        ...this.getShaders(),
        id: this.props.id,
        bufferLayout: attributeManager.getBufferLayouts(),
        topology: "triangle-list",
        isInstanced: false,
        // Non-indexed, so a rebuilt model has no index buffer to fall back
        // on: carry the vertex count over even when `triangles` is unchanged.
        vertexCount: props.triangles?.vertexCount ?? 0,
      });
      attributeManager.invalidateAll();
    }

    const next = props.triangles;
    const prev = oldProps.triangles;
    if (next !== prev) {
      this.state.model?.setVertexCount(next?.vertexCount ?? 0);
      for (const name of ATTRIBUTES) {
        if (next?.[name] !== prev?.[name]) {
          attributeManager.invalidate(name);
        }
      }
    }
  }

  override draw(): void {
    const { model } = this.state;
    const { triangles, texture, edgeColor, edgeWidth } = this.props;
    if (!model || !texture || !triangles || triangles.vertexCount === 0) {
      return;
    }
    const cssToDevice =
      this.context.device.canvasContext?.cssToDeviceRatio() ?? 1;
    const moduleProps: TexturedTrianglesModuleProps = {
      imageTexture: texture,
      edgeColor: [
        edgeColor[0] / 255,
        edgeColor[1] / 255,
        edgeColor[2] / 255,
        (edgeColor[3] ?? 255) / 255,
      ],
      edgeWidth: edgeWidth * cssToDevice,
    };
    model.shaderInputs.setProps({ texturedTriangles: moduleProps });
    model.draw(this.context.renderPass);
  }
}
