import type { FileIdentity, FileKey } from "./types.js";

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
 *
 * The identity exists because a merged request carries exactly one set of
 * headers, credentials and mode: reads of one URL made with different inits
 * cannot share a request or an in-flight stream, so they are different
 * files to the reader. They do not share cached bytes either, since the
 * reader cannot know that two inits return the same bytes. That costs a
 * refetch after a token refresh on the same URL, and nothing more: a
 * refreshed signed URL changes the URL anyway.
 */
export function fileIdentity(
  url: URL | string,
  init?: RequestInit,
): FileIdentity {
  const resolved = typeof url === "string" ? new URL(url) : url;
  // A space separates the two parts: a serialized URL never contains one
  // (the URL parser percent-encodes it everywhere), so the key splits
  // unambiguously, and it reads clearly when printed.
  const key = `${resolved.href} ${initSignature(init)}` as FileKey;
  return { url: resolved, init, key };
}
