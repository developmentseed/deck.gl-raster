import type { CSSProperties, ReactNode } from "react";
import type { Hud as HudState, Label } from "../animation/frame.js";
import type { TextRun } from "../animation/story.js";
import type { Layout, Rect, SlideFit } from "../scene/layout.js";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "../scene/layout.js";

/** Props of {@link Hud}. */
export type HudProps = {
  /** How the slide sits in the window. */
  fit: SlideFit;
  /** Panel placement. */
  layout: Layout;
  /** Text for the current frame. */
  hud: HudState;
  /** 1-based number of the step showing. */
  stepNumber: number;
  /** Title of the step showing. */
  title: string;
  /** Description of the step, or null when descriptions are hidden. */
  description: TextRun[] | null;
  /** Name of the source projection, under the source panel's title. */
  sourceName: string;
  /** Name of the target projection, under the target panel's title. */
  targetName: string;
  /** Credit for the image, shown under the source panel. */
  credit?: { text: string; href: string };
  /** Extra content laid out in slide units, such as the control bar. */
  children?: ReactNode;
};

const TEXT_COLOR = "#e6edf3";
const MUTED_COLOR = "#8b949e";
const LINK_COLOR = "#58a6ff";

/**
 * Top of the description block, in slide units: clear of the counter under
 * the map, which ends near y 803 when the map fills its panel (the Arctic).
 */
const DESCRIPTION_TOP = 830;

/**
 * The HTML over the slide: the step title, panel titles, labels, the counter,
 * and the description (or, when descriptions are hidden, the caption). It is
 * laid out in slide units and scaled with the same transform as the deck.gl
 * view, so it lines up with the canvas.
 */
export function Hud({
  fit,
  layout,
  hud,
  stepNumber,
  title,
  description,
  sourceName,
  targetName,
  credit,
  children,
}: HudProps) {
  const panelTitleY = Math.min(layout.source.y, layout.target.y) - 105;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        transform: `translate(${fit.offsetX}px, ${fit.offsetY}px) scale(${fit.scale})`,
        transformOrigin: "0 0",
        pointerEvents: "none",
        color: TEXT_COLOR,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 24,
          width: SLIDE_WIDTH,
          textAlign: "center",
          fontSize: 40,
          fontWeight: 650,
        }}
      >
        <span style={{ color: MUTED_COLOR }}>{stepNumber} · </span>
        {title}
      </div>
      <PanelTitle
        rect={layout.source}
        y={panelTitleY}
        title="The image as stored"
        subtitle={sourceName}
      />
      <PanelTitle
        rect={layout.target}
        y={panelTitleY}
        title="The map on screen"
        subtitle={targetName}
      />
      {credit ? (
        <a
          href={credit.href}
          target="_blank"
          rel="noreferrer"
          style={{
            position: "absolute",
            left: layout.source.x,
            top: layout.source.y + layout.source.height + 10,
            fontSize: 16,
            color: MUTED_COLOR,
            pointerEvents: "auto",
          }}
        >
          {credit.text}
        </a>
      ) : null}
      {hud.labels.map((label) => (
        <div key={label.id} style={labelStyle(label)}>
          {label.text}
        </div>
      ))}
      {/* One line, centred under the map: a narrow map must not wrap it. */}
      <div
        style={{
          position: "absolute",
          left: layout.target.x + layout.target.width / 2,
          top: layout.target.y + layout.target.height + 22,
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
          fontSize: 26,
          fontVariantNumeric: "tabular-nums",
          opacity: hud.counter ? 1 : 0,
          transition: "opacity 300ms",
        }}
      >
        {hud.counter ?? " "}
      </div>
      {description ? (
        <Description runs={description} />
      ) : (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: DESCRIPTION_TOP + 40,
            width: SLIDE_WIDTH,
            textAlign: "center",
            fontSize: 30,
            opacity: hud.caption ? 1 : 0,
            transition: "opacity 400ms",
          }}
        >
          {hud.caption ?? " "}
        </div>
      )}
      {children}
    </div>
  );
}

function Description({ runs }: { runs: TextRun[] }) {
  return (
    <p
      style={{
        position: "absolute",
        left: 140,
        top: DESCRIPTION_TOP,
        width: SLIDE_WIDTH - 280,
        margin: 0,
        fontSize: 24,
        lineHeight: 1.45,
        color: "#c9d1d9",
        pointerEvents: "auto",
      }}
    >
      {runs.map((run, i) => {
        // Runs are static per step, so their index is a stable key.
        const key = `run-${i}`;
        if (typeof run === "string") {
          return <span key={key}>{run}</span>;
        }
        if ("href" in run) {
          return (
            <a
              key={key}
              href={run.href}
              target="_blank"
              rel="noreferrer"
              style={{ color: LINK_COLOR }}
            >
              {run.text}
            </a>
          );
        }
        return <em key={key}>{run.text}</em>;
      })}
    </p>
  );
}

function PanelTitle({
  rect,
  y,
  title,
  subtitle,
}: {
  rect: Rect;
  y: number;
  title: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: y,
        width: rect.width,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 22, color: MUTED_COLOR, marginTop: 2 }}>
        {subtitle}
      </div>
    </div>
  );
}

function labelStyle(label: Label): CSSProperties {
  const shift = { left: "0", right: "-100%", center: "-50%" }[label.align];
  return {
    position: "absolute",
    left: label.x,
    top: label.y,
    transform: `translate(${shift}, -50%)`,
    color: label.color,
    opacity: label.opacity,
    fontSize: label.size ?? 22,
    fontWeight: 600,
    whiteSpace: "nowrap",
    textShadow: "0 1px 3px rgba(0, 0, 0, 0.8)",
  };
}
