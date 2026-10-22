import type { Compression } from "@cogeotiff/core";
import type { DecodedPixels, DecoderMetadata } from "../decode.js";

/** Message sent from main thread to worker. */
export type WorkerRequest = {
  jobId: number;
  compression: Compression;
  metadata: DecoderMetadata;
  buffer: ArrayBuffer;
};

/** Successful response from worker. */
export type WorkerResponse = {
  jobId: number;
  pixels: DecodedPixels;
  error?: never;
};

/** Error response from worker. */
export type WorkerErrorResponse = {
  jobId: number;
  error: string;
  pixels?: never;
};

/** Collect the transferable ArrayBuffers from a DecodedPixels. */
export function collectTransferables(pixels: DecodedPixels): Transferable[] {
  if (pixels.layout === "pixel-interleaved") {
    return [pixels.data.buffer];
  }
  return pixels.bands.map((b) => b.buffer);
}

type PendingJob = {
  resolve: (pixels: DecodedPixels) => void;
  reject: (err: Error) => void;
};

/**
 * Wraps a Worker, tracking in-flight jobs and routing responses via jobId.
 */
export class WorkerWrapper {
  readonly worker: Worker;
  private jobIdCounter = 0;
  private jobs = new Map<number, PendingJob>();
  /** Set once the worker fails; every later job is rejected with it. */
  private error: Error | null = null;

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener("message", (e: MessageEvent) =>
      this.onMessage(e),
    );
    this.worker.addEventListener("error", (e: ErrorEvent) => this.onError(e));
  }

  /**
   * How many jobs are waiting on this worker. `DecoderPool` sends each decode
   * to the worker with the fewest. A failed worker reports `Infinity`, so it
   * is picked only when every worker has failed, and `submitJob` then rejects.
   */
  get jobCount(): number {
    return this.error ? Infinity : this.jobs.size;
  }

  private onMessage(
    e: MessageEvent<WorkerResponse | WorkerErrorResponse>,
  ): void {
    const { jobId, error, pixels } = e.data;
    const job = this.jobs.get(jobId);
    this.jobs.delete(jobId);
    if (!job) {
      return;
    }

    if (error) {
      job.reject(new Error(error));
    } else {
      job.resolve(pixels!);
    }
  }

  /**
   * A worker whose script fails to load, or that throws outside a job, fires
   * `error` instead of replying, so its pending jobs would never settle.
   */
  private onError(e: ErrorEvent): void {
    // A failed script load fires a plain `Event`, which has no message.
    this.error = new Error(
      e.message
        ? `Decoder worker failed: ${e.message}`
        : "Decoder worker failed to load",
    );
    for (const job of this.jobs.values()) {
      job.reject(this.error);
    }
    this.jobs.clear();
    // An uncaught error can leave the worker running, but it gets no more jobs.
    this.worker.terminate();
  }

  submitJob(
    request: Omit<WorkerRequest, "jobId">,
    transferables: Transferable[],
  ): Promise<DecodedPixels> {
    if (this.error) {
      return Promise.reject(this.error);
    }
    const jobId = this.jobIdCounter++;
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve, reject });
      this.worker.postMessage(
        { ...request, jobId },
        { transfer: transferables },
      );
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
