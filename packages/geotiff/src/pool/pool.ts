import type { Compression } from "@cogeotiff/core";
import type { DecodedPixels, DecoderMetadata } from "../decode.js";
import { decode } from "../decode.js";
import type { WorkerRequest } from "./wrapper.js";
import { WorkerWrapper } from "./wrapper.js";

export type DecoderPoolOptions = {
  /**
   * Number of workers to create. Defaults to `navigator.hardwareConcurrency`
   * when available, otherwise 2. Set to 0 to disable workers and decode on
   * the main thread.
   */
  size?: number;

  /**
   * Factory that creates a Worker. When omitted, decoding runs on the main
   * thread regardless of `size`. Provide this to enable off-main-thread
   * decoding, e.g.:
   *
   * ```ts
   * {
   *   createWorker: () =>
   *     new Worker(new URL("./pool/worker.js", import.meta.url), { type: "module" }),
   * }
   * ```
   */
  createWorker?: () => Worker;
};

const defaultSize =
  typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 2) : 2;

/**
 * Manages a pool of Web Workers for off-main-thread tile decoding.
 *
 * When no `createWorker` factory is provided, decoding falls back to the main
 * thread. This lets the pool be constructed unconditionally and wired up with
 * a worker later (or never, for SSR / Node environments).
 */
export class DecoderPool {
  private readonly workerWrappers: WorkerWrapper[];

  constructor(options: DecoderPoolOptions = {}) {
    const { size = defaultSize, createWorker } = options;

    this.workerWrappers = [];
    if (createWorker && size > 0) {
      for (let i = 0; i < size; i++) {
        this.workerWrappers.push(new WorkerWrapper(createWorker()));
      }
    }
  }

  /** True when workers are available for off-main-thread decoding. */
  get hasWorkers(): boolean {
    return this.workerWrappers.length > 0;
  }

  /**
   * Decode a compressed tile buffer.
   *
   * When workers are available, the compressed `bytes` buffer is transferred
   * zero-copy to the least-loaded worker. The returned `DecodedPixels` typed
   * array buffers are transferred back to the main thread.
   *
   * When no workers are available, decoding runs on the main thread via the
   * normal `decode()` path.
   */
  async decode(
    bytes: ArrayBuffer,
    compression: Compression,
    metadata: DecoderMetadata,
  ): Promise<DecodedPixels> {
    if (!this.hasWorkers) {
      return decode(bytes, compression, metadata);
    }

    const worker = this.leastLoaded();
    const request: Omit<WorkerRequest, "jobId"> = {
      compression: compression as number,
      metadata,
      buffer: bytes,
    };
    const array = await worker.submitJob(request, [bytes]);
    return array;
  }

  /** Terminate all workers and release resources. */
  destroy(): void {
    for (const w of this.workerWrappers) {
      w.terminate();
    }
    this.workerWrappers.length = 0;
  }

  private leastLoaded(): WorkerWrapper {
    let best = this.workerWrappers[0]!;
    for (let i = 1; i < this.workerWrappers.length; i++) {
      if (this.workerWrappers[i]!.jobCount < best.jobCount) {
        best = this.workerWrappers[i]!;
      }
    }
    return best;
  }
}

/** Default pool instance. Configure with a `createWorker` factory to enable workers. */
export const defaultPool = new DecoderPool();
