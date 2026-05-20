import type {
  CompositeLayerProps,
  DefaultProps,
  Layer,
  TextureSource,
  UpdateParameters,
} from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { PolygonLayer } from "@deck.gl/layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";
import { splitFloat64Array } from "./fp64.js";
import type { RasterModule } from "./gpu-modules/types.js";
import { MeshTextureLayer } from "./mesh-layer/mesh-layer.js";

const DEFAULT_MAX_ERROR = 0.125;

const DEBUG_COLORS: [number, number, number][] = [
  [252, 73, 163], // pink
  [255, 51, 204], // magenta-pink
  [204, 102, 255], // purple-ish
  [153, 51, 255], // deep purple
  [102, 204, 255], // sky blue
  [51, 153, 255], // clear blue
  [102, 255, 204], // teal
  [51, 255, 170], // aqua-teal
  [0, 255, 0], // lime green
  [51, 204, 51], // stronger green
  [255, 204, 102], // light orange
  [255, 179, 71], // golden-orange
  [255, 102, 102], // salmon
  [255, 80, 80], // red-salmon
  [255, 0, 0], // red
  [204, 0, 0], // crimson
  [255, 128, 0], // orange
  [255, 153, 51], // bright orange
  [255, 255, 102], // yellow
  [255, 255, 51], // lemon
  [0, 255, 255], // turquoise
  [0, 204, 255], // cyan
];

type DebugData = {
  reprojector: RasterReprojector;
  length: number;
};

/**
 * The result returned by a `renderTile` function.
 *
 * Must contain at least one of `image` or `renderPipeline`. If both are
 * provided, `image` is prepended as a `CreateTexture` module so the pipeline
 * can operate on it.
 */
export type RenderTileResult =
  | { image: TextureSource; renderPipeline?: RasterModule[] }
  | { renderPipeline: RasterModule[]; image?: TextureSource };

/**
 * Props for {@link RasterLayer}.
 */
export interface RasterLayerProps extends CompositeLayerProps {
  /**
   * Width of the input raster image in pixels
   */
  width: number;

  /**
   * Height of the input raster image in pixels
   */
  height: number;

  /**
   * Reprojection functions for converting between pixel, input CRS, and output CRS coordinates
   */
  reprojectionFns: ReprojectionFns;

  /**
   * The image to display. Accepts any luma.gl `TextureSource` (e.g. a URL,
   * `HTMLImageElement`, `ImageData`, etc.). deck.gl manages the texture
   * lifecycle automatically.
   *
   * If `renderPipeline` is also provided, `image` is prepended as a
   * `CreateTexture` module so the pipeline can operate on it.
   *
   * @default null
   */
  image?: TextureSource | null;

  /**
   * Sequence of shader modules to be composed into a render pipeline.
   *
   * If `image` is also provided, it is automatically prepended as a
   * `CreateTexture` module.
   */
  renderPipeline?: RasterModule[] | null;

  /**
   * Maximum reprojection error in pixels for mesh refinement.
   * Lower values create denser meshes with higher accuracy.
   * @default 0.125
   */
  maxError?: number;

  /** If set, enables debug mode for visualizing the mesh and reprojection process. */
  debug?: boolean;

  /** Opacity of the debug overlay. */
  debugOpacity?: number;
}

const defaultProps: DefaultProps<RasterLayerProps> = {
  // A prop with `type: "image"` gets converted to a texture automatically by
  // deck.gl (as long as async: true)
  image: { type: "image", value: null, async: true },
  renderPipeline: { type: "array", value: [], compare: true },
  debug: false,
  debugOpacity: 0.5,
};

/**
 * Generic deck.gl layer for rendering geospatial raster data with client-side,
 * GPU-based reprojection and custom processing pipelines.
 *
 * This is a composite layer that uses {@link RasterReprojector} to generate an adaptive mesh
 * that accurately represents the reprojected raster, then renders it using
 * {@link MeshTextureLayer} (a small wrapper around a deck.gl
 * {@link SimpleMeshLayer}).
 */
export class RasterLayer extends CompositeLayer<RasterLayerProps> {
  static override layerName = "RasterLayer";
  static override defaultProps = defaultProps;

  declare state: {
    reprojector?: RasterReprojector;
    /**
     * Mesh in the exact shape SimpleMeshLayer expects.
     *
     * It's important for this to be passed to MeshTextureLayer as a stable
     * reference so `props.mesh` equality holds across renders. This avoids
     * unnecessarily recreating the model.
     */
    mesh?: {
      indices: { value: Uint32Array; size: number };
      attributes: {
        POSITION: { value: Float32Array; size: number };
        TEXCOORD_0: { value: Float32Array; size: number };
      };
    };
    /**
     * Low-part Float32Array of the fp64 split of mesh vertex positions
     * (sibling to `mesh.attributes.POSITION`, which carries the high part).
     * Stored separately from `mesh` because SimpleMeshLayer's
     * `normalizeGeometryAttributes` whitelists only positions/colors/normals/
     * texCoords on the mesh attributes object — anything else is silently
     * dropped. Passed to MeshTextureLayer via a dedicated prop. See
     * `dev-docs/specs/2026-05-19-high-zoom-precision-design.md`.
     */
    positions64Low?: Float32Array;
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps, changeFlags } = params;

    // Regenerate mesh if key properties change.
    // Compare reprojectionFns members individually since callers may create a
    // new wrapper object on every render even when the functions are stable.
    const reprojectionFnsChanged =
      props.reprojectionFns.forwardTransform !==
        oldProps.reprojectionFns?.forwardTransform ||
      props.reprojectionFns.inverseTransform !==
        oldProps.reprojectionFns?.inverseTransform ||
      props.reprojectionFns.forwardReproject !==
        oldProps.reprojectionFns?.forwardReproject ||
      props.reprojectionFns.inverseReproject !==
        oldProps.reprojectionFns?.inverseReproject;

    const needsMeshUpdate =
      Boolean(changeFlags.dataChanged) ||
      props.width !== oldProps.width ||
      props.height !== oldProps.height ||
      reprojectionFnsChanged ||
      props.maxError !== oldProps.maxError;

    if (needsMeshUpdate) {
      this._generateMesh();
    }
  }

  protected _generateMesh(): void {
    const {
      width,
      height,
      reprojectionFns,
      maxError = DEFAULT_MAX_ERROR,
    } = this.props;

    // The mesh is lined up with the upper and left edges of the raster. So if
    // we give the raster the same width and height as the number of pixels in
    // the image, it'll be omitting the last row and column of pixels.
    //
    // To account for this, we add 1 to both width and height when generating
    // the mesh. This also solves obvious gaps in between neighboring tiles in
    // the COGLayer.
    const reprojector = new RasterReprojector(
      reprojectionFns,
      width + 1,
      height + 1,
    );
    reprojector.run(maxError);
    const { indices, positions, positions64Low, texCoords } =
      reprojectorToMesh(reprojector);

    this.setState({
      reprojector,
      mesh: {
        indices: { value: indices, size: 1 },
        attributes: {
          POSITION: { value: positions, size: 3 },
          TEXCOORD_0: { value: texCoords, size: 2 },
        },
      },
      positions64Low,
    });
  }

  renderDebugLayer(): Layer | null {
    const { reprojector } = this.state;
    const { debugOpacity } = this.props;

    if (!reprojector) {
      return null;
    }

    return new PolygonLayer(
      this.getSubLayerProps({
        id: "polygon",
        // https://deck.gl/docs/developer-guide/performance#supply-binary-blobs-to-the-data-prop
        // This `data` gets passed into `getPolygon` with the row index.
        data: { reprojector, length: reprojector.triangles.length / 3 },
        getPolygon: (
          _: any,
          {
            index,
            data,
          }: {
            index: number;
            data: DebugData;
          },
        ) => {
          const triangles = data.reprojector.triangles;
          const positions = reprojector.exactOutputPositions;

          const a = triangles[index * 3]!;
          const b = triangles[index * 3 + 1]!;
          const c = triangles[index * 3 + 2]!;

          return [
            [positions[a * 2]!, positions[a * 2 + 1]!],
            [positions[b * 2]!, positions[b * 2 + 1]!],
            [positions[c * 2]!, positions[c * 2 + 1]!],
            [positions[a * 2]!, positions[a * 2 + 1]!],
          ];
        },
        getFillColor: (
          _: any,
          { index, target }: { index: number; target: number[] },
        ) => {
          const color = DEBUG_COLORS[index % DEBUG_COLORS.length]!;
          target[0] = color[0];
          target[1] = color[1];
          target[2] = color[2];
          target[3] = 255;
          return target;
        },
        getLineColor: [0, 0, 0],
        getLineWidth: 1,
        lineWidthUnits: "pixels",
        opacity:
          debugOpacity !== undefined && Number.isFinite(debugOpacity)
            ? Math.max(0, Math.min(1, debugOpacity))
            : 1,
        pickable: false,
      }),
    );
  }

  renderLayers() {
    const { mesh, positions64Low } = this.state;
    const { debug, image, renderPipeline } = this.props;

    // mesh and positions64Low are always set together by _generateMesh.
    if (
      !mesh ||
      !positions64Low ||
      (!image && (renderPipeline?.length ?? 0) === 0)
    ) {
      return null;
    }

    const meshLayer = new MeshTextureLayer(
      this.getSubLayerProps({
        id: "raster",
        image,
        renderPipeline,
        // Single mesh rendered as one non-instanced draw. The binary
        // { length, attributes } data form pipes the per-vertex fp64 low part
        // through `data.attributes` — deck.gl 9.x removed `props.<attrName>`
        // as a channel for attribute values (see
        // @deck.gl/core/lib/attribute/attribute-manager.ts:196).
        data: { length: 1, attributes: { positions64Low } },
        mesh,
        // We give a white color to turn off color mixing with the texture.
        getColor: [255, 255, 255],
      }),
    );

    const layers: Layer[] = [meshLayer];
    if (debug) {
      const debugLayer = this.renderDebugLayer();
      if (debugLayer) {
        layers.push(debugLayer);
      }
    }

    return layers;
  }
}

function reprojectorToMesh(reprojector: RasterReprojector): {
  indices: Uint32Array;
  positions: Float32Array;
  positions64Low: Float32Array;
  texCoords: Float32Array;
} {
  const numVertices = reprojector.uvs.length / 2;
  const texCoords = new Float32Array(reprojector.uvs);

  const positions = new Float64Array(numVertices * 3);
  for (let i = 0; i < numVertices; i++) {
    positions[i * 3] = reprojector.exactOutputPositions[i * 2]!;
    positions[i * 3 + 1] = reprojector.exactOutputPositions[i * 2 + 1]!;
    // z (flat on the ground)
    positions[i * 3 + 2] = 0;
  }

  // Split the float64 positions into high and low parts for fp64 emulation in
  // the shader.
  const [positions64Low, positions64High] = splitFloat64Array(positions);

  // TODO: Consider using 16-bit indices if the mesh is small enough
  const indices = new Uint32Array(reprojector.triangles);

  return {
    indices,
    positions: new Float32Array(positions64High),
    positions64Low,
    texCoords,
  };
}
