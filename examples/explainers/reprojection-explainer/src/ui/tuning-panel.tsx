import { ControlPanel } from "deck.gl-raster-examples-shared";
import type { ReactNode } from "react";
import type { FlightStyle } from "../animation/flight.js";
import type { AppSettings } from "../settings.js";
import { FINAL_MAX_ERROR_CHOICES } from "../settings.js";

/** Props of {@link TuningPanel}. */
export type TuningPanelProps = {
  /** Current settings. */
  settings: AppSettings;
  /** Called with the full new settings object. */
  onChange: (settings: AppSettings) => void;
};

/** Rehearsal controls, hidden during the talk (toggle with H). */
export function TuningPanel({ settings, onChange }: TuningPanelProps) {
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <ControlPanel
      title="Tuning"
      position="top-left"
      sourcePath="examples/explainers/reprojection-explainer"
    >
      <Row text="Flight style">
        <select
          aria-label="Flight style"
          value={settings.flightStyle}
          onChange={(event) =>
            update("flightStyle", event.target.value as FlightStyle)
          }
        >
          <option value="direct">Direct</option>
          <option value="fly-then-snap">Fly, then snap</option>
        </select>
      </Row>
      <Row text="Final mesh tolerance">
        <select
          aria-label="Final mesh tolerance"
          value={settings.finalMaxError}
          onChange={(event) =>
            update("finalMaxError", Number(event.target.value))
          }
        >
          {FINAL_MAX_ERROR_CHOICES.map((px) => (
            <option key={px} value={px}>
              {px} px
            </option>
          ))}
        </select>
      </Row>
      <Range
        label="Speed"
        min={0.25}
        max={2}
        step={0.25}
        value={settings.speed}
        format={(value) => `${value}×`}
        onChange={(value) => update("speed", value)}
      />
      <Range
        label="Flight time"
        min={600}
        max={3000}
        step={100}
        value={settings.flightMs}
        format={(value) => `${value} ms`}
        onChange={(value) => update("flightMs", value)}
      />
      <Range
        label="Arc height"
        min={0}
        max={200}
        step={10}
        value={settings.arcHeight}
        format={(value) => `${value}`}
        onChange={(value) => update("arcHeight", value)}
      />
      <p style={{ fontSize: 13, color: "#57606a", marginTop: 12 }}>
        → / Space / PageDown: next · ← / PageUp: back · R: replay · 1–6: jump to
        step · D: descriptions · F: flight style · H: hide this panel
      </p>
    </ControlPanel>
  );
}

function Row({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        margin: "8px 0",
        fontSize: 14,
      }}
    >
      <span>{text}</span>
      {children}
    </div>
  );
}

function Range({
  label,
  min,
  max,
  step,
  value,
  format,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <Row text={`${label}: ${format(value)}`}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Row>
  );
}
