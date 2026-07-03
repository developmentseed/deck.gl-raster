import { describe, expect, it, vi } from "vitest";

import { MeshTextureLayer } from "../src/mesh-layer/mesh-layer.js";

/**
 * Drive `draw()` directly with a stubbed model, spying on the parent
 * (SimpleMeshLayer) draw so no GPU work happens. Captures the shader module
 * props MeshTextureLayer sets per frame.
 */
function drawAndCaptureShaderProps(layerProps: Record<string, unknown>) {
  const layer = new MeshTextureLayer({
    id: "test",
    image: {} as never,
    ...layerProps,
  });
  const setProps = vi.fn();
  const models = [{ shaderInputs: { setProps } }];
  const drawSpy = vi
    .spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(layer)) as {
        draw: (opts: unknown) => void;
      },
      "draw",
    )
    .mockImplementation(() => {});
  const getModelsSpy = vi
    .spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(layer)) as {
        getModels: () => unknown[];
      },
      "getModels",
    )
    .mockReturnValue(models);

  try {
    (layer as unknown as { draw: (opts: unknown) => void }).draw({});
    expect(setProps).toHaveBeenCalledTimes(1);
    return setProps.mock.calls[0]![0] as Record<string, unknown>;
  } finally {
    drawSpy.mockRestore();
    getModelsSpy.mockRestore();
  }
}

describe("MeshTextureLayer unlit material translation", () => {
  it("translates material: false into phongMaterial {unlit: true} module props", () => {
    // deck.gl v9's LightingEffect forwards the raw `false` to luma.gl, which
    // coerces falsy module props to `{}` and re-applies the default *lit*
    // phong material — so the layer must set the `unlit` flag itself.
    const shaderProps = drawAndCaptureShaderProps({ material: false });
    expect(shaderProps.phongMaterial).toEqual({ unlit: true });
  });

  it("leaves phongMaterial untouched when the default material applies", () => {
    const shaderProps = drawAndCaptureShaderProps({});
    expect(shaderProps).not.toHaveProperty("phongMaterial");
  });

  it("leaves phongMaterial untouched for a custom material object", () => {
    const shaderProps = drawAndCaptureShaderProps({
      material: { ambient: 0.5, diffuse: 0.5 },
    });
    expect(shaderProps).not.toHaveProperty("phongMaterial");
  });
});
