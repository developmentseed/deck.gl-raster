import * as Slider from "@radix-ui/react-slider";
import { useState } from "react";
import { NUM_YEARS, YEAR_ORIGIN } from "../aef/constants.js";
import type { Location } from "../aef/locations.js";
import { LOCATIONS } from "../aef/locations.js";

const RESCALE_MIN_BOUND = -1;
const RESCALE_MAX_BOUND = 1;
const RESCALE_STEP = 0.01;

/**
 * A small circled "i" that reveals a tooltip immediately on hover/focus —
 * avoids the long delay on the browser's native `title` attribute.
 */
function InfoTooltip({ label, body }: { label: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "14px",
        height: "14px",
        padding: 0,
        borderRadius: "50%",
        border: "1px solid #aaa",
        background: "transparent",
        fontSize: "10px",
        fontStyle: "italic",
        fontFamily: "serif",
        fontWeight: "bold",
        color: "#666",
        cursor: "help",
        outline: "none",
      }}
    >
      i
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            left: 0,
            top: "calc(100% + 6px)",
            width: "260px",
            padding: "8px 10px",
            background: "#222",
            color: "white",
            fontSize: "13px",
            fontStyle: "normal",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            fontWeight: "normal",
            lineHeight: 1.45,
            letterSpacing: "normal",
            borderRadius: "4px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            pointerEvents: "none",
            zIndex: 1100,
            textAlign: "left",
            whiteSpace: "normal",
          }}
        >
          {body}
        </span>
      )}
    </button>
  );
}

/**
 * Props for {@link ControlPanel}.
 */
export type ControlPanelProps = {
  locationId: string;
  yearIdx: number;
  bandLabels: readonly string[] | null;
  rBandIdx: number;
  gBandIdx: number;
  bBandIdx: number;
  rescaleMin: number;
  rescaleMax: number;
  onLocationChange: (location: Location) => void;
  onYearIdxChange: (idx: number) => void;
  onRBandIdxChange: (idx: number) => void;
  onGBandIdxChange: (idx: number) => void;
  onBBandIdxChange: (idx: number) => void;
  onRescaleMinChange: (v: number) => void;
  onRescaleMaxChange: (v: number) => void;
};

/**
 * Overlay control panel: location picker, year slider, three band
 * dropdowns (R/G/B), shared rescale range slider.
 */
export function ControlPanel(props: ControlPanelProps) {
  const {
    locationId,
    yearIdx,
    bandLabels,
    rBandIdx,
    gBandIdx,
    bBandIdx,
    rescaleMin,
    rescaleMax,
    onLocationChange,
    onYearIdxChange,
    onRBandIdxChange,
    onGBandIdxChange,
    onBBandIdxChange,
    onRescaleMinChange,
    onRescaleMaxChange,
  } = props;

  const [panelOpen, setPanelOpen] = useState(true);

  const handleLocationSelect = (id: string) => {
    const next = LOCATIONS.find((l) => l.id === id);
    if (next) {
      onLocationChange(next);
    }
  };

  const handleRescaleChange = (range: number[]) => {
    const [nextMin, nextMax] = range;
    if (nextMin !== undefined && nextMin !== rescaleMin) {
      onRescaleMinChange(nextMin);
    }
    if (nextMax !== undefined && nextMax !== rescaleMax) {
      onRescaleMaxChange(nextMax);
    }
  };

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
        AlphaEarth Foundations Mosaic
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
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              color: "#666",
              marginBottom: "12px",
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>Location:</span>
            <select
              value={locationId}
              onChange={(e) => handleLocationSelect(e.target.value)}
              style={{ flex: 1, cursor: "pointer" }}
            >
              {LOCATIONS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              color: "#666",
              marginBottom: "16px",
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>Year:</span>
            <select
              value={yearIdx}
              onChange={(e) => onYearIdxChange(Number(e.target.value))}
              style={{ flex: 1, cursor: "pointer" }}
            >
              {Array.from({ length: NUM_YEARS }, (_, i) => {
                const year = YEAR_ORIGIN + i;
                return (
                  <option key={year} value={i}>
                    {year}
                  </option>
                );
              })}
            </select>
          </label>

          <BandSlider
            label="Red band"
            value={rBandIdx}
            labels={bandLabels}
            onChange={onRBandIdxChange}
          />
          <BandSlider
            label="Green band"
            value={gBandIdx}
            labels={bandLabels}
            onChange={onGBandIdxChange}
          />
          <BandSlider
            label="Blue band"
            value={bBandIdx}
            labels={bandLabels}
            onChange={onBBandIdxChange}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#666",
              marginBottom: "4px",
              marginTop: "8px",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              Rescale range
              <InfoTooltip
                label="Rescale range info"
                body={
                  "Maps dequantized band values (roughly −1…1 after " +
                  "(v/127.5)² · sign(v)) onto the 0…1 display range before " +
                  "RGB assembly. Values below the lower bound clamp to 0; " +
                  "above the upper bound clamp to 1. Narrower = higher " +
                  "contrast; wider = more headroom at the extremes. Same " +
                  "range is applied to all three channels."
                }
              />
            </span>
            <span>
              {rescaleMin.toFixed(2)} – {rescaleMax.toFixed(2)}
            </span>
          </div>
          <Slider.Root
            min={RESCALE_MIN_BOUND}
            max={RESCALE_MAX_BOUND}
            step={RESCALE_STEP}
            value={[rescaleMin, rescaleMax]}
            onValueChange={handleRescaleChange}
            minStepsBetweenThumbs={1}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              userSelect: "none",
              touchAction: "none",
              height: "20px",
              marginBottom: "4px",
            }}
          >
            <Slider.Track
              style={{
                position: "relative",
                flexGrow: 1,
                height: "4px",
                background: "#ddd",
                borderRadius: "2px",
              }}
            >
              <Slider.Range
                style={{
                  position: "absolute",
                  height: "100%",
                  background: "#4a7c59",
                  borderRadius: "2px",
                }}
              />
            </Slider.Track>
            {(["min", "max"] as const).map((key) => (
              <Slider.Thumb
                key={key}
                aria-label={key === "min" ? "Rescale min" : "Rescale max"}
                style={{
                  display: "block",
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  background: "#4a7c59",
                  border: "2px solid white",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                  cursor: "pointer",
                  outline: "none",
                }}
              />
            ))}
          </Slider.Root>
          <div
            style={{
              marginTop: "16px",
              paddingTop: "12px",
              borderTop: "1px solid #eee",
              fontSize: "11px",
              color: "#888",
              lineHeight: 1.4,
            }}
          >
            <a
              href="https://source.coop/tge-labs/aef-mosaic"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "inherit" }}
            >
              AlphaEarth Foundations GeoZarr Mosaic
            </a>{" "}
            — annual 10 m embeddings, 2017–2025.
          </div>
        </>
      )}
    </div>
  );
}

type BandSliderProps = {
  label: string;
  value: number;
  labels: readonly string[] | null;
  onChange: (idx: number) => void;
};

function BandSlider(props: BandSliderProps) {
  const { label, value, labels, onChange } = props;
  const bandLabel = labels?.[value] ?? `Band ${value}`;
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "12px",
        color: "#666",
        marginBottom: "6px",
      }}
    >
      <span
        style={{
          whiteSpace: "nowrap",
          minWidth: "130px",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {label}: {bandLabel}
      </span>
      <input
        type="range"
        min={0}
        max={63}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, cursor: "pointer" }}
      />
    </label>
  );
}
