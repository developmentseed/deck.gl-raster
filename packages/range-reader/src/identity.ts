import type { FileIdentity } from "./types.js";

/**
 * Canonical signature of the parts of a `RequestInit` that change what a
 * server sends back: headers (name-normalised and sorted), credentials and
 * mode. `""` for no init. `signal`, `cache` and `method` are left out: the
 * reader owns those per request.
 */
export function initSignature(init?: RequestInit): string {
  if (init === undefined) {
    return "";
  }
  const headers = [...new Headers(init.headers)].sort();
  return JSON.stringify({
    headers,
    credentials: init.credentials ?? null,
    mode: init.mode ?? null,
  });
}

/**
 * Build the {@link FileIdentity} for a URL read with `init`. Compute it once
 * per file and pass it to every {@link RangeReader.read} for that file.
 */
export function fileIdentity(
  url: URL | string,
  init?: RequestInit,
): FileIdentity {
  const resolved = typeof url === "string" ? new URL(url) : url;
  return {
    url: resolved,
    init,
    key: `${resolved.href}\0${initSignature(init)}`,
  };
}
