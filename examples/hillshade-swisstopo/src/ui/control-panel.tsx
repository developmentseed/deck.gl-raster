import { useState } from "react";

export type RenderMode = "hillshade" | "dem";

export type ControlPanelProps = {
  renderMode: RenderMode;
  azimuth: number;
  altitude: number;
  zFactor: number;
  tintStrength: number;
  shadowStrength: number;
  contourStrength: number;
  onRenderModeChange: (mode: RenderMode) => void;
  onAzimuthChange: (value: number) => void;
  onAltitudeChange: (value: number) => void;
  onZFactorChange: (value: number) => void;
  onTintStrengthChange: (value: number) => void;
  onShadowStrengthChange: (value: number) => void;
  onContourStrengthChange: (value: number) => void;
};

const labelStyle = {
  display: "block",
  fontSize: "12px",
  color: "#666",
  marginBottom: "12px",
} as const;

const rangeStyle = {
  width: "100%",
  cursor: "pointer",
} as const;

function modeButtonStyle(active: boolean) {
  return {
    border: 0,
    borderRadius: "6px",
    background: active ? "#333" : "transparent",
    color: active ? "white" : "#333",
    cursor: "pointer",
    font: "inherit",
    fontSize: "12px",
    fontWeight: active ? "bold" : "normal",
    padding: "7px 10px",
  } as const;
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={labelStyle}>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={rangeStyle}
      />
    </label>
  );
}

export function ControlPanel(props: ControlPanelProps) {
  const {
    renderMode,
    azimuth,
    altitude,
    zFactor,
    tintStrength,
    shadowStrength,
    contourStrength,
    onRenderModeChange,
    onAzimuthChange,
    onAltitudeChange,
    onZFactorChange,
    onTintStrengthChange,
    onShadowStrengthChange,
    onContourStrengthChange,
  } = props;

  const [panelOpen, setPanelOpen] = useState(true);

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
        width: "320px",
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => setPanelOpen((o) => !o)}
        style={{
          all: "unset",
          width: "100%",
          fontSize: "16px",
          fontWeight: "bold",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          userSelect: "none",
          marginBottom: panelOpen ? "8px" : 0,
        }}
      >
        swissALTI3D Hillshade
        <span
          style={{
            fontSize: "12px",
            transition: "transform 0.2s",
            transform: panelOpen ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        >
          ▼
        </span>
      </button>

      {panelOpen && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px",
              padding: "3px",
              background: "#f3f3f3",
              borderRadius: "8px",
              marginBottom: "12px",
            }}
          >
            <button
              type="button"
              style={modeButtonStyle(renderMode === "hillshade")}
              onClick={() => onRenderModeChange("hillshade")}
            >
              Hillshade
            </button>
            <button
              type="button"
              style={modeButtonStyle(renderMode === "dem")}
              onClick={() => onRenderModeChange("dem")}
            >
              DEM only
            </button>
          </div>

          {renderMode === "hillshade" && (
            <>
              <RangeControl
                label={`Sun azimuth: ${azimuth} deg`}
                min={0}
                max={360}
                value={azimuth}
                onChange={onAzimuthChange}
              />
              <RangeControl
                label={`Sun altitude: ${altitude} deg`}
                min={8}
                max={80}
                value={altitude}
                onChange={onAltitudeChange}
              />
              <RangeControl
                label={`Relief: ${zFactor.toFixed(2)}x`}
                min={0.4}
                max={3}
                step={0.05}
                value={zFactor}
                onChange={onZFactorChange}
              />
              <RangeControl
                label={`Color wash: ${Math.round(tintStrength * 100)}%`}
                min={0}
                max={1}
                step={0.01}
                value={tintStrength}
                onChange={onTintStrengthChange}
              />
              <RangeControl
                label={`Shadow depth: ${Math.round(shadowStrength * 100)}%`}
                min={0}
                max={1.4}
                step={0.01}
                value={shadowStrength}
                onChange={onShadowStrengthChange}
              />
              <RangeControl
                label={`Form lines: ${Math.round(contourStrength * 100)}%`}
                min={0}
                max={1}
                step={0.01}
                value={contourStrength}
                onChange={onContourStrengthChange}
              />
            </>
          )}

          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: "11px",
              color: "#666",
              lineHeight: 1.4,
            }}
          >
            swissALTI3D 2024, 2 m COG, EPSG:2056. Matterhorn/Zermatt, Federal
            Office of Topography swisstopo.
          </p>
        </>
      )}
    </div>
  );
}
