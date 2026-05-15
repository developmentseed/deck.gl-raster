import type { ShaderAssembler, ShaderModule } from "@luma.gl/shadertools";
import { describe, expect, it, vi } from "vitest";
import {
  createMemoizingShaderAssembler,
  readAssemblerStats,
} from "../../src/mesh-layer/shader-assembler-memo.js";

type AssembleProps = Parameters<ShaderAssembler["assembleGLSLShaderPair"]>[0];

function fakeModule(name: string): ShaderModule {
  return { name } as ShaderModule;
}

function fakeAssembler() {
  const assembleGLSLShaderPair = vi.fn(
    (
      props: AssembleProps,
    ): ReturnType<ShaderAssembler["assembleGLSLShaderPair"]> => ({
      vs: `assembled-vs:${props.vs ?? ""}`,
      fs: `assembled-fs:${props.fs ?? ""}`,
      getUniforms: () => ({}),
      modules: props.modules ?? [],
    }),
  );
  const addShaderHook = vi.fn();
  const inner = {
    assembleGLSLShaderPair,
    addShaderHook,
  } as unknown as ShaderAssembler;
  return { inner, assembleGLSLShaderPair, addShaderHook };
}

function baseProps(overrides: Partial<AssembleProps> = {}): AssembleProps {
  return {
    platformInfo: { shaderLanguage: "glsl" } as AssembleProps["platformInfo"],
    vs: "void main() {}",
    fs: "void main() {}",
    modules: [],
    ...overrides,
  };
}

describe("createMemoizingShaderAssembler", () => {
  it("returns the same assembled result for identical inputs", () => {
    const { inner, assembleGLSLShaderPair } = fakeAssembler();
    const memo = createMemoizingShaderAssembler(inner);
    const modules = [fakeModule("createTexture"), fakeModule("cutlineBbox")];

    const first = memo.assembleGLSLShaderPair(baseProps({ modules }));
    const second = memo.assembleGLSLShaderPair(baseProps({ modules }));

    expect(second).toBe(first);
    expect(assembleGLSLShaderPair).toHaveBeenCalledTimes(1);
  });

  it("does not collapse calls with different modules", () => {
    const { inner, assembleGLSLShaderPair } = fakeAssembler();
    const memo = createMemoizingShaderAssembler(inner);

    memo.assembleGLSLShaderPair(baseProps({ modules: [fakeModule("a")] }));
    memo.assembleGLSLShaderPair(baseProps({ modules: [fakeModule("b")] }));

    expect(assembleGLSLShaderPair).toHaveBeenCalledTimes(2);
  });

  it("does not collapse calls with different shader source", () => {
    const { inner, assembleGLSLShaderPair } = fakeAssembler();
    const memo = createMemoizingShaderAssembler(inner);

    memo.assembleGLSLShaderPair(baseProps({ fs: "// pipeline A" }));
    memo.assembleGLSLShaderPair(baseProps({ fs: "// pipeline B" }));

    expect(assembleGLSLShaderPair).toHaveBeenCalledTimes(2);
  });

  it("treats `defines` order as stable so reordered keys hit the cache", () => {
    const { inner, assembleGLSLShaderPair } = fakeAssembler();
    const memo = createMemoizingShaderAssembler(inner);

    memo.assembleGLSLShaderPair(baseProps({ defines: { A: true, B: false } }));
    memo.assembleGLSLShaderPair(baseProps({ defines: { B: false, A: true } }));

    expect(assembleGLSLShaderPair).toHaveBeenCalledTimes(1);
  });

  it("delegates non-memoized methods to the inner assembler", () => {
    const { inner, addShaderHook } = fakeAssembler();
    const memo = createMemoizingShaderAssembler(inner);

    memo.addShaderHook("vs:DECKGL_FILTER_GL_POSITION");

    expect(addShaderHook).toHaveBeenCalledWith("vs:DECKGL_FILTER_GL_POSITION");
  });

  it("tracks hit/miss/entries counters", () => {
    const { inner } = fakeAssembler();
    const memo = createMemoizingShaderAssembler(inner);

    memo.assembleGLSLShaderPair(baseProps({ fs: "// A" }));
    memo.assembleGLSLShaderPair(baseProps({ fs: "// A" }));
    memo.assembleGLSLShaderPair(baseProps({ fs: "// A" }));
    memo.assembleGLSLShaderPair(baseProps({ fs: "// B" }));

    expect(readAssemblerStats(memo)).toEqual({
      hits: 2,
      misses: 2,
      entries: 2,
    });
  });
});
