/**
 * Options handed to a {@link TileBatcher} dispatch call: a combined signal that
 * aborts only once *every* item in the group has been aborted upstream.
 */
export interface BatchDispatchOptions {
  readonly signal: AbortSignal;
}

interface PendingItem<TItem, TResult> {
  readonly item: TItem;
  readonly signal?: AbortSignal;
  readonly resolve: (value: TResult) => void;
  readonly reject: (reason?: unknown) => void;
}

/** Options for constructing a {@link TileBatcher}. */
export interface TileBatcherOptions<TItem, TResult> {
  /** Compute the batch key for an item; items with the same key share a dispatch. */
  groupKey(item: TItem): string;
  /**
   * Fetch a whole group at once. Returns one entry per `items` element, in
   * order — a value, or an `Error` for that single item. May reject to fail
   * the whole group.
   */
  dispatch(
    key: string,
    items: TItem[],
    opts: BatchDispatchOptions,
  ): Promise<Array<TResult | Error>>;
}

/**
 * Coalesces a burst of per-item `fetch()` calls (e.g. deck.gl's per-tile
 * `getTileData`) into one `dispatch` per group key. The burst is collected on
 * a `setTimeout(_, 0)`, which deterministically fires after the synchronous
 * burst + its microtask tail (see the design doc's "Timing" section).
 */
export class TileBatcher<TItem, TResult> {
  private readonly groupKey: (item: TItem) => string;
  private readonly dispatch: TileBatcherOptions<TItem, TResult>["dispatch"];
  private buffer: Array<PendingItem<TItem, TResult>> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finalized = false;

  constructor(opts: TileBatcherOptions<TItem, TResult>) {
    this.groupKey = opts.groupKey;
    this.dispatch = opts.dispatch;
  }

  /** Buffer an item; resolves to the dispatch's result (or rejects). */
  fetch(
    item: TItem,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<TResult> {
    if (this.finalized) {
      return Promise.reject(new Error("TileBatcher has been finalized"));
    }
    return new Promise<TResult>((resolve, reject) => {
      this.buffer.push({ item, signal, resolve, reject });
      if (this.timer === null) {
        this.timer = setTimeout(() => this.flush(), 0);
      }
    });
  }

  /** Reject everything still buffered; subsequent `fetch` calls reject too. */
  finalize(): void {
    this.finalized = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = this.buffer;
    this.buffer = [];
    for (const p of pending) {
      p.reject(new Error("TileBatcher finalized before flush"));
    }
  }

  private flush(): void {
    this.timer = null;
    const pending = this.buffer;
    this.buffer = [];

    // Drop already-aborted items.
    const alive: Array<PendingItem<TItem, TResult>> = [];
    for (const p of pending) {
      if (p.signal?.aborted) {
        p.reject(p.signal.reason);
      } else {
        alive.push(p);
      }
    }

    // Group by key.
    const groups = new Map<string, Array<PendingItem<TItem, TResult>>>();
    for (const p of alive) {
      const key = this.groupKey(p.item);
      const group = groups.get(key);
      if (group) {
        group.push(p);
      } else {
        groups.set(key, [p]);
      }
    }

    for (const [key, group] of groups) {
      void this.dispatchGroup(key, group);
    }
  }

  private async dispatchGroup(
    key: string,
    group: Array<PendingItem<TItem, TResult>>,
  ): Promise<void> {
    const composite = compositeAbortSignal(group.map((p) => p.signal));
    let results: Array<TResult | Error>;
    try {
      results = await this.dispatch(
        key,
        group.map((p) => p.item),
        { signal: composite },
      );
    } catch (err) {
      for (const p of group) {
        p.reject(err);
      }
      return;
    }
    for (let i = 0; i < group.length; i++) {
      const p = group[i]!;
      const r = results[i];
      if (p.signal?.aborted) {
        p.reject(p.signal.reason);
      } else if (r instanceof Error) {
        p.reject(r);
      } else {
        p.resolve(r as TResult);
      }
    }
  }
}

/**
 * An `AbortSignal` that fires only once *every* input signal has aborted. Any
 * `undefined` in the input means "never aborts" so the composite never aborts.
 */
function compositeAbortSignal(
  signals: Array<AbortSignal | undefined>,
): AbortSignal {
  if (signals.length === 0 || signals.some((s) => s === undefined)) {
    return new AbortController().signal;
  }
  const real = signals as AbortSignal[];
  const controller = new AbortController();
  let remaining = real.length;
  for (const s of real) {
    if (s.aborted) {
      remaining--;
    } else {
      s.addEventListener(
        "abort",
        () => {
          remaining--;
          if (remaining === 0) {
            controller.abort(s.reason);
          }
        },
        { once: true },
      );
    }
  }
  if (remaining === 0) {
    controller.abort(real[0]!.reason);
  }
  return controller.signal;
}
