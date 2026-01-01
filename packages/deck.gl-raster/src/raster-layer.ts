import type {
  CompositeLayerProps,
  Layer,
  UpdateParameters,
} from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { PolygonLayer } from "@deck.gl/layers";
import type { SimpleMeshLayerProps } from "@deck.gl/mesh-layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";
import { MeshTextureLayer, MeshTextureLayerProps } from "./mesh-layer";

const DEFAULT_MAX_ERROR = 0.125;

const DEBUG_COLORS = [
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

type ParsedTriangle = { idx: number; geom: number[][] };

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
   * Texture to apply to the mesh. Can be:
   * - URL or Data URL string
   * - WebGL2-compatible pixel source (Image, ImageData, Canvas, etc.)
   * - Luma.gl Texture instance
   * - Plain object: {width, height, data}
   */
  texture?: SimpleMeshLayerProps["texture"];

  /**
   * Optional shader injection.
   */
  shaders?: MeshTextureLayerProps["shaders"];

  /**
   * Maximum reprojection error in pixels for mesh refinement.
   * Lower values create denser meshes with higher accuracy.
   * @default 0.125
   */
  maxError?: number;

  debug?: boolean;

  debugOpacity?: number;
}

const defaultProps = {
  maxError: DEFAULT_MAX_ERROR,
  debug: false,
};

/**
 * RasterLayer renders georeferenced raster data with client-side reprojection.
 *
 * This is a composite layer that uses raster-reproject to generate an adaptive mesh
 * that accurately represents the reprojected raster, then renders it using SimpleMeshLayer.
 */
export class RasterLayer extends CompositeLayer<RasterLayerProps> {
  static override layerName = "RasterLayer";
  static override defaultProps = defaultProps;

  declare state: {
    reprojector?: RasterReprojector;
    mesh?: {
      positions: Float32Array;
      indices: Uint32Array;
      texCoords: Float32Array;
    };
    debugTriangles?: ParsedTriangle[];
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps, changeFlags } = params;

    // Regenerate mesh if key properties change
    const needsMeshUpdate =
      Boolean(changeFlags.dataChanged) ||
      props.width !== oldProps.width ||
      props.height !== oldProps.height ||
      props.reprojectionFns !== oldProps.reprojectionFns ||
      props.maxError !== oldProps.maxError;

    if (needsMeshUpdate) {
      this._generateMesh();
    } else if (props.debug && !oldProps.debug) {
      // Even if the mesh wasn't changed, we may need to recreate debug
      // triangles if debug was just enabled
      this._createDebugTriangles();
    }
  }

  _generateMesh(): void {
    const {
      width,
      height,
      reprojectionFns,
      maxError = DEFAULT_MAX_ERROR,
      debug = false,
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
    const { indices, positions, texCoords } = reprojectorToMesh(reprojector);

    let debugTriangles: ParsedTriangle[] | undefined = undefined;
    if (debug) {
      debugTriangles = reprojectorToTriangles(reprojector);
    }

    this.setState({
      reprojector,
      mesh: {
        positions,
        indices,
        texCoords,
      },
      debugTriangles,
    });
  }

  _createDebugTriangles(): void {
    const { reprojector } = this.state;
    if (!reprojector) {
      return;
    }

    const debugTriangles = reprojectorToTriangles(reprojector);
    this.setState({
      debugTriangles,
    });
  }

  renderLayers() {
    const { mesh } = this.state;
    const { texture, debug, shaders } = this.props;

    if (!mesh) {
      return null;
    }

    const { indices, positions, texCoords } = mesh;

    const layers: Layer[] = [
      new MeshTextureLayer(
        this.getSubLayerProps({
          id: "raster",
          texture,
          shaders,
          // Dummy data because we're only rendering _one_ instance of this mesh
          // https://github.com/visgl/deck.gl/blob/93111b667b919148da06ff1918410cf66381904f/modules/geo-layers/src/terrain-layer/terrain-layer.ts#L241
          data: [1],
          mesh: {
            indices: { value: indices, size: 1 },
            attributes: {
              POSITION: {
                value: positions,
                size: 3,
              },
              TEXCOORD_0: {
                value: texCoords,
                size: 2,
              },
            },
          },
          // We're only rendering a single mesh, without instancing
          // https://github.com/visgl/deck.gl/blob/93111b667b919148da06ff1918410cf66381904f/modules/geo-layers/src/terrain-layer/terrain-layer.ts#L244
          _instanced: false,
          // Dummy accessors for the dummy data
          // We place our mesh at the coordinate origin
          getPosition: [0, 0, 0],
          // We give a white color to turn off color mixing with the texture
          getColor: [255, 255, 255],
        }),
      ),
    ];
    if (debug) {
      const { debugTriangles } = this.state;
      const { debugOpacity } = this.props;
      if (debugTriangles) {
        const debugLayer = new PolygonLayer(
          this.getSubLayerProps({
            id: "polygon",
            data: debugTriangles,
            getPolygon: (d: ParsedTriangle) => d.geom,
            getFillColor: (d: ParsedTriangle) =>
              DEBUG_COLORS[d.idx % DEBUG_COLORS.length],
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
        layers.push(debugLayer);
      }
    }

    return layers;
  }
}

function reprojectorToMesh(reprojector: RasterReprojector): {
  indices: Uint32Array;
  positions: Float32Array;
  texCoords: Float32Array;
} {
  const numVertices = reprojector.uvs.length / 2;
  const positions = new Float32Array(numVertices * 3);
  const texCoords = new Float32Array(reprojector.uvs);

  for (let i = 0; i < numVertices; i++) {
    positions[i * 3] = reprojector.exactOutputPositions[i * 2]!;
    positions[i * 3 + 1] = reprojector.exactOutputPositions[i * 2 + 1]!;
    // z (flat on the ground)
    positions[i * 3 + 2] = 0;
  }

  // TODO: Consider using 16-bit indices if the mesh is small enough
  const indices = new Uint32Array(reprojector.triangles);

  return {
    indices,
    positions,
    texCoords,
  };
}

function reprojectorToTriangles(
  reprojector: RasterReprojector,
): ParsedTriangle[] {
  const positions = reprojector.exactOutputPositions;
  const triangles = reprojector.triangles;

  const trianglePolygons: ParsedTriangle[] = [];
  for (let triangleIdx = 0; triangleIdx < triangles.length / 3; ++triangleIdx) {
    const a = triangles[triangleIdx * 3]!;
    const b = triangles[triangleIdx * 3 + 1]!;
    const c = triangles[triangleIdx * 3 + 2]!;

    const coords = [
      [positions[a * 2]!, positions[a * 2 + 1]!],
      [positions[b * 2]!, positions[b * 2 + 1]!],
      [positions[c * 2]!, positions[c * 2 + 1]!],
      [positions[a * 2]!, positions[a * 2 + 1]!],
    ];

    trianglePolygons.push({
      idx: triangleIdx,
      geom: coords,
    });
  }

  return trianglePolygons;
}
