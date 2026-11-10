import type { InferenceSession, Tensor } from "onnxruntime-web/webgpu";
import { NUM_BANDS } from "../aef/constants.js";
import { dequantizeInto } from "../aef/dequantize.js";
import type { Ort } from "./runtime.js";

/**
 * How a tile's embeddings reach the model.
 *
 * - `int8`: the raw int8 array, as a CPU tensor. The model dequantizes. Its
 *   `Cast` from int8 has no WebGPU kernel, so it runs on the CPU provider.
 * - `float32`: dequantized in JavaScript into one reused buffer, as a CPU
 *   tensor. Every node runs on WebGPU; the 16 MB tensor is uploaded per run.
 * - `gpu`: dequantized once per tile into a buffer on ONNX Runtime's WebGPU
 *   device, which stays there until the tile unloads. 16 MB of GPU memory per
 *   256 × 256 tile.
 */
export type InputPath = "int8" | "float32" | "gpu";

/** Work for one model run: the model and its weights. */
export type AnalysisTask =
  | {
      /** Cosine similarity to one pixel. */
      model: "similarity";
      /** The query pixel's dequantized 64-band vector. */
      query: Float32Array;
    }
  | {
      /** Index of the nearest of `k` centroids. */
      model: "clusters";
      /** `k` row-major unit centroids of 64 values. */
      centroids: Float32Array;
      /** Number of centroids. */
      k: number;
    }
  | {
      /** Probability from a logistic regression. */
      model: "classifier";
      /** 64 weights. */
      weights: Float32Array;
      /** The intercept. */
      bias: number;
    };

/** The model name of an {@link AnalysisTask}. */
export type ModelName = AnalysisTask["model"];

/** What a model needs from a tile. */
export type ModelInput = {
  /** The tile's raw `[64, height, width]` embeddings. */
  embeddings: Int8Array;
  /** Tile width in pixels. */
  width: number;
  /** Tile height in pixels. */
  height: number;
  /**
   * The tile's dequantized embeddings on ONNX Runtime's device, for the `gpu`
   * input path. Created on the first run; the owner destroys it.
   */
  gpuEmbeddings?: GpuEmbeddings;
};

/** A tile's dequantized embeddings in a GPU buffer. */
export type GpuEmbeddings = {
  /** A float32 tensor that wraps the GPU buffer. */
  tensor: Tensor;
  /** Size of the GPU buffer in bytes. */
  byteLength: number;
  /** Free the GPU buffer. */
  destroy: () => void;
};

/** One model output and how long the run took. */
export type ModelOutput = {
  /** One value per pixel, row-major, `width × height`. */
  values: Float32Array;
  /** Wall time of the run, including upload and readback. */
  ms: number;
};

const OUTPUT_NAMES: Record<ModelName, string> = {
  similarity: "similarity",
  clusters: "cluster",
  classifier: "probability",
};

// `GPUBufferUsage` flags; TypeScript's DOM lib types the interfaces only
const GPU_BUFFER_USAGE_COPY_SRC = 0x0004;
const GPU_BUFFER_USAGE_COPY_DST = 0x0008;
const GPU_BUFFER_USAGE_STORAGE = 0x0080;

/**
 * Runs this example's ONNX models on tiles, one run at a time.
 *
 * With the WebGPU provider, two `run` calls in flight on one session never
 * resolve, so every run goes through one queue.
 */
export class ModelRunner {
  /** The input path this runner feeds models with. */
  readonly inputPath: InputPath;
  private readonly ort: Ort;
  private readonly sessions = new Map<ModelName, Promise<InferenceSession>>();
  private queue: Promise<unknown> = Promise.resolve();
  private scratch: Float32Array | null = null;

  constructor(ort: Ort, inputPath: InputPath) {
    this.ort = ort;
    this.inputPath = inputPath;
  }

  /** Create the session for `model` now, rather than on its first run. */
  prepare(model: ModelName): Promise<InferenceSession> {
    let session = this.sessions.get(model);
    if (!session) {
      session = this.createSession(model);
      this.sessions.set(model, session);
      session.catch(() => this.sessions.delete(model));
    }
    return session;
  }

  /** Run `task` on one tile. Runs are queued, so one runs at a time. */
  run(task: AnalysisTask, input: ModelInput): Promise<ModelOutput> {
    const result = this.queue.then(() => this.runNow(task, input));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Resolves once every queued run has finished. */
  idle(): Promise<unknown> {
    return this.queue;
  }

  /** Release every session. */
  async release(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) {
      // A session that failed to load has nothing to release
      await (await session.catch(() => null))?.release();
    }
  }

  private async createSession(model: ModelName): Promise<InferenceSession> {
    const dtype = this.inputPath === "int8" ? "int8" : "float32";
    const url = `${import.meta.env.BASE_URL}models/${model}_${dtype}.onnx`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return this.ort.InferenceSession.create(bytes, {
      executionProviders: ["webgpu"],
      // The float32 models must run every node on WebGPU: fail rather than
      // fall back to the CPU. The int8 models need the CPU for `Cast`, which
      // ONNX Runtime reports as a warning through `console.error`, so only
      // log errors for them.
      ...(dtype === "float32"
        ? { extra: { session: { disable_cpu_ep_fallback: "1" } } }
        : { logSeverityLevel: 3 as const }),
    });
  }

  private async runNow(
    task: AnalysisTask,
    input: ModelInput,
  ): Promise<ModelOutput> {
    const session = await this.prepare(task.model);
    const start = performance.now();
    const feeds: Record<string, Tensor> = {
      embeddings: await this.embeddingsTensor(input),
      ...this.taskFeeds(task),
    };
    const results = await session.run(feeds);
    const output = results[OUTPUT_NAMES[task.model]];
    if (!output) {
      throw new Error(`Model ${task.model} has no output`);
    }
    const values = (await output.getData()) as Float32Array;
    output.dispose();
    return { values, ms: performance.now() - start };
  }

  private async embeddingsTensor(input: ModelInput): Promise<Tensor> {
    const { embeddings, width, height } = input;
    const dims = [1, NUM_BANDS, height, width];
    switch (this.inputPath) {
      case "int8":
        return new this.ort.Tensor("int8", embeddings, dims);
      case "float32":
        return new this.ort.Tensor(
          "float32",
          this.dequantize(embeddings),
          dims,
        );
      case "gpu":
        input.gpuEmbeddings ??= await this.uploadEmbeddings(input);
        return input.gpuEmbeddings.tensor;
    }
  }

  /** Dequantize into the reused scratch buffer. */
  private dequantize(embeddings: Int8Array): Float32Array {
    if (this.scratch?.length !== embeddings.length) {
      this.scratch = new Float32Array(embeddings.length);
    }
    dequantizeInto(embeddings, this.scratch);
    return this.scratch;
  }

  private async uploadEmbeddings(input: ModelInput): Promise<GpuEmbeddings> {
    const device = await this.ort.env.webgpu.device;
    const values = this.dequantize(input.embeddings);
    const buffer = device.createBuffer({
      size: values.byteLength,
      usage:
        GPU_BUFFER_USAGE_STORAGE |
        GPU_BUFFER_USAGE_COPY_SRC |
        GPU_BUFFER_USAGE_COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, values);
    const tensor = this.ort.Tensor.fromGpuBuffer(buffer, {
      dataType: "float32",
      dims: [1, NUM_BANDS, input.height, input.width],
    });
    return {
      tensor,
      byteLength: values.byteLength,
      destroy: () => buffer.destroy(),
    };
  }

  private taskFeeds(task: AnalysisTask): Record<string, Tensor> {
    const { Tensor } = this.ort;
    switch (task.model) {
      case "similarity":
        return { query: new Tensor("float32", task.query, [1, NUM_BANDS]) };
      case "clusters":
        return {
          centroids: new Tensor("float32", task.centroids, [task.k, NUM_BANDS]),
          cluster_ids: new Tensor(
            "float32",
            Float32Array.from({ length: task.k }, (_, i) => i),
            [1, task.k],
          ),
        };
      case "classifier":
        return {
          weights: new Tensor("float32", task.weights, [1, NUM_BANDS]),
          bias: new Tensor("float32", new Float32Array([task.bias]), [1]),
        };
    }
  }
}
