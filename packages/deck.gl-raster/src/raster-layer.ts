import type {
  CompositeLayerProps,
  DefaultProps,
  Layer,
  TextureSource,
  UpdateParameters,
} from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { PolygonLayer } from "@deck.gl/layers";
import type {
  InitialTriangulation,
  ReprojectionFns,
} from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";
import type { Mesh2D } from "./clip-mesh-to-world.js";
import { clipMeshToWorld } from "./clip-mesh-to-world.js";
import { splitFloat64Array } from "./fp64.js";
import { buildUniformGridMesh } from "./globe-grid-mesh.js";
import type { RasterModule } from "./gpu-modules/types.js";
import { makeUnwrappedReprojectionFns } from "./make-unwrapped-reprojection-fns.js";
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
  indices: Uint32Array;
  positions64High: Float32Array;
  positions64Low: Float32Array;
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
   * Optional seed triangulation for the reprojector — e.g. to clamp the mesh to
   * a UV sub-region (such as the valid Web Mercator latitude band). Defaults to
   * the full image. Must be reference-stable across renders to avoid
   * regenerating the mesh every frame.
   */
  initialTriangulation?: InitialTriangulation;

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
   * Maximum reprojection error for mesh refinement: how far the mesh may draw
   * a point from where it belongs on the map, in output pixels (one input
   * pixel's size on the map, normally at the center of the meshed area).
   * Lower values create denser meshes with higher accuracy.
   * @default 0.125
   */
  maxError?: number;

  /**
   * The period of the output's x axis, if it wraps around: one world width
   * (512) for Web Mercator in deck.gl's common space.
   *
   * An image that crosses the wrap (the antimeridian) is then meshed in one
   * piece, the short way across, and drawn cut at the world's edge, each part
   * inside the world.
   *
   * @internal Experimental; may change or be removed.
   */
  _wrapX?: number;

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
     * Low-part of positions for fp64 emulation in the shaders.
     * `mesh.attributes.POSITION` carries the high part.
     *
     * This needs to be passed separately from `mesh` because SimpleMeshLayer's
     * `normalizeGeometryAttributes` whitelists only positions/colors/normals/
     * texCoords on the mesh attributes object — anything else is silently
     * dropped.
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
      props.maxError !== oldProps.maxError ||
      props.initialTriangulation !== oldProps.initialTriangulation ||
      props._wrapX !== oldProps._wrapX;

    if (needsMeshUpdate) {
      this._generateMesh();
    }
  }

  protected _generateMesh(): void {
    const {
      width,
      height,
      reprojectionFns,
      initialTriangulation,
      maxError = DEFAULT_MAX_ERROR,
      _wrapX,
    } = this.props;

    // TEMPORARY GLOBE VIEW HACK:
    //
    // GlobeView (lnglat) uses viewport.resolution, the same detection as
    // RasterTileLayer. THROWAWAY: globe renders a uniform grid instead of the
    // adaptive mesh, because Delatin's reprojection-error metric is blind to
    // sphere curvature and facets at low zoom. See globe-grid-mesh.ts and
    // dev-docs/specs/2026-05-21-globe-view-design.md.
    const isGlobe = this.context?.viewport?.resolution !== undefined;
    if (isGlobe) {
      const { indices, positions64High, positions64Low, texCoords } =
        buildUniformGridMesh(reprojectionFns, width + 1, height + 1);
      this.setState({
        reprojector: undefined,
        mesh: {
          indices: { value: indices, size: 1 },
          attributes: {
            POSITION: { value: positions64High, size: 3 },
            TEXCOORD_0: { value: texCoords, size: 2 },
          },
        },
        positions64Low,
      });
      return;
    }

    // The mesh is lined up with the upper and left edges of the raster. So if
    // we give the raster the same width and height as the number of pixels in
    // the image, it'll be omitting the last row and column of pixels.
    //
    // To account for this, we add 1 to both width and height when generating
    // the mesh. This also solves obvious gaps in between neighboring tiles in
    // the COGLayer.
    let reprojector: RasterReprojector;
    try {
      // When `_wrapX` is defined, make the projection continuous across the
      // wrap, so the reprojector meshes an image that crosses it in one piece.
      const fns =
        _wrapX === undefined
          ? reprojectionFns
          : makeUnwrappedReprojectionFns(reprojectionFns, {
              width,
              height,
              period: _wrapX,
            });

      reprojector = new RasterReprojector(fns, width + 1, height + 1, {
        initialTriangulation,
        // Output mode measures error on the map and never calls the inverse
        // functions, which `_wrapX`'s unwrapped projection doesn't match.
        _errorSpace: "output",
      });
      reprojector.run(maxError);
    } catch (error) {
      // Draw nothing rather than the mesh from earlier props, and report it.
      this.setState({
        reprojector: undefined,
        mesh: undefined,
        positions64Low: undefined,
      });
      this.raiseError(error as Error, "building the reprojection mesh");
      return;
    }
    const reprojected: Mesh2D = {
      positions: reprojector.exactOutputPositions,
      uvs: reprojector.uvs,
      triangles: reprojector.triangles,
    };

    // When `_wrapX` is set, the mesh may run past the world's edge.
    //
    // We need to cut it on the world's edge, so each part is drawn inside the
    // correct world.
    const drawnMesh =
      _wrapX === undefined ? reprojected : clipMeshToWorld(reprojected, _wrapX);
    const { indices, positions64High, positions64Low, texCoords } =
      meshToBuffers(drawnMesh);

    this.setState({
      reprojector,
      mesh: {
        indices: { value: indices, size: 1 },
        attributes: {
          POSITION: { value: positions64High, size: 3 },
          TEXCOORD_0: { value: texCoords, size: 2 },
        },
      },
      positions64Low,
    });
  }

  renderDebugLayer(): Layer | null {
    const { mesh, positions64Low } = this.state;
    const { debugOpacity } = this.props;

    if (!mesh || !positions64Low) {
      return null;
    }

    const indices = mesh.indices.value;
    return new PolygonLayer(
      this.getSubLayerProps({
        id: "polygon",
        // https://deck.gl/docs/developer-guide/performance#supply-binary-blobs-to-the-data-prop
        // This `data` gets passed into `getPolygon` with the row index.
        data: {
          indices,
          positions64High: mesh.attributes.POSITION.value,
          positions64Low,
          length: indices.length / 3,
        },
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
          const { indices, positions64High: high, positions64Low: low } = data;

          const a = indices[index * 3]!;
          const b = indices[index * 3 + 1]!;
          const c = indices[index * 3 + 2]!;

          // Recombine float32 high and low parts to get position
          const position = (vertex: number): [number, number] => [
            high[vertex * 3]! + low[vertex * 3]!,
            high[vertex * 3 + 1]! + low[vertex * 3 + 1]!,
          ];
          return [position(a), position(b), position(c), position(a)];
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
        // Single mesh rendered as one non-instanced draw.
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

function meshToBuffers(mesh: Mesh2D): {
  indices: Uint32Array;
  positions64High: Float32Array;
  positions64Low: Float32Array;
  texCoords: Float32Array;
} {
  const numVertices = mesh.uvs.length / 2;
  const texCoords = new Float32Array(mesh.uvs);

  const positions = new Float64Array(numVertices * 3);
  for (let i = 0; i < numVertices; i++) {
    positions[i * 3] = mesh.positions[i * 2]!;
    positions[i * 3 + 1] = mesh.positions[i * 2 + 1]!;
    // z (flat on the ground)
    positions[i * 3 + 2] = 0;
  }

  // Split the float64 positions into high and low parts for fp64 emulation in
  // the shader.
  const [positions64Low, positions64High] = splitFloat64Array(positions);

  // TODO: Consider using 16-bit indices if the mesh is small enough
  const indices = new Uint32Array(mesh.triangles);

  return {
    indices,
    positions64High,
    positions64Low,
    texCoords,
  };
}
