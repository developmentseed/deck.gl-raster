import type { CSSProperties, MouseEvent } from "react";
import { SLIDE_WIDTH } from "../scene/layout.js";

/** A slider's state, for steps that can be scrubbed. */
export type ScrubberState = {
  /** Number of positions, numbered 0 to `count - 1`. */
  count: number;
  /** Current position. */
  position: number;
  /** Text for the current position. */
  label: string;
};

/** Props of {@link ControlBar}. */
export type ControlBarProps = {
  /** Step titles, in order. */
  titles: string[];
  /** Index of the step showing. */
  stepIndex: number;
  /** Whether the bar is shown; it fades out while the mouse is idle. */
  visible: boolean;
  /** Whether step descriptions are shown. */
  descriptions: boolean;
  /** Whether the player is paused by the slider. */
  paused: boolean;
  /** The current step's slider, if it has one. */
  scrubber: ScrubberState | null;
  /** Called when the descriptions checkbox changes. */
  onDescriptionsChange: (descriptions: boolean) => void;
  /** Go to the previous step. */
  onPrevious: () => void;
  /** Finish the current step, or go to the next one. */
  onNext: () => void;
  /** Restart the current step. */
  onReplay: () => void;
  /** Continue playing after the slider paused. */
  onResume: () => void;
  /** Start a step from the beginning. */
  onJump: (index: number) => void;
  /** Pause the current step at a slider position. */
  onScrub: (position: number) => void;
  /** Called when the pointer enters or leaves the bar, to keep it shown. */
  onHoverChange: (hovering: boolean) => void;
  /**
   * Whether to drop a click, e.g. the tap that just revealed the hidden bar,
   * which would otherwise press the control under the finger.
   */
  shouldIgnoreClick: () => boolean;
};

/** Top of the bar, in slide units. */
const BAR_TOP = 1000;

const BUTTON: CSSProperties = {
  background: "#21262d",
  color: "#e6edf3",
  border: "1px solid #30363d",
  borderRadius: 6,
  padding: "6px 14px",
  fontSize: 18,
  cursor: "pointer",
};

const DISABLED_BUTTON: CSSProperties = {
  ...BUTTON,
  opacity: 0.4,
  cursor: "default",
};

/**
 * Keep mouse clicks from focusing a control. A focused control would keep
 * taking keys (Space, PageDown) after the bar fades out, which breaks a
 * presentation clicker. Keyboard focus (Tab) still works.
 */
function preventFocus(event: MouseEvent): void {
  event.preventDefault();
}

/**
 * On-screen controls for people viewing on their own: previous and next
 * buttons, clickable step dots, replay, the step's slider, and the
 * descriptions checkbox. Laid out in slide units inside the HUD.
 */
export function ControlBar(props: ControlBarProps) {
  const { titles, stepIndex, visible, descriptions, paused, scrubber } = props;
  const first = stepIndex === 0;
  const last = stepIndex === titles.length - 1;
  return (
    <div
      data-control-bar
      onPointerEnter={() => props.onHoverChange(true)}
      onPointerLeave={() => props.onHoverChange(false)}
      onClickCapture={(event) => {
        if (props.shouldIgnoreClick()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      style={{
        position: "absolute",
        left: 0,
        top: BAR_TOP,
        width: SLIDE_WIDTH,
        display: "flex",
        justifyContent: "center",
        opacity: visible ? 1 : 0,
        transition: "opacity 400ms",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 18px",
          background: "rgba(13, 17, 23, 0.85)",
          border: "1px solid #30363d",
          borderRadius: 10,
          fontSize: 18,
          color: "#e6edf3",
        }}
      >
        <button
          type="button"
          style={first ? DISABLED_BUTTON : BUTTON}
          onMouseDown={preventFocus}
          onClick={props.onPrevious}
          disabled={first}
          title="Previous step (←)"
        >
          ‹ Prev
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          {titles.map((title, i) => (
            <button
              key={title}
              type="button"
              title={`${i + 1}. ${title}`}
              aria-label={`Go to step ${i + 1}: ${title}`}
              onMouseDown={preventFocus}
              onClick={() => props.onJump(i)}
              style={{
                width: 14,
                height: 14,
                padding: 0,
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                background: i === stepIndex ? "#e6edf3" : "#484f58",
              }}
            />
          ))}
        </div>
        <button
          type="button"
          style={last ? DISABLED_BUTTON : BUTTON}
          onMouseDown={preventFocus}
          onClick={props.onNext}
          disabled={last}
          title="Next step (→)"
        >
          Next ›
        </button>
        <button
          type="button"
          style={BUTTON}
          onMouseDown={preventFocus}
          onClick={paused ? props.onResume : props.onReplay}
          title={paused ? "Continue playing" : "Replay this step (R)"}
        >
          {paused ? "▶ Play" : "↻ Replay"}
        </button>
        {scrubber ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="range"
              aria-label="Refinement step"
              min={0}
              max={scrubber.count - 1}
              step={1}
              value={scrubber.position}
              onChange={(event) => props.onScrub(Number(event.target.value))}
              // Dragging needs focus; give it back once the drag ends.
              onPointerUp={(event) => event.currentTarget.blur()}
              style={{ width: 260 }}
            />
            <span
              style={{
                minWidth: 150,
                fontVariantNumeric: "tabular-nums",
                color: "#8b949e",
              }}
            >
              {scrubber.label}
            </span>
          </div>
        ) : null}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
          }}
          title="Show or hide the description of each step (D)"
        >
          <input
            type="checkbox"
            checked={descriptions}
            onChange={(event) => {
              props.onDescriptionsChange(event.target.checked);
              // A label click focuses the box; don't keep it.
              event.currentTarget.blur();
            }}
            style={{ width: 18, height: 18 }}
          />
          Descriptions
        </label>
      </div>
    </div>
  );
}
