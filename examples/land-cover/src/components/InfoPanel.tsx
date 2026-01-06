import { Legend } from "./Legend";

interface InfoPanelProps {
  debug: boolean;
  debugOpacity: number;
  onDebugChange: (checked: boolean) => void;
  onDebugOpacityChange: (opacity: number) => void;
}

export function InfoPanel({
  debug,
  debugOpacity,
  onDebugChange,
  onDebugOpacityChange,
}: InfoPanelProps) {
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
        maxWidth: "300px",
        pointerEvents: "auto",
      }}
    >
      <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>
        NLCD Land Cover Classification
      </h3>
      <Legend />

      <div
        style={{
          padding: "12px 0",
          borderTop: "1px solid #eee",
          marginTop: "12px",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "14px",
            cursor: "pointer",
            marginBottom: "12px",
          }}
        >
          <input
            type="checkbox"
            checked={debug}
            onChange={(e) => onDebugChange(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <span>Show Debug Mesh</span>
        </label>

        {debug && (
          <div style={{ marginTop: "8px" }}>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#666",
                marginBottom: "4px",
              }}
            >
              Debug Opacity: {debugOpacity.toFixed(2)}
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={debugOpacity}
                onChange={(e) =>
                  onDebugOpacityChange(parseFloat(e.target.value))
                }
                style={{ width: "100%", cursor: "pointer" }}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
