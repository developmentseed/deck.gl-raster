import React, { useState } from "react";

interface ColorMapDemoProps {
  colormaps?: string[];
}

const GRADIENTS: Record<string, string> = {
  viridis:
    "linear-gradient(to right, #440154, #482878, #3e4989, #31688e, #26828e, #1f9e89, #35b779, #6ece58, #b5de2b, #fde725)",
  plasma:
    "linear-gradient(to right, #0d0887, #46039f, #7201a8, #9c179e, #bd3786, #d8576b, #ed7953, #fb9f3a, #fdca26, #f0f921)",
  inferno:
    "linear-gradient(to right, #000004, #1b0c41, #4a0c6b, #781c6d, #a52c60, #cf4446, #ed6925, #fb9b06, #f7d13d, #fcffa4)",
  magma:
    "linear-gradient(to right, #000004, #180f3d, #440f76, #721f81, #9e2f7f, #cd4071, #f1605d, #fd9668, #feca8d, #fcfdbf)",
  terrain:
    "linear-gradient(to right, #333399, #1a9850, #91cf60, #d9ef8b, #fee08b, #fc8d59, #d73027, #ffffff)",
  coolwarm:
    "linear-gradient(to right, #3b4cc0, #6788ee, #9abbff, #c9d7f0, #edd1c2, #f7a889, #e26952, #b40426)",
};

export default function ColorMapDemo({
  colormaps = ["viridis", "plasma", "inferno", "magma", "terrain", "coolwarm"],
}: ColorMapDemoProps): JSX.Element {
  const [selected, setSelected] = useState(colormaps[0]);

  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid var(--ifm-color-emphasis-300)",
        borderRadius: "8px",
        marginBottom: "1rem",
      }}
    >
      <div style={{ marginBottom: "1rem" }}>
        <label
          htmlFor="colormap-select"
          style={{ fontWeight: "bold", marginRight: "0.5rem" }}
        >
          Select a colormap:
        </label>
        <select
          id="colormap-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{
            padding: "0.5rem",
            borderRadius: "4px",
            border: "1px solid var(--ifm-color-emphasis-300)",
          }}
        >
          {colormaps.map((cm) => (
            <option key={cm} value={cm}>
              {cm}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          height: "40px",
          borderRadius: "4px",
          background: GRADIENTS[selected] || GRADIENTS["viridis"],
          marginBottom: "0.5rem",
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.875rem",
          color: "var(--ifm-color-emphasis-600)",
        }}
      >
        <span>0</span>
        <span>0.5</span>
        <span>1</span>
      </div>

      <p style={{ marginTop: "1rem", fontSize: "0.875rem" }}>
        The <code>{selected}</code> colormap is commonly used for{" "}
        {selected === "terrain"
          ? "elevation and topographic data"
          : selected === "coolwarm"
            ? "diverging data like temperature anomalies"
            : "sequential data visualization"}
        .
      </p>
    </div>
  );
}
