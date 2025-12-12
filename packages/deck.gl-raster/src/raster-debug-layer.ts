import type { CompositeLayerProps, UpdateParameters } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type { PolygonLayerProps } from "@deck.gl/layers";
import { PolygonLayer } from "@deck.gl/layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { RasterReprojector } from "@developmentseed/raster-reproject";

const DEFAULT_MAX_ERROR = 0.125;

type ParsedTriangle = { idx: number; geom: number[][] };

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

export interface RasterDebugLayerProps
  extends
    Omit<CompositeLayerProps, "data">,
    Pick<
      PolygonLayerProps,
      | "getFillColor"
      | "getLineColor"
      | "lineWidthMinPixels"
      | "filled"
      | "stroked"
      | "opacity"
    > {
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
   * Maximum reprojection error in pixels for mesh refinement.
   * Lower values create denser meshes with higher accuracy.
   * @default 0.125
   */
  maxError?: number;
}

const defaultProps = {
  maxError: DEFAULT_MAX_ERROR,
  debugMesh: false,
};

/**
 * RasterDebugLayer renders a PolygonLayer of the triangles that make up a
 * generated mesh for raster reprojection.
 */
export class RasterDebugLayer extends CompositeLayer<RasterDebugLayerProps> {
  static override layerName = "RasterDebugLayer";
  static override defaultProps = defaultProps;

  declare state: {
    reprojector?: RasterReprojector;
    triangles?: ParsedTriangle[];
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps } = params;

    // Regenerate mesh if key properties change
    const needsUpdate =
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
    const triangles = reprojectorToTriangles(reprojector);

    this.setState({
      reprojector,
      triangles,
    });
  }

  renderLayers() {
    const { triangles } = this.state;

    if (!triangles) {
      return null;
    }

    return new PolygonLayer(
      this.getSubLayerProps({
        id: "polygon",
        data: triangles,
        getPolygon: (d: ParsedTriangle) => d.geom,
        getFillColor: (d: ParsedTriangle) =>
          DEBUG_COLORS[d.idx % DEBUG_COLORS.length],
        getLineColor: [0, 0, 0],
        getLineWidth: 0,
        lineWidthMinPixels: 1,
      }),
    );
  }
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
