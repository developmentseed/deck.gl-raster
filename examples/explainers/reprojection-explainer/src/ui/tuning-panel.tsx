import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import type { FlightStyle } from "../animation/flight.js";
import type { ErrorSpace } from "../scene/refinement.js";
import { SCENARIOS, scenarioById } from "../scene/scenarios.js";
import type { AppSettings } from "../settings.js";

/** Width of the open panel, in CSS px. */
const PANEL_WIDTH = 320;
/** Width of the collapsed panel's rail, in CSS px. */
const RAIL_WIDTH = 44;
/**
 * Screens where the open panel floats over the slide instead of sitting
 * beside it, which would leave the slide too small.
 */
const NARROW_QUERY = "(max-width: 700px)";

const REPO_URL = "https://github.com/developmentseed/deck.gl-raster";
const SOURCE_URL = `${REPO_URL}/tree/main/examples/explainers/reprojection-explainer`;
const DOCS_URL = "https://developmentseed.org/deck.gl-raster/";
const DEVSEED_URL = "https://developmentseed.org/";

// GitHub's dark palette, like the slide.
const BACKGROUND = "#161b22";
const FIELD_BACKGROUND = "#0d1117";
const BORDER = "#30363d";
const TEXT = "#e6edf3";
const MUTED = "#8b949e";
const LINK = "#58a6ff";

/** Props of {@link TuningPanel}. */
export type TuningPanelProps = {
  /** Whether the panel is open. Closed, it collapses to a narrow rail. */
  open: boolean;
  /** Called to open or collapse the panel. */
  onOpenChange: (open: boolean) => void;
  /** Current settings. */
  settings: AppSettings;
  /** Called with the full new settings object. */
  onChange: (settings: AppSettings) => void;
};

/**
 * Rehearsal controls in a sidebar beside the slide, so they never cover the
 * animation. It starts collapsed to a rail that opens it (as does H).
 */
export function TuningPanel({
  open,
  onOpenChange,
  settings,
  onChange,
}: TuningPanelProps) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <aside
      aria-label="Tuning"
      style={{
        flex: "none",
        boxSizing: "border-box",
        width: open ? PANEL_WIDTH : RAIL_WIDTH,
        maxWidth: "90vw",
        // Collapsed on a narrow screen, only the rail's button shows.
        height: narrow && !open ? "auto" : "100%",
        background: BACKGROUND,
        borderRight: `1px solid ${BORDER}`,
        color: TEXT,
        colorScheme: "dark",
        fontSize: 14,
        ...(narrow
          ? {
              position: "absolute",
              left: 0,
              top: 0,
              zIndex: 10,
              borderBottom: `1px solid ${BORDER}`,
            }
          : {}),
      }}
    >
      {open ? (
        <div
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 12px 12px 16px",
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Tuning</h2>
            <button
              type="button"
              aria-label="Hide the tuning panel"
              aria-expanded={true}
              title="Hide (H)"
              onClick={() => onOpenChange(false)}
              style={ICON_BUTTON_STYLE}
            >
              «
            </button>
          </header>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
            <Section title="Scene">
              <Field label="Scenario">
                <select
                  aria-label="Scenario"
                  value={settings.scenario}
                  onChange={(event) => {
                    releaseFocus(event.currentTarget);
                    const scenario = scenarioById(event.target.value);
                    onChange({
                      ...settings,
                      scenario: scenario.id,
                      finalMaxError: scenario.defaultMaxError,
                    });
                  }}
                  style={SELECT_STYLE}
                >
                  {SCENARIOS.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Error measured">
                <select
                  aria-label="Error measured"
                  value={settings.errorSpace}
                  onChange={(event) => {
                    releaseFocus(event.currentTarget);
                    update("errorSpace", event.target.value as ErrorSpace);
                  }}
                  style={SELECT_STYLE}
                >
                  <option value="input">In input pixels</option>
                  <option value="output">In output pixels</option>
                </select>
              </Field>
              <Field label="Final mesh tolerance">
                <select
                  aria-label="Final mesh tolerance"
                  value={settings.finalMaxError}
                  onChange={(event) => {
                    releaseFocus(event.currentTarget);
                    update("finalMaxError", Number(event.target.value));
                  }}
                  style={SELECT_STYLE}
                >
                  {scenarioById(settings.scenario).maxErrorChoices.map((px) => (
                    <option key={px} value={px}>
                      {px} px
                    </option>
                  ))}
                </select>
              </Field>
            </Section>
            <Section title="Animation">
              <Field label="Flight style">
                <select
                  aria-label="Flight style"
                  value={settings.flightStyle}
                  onChange={(event) => {
                    releaseFocus(event.currentTarget);
                    update("flightStyle", event.target.value as FlightStyle);
                  }}
                  style={SELECT_STYLE}
                >
                  <option value="direct">Direct</option>
                  <option value="fly-then-snap">Fly, then snap</option>
                </select>
              </Field>
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
            </Section>
            <Section title="Keys">
              <KeyList />
            </Section>
          </div>
          <footer
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "4px 14px",
              padding: "10px 16px",
              borderTop: `1px solid ${BORDER}`,
              fontSize: 12,
            }}
          >
            <FooterLink href={DOCS_URL}>Documentation ↗</FooterLink>
            <FooterLink href={SOURCE_URL}>View source ↗</FooterLink>
            <FooterLink href={REPO_URL}>GitHub ↗</FooterLink>
            <FooterLink href={DEVSEED_URL}>Development Seed ↗</FooterLink>
          </footer>
        </div>
      ) : (
        <button
          type="button"
          aria-label="Show the tuning panel"
          aria-expanded={false}
          title="Tuning (H)"
          onClick={() => onOpenChange(true)}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            width: "100%",
            height: narrow ? RAIL_WIDTH : "100%",
            padding: narrow ? 0 : "14px 0",
            justifyContent: narrow ? "center" : "flex-start",
            background: "transparent",
            border: "none",
            color: MUTED,
            cursor: "pointer",
          }}
        >
          <SlidersIcon />
          {narrow ? null : (
            <>
              <span
                style={{
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                  fontSize: 13,
                  letterSpacing: "0.04em",
                }}
              >
                Tuning
              </span>
              <Key>H</Key>
            </>
          )}
        </button>
      )}
    </aside>
  );
}

/** The presenter keys, as keycaps. */
function KeyList() {
  const rows: [ReactNode, string][] = [
    [
      <>
        <Key>→</Key> <Key>Space</Key> <Key>PgDn</Key>
      </>,
      "Next step, or finish the animation",
    ],
    [
      <>
        <Key>←</Key> <Key>PgUp</Key>
      </>,
      "Previous step",
    ],
    [<Key key="r">R</Key>, "Replay this step"],
    [
      <>
        <Key>1</Key>–<Key>7</Key>
      </>,
      "Jump to a step",
    ],
    [<Key key="d">D</Key>, "Show or hide descriptions"],
    [<Key key="f">F</Key>, "Switch flight style"],
    [<Key key="m">M</Key>, "Switch where error is measured"],
    [<Key key="h">H</Key>, "Show or hide this panel"],
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        alignItems: "center",
        gap: "8px 12px",
        fontSize: 13,
      }}
    >
      {rows.map(([keys, action]) => (
        <div key={action} style={{ display: "contents" }}>
          <span style={{ whiteSpace: "nowrap" }}>{keys}</span>
          <span style={{ color: MUTED }}>{action}</span>
        </div>
      ))}
    </div>
  );
}

/** A key, drawn as a keycap. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-block",
        boxSizing: "border-box",
        minWidth: 22,
        padding: "0 5px",
        border: `1px solid ${BORDER}`,
        borderBottomWidth: 2,
        borderRadius: 4,
        background: "#21262d",
        color: TEXT,
        font: "600 11px/18px ui-monospace, SFMono-Regular, Menlo, monospace",
        textAlign: "center",
      }}
    >
      {children}
    </kbd>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 16 }}>
      <h3
        style={{
          margin: "0 0 8px",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: MUTED,
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A caption above its control, which carries the same name as `aria-label`. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
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
    <Field label={`${label}: ${format(value)}`}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: "100%", margin: 0, accentColor: LINK }}
      />
    </Field>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{ color: LINK, textDecoration: "none" }}
    >
      {children}
    </a>
  );
}

/** Three sliders: the panel's icon. */
function SlidersIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 5h14M3 10h14M3 15h14" />
      <circle cx="7" cy="5" r="1.8" fill={BACKGROUND} />
      <circle cx="13" cy="10" r="1.8" fill={BACKGROUND} />
      <circle cx="9" cy="15" r="1.8" fill={BACKGROUND} />
    </svg>
  );
}

/**
 * Give a select's focus back to the page once a value is picked, so the
 * presenter keys (→, Space, M, …) work again without clicking the slide.
 */
function releaseFocus(select: HTMLSelectElement): void {
  select.blur();
}

/** Whether a CSS media query matches, kept up to date. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

const SELECT_STYLE: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "5px 8px",
  background: FIELD_BACKGROUND,
  color: TEXT,
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  font: "inherit",
};

const ICON_BUTTON_STYLE: CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  background: "transparent",
  border: "none",
  borderRadius: 6,
  color: MUTED,
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
};
