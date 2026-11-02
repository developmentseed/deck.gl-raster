/**
 * A `fetch` that serves one in-memory file with HTTP range support, the way
 * S3 looks from a browser: `206` with `Content-Length` but no `Content-Range`
 * (not CORS-exposed), `416` past the end, `200` for a request without
 * `Range`, and `Content-Length` on HEAD. Bodies are streams delivered in
 * `chunkBytes` pieces so the range reader's streaming path runs. Aborting a
 * request errors its body, as a real `fetch` does.
 */
export interface FixtureServer {
  fetch: typeof fetch;
  /** The `Range` header of every request, in order (`""` for none). */
  requests: string[];
  /** The headers of every request, in order. */
  headers: Headers[];
  /** Hold the next request until `release()` is called. */
  holdNext(): { arrived: Promise<void>; release(): void };
  /** Answer the next request with this status and an empty body. */
  failNext(status: number): void;
  /** Sent as `ETag` on every 200 and 206 while set; change it to replace the object. */
  etag: string | undefined;
}

/** Build a {@link FixtureServer} for `file`. */
export function fixtureServer(
  file: Uint8Array,
  options: { chunkBytes?: number; etag?: string } = {},
): FixtureServer {
  const chunkBytes = options.chunkBytes ?? (file.length || 1);
  const requests: string[] = [];
  const headers: Headers[] = [];
  let hold: { arrived: () => void; released: Promise<void> } | null = null;
  let failStatus: number | null = null;

  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) {
      throw signal.reason;
    }
    const requestHeaders = new Headers(init?.headers);
    const range = requestHeaders.get("range") ?? "";
    requests.push(range);
    headers.push(requestHeaders);

    if (hold !== null) {
      const { arrived, released } = hold;
      hold = null;
      arrived();
      await new Promise<void>((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        released.then(resolve);
      });
    }
    if (failStatus !== null) {
      const status = failStatus;
      failStatus = null;
      return new Response(null, { status });
    }

    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-length": String(file.length) },
      });
    }

    let start = 0;
    let end = file.length;
    let status = 200;
    const absolute = /^bytes=(\d+)-(\d+)$/.exec(range);
    const suffix = /^bytes=-(\d+)$/.exec(range);
    if (absolute !== null) {
      start = Number(absolute[1]);
      if (start >= file.length) {
        return new Response(null, { status: 416 });
      }
      end = Math.min(Number(absolute[2]) + 1, file.length);
      status = 206;
    } else if (suffix !== null) {
      start = Math.max(0, file.length - Number(suffix[1]));
      status = 206;
    }
    const slice = file.subarray(start, end);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < slice.length; at += chunkBytes) {
          controller.enqueue(
            slice.subarray(at, Math.min(at + chunkBytes, slice.length)),
          );
        }
        controller.close();
        signal?.addEventListener(
          "abort",
          () => {
            try {
              controller.error(signal.reason);
            } catch {
              // Already closed.
            }
          },
          { once: true },
        );
      },
    });
    const responseHeaders: Record<string, string> = {
      "content-length": String(slice.length),
    };
    if (server.etag !== undefined) {
      responseHeaders.etag = server.etag;
    }
    return new Response(body, { status, headers: responseHeaders });
  };

  const server: FixtureServer = {
    fetch: fetchImpl as typeof fetch,
    requests,
    headers,
    etag: options.etag,
    holdNext() {
      let arrived!: () => void;
      let release!: () => void;
      const arrival = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      hold = { arrived, released };
      return { arrived: arrival, release };
    },
    failNext(status) {
      failStatus = status;
    },
  };
  return server;
}
