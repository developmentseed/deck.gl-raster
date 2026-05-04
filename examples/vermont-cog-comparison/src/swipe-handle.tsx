import type {
  CSSProperties,
  JSX,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useRef } from "react";

/** Inputs to {@link SwipeHandle}. */
export type SwipeHandleProps = {
  /** Current handle position as a fraction of the canvas width, in [0, 1]. */
  fraction: number;
  /** Called when the user drags the handle. Throttled to one update per animation frame. */
  onChange: (next: number) => void;
  /**
   * Lower bound (default 0.05) and upper bound (default 0.95) clamp the
   * handle so each side keeps a minimum visible strip.
   */
  min?: number;
  max?: number;
};

/**
 * A vertical drag handle overlaid on the deck.gl canvas. Clicking and
 * dragging the handle (or anywhere on the line) updates `fraction`.
 *
 * Touch and mouse are handled uniformly via pointer events. Updates are
 * coalesced to `requestAnimationFrame` so React re-renders stay at one
 * per frame regardless of pointermove rate.
 *
 * The handle is rendered as a 2px white-translucent line spanning the
 * canvas height, with a circular grabber centered vertically. The
 * surrounding wrapper has `pointerEvents: "auto"` so the handle is
 * clickable; the rest of the overlay container is `pointerEvents: "none"`
 * so map drags pass through.
 */
export function SwipeHandle(props: SwipeHandleProps): JSX.Element {
  const { fraction, onChange, min = 0.05, max = 0.95 } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  function commit(next: number) {
    pendingRef.current = next;
    if (rafIdRef.current !== null) {
      return;
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const queued = pendingRef.current;
      pendingRef.current = null;
      if (queued !== null) {
        onChange(queued);
      }
    });
  }

  function fractionFromClientX(clientX: number): number {
    const container = containerRef.current;
    if (!container) {
      return fraction;
    }
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) {
      return fraction;
    }
    const raw = (clientX - rect.left) / rect.width;
    return Math.min(Math.max(raw, min), max);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const onMove = (e: PointerEvent) => commit(fractionFromClientX(e.clientX));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    commit(fractionFromClientX(event.clientX));
  }

  const containerStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 4,
  };

  const handleStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: `calc(${fraction * 100}% - 12px)`,
    width: 24,
    cursor: "ew-resize",
    touchAction: "none",
    pointerEvents: "auto",
  };

  return (
    <div ref={containerRef} style={containerStyle}>
      {/* biome-ignore lint/a11y/useSemanticElements: this separator is a draggable click target, not a static <hr>. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={Math.round(min * 100)}
        aria-valuemax={Math.round(max * 100)}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        style={handleStyle}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 11,
            width: 2,
            background: "rgba(255, 255, 255, 0.85)",
            boxShadow: "0 0 4px rgba(0, 0, 0, 0.5)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            transform: "translateY(-50%)",
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "white",
            boxShadow: "0 1px 4px rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#444",
            fontSize: 14,
            fontWeight: 700,
            userSelect: "none",
          }}
        >
          ⇆
        </div>
      </div>
    </div>
  );
}
