import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import * as Slider from "@radix-ui/react-slider";
import { useState } from "react";
import type { ColormapId } from "../ecmwf/colormap-choices.js";
import { COLORMAP_CHOICES } from "../ecmwf/colormap-choices.js";
import {
  dateFromInitTimeIdx,
  ECMWF_INIT_TIME_ORIGIN,
  ECMWF_LEAD_TIME_COUNT,
  ECMWF_LEAD_TIME_HOURS,
  initTimeIdxFromDate,
  isoDateString,
} from "../ecmwf/metadata.js";

/** Total number of rows in the shipped colormap sprite. */
const COLORMAP_SPRITE_HEIGHT = Object.keys(COLORMAP_INDEX).length;
/** Displayed row height for the preview strip (vertically stretched from 1px). */
const PREVIEW_ROW_HEIGHT = 14;

/** Bounds for the rescale min/max sliders (°C). */
const TEMP_SLIDER_MIN = -80;
const TEMP_SLIDER_MAX = 60;
const TEMP_SLIDER_STEP = 1;

/** Bounds for the frame-duration slider (ms). */
const FRAME_MS_MIN = 50;
const FRAME_MS_MAX = 300;
const FRAME_MS_STEP = 10;

/** Filled right-pointing triangle — play icon. */
function PlayIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      focusable="false"
    >
      <title>Play</title>
      <path d="M3 2 L12 7 L3 12 Z" fill="currentColor" />
    </svg>
  );
}

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
            left: "50%",
            transform: "translateX(-50%)",
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

/** Two vertical bars — pause icon. */
function PauseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      focusable="false"
    >
      <title>Pause</title>
      <rect x="3" y="2" width="3" height="10" fill="currentColor" />
      <rect x="8" y="2" width="3" height="10" fill="currentColor" />
    </svg>
  );
}

/**
 * Props for {@link ControlPanel}.
 */
export type ControlPanelProps = {
  leadTimeIdx: number;
  initTimeIdx: number;
  /** Number of init_time values in the dataset; `0` while the zarr array is still opening. */
  initTimeCount: number;
  isPlaying: boolean;
  colormapId: ColormapId;
  rescaleMin: number;
  rescaleMax: number;
  filterMin: number;
  filterMax: number;
  frameDurationMs: number;
  onLeadTimeIdxChange: (idx: number) => void;
  onInitTimeIdxChange: (idx: number) => void;
  onPlayPauseToggle: () => void;
  onColormapIdChange: (id: ColormapId) => void;
  onRescaleMinChange: (v: number) => void;
  onRescaleMaxChange: (v: number) => void;
  onFilterMinChange: (v: number) => void;
  onFilterMaxChange: (v: number) => void;
  onFrameDurationMsChange: (v: number) => void;
};

/**
 * Overlay panel with play/pause, lead-time slider, colormap picker,
 * temperature-range (rescale) sliders, and frame-duration slider.
 */
export function ControlPanel(props: ControlPanelProps) {
  const {
    leadTimeIdx,
    initTimeIdx,
    initTimeCount,
    isPlaying,
    colormapId,
    rescaleMin,
    rescaleMax,
    filterMin,
    filterMax,
    frameDurationMs,
    onLeadTimeIdxChange,
    onInitTimeIdxChange,
    onPlayPauseToggle,
    onColormapIdChange,
    onRescaleMinChange,
    onRescaleMaxChange,
    onFilterMinChange,
    onFilterMaxChange,
    onFrameDurationMsChange,
  } = props;
  const hours = ECMWF_LEAD_TIME_HOURS[leadTimeIdx] ?? 0;

  const selectedChoice =
    COLORMAP_CHOICES.find((c) => c.id === colormapId) ?? COLORMAP_CHOICES[0];

  // Radix Slider.Root with two thumbs emits [min, max] pairs and keeps the
  // thumbs ordered internally, so no manual clamping is needed.
  const handleRescaleChange = (range: number[]) => {
    const [nextMin, nextMax] = range;
    if (nextMin !== undefined && nextMin !== rescaleMin) {
      onRescaleMinChange(nextMin);
    }
    if (nextMax !== undefined && nextMax !== rescaleMax) {
      onRescaleMaxChange(nextMax);
    }
  };
  const handleFilterChange = (range: number[]) => {
    const [nextMin, nextMax] = range;
    if (nextMin !== undefined && nextMin !== filterMin) {
      onFilterMinChange(nextMin);
    }
    if (nextMax !== undefined && nextMax !== filterMax) {
      onFilterMaxChange(nextMax);
    }
  };

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
        ECMWF IFS ENS — 2 m Temperature
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
            <span style={{ whiteSpace: "nowrap" }}>Forecast date:</span>
            <input
              type="date"
              min={isoDateString(ECMWF_INIT_TIME_ORIGIN)}
              max={
                initTimeCount > 0
                  ? isoDateString(dateFromInitTimeIdx(initTimeCount - 1))
                  : undefined
              }
              value={isoDateString(dateFromInitTimeIdx(initTimeIdx))}
              disabled={initTimeCount === 0}
              onChange={(e) => {
                const next = initTimeIdxFromDate(
                  new Date(`${e.target.value}T00:00:00Z`),
                  Math.max(0, initTimeCount - 1),
                );
                onInitTimeIdxChange(next);
              }}
              style={{ flex: 1, cursor: "pointer" }}
            />
          </label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              color: "#666",
              marginBottom: "12px",
            }}
          >
            <span>
              Lead time: +
              <span
                style={{
                  display: "inline-block",
                  minWidth: "3ch",
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {hours}
              </span>{" "}
              h
            </span>
            <InfoTooltip
              label="Lead time resolution info"
              body={
                "Forecast steps are 3-hourly from +0 h to +144 h (48 steps), " +
                "then 6-hourly from +150 h to +360 h (37 steps). " +
                "6 h steps dwell twice as long during animation so the " +
                "simulated-time pacing stays constant."
              }
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <button
              type="button"
              onClick={onPlayPauseToggle}
              aria-label={isPlaying ? "Pause" : "Play"}
              title={isPlaying ? "Pause" : "Play"}
              style={{
                width: "32px",
                height: "32px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
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
              marginBottom: "8px",
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
          <div
            role="img"
            aria-label={`Colormap preview: ${selectedChoice.label}`}
            style={{
              width: "100%",
              height: `${PREVIEW_ROW_HEIGHT}px`,
              borderRadius: "2px",
              border: "1px solid #ddd",
              backgroundImage: `url(${colormapsPngUrl})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `100% ${COLORMAP_SPRITE_HEIGHT * PREVIEW_ROW_HEIGHT}px`,
              backgroundPosition: `0 -${selectedChoice.colormapIndex * PREVIEW_ROW_HEIGHT}px`,
              transform: selectedChoice.reversed ? "scaleX(-1)" : undefined,
              imageRendering: "pixelated",
              marginBottom: "16px",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#666",
              marginBottom: "4px",
            }}
          >
            <span>Rescale range</span>
            <span>
              {rescaleMin}°C – {rescaleMax}°C
            </span>
          </div>
          <Slider.Root
            min={TEMP_SLIDER_MIN}
            max={TEMP_SLIDER_MAX}
            step={TEMP_SLIDER_STEP}
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
              marginBottom: "12px",
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
                aria-label={
                  key === "min" ? "Rescale min (°C)" : "Rescale max (°C)"
                }
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
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#666",
              marginBottom: "4px",
            }}
          >
            <span>Filter range</span>
            <span>
              {filterMin}°C - {filterMax}°C
            </span>
          </div>
          <Slider.Root
            min={TEMP_SLIDER_MIN}
            max={TEMP_SLIDER_MAX}
            step={TEMP_SLIDER_STEP}
            value={[filterMin, filterMax]}
            onValueChange={handleFilterChange}
            minStepsBetweenThumbs={1}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              userSelect: "none",
              touchAction: "none",
              height: "20px",
              marginBottom: "16px",
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
                  background: "#b36a49",
                  borderRadius: "2px",
                }}
              />
            </Slider.Track>
            {(["min", "max"] as const).map((key) => (
              <Slider.Thumb
                key={key}
                aria-label={
                  key === "min" ? "Filter min (°C)" : "Filter max (°C)"
                }
                style={{
                  display: "block",
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  background: "#b36a49",
                  border: "2px solid white",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                  cursor: "pointer",
                  outline: "none",
                }}
              />
            ))}
          </Slider.Root>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              color: "#666",
            }}
          >
            <span
              style={{ whiteSpace: "nowrap" }}
              title="Dwell time per 3 h lead-time step. 6 h steps (after +144 h) dwell twice as long so simulated-time pacing stays constant."
            >
              3 h step: {frameDurationMs} ms
            </span>
            <input
              type="range"
              min={FRAME_MS_MIN}
              max={FRAME_MS_MAX}
              step={FRAME_MS_STEP}
              value={frameDurationMs}
              onChange={(e) => onFrameDurationMsChange(Number(e.target.value))}
              style={{ flex: 1, cursor: "pointer" }}
            />
          </label>
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
              href="https://dynamical.org/catalog/ecmwf-ifs-ens-forecast-15-day-0-25-degree/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "inherit" }}
            >
              ECMWF IFS ENS Forecast data
            </a>{" "}
            processed by dynamical.org from ECMWF Open Data. Client-side
            rendered with{" "}
            <a
              href="https://developmentseed.org/deck.gl-raster/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "inherit" }}
            >
              deck.gl-raster ↗
            </a>
            .
          </div>
        </>
      )}
    </div>
  );
}
