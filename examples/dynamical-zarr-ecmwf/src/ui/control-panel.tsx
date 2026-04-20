import type { ColormapId } from "../ecmwf/colormap-choices.js";
import { COLORMAP_CHOICES } from "../ecmwf/colormap-choices.js";
import {
  ECMWF_LEAD_TIME_COUNT,
  ECMWF_LEAD_TIME_HOURS,
} from "../ecmwf/metadata.js";

/**
 * Props for {@link ControlPanel}.
 */
export type ControlPanelProps = {
  leadTimeIdx: number;
  isPlaying: boolean;
  colormapId: ColormapId;
  onLeadTimeIdxChange: (idx: number) => void;
  onPlayPauseToggle: () => void;
  onColormapIdChange: (id: ColormapId) => void;
};

/**
 * Overlay panel with play/pause toggle, lead-time slider, current-hour
 * display, and colormap picker for the ECMWF animation.
 */
export function ControlPanel(props: ControlPanelProps) {
  const {
    leadTimeIdx,
    isPlaying,
    colormapId,
    onLeadTimeIdxChange,
    onPlayPauseToggle,
    onColormapIdChange,
  } = props;
  const hours = ECMWF_LEAD_TIME_HOURS[leadTimeIdx] ?? 0;

  return (
    <div
      style={{
        position: "absolute",
        top: "20px",
        left: "20px",
        background: "white",
        padding: "16px",
        borderRadius: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        width: "300px",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "8px" }}
      >
        ECMWF IFS ENS — 2 m Temperature
      </div>
      <div style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
        Lead time: +{hours} h
      </div>
      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <button
          type="button"
          onClick={onPlayPauseToggle}
          style={{ padding: "4px 10px", cursor: "pointer" }}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={ECMWF_LEAD_TIME_COUNT - 1}
          value={leadTimeIdx}
          onChange={(e) => onLeadTimeIdxChange(Number(e.target.value))}
          style={{ flex: 1, cursor: "pointer" }}
        />
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "12px",
          color: "#666",
        }}
      >
        <span>Colormap:</span>
        <select
          value={colormapId}
          onChange={(e) => onColormapIdChange(e.target.value as ColormapId)}
          style={{ flex: 1, cursor: "pointer" }}
        >
          {COLORMAP_CHOICES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
