import { _Tile2DHeader } from "@deck.gl/geo-layers";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";

// TEMP DIAGNOSTIC — track every change to `_isCancelled` and every onError
// call so we can pinpoint why AbortError reaches onTileError.
{
  type TileState = Record<string, unknown> & {
    id?: string;
    __cancelTrace?: string[];
  };
  const proto = _Tile2DHeader.prototype as unknown as {
    abort: (this: TileState) => void;
    _loadData: (
      this: TileState,
      opts: { onError: (err: unknown, tile: unknown) => void },
    ) => Promise<void>;
  };

  // Replace _isCancelled with a getter/setter that records every write into
  // an in-memory ring buffer per tile (prev->value with a label, no stack
  // capture so we don't tank perf during fast pans).
  const STORE = "__cancelStore";
  let activeLabel = "init";
  const labeled = <T,>(label: string, fn: () => T): T => {
    const prev = activeLabel;
    activeLabel = label;
    try {
      return fn();
    } finally {
      activeLabel = prev;
    }
  };
  Object.defineProperty(_Tile2DHeader.prototype, "_isCancelled", {
    configurable: true,
    get(this: TileState) {
      return (this as Record<string, unknown>)[STORE] as boolean;
    },
    set(this: TileState, value: boolean) {
      const prev = (this as Record<string, unknown>)[STORE];
      (this as Record<string, unknown>)[STORE] = value;
      if (!this.__cancelTrace) {
        this.__cancelTrace = [];
      }
      this.__cancelTrace.push(`${prev}->${value} @ ${activeLabel}`);
      if (this.__cancelTrace.length > 30) {
        this.__cancelTrace.shift();
      }
    },
  });

  const origAbort = proto.abort;
  proto.abort = function patchedAbort(this: TileState) {
    return labeled(`abort#${this.id}`, () => origAbort.call(this));
  };

  // Assign a stable id to each AbortSignal created so we can tell whose
  // signal is whose.
  let nextSignalId = 0;
  const idFor = (
    signal: (AbortSignal & { __id?: string }) | null | undefined,
  ): string => {
    if (!signal) {
      return "<none>";
    }
    if (signal.__id === undefined) {
      Object.defineProperty(signal, "__id", {
        value: `sig#${nextSignalId++}`,
        enumerable: false,
      });
    }
    return signal.__id as string;
  };

  // Patch AbortController to give each new signal an id at construction.
  const OrigController = window.AbortController;
  class TaggedController extends OrigController {
    constructor() {
      super();
      idFor(this.signal);
    }
  }
  window.AbortController = TaggedController;

  // Patch AbortController.prototype.abort to log every call regardless of
  // caller (tile.abort, or anything else).
  const origCtrlAbort = OrigController.prototype.abort;
  OrigController.prototype.abort = function patchedCtrlAbort(
    this: AbortController,
    reason?: unknown,
  ) {
    console.warn("[diag] controller.abort()", {
      sig: idFor(this.signal),
      activeLabel,
      stack: new Error().stack?.split("\n").slice(2, 6).join(" | "),
    });
    return origCtrlAbort.call(this, reason);
  };

  const origLoadData = proto._loadData;
  proto._loadData = async function patchedLoadData(
    this: TileState,
    opts: { onError: (err: unknown, tile: unknown) => void },
  ) {
    const myLoaderId = this._loaderId;
    const tag = `[diag] _loadData#${myLoaderId} ${this.id}`;
    const wrappedOnError = (err: unknown, tile: unknown) => {
      const ctrl = this._abortController as AbortController | null;
      console.warn(`${tag} onError FIRED`, {
        err,
        ownSignal: idFor(ctrl?.signal),
        ownSignalAborted: ctrl?.signal.aborted,
        ownSignalReason: ctrl?.signal.reason,
        cancelTrace: this.__cancelTrace?.slice(),
        contentNull: this.content === null,
        currentLoaderId: this._loaderId,
        myLoaderId,
      });
      return opts.onError(err, tile);
    };
    return labeled(`loadData#${myLoaderId}/${this.id}`, () =>
      origLoadData.call(this, { ...opts, onError: wrappedOnError }),
    );
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
