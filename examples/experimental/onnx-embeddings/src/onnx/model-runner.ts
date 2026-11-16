import type { InferenceSession, Tensor } from "onnxruntime-web/webgpu";
import { NUM_BANDS } from "../aef/constants.js";
import type { Ort } from "./runtime.js";

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
  /** Tile height in pixels. */
  height: number;
  /** Tile width in pixels. */
  width: number;
};

/** One model output and how long the run took. */
export type ModelOutput = {
  /** One value per pixel, row-major, `height × width`. */
  values: Float32Array;
  /** Wall time of the run, including upload and readback. */
  ms: number;
};

const OUTPUT_NAMES: Record<ModelName, string> = {
  similarity: "similarity",
  clusters: "cluster",
  classifier: "probability",
};

/**
 * Runs this example's ONNX models on tiles, one run at a time.
 *
 * With the WebGPU provider, two `run` calls in flight on one session never
 * resolve, so every run goes through one queue.
 */
export class ModelRunner {
  private readonly ort: Ort;
  private readonly sessions = new Map<ModelName, Promise<InferenceSession>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ort: Ort) {
    this.ort = ort;
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

  private async createSession(model: ModelName): Promise<InferenceSession> {
    const url = `${import.meta.env.BASE_URL}models/${model}.onnx`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return this.ort.InferenceSession.create(bytes, {
      executionProviders: ["webgpu"],
      // Every node must run on WebGPU: fail rather than fall back to the CPU
      extra: { session: { disable_cpu_ep_fallback: "1" } },
    });
  }

  private async runNow(
    task: AnalysisTask,
    input: ModelInput,
  ): Promise<ModelOutput> {
    const session = await this.prepare(task.model);
    const start = performance.now();
    const feeds: Record<string, Tensor> = {
      // The model dequantizes the raw int8 values on WebGPU
      embeddings: new this.ort.Tensor("int8", input.embeddings, [
        1,
        NUM_BANDS,
        input.height,
        input.width,
      ]),
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
