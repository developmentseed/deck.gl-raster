import {
  DATE_COUNT,
  VARIABLES,
  type VariableKey,
} from "../anomaly/metadata.js";

type QueryInfo = { lat: number; lon: number; anom: number; std: number };

export type ControlPanelProps = {
  dateIdx: number;
  dates: string[];
  variable: VariableKey;
  query: QueryInfo | null;
  isPlaying: boolean;
  onDateIdxChange: (idx: number) => void;
  onVariableChange: (v: VariableKey) => void;
  onPlayPauseToggle: () => void;
};

export function ControlPanel(props: ControlPanelProps) {
  const {
    dateIdx,
    dates,
    variable,
    query,
    isPlaying,
    onDateIdxChange,
    onVariableChange,
    onPlayPauseToggle,
  } = props;
  const currentDate = dates[dateIdx] ?? "—";

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
        style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "4px" }}
      >
        Temperature Anomaly
      </div>
      <div style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
        vs 1990–2020 climatology · {currentDate}
      </div>
      <select
        value={variable}
        onChange={(e) => onVariableChange(e.target.value as VariableKey)}
        style={{
          width: "100%",
          marginBottom: "12px",
          padding: "4px",
          cursor: "pointer",
        }}
      >
        {VARIABLES.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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
          max={DATE_COUNT - 1}
          value={dateIdx}
          onChange={(e) => onDateIdxChange(Number(e.target.value))}
          style={{ flex: 1, cursor: "pointer" }}
        />
      </div>
      {query !== null && (
        <div
          style={{
            marginTop: "12px",
            paddingTop: "12px",
            borderTop: "1px solid #eee",
            fontSize: "12px",
          }}
        >
          <div style={{ color: "#666", marginBottom: "6px" }}>
            {query.lat.toFixed(2)}°, {query.lon.toFixed(2)}°
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "4px",
            }}
          >
            <span style={{ color: "#666" }}>Anomaly</span>
            <span style={{ fontWeight: "bold" }}>
              {query.anom.toFixed(2)} °C
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#666" }}>Standard deviation</span>
            <span style={{ fontWeight: "bold" }}>{query.std.toFixed(2)} σ</span>
          </div>
        </div>
      )}
    </div>
  );
}
