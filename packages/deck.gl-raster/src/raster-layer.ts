import type {
  CompositeLayerProps,
  Layer,
  UpdateParameters,
} from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import { PolygonLayer } from "@deck.gl/layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";
import { CreateTexture } from "./gpu-modules/create-texture";
import { latToMercatorNorm, Reproject4326 } from "./gpu-modules/reproject-4326";
import type { RasterModule } from "./gpu-modules/types";
import { MeshTextureLayer } from "./mesh-layer/mesh-layer";

/**
 * Default number of subdivisions for reprojection quad mesh.
 * Higher values provide better accuracy at high latitudes.
 */
const DEFAULT_SUBDIVISIONS = 16;

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
 * Source CRS type for shader-based reprojection bypass.
 * When set to 'EPSG:4326' or 'EPSG:3857', mesh refinement is bypassed
 * and fragment shader reprojection is used instead.
 */
export type SourceCrs = "EPSG:4326" | "EPSG:3857" | null;

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
   * Reprojection functions for converting between pixel, input CRS, and output CRS coordinates.
   * Not required when sourceCrs is 'EPSG:4326' or 'EPSG:3857' (shader reprojection bypass).
   */
  reprojectionFns?: ReprojectionFns;

  /**
   * Render pipeline for visualizing textures.
   *
   * Can be:
   *
   * - ImageData representing RGBA pixel data
   * - Sequence of shader modules to be composed into a shader program
   */
  renderPipeline: ImageData | RasterModule[];

  /**
   * Maximum reprojection error in pixels for mesh refinement.
   * Lower values create denser meshes with higher accuracy.
   * Only used when sourceCrs is not set (full mesh refinement mode).
   * @default 0.125
   */
  maxError?: number;

  /**
   * Source CRS for shader-based reprojection bypass.
   * When set to 'EPSG:4326', uses fragment shader reprojection.
   * When set to 'EPSG:3857', uses a simple quad (texture is already in Web Mercator).
   * When null/undefined, uses full mesh refinement with reprojectionFns.
   */
  sourceCrs?: SourceCrs;

  /**
   * Latitude bounds [min, max] in degrees for shader reprojection.
   * Required when sourceCrs is 'EPSG:4326'.
   */
  latBounds?: [number, number];

  /**
   * Geographic bounds in WGS84 for positioning the mesh.
   * Required when sourceCrs is 'EPSG:4326' or 'EPSG:3857'.
   */
  bounds?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };

  /**
   * Whether row 0 of the texture is south (true) or north (false).
   * Used for shader reprojection when sourceCrs is 'EPSG:4326'.
   * @default false
   */
  latIsAscending?: boolean;

  debug?: boolean;

  debugOpacity?: number;
}

const defaultProps = {
  debug: false,
  debugOpacity: 0.5,
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
    /** Whether shader-based reprojection is being used (bypassing mesh refinement) */
    useReproject4326?: boolean;
    /** Props for reprojection shader module */
    reproject4326Props?: {
      latBounds: [number, number];
      mercatorYBounds: [number, number];
      latIsAscending: boolean;
    };
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
      props.maxError !== oldProps.maxError ||
      props.sourceCrs !== oldProps.sourceCrs ||
      props.latBounds !== oldProps.latBounds ||
      props.bounds !== oldProps.bounds ||
      props.latIsAscending !== oldProps.latIsAscending;

    if (needsMeshUpdate) {
      this._generateMesh();
    }
  }

  _generateMesh(): void {
    const {
      width,
      height,
      reprojectionFns,
      maxError = DEFAULT_MAX_ERROR,
      sourceCrs,
      latBounds,
      bounds,
      latIsAscending = false,
    } = this.props;

    // Fast path for EPSG:4326 and EPSG:3857 source data - no mesh refinement needed
    if (sourceCrs === "EPSG:4326" || sourceCrs === "EPSG:3857") {
      if (!bounds) {
        throw new Error(
          `bounds prop is required when sourceCrs is '${sourceCrs}'`,
        );
      }

      if (sourceCrs === "EPSG:4326") {
        // EPSG:4326: Need subdivided mesh + shader reprojection to handle
        // the non-linear relationship between latitude and Mercator Y
        const mesh = generateSubdividedQuadMesh(
          DEFAULT_SUBDIVISIONS,
          bounds,
          latIsAscending,
        );

        const effectiveLatBounds = latBounds ?? [bounds.south, bounds.north];
        const reproject4326Props = {
          latBounds: effectiveLatBounds,
          mercatorYBounds: [
            latToMercatorNorm(effectiveLatBounds[1]), // north
            latToMercatorNorm(effectiveLatBounds[0]), // south
          ],
          latIsAscending,
        };

        this.setState({
          reprojector: undefined,
          mesh,
          useReproject4326: true,
          reproject4326Props,
        });
      } else {
        // EPSG:3857: Simple quad with no reprojection needed.
        // The texture is already in Mercator space, and deck.gl displays in Mercator,
        // so the non-linear projection deck.gl applies to WGS84 vertices matches
        // the Mercator texture layout exactly.
        const mesh = generateSimpleQuadMesh(bounds, latIsAscending);

        this.setState({
          reprojector: undefined,
          mesh,
          useReproject4326: false,
          reproject4326Props: undefined,
        });
      }
      return;
    }

    // Full mesh refinement for other CRS
    if (!reprojectionFns) {
      throw new Error(
        "reprojectionFns prop is required when sourceCrs is not set",
      );
    }

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

    // Mesh positions are already in WGS84 since we target EPSG:4326
    const { indices, positions, texCoords } = reprojectorToMesh(reprojector);

    this.setState({
      reprojector,
      mesh: {
        positions,
        indices,
        texCoords,
      },
      useReproject4326: false,
      reproject4326Props: undefined,
    });
  }

  renderDebugLayer(): Layer | null {
    const { reprojector, mesh, useReproject4326 } = this.state;
    const { debugOpacity } = this.props;

    // For GPU reprojection mode, render debug using the mesh triangles
    if (useReproject4326 && mesh) {
      const numTriangles = mesh.indices.length / 3;
      return new PolygonLayer(
        this.getSubLayerProps({
          id: "polygon",
          data: { length: numTriangles },
          getPolygon: (_: unknown, { index }: { index: number }) => {
            const { positions, indices } = mesh;
            const a = indices[index * 3]!;
            const b = indices[index * 3 + 1]!;
            const c = indices[index * 3 + 2]!;

            // Positions are already in WGS84
            const pa: [number, number] = [
              positions[a * 3]!,
              positions[a * 3 + 1]!,
            ];
            const pb: [number, number] = [
              positions[b * 3]!,
              positions[b * 3 + 1]!,
            ];
            const pc: [number, number] = [
              positions[c * 3]!,
              positions[c * 3 + 1]!,
            ];

            return [pa, pb, pc, pa];
          },
          getFillColor: (
            _: unknown,
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

    // Full mesh refinement mode
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
          _: unknown,
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

          // Positions are already in WGS84 (we target EPSG:4326)
          const pa: [number, number] = [
            positions[a * 2]!,
            positions[a * 2 + 1]!,
          ];
          const pb: [number, number] = [
            positions[b * 2]!,
            positions[b * 2 + 1]!,
          ];
          const pc: [number, number] = [
            positions[c * 2]!,
            positions[c * 2 + 1]!,
          ];

          return [pa, pb, pc, pa];
        },
        getFillColor: (
          _: unknown,
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

  /** Create assembled render pipeline from the renderPipeline prop input. */
  _createRenderPipeline(): RasterModule[] {
    const { useReproject4326, reproject4326Props } = this.state;
    const modules: RasterModule[] = [];

    // Add reprojection module FIRST if needed (before texture sampling)
    if (useReproject4326 && reproject4326Props) {
      modules.push({
        module: Reproject4326,
        props: reproject4326Props,
      });
    }

    // Add texture/render pipeline modules
    if (this.props.renderPipeline instanceof ImageData) {
      const imageData = this.props.renderPipeline;
      const texture = this.context.device.createTexture({
        format: "rgba8unorm",
        width: imageData.width,
        height: imageData.height,
        data: imageData.data,
      });
      modules.push({
        module: CreateTexture,
        props: {
          textureName: texture,
        },
      });
    } else {
      modules.push(...this.props.renderPipeline);
    }

    return modules;
  }

  renderLayers() {
    const { mesh } = this.state;
    const { debug } = this.props;

    if (!mesh) {
      return null;
    }

    const { indices, positions, texCoords } = mesh;

    const meshLayer = new MeshTextureLayer(
      this.getSubLayerProps({
        id: "raster",
        renderPipeline: this._createRenderPipeline(),
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

/**
 * Convert RasterReprojector output to mesh data for deck.gl.
 *
 * Positions are in WGS84 (EPSG:4326) since we target that CRS for reprojection.
 *
 * @param reprojector The RasterReprojector with computed mesh
 */
function reprojectorToMesh(reprojector: RasterReprojector): {
  indices: Uint32Array;
  positions: Float32Array;
  texCoords: Float32Array;
} {
  const numVertices = reprojector.uvs.length / 2;
  const positions = new Float32Array(numVertices * 3);
  const texCoords = new Float32Array(reprojector.uvs);

  for (let i = 0; i < numVertices; i++) {
    // Positions are already in WGS84 (we target EPSG:4326)
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

/**
 * Generate a simple 4-vertex quad mesh for EPSG:3857 source data.
 *
 * For Web Mercator textures displayed on a Web Mercator map (deck.gl's default
 * WebMercatorViewport), no reprojection is needed. GPU rasterization interpolates
 * UVs in screen space, which is Mercator space after projection, so sampling is
 * linear in Mercator Y - matching the Mercator texture layout.
 *
 * Note: This assumes WebMercatorViewport. Non-Mercator viewports (GlobeView,
 * OrthographicView) would require different handling.
 *
 * @param bounds Geographic bounds in WGS84
 * @param latIsAscending Whether texture row 0 is south (affects UV mapping)
 */
function generateSimpleQuadMesh(
  bounds: { west: number; south: number; east: number; north: number },
  latIsAscending: boolean,
): {
  positions: Float32Array;
  indices: Uint32Array;
  texCoords: Float32Array;
} {
  const { west, south, east, north } = bounds;

  // 4 vertices: NW, NE, SW, SE
  const positions = new Float32Array([
    west,
    north,
    0, // 0: NW
    east,
    north,
    0, // 1: NE
    west,
    south,
    0, // 2: SW
    east,
    south,
    0, // 3: SE
  ]);

  // UV coordinates depend on texture orientation
  // For latIsAscending=false (row 0 = north): NW=(0,0), NE=(1,0), SW=(0,1), SE=(1,1)
  // For latIsAscending=true (row 0 = south): NW=(0,1), NE=(1,1), SW=(0,0), SE=(1,0)
  const texCoords = latIsAscending
    ? new Float32Array([
        0,
        1, // NW
        1,
        1, // NE
        0,
        0, // SW
        1,
        0, // SE
      ])
    : new Float32Array([
        0,
        0, // NW
        1,
        0, // NE
        0,
        1, // SW
        1,
        1, // SE
      ]);

  // Two triangles: NW-SW-NE and NE-SW-SE
  const indices = new Uint32Array([
    0,
    2,
    1, // NW, SW, NE
    1,
    2,
    3, // NE, SW, SE
  ]);

  return {
    positions,
    indices,
    texCoords,
  };
}

/**
 * Generate a subdivided quad mesh for shader-based reprojection.
 *
 * The mesh is positioned in WGS84 coordinates (deck.gl's native coordinate system).
 * Subdivisions provide enough vertex density for smooth interpolation across
 * the non-linear Mercator projection, especially at high latitudes.
 *
 * @param subdivisions Number of subdivisions along each axis
 * @param bounds Geographic bounds in WGS84
 * @param latIsAscending Whether texture row 0 is south (affects UV mapping)
 */
function generateSubdividedQuadMesh(
  subdivisions: number,
  bounds: { west: number; south: number; east: number; north: number },
  latIsAscending: boolean,
): {
  positions: Float32Array;
  indices: Uint32Array;
  texCoords: Float32Array;
} {
  const { west, south, east, north } = bounds;
  const numVerticesPerSide = subdivisions + 1;
  const numVertices = numVerticesPerSide * numVerticesPerSide;
  const numTriangles = subdivisions * subdivisions * 2;

  const positions = new Float32Array(numVertices * 3);
  const texCoords = new Float32Array(numVertices * 2);
  const indices = new Uint32Array(numTriangles * 3);

  // Generate vertices in a grid
  let vertexIndex = 0;
  for (let row = 0; row <= subdivisions; row++) {
    for (let col = 0; col <= subdivisions; col++) {
      // Interpolate position in WGS84
      const u = col / subdivisions;
      const v = row / subdivisions;

      const lon = west + u * (east - west);
      // v=0 is top of mesh (north), v=1 is bottom (south)
      const lat = north - v * (north - south);

      positions[vertexIndex * 3] = lon;
      positions[vertexIndex * 3 + 1] = lat;
      positions[vertexIndex * 3 + 2] = 0;

      // UV coordinates
      // u maps directly to texture U
      // v needs to account for texture orientation (latIsAscending)
      texCoords[vertexIndex * 2] = u;
      if (latIsAscending) {
        // Row 0 = south, so flip V: top of mesh (north, v=0) -> texV=1
        texCoords[vertexIndex * 2 + 1] = 1 - v;
      } else {
        // Row 0 = north, so V maps directly
        texCoords[vertexIndex * 2 + 1] = v;
      }

      vertexIndex++;
    }
  }

  // Generate triangle indices
  let indexOffset = 0;
  for (let row = 0; row < subdivisions; row++) {
    for (let col = 0; col < subdivisions; col++) {
      const topLeft = row * numVerticesPerSide + col;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + numVerticesPerSide;
      const bottomRight = bottomLeft + 1;

      // First triangle (top-left, bottom-left, top-right)
      indices[indexOffset++] = topLeft;
      indices[indexOffset++] = bottomLeft;
      indices[indexOffset++] = topRight;

      // Second triangle (top-right, bottom-left, bottom-right)
      indices[indexOffset++] = topRight;
      indices[indexOffset++] = bottomLeft;
      indices[indexOffset++] = bottomRight;
    }
  }

  return {
    positions,
    indices,
    texCoords,
  };
}
