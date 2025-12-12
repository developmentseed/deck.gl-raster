import type { CompositeLayerProps, UpdateParameters } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type { SimpleMeshLayerProps } from "@deck.gl/mesh-layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";

const DEFAULT_MAX_ERROR = 0.125;

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
   * Customize the [texture parameters](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texParameter).
   */
  textureParameters?: SimpleMeshLayerProps["textureParameters"];

  /**
   * Maximum reprojection error in pixels for mesh refinement.
   * Lower values create denser meshes with higher accuracy.
   * @default 0.125
   */
  maxError?: number;

  // /**
  //  * Whether to render in wireframe mode (for debugging)
  //  * @default false
  //  */
  // debugMesh?: boolean;
}

const defaultProps = {
  maxError: DEFAULT_MAX_ERROR,
  debugMesh: false,
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
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps, changeFlags } = params;

    // Regenerate mesh if key properties change
    const needsUpdate =
      Boolean(changeFlags.dataChanged) ||
      props.width !== oldProps.width ||
      props.height !== oldProps.height ||
      props.reprojectionFns !== oldProps.reprojectionFns ||
      props.maxError !== oldProps.maxError;

    if (needsUpdate) {
      this._generateMesh();
    }
  }

  _generateMesh(): void {
    const {
      width,
      height,
      reprojectionFns,
      maxError = DEFAULT_MAX_ERROR,
    } = this.props;

    const reprojector = new RasterReprojector(reprojectionFns, width, height);
    reprojector.run(maxError);
    const { indices, positions, texCoords } = reprojectorToMesh(reprojector);

    this.setState({
      reprojector,
      mesh: {
        positions,
        indices,
        texCoords,
      },
    });
  }

  renderLayers() {
    const { mesh } = this.state;
    const { texture } = this.props;

    if (!mesh) {
      return null;
    }

    const { indices, positions, texCoords } = mesh;

    return new SimpleMeshLayer(
      this.getSubLayerProps({
        id: "mesh",
        texture,
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
    );
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
