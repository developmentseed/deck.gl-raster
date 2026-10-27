import { fileIdentity } from "../src/identity.js";
import type { StreamMember } from "../src/stream.js";
import type { FileIdentity, ReadResult } from "../src/types.js";

/** The body of a replied call, driven chunk by chunk by the test. */
export interface FakeBody {
  /** Enqueue a chunk, then let the stream's reader run. */
  push(bytes: Uint8Array): Promise<void>;
  /** End the body cleanly, then let the stream's reader run. */
  close(): Promise<void>;
  /** Fail the body, then let the stream's reader run. */
  error(err: Error): Promise<void>;
}

/** One `fetch` call the fake received. */
export interface FakeCall {
  url: string;
  init: RequestInit;
  /** The `Range` header sent, or null. */
  range: string | null;
  /**
   * Answer the call with a status and headers; the body is a stream the
   * test drives through the returned {@link FakeBody}. Node adds no
   * `Content-Length` to a stream body, so set it in `headers`.
   */
  reply(init: { status: number; headers?: Record<string, string> }): FakeBody;
  /** True once the request's signal aborted or the body stream was cancelled. */
  readonly cancelled: boolean;
}

/** A recording `fetch` whose responses the test controls. */
export interface FakeFetch {
  fetch: typeof fetch;
  calls: FakeCall[];
  /** Resolves with the next call once it is made (or the next unclaimed one). */
  next(): Promise<FakeCall>;
}

/**
 * Let the stream's reader loop run after a body event. Uses `setImmediate`,
 * not `setTimeout`, so tests that fake `setTimeout` for the reader's task
 * window can still drive bodies: fake timers with `{ toFake: ["setTimeout"] }`.
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Build a {@link FakeFetch}. */
export function fakeFetch(): FakeFetch {
  const calls: FakeCall[] = [];
  const waiters: Array<(call: FakeCall) => void> = [];
  let claimed = 0;

  const fetchImpl = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> =>
    new Promise<Response>((resolveResponse) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      let cancelled = false;
      init?.signal?.addEventListener("abort", () => {
        cancelled = true;
      });
      const call: FakeCall = {
        url,
        init: init ?? {},
        range: new Headers(init?.headers).get("range"),
        get cancelled() {
          return cancelled;
        },
        reply(replyInit) {
          let controller: ReadableStreamDefaultController<Uint8Array>;
          const stream = new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
            },
            cancel() {
              cancelled = true;
            },
          });
          resolveResponse(
            new Response(stream, {
              status: replyInit.status,
              headers: replyInit.headers,
            }),
          );
          return {
            async push(bytes) {
              controller.enqueue(bytes);
              await tick();
            },
            async close() {
              controller.close();
              await tick();
            },
            async error(err) {
              controller.error(err);
              await tick();
            },
          };
        },
      };
      calls.push(call);
      const waiter = waiters.shift();
      if (waiter) {
        claimed += 1;
        waiter(call);
      }
    });

  return {
    fetch: fetchImpl as typeof fetch,
    calls,
    next() {
      if (claimed < calls.length) {
        const call = calls[claimed]!;
        claimed += 1;
        return Promise.resolve(call);
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

/** `n` bytes whose value at index `i` is `(seed + i) & 0xff`, so slices are checkable. */
export function pattern(n: number, seed = 0): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (seed + i) & 0xff;
  }
  return out;
}

/** A {@link StreamMember} whose settlement the test can await. */
export function member(
  offset: number,
  length: number,
  extra: Partial<StreamMember> = {},
): StreamMember & { promise: Promise<ReadResult> } {
  let resolve!: (result: ReadResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<ReadResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Observed only through `promise`; an unobserved rejection must not fail
  // an unrelated test.
  promise.catch(() => {});
  return { offset, length, resolve, reject, ...extra, promise };
}

/** A {@link FileIdentity} for tests. */
export function file(
  url = "https://x.test/a.tif",
  init?: RequestInit,
): FileIdentity {
  return fileIdentity(url, init);
}
