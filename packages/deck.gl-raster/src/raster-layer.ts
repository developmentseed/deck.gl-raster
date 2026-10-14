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
import { splitFloat64Array } from "./fp64.js";
import { buildUniformGridMesh } from "./globe-grid-mesh.js";
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
      props.initialTriangulation !== oldProps.initialTriangulation;

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
    //
    // For tiles that straddle the CRS domain boundary (e.g. a Mollweide tile
    // with one corner outside the ellipse), the adaptive reprojector wastes its
    // entire iteration budget refining OOD-vertex triangles, leaving the valid
    // area under-refined (reprojection error 100s of pixels). Detect these
    // "border tiles" up front and use a dense uniform grid instead: OOD-vertex
    // triangles are simply filtered out, producing a clean domain-edge cutoff
    // at predictable 1/(BORDER_GRID_SIZE) tile-fraction resolution.
    const { forwardTransform, forwardReproject, inverseReproject } =
      reprojectionFns;
    const borderCorners: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    // Tile width in projected CRS units for the round-trip error threshold.
    const tileWidthCRS = Math.abs(
      forwardTransform(width, 0)[0] - forwardTransform(0, 0)[0],
    );
    const roundTripThreshold = tileWidthCRS * 0.01;
    const isBorderTile = borderCorners.some(([u, v]) => {
      const [ix, iy] = forwardTransform(u * width, v * height);
      const [ox, oy] = forwardReproject(ix, iy);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
        return true;
      }
      // Round-trip check: OOD corners where forwardReproject clamps to a
      // finite domain-boundary position instead of returning NaN. The clamped
      // value re-projects back to a CRS position far from the original,
      // revealing the OOD via large round-trip error.
      if (inverseReproject && roundTripThreshold > 0) {
        const [ix2, iy2] = inverseReproject(ox, oy);
        if (!Number.isFinite(ix2) || !Number.isFinite(iy2)) {
          return true;
        }
        const err = Math.sqrt(
          (ix2 - ix) * (ix2 - ix) + (iy2 - iy) * (iy2 - iy),
        );
        if (err > roundTripThreshold) {
          return true;
        }
      }
      return false;
    });
    if (isBorderTile) {
      const { indices, positions64High, positions64Low, texCoords } =
        buildClippedGridMesh(reprojectionFns, width + 1, height + 1);
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

    const reprojector = new RasterReprojector(
      reprojectionFns,
      width + 1,
      height + 1,
      { initialTriangulation },
    );
    reprojector.run(maxError);
    const { indices, positions64High, positions64Low, texCoords } =
      reprojectorToMesh(reprojector);

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

function reprojectorToMesh(reprojector: RasterReprojector): {
  indices: Uint32Array;
  positions64High: Float32Array;
  positions64Low: Float32Array;
  texCoords: Float32Array;
} {
  const numVertices = reprojector.uvs.length / 2;
  const texCoords = new Float32Array(reprojector.uvs);

  const positions = new Float64Array(numVertices * 3);
  // Track which vertices are outside the CRS domain (NaN output position).
  const isOOD = new Uint8Array(numVertices);
  for (let i = 0; i < numVertices; i++) {
    const x = reprojector.exactOutputPositions[i * 2]!;
    const y = reprojector.exactOutputPositions[i * 2 + 1]!;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    // z (flat on the ground)
    positions[i * 3 + 2] = 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      isOOD[i] = 1;
    }
  }

  // Filter out any triangle that contains an out-of-domain vertex. This
  // clips the rendered mesh cleanly at the CRS boundary without relying on
  // undefined GPU NaN behaviour.
  const allTriangles = reprojector.triangles;
  const filteredTriangles: number[] = [];
  for (let t = 0; t * 3 < allTriangles.length; t++) {
    const a = allTriangles[t * 3]!;
    const b = allTriangles[t * 3 + 1]!;
    const c = allTriangles[t * 3 + 2]!;
    if (!isOOD[a] && !isOOD[b] && !isOOD[c]) {
      filteredTriangles.push(a, b, c);
    }
  }

  // Split the float64 positions into high and low parts for fp64 emulation in
  // the shader.
  const [positions64Low, positions64High] = splitFloat64Array(positions);
  const indices = new Uint32Array(filteredTriangles);

  return {
    indices,
    positions64High,
    positions64Low,
    texCoords,
  };
}

/**
 * Build a dense uniform grid mesh over a tile, filtering out any triangle
 * that contains a vertex whose output position is outside the CRS domain
 * (i.e. forwardReproject returned NaN or fails the round-trip check). Used
 * for "border tiles" where the CRS boundary passes through the tile; the
 * adaptive reprojector handles these poorly because OOD-vertex triangles
 * consume its entire iteration budget and leave the valid area under-refined.
 */
const BORDER_GRID_SIZE = 64;

function buildClippedGridMesh(
  reprojectionFns: ReprojectionFns,
  width: number,
  height: number,
  gridSize = BORDER_GRID_SIZE,
): {
  indices: Uint32Array;
  positions64High: Float32Array;
  positions64Low: Float32Array;
  texCoords: Float32Array;
} {
  const { forwardTransform, forwardReproject, inverseReproject } =
    reprojectionFns;
  const cols = gridSize;
  const rows = gridSize;
  const numVerts = (cols + 1) * (rows + 1);

  const positions = new Float64Array(numVerts * 3);
  const texCoords = new Float32Array(numVerts * 2);
  const isOOD = new Uint8Array(numVerts);

  // Tile CRS width for round-trip error threshold (same logic as isBorderTile).
  const tileWidthCRS = Math.abs(
    forwardTransform(width - 1, 0)[0] - forwardTransform(0, 0)[0],
  );
  const roundTripThreshold = tileWidthCRS * 0.01;

  let vi = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const v = r / rows;
      const pixelX = u * (width - 1);
      const pixelY = v * (height - 1);
      const [ix, iy] = forwardTransform(pixelX, pixelY);
      const [ox, oy] = forwardReproject(ix, iy);
      positions[vi * 3] = ox;
      positions[vi * 3 + 1] = oy;
      positions[vi * 3 + 2] = 0;
      texCoords[vi * 2] = u;
      texCoords[vi * 2 + 1] = v;
      let ood = !Number.isFinite(ox) || !Number.isFinite(oy);
      if (!ood && inverseReproject && roundTripThreshold > 0) {
        const [ix2, iy2] = inverseReproject(ox, oy);
        if (!Number.isFinite(ix2) || !Number.isFinite(iy2)) {
          ood = true;
        } else {
          const err = Math.sqrt(
            (ix2 - ix) * (ix2 - ix) + (iy2 - iy) * (iy2 - iy),
          );
          if (err > roundTripThreshold) {
            ood = true;
          }
        }
      }
      if (ood) {
        isOOD[vi] = 1;
      }
      vi++;
    }
  }

  const filteredIndices: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c;
      const i1 = i0 + 1;
      const i2 = i0 + (cols + 1);
      const i3 = i2 + 1;
      if (!isOOD[i0] && !isOOD[i2] && !isOOD[i1]) {
        filteredIndices.push(i0, i2, i1);
      }
      if (!isOOD[i1] && !isOOD[i2] && !isOOD[i3]) {
        filteredIndices.push(i1, i2, i3);
      }
    }
  }

  const [positions64Low, positions64High] = splitFloat64Array(positions);
  const indices = new Uint32Array(filteredIndices);
  return { indices, positions64High, positions64Low, texCoords };
}
