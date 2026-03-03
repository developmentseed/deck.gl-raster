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

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener("message", (e: MessageEvent) =>
      this.onMessage(e),
    );
  }

  get jobCount(): number {
    return this.jobs.size;
  }

  private onMessage(
    e: MessageEvent<WorkerResponse | WorkerErrorResponse>,
  ): void {
    const { jobId, error, pixels } = e.data;
    const job = this.jobs.get(jobId);
    this.jobs.delete(jobId);
    if (!job) return;

    if (error) {
      job.reject(new Error(error));
    } else {
      job.resolve(pixels!);
    }
  }

  submitJob(
    request: Omit<WorkerRequest, "jobId">,
    transferables: Transferable[],
  ): Promise<DecodedPixels> {
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
