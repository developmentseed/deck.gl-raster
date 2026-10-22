import {
  Compression,
  PlanarConfiguration,
  Predictor,
  SampleFormat,
} from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import type { DecoderMetadata } from "../src/decode.js";
import { DecoderPool } from "../src/pool/pool.js";

const metadata: DecoderMetadata = {
  sampleFormat: SampleFormat.Uint,
  bitsPerSample: 8,
  samplesPerPixel: 1,
  width: 1,
  height: 1,
  predictor: Predictor.None,
  planarConfiguration: PlanarConfiguration.Contig,
  littleEndian: true,
};

/** A worker that never replies, so only its events settle a decode. */
class SilentWorker extends EventTarget {
  posted = 0;
  terminated = false;
  postMessage(): void {
    this.posted++;
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** A single-worker pool whose worker the test controls. */
function silentPool(): { pool: DecoderPool; worker: SilentWorker } {
  const worker = new SilentWorker();
  const pool = new DecoderPool({
    size: 1,
    createWorker: () => worker as unknown as Worker,
  });
  return { pool, worker };
}

describe("DecoderPool", () => {
  it("rejects in-flight decodes when the worker throws", async () => {
    const { pool, worker } = silentPool();
    const decoding = pool.decode(
      new ArrayBuffer(1),
      Compression.None,
      metadata,
    );
    worker.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    await expect(decoding).rejects.toThrow("Decoder worker failed: boom");
  });

  it("rejects decodes submitted after the worker failed to load", async () => {
    const { pool, worker } = silentPool();
    // A worker script that fails to load fires a plain `Event`, not an
    // `ErrorEvent`, usually before any tile has been fetched.
    worker.dispatchEvent(new Event("error"));
    await expect(
      pool.decode(new ArrayBuffer(1), Compression.None, metadata),
    ).rejects.toThrow("Decoder worker failed to load");
  });

  it("terminates a worker once it fails", () => {
    const { worker } = silentPool();
    // An uncaught error doesn't stop a worker by itself.
    worker.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    expect(worker.terminated).toBe(true);
  });

  it("sends decodes to a working worker once another has failed", () => {
    const workers = [new SilentWorker(), new SilentWorker()];
    let created = 0;
    const pool = new DecoderPool({
      size: 2,
      createWorker: () => workers[created++] as unknown as Worker,
    });
    workers[0]!.dispatchEvent(new Event("error"));
    void pool.decode(new ArrayBuffer(1), Compression.None, metadata);
    expect(workers[1]!.posted).toBe(1);
  });
});
