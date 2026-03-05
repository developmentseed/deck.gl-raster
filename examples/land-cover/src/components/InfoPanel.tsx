import { HelpIcon } from "./HelpIcon";
import { Legend } from "./Legend";

interface InfoPanelProps {
  debug: boolean;
  debugOpacity: number;
  meshMaxError: number;
  onDebugChange: (checked: boolean) => void;
  onDebugOpacityChange: (opacity: number) => void;
  onMeshMaxErrorChange: (error: number) => void;
}

const helpIconTooltip = `
Red squares depict the underlying COG tile structure.

Triangles depict the GPU-based reprojection. Instead of per-pixel reprojection, we generate an adaptive triangular mesh. Each triangle locally approximates the non-linear reprojection function, ensuring minimal distortion.
`;

const meshMaxErrorTooltip = `
Controls the maximum allowed reprojection error (in source pixels) for the adaptive triangular mesh.

Lower values produce more triangles and higher accuracy at the cost of performance. Higher values use fewer triangles and render faster but with less precise reprojection.
`;

export function InfoPanel({
  debug,
  debugOpacity,
  meshMaxError,
  onDebugChange,
  onDebugOpacityChange,
  onMeshMaxErrorChange,
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
      <h3
        style={{
          margin: "0 0 8px 0",
          fontSize: "16px",
          paddingBottom: "8px",
          borderBottom: "1px solid #eee",
        }}
      >
        NLCD Land Cover Classification
      </h3>

      <p style={{ margin: "8px 0", fontSize: "14px", color: "#666" }}>
        A <b>1.3GB</b>{" "}
        <a href="https://cogeo.org/" target="_blank" rel="noopener noreferrer">
          Cloud-Optimized GeoTIFF
        </a>{" "}
        rendered in the browser with <b>no server</b> using{" "}
        <a
          href="https://github.com/developmentseed/deck.gl-raster"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: "monospace",
          }}
        >
          @developmentseed/deck.gl-raster
        </a>
        .
        <br />
      </p>

      <Legend />

      <div
        style={{
          padding: "12px 0",
          borderTop: "1px solid #eee",
          marginTop: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "12px",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              cursor: "pointer",
              color: "#666",
            }}
          >
            <input
              type="checkbox"
              checked={debug}
              onChange={(e) => onDebugChange(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <span>Show Debug Overlay</span>
          </label>
          <HelpIcon tooltip={helpIconTooltip} />
        </div>

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

        <div style={{ marginTop: "8px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            <label
              htmlFor="mesh-max-error"
              style={{
                fontSize: "12px",
                color: "#666",
              }}
            >
              Mesh Max Error: {meshMaxError.toFixed(3)}
            </label>
            <HelpIcon tooltip={meshMaxErrorTooltip} />
          </div>
          <input
            id="mesh-max-error"
            type="range"
            min="0.01"
            max="5"
            step="0.01"
            value={meshMaxError}
            onChange={(e) => onMeshMaxErrorChange(parseFloat(e.target.value))}
            style={{ width: "100%", cursor: "pointer" }}
          />
        </div>
      </div>
    </div>
  );
}
