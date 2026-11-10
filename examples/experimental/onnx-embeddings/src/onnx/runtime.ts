import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

/** The `onnxruntime-web/webgpu` module, loaded on first use. */
export type Ort = typeof import("onnxruntime-web/webgpu");

let ortPromise: Promise<Ort> | null = null;

/**
 * Load ONNX Runtime Web with its WebGPU execution provider, once.
 *
 * The JavaScript is a dynamic import, so the RGB view loads without it. The
 * WebAssembly binary (29 MB, 7 MB compressed) is served by Vite from the
 * npm package and fetched when the first session is created.
 */
export function loadOrt(): Promise<Ort> {
  if (!ortPromise) {
    ortPromise = (async () => {
      if (!("gpu" in navigator)) {
        throw new Error("This browser has no WebGPU (navigator.gpu)");
      }
      const ort = await import("onnxruntime-web/webgpu");
      // One thread needs no cross-origin isolation; the work is on the GPU.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = { wasm: wasmUrl };
      return ort;
    })();
    ortPromise.catch(() => {
      ortPromise = null;
    });
  }
  return ortPromise;
}
