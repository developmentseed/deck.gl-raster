import { LinearInterpolator } from "@deck.gl/core";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import {
  CustomProjectionController,
  CustomProjectionView,
  NORMALIZATION_SCALE,
} from "../src/custom-projection/index.js";

const ARCTIC =
  "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";

function setup() {
  const view = new CustomProjectionView({
    id: "map",
    projection: proj4("EPSG:4326", ARCTIC),
    fromCrs: "EPSG:4326",
    toCrs: ARCTIC,
    fromBounds: [-180, 0, 180, 90],
    controller: true,
  });
  const emitted: Record<string, any>[] = [];
  const controller = new CustomProjectionController({
    // A transition only registers a channel; nothing advances it here.
    timeline: {
      addChannel: () => 1,
      removeChannel: () => {},
      getTime: () => 0,
      isFinished: () => false,
    } as never,
    // Only used to subscribe to input events.
    eventManager: null as never,
    makeViewport: (viewState) =>
      view.makeViewport({
        width: 800,
        height: 600,
        viewState: viewState as never,
      })!,
    onViewStateChange: ({ viewState }) => emitted.push(viewState),
    onStateChange: () => {},
  });
  return { controller, emitted };
}

describe("CustomProjectionController", () => {
  it("accepts an upstream-style {center, zoom} view state", () => {
    const { controller } = setup();
    controller.setProps({
      id: "map",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      center: [-45, 75, 0],
      zoom: 3,
    });
    const [x, y] = proj4("EPSG:4326", ARCTIC).forward([-45, 75]);
    const { target } = controller.controllerState.getViewportProps();
    expect(target[0]).toBeCloseTo(x!, 6);
    expect(target[1]).toBeCloseTo(y!, 6);
  });

  it("emits center and zoom, without the orthographic zoomX/zoomY", () => {
    const { controller, emitted } = setup();
    controller.setProps({
      id: "map",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      center: [-45, 75, 0],
      zoom: 3,
    });
    // @ts-expect-error updateViewport is protected; drive it like an event handler would
    controller.updateViewport(controller.controllerState.zoomIn());
    const viewState = emitted[emitted.length - 1]!;
    expect(viewState.zoom).toBeCloseTo(4, 9);
    expect(viewState.center[0]).toBeCloseTo(-45, 6);
    expect(viewState.center[1]).toBeCloseTo(75, 6);
    expect(viewState).not.toHaveProperty("zoomX");
    expect(viewState).not.toHaveProperty("zoomY");
  });

  it("lets target win over a stale center", () => {
    const { controller } = setup();
    controller.setProps({
      id: "map",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      center: [-45, 75, 0],
      target: [1000, 2000],
      zoom: 3,
    });
    expect(controller.controllerState.getViewportProps().target).toEqual([
      1000, 2000,
    ]);
  });

  it("moves the camera with the arrow keys, 100 px at a time, like MapView", () => {
    const { controller } = setup();
    controller.setProps({
      id: "map",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      target: [0, 0],
      zoom: 3,
    });
    const metersPerPixel = 1 / (2 ** 3 * NORMALIZATION_SCALE);
    const left = controller.controllerState.moveLeft().getViewportProps();
    const up = controller.controllerState.moveUp().getViewportProps();
    expect(left.target[0]).toBeCloseTo(-100 * metersPerPixel, 3);
    expect(up.target[1]).toBeCloseTo(100 * metersPerPixel, 3);
  });

  it("accepts upstream-style transitions that interpolate center", () => {
    const { controller } = setup();
    const props = {
      id: "map",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      center: [-45, 75, 0],
      zoom: 3,
    };
    controller.setProps(props);
    expect(() =>
      controller.setProps({
        ...props,
        center: [-40, 70, 0],
        zoom: 4,
        transitionDuration: 300,
        transitionInterpolator: new LinearInterpolator(["center", "zoom"]),
      }),
    ).not.toThrow();
  });
});
