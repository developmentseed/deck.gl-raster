import type { ConcurrencyLimiter, Priority } from "./limiter.js";
import { comparePriorities } from "./limiter.js";
import type {
  ByteRange,
  FileIdentity,
  ReadRange,
  ReadResult,
} from "./types.js";

/** One read served by a {@link RangeStream}. */
export interface StreamMember extends ByteRange {
  resolve(result: ReadResult): void;
  reject(reason: unknown): void;
  /** Ends this member's wait; the stream runs on while others want it. */
  signal?: AbortSignal;
  /** Priority this member lends to the stream's limiter slot. */
  getPriority?: () => Priority;
}

/** How a stream ended. */
export type StreamEnd =
  | { kind: "complete" }
  | { kind: "cancelled" }
  | { kind: "eof"; size: number }
  | { kind: "truncated" }
  | { kind: "not-found" }
  | { kind: "failed"; error: unknown };

/** What a finished stream leaves behind, for the cache and the stats. */
export interface StreamOutcome {
  /** File offset of `bytes[0]`; undefined for a suffix of an object of unknown size. */
  offset: number | undefined;
  /** Everything received, in order, trimmed to what arrived. */
  bytes: Uint8Array;
  end: StreamEnd;
  /** The object's size when a response revealed it. */
  size?: number;
}

/** Options for {@link RangeStream}. */
export interface RangeStreamOptions {
  fetch: typeof fetch;
  /** `RequestInit.cache` for the request; defaults to the file init's. */
  cacheMode?: RequestCache;
  /** One slot is held from before the request until the stream ends. */
  limiter?: ConcurrencyLimiter | null;
  /** Largest whole object accepted from a server that answers a range with 200. */
  maxRequestBytes: number;
}

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+|\*)$/;

/**
 * One streamed HTTP request for one merged byte range, serving the reads
 * (members) inside it. Each member resolves the moment its last byte has
 * arrived, with a view into the stream's buffer; a member can attach while
 * the stream is in flight. A suffix or whole-object request serves exactly
 * one member, resolved when the body ends.
 */
export class RangeStream {
  readonly file: FileIdentity;
  /** The absolute range requested; undefined for suffix and whole-object requests. */
  readonly range: ByteRange | undefined;

  /** Undefined for a whole-object request. */
  private readonly request: ReadRange | undefined;
  private readonly options: RangeStreamOptions;
  private readonly controller = new AbortController();
  /** Members not yet settled, ordered by their end offset. */
  private readonly live: StreamMember[] = [];
  /** Preallocated when the body's length is known up front. */
  private buffer: Uint8Array | undefined;
  /** Collected when it is not. */
  private readonly chunks: Uint8Array[] = [];
  private receivedBytes = 0;
  private isActive = true;
  /** File offset of the first received byte, once known. */
  private offset: number | undefined;
  private size: number | undefined;
  /**
   * The range the buffer covers: `range`, or the whole object when a server
   * answered a range request with 200 and the object was small enough.
   */
  private base: ByteRange | undefined;
  private cancelled = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  /** The abort listener installed for each live member, removed when it settles. */
  private readonly abortListeners = new Map<StreamMember, () => void>();

  constructor(
    file: FileIdentity,
    request: ReadRange | undefined,
    members: StreamMember[],
    options: RangeStreamOptions,
  ) {
    this.file = file;
    this.request = request;
    this.options = options;
    this.range =
      request !== undefined && "offset" in request ? request : undefined;
    this.base = this.range;
    if (this.range !== undefined) {
      this.offset = this.range.offset;
    } else if (request === undefined) {
      this.offset = 0;
    }
    for (const member of members) {
      this.insert(member);
    }
  }

  /** Bytes received so far. */
  get received(): number {
    return this.receivedBytes;
  }

  /** True from construction until the outcome settles. */
  get active(): boolean {
    return this.isActive;
  }

  /**
   * Add a read inside this stream's absolute range while it is active. A
   * read whose bytes have already arrived resolves at once. Returns false
   * when the stream is done, has no absolute range, or does not cover the
   * read.
   */
  attach(member: StreamMember): boolean {
    if (!this.isActive || this.base === undefined) {
      return false;
    }
    const end = member.offset + member.length;
    if (
      member.offset < this.base.offset ||
      end > this.base.offset + this.base.length
    ) {
      return false;
    }
    if (member.signal?.aborted) {
      member.reject(member.signal.reason);
    } else if (end - this.base.offset <= this.receivedBytes) {
      member.resolve({ kind: "bytes", bytes: this.view(member) });
    } else {
      this.insert(member);
    }
    return true;
  }

  /**
   * Take the limiter slot, send the request and read its body. Never
   * rejects: every way the request can end is an outcome.
   */
  async run(): Promise<StreamOutcome> {
    if (this.live.length === 0) {
      return this.settle(this.collect(), { kind: "cancelled" });
    }
    let release: (() => void) | undefined;
    try {
      const { limiter } = this.options;
      if (limiter) {
        try {
          release = await limiter.acquire(
            this.file.url,
            this.controller.signal,
            () => this.bestPriority(),
          );
        } catch (error) {
          return this.cancelled
            ? this.settle(this.collect(), { kind: "cancelled" })
            : this.fail(error);
        }
      }
      if (this.cancelled) {
        return this.settle(this.collect(), { kind: "cancelled" });
      }
      const headers = new Headers(this.file.init?.headers);
      const rangeHeader = this.rangeHeader();
      if (rangeHeader !== undefined) {
        headers.set("Range", rangeHeader);
      }
      const init: RequestInit = {
        ...this.file.init,
        headers,
        signal: this.controller.signal,
      };
      const cache = this.options.cacheMode ?? this.file.init?.cache;
      if (cache !== undefined) {
        init.cache = cache;
      }
      let response: Response;
      try {
        response = await this.untilCancelled(
          this.options.fetch(this.file.url, init),
        );
      } catch (error) {
        return this.cancelled
          ? this.settle(this.collect(), { kind: "cancelled" })
          : this.fail(error);
      }
      return await this.consume(response);
    } finally {
      release?.();
    }
  }

  private async consume(response: Response): Promise<StreamOutcome> {
    const contentRange = CONTENT_RANGE.exec(
      response.headers.get("content-range") ?? "",
    );
    if (contentRange !== null) {
      if (contentRange[3] !== "*") {
        this.size = Number(contentRange[3]);
      }
      if (this.offset === undefined) {
        this.offset = Number(contentRange[1]);
      }
    }
    const lengthHeader = response.headers.get("content-length");
    const contentLength =
      lengthHeader !== null && /^\d+$/.test(lengthHeader)
        ? Number(lengthHeader)
        : undefined;
    const { status } = response;
    if (status === 404) {
      void response.body?.cancel().catch(() => {});
      for (const member of this.live.splice(0)) {
        this.resolveMember(member, { kind: "not-found" });
      }
      return this.settle(new Uint8Array(0), { kind: "not-found" });
    }
    if (status !== 206 && status !== 200) {
      void response.body?.cancel().catch(() => {});
      return this.fail(new Error(`${this.file.url.href} answered ${status}`));
    }
    if (status === 200 && this.request !== undefined) {
      // The server ignored `Range`. Take the whole object when it is small
      // enough to be worth it; otherwise nothing it sends is usable.
      if (
        contentLength === undefined ||
        contentLength > this.options.maxRequestBytes
      ) {
        void response.body?.cancel().catch(() => {});
        const length =
          contentLength === undefined
            ? "an unknown length"
            : `${contentLength} bytes`;
        return this.fail(
          new Error(
            `Range request to ${this.file.url.href} answered 200 with ${length}`,
          ),
        );
      }
      this.offset = 0;
      this.base = { offset: 0, length: contentLength };
      if ("suffixLength" in this.request) {
        // The suffix member was addressed relative to the end; place it.
        for (const member of this.live) {
          member.offset = Math.max(
            0,
            contentLength - this.request.suffixLength,
          );
          member.length = contentLength - member.offset;
        }
      }
    }
    const expected = this.base?.length ?? contentLength;
    if (expected !== undefined) {
      this.buffer = new Uint8Array(expected);
    }
    if (response.body !== null) {
      this.reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await this.reader.read();
          if (done || this.cancelled) {
            break;
          }
          const excess = this.append(value);
          this.settleReady();
          if (excess > 0) {
            // The body runs past the range; nothing after it is wanted.
            void this.reader.cancel().catch(() => {});
            break;
          }
          if (this.cancelled) {
            break;
          }
        }
      } catch (error) {
        // A real fetch errors the body when the request is aborted, and on a
        // dropped connection; the first is our own cancellation.
        if (!this.cancelled) {
          return this.fail(error);
        }
      }
    }
    return this.finish(expected, contentLength);
  }

  private finish(
    expected: number | undefined,
    contentLength: number | undefined,
  ): StreamOutcome {
    const bytes = this.collect();
    if (this.cancelled) {
      return this.settle(bytes, { kind: "cancelled" });
    }
    if (expected !== undefined && this.receivedBytes < expected) {
      const clean =
        contentLength === undefined || this.receivedBytes === contentLength;
      if (clean && this.base !== undefined) {
        // The range ran past the end of the object: the object's size is now
        // known and the members past it get what exists, possibly nothing.
        this.size = this.base.offset + this.receivedBytes;
        for (const member of this.live.splice(0)) {
          this.resolveMember(member, {
            kind: "bytes",
            bytes: this.view(member),
          });
        }
        return this.settle(bytes, { kind: "eof", size: this.size });
      }
      const error = new Error(
        `Short read from ${this.file.url.href}: wanted ${expected} bytes at ${this.base?.offset ?? 0}, got ${this.receivedBytes}`,
      );
      for (const member of this.live.splice(0)) {
        this.rejectMember(member, error);
      }
      return this.settle(bytes, { kind: "truncated" });
    }
    for (const member of this.live.splice(0)) {
      // Suffix and whole-object members resolve with everything received.
      this.resolveMember(member, {
        kind: "bytes",
        bytes: this.base !== undefined ? this.view(member) : bytes,
      });
    }
    return this.settle(bytes, { kind: "complete" });
  }

  private fail(error: unknown): StreamOutcome {
    for (const member of this.live.splice(0)) {
      this.rejectMember(member, error);
    }
    return this.settle(this.collect(), { kind: "failed", error });
  }

  private settle(bytes: Uint8Array, end: StreamEnd): StreamOutcome {
    this.isActive = false;
    const outcome: StreamOutcome = { offset: this.offset, bytes, end };
    if (this.size !== undefined) {
      outcome.size = this.size;
    }
    return outcome;
  }

  /** Copy a chunk in, never past the buffer's end. Returns the bytes left over. */
  private append(value: Uint8Array): number {
    if (this.buffer === undefined) {
      this.chunks.push(value);
      this.receivedBytes += value.length;
      return 0;
    }
    const room = this.buffer.length - this.receivedBytes;
    const taken = Math.min(room, value.length);
    this.buffer.set(value.subarray(0, taken), this.receivedBytes);
    this.receivedBytes += taken;
    return value.length - taken;
  }

  /** Resolve every live member whose last byte has arrived. */
  private settleReady(): void {
    if (this.base === undefined) {
      return;
    }
    while (this.live.length > 0) {
      const next = this.live[0]!;
      if (next.offset + next.length - this.base.offset > this.receivedBytes) {
        break;
      }
      this.live.shift();
      this.resolveMember(next, { kind: "bytes", bytes: this.view(next) });
    }
    // Nothing ahead is wanted: every remaining member left by abort. A 200
    // that replaced the range with the whole object is read to its end, as
    // the spec says to consume it.
    if (
      this.live.length === 0 &&
      !this.cancelled &&
      this.base === this.range &&
      this.receivedBytes < this.base.length
    ) {
      this.cancel();
    }
  }

  /** Everything received so far, as one array. */
  private collect(): Uint8Array {
    if (this.buffer !== undefined) {
      // A partial stream must not pin its whole preallocation in the cache.
      return this.receivedBytes < this.buffer.length
        ? this.buffer.slice(0, this.receivedBytes)
        : this.buffer;
    }
    const out = new Uint8Array(this.receivedBytes);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }

  /** A member's bytes as a view into the buffer, clamped to what arrived. */
  private view(member: StreamMember): Uint8Array {
    const start = Math.min(
      member.offset - (this.base?.offset ?? 0),
      this.receivedBytes,
    );
    const end = Math.min(start + member.length, this.receivedBytes);
    return this.buffer!.subarray(start, end);
  }

  /**
   * Add a member to the live set, ordered by end offset. A member whose
   * signal has already aborted is rejected and never joins; one that aborts
   * later leaves the set at once, rejected with its reason, and the stream
   * is cancelled if it was the last.
   */
  private insert(member: StreamMember): void {
    const { signal } = member;
    if (signal?.aborted) {
      member.reject(signal.reason);
      return;
    }
    if (signal !== undefined) {
      const onAbort = () => {
        this.abortListeners.delete(member);
        const at = this.live.indexOf(member);
        if (at < 0) {
          return;
        }
        this.live.splice(at, 1);
        member.reject(signal.reason);
        if (this.isActive && this.live.length === 0) {
          this.cancel();
        }
      };
      this.abortListeners.set(member, onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
    }
    const end = member.offset + member.length;
    let at = this.live.length;
    while (at > 0) {
      const previous = this.live[at - 1]!;
      if (previous.offset + previous.length <= end) {
        break;
      }
      at -= 1;
    }
    this.live.splice(at, 0, member);
  }

  private resolveMember(member: StreamMember, result: ReadResult): void {
    this.forget(member);
    member.resolve(result);
  }

  private rejectMember(member: StreamMember, reason: unknown): void {
    this.forget(member);
    member.reject(reason);
  }

  /** Drop a settled member's abort listener. */
  private forget(member: StreamMember): void {
    const onAbort = this.abortListeners.get(member);
    if (onAbort !== undefined) {
      this.abortListeners.delete(member);
      member.signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Stop the request: nothing ahead is wanted. What arrived is kept. */
  private cancel(): void {
    this.cancelled = true;
    this.controller.abort(
      new DOMException("No read wants the rest of this request", "AbortError"),
    );
    void this.reader?.cancel().catch(() => {});
  }

  /** The best (lowest) priority among live members; 0 when none offers one. */
  private bestPriority(): Priority {
    let best: Priority | undefined;
    for (const member of this.live) {
      const priority = member.getPriority?.() ?? 0;
      if (best === undefined || comparePriorities(priority, best) < 0) {
        best = priority;
      }
    }
    return best ?? 0;
  }

  /**
   * Settle with the response, or reject as soon as the stream is cancelled
   * while the response is still on its way. A response that arrives after
   * the cancellation has its body cancelled.
   */
  private untilCancelled(response: Promise<Response>): Promise<Response> {
    return new Promise((resolve, reject) => {
      const { signal } = this.controller;
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      response.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          if (this.cancelled) {
            void value.body?.cancel().catch(() => {});
          }
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  private rangeHeader(): string | undefined {
    if (this.range !== undefined) {
      return `bytes=${this.range.offset}-${this.range.offset + this.range.length - 1}`;
    }
    if (this.request !== undefined && "suffixLength" in this.request) {
      return `bytes=-${this.request.suffixLength}`;
    }
    return undefined;
  }
}
