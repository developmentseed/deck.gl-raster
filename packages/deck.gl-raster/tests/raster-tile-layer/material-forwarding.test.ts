import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/raster-layer.js", () => ({
  RasterLayer: class CapturingRasterLayer {
    public props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
}));

const { RasterTileLayer } = await import(
  "../../src/raster-tile-layer/raster-tile-layer.js"
);

const identity = (x: number, y: number): [number, number] => [x, y];

/**
 * Drive `_renderSubLayers` directly (non-globe path), bypassing deck.gl's
 * LayerManager: stub the viewport context, short-circuit `getSubLayerProps`,
 * and hand it a minimal tile + descriptor. The mocked RasterLayer captures
 * the props it would have been constructed with.
 */
function renderRasterSubLayer(layerProps: Record<string, unknown> = {}) {
  const layer = new RasterTileLayer({ id: "test", ...layerProps });
  Object.assign(layer as object, {
    context: { viewport: { resolution: undefined } },
    getSubLayerProps: <T>(props: T) => props,
  });

  const tile = {
    index: { x: 0, y: 0, z: 0 },
    forwardTransform: identity,
    inverseTransform: identity,
    _projectPosition: identity,
    _unprojectPosition: identity,
    _webMercatorInitialTriangulation: undefined,
  };
  const subLayerInput = {
    id: "tile-0-0-0",
    data: { width: 4, height: 4 },
    _offset: 0,
    tile,
  };
  const descriptor = {
    projectTo4326: identity,
    projectFrom4326: identity,
  };
  const renderTile = () => ({ image: {} });

  const [rasterLayer] = (
    layer as unknown as {
      _renderSubLayers: (
        props: unknown,
        descriptor: unknown,
        renderTile: unknown,
      ) => { props: Record<string, unknown> }[];
    }
  )._renderSubLayers(subLayerInput, descriptor, renderTile);
  return rasterLayer!;
}

describe("RasterTileLayer material forwarding", () => {
  it("forwards material: false to RasterLayer", () => {
    const rasterLayer = renderRasterSubLayer({ material: false });
    expect(rasterLayer.props.material).toBe(false);
  });

  it("forwards a material object to RasterLayer by reference", () => {
    const material = {
      ambient: 0.8,
      diffuse: 0.2,
      shininess: 1,
      specularColor: [0, 0, 0] as [number, number, number],
    };
    const rasterLayer = renderRasterSubLayer({ material });
    expect(rasterLayer.props.material).toBe(material);
  });

  it("omits the material key when the prop is unset", () => {
    const rasterLayer = renderRasterSubLayer();
    // The key must be absent (not `undefined`): an explicit own-property would
    // shadow the sublayer's prototype-chained default material.
    expect("material" in rasterLayer.props).toBe(false);
  });
});
