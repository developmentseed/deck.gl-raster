/**
 * Default worker entry point for DecoderPool.
 *
 * This file is intended to be used as a Web Worker via:
 *
 *   new Worker(new URL("./pool/worker.js", import.meta.url), { type: "module" })
 *
 * To override codecs (e.g. swap in a WASM zstd decoder), create your own
 * worker file that mutates `registry` before importing this handler:
 *
 *   import { registry } from "@developmentseed/geotiff";
 *   import { Compression } from "@cogeotiff/core";
 *   registry.set(Compression.Zstd, () => import("./my-wasm-zstd.js").then(m => m.decode));
 *   import "@developmentseed/geotiff/pool/worker";
 */

import { decode } from "../decode.js";
import type {
  WorkerErrorResponse,
  WorkerRequest,
  WorkerResponse,
} from "./wrapper.js";
import { collectTransferables } from "./wrapper.js";

self.addEventListener("message", async (e: MessageEvent<WorkerRequest>) => {
  const { jobId, compression, metadata, buffer } = e.data;

  try {
    const array = await decode(buffer, compression, metadata);
    const transferables = collectTransferables(array);
    const response: WorkerResponse = { jobId, pixels: array };
    self.postMessage(response, { transfer: transferables });
  } catch (err) {
    const response: WorkerErrorResponse = { jobId, error: String(err) };
    self.postMessage(response);
  }
});
