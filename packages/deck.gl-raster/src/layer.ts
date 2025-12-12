import type { CompositeLayerProps } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type { SimpleMeshLayerProps } from "@deck.gl/mesh-layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";

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
   * Maximum reprojection error in pixels for mesh refinement.
   * Lower values create denser meshes with higher accuracy.
   * @default 1
   */
  maxError?: number;

  /**
   * Material properties for lighting effects
   */
  material?: SimpleMeshLayerProps["material"];

  /**
   * Whether to render in wireframe mode (for debugging)
   * @default false
   */
  wireframe?: boolean;
}

const defaultProps = {
  maxError: 1,
  wireframe: false,
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
    this.setState({
      reprojector: undefined,
      mesh: undefined,
    });
  }

  override updateState({
    props,
    oldProps,
    changeFlags,
  }: {
    props: RasterLayerProps;
    oldProps: RasterLayerProps;
    changeFlags: any;
  }): void {
    // Regenerate mesh if key properties change
    const needsUpdate =
      changeFlags.dataChanged ||
      props.width !== oldProps.width ||
      props.height !== oldProps.height ||
      props.reprojectionFns !== oldProps.reprojectionFns ||
      props.maxError !== oldProps.maxError;

    if (needsUpdate) {
      this._generateMesh();
    }
  }

  _generateMesh(): void {
    const { width, height, reprojectionFns, maxError = 1 } = this.props;

    // Create reprojector instance
    const reprojector = new RasterReprojector(reprojectionFns, width, height);

    // Refine mesh to desired error threshold
    reprojector.run(maxError);

    // Extract mesh data
    const numVertices = reprojector.uvs.length / 2;
    const positions = new Float32Array(numVertices * 3);
    const texCoords = new Float32Array(numVertices * 2);

    // Convert UV coordinates and exact output positions to mesh format
    for (let i = 0; i < numVertices; i++) {
      const uvIdx = i * 2;
      const posIdx = i * 3;

      // Use exact output positions (already in output CRS)
      positions[posIdx] = reprojector.exactOutputPositions[uvIdx]!; // x
      positions[posIdx + 1] = reprojector.exactOutputPositions[uvIdx + 1]!; // y
      positions[posIdx + 2] = 0; // z (flat on the ground)

      // Texture coordinates (UV)
      texCoords[uvIdx] = reprojector.uvs[uvIdx]!; // u
      texCoords[uvIdx + 1] = reprojector.uvs[uvIdx + 1]!; // v
    }

    // Triangle indices are already in the correct format
    const indices = new Uint32Array(reprojector.triangles);

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
    const { texture, material, wireframe } = this.props;

    if (!mesh) {
      return null;
    }

    return new SimpleMeshLayer(
      this.getSubLayerProps({
        id: "mesh",
        data: [{ position: [0, 0, 0] }], // Single instance at origin since mesh positions are already in world coordinates
        mesh: {
          positions: { value: mesh.positions, size: 3 },
          texCoords: { value: mesh.texCoords, size: 2 },
          indices: { value: mesh.indices, size: 1 },
        },
        texture,
        material,
        wireframe,
        getPosition: (d: { position: number[] }) => d.position,
      }),
    );
  }
}
